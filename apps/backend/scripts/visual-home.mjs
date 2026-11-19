// Screenshots the web app (Home, a series page, a film's player page) against a copy of
// production's library, running the backend and web app from this checkout — so a change to
// artwork, cards or metadata can be looked at before it ships. Nothing is written to production:
// its catalog is read over the admin API and copied into a throwaway local database
// (`campfire_visual`, dropped at the end); images come from TMDb's public CDN.
//
//   node apps/backend/scripts/visual-home.mjs <outDir> [prodBaseUrl] [--rename]
//
// --rename first presses the admin "use TMDb's titles" and "use TMDb's names for every episode"
// buttons on the *local copy*, so the screenshots show what those do to a library full of raw
// filenames. Production is never written to either way.
//
// --explore takes only the Explore page's shots (rows, filters, a title's where-to-watch panel).
//
// Needs the backend .env (MONGODB_URI, admin login that also works on production, and
// TMDB_API_KEY if the new metadata is to be fetched for real) and Chrome.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MongoClient } = require("mongodb");
const WebSocket = require("ws");

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const RENAME = process.argv.includes("--rename");
const EXPLORE_ONLY = process.argv.includes("--explore");
const OUT = args[0] || "visual-out";
const PROD = args[1] || "http://187.127.179.114:50001";
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

// 1. Production's catalog, as the admin sees it (full docs, artwork included) — the root, plus
//    two levels down, so a series page has its seasons and episodes to render.
const prodToken = await login(PROD);
const prodGet = async (path) =>
  (await fetch(`${PROD}${path}`, { headers: { authorization: `Bearer ${prodToken}` } })).json();
const overview = await prodGet("/api/admin/catalog/overview");
const revive = (doc) => {
  const out = { ...doc };
  for (const key of ["createdAt", "curatedAt", "updatedAt"]) if (out[key]) out[key] = new Date(out[key]);
  return out;
};

const folders = [...overview.rootFolders];
const videos = [...overview.rootVideos];
const seen = new Set(folders.map((f) => f._id));
for (let depth = 0, frontier = [...overview.rootFolders]; depth < 2 && frontier.length; depth++) {
  const next = [];
  for (const folder of frontier) {
    const detail = await prodGet(`/api/admin/catalog/folder/${folder._id}`);
    for (const child of detail.childFolders ?? []) {
      if (seen.has(child._id)) continue;
      seen.add(child._id);
      folders.push(child);
      next.push(child);
    }
    videos.push(...(detail.childVideos ?? []));
  }
  frontier = next;
}

const mongo = new MongoClient(envValue("MONGODB_URI"));
await mongo.connect();
const db = mongo.db(DB);
await db.dropDatabase();
if (folders.length) await db.collection("catalogFolders").insertMany(folders.map(revive));
if (videos.length) await db.collection("catalogVideos").insertMany(videos.map(revive));
console.log(`copied ${folders.length} folders, ${videos.length} videos`);

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
      // The real key when the .env has one: production's docs were matched by an older build, so
      // the startup pass has to call TMDb again to fill in the facts, cast and wordmarks this
      // check is looking at. Without a key it still runs, just with the old data.
      TMDB_API_KEY: envValue("TMDB_API_KEY") || "visual-check",
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

  if (RENAME) {
    const admin = (path, body) =>
      fetch(`http://127.0.0.1:${API_PORT}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      }).then((r) => r.json());
    const renamed = await admin("/api/admin/catalog/artwork/use-tmdb-titles");
    console.log(`renamed ${renamed.renamed?.length ?? 0} title(s):`);
    for (const item of renamed.renamed ?? []) console.log(`  ${item.from}  ->  ${item.to}`);
    for (const series of folders.filter((f) => f.artwork?.tmdbType === "tv")) {
      const result = await admin(`/api/admin/catalog/artwork/folder/${series._id}/episodes`, { force: true });
      console.log(`  ${series.title}: named ${result.matched ?? 0} episode(s), renaming ${result.renamed ?? 0}`);
    }
  }

  // 4. Headless Chrome over the DevTools protocol.
  start("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${chromeProfile}`,
    "--hide-scrollbars", "--no-first-run", "--ignore-gpu-blocklist", "about:blank",
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

  const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "none", ...extra });
  async function shot(name, width, height, { path = "/", scrollY = 0, settle = 9000, then = null, act = null } = {}) {
    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
    await send("Page.navigate", { url: `http://127.0.0.1:${WEB_PORT}${path}` });
    await sleep(settle); // data + first image downloads from TMDb
    if (act) await act();
    if (then) {
      await send("Runtime.evaluate", { expression: then });
      await sleep(2500);
    }
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
  // Explore: all of TMDb, with Game of Thrones' panel open (it streams on JioHotstar in India).
  // The fisheye wall: as it opens, after a drag (then hovering a poster), zoomed out, with one
  // clicked open, on a phone, and with "In Campfire" on.
  await shot("explore-wall-desktop", 1440, 900, { path: "/explore", settle: 16000 });
  await shot("explore-wall-dragged", 1440, 900, {
    path: "/explore",
    settle: 14000,
    act: async () => {
      await mouse("mousePressed", 900, 520, { button: "left", clickCount: 1 });
      for (let k = 1; k <= 12; k++) {
        await mouse("mouseMoved", 900 - k * 25, 520 - k * 8, { button: "left" });
        await sleep(30);
      }
      await mouse("mouseReleased", 600, 424, { button: "left", clickCount: 1 });
      await sleep(2500);
      await mouse("mouseMoved", 980, 300);
      await sleep(800);
    },
  });
  await shot("explore-wall-zoomed", 1440, 900, {
    path: "/explore",
    settle: 14000,
    act: async () => {
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 500 });
      await sleep(1800);
    },
  });
  await shot("explore-wall-open", 1440, 900, {
    path: "/explore",
    settle: 14000,
    act: async () => {
      await mouse("mouseMoved", 1010, 470);
      await mouse("mousePressed", 1010, 470, { button: "left", clickCount: 1 });
      await mouse("mouseReleased", 1010, 470, { button: "left", clickCount: 1 });
      await sleep(4000);
    },
  });
  await shot("explore-wall-phone", 390, 844, { path: "/explore", settle: 14000 });
  await shot("explore-wall-lib", 1440, 900, { path: "/explore?lib=1", settle: 14000 });

  await shot("explore-desktop-top", 1440, 900, { path: "/explore?view=rows" });
  await shot("explore-desktop-rows", 1440, 900, { path: "/explore?view=rows", scrollY: 900 });
  await shot("explore-desktop-filtered", 1440, 900, { path: "/explore?view=rows&kind=movie&services=8,2336", scrollY: 420 });
  await shot("explore-desktop-title", 1440, 900, { path: "/explore?title=tv-1399" });
  await shot("explore-desktop-request", 1440, 900, { path: "/explore?title=movie-129" });
  await shot("explore-phone-top", 390, 844, { path: "/explore?view=rows" });
  await shot("explore-phone-title", 390, 844, { path: "/explore?title=tv-1399" });
  if (EXPLORE_ONLY) throw Object.assign(new Error("explore only"), { done: true });

  await shot("home-desktop-top", 1440, 900);
  await shot("home-desktop-rails", 1440, 900, { scrollY: 700 });
  await shot("home-phone-top", 390, 844);
  await shot("home-phone-rails", 390, 844, { scrollY: 560 });

  // Discovery: Home's genre rows, browse filtered to a genre, and a search that only an actor's
  // name can satisfy.
  await shot("home-desktop-genres", 1440, 900, { scrollY: 1250 });
  await shot("discover-genre", 1440, 900, { path: "/discover?genre=Drama" });
  // Opens search the way a person would ("/"), then types into React's controlled input — which
  // only notices a value set through the native setter followed by an input event.
  const typeSearch = (text) => `(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true }));
    setTimeout(() => {
      const input = document.getElementById("library-search");
      if (!input) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(text)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, 400);
  })()`;
  await shot("search-actor", 1440, 900, { then: typeSearch("matt smith") });

  // A series and a film, which is where the facts line, the cast row and the episode synopses are.
  // Picked from what production actually has, so this keeps working as the library changes.
  const series = folders.find((f) => f.artwork?.tmdbType === "tv" && f.parentFolderId === envValue("DRIVE_ROOT_FOLDER_ID"));
  const film = videos.find((v) => v.artwork?.tmdbType === "movie");
  if (series) {
    await shot("series-desktop", 1440, 900, { path: `/folder/${series._id}` });
    await shot("series-desktop-episodes", 1440, 900, { path: `/folder/${series._id}`, scrollY: 620 });
    await shot("series-phone", 390, 844, { path: `/folder/${series._id}` });
  } else {
    console.warn("no matched series in the copied catalog — skipped the series shots");
  }
  if (film) {
    await shot("film-desktop", 1440, 900, { path: `/folder/${film.parentFolderId}` });
    // The player page: MKV films show the "needs the app" notice, and the info card sits under it.
    await shot("watch-desktop", 1440, 900, { path: `/watch/${film._id}`, settle: 11000 });
    await shot("watch-phone", 390, 844, { path: `/watch/${film._id}`, settle: 11000 });
  } else {
    console.warn("no matched film in the copied catalog — skipped the film shots");
  }
  ws.close();
} catch (error) {
  if (!error?.done) {
    console.error(error);
    for (const p of procs) if (p.log) console.error(`--- ${p.label}\n${p.log.slice(-2000)}`);
    process.exitCode = 1;
  }
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
