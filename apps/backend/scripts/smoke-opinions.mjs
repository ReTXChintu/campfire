// End-to-end check of watched / liked / disliked and the For you suggestions (lib/opinions.ts,
// lib/forYou.ts, routes/opinions.ts), and of what they change in Continue watching and Up next.
//
//   node apps/backend/scripts/smoke-opinions.mjs [path/to/.env] [--hold]
//
// Uses made-up catalog docs in a throwaway database (`campfire_opinions_smoke`, dropped at the end)
// and a local mock of TMDb. Needs the backend .env (MONGODB_URI, admin login). --hold keeps
// everything up after the checks, for looking at the web app, until Enter is pressed or stdin closes.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient } from "mongodb";

const HOLD = process.argv.includes("--hold");
const envPath = process.argv.slice(2).find((a) => !a.startsWith("--")) || join(import.meta.dirname, "..", ".env");
const envText = readFileSync(envPath, "utf-8");
const envValue = (name) => envText.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim().replace(/^"|"$/g, "");
const ROOT = envValue("DRIVE_ROOT_FOLDER_ID");
const DB_NAME = "campfire_opinions_smoke";
const PORT = Number(process.env.SMOKE_PORT || 4161);
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
const GENRES = { 28: "Action", 27: "Horror", 35: "Comedy", 878: "Science Fiction", 10765: "Sci-Fi & Fantasy" };
const listed = (id, title, genre, extra = {}) => ({
  id, title, poster_path: `/p${id}.jpg`, release_date: "2001-01-01", vote_average: 7, vote_count: 100, genre_ids: [genre], ...extra,
});
const RECOMMENDED = {
  "movie/100": [listed(200, "Outside Action", 28), listed(101, "Library Action", 28), listed(201, "Outside Horror", 27), listed(202, "Grown-ups", 28, { adult: true })],
  "movie/900": [listed(200, "Outside Action", 28), listed(203, "Outside Second", 28, { vote_average: 9 })],
  "tv/500": [{ id: 600, name: "Outside Show", poster_path: "/p600.jpg", first_air_date: "2010-01-01", vote_average: 8, vote_count: 50, genre_ids: [10765] }],
};
let calls = 0;
let tmdbDown = false;
const mock = createServer((req, res) => {
  const url = new URL(req.url, "http://mock");
  calls++;
  const json = (status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  if (tmdbDown) return json(500, {});
  if (url.pathname.startsWith("/genre/")) return json(200, { genres: Object.entries(GENRES).map(([id, name]) => ({ id: Number(id), name })) });
  const rec = url.pathname.match(/^\/((?:movie|tv)\/\d+)\/recommendations$/);
  if (rec) return json(200, { results: RECOMMENDED[rec[1]] ?? [] });
  if (url.pathname === "/movie/900") return json(200, { id: 900, title: "Elsewhere", genres: [{ id: 28, name: "Action" }], credits: { cast: [{ name: "Ann Lead", order: 0 }] } });
  return json(404, {});
}).listen(MOCK_PORT);

// --- data and server ------------------------------------------------------------------------------
const mongo = await new MongoClient(envValue("MONGODB_URI")).connect();
const db = mongo.db(DB_NAME);
await db.dropDatabase();
const now = new Date();
const artwork = (tmdbType, tmdbId, title, genres, cast = [], average = 7) => ({
  source: "link", tmdbType, tmdbId, title, year: 2000, overview: null, backdropPath: null, posterPath: null, matchedAt: now,
  tagline: null, runtimeMinutes: 100, genres, certificate: null, rating: { average, count: 10 }, logoPath: null, seasonCount: null,
  episodeCount: null, cast: cast.map((name) => ({ name, character: null, profilePath: null })),
});
const video = (id, parentFolderId, title, extra = {}) => ({
  _id: id, parentFolderId, driveName: `${title}.mp4`, mimeType: "video/mp4", sizeBytes: 1, durationSeconds: 60,
  status: "published", title, subtitleSetIds: [], introStart: null, introEnd: null, outroStart: null,
  episodeOrder: null, titleOverridden: true, introOverridden: false, renditions: {}, createdAt: now, curatedAt: now,
  curatedBy: "smoke", updatedAt: now, artworkAutoOff: true, ...extra,
});
const folder = (id, title, tmdbId, genres) => ({
  _id: id, parentFolderId: ROOT, driveName: title, status: "published", title, thumbnailFileId: null,
  artwork: artwork("tv", tmdbId, title, genres), episodeArtworkOff: true, createdAt: now, curatedAt: now, curatedBy: "smoke", updatedAt: now,
});
const episode = (seriesTmdbId, number) => ({
  seriesTmdbId, season: 1, episode: number, name: `E${number}`, overview: null, stillPath: null, airDate: null, runtimeMinutes: null, rating: null, matchedAt: now,
});
await db.collection("catalogFolders").insertMany([folder("show", "Space Show", "500", ["Sci-Fi & Fantasy"]), folder("show2", "Other Show", "501", ["Sci-Fi & Fantasy"])]);
await db.collection("catalogVideos").insertMany([
  video("a", ROOT, "Seen Action", { artwork: artwork("movie", "100", "Seen Action", ["Action"], ["Ann Lead"]) }),
  video("b", ROOT, "Library Action", { artwork: artwork("movie", "101", "Library Action", ["Action"]) }),
  video("c", ROOT, "Ann's Comedy", { artwork: artwork("movie", "102", "Ann's Comedy", ["Comedy"], ["Ann Lead"]) }),
  video("d", ROOT, "Bad Horror", { artwork: artwork("movie", "103", "Bad Horror", ["Horror"], [], 9.9) }),
  video("e", ROOT, "Great Horror", { artwork: artwork("movie", "104", "Great Horror", ["Horror"], [], 9.9) }),
  video("f", ROOT, "Film Sci-Fi", { artwork: artwork("movie", "105", "Film Sci-Fi", ["Science Fiction"]) }),
  video("home", ROOT, "Home video"),
  video("ep1", "show", "E1", { episodeArtwork: episode("500", 1), episodeOrder: 1 }),
  video("ep2", "show", "E2", { episodeArtwork: episode("500", 2), episodeOrder: 2 }),
  video("ep3", "show2", "E1", { episodeArtwork: episode("501", 1), episodeOrder: 1 }),
]);

const artworkDir = mkdtempSync(join(tmpdir(), "campfire-opinions-artwork-"));
const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: join(import.meta.dirname, ".."),
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_DB_NAME: DB_NAME,
    ARTWORK_DIR: artworkDir,
    TRICKPLAY: "off",
    TMDB_API_KEY: "mock",
    TMDB_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
    ...(process.env.SMOKE_FRONTEND ? { FRONTEND_URL: process.env.SMOKE_FRONTEND } : {}),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));

async function cleanup() {
  child.kill();
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
  for (let i = 0; i < 180; i++) {
    if ((await fetch(`${BASE}/api/health/db`).catch(() => null))?.ok) break;
    await sleep(500);
  }
  const signUp = async (name) =>
    (await api("/auth/signup", { method: "POST", body: { email: `${name}@smoke.test`, password: "smoke-pass-1", name } })).body.token;
  const viewer = await signUp("viewer");
  const other = await signUp("other");
  const A = "/api/opinions";
  const set = (title, body, token = viewer) => api(`${A}/${title}`, { token, method: "PUT", body });
  const mine = async (title, token = viewer) =>
    (await api(A, { token })).body.opinions.find((o) => `${o.type}/${o.id}` === title);
  const forYou = async (token = viewer) => (await api(`${A}/for-you`, { token })).body;
  const ids = (list) => list.map((i) => i.id ?? i.tmdbId).join();
  const play = (fileId, parentFolderId, positionSeconds, token = viewer) =>
    api("/api/progress", { token, method: "POST", body: { fileId, parentFolderId, positionSeconds, durationSeconds: 100 } });
  const carryOn = async () => (await api("/api/library", { token: viewer })).body.continueWatching.map((c) => c.item.id).join();

  // --- saying so ---
  check("signed-in only", (await api(A)).status === 401 && (await api(`${A}/for-you`)).status === 401);
  check("nothing to begin with", (await api(A, { token: viewer })).body.opinions.length === 0);
  check("nothing to suggest from", JSON.stringify(await forYou()) === JSON.stringify({ ready: false, library: [], explore: [] }));
  for (const [what, title, body, status] of [
    ["an unknown kind", "book/1", { watched: true }, 404],
    ["an id that isn't one", "movie/abc", { watched: true }, 404],
    ["nothing to set", "movie/100", {}, 400],
    ["no body", "movie/100", undefined, 400],
    ["watched that isn't yes or no", "movie/100", { watched: "yes" }, 400],
    ["an unknown rating", "movie/100", { rating: "love" }, 400],
  ]) check(`refuses ${what}`, (await set(title, body)).status === status);
  await set("movie/100", { rating: "like" });
  check("a like", JSON.stringify(await mine("movie/100")) === JSON.stringify({ type: "movie", id: "100", watched: false, rating: "like" }), await mine("movie/100"));
  await set("movie/100", { watched: true });
  check("watched keeps the like", (await mine("movie/100")).rating === "like" && (await mine("movie/100")).watched);
  await set("movie/100", { rating: "dislike" });
  check("a dislike replaces it", (await mine("movie/100")).rating === "dislike" && (await mine("movie/100")).watched);
  await set("movie/100", { rating: null });
  check("taking it back keeps watched", (await mine("movie/100")).rating === null && (await mine("movie/100")).watched);
  check("it's only the viewer's own", (await mine("movie/100", other)) === undefined);
  check("a film and a series with one id are two titles", (await mine("tv/100")) === undefined);
  await set("movie/100", { watched: false });
  check("unwatched", (await mine("movie/100"))?.watched === false);
  await set("movie/0104", { rating: "like" });
  check("an id is one however it's written", (await mine("movie/104"))?.rating === "like");
  await set("movie/104", { rating: null });
  check("nothing left to say is no opinion", (await mine("movie/104")) === undefined);
  await Promise.all(Array.from({ length: 6 }, (_, i) => set("movie/104", { rating: i % 2 ? "like" : null })));
  check("quick clicks don't fail or double up", (await db.collection("titleOpinions").countDocuments({ id: "104" })) <= 1);
  await set("movie/104", { rating: null });

  // --- watching ---
  await play("a", ROOT, 99);
  check("a film played to its end is watched", (await mine("movie/100"))?.watched === true);
  await sleep(20);
  await set("movie/100", { watched: false });
  check("unless the viewer says not", (await mine("movie/100")).watched === false);
  await sleep(20);
  await play("a", ROOT, 99);
  check("until it's finished again", (await mine("movie/100")).watched === true);
  await play("ep1", "show", 99);
  check("one episode isn't a whole series", (await mine("tv/500")) === undefined);
  await play("ep2", "show", 40);
  await play("f", ROOT, 40);
  check("under way", (await carryOn()) === "f,ep2", await carryOn());
  await sleep(20);
  await set("tv/500", { watched: true });
  await set("movie/105", { watched: true });
  check("marked watched, it isn't carried on with", (await carryOn()) === "", await carryOn());
  await sleep(20);
  await play("ep2", "show", 50);
  check("playing it again brings it back", (await carryOn()) === "ep2", await carryOn());
  await set("tv/500", { watched: false });
  await set("movie/105", { watched: false });

  // --- for you ---
  await db.collection("titleOpinions").deleteMany({});
  await db.collection("watchProgress").deleteMany({});
  await set("movie/103", { rating: "dislike" });
  check("a dislike alone suggests nothing", (await forYou()).ready === false);
  await set("movie/100", { rating: "like" });
  let picks = await forYou();
  const reason = (id) => picks.library.find((p) => p.id === id)?.reason;
  check("more like it, and with its lead", ids(picks.library) === "b,c", picks.library);
  check("the reasons", reason("b") === "Because you liked Seen Action" && reason("c") === "With Ann Lead", picks.library);
  check("what's rated isn't suggested, nor a genre disliked", !["a", "d", "e"].some((id) => ids(picks.library).includes(id)));
  check("from TMDb, without the library's, the adult or the disliked genre", ids(picks.explore) === "200", picks.explore);
  check("with what a card needs", picks.explore[0].posterUrl && picks.explore[0].title === "Outside Action" && picks.explore[0].reason === "Because you liked Seen Action");
  await set("movie/900", { rating: "like" });
  picks = await forYou();
  check("a title outside the library counts too", ids(picks.explore) === "200,203", picks.explore);
  const before = calls;
  await forYou();
  await forYou(other);
  check("TMDb's answers are kept", calls === before, calls - before);
  await set("movie/200", { watched: true });
  check("one watched elsewhere is left out", ids((await forYou()).explore) === "203");
  await play("b", ROOT, 30);
  check("one under way is left out", !ids((await forYou()).library).includes("b"));
  await set("tv/500", { rating: "like" });
  picks = await forYou();
  check("a series' genres count for films", ids(picks.library).includes("f") && ids(picks.library).includes("show2"), picks.library);
  check("and series are suggested", picks.explore.some((i) => i.tmdbType === "tv" && i.tmdbId === "600"), picks.explore);
  check("someone else's are their own", (await forYou(other)).ready === false);
  tmdbDown = true;
  await set("movie/901", { rating: "like" });
  check("without TMDb, the library still works", (await forYou()).library.length > 0);
  tmdbDown = false;

  // --- up next ---
  const suggested = async () => (await api("/api/video/a", { token: viewer })).body.suggestions.map((s) => s.fileId);
  check("up next leaves out what's disliked", !(await suggested()).includes("d"), await suggested());
  check("and what's liked already", !(await suggested()).includes("ep1"), await suggested());
  check("but still suggests", (await suggested()).length > 0);

  if (HOLD) {
    await db.collection("watchProgress").deleteMany({ fileId: "b" });
    console.log(`HOLD ${JSON.stringify({ base: BASE, viewer, other })}`);
    process.stdin.resume();
    await new Promise((resolve) => process.stdin.once("data", resolve).once("end", resolve));
  }
} catch (error) {
  failures.push(`crashed: ${error instanceof Error ? error.stack : error}`);
  console.log(log.slice(-2500));
} finally {
  await cleanup();
}

console.log(`${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
