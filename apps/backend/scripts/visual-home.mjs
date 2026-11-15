// Screenshots the web Home page (spotlight + rails) against a copy of production's library, running
// the backend and web app from this checkout — so a change to artwork or cards can be looked at
// before it ships. Nothing is written to production: its root catalog is read over the admin API
// and copied into a throwaway local database (`campfire_visual`, dropped at the end); images come
// from TMDb's public CDN.
//
//   node apps/backend/scripts/visual-home.mjs <outDir> [prodBaseUrl]
//
// Needs the backend .env (MONGODB_URI, admin login that also works on production) and Chrome.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MongoClient } = require("mongodb");
const WebSocket = require("ws");

const OUT = process.argv[2] || "visual-out";
const PROD = process.argv[3] || "http://187.127.179.114:50001";
const backendDir = join(import.meta.dirname, "..");
const frontendDir = join(backendDir, "..", "frontend");
// npm workspaces hoist vite to the repo root; vite's package exports hide bin/ from require.resolve.
const viteBin = [join(frontendDir, "node_modules", "vite", "bin", "vite.js"), join(frontendDir, "..", "..", "node_modules", "vite", "bin", "vite.js")].find((f) => existsSync(f));
const envText = readFileSync(join(backendDir, ".env"), "utf-8");
const envValue = (name) => envText.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim().replace(/^"|"$/g, "");
const API_PORT = 4117;
const WEB_PORT = 4118;
const CDP_PORT = 9333;
const DB = "campfire_visual";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

async function login(base) {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: envValue("ADMIN_EMAIL"), password: envValue("ADMIN_PASSWORD") }),
  });
  return (await res.json()).token;
}

// 1. Production's root catalog, as the admin sees it (full docs, artwork included).
const prodToken = await login(PROD);
const overview = await (await fetch(`${PROD}/api/admin/catalog/overview`, { headers: { authorization: `Bearer ${prodToken}` } })).json();
const revive = (doc) => {
  const out = { ...doc };
  for (const key of ["createdAt", "curatedAt", "updatedAt"]) if (out[key]) out[key] = new Date(out[key]);
  return out;
};
const mongo = new MongoClient(envValue("MONGODB_URI"));
await mongo.connect();
const db = mongo.db(DB);
await db.dropDatabase();
if (overview.rootFolders.length) await db.collection("catalogFolders").insertMany(overview.rootFolders.map(revive));
if (overview.rootVideos.length) await db.collection("catalogVideos").insertMany(overview.rootVideos.map(revive));
console.log(`copied ${overview.rootFolders.length} series, ${overview.rootVideos.length} movies`);

const procs = [];
const artworkDir = mkdtempSync(join(tmpdir(), "campfire-visual-art-"));
const webDist = mkdtempSync(join(tmpdir(), "campfire-visual-web-"));
const chromeProfile = mkdtempSync(join(tmpdir(), "campfire-visual-chrome-"));
function start(cmd, args, opts, label) {
  const p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  p.log = "";
  p.stdout.on("data", (d) => (p.log += d));
  p.stderr.on("data", (d) => (p.log += d));
  p.label = label;
  procs.push(p);
  return p;
}

try {
  // 2. This checkout's backend on that copy.
  const api = start(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(API_PORT),
      MONGODB_DB_NAME: DB,
      FRONTEND_URL: `http://127.0.0.1:${WEB_PORT}`,
      TMDB_API_KEY: "visual-check", // every root title is already matched; no searches happen
      ARTWORK_DIR: artworkDir,
    },
  }, "backend");
  for (let i = 0; i < 360 && !api.log.includes("listening") && api.exitCode === null; i++) await sleep(500); // a freshly created Atlas database can take a while to build indexes
  if (!api.log.includes("listening")) throw new Error(`backend didn't start:\n${api.log}`);

  // 3. This checkout's web app, built against it.
  execFileSync(process.execPath, [viteBin, "build", "--outDir", webDist, "--emptyOutDir"], {
    cwd: frontendDir,
    env: { ...process.env, VITE_API_URL: `http://127.0.0.1:${API_PORT}` },
    stdio: "ignore",
  });
  const web = start(process.execPath, [viteBin, "preview", "--outDir", webDist, "--port", String(WEB_PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: frontendDir }, "web");
  for (let i = 0; i < 60 && !web.log.includes(String(WEB_PORT)); i++) await sleep(500);

  const token = await login(`http://127.0.0.1:${API_PORT}`);

  // 4. Headless Chrome over the DevTools protocol.
  start("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${chromeProfile}`,
    "--hide-scrollbars", "--no-first-run", "--disable-gpu", "about:blank",
  ], {}, "chrome");
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try {
      target = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()).find((t) => t.type === "page");
    } catch { /* not up yet */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.once("open", r));
  let nextId = 1;
  const pending = new Map();
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  async function shot(name, width, height, scrollY = 0) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await send("Page.navigate", { url: `http://127.0.0.1:${WEB_PORT}/` });
    await sleep(9000); // data + first image downloads from TMDb
    if (scrollY) {
      await send("Runtime.evaluate", { expression: `window.scrollTo(0, ${scrollY})` });
      await sleep(1500);
    }
    const res = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(res.result.data, "base64"));
    console.log(`wrote ${name}.png`);
  }

  await send("Page.enable");
  await send("Page.navigate", { url: `http://127.0.0.1:${WEB_PORT}/login` });
  await sleep(2000);
  await send("Runtime.evaluate", { expression: `localStorage.setItem("campfire_token", ${JSON.stringify(token)})` });
  await shot("home-desktop-top", 1440, 900);
  await shot("home-desktop-rails", 1440, 900, 700);
  await shot("home-phone-top", 390, 844);
  await shot("home-phone-rails", 390, 844, 560);
  ws.close();
} catch (error) {
  console.error(error);
  for (const p of procs) if (p.log) console.error(`--- ${p.label}\n${p.log.slice(-2000)}`);
  process.exitCode = 1;
} finally {
  for (const p of procs) p.kill();
  await db.dropDatabase().catch(() => {});
  await mongo.close();
  await sleep(500);
  // Chrome can hold its profile for a moment after exiting; a leftover temp folder isn't worth failing over.
  for (const dir of [artworkDir, webDist, chromeProfile]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    } catch {
      console.warn(`left behind: ${dir}`);
    }
  }
}
