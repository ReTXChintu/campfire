// End-to-end check of audio/subtitle tracks (lib/mediaTracks.ts, routes/admin/tracks.ts and the
// viewer fields on /api/video and /api/folder) against real files on Drive.
//
//   node apps/backend/scripts/smoke-tracks.mjs [path/to/.env]
//
// Picks a real film and a real season (three episodes) from the .env's catalog — read only —
// and copies just those docs into a throwaway database (`campfire_tracks_smoke`, dropped at the
// end), plus the film again as a fourth "episode" so the season has one file that differs. A
// backend from this checkout then reads their tracks from Drive (ffprobe, a few seconds each).
// Needs the backend .env (MONGODB_URI, Drive service account, admin login) and ffprobe.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient } from "mongodb";

const envPath = process.argv[2] || join(import.meta.dirname, "..", ".env");
const envText = readFileSync(envPath, "utf-8");
const envValue = (name) => envText.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim().replace(/^"|"$/g, "");
const ROOT = envValue("DRIVE_ROOT_FOLDER_ID");
const SOURCE_DB = envValue("MONGODB_DB_NAME") || "stream";
const DB_NAME = "campfire_tracks_smoke";
const PORT = 4119;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) pass++;
  else failures.push(`${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

const mongo = await new MongoClient(envValue("MONGODB_URI")).connect();
const source = mongo.db(SOURCE_DB);
const db = mongo.db(DB_NAME);
await db.dropDatabase();

// --- pick real files (read only) ------------------------------------------------------------------
const mkv = { mimeType: "video/x-matroska", status: "published" };
const film = await source.collection("catalogVideos").findOne({ ...mkv, parentFolderId: ROOT });
const seasons = await source
  .collection("catalogVideos")
  .aggregate([{ $match: { ...mkv, parentFolderId: { $ne: ROOT } } }, { $group: { _id: "$parentFolderId", n: { $sum: 1 } } }, { $match: { n: { $gte: 3 } } }, { $sort: { n: -1, _id: 1 } }, { $limit: 1 }])
  .toArray();
if (!film || seasons.length === 0) {
  console.error("Need a published MKV film and a season with 3+ published MKV episodes in the catalog.");
  process.exit(1);
}
const seasonId = seasons[0]._id;
const episodes = await source.collection("catalogVideos").find({ ...mkv, parentFolderId: seasonId }).limit(3).toArray();
const seasonDoc = await source.collection("catalogFolders").findOne({ _id: seasonId });
// The source catalog may already have tracks read; the copy starts without, to be read here.
const strip = (doc) => {
  const rest = { ...doc };
  delete rest.tracks;
  delete rest.trackNaming;
  return rest;
};
let seriesDoc = null;
let seasonCopy = { ...strip(seasonDoc), status: "published" };
if (seasonDoc.parentFolderId === ROOT) {
  // The episodes sit straight in a series folder: invent a series above it so the season/series
  // layering is exercised either way.
  seriesDoc = { ...seasonCopy, _id: "smoke-series", parentFolderId: ROOT, title: "Smoke Series", driveName: "Smoke Series" };
  seasonCopy = { ...seasonCopy, parentFolderId: "smoke-series", title: "Season 1" };
} else {
  seriesDoc = { ...strip(await source.collection("catalogFolders").findOne({ _id: seasonDoc.parentFolderId })), status: "published" };
}
const odd = { ...strip(film), _id: `${film._id}`, parentFolderId: seasonId, title: "Odd episode", episodeOrder: 4 };
await db.collection("catalogFolders").insertMany([seriesDoc, seasonCopy]);
await db.collection("catalogVideos").insertMany([
  ...episodes.map((e, i) => ({ ...strip(e), episodeOrder: i + 1 })),
  odd,
]);

// --- start the backend --------------------------------------------------------------------------------
const artworkDir = mkdtempSync(join(tmpdir(), "campfire-tracks-artwork-"));
const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: join(import.meta.dirname, ".."),
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_DB_NAME: DB_NAME,
    ARTWORK_DIR: artworkDir,
    // No TMDb calls (and so no renames) on the copied docs.
    TMDB_API_BASE: "http://127.0.0.1:9/3",
    TRICKPLAY: "off",
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
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

try {
  for (let i = 0; i < 180 && !log.includes("listening"); i++) {
    if (child.exitCode !== null) throw new Error(`backend exited:\n${log}`);
    await sleep(1000);
  }
  if (!log.includes("listening")) throw new Error(`backend did not start:\n${log}`);

  const admin = (await api("/auth/login", { method: "POST", body: { email: envValue("ADMIN_EMAIL"), password: envValue("ADMIN_PASSWORD") } })).body.token;
  const viewerEmail = `tracks-smoke-${Date.now()}@example.com`;
  const viewer = (await api("/auth/signup", { method: "POST", body: { email: viewerEmail, password: "smoke-password-1", name: "Viewer" } })).body.token;
  check("signed in", admin && viewer);

  // --- the files get read in the background ------------------------------------------------------
  let folder;
  for (let i = 0; i < 90; i++) {
    folder = (await api(`/api/admin/catalog/tracks/folder/${seriesDoc._id}`, { token: admin })).body;
    if (folder.report && folder.report.unread.length === 0 && folder.reading === 0) break;
    await sleep(2000);
  }
  check("every file read", folder.report.unread.length === 0 && folder.report.failed.length === 0, folder.report);
  check("two layouts", folder.report.groups.length === 2, folder.report.groups.map((g) => g.videos.length));
  const usual = folder.report.groups[0];
  const other = folder.report.groups[1];
  check("usual is the three episodes", usual?.usual === true && usual.videos.length === 3, usual?.videos);
  check("the odd one is named", other?.videos.length === 1 && other.videos[0].id === odd._id, other?.videos);
  check("the difference is in words", other?.differences.some((d) => d.startsWith("Audio:")), other?.differences);
  check("usual layout offered for naming", folder.usual?.audio.length > 0 && folder.effective?.audio.length === folder.usual.audio.length);
  console.log(`  usual: ${folder.effective.audio.map((t) => t.label).join(", ")} | subs ${folder.effective.subtitles.map((t) => t.label).join(", ") || "-"}`);
  console.log(`  odd:   ${other?.differences.join(" · ")}`);

  const oddAdmin = (await api(`/api/admin/catalog/tracks/video/${odd._id}`, { token: admin })).body;
  check("video page says it differs", oddAdmin.differences?.length > 0 && oddAdmin.series?.id === seriesDoc._id, oddAdmin.differences);
  const epAdmin = (await api(`/api/admin/catalog/tracks/video/${episodes[0]._id}`, { token: admin })).body;
  check("usual episode doesn't differ", Array.isArray(epAdmin.differences) && epAdmin.differences.length === 0, epAdmin.differences);

  // --- naming on the series, a season override, a video override ---------------------------------
  const audioCount = folder.usual.audio.length;
  const lastAudio = audioCount; // e.g. Japanese on an anime
  const bad = await api(`/api/admin/catalog/tracks/folder/${seriesDoc._id}`, { token: admin, method: "PUT", body: { audio: { 1: { language: "klingon" } } } });
  check("bad language refused", bad.status === 400, bad.body);
  const viewerTry = await api(`/api/admin/catalog/tracks/folder/${seriesDoc._id}`, { token: viewer, method: "PUT", body: {} });
  check("viewer can't name tracks", viewerTry.status === 403 || viewerTry.status === 401, viewerTry.status);
  const named = await api(`/api/admin/catalog/tracks/folder/${seriesDoc._id}`, {
    token: admin,
    method: "PUT",
    body: { audio: { 1: { label: "Series name one" } }, defaultAudio: lastAudio, defaultSubtitle: 0 },
  });
  check("series naming saved", named.status === 200 && named.body.effective.audio[0].label === "Series name one", named.body);
  // The season gives track 1 a language; the series' name for it must survive (merged per field).
  const seasonNamed = await api(`/api/admin/catalog/tracks/folder/${seasonId}`, { token: admin, method: "PUT", body: { audio: { 1: { language: "ko" } } } });
  check("season inherits the series", seasonNamed.body.inherited?.defaultAudio === lastAudio && seasonNamed.body.effective.audio[0].label === "Series name one", seasonNamed.body.effective?.audio[0]);
  check("season adds its own", seasonNamed.body.effective.audio[0].language === "kor", seasonNamed.body.effective?.audio[0]);
  await api(`/api/admin/catalog/tracks/video/${episodes[1]._id}`, { token: admin, method: "PUT", body: { audio: { 1: { label: "Just this one" } } } });

  // --- the viewer side ---------------------------------------------------------------------------
  let v0 = (await api(`/api/video/${episodes[0]._id}`, { token: viewer })).body;
  check("viewer gets named tracks", v0.audioTracks?.[0]?.label === "Series name one" && v0.audioTracks[0].language === "kor", v0.audioTracks);
  if (audioCount < 2) console.log("  note: this season has one audio track, so the default/series-pick checks below can't tell tracks apart");
  check("admin default applies", v0.startAudio === lastAudio && v0.startSubtitle?.source === "off", [v0.startAudio, v0.startSubtitle]);
  const v1 = (await api(`/api/video/${episodes[1]._id}`, { token: viewer })).body;
  check("video override wins", v1.audioTracks?.[0]?.label === "Just this one", v1.audioTracks?.[0]);
  check("old fields still there", "initialAudioLanguage" in v0 && "subtitles" in v0 && "seekMode" in v0);

  // Profile languages beat the admin default.
  const firstLang = v0.audioTracks[0].language;
  const badPrefs = await api("/auth/me/languages", { token: viewer, method: "PUT", body: { languages: { audio: ["xx1"], subtitles: null, subtitleMode: "off" } } });
  check("bad prefs refused", badPrefs.status === 400, badPrefs.body);
  const prefs = await api("/auth/me/languages", { token: viewer, method: "PUT", body: { languages: { audio: [firstLang], subtitles: "en", subtitleMode: "foreign" } } });
  check("prefs saved", prefs.status === 200 && prefs.body.languages.audio[0] === firstLang, prefs.body);
  check("prefs on /me", (await api("/auth/me", { token: viewer })).body.languages?.subtitleMode === "foreign");
  v0 = (await api(`/api/video/${episodes[0]._id}`, { token: viewer })).body;
  check("profile beats admin default", v0.startAudio === 1, v0.startAudio);
  check("understood audio: subtitles off", v0.startSubtitle?.source === "off", v0.startSubtitle);

  // A pick on one episode follows to the next.
  const lastTrack = v0.audioTracks[lastAudio - 1];
  await api("/api/progress", {
    token: viewer,
    method: "POST",
    body: { fileId: episodes[0]._id, parentFolderId: seasonId, positionSeconds: 30, durationSeconds: 1400, audioLanguage: lastTrack.language, audioTitle: "anything" },
  });
  const v2 = (await api(`/api/video/${episodes[2]._id}`, { token: viewer })).body;
  check("series pick beats profile", v2.startAudio === lastAudio, v2.startAudio);
  const embeddedSave = await api("/api/progress", {
    token: viewer,
    method: "POST",
    body: { fileId: episodes[2]._id, parentFolderId: seasonId, positionSeconds: 30, durationSeconds: 1400, subtitleSource: "embedded", subtitleLanguage: "eng", subtitleTitle: null, subtitleIndex: null },
  });
  check("embedded subtitle pick accepted", embeddedSave.status === 200, embeddedSave.body);

  // --- details pages ----------------------------------------------------------------------------
  const page = (await api(`/api/folder/${seriesDoc._id}`, { token: viewer })).body;
  check("series lists its languages", page.languages?.audio.length > 0, page.languages);
  check("a language only the odd file has is partial", page.languages?.audio.some((l) => l.partial), page.languages?.audio);
  console.log(`  series: audio ${page.languages.audio.map((l) => `${l.name}${l.partial ? "*" : ""}`).join(", ")} | subs ${page.languages.subtitles.map((l) => `${l.name}${l.partial ? "*" : ""}`).join(", ") || "-"}`);
  const oddView = (await api(`/api/video/${odd._id}`, { token: viewer })).body;
  check("a file lists its own languages", oddView.languages?.audio.every((l) => !l.partial), oddView.languages);
  // Names, language overrides and the default were set on the usual layout: a file laid out
  // differently keeps its own.
  check("odd file keeps its own names", oddView.audioTracks?.[0]?.label !== "Series name one" && oddView.audioTracks?.[0]?.language !== "kor", oddView.audioTracks?.[0]);
  check("odd file ignores a default meant for another track", oddView.startAudio === null, oddView.startAudio);
  const options = (await api("/api/languages", { token: viewer })).body.languages;
  check("language options include the library's", options.some((o) => o.inLibrary) && options.some((o) => o.code === "eng"));

  // Re-reading one file answers with it.
  const reread = await api(`/api/admin/catalog/tracks/video/${episodes[0]._id}/read`, { token: admin, method: "POST" });
  check("re-read now", reread.status === 200 && reread.body.tracks?.error === null, reread.body.tracks);
} catch (error) {
  failures.push(`crashed: ${error instanceof Error ? error.stack : error}`);
} finally {
  await cleanup();
}

console.log(`${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
