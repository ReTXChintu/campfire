// End-to-end check of video sources (lib/videoSources.ts, lib/videoHosts.ts, lib/frameSource.ts,
// routes/admin/sources.ts, routes/sourceStream.ts): Bunny's and Cloudflare's APIs are played by a local mock, while the
// streams are the two services' own public demo videos.
//
//   node apps/backend/scripts/smoke-sources.mjs [path/to/.env] [--hold]
//
// Uses made-up catalog docs in a throwaway database (`campfire_sources_smoke`, dropped at the end).
// Needs the backend .env (MONGODB_URI, admin login) and internet access. --hold keeps everything up
// after the checks, for looking at the web app, until Enter is pressed or stdin closes.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient } from "mongodb";

const HOLD = process.argv.includes("--hold");
const envPath = process.argv.slice(2).find((a) => !a.startsWith("--")) || join(import.meta.dirname, "..", ".env");
const envText = readFileSync(envPath, "utf-8");
const envValue = (name) => envText.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim().replace(/^"|"$/g, "");
const ROOT = envValue("DRIVE_ROOT_FOLDER_ID");
const DB_NAME = "campfire_sources_smoke";
const PORT = Number(process.env.SMOKE_PORT || 4131);
const MOCK_PORT = PORT + 1;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One of the backend's own modules. */
const require = createRequire(import.meta.url);
require("tsx/cjs");
const load = (path) => require(path);

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) pass++;
  else failures.push(`${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}

// --- the two services' APIs -----------------------------------------------------------------------
const BUNNY_VIDEO = "eb1c4f77-0cda-46be-b47d-1118ad7c2ffe";
const BUNNY_CDN = "vz-63dcc9a5-af6.b-cdn.net";
const CF_VIDEO = "6b9e68b07dfee8cc2d116e4c51d6a957";
const CF_HLS = `https://customer-f33zs165nr7gyfy4.cloudflarestream.com/${CF_VIDEO}/manifest/video.m3u8`;
const ACCOUNT = "a".repeat(32);
const API_KEY = "bunny-secret-key-123";
const CF_TOKEN = "cloudflare-secret-token-456";
const guid = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

let down = false;
const bunny = (guidValue, title, extra = {}) => ({
  guid: guidValue, title, status: 4, length: 634, height: 1080, availableResolutions: "360p,720p,1080p", captions: [], ...extra,
});
// 130 videos, so the list takes two pages.
let bunnyVideos = [
  bunny(BUNNY_VIDEO, "Night of the Living Dead {tmdb-10331}.mp4", { captions: [{ srclang: "en", label: "English" }] }),
  bunny(guid(1), "Pilot tmdb-1396-s1e1", { status: 3 }),
  bunny(guid(2), "holiday clip"),
  ...Array.from({ length: 127 }, (_, i) => bunny(guid(100 + i), `filler ${i}`)),
];
const cloudflare = (uid, name, extra = {}) => ({
  uid, meta: { name }, readyToStream: true, duration: 734, created: "2026-01-01T00:00:00Z", requireSignedURLs: false,
  playback: { hls: CF_HLS.replace(CF_VIDEO, uid) }, input: { height: 1080, width: 1920 }, ...extra,
});
let cloudflareVideos = [
  cloudflare(CF_VIDEO, "tmdbid=10331"),
  cloudflare("b".repeat(32), "Breaking Bad tmdb 1396 S01E01", { requireSignedURLs: true }),
  cloudflare("c".repeat(32), "tmdb-603", { playback: { hls: "https://evil.example/x/manifest/video.m3u8" } }),
];
let tokenCalls = 0;
let tokenBody = null;
const mock = createServer((req, res) => {
  const url = new URL(req.url, "http://mock");
  const json = (status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  if (down) return json(500, {});
  const library = url.pathname.match(/^\/library\/(\d+)\/videos$/);
  if (library) {
    if (req.headers.accesskey !== API_KEY) return json(401, {});
    if (library[1] !== "759") return json(404, {});
    const page = Number(url.searchParams.get("page"));
    const per = Number(url.searchParams.get("itemsPerPage"));
    return json(200, { totalItems: bunnyVideos.length, currentPage: page, itemsPerPage: per, items: bunnyVideos.slice((page - 1) * per, page * per) });
  }
  if (!url.pathname.startsWith(`/accounts/${ACCOUNT}/stream`)) return json(404, {});
  if (req.headers.authorization !== `Bearer ${CF_TOKEN}`) return json(403, {});
  if (url.pathname.endsWith("/token")) {
    tokenCalls++;
    let text = "";
    req.on("data", (d) => (text += d)).on("end", () => {
      tokenBody = JSON.parse(text);
      json(200, { result: { token: "signed.token-value_1" }, success: true });
    });
    return undefined;
  }
  return json(200, { result: cloudflareVideos, success: true });
}).listen(MOCK_PORT);

// --- data and server ------------------------------------------------------------------------------
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
const PILOT = { seriesTmdbId: "1396", season: 1, episode: 1, name: "Pilot", overview: null, stillPath: null, airDate: null, runtimeMinutes: null, rating: null, matchedAt: now };
await db.collection("catalogVideos").insertMany([
  video("film", ROOT, "Night of the Living Dead", { artwork: artwork("movie", "10331", "Night of the Living Dead") }),
  video("mkv", ROOT, "The Matrix", { artwork: artwork("movie", "603", "The Matrix"), mimeType: "video/x-matroska" }),
  video("home", ROOT, "Home video"),
  video("draft", ROOT, "Draft", { status: "curated", artwork: artwork("movie", "10331", "Night of the Living Dead") }),
  video("ep", "series", "Pilot", { episodeArtwork: PILOT }),
]);

const artworkDir = mkdtempSync(join(tmpdir(), "campfire-sources-artwork-"));
const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: join(import.meta.dirname, ".."),
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_DB_NAME: DB_NAME,
    ARTWORK_DIR: artworkDir,
    TRICKPLAY: "off",
    TMDB_API_BASE: "http://127.0.0.1:9/3",
    BUNNY_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
    CLOUDFLARE_API_BASE: `http://127.0.0.1:${MOCK_PORT}`,
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
  // A route that doesn't exist answers with a page.
  return { status: res.status, body: text && !text.startsWith("<") ? JSON.parse(text) : null, text };
}

try {
  for (let i = 0; i < 180; i++) {
    if ((await fetch(`${BASE}/api/health/db`).catch(() => null))?.ok) break;
    await sleep(500);
  }
  const admin = (
    await api("/auth/login", { method: "POST", body: { email: envValue("ADMIN_EMAIL"), password: envValue("ADMIN_PASSWORD") } })
  ).body.token;
  const viewer = (
    await api("/auth/signup", { method: "POST", body: { email: "viewer@smoke.test", password: "smoke-pass-1", name: "Viewer" } })
  ).body.token;
  const A = "/api/admin/sources";
  const asAdmin = (path, method, body) => api(`${A}${path}`, { token: admin, method, body });
  const players = async (id) => (await api(`/api/video/${id}`, { token: viewer })).body.players.map((p) => p.name).join();
  const stream = (source, id, token = viewer) => api(`/api/source-stream/${source}/${id}`, { token });
  const list = async () => (await asAdmin("", "GET")).body.sources;

  // --- nothing set up: exactly as before ---
  check("Drive alone to begin with", (await players("film")) === "Library");
  check("viewers can't see sources", (await api(A, { token: viewer })).status === 403);
  check("viewers can't add one", (await api(A, { token: viewer, method: "POST", body: {} })).status === 403);
  check("signed-in only", (await api("/api/source-stream/x/film")).status === 401);

  // --- adding, with the mistakes first ---
  const B = { kind: "bunny", name: "Bunny", config: { libraryId: "759", cdnHostname: `https://${BUNNY_CDN}/` }, apiKey: API_KEY };
  for (const [what, body] of [
    ["an unknown kind", { ...B, kind: "ftp" }],
    ["no name", { ...B, name: " " }],
    ["no key", { ...B, apiKey: "" }],
    ["a wrong key", { ...B, apiKey: "nope" }],
    ["a wrong library", { ...B, config: { ...B.config, libraryId: "1" } }],
    ["a library that isn't a number", { ...B, config: { ...B.config, libraryId: "759/../x" } }],
    ["a host that isn't Bunny's", { ...B, config: { ...B.config, cdnHostname: "evil.example" } }],
    ["a host that only ends like Bunny's", { ...B, config: { ...B.config, cdnHostname: "evil.example/.b-cdn.net" } }],
    ["a bad account", { kind: "cloudflare", name: "CF", config: { accountId: "../x" }, apiKey: CF_TOKEN }],
    ["a wrong token", { kind: "cloudflare", name: "CF", config: { accountId: ACCOUNT }, apiKey: "nope" }],
  ]) {
    const res = await asAdmin("", "POST", body);
    check(`refuses ${what}`, res.status === 400 && res.body.error, res);
  }
  check("nothing was saved by those", (await list()).length === 1);

  const bunnyId = (await asAdmin("", "POST", B)).body.id;
  const cfId = (await asAdmin("", "POST", { kind: "cloudflare", name: "Cloudflare", config: { accountId: ACCOUNT }, apiKey: CF_TOKEN })).body.id;
  let all = await list();
  check("new ones go before Drive", all.map((s) => s.id).join() === [bunnyId, cfId, "drive"].join(), all.map((s) => s.name));
  check("both pages were read", all[0].sync.videos === 130, all[0].sync);
  check("matches are counted", all[0].sync.matched === 2 && all[1].sync.matched === 3, all.map((s) => s.sync));
  check("every control is on", Object.values(all[0].features).length === 9 && Object.values(all[0].features).every(Boolean));

  // --- secrets ---
  const raw = JSON.stringify((await asAdmin("", "GET")).body);
  check("keys never come back", !raw.includes(API_KEY) && !raw.includes(CF_TOKEN));
  const stored = JSON.stringify(await db.collection("videoSources").find().toArray());
  check("keys aren't readable in the database", !stored.includes(API_KEY) && !stored.includes(CF_TOKEN));

  // --- what a title plays from ---
  check("a film plays from both, then Drive", (await players("film")) === "Bunny,Cloudflare,Library");
  check("one still encoding isn't offered; the other is", (await players("ep")) === "Cloudflare,Library");
  check("an address that isn't Cloudflare's is never used", (await players("mkv")) === "Library");
  check("an unmatched video only has Drive", (await players("home")) === "Library");
  const film = (await api("/api/video/film", { token: viewer })).body;
  check("a player says which controls it has", film.players[0].kind === "stream" && film.players[0].features.pip === true);
  check("apps still get embeds", Array.isArray(film.embeds) && film.embeds.length === 0);

  // --- streams ---
  const b = (await stream(bunnyId, "film")).body;
  check("Bunny's address", b.url === `https://${BUNNY_CDN}/${BUNNY_VIDEO}/playlist.m3u8`, b);
  check("Bunny's captions", b.captions[0]?.url === `https://${BUNNY_CDN}/${BUNNY_VIDEO}/captions/en.vtt`, b.captions);
  check("it really is a stream", (await (await fetch(b.url)).text()).startsWith("#EXTM3U"));
  const c = (await stream(cfId, "film")).body;
  check("Cloudflare's address", c.url === CF_HLS, c);
  check("it really is one too", (await (await fetch(c.url)).text()).startsWith("#EXTM3U"));
  check("a viewer can't reach an unpublished title", (await stream(bunnyId, "draft")).status === 404);
  check("the admin can", (await stream(bunnyId, "draft", admin)).status === 200);
  check("a title the source lacks is 404", (await stream(bunnyId, "home")).status === 404);
  check("an unknown source is 404", (await stream("nope", "film")).status === 404);
  check("Drive isn't a stream source", (await stream("drive", "film")).status === 404);

  // --- signed addresses ---
  // The video doesn't exist for real, so the mocked token's address is gone (404) or refused; what matters is the call.
  await stream(cfId, "ep");
  await stream(cfId, "ep");
  check("a signed video asks for a token once", tokenCalls === 1, tokenCalls);
  check("with a long expiry", tokenBody.exp > Date.now() / 1000 + 11 * 3600 && tokenBody.exp < Date.now() / 1000 + 13 * 3600, tokenBody);
  const wrongToken = await asAdmin(`/${bunnyId}`, "PATCH", { tokenKey: "SecurityKey" });
  check("a token key the CDN doesn't use is refused", wrongToken.status === 400 && /token authentication/.test(wrongToken.body.error), wrongToken);
  check("and changes nothing", (await list()).find((s) => s.id === bunnyId).hasTokenKey === false && (await stream(bunnyId, "film")).status === 200);
  const wrongHost = await asAdmin(`/${bunnyId}`, "PATCH", { config: { libraryId: "759", cdnHostname: "vz-00000000-000.b-cdn.net" } });
  check("so is a CDN hostname without the videos", wrongHost.status === 400, wrongHost);
  const { bunnySignedPrefix } = load("../src/lib/videoHosts.ts");
  // From Bunny's own test suite.
  check(
    "Bunny's published signature",
    bunnySignedPrefix("token-tester.b-cdn.net", "/abc", "SecurityKey", 1598024587) ===
      "https://token-tester.b-cdn.net/bcdn_token=HS256-uVZvT3SbEoVKYJyDJgbcsDmSFf73cv-uNUVaJiKWpbQ&token_path=%2Fabc&expires=1598024587",
  );
  // The test zone Bunny publishes, with a key that's valid there.
  const tester = async (key, expires) =>
    (await fetch(`${bunnySignedPrefix("token-tester.b-cdn.net", "/", key, expires)}/300kb.jpg`)).status;
  const soon = Math.floor(Date.now() / 1000) + 600;
  check("Bunny's servers accept it", (await tester("229248f0-f007-4bf9-ba1f-bbf1b4ad9d40", soon)) === 200, await tester("229248f0-f007-4bf9-ba1f-bbf1b4ad9d40", soon));
  check("but not with another key", (await tester("wrong", soon)) === 403);
  check("or once it has expired", (await tester("229248f0-f007-4bf9-ba1f-bbf1b4ad9d40", 1598024587)) === 403);

  // --- order, switching off, controls ---
  await asAdmin("/order", "PUT", { ids: ["drive", cfId] });
  check("order is kept, ones left out stay", (await players("film")) === "Library,Cloudflare,Bunny");
  await asAdmin("/order", "PUT", { ids: [cfId, bunnyId, "drive"] });
  check("and changed again", (await players("film")) === "Cloudflare,Bunny,Library");
  check("a bad order is refused", (await asAdmin("/order", "PUT", { ids: "x" })).status === 400);
  await asAdmin(`/${cfId}`, "PATCH", { enabled: false });
  check("a source that's off isn't offered", (await players("film")) === "Bunny,Library");
  check("nor streamed", (await stream(cfId, "film")).status === 404);
  await asAdmin(`/${cfId}`, "PATCH", { enabled: true });
  await asAdmin(`/${bunnyId}`, "PATCH", { features: { pip: false, bogus: true } });
  all = await list();
  const bunnyView = all.find((s) => s.id === bunnyId);
  check("a control can be switched off", bunnyView.features.pip === false && bunnyView.features.volume === true && !("bogus" in bunnyView.features));
  await asAdmin("/drive", "PATCH", { features: { quality: false }, enabled: false, name: "Hacked" });
  const drive = (await list()).find((s) => s.id === "drive");
  check("Drive's controls too, but not its name or being on", drive.features.quality === false && drive.name === "Drive" && drive.enabled);
  check("Drive can't be removed", (await asAdmin("/drive", "DELETE")).status === 404);

  // --- linking by hand, and syncing ---
  check("there's nothing to select", (await asAdmin(`/${bunnyId}/videos`, "GET")).status === 404 && (await asAdmin(`/${bunnyId}/videos/${guid(2)}`, "PUT", { fileId: "mkv" })).status === 404);
  check("one without a TMDb id in its name is never found", (await players("mkv")) === "Library");
  bunnyVideos = bunnyVideos.map((v) => (v.guid === guid(1) ? { ...v, status: 4 } : v)).filter((v) => v.guid !== guid(126));
  await asAdmin(`/${bunnyId}/sync`, "POST");
  all = await list();
  check("a sync finds changes", all.find((s) => s.id === bunnyId).sync.videos === 129, all.find((s) => s.id === bunnyId).sync);
  check("one that finished encoding is offered", (await players("ep")) === "Cloudflare,Bunny,Library");
  bunnyVideos = bunnyVideos.map((v) => (v.guid === guid(2) ? { ...v, title: "holiday clip tmdb-603" } : v));
  await asAdmin(`/${bunnyId}/sync`, "POST");
  check("until it's renamed with one", (await players("mkv")) === "Bunny,Library");
  bunnyVideos = bunnyVideos.map((v) => (v.guid === guid(2) ? { ...v, title: "holiday clip" } : v));
  down = true;
  await asAdmin(`/${bunnyId}/sync`, "POST");
  const failed = (await list()).find((s) => s.id === bunnyId);
  check("a failed sync says so and keeps the videos", failed.sync.error && failed.sync.videos === 129 && (await players("film")).includes("Bunny"), failed.sync);
  down = false;
  check("a wrong new key changes nothing", (await asAdmin(`/${bunnyId}`, "PATCH", { apiKey: "wrong" })).status === 400 && (await asAdmin(`/${bunnyId}/sync`, "POST")).status === 200 && (await list()).find((s) => s.id === bunnyId).sync.error === null);

  // --- a stream that's gone ---
  bunnyVideos = [bunny(guid(999), "tmdb-603"), ...bunnyVideos];
  await asAdmin(`/${bunnyId}/sync`, "POST");
  check("listed, so it's offered", (await players("mkv")) === "Bunny,Library");
  check("but the stream is gone, so the player is told", (await stream(bunnyId, "mkv")).status === 404);

  // --- names ---
  const { keyFromName } = load("../src/lib/videoSources.ts");
  for (const [name, want] of [
    ["tmdb-603", "movie:603"], ["The Matrix (1999) {tmdb-603}.mkv", "movie:603"], ["Weapons_tmdb-1078605.mp4", "movie:1078605"],
    ["[tmdbid=603] x", "movie:603"], ["TMDB 0603", "movie:603"], ["tmdb-1396-s1e2", "tv:1396:s1e2"],
    ["Breaking Bad {tmdb-1396} - S01E02 - Cat.mkv", "tv:1396:s1e2"], ["tmdb1396s01e02", "tv:1396:s1e2"],
    ["The Matrix 1999", null], ["tmdb", null], ["xtmdb-603", null], ["tmdb-12345678901", null],
  ]) check(`"${name}"`, keyFromName(name) === want, keyFromName(name));

  // --- any player, by its embed code ---
  const CODE = `<iframe
  src="https://player.example{{file_id}}"
  width="100%"
  height="100%"
  frameborder="0"
  style="border: 0; border-radius: 12px;"
  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
  allowfullscreen
  sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
></iframe>`;
  const read = (code) => asAdmin("/read-code", "POST", { code });
  const full = (await read(CODE)).body;
  check("everything in an embed code is recognized", JSON.stringify(full) === JSON.stringify({
    config: {
      template: "https://player.example/{{file_id}}", allow: "autoplay; fullscreen; encrypted-media; picture-in-picture",
      allowFullscreen: true, sandbox: "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms",
      referrerPolicy: "strict-origin-when-cross-origin", radius: 12, ratio: null,
    },
    siteName: "player.example", ignored: [],
  }), full);
  const T = async (src) => (await read(src)).body.config?.template;
  for (const [what, code, want] of [
    ["a bare address", "https://v.example/e/{{file_id}}?x=1", "https://v.example/e/{{file_id}}?x=1"],
    ["single quotes, inside other markup", "<div><iframe src='https://v.example/{{ file_id }}'></iframe></div>", "https://v.example/{{file_id}}"],
    ["no quotes, escaped braces", "<iframe src=https://v.example/%7B%7Bfile_id%7D%7D></iframe>", "https://v.example/{{file_id}}"],
    ["entities", '<iframe src="https://v.example/?a=1&amp;v={{file_id}}"></iframe>', "https://v.example/?a=1&v={{file_id}}"],
    ["no scheme", '<iframe src="//v.example/{{file_id}}"></iframe>', "https://v.example/{{file_id}}"],
    ["a server on the network", "http://10.0.0.5:8096/{{file_id}}", "http://10.0.0.5:8096/{{file_id}}"],
  ]) check(`reads ${what}`, (await T(code)) === want, await T(code));
  const risky = (await read('<iframe src="https://v.example/{{file_id}}" width="640" height="480" onload="x()" srcdoc="<b>" allow="camera; autoplay *" referrerpolicy="unsafe-url" sandbox="allow-scripts allow-top-navigation"></iframe>')).body;
  check(
    "leaves out what reaches beyond the frame, and says so",
    risky.config.allow === "autoplay" && risky.config.sandbox === "allow-scripts" && risky.config.ratio === 640 / 480 &&
      risky.config.referrerPolicy === "strict-origin-when-cross-origin" &&
      ["allow: camera", "sandbox: allow-top-navigation", "referrerpolicy: unsafe-url", "onload", "srcdoc"].every((i) => risky.ignored.includes(i)),
    risky,
  );
  check("a code without a sandbox gets one", (await read('<iframe src="https://v.example/{{file_id}}"></iframe>')).body.config.sandbox === "allow-scripts allow-same-origin allow-presentation");
  for (const [what, code] of [
    ["nothing", ""], ["no iframe", "<video src='https://v.example/{{file_id}}'>"], ["no src", "<iframe></iframe>"],
    ["no placeholder", "https://v.example/abc"], ["two placeholders", "https://v.example/{{file_id}}/{{b}}"],
    ["a placeholder that isn't the file", "https://v.example/{{media_id}}"],
    ["a script address", "javascript:alert('{{file_id}}')"], ["a data address", "data:text/html,{{file_id}}"],
    ["a host that's the placeholder", "https://{{file_id}}.example/"], ["half a host", "https://v.{{file_id}}/"],
    ["a host with the placeholder in it", "https://v{{file_id}}.example/"], ["a password", "https://a:b@v.example/{{file_id}}"], ["not an address", "{{file_id}}"],
    ["Campfire itself", `${process.env.SMOKE_FRONTEND ?? envValue("FRONTEND_URL")}/{{file_id}}`],
  ]) check(`refuses ${what}`, (await read(code)).status === 400, await read(code));
  check("viewers can't read codes", (await api(`${A}/read-code`, { token: viewer, method: "POST", body: { code: CODE } })).status === 403);
  check("a bad code adds nothing", (await asAdmin("", "POST", { kind: "frame", code: "x" })).status === 400);

  const frameId = (await asAdmin("", "POST", { kind: "frame", name: "", code: CODE })).body.id;
  let frameSource = (await list()).find((s) => s.id === frameId);
  check("it's named after its site", frameSource.name === "player.example" && frameSource.kind === "frame", frameSource);
  check("and goes before Drive", (await list()).at(-2).id === frameId && (await list()).at(-1).id === "drive");
  const framePlayer = async (id) => (await api(`/api/video/${id}`, { token: viewer })).body.players.find((p) => p.id === frameId);
  check(
    "every video is tried in it, with none listed",
    (await Promise.all(["film", "mkv", "home", "ep"].map(async (id) => (await framePlayer(id))?.url))).join() ===
      ["film", "mkv", "home", "ep"].map((id) => `https://player.example/${id}`).join(),
  );
  check("drawn as the code said", (await framePlayer("ep")).frame.radius === 12 && !("template" in (await framePlayer("ep")).frame), await framePlayer("ep"));
  check("it has no videos to add or take away", (await asAdmin(`/${frameId}/videos`, "POST", { lines: "x" })).status === 404 && (await asAdmin(`/${frameId}/missing`, "GET")).status === 404);
  check("apps aren't sent it", (await api("/api/video/home", { token: viewer })).body.embeds.length === 0);
  check("it has no stream of its own", (await stream(frameId, "home")).status === 404);
  check("nor a list to check", (await asAdmin(`/${frameId}/sync`, "POST")).status === 404);
  await asAdmin("/order", "PUT", { ids: [cfId, frameId, bunnyId, "drive"] });
  check("its place in the order is every video's", (await players("film")) === "Cloudflare,player.example,Bunny,Library" && (await players("home")) === "player.example,Library", await players("film"));
  await asAdmin("/order", "PUT", { ids: ["drive", frameId] });
  check("wherever that is", (await players("home")) === "Library,player.example", await players("home"));
  await asAdmin(`/${frameId}`, "PATCH", { code: "https://other.example/v/{{file_id}}" });
  check("changing the code moves every video", (await framePlayer("home"))?.url === "https://other.example/v/home");
  check("a bad code changes nothing", (await asAdmin(`/${frameId}`, "PATCH", { code: "nope" })).status === 400 && (await framePlayer("home"))?.url.startsWith("https://other.example/"));
  await asAdmin(`/${frameId}`, "PATCH", { enabled: false });
  check("switched off, it isn't offered", (await framePlayer("home")) === undefined);
  await asAdmin(`/${frameId}`, "PATCH", { enabled: true, name: "Other" });

  if (!HOLD) {
    await asAdmin(`/${frameId}`, "DELETE");
    check("removed, nothing plays from it", (await framePlayer("home")) === undefined);
  }

  if (HOLD) {
    bunnyVideos = [bunny(BUNNY_VIDEO, "tmdb-10331", { captions: [{ srclang: "en", label: "English" }] }), bunny(guid(2), "holiday clip"), bunny(guid(999), "tmdb-603")];
    cloudflareVideos = [cloudflare(CF_VIDEO, "tmdb-10331"), cloudflare(CF_VIDEO.replace(/^6/, "7"), "tmdb-1396-s1e1")];
    await asAdmin(`/${bunnyId}`, "PATCH", { features: { pip: true } });
    await asAdmin("/drive", "PATCH", { features: { quality: true } });
    await asAdmin(`/${bunnyId}/sync`, "POST");
    await asAdmin(`/${cfId}/sync`, "POST");
    await asAdmin("/order", "PUT", { ids: [bunnyId, cfId, "drive"] });
    console.log(`HOLD ${JSON.stringify({ base: BASE, admin, viewer, bunnyId, cfId, frameId })}`);
    process.stdin.resume();
    await new Promise((resolve) => process.stdin.once("data", resolve).once("end", resolve));
  }
  await asAdmin(`/${bunnyId}`, "DELETE");
  check("removing a source takes its videos too", (await db.collection("sourceVideos").countDocuments({ sourceId: bunnyId })) === 0 && !(await list()).some((s) => s.id === bunnyId));
} catch (error) {
  failures.push(`crashed: ${error instanceof Error ? error.stack : error}`);
  console.log(log.slice(-2500));
} finally {
  await cleanup();
}

console.log(`${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
