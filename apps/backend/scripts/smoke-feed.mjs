// End-to-end check of Home's feed (lib/feed.ts, routes/feed.ts): its sections, the once-a-day copy,
// and what stands in when TMDb isn't answering.
//
//   node apps/backend/scripts/smoke-feed.mjs [path/to/.env]
//
// Uses made-up catalog docs in a throwaway database (`campfire_feed_smoke`, dropped at the end) and a
// local mock of TMDb. Needs the backend .env (MONGODB_URI, admin login).

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient } from "mongodb";

const envPath = process.argv[2] || join(import.meta.dirname, "..", ".env");
const envText = readFileSync(envPath, "utf-8");
const envValue = (name) => envText.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim().replace(/^"|"$/g, "");
const ROOT = envValue("DRIVE_ROOT_FOLDER_ID");
const DB_NAME = "campfire_feed_smoke";
const PORT = Number(process.env.SMOKE_PORT || 4141);
const MOCK_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) pass++;
  else failures.push(`${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

// --- TMDb -----------------------------------------------------------------------------------------
let calls = [];
let down = false;
let broken = null; // a path that fails
let flaky = false; // cuts each address's first two connections
const cut = new Map();
let generation = 1;
const title = (id, type) => ({
  id, media_type: type, ...(type === "movie" ? { title: `Film ${id}`, release_date: "2020-01-01" } : { name: `Show ${id}`, first_air_date: "2020-01-01" }),
  poster_path: `/p${id}.jpg`, backdrop_path: `/b${id}.jpg`, overview: "About it.", vote_average: 7, vote_count: 100, genre_ids: [28],
});
const mock = createServer((req, res) => {
  const url = new URL(req.url, "http://mock");
  calls.push(url);
  const json = (status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  if (flaky && (cut.get(req.url) ?? 0) < 2) {
    cut.set(req.url, (cut.get(req.url) ?? 0) + 1);
    return req.socket.destroy();
  }
  if (down || (broken && url.pathname === broken)) return json(500, {});
  if (url.pathname.startsWith("/genre/")) return json(200, { genres: [{ id: 28, name: "Action" }] });
  if (url.pathname.endsWith("/images")) {
    return json(200, { logos: [{ file_path: "/any.png", iso_639_1: null }, { file_path: "/en.svg", iso_639_1: "en" }, { file_path: "/en.png", iso_639_1: "en" }] });
  }
  const type = /\/tv(\/|$)/.test(url.pathname) ? "tv" : "movie";
  const page = Number(url.searchParams.get("page") ?? 1);
  // Each list has its own twenty titles a page, different each "day".
  const seed = [...url.pathname, ...(url.searchParams.get("with_genres") ?? ""), ...(url.searchParams.get("sort_by") ?? "")].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9000, 7);
  const results = Array.from({ length: 20 }, (_, i) => title(generation * 1_000_000 + seed * 100 + page * 20 + i, type));
  results.push({ ...title(5, type), adult: true }, { ...title(6, type), poster_path: null }, title(603, "movie").id && type === "movie" ? title(603, "movie") : title(1396, "tv"));
  return json(200, { page, total_pages: 2, results });
}).listen(MOCK_PORT);

// --- data and server ------------------------------------------------------------------------------
const mongo = await new MongoClient(envValue("MONGODB_URI")).connect();
const db = mongo.db(DB_NAME);
await db.dropDatabase();
const now = new Date();
const film = (status) => ({
  _id: "matrix", parentFolderId: ROOT, driveName: "Matrix.mp4", mimeType: "video/mp4", sizeBytes: 1, durationSeconds: 60,
  status, title: "The Matrix", subtitleSetIds: [], introStart: null, introEnd: null, outroStart: null, episodeOrder: null,
  titleOverridden: true, introOverridden: false, renditions: {}, createdAt: now, curatedAt: now, curatedBy: "smoke", updatedAt: now,
  artworkAutoOff: true,
  artwork: {
    source: "link", tmdbType: "movie", tmdbId: "603", title: "The Matrix", year: 1999, overview: null, backdropPath: null, posterPath: null,
    matchedAt: now, tagline: null, runtimeMinutes: 100, genres: ["Action"], certificate: null, rating: null, logoPath: null,
    seasonCount: null, episodeCount: null, cast: [],
  },
});
await db.collection("catalogVideos").insertOne(film("published"));

const artworkDir = mkdtempSync(join(tmpdir(), "campfire-feed-artwork-"));
let child = null;
let log = "";
async function start(env = {}) {
  if (child) {
    const gone = new Promise((r) => child.once("exit", r));
    child.kill();
    await gone;
  }
  child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: join(import.meta.dirname, ".."),
    env: {
      ...process.env, PORT: String(PORT), MONGODB_DB_NAME: DB_NAME, ARTWORK_DIR: artworkDir, TRICKPLAY: "off",
      TMDB_API_KEY: "mock", TMDB_API_BASE: `http://127.0.0.1:${MOCK_PORT}`, ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  for (let i = 0; i < 240; i++) {
    if ((await fetch(`${BASE}/api/health/db`).catch(() => null))?.ok) return;
    await sleep(500);
  }
  throw new Error("the backend didn't start");
}

async function cleanup() {
  child?.kill();
  mock.close();
  await db.dropDatabase().catch(() => {});
  await mongo.close();
  rmSync(artworkDir, { recursive: true, force: true });
}

async function api(path, { token, method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

try {
  await start();
  const signUp = async (name) =>
    (await api("/auth/signup", { method: "POST", body: { email: `${name}@smoke.test`, password: "smoke-pass-1", name } })).body.token;
  const viewer = await signUp("viewer");
  const other = await signUp("other");
  const feed = (query = "", token = viewer) => api(`/api/feed${query}`, { token });
  const section = (path) => api(`/api/feed/section/${path}`, { token: viewer });
  const yesterday = () => db.collection("feedPages").updateMany({}, { $set: { day: "2020-01-01" } });

  check("signed-in only", (await api("/api/feed")).status === 401 && (await api("/api/feed/section/hot")).status === 401);
  for (const bad of ["?page=-1", "?page=x", "?page=1.5", "?page=9999"]) check(`refuses ${bad}`, (await feed(bad)).status === 400);

  // --- what's in it ---
  const [first, sameTime] = await Promise.all([feed(), feed("", other)]);
  const madeWith = calls.length;
  check("two at once make it once", JSON.stringify(first.body) === JSON.stringify(sameTime.body) && new Set(calls.map(String)).size === calls.length, calls.length);
  const f = first.body;
  check("it's there", f.available === true && f.sections.length === 6 && f.next === 1, [f.available, f.sections?.length, f.next]);
  check("the top ten first", f.sections[0].look === "rank" && f.sections[0].items.length === 10);
  check("the hero has artwork and a wordmark", f.hero.length === 7 && f.hero.every((h) => h.backdropUrl && h.logoUrl.endsWith("/w500/en.png")), f.hero[0]);
  check("nothing adult, nothing without a poster", !JSON.stringify(f).includes('"tmdbId":"5"') && !JSON.stringify(f).includes('"tmdbId":"6"'));
  check("explicit films are asked to be left out", calls.filter((c) => c.pathname.startsWith("/discover/")).every((c) => c.searchParams.get("include_adult") === "false" && c.searchParams.get("without_keywords")));
  const matrix = async () => (await feed()).body.sections.flatMap((s) => s.items).find((i) => i.tmdbId === "603");
  check("what's in the library says so", (await matrix())?.inLibrary?.id === "matrix", await matrix());

  let page = 0;
  const ids = [];
  while (page !== null) {
    const { body } = await feed(`?page=${page}`);
    ids.push(...body.sections.map((s) => s.id));
    page = body.next;
  }
  check("every page, each section once", ids.length >= 35 && new Set(ids).size === ids.length, ids.length);
  check("past the end is empty", (await feed("?page=50")).status === 200 && (await feed("?page=50")).body.sections.length === 0);
  const tv = (await feed("?kind=tv")).body;
  check("series alone", tv.sections.flatMap((s) => s.items).every((i) => i.tmdbType === "tv"));
  check("films alone", (await feed("?kind=movie")).body.sections.flatMap((s) => s.items).every((i) => i.tmdbType === "movie"));

  // --- once a day ---
  check("making a page costs a handful of calls", madeWith < 40, madeWith);
  calls = [];
  generation = 2;
  const again = (await feed("", other)).body;
  check("the same all day, for everyone, without asking TMDb", calls.length === 0 && again.sections[1].items[0].tmdbId === f.sections[1].items[0].tmdbId);
  await db.collection("catalogVideos").updateOne({ _id: "matrix" }, { $set: { status: "curated" } });
  check("but the library is live", (await matrix()).inLibrary === null && calls.length === 0);
  await db.collection("catalogVideos").updateOne({ _id: "matrix" }, { $set: { status: "published" } });
  await start();
  calls = [];
  check("a restart keeps the day's copy", (await feed()).body.sections[1].items[0].tmdbId === f.sections[1].items[0].tmdbId && calls.length === 0, calls.length);
  await yesterday();
  const next = (await feed()).body;
  check("the next day's first open makes a new one", calls.length > 0 && next.sections[1].items[0].tmdbId !== f.sections[1].items[0].tmdbId);
  calls = [];
  await feed();
  check("and only the first", calls.length === 0);

  // --- TMDb not answering ---
  await yesterday();
  down = true;
  await start();
  const stale = await feed();
  check("the last copy stands in", stale.status === 200 && stale.body.sections[1].items[0].tmdbId === next.sections[1].items[0].tmdbId, stale.status);
  await db.collection("feedPages").deleteMany({});
  check("with no copy at all it says so", (await feed()).status === 502);
  check("as does a section on its own", (await section("action")).status === 502);
  down = false;
  broken = "/movie/now_playing";
  await start();
  const partial = await feed();
  check("a section that fails is left out", partial.status === 200 && partial.body.sections.length === 5 && !partial.body.sections.some((s) => s.id === "cinemas"), partial.body.sections?.map((s) => s.id));
  check("and that copy isn't kept", (await db.collection("feedPages").countDocuments({ _id: "all:0" })) === 0);
  broken = null;
  flaky = true;
  await start();
  const bumpy = await feed();
  check("dropped connections are tried again", bumpy.body.sections?.length === 6 && bumpy.body.hero.every((h) => h.logoUrl) && cut.size > 10, [bumpy.body.sections?.length, cut.size]);
  flaky = false;

  // --- a section on its own ---
  const one = (await section("action")).body;
  check("a section", one.title === "Action and adventure" && one.items.length >= 40 && one.next === 2, [one.title, one.items?.length, one.next]);
  const two = (await section("action?page=2")).body;
  check("its next page, and the last", two.next === null && two.items[0].tmdbId !== one.items[0].tmdbId);
  check("only films", (await section("action?kind=movie")).body.items.every((i) => i.tmdbType === "movie"));
  check("none that doesn't exist", (await section("nope")).status === 404 && (await section("horror?kind=tv")).status === 404);
  check("nor a page that doesn't", (await section("action?page=0")).status === 400);
  const similar = await api("/api/explore/title/movie/900/similar", { token: viewer });
  check("more like a title, with what's in the library", similar.status === 200 && similar.body.items.length === 12, similar.body.items?.length);
  check("but not of nonsense", (await api("/api/explore/title/book/1/similar", { token: viewer })).status === 404);

  await start({ TMDB_API_KEY: "" });
  const off = await feed();
  check("without a TMDb key it's off", off.status === 200 && off.body.available === false && off.body.sections.length === 0, off.body);
} catch (error) {
  failures.push(`crashed: ${error instanceof Error ? error.stack : error}`);
  console.log(log.slice(-2500));
} finally {
  await cleanup();
}

console.log(`${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
