// End-to-end check of embedded players, TMDb identity and trailers (lib/embed.ts, lib/tmdbRef.ts,
// lib/trailer.ts) against the real providers and TMDb.
//
//   node apps/backend/scripts/smoke-embeds.mjs [path/to/.env] [--hold]
//
// Uses made-up catalog docs in a throwaway database (`campfire_embeds_smoke`, dropped at the end).
// Needs the backend .env (MONGODB_URI, admin login, TMDB_API_KEY) and internet access. The player
// addresses are each provider's own public demo videos. --hold keeps the server and the data up
// after the checks, for looking at the web app, until Enter is pressed or stdin closes.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient } from "mongodb";

const HOLD = process.argv.includes("--hold");
const envPath = process.argv.slice(2).find((a) => !a.startsWith("--")) || join(import.meta.dirname, "..", ".env");
const envText = readFileSync(envPath, "utf-8");
const envValue = (name) => envText.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim().replace(/^"|"$/g, "");
const ROOT = envValue("DRIVE_ROOT_FOLDER_ID");
const DB_NAME = "campfire_embeds_smoke";
const PORT = Number(process.env.SMOKE_PORT || 4121);
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) pass++;
  else failures.push(`${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

const mongo = await new MongoClient(envValue("MONGODB_URI")).connect();
const db = mongo.db(DB_NAME);
await db.dropDatabase();

const now = new Date();
const artwork = (tmdbType, tmdbId, title) => ({
  source: "link", tmdbType, tmdbId, title, year: 1968, overview: null, backdropPath: null, posterPath: null,
  matchedAt: now, tagline: null, runtimeMinutes: null, genres: [], certificate: null, rating: null, logoPath: null,
  seasonCount: null, episodeCount: null, cast: [],
});
const video = (id, parentFolderId, title, extra = {}) => ({
  _id: id, parentFolderId, driveName: `${title}.mp4`, mimeType: "video/mp4", sizeBytes: 1, durationSeconds: 60,
  status: "published", title, subtitleSetIds: [], introStart: null, introEnd: null, outroStart: null,
  episodeOrder: null, titleOverridden: true, introOverridden: false, renditions: {}, createdAt: now, curatedAt: now,
  curatedBy: "smoke", updatedAt: now, artworkAutoOff: true, ...extra,
});
await db.collection("catalogFolders").insertOne({
  _id: "series", parentFolderId: ROOT, driveName: "Breaking Bad", status: "published", title: "Breaking Bad",
  thumbnailFileId: null, artwork: artwork("tv", "1396", "Breaking Bad"), episodeArtworkOff: true, createdAt: now,
  curatedAt: now, curatedBy: "smoke", updatedAt: now,
});
const FILM = { artwork: artwork("movie", "10331", "Night of the Living Dead") };
await db.collection("catalogVideos").insertMany([
  video("film", ROOT, "Night of the Living Dead", FILM),
  video("home", ROOT, "Home video"),
  video("ep", "series", "Pilot", {
    episodeArtwork: {
      seriesTmdbId: "1396", season: 1, episode: 1, name: "Pilot", overview: null, stillPath: null, airDate: null,
      runtimeMinutes: null, rating: null, matchedAt: now,
    },
  }),
]);

const artworkDir = mkdtempSync(join(tmpdir(), "campfire-embeds-artwork-"));
const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: join(import.meta.dirname, ".."),
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_DB_NAME: DB_NAME,
    ARTWORK_DIR: artworkDir,
    TRICKPLAY: "off",
    ...(process.env.SMOKE_FRONTEND ? { FRONTEND_URL: process.env.SMOKE_FRONTEND } : {}),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));

async function cleanup() {
  child.kill();
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

const YT = "https://www.youtube-nocookie.com/embed/M7lc1UVf-VE";
const GOOD = {
  youtube: YT,
  vimeo: "https://player.vimeo.com/video/76979871",
  bunny: "https://iframe.mediadelivery.net/embed/759/eb1c4f77-0cda-46be-b47d-1118ad7c2ffe",
  cloudflare: "https://customer-f33zs165nr7gyfy4.cloudflarestream.com/6b9e68b07dfee8cc2d116e4c51d6a957/iframe",
  archive: "https://archive.org/embed/BigBuckBunny_124",
};
const DEAD = [
  "https://www.youtube-nocookie.com/embed/zzzzzzzzzzz",
  "https://player.vimeo.com/video/1",
  "https://iframe.mediadelivery.net/embed/759/00000000-0000-0000-0000-000000000000",
  "https://customer-f33zs165nr7gyfy4.cloudflarestream.com/00000000000000000000000000000000/iframe",
  "https://archive.org/embed/zzzznotreal12345xyz",
];

let failed = false;
try {
  for (let i = 0; i < 60; i++) {
    if ((await fetch(`${BASE}/api/health/db`).catch(() => null))?.ok) break;
    await sleep(500);
  }
  const admin = (
    await api("/auth/login", { method: "POST", body: { email: envValue("ADMIN_EMAIL"), password: envValue("ADMIN_PASSWORD") } })
  ).body.token;
  const viewer = (
    await api("/auth/signup", { method: "POST", body: { email: "viewer@smoke.test", password: "smoke-pass-1", name: "Viewer" } })
  ).body.token;
  check("signed in", admin && viewer);

  const put = (id, embeds, token = admin) =>
    api(`/api/admin/embeds/video/${id}`, { token, method: "PUT", body: { embeds } });
  const playable = async (id) => (await api(`/api/video/${id}`, { token: viewer })).body.embeds;

  // --- who may do it, and what is accepted ---
  check("a viewer can't save players", (await put("film", [], viewer)).status === 403);
  check("a viewer can't list them", (await api("/api/admin/embeds", { token: viewer })).status === 403);
  check("a film starts with none", (await playable("film")).length === 0);
  for (const bad of [
    "http://www.youtube.com/embed/M7lc1UVf-VE", "https://evil.example/embed/M7lc1UVf-VE",
    "https://www.youtube.com.evil.example/embed/M7lc1UVf-VE", "https://player.example/embed/movie/10331",
    "https://user@www.youtube.com/embed/M7lc1UVf-VE", "https://www.youtube.com:444/embed/M7lc1UVf-VE",
    "https://www.youtube.com/redirect?q=x", "javascript:alert(1)", "https://archive.org/embed/../stream/x", "", null, 5,
  ]) {
    const res = await put("film", [{ url: bad }]);
    check(`refuses ${bad}`, res.status === 400, res);
  }
  check("refuses six", (await put("film", Array(6).fill({ url: YT }))).status === 400);
  check("refuses the same player twice", (await put("film", [{ url: YT }, { url: "https://youtu.be/M7lc1UVf-VE" }])).status === 400);
  check("refuses a bad start time", (await put("film", [{ url: YT, startAt: "1:30" }])).status === 400);
  check("refuses a negative start time", (await put("film", [{ url: YT, startAt: -1 }])).status === 400);
  check("404 for an unknown video", (await put("nope", [{ url: YT }])).status === 404);

  // --- page links become player links ---
  for (const [page, player] of [
    ["https://www.youtube.com/watch?v=M7lc1UVf-VE&t=3", YT],
    ["https://youtu.be/M7lc1UVf-VE", YT],
    ["https://vimeo.com/76979871", GOOD.vimeo],
    ["https://archive.org/details/BigBuckBunny_124", GOOD.archive],
  ]) {
    const res = await put("film", [{ url: page }]);
    check(`${page} is turned into its player`, res.body.embeds?.[0]?.url === player, res.body);
  }

  // --- options, in each provider's own form ---
  const all = { startAt: 90, autoplay: true, muted: true, hideControls: true };
  const saved = (await put("film", Object.values(GOOD).map((url) => ({ url, ...all })))).body.embeds;
  const want = {
    youtube: "?start=90&autoplay=1&mute=1&controls=0",
    vimeo: "?autoplay=1&muted=1&controls=0#t=90s",
    bunny: "?t=90&autoplay=true&muted=true",
    cloudflare: "?startTime=90s&autoplay=true&muted=true&controls=false",
    archive: "?start=90&autoplay=1",
  };
  Object.keys(GOOD).forEach((name, i) => {
    check(`${name} options`, saved[i].playerUrl === GOOD[name] + want[name], saved[i].playerUrl);
    check(`${name} is available`, saved[i].available === true, saved[i]);
  });
  const list = await playable("film");
  check("viewers get all five in order", list.map((e) => e.provider).join() === "YouTube,Vimeo,Bunny Stream,Cloudflare Stream,Internet Archive", list);
  check("viewers get the address with options", list[0].url === saved[0].playerUrl);

  // --- dead and switched-off players are skipped ---
  const dead = (await put("film", DEAD.map((url) => ({ url })))).body.embeds;
  dead.forEach((e) => check(`${e.provider}: a missing video is noticed`, e.available === false, e));
  check("no live player leaves the library's file", (await playable("film")).length === 0);
  await put("film", [{ url: DEAD[0] }, { url: GOOD.vimeo, enabled: false }, { url: GOOD.archive }]);
  check("only the live, enabled one is offered", (await playable("film")).map((e) => e.provider).join() === "Internet Archive");

  // --- TMDb id is the identity ---
  const film = (await api("/api/video/film", { token: viewer })).body;
  check("a film says which title it is", film.tmdb?.type === "movie" && film.tmdb?.id === "10331", film.tmdb);
  const ep = (await api("/api/video/ep", { token: viewer })).body;
  check("an episode too", ep.tmdb?.id === "1396" && ep.tmdb?.season === 1 && ep.tmdb?.episode === 1, ep.tmdb);
  check("an unmatched video has none", (await api("/api/video/home", { token: viewer })).body.tmdb === null);
  const library = (await api("/api/library", { token: viewer })).body;
  check("library cards carry it", library.videos.find((v) => v.id === "film")?.tmdb?.id === "10331");
  check("a series page carries it", (await api("/api/folder/series", { token: viewer })).body.tmdb?.id === "1396");
  const find = (path) => api(`/api/title/${path}`, { token: viewer });
  check("a film is found by its id", (await find("movie/10331")).body.id === "film");
  check("a series is found by its id", (await find("tv/1396")).body.id === "series");
  check("an episode is found by its number", (await find("tv/1396?season=1&episode=1")).body.id === "ep");
  check("one the library lacks is 404", (await find("tv/1396?season=1&episode=2")).status === 404);
  check("a film id isn't a series id", (await find("tv/10331")).status === 404);
  check("half an episode number is refused", (await find("tv/1396?season=1")).status === 400);
  check("a bad id is 404", (await find("movie/abc")).status === 404);
  check("signed-in only", (await api("/api/title/movie/10331")).status === 401);

  await put("ep", [{ url: GOOD.vimeo }]);
  await put("home", [{ url: GOOD.vimeo }]);
  const keys = (await db.collection("titleEmbeds").find().toArray()).map((d) => d._id).sort();
  check("stored by title, or by file when unmatched", keys.join() === "file:home,movie:10331,tv:1396:s1e1", keys);
  await db.collection("catalogVideos").insertOne(video("film-copy", ROOT, "Second copy", FILM));
  check("a replacement file has the same players", (await playable("film-copy")).length === 1);
  await db.collection("catalogVideos").updateOne({ _id: "home" }, { $set: { artwork: artwork("movie", "603", "The Matrix") } });
  check("players survive being matched later", (await playable("home")).length === 1);
  await put("home", [{ url: GOOD.vimeo }]);
  const moved = (await db.collection("titleEmbeds").find().toArray()).map((d) => d._id);
  check("and move to the title on the next save", moved.includes("movie:603") && !moved.includes("file:home"), moved);

  // --- admin page ---
  const page = (await api("/api/admin/embeds", { token: admin })).body;
  check("lists every title with players", page.titles.length === 3 && page.titles.every((t) => t.fileId), page.titles);
  check("search finds it", (await api("/api/admin/embeds/search?q=living", { token: admin })).body.videos[0]?.fileId === "film");
  await db.collection("titleEmbeds").insertOne({ _id: "movie:1", embeds: [{ url: YT, enabled: true }], updatedAt: now });
  check("one with no file left is marked", (await api("/api/admin/embeds", { token: admin })).body.titles.find((t) => t.key === "movie:1")?.fileId === null);
  check("and can be removed", (await api("/api/admin/embeds/movie%3A1", { token: admin, method: "DELETE" })).status === 200);
  await put("ep", []);
  check("saving none removes it", (await playable("ep")).length === 0);

  // --- a host no longer on the list, put straight into the database ---
  await db.collection("titleEmbeds").updateOne(
    { _id: "movie:603" },
    { $set: { embeds: [{ url: "https://evil.example/x", enabled: true, startAt: null, autoplay: false, muted: false, hideControls: false }] } },
  );
  check("an unlisted host never reaches a viewer", (await playable("home")).length === 0);
  check("and the admin page still loads", (await api("/api/admin/embeds", { token: admin })).status === 200);

  // --- the fallback: a file that's gone from Drive ---
  const media = (await api("/api/media-token?fileId=film", { token: viewer })).body.token;
  const stream = await fetch(`${BASE}/api/stream/film?token=${media}`).catch(() => null);
  check("a file missing from Drive is a 404", stream?.status === 404, stream?.status);
  check("and the server is still up", (await fetch(`${BASE}/api/health/db`).catch(() => null))?.ok === true);

  // --- trailers ---
  const trailer = (await find("tv/1396/trailer")).body.trailer;
  check("a trailer is found", /^[\w-]{11}$/.test(trailer?.youtubeId ?? ""), trailer);
  check("an unknown title has none", (await find("movie/999999999/trailer")).body.trailer === null);

  if (HOLD) {
    await put("film", [{ url: GOOD.youtube }, { url: GOOD.archive, startAt: 30 }]);
    await put("ep", [{ url: GOOD.vimeo }]);
    console.log(`HOLD ${JSON.stringify({ base: BASE, admin, viewer })}`);
    process.stdin.resume();
    await new Promise((resolve) => process.stdin.once("data", resolve).once("end", resolve));
  }
} catch (error) {
  failed = true;
  failures.push(`crashed: ${error instanceof Error ? error.stack : error}`);
} finally {
  await cleanup();
}

console.log(`${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failed) console.log(log.slice(-2000));
process.exit(failures.length ? 1 : 0);
