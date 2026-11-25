// End-to-end check of playing any title (lib/titlePlay.ts and the live checks in lib/videoSources.ts):
// one the library doesn't have, from whichever source turns out to have it, with its progress, its
// episodes, and what a viewer is told when none does.
//
//   node apps/backend/scripts/smoke-play.mjs [path/to/.env] [--hold]
//
// Uses made-up catalog docs in a throwaway database (`campfire_play_smoke`, dropped at the end) and
// local mocks of TMDb, Bunny and Cloudflare; the streams are the two services' public demo videos.
// Needs the backend .env (MONGODB_URI, admin login) and internet access. --hold keeps everything up
// after the checks, for looking at the web app, until Enter is pressed or stdin closes.

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
const DB_NAME = "campfire_play_smoke";
const PORT = Number(process.env.SMOKE_PORT || 4191);
const MOCK_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) pass++;
  else failures.push(`${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

// --- TMDb, Bunny and Cloudflare -------------------------------------------------------------------
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const ANIME = { "movie/129": "Anime Film", "tv/1429": "Anime Show" };
const FILMS = { 603: "The Matrix", 700: "Nowhere Film", 701: "Draft Film", 702: "Late Film", 703: "Slow Film", 800: "Library Film", 13: "Thirteen" };
const tmdb = (path) => {
  const anime = ANIME[path.slice(1)];
  if (anime) return { id: 1, title: anime, name: anime, original_language: "ja", genres: [{ id: 16, name: "Animation" }] };
  if (path === "/movie/862") return { id: 862, title: "Toys", original_language: "en", genres: [{ id: 16, name: "Animation" }] };
  if (path === "/movie/990") return { id: 990, title: "Tokyo", original_language: "ja", genres: [{ id: 18, name: "Drama" }] };
  const film = path.match(/^\/movie\/(\d+)$/);
  if (film && FILMS[film[1]]) {
    return {
      id: Number(film[1]), title: FILMS[film[1]], release_date: "1999-03-31", overview: "About it.", vote_average: 8, vote_count: 500,
      backdrop_path: "/b.jpg", poster_path: "/p.jpg", runtime: 136, genres: [{ id: 28, name: "Action" }],
      credits: { cast: [{ name: "Lead", character: "Hero", order: 0, profile_path: "/c.jpg" }] }, images: { logos: [] },
    };
  }
  if (path === "/tv/1396") {
    return {
      id: 1396, name: "The Show", first_air_date: "2008-01-20", vote_average: 9, vote_count: 900, backdrop_path: "/sb.jpg", poster_path: "/sp.jpg",
      seasons: [{ season_number: 0, name: "Specials", episode_count: 1 }, { season_number: 1, name: "Season 1", episode_count: 2 }, { season_number: 2, name: "Season 2", episode_count: 2 }],
    };
  }
  const season = path.match(/^\/tv\/1396\/season\/(\d+)$/);
  if (season) {
    const n = Number(season[1]);
    const episode = (e, aired = "2010-01-01") => ({ episode_number: e, name: `S${n} Episode ${e}`, overview: "It happens.", still_path: `/e${e}.jpg`, air_date: aired, runtime: 45, vote_average: 8, vote_count: 10 });
    return { episodes: n === 0 ? [episode(1)] : n === 1 ? [episode(1), episode(2)] : [episode(1), episode(2, day(30))] };
  }
  return null;
};

const BUNNY_VIDEO = "eb1c4f77-0cda-46be-b47d-1118ad7c2ffe";
const CF_VIDEO = "6b9e68b07dfee8cc2d116e4c51d6a957";
const CF_HLS = `https://customer-f33zs165nr7gyfy4.cloudflarestream.com/${CF_VIDEO}/manifest/video.m3u8`;
const ACCOUNT = "a".repeat(32);
const bunny = (guid, title, extra = {}) => ({ guid, title, status: 4, length: 634, height: 1080, availableResolutions: "720p,1080p", captions: [], ...extra });
const cloudflare = (uid, name) => ({
  uid, meta: { name }, readyToStream: true, duration: 734, created: "2026-01-01T00:00:00Z", requireSignedURLs: false,
  playback: { hls: CF_HLS }, input: { height: 1080, width: 1920 },
});
let bunnyVideos = [];
let cloudflareVideos = [];
let bunnyDown = false;
let cloudflareHangs = false;
let asked = []; // searches
const mock = createServer((req, res) => {
  const url = new URL(req.url, "http://mock");
  const json = (status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  const search = url.searchParams.get("search");
  const named = (name) => search === null || name.toLowerCase().includes(search.toLowerCase());
  if (url.pathname.startsWith("/library/")) {
    if (search !== null) asked.push(`bunny ${search}`);
    if (bunnyDown) return json(500, {});
    const items = bunnyVideos.filter((v) => named(v.title));
    return json(200, { totalItems: items.length, items: Number(url.searchParams.get("page")) === 1 ? items : [] });
  }
  if (url.pathname.startsWith("/accounts/")) {
    if (search !== null) asked.push(`cloudflare ${search}`);
    if (cloudflareHangs && search !== null) return undefined;
    return json(200, { result: cloudflareVideos.filter((v) => named(v.meta.name)) });
  }
  const found = tmdb(url.pathname.replace(/^\/3/, ""));
  return found ? json(200, found) : json(404, {});
}).listen(MOCK_PORT);

// --- data and server ------------------------------------------------------------------------------
const mongo = await new MongoClient(envValue("MONGODB_URI")).connect();
const db = mongo.db(DB_NAME);
await db.dropDatabase();
const now = new Date();
const artwork = (tmdbType, tmdbId, title) => ({
  source: "link", tmdbType, tmdbId, title, year: 1999, overview: null, backdropPath: null, posterPath: null, matchedAt: now, tagline: null,
  runtimeMinutes: 100, genres: ["Action"], certificate: null, rating: null, logoPath: null, seasonCount: null, episodeCount: null, cast: [],
});
const video = (id, parentFolderId, title, extra = {}) => ({
  _id: id, parentFolderId, driveName: `${title}.mp4`, mimeType: "video/mp4", sizeBytes: 1, durationSeconds: 60,
  status: "published", title, subtitleSetIds: [], introStart: null, introEnd: null, outroStart: null,
  episodeOrder: null, titleOverridden: true, introOverridden: false, renditions: {}, createdAt: now, curatedAt: now,
  curatedBy: "smoke", updatedAt: now, artworkAutoOff: true, ...extra,
});
await db.collection("catalogFolders").insertOne({
  _id: "show", parentFolderId: ROOT, driveName: "The Show", status: "published", title: "The Show", thumbnailFileId: null,
  artwork: artwork("tv", "1396", "The Show"), episodeArtworkOff: true, createdAt: now, curatedAt: now, curatedBy: "smoke", updatedAt: now,
});
await db.collection("catalogVideos").insertMany([
  video("lib", ROOT, "Library Film", { artwork: artwork("movie", "800", "Library Film") }),
  video("draft", ROOT, "Draft Film", { status: "curated", artwork: artwork("movie", "701", "Draft Film") }),
  video("home", ROOT, "Home video"),
  video("clip", "show", "Loose clip in a series"),
  video("afilm", ROOT, "Anime Film", { artwork: artwork("movie", "129", "Anime Film") }),
  video("toys", ROOT, "Toys", { artwork: artwork("movie", "862", "Toys") }),
  video("tokyo", ROOT, "Tokyo", { artwork: artwork("movie", "990", "Tokyo") }),
  video("aep", "show", "Anime E1", {
    episodeArtwork: { seriesTmdbId: "1429", season: 1, episode: 1, name: "E1", overview: null, stillPath: null, airDate: null, runtimeMinutes: null, rating: null, matchedAt: now },
  }),
  video("ep1", "show", "E1", {
    episodeOrder: 1,
    episodeArtwork: { seriesTmdbId: "1396", season: 1, episode: 1, name: "E1", overview: null, stillPath: null, airDate: null, runtimeMinutes: null, rating: null, matchedAt: now },
  }),
]);

const artworkDir = mkdtempSync(join(tmpdir(), "campfire-play-artwork-"));
const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: join(import.meta.dirname, ".."),
  env: {
    ...process.env, PORT: String(PORT), MONGODB_DB_NAME: DB_NAME, ARTWORK_DIR: artworkDir, TRICKPLAY: "off",
    TMDB_API_KEY: "mock", TMDB_API_BASE: `http://127.0.0.1:${MOCK_PORT}/3`,
    BUNNY_API_BASE: `http://127.0.0.1:${MOCK_PORT}`, CLOUDFLARE_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
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
  mock.closeAllConnections();
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
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* an image */
  }
  return { status: res.status, body: parsed };
}

try {
  for (let i = 0; i < 180; i++) {
    if ((await fetch(`${BASE}/api/health/db`).catch(() => null))?.ok) break;
    await sleep(500);
  }
  const admin = (
    await api("/auth/login", { method: "POST", body: { email: envValue("ADMIN_EMAIL"), password: envValue("ADMIN_PASSWORD") } })
  ).body.token;
  const signUp = async (name) =>
    (await api("/auth/signup", { method: "POST", body: { email: `${name}@smoke.test`, password: "smoke-pass-1", name } })).body.token;
  const viewer = await signUp("viewer");
  const addSource = async (body) => (await api("/api/admin/sources", { token: admin, method: "POST", body })).body.id;
  const cfId = await addSource({ kind: "cloudflare", name: "Cloudflare", config: { accountId: ACCOUNT }, apiKey: "cf" });
  const bunnyId = await addSource({ kind: "bunny", name: "Bunny", config: { libraryId: "759", cdnHostname: "vz-63dcc9a5-af6.b-cdn.net" }, apiKey: "key" });
  check("the order: Cloudflare, Bunny, Drive", (await api("/api/admin/sources", { token: admin })).body.sources.map((s) => s.name).join() === "Cloudflare,Bunny,Drive");

  const V = (id, token = viewer, all = true) => api(`/api/video/${encodeURIComponent(id)}${all ? "?all=1" : ""}`, { token });
  const names = (r) => r.body.players?.map((p) => p.name).join();
  const stream = (source, id, token = viewer) => api(`/api/source-stream/${source}/${encodeURIComponent(id)}`, { token });
  const play = async (path, token = viewer) => api(`/api/title/${path}`, { token });
  const save = (fileId, positionSeconds, parentFolderId = "tmdb") =>
    api("/api/progress", { token: viewer, method: "POST", body: { fileId, parentFolderId, positionSeconds, durationSeconds: 100 } });
  const carryOn = async (query = "?titles=1") => (await api(`/api/library${query}`, { token: viewer })).body.continueWatching.map((c) => c.item);

  // --- where Play goes ---
  check("signed-in only", (await api("/api/title/movie/603/play")).status === 401);
  check("a film the library hasn't", (await play("movie/603/play")).body.href === "/watch/tmdb:movie:603");
  check("one it has plays as its own", (await play("movie/800/play")).body.href === "/watch/lib");
  check("a series starts at the beginning, in the library if it's there", (await play("tv/1396/play")).body.href === "/watch/ep1");
  check("an episode by its number", (await play("tv/1396/play?season=1&episode=2")).body.href === "/watch/tmdb:tv:1396:s1e2");
  check("not a title TMDb doesn't have", (await play("movie/99999/play")).status === 404);
  for (const bad of ["book/1/play", "movie/abc/play"]) check(`refuses ${bad}`, (await play(bad)).status === 404);
  check("season and episode go together", (await play("tv/1396/play?season=1")).status === 400);
  for (const bad of ["tmdb:movie:0", "tmdb:movie:abc", "tmdb:tv:1396", "tmdb:tv:1396:s1e99", "tmdb:movie:99999"]) check(`nothing at ${bad}`, (await V(bad)).status === 404);

  // --- the sources to pick from ---
  const viewerSources = async () => (await api("/api/sources", { token: viewer })).body.sources;
  check("exactly the admin's, in order", (await viewerSources()).map((x) => `${x.name}:${x.id}`).join() === `Cloudflare:${cfId},Bunny:${bunnyId},Drive:drive`);
  check("with nothing about them a viewer shouldn't see", (await viewerSources()).every((x) => Object.keys(x).join() === "id,name"));
  check("signed-in only", (await api("/api/sources")).status === 401);
  const order = (ids) => api("/api/admin/sources/order", { token: admin, method: "PUT", body: { ids } });
  await order([bunnyId, cfId]);
  check("as the admin orders them", (await viewerSources()).map((x) => x.name).join() === "Bunny,Cloudflare,Drive");
  await order([cfId, bunnyId]);
  await api(`/api/admin/sources/${cfId}`, { token: admin, method: "PATCH", body: { enabled: false } });
  check("not one that's off", (await viewerSources()).map((x) => x.name).join() === "Bunny,Drive");
  await api(`/api/admin/sources/${cfId}`, { token: admin, method: "PATCH", body: { enabled: true } });

  // --- nothing is tried until it's picked ---
  asked = [];
  let r = await V("tmdb:movie:700");
  check("every source is on offer for any title", r.status === 200 && names(r) === "Cloudflare,Bunny" && r.body.sources.map((x) => x.name).join() === "Cloudflare,Bunny,Drive" && r.body.title === "Nowhere Film", r.body);
  check("and none has been asked", asked.length === 0, asked);
  check("one that hasn't got it says so when it's picked", (await stream(cfId, "tmdb:movie:700")).status === 404);
  check("and only that one was asked", asked.join() === "cloudflare 700", asked);
  check("Drive hasn't got what isn't in the library", !names(r).includes("Drive"));
  const ownId = await addSource({ kind: "frame", name: "Own", codes: { movie: "https://own.example/{{file_id}}" } });
  check("nor has a player of the library's own files", !names(await V("tmdb:movie:13")).includes("Own") && names(await V("home")).includes("Own"));
  await api(`/api/admin/sources/${ownId}`, { token: admin, method: "DELETE" });

  // --- a player with a code for each kind ---
  const code = (kind) => `https://own.example/${kind}/{{file_id}}`;
  const kindsId = await addSource({ kind: "frame", name: "Kinds", codes: { movie: code("movie"), tv: code("tv"), anime: code("anime") } });
  const goesTo = async (id) => (await V(id)).body.players.find((p) => p.id === kindsId)?.url.replace("https://own.example/", "");
  const each = async (ids) => (await Promise.all(ids.map(goesTo))).join();
  check("a film, an episode, and anime of both", (await each(["lib", "ep1", "afilm", "aep"])) === "movie/lib,tv/ep1,anime/afilm,anime/aep", await each(["lib", "ep1", "afilm", "aep"]));
  check("animation that isn't Japanese isn't anime, nor Japanese that isn't animation", (await each(["toys", "tokyo"])) === "movie/toys,movie/tokyo", await each(["toys", "tokyo"]));
  check("what TMDb doesn't know goes by where it is", (await each(["home", "clip"])) === "movie/home,tv/clip", await each(["home", "clip"]));
  const setCodes = (codes) => api(`/api/admin/sources/${kindsId}`, { token: admin, method: "PATCH", body: { codes } });
  await setCodes({ movie: code("movie"), tv: code("tv"), anime: "" });
  check("without a code of its own, anime is a film or a series", (await each(["afilm", "aep"])) === "movie/afilm,tv/aep", await each(["afilm", "aep"]));
  await setCodes({ anime: code("anime") });
  check("with only anime's, nothing else plays there", (await each(["lib", "ep1", "afilm"])) === ",,anime/afilm", await each(["lib", "ep1", "afilm"]));
  check("the details say it's anime", (await api("/api/explore/title/movie/129", { token: viewer })).body.title.anime === true && (await api("/api/explore/title/movie/862", { token: viewer })).body.title.anime === false);
  await api(`/api/admin/sources/${kindsId}`, { token: admin, method: "DELETE" });

  // --- one appears ---
  bunnyVideos = [bunny(BUNNY_VIDEO, "The Matrix tmdb-603"), bunny("00000000-0000-0000-0000-000000000001", "tmdb-6030 another")];
  const s = await stream(bunnyId, "tmdb:movie:603");
  check("a video added a moment ago is found when it's picked", s.status === 200 && s.body.url.endsWith(`/${BUNNY_VIDEO}/playlist.m3u8`), s);
  check("a title with a longer id isn't it", (await db.collection("sourceVideos").countDocuments({})) === 1);
  asked = [];
  await stream(bunnyId, "tmdb:movie:603");
  check("one known to have it isn't searched again", asked.length === 0, asked);
  check("another source still hasn't", (await stream(cfId, "tmdb:movie:603")).status === 404);
  cloudflareVideos = [cloudflare(CF_VIDEO, "tmdb-603")];
  await sleep(3500); // what it said a moment ago is done with
  check("until it has", (await stream(cfId, "tmdb:movie:603")).status === 200);
  r = await V("tmdb:movie:603");
  check("it has the title's facts", r.body.year === 1999 && r.body.genres[0] === "Action" && r.body.rating.average === 8 && r.body.cast[0].name === "Lead" && r.body.backHref === "/?title=movie-603", r.body);

  // --- the library's own ---
  bunnyVideos.push(bunny("00000000-0000-0000-0000-000000000002", "tmdb-800"));
  check("a library title has every source too", names(await V("lib")) === "Cloudflare,Bunny,Drive");
  asked = [];
  check("an app is only sent what's known to have it", names(await V("lib", viewer, false)) === "Drive" && asked.length === 0);
  check("a video TMDb doesn't know isn't searched for", (await stream(bunnyId, "home")).status === 404 && asked.length === 0, asked);
  check("by its title's id it says where it is", (await V("tmdb:movie:800")).body.movedTo === "/watch/lib");

  // --- hosts not answering ---
  bunnyDown = true;
  check("one that doesn't answer fails", (await stream(bunnyId, "tmdb:movie:702")).status === 502);
  bunnyDown = false;
  bunnyVideos.push(bunny("00000000-0000-0000-0000-000000000003", "tmdb-702"));
  asked = [];
  await stream(bunnyId, "tmdb:movie:702");
  check("its failure isn't remembered", asked.join() === "bunny 702" && (await db.collection("sourceVideos").countDocuments({ key: "movie:702" })) === 1, asked);
  cloudflareHangs = true;
  const t0 = Date.now();
  check("one that hangs is given up on", (await stream(cfId, "tmdb:movie:703")).status === 502 && Date.now() - t0 < 8000, Date.now() - t0);
  cloudflareHangs = false;

  // --- what isn't published ---
  bunnyVideos.push(bunny("00000000-0000-0000-0000-000000000004", "tmdb-701"));
  check("what the admin held back isn't reached by its title", (await V("tmdb:movie:701")).status === 404 && (await stream(bunnyId, "tmdb:movie:701")).status === 404);
  check("except by the admin", (await V("tmdb:movie:701", admin)).status === 200);
  check("nor a draft's own id", (await stream(bunnyId, "draft")).status === 404);

  // --- progress ---
  await save("tmdb:movie:603", 40);
  check("it resumes", (await V("tmdb:movie:603")).body.initialPositionSeconds === 40);
  let row = await carryOn();
  check("it's in Continue watching", row.length === 1 && row[0].id === "tmdb:movie:603" && row[0].name === "The Matrix", row);
  check("but not an app's, which can't play it", (await carryOn("")).length === 0);
  await api("/api/opinions/movie/603", { token: viewer, method: "PUT", body: { watched: true } });
  check("nor once it's marked watched", (await carryOn()).length === 0);
  await save("tmdb:movie:13", 99);
  check("finishing one counts as watched", (await api("/api/opinions", { token: viewer })).body.opinions.some((o) => o.type === "movie" && o.id === "13" && o.watched));
  await save("tmdb:movie:800", 33);
  check("where it was left carries over once the library has it", (await V("lib")).body.initialPositionSeconds === 33);

  row = await carryOn();
  check("and it's there once, as the library's", row.filter((i) => i.id === "lib").length === 1 && !row.some((i) => i.id === "tmdb:movie:800"), row);
  await save("lib", 34, ROOT);
  check("still once when played from there", (await carryOn()).filter((i) => i.name === "Library Film").length === 1);

  // --- a series ---
  const episodes = async (query = "") => (await play(`tv/1396/episodes${query}`)).body;
  let e = await episodes();
  check("its seasons, specials last", e.seasons.map((x) => x.number).join() === "1,2,0" && e.season === 1, e.seasons);
  check("its episodes", e.episodes.length === 2 && e.episodes[0].name === "S1 Episode 1" && e.episodes[0].stillUrl.endsWith("/w300/e1.jpg") && e.episodes[0].progress === null);
  check("it starts at the start", e.resume.season === 1 && e.resume.episode === 1 && e.resume.started === false);
  e = await episodes("?season=2");
  check("one not out yet says so", e.season === 2 && e.episodes[0].aired === true && e.episodes[1].aired === false);
  check("not a series TMDb doesn't have", (await play("tv/55/episodes")).status === 404);
  await save("ep1", 50, "show");
  e = await episodes();
  check("progress on the library's episode", e.resume.started && e.resume.episode === 1 && e.episodes[0].progress.positionSeconds === 50);
  await save("ep1", 99, "show");
  check("a finished one goes on to the next", (await play("tv/1396/play")).body.href === "/watch/tmdb:tv:1396:s1e2");
  await save("tmdb:tv:1396:s1e2", 99);
  check("and into the next season", (await play("tv/1396/play")).body.href === "/watch/tmdb:tv:1396:s2e1");
  check("opened on the season they're in", (await episodes()).season === 2);
  r = await V("tmdb:tv:1396:s1e2");
  check("an episode says what it is", r.body.title === "S1 Episode 2" && r.body.seriesTitle === "The Show" && r.body.episode.number === 2 && r.body.episode.season === 1, r.body);
  check("what's next crosses seasons", r.body.upNext.fileId === "tmdb:tv:1396:s2e1" && r.body.upNext.subtitle === "New season · S2 E1 · The Show" && r.body.previousFileId === "tmdb:tv:1396:s1e1", r.body.upNext);
  check("one that isn't out isn't next", (await V("tmdb:tv:1396:s2e1")).body.upNext === null);
  check("by its title's id the library's is where it is", (await V("tmdb:tv:1396:s1e1")).body.movedTo === "/watch/ep1");
  bunnyVideos.push(bunny("00000000-0000-0000-0000-000000000005", "The Show tmdb-1396-s1e2"), bunny("00000000-0000-0000-0000-000000000006", "The Show tmdb-1396-s2e1"));
  asked = [];
  await stream(bunnyId, "tmdb:tv:1396:s1e2");
  check("the right episode is found", asked.join() === "bunny 1396" && (await db.collection("sourceVideos").countDocuments({ key: "tv:1396:s1e2" })) === 1, asked);
  check("and not another", (await db.collection("sourceVideos").countDocuments({ key: "tv:1396:s2e1" })) === 0);
  await save("tmdb:tv:1396:s2e1", 10);
  row = await carryOn();
  check("an episode in Continue watching names its series", row.some((i) => i.name === "The Show · S2 E1"), row);

  if (HOLD) {
    bunnyVideos = [bunny(BUNNY_VIDEO, "tmdb-603"), bunny(BUNNY_VIDEO, "tmdb-1396-s1e2")];
    // Cloudflare's copy of this one is gone, so it has to come from Bunny.
    bunnyVideos.push(bunny(BUNNY_VIDEO, "tmdb-13"));
    cloudflareVideos.push({ ...cloudflare("7".repeat(32), "tmdb-13"), playback: { hls: CF_HLS.replace(CF_VIDEO, "7".repeat(32)) } });
    await db.collection("sourceVideos").deleteMany({});
    console.log(`HOLD ${JSON.stringify({ base: BASE, viewer, admin })}`);
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
