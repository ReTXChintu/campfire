// Smoke test for catalog artwork (src/lib/artwork.ts), self-contained:
//
//   npx tsx scripts/smoke-artwork.mjs [path/to/.env]
//
// 1. Checks the release-name parser and the match picker against real filenames from the library.
// 2. Seeds a throwaway database (`campfire_artwork_smoke`, dropped again at the end), starts a mock
//    TMDb (API + image CDN) and the real backend pointed at both, then drives it over HTTP: the
//    startup auto-match, the image routes and their disk cache, the listing marker older apps rely
//    on, pasted links, removal, admin-only access, and the fallback when TMDb's CDN fails.
//
// Needs MONGODB_URI, DRIVE_ROOT_FOLDER_ID and the admin login from the backend .env; no Drive,
// TMDb or LiveKit credentials (nothing here reaches the real services).
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient } from "mongodb";
import { parseReleaseName, pickMatch } from "../src/lib/artwork.ts";

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. names ----------------------------------------------------------------------------------
console.log("\nRelease names");
const names = [
  // The library's own Drive names (and curated titles), as of this change.
  ["Flipped.2010.1080P.Bluray.English.Esub.MoviesMod.org.mkv", "Flipped", 2010],
  ["DC.2026.1080p.DS4K.WEB-DL.Hindi.LiNE-Tamil.5.1.x264.mkv", "DC", 2026],
  ["Love, Rosie (2014) {Hindi-English} 1080p BluRay ESub.mkv", "Love, Rosie", 2014],
  ["(FilmyFly.CA) Ramayana - Rise of a Legend (2026) Bollywood Hindi Movie HQCam 1080p.mkv", "Ramayana - Rise of a Legend", 2026],
  ["Gargi.2022.1080p.HD.mkv", "Gargi", 2022],
  ["Nayyi Navelli (2026) Bollywood Hindi Movie HQCam 1080p.mkv", "Nayyi Navelli", 2026],
  ["Weapons (2025) (Hindi DD5.1-224Kbps HQ   English DD5.1-192Kbps) Dual Audio Hollywood Movie HD 1080p ESub.mkv", "Weapons", 2025],
  ["House of The Dragon", "House of The Dragon", null],
  ["India's got Latent s2", "India's got Latent", null],
  ["Flipped (2010)", "Flipped", 2010],
  // Shapes that have to survive.
  ["[YTS] 1917 (2019) [1080p]", "1917", 2019],
  ["1917.2019.1080p.mkv", "1917", 2019],
  ["(500) Days of Summer (2009)", "500 Days of Summer", 2009],
  ["Blade.Runner.2049.2017.2160p.UHD.mkv", "Blade Runner 2049", 2017],
  ["Charlotte's Web (2006).mp4", "Charlotte's Web", 2006],
  ["Johnny English", "Johnny English", null],
  ["Breaking Bad S01 Complete 720p", "Breaking Bad", null],
  ["www.TamilBlasters.xyz - Vikram (2022) Tamil HQ HDRip.mkv", "Vikram", 2022],
];
for (const [raw, query, year] of names) {
  const got = parseReleaseName(raw);
  check(`"${raw.slice(0, 60)}" → "${query}"${year ? ` ${year}` : ""}`, got.query === query && got.year === year, JSON.stringify(got));
}

console.log("\nMatch picking");
const weapons = { id: 1, title: "Weapons", release_date: "2025-08-06", popularity: 80 };
const weaponsOld = { id: 2, title: "Weapons", release_date: "2007-03-01", popularity: 2 };
check("same name, picks the matching year", pickMatch([weaponsOld, weapons], "Weapons", 2025)?.id === 1);
check("same name, wrong year only → no match (remake)", pickMatch([{ id: 3, title: "Flipped", release_date: "1999-01-01" }], "Flipped", 2010) === null);
check("year off by one (festival release) is accepted", pickMatch([{ id: 4, title: "Gargi", release_date: "2022-07-15" }], "Gargi", 2023)?.id === 4);
check("similar but different name → no match", pickMatch([{ id: 5, title: "Weapons of Mass Destruction", release_date: "2025-01-01" }], "Weapons", 2025) === null);
check("leading article and punctuation ignored", pickMatch([{ id: 6, name: "The Office", first_air_date: "2005-03-24" }], "Office", null)?.id === 6);
check("original title counts", pickMatch([{ id: 7, title: "Spirited Away", original_title: "千と千尋の神隠し", release_date: "2001-07-20" }], "Spirited Away", 2001)?.id === 7);
check("no year, two equally known versions → no guess", pickMatch([{ id: 8, title: "Dune", popularity: 50 }, { id: 9, title: "Dune", popularity: 40 }], "Dune", null) === null);
check("no year, one clearly the famous one → it", pickMatch([{ id: 8, title: "Dune", popularity: 150 }, { id: 9, title: "Dune", popularity: 10 }], "Dune", null)?.id === 8);
check("no year, unique name → it", pickMatch([{ id: 10, name: "House of the Dragon", first_air_date: "2022-08-21" }], "House of The Dragon", null)?.id === 10);

// --- 2. end to end -----------------------------------------------------------------------------
const envText = readFileSync(process.argv[2] || join(import.meta.dirname, "..", ".env"), "utf-8");
const envValue = (name) => envText.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim().replace(/^"|"$/g, "");
const ROOT = envValue("DRIVE_ROOT_FOLDER_ID");
const DB_NAME = "campfire_artwork_smoke";
const PORT = 4113;
const MOCK_PORT = 4114;
const BASE = `http://127.0.0.1:${PORT}`;

// Mock TMDb. Image bytes are distinct per path so a test can tell which image it was served.
const imageHits = new Map();
const searchHits = new Map();
const jpeg = (label) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`fake-jpeg:${label}`)]);
const tmdb = {
  "search/tv": {
    "India's got Latent": [{ id: 101, name: "India's Got Latent", first_air_date: "2024-06-16", overview: "A comedy talent show.", backdrop_path: "/latentBackdrop.jpg", poster_path: "/latentPoster.jpg" }],
    "House of The Dragon": [{ id: 94997, name: "House of the Dragon", first_air_date: "2022-08-21", overview: "Targaryens.", backdrop_path: "/hotdBackdrop.jpg", poster_path: "/hotdPoster.jpg" }],
  },
  "search/movie": {
    Weapons: [
      { id: 2, title: "Weapons", release_date: "2007-03-01", backdrop_path: "/oldWeapons.jpg", popularity: 2 },
      { id: 1078605, title: "Weapons", release_date: "2025-08-06", overview: "Kids vanish.", backdrop_path: "/weaponsBackdrop.jpg", poster_path: "/weaponsPoster.jpg", popularity: 80 },
    ],
    Flipped: [{ id: 3, title: "Flipped", release_date: "1999-01-01", backdrop_path: "/wrongFlipped.jpg" }],
    Gargi: [{ id: 5, title: "Gargi", release_date: "2022-07-15", backdrop_path: "/brokenOnCdn.jpg" }],
  },
};
const mock = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const image = url.pathname.match(/^\/t\/p\/(w\d+)(\/[A-Za-z]+\.jpg)$/);
  if (image) {
    const key = `${image[1]}${image[2]}`;
    imageHits.set(key, (imageHits.get(key) ?? 0) + 1);
    if (image[2] === "/brokenOnCdn.jpg") return res.writeHead(500).end();
    return res.writeHead(200, { "content-type": "image/jpeg" }).end(jpeg(key));
  }
  if (url.searchParams.get("api_key") !== "smoke-key") return res.writeHead(401).end("{}");
  const json = (body) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  const search = url.pathname.match(/^\/3\/(search\/(?:tv|movie))$/);
  if (search) {
    const query = url.searchParams.get("query");
    searchHits.set(`${search[1]}:${query}`, (searchHits.get(`${search[1]}:${query}`) ?? 0) + 1);
    return json({ results: tmdb[search[1]][query] ?? [] });
  }
  if (url.pathname === "/3/find/tt0817177") {
    return json({ movie_results: [{ id: 43949, title: "Flipped", release_date: "2010-08-06", overview: "First love.", backdrop_path: "/flippedBackdrop.jpg", poster_path: "/flippedPoster.jpg" }], tv_results: [] });
  }
  if (url.pathname === "/3/tv/94997") {
    return json({ id: 94997, name: "House of the Dragon", first_air_date: "2022-08-21", overview: "Targaryens.", backdrop_path: "/hotdLinkBackdrop.jpg" });
  }
  if (url.pathname.startsWith("/3/find/") || url.pathname.match(/^\/3\/(movie|tv)\//)) {
    return res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ status_code: 34 }));
  }
  res.writeHead(404).end();
});
await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));

// Seed.
const mongo = new MongoClient(envValue("MONGODB_URI"));
await mongo.connect();
const db = mongo.db(DB_NAME);
await db.dropDatabase();
const now = new Date();
const folder = (id, parentFolderId, name, thumbnailFileId = null) => ({
  _id: id, parentFolderId, driveName: name, status: "published", title: name, thumbnailFileId,
  publishRule: null, createdAt: now, curatedAt: now, curatedBy: "smoke", updatedAt: now,
});
const video = (id, parentFolderId, driveName, title) => ({
  _id: id, parentFolderId, driveName, mimeType: "video/x-matroska", sizeBytes: 1, durationSeconds: 6000,
  status: "published", title, subtitleSetIds: [], introStart: null, introEnd: null, outroStart: null,
  episodeOrder: null, titleOverridden: true, introOverridden: false, renditions: {},
  createdAt: now, curatedAt: now, curatedBy: "smoke", updatedAt: now,
});
await db.collection("catalogFolders").insertMany([
  folder("f-latent", ROOT, "India's got Latent s2"),
  folder("f-hotd", ROOT, "House of The Dragon", "drive-thumb-hotd"),
  folder("f-unknown", ROOT, "Zzqx Unheard Of Show"),
  folder("f-hotd-s1", "f-hotd", "Season 1"),
]);
const weaponsName = "Weapons (2025) (Hindi DD5.1-224Kbps HQ   English DD5.1-192Kbps) Dual Audio Hollywood Movie HD 1080p ESub.mkv";
await db.collection("catalogVideos").insertMany([
  video("v-weapons", ROOT, weaponsName, weaponsName),
  video("v-flipped", ROOT, "Flipped.2010.1080P.Bluray.English.Esub.MoviesMod.org.mkv", "Flipped (2010)"),
  video("v-gargi", ROOT, "Gargi.2022.1080p.HD.mkv", "Gargi.2022.1080p.HD.mkv"),
  video("v-ep1", "f-hotd-s1", "House of the Dragon S01E01.mkv", "House of The Dragon S01E01"),
]);

// Start the real backend against all of that.
const artworkDir = mkdtempSync(join(tmpdir(), "campfire-artwork-"));
const server = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
  cwd: join(import.meta.dirname, ".."),
  env: {
    ...process.env,
    PORT: String(PORT),
    MONGODB_DB_NAME: DB_NAME,
    TMDB_API_KEY: "smoke-key",
    TMDB_API_BASE: `http://127.0.0.1:${MOCK_PORT}/3`,
    TMDB_IMAGE_BASE: `http://127.0.0.1:${MOCK_PORT}/t/p`,
    ARTWORK_DIR: artworkDir,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function cleanup() {
  server.kill();
  mock.close();
  await db.dropDatabase().catch(() => {});
  await mongo.close();
  rmSync(artworkDir, { recursive: true, force: true });
}

try {
  for (let i = 0; i < 180 && !serverLog.includes("listening") && server.exitCode === null; i++) await sleep(500);
  if (!serverLog.includes("listening")) throw new Error(`backend didn't start:\n${serverLog}`);

  async function api(path, { token, method = "GET", body } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const buffer = Buffer.from(await res.arrayBuffer());
    let json = null;
    try { json = JSON.parse(buffer.toString("utf-8")); } catch { /* binary */ }
    return { status: res.status, type: res.headers.get("content-type") ?? "", buffer, json };
  }
  const doc = (kind, id) => db.collection(kind === "folder" ? "catalogFolders" : "catalogVideos").findOne({ _id: id });

  const admin = (await api("/auth/login", { method: "POST", body: { email: envValue("ADMIN_EMAIL"), password: envValue("ADMIN_PASSWORD") } })).json?.token;
  const viewerEmail = `artwork-viewer-${Date.now()}@example.test`;
  const viewer = (await api("/auth/signup", { method: "POST", body: { email: viewerEmail, password: "smoke-pass-123", name: "Viewer" } })).json?.token;
  check("admin and a viewer sign in", Boolean(admin && viewer));

  console.log("\nStartup auto-match");
  for (let i = 0; i < 40 && !(await doc("video", "v-gargi"))?.artworkTriedFor && !(await doc("video", "v-gargi"))?.artwork; i++) await sleep(250);
  const latent = await doc("folder", "f-latent");
  check("series with no image is matched on TMDb", latent?.artwork?.tmdbId === "101" && latent.artwork.source === "auto", JSON.stringify(latent?.artwork));
  check("search used the cleaned name (\"s2\" dropped)", searchHits.get("search/tv:India's got Latent") === 1);
  const weaponsDoc = await doc("video", "v-weapons");
  check("movie with a messy filename matched to the 2025 film, not the 2007 one", weaponsDoc?.artwork?.tmdbId === "1078605", JSON.stringify(weaponsDoc?.artwork));
  const flippedDoc = await doc("video", "v-flipped");
  check("same-name film from another year is not taken", flippedDoc?.artwork == null && flippedDoc?.artworkTriedFor === "Flipped|2010", JSON.stringify(flippedDoc));
  check("unknown series stays unmatched", (await doc("folder", "f-unknown"))?.artwork == null);
  check("seasons and episodes are left alone", (await doc("folder", "f-hotd-s1"))?.artwork === undefined && (await doc("video", "v-ep1"))?.artwork === undefined);
  await sleep(500); // let the background image warm-up land
  check("matched images are fetched ahead of the first view", imageHits.get("w1280/latentBackdrop.jpg") === 1 && imageHits.get("w1280/weaponsBackdrop.jpg") === 1, JSON.stringify([...imageHits]));

  console.log("\nWhat clients see");
  const library = (await api("/api/library", { token: viewer })).json;
  const listed = Object.fromEntries((library?.folders ?? []).map((f) => [f.id, f.thumbnailFileId]));
  check("artwork-only series is listed with a non-null thumbnailFileId (old apps load it)", listed["f-latent"] === "tmdb", JSON.stringify(listed));
  check("a Drive thumbnail.* still wins over an automatic match", listed["f-hotd"] === "drive-thumb-hotd");
  check("a series with neither stays null", listed["f-unknown"] === null);
  const spotlightLatent = library?.spotlight?.find((s) => s.id === "f-latent");
  check("spotlight slide gets an image path for the artwork-only series", spotlightLatent?.thumbnailPath === "/api/thumbnail-folder/f-latent", JSON.stringify(spotlightLatent));

  const folderImage = await api("/api/thumbnail-folder/f-latent", { token: viewer });
  check("folder image route serves the TMDb backdrop", folderImage.status === 200 && folderImage.type.startsWith("image/jpeg") && folderImage.buffer.equals(jpeg("w1280/latentBackdrop.jpg")), `${folderImage.status} ${folderImage.type}`);
  await api("/api/thumbnail-folder/f-latent", { token: viewer });
  check("second view comes from the disk cache, not TMDb", imageHits.get("w1280/latentBackdrop.jpg") === 1);
  check("cache is a plain file in ARTWORK_DIR", readdirSync(artworkDir).includes("w1280_latentBackdrop.jpg"), readdirSync(artworkDir).join(","));
  const movieImage = await api("/api/thumbnail/v-weapons", { token: viewer });
  check("movie image route serves its backdrop", movieImage.status === 200 && movieImage.buffer.equals(jpeg("w1280/weaponsBackdrop.jpg")));
  check("image routes still require sign-in", (await api("/api/thumbnail/v-weapons")).status === 401);

  const seriesPage = (await api("/api/folder/f-latent", { token: viewer })).json;
  check("series page carries year and synopsis", seriesPage?.year === 2024 && seriesPage?.overview === "A comedy talent show.", JSON.stringify({ y: seriesPage?.year, o: seriesPage?.overview }));
  const moviePage = (await api("/api/video/v-weapons", { token: viewer })).json;
  check("movie player data carries year and synopsis", moviePage?.year === 2025 && moviePage?.overview === "Kids vanish.");

  console.log("\nAdmin");
  check("viewer can't use admin artwork routes", (await api("/api/admin/catalog/artwork/video/v-flipped", { token: viewer, method: "PUT", body: { link: "tt0817177" } })).status === 403);
  const bad = await api("/api/admin/catalog/artwork/video/v-flipped", { token: admin, method: "PUT", body: { link: "https://example.com/flipped" } });
  check("a non-IMDb/TMDb link is refused with a reason", bad.status === 400 && bad.json?.code === "bad-link" && /IMDb/.test(bad.json?.error));
  check("an unknown IMDb id says TMDb doesn't have it", (await api("/api/admin/catalog/artwork/video/v-flipped", { token: admin, method: "PUT", body: { link: "tt9999999" } })).json?.code === "not-found");
  check("unknown catalog id → 404", (await api("/api/admin/catalog/artwork/video/nope", { token: admin, method: "PUT", body: { link: "tt0817177" } })).status === 404);
  check("bad kind → 404", (await api("/api/admin/catalog/artwork/season/v-flipped", { token: admin, method: "PUT", body: { link: "tt0817177" } })).status === 404);

  const pasted = await api("/api/admin/catalog/artwork/video/v-flipped", { token: admin, method: "PUT", body: { link: "https://www.imdb.com/title/tt0817177/?ref_=fn_al" } });
  check("pasted IMDb link resolves to the right film", pasted.status === 200 && pasted.json?.artwork?.tmdbId === "43949" && pasted.json.artwork.source === "link", JSON.stringify(pasted.json));
  await sleep(300);
  check("and its image is served", (await api("/api/thumbnail/v-flipped", { token: viewer })).buffer.equals(jpeg("w1280/flippedBackdrop.jpg")));

  const hotdLink = await api("/api/admin/catalog/artwork/folder/f-hotd", { token: admin, method: "PUT", body: { link: "https://www.themoviedb.org/tv/94997-house-of-the-dragon" } });
  check("pasted TMDb TV link resolves", hotdLink.json?.artwork?.tmdbType === "tv" && hotdLink.json.artwork.tmdbId === "94997");
  check("a pasted link wins over the Drive thumbnail.*", (await api("/api/thumbnail-folder/f-hotd", { token: viewer })).buffer.equals(jpeg("w1280/hotdLinkBackdrop.jpg")));

  const removed = await api("/api/admin/catalog/artwork/folder/f-latent", { token: admin, method: "DELETE" });
  check("artwork can be removed", removed.status === 200 && (await doc("folder", "f-latent"))?.artworkAutoOff === true);
  const afterRemove = (await api("/api/library", { token: viewer })).json;
  check("removed → listed without an image again", afterRemove.folders.find((f) => f.id === "f-latent")?.thumbnailFileId === null);
  check("removed → image route 404s", (await api("/api/thumbnail-folder/f-latent", { token: viewer })).status === 404);
  const run = await api("/api/admin/catalog/artwork/auto-match", { token: admin, method: "POST" });
  check("'match missing' retries earlier misses", run.status === 200 && searchHits.get("search/movie:Flipped") === 1 && searchHits.get("search/tv:Zzqx Unheard Of Show") === 2, JSON.stringify([...searchHits]));
  check("…but leaves a removed title removed", (await doc("folder", "f-latent"))?.artwork === null && run.json?.matched.every((m) => m.id !== "f-latent"));
  check("…and reports what's still unmatched", run.json?.unmatched.some((u) => u.id === "f-unknown" && u.query === "Zzqx Unheard Of Show"));
  const one = await api("/api/admin/catalog/artwork/folder/f-unknown/auto", { token: admin, method: "POST" });
  check("single-title search explains a miss", one.status === 400 && one.json?.code === "not-found" && /Paste its IMDb or TMDb link/.test(one.json?.error));
  const rematch = await api("/api/admin/catalog/artwork/folder/f-latent/auto", { token: admin, method: "POST" });
  check("single-title search re-enables a removed title", rematch.status === 200 && (await doc("folder", "f-latent"))?.artworkAutoOff === false);

  console.log("\nTMDb CDN failing");
  const gargi = await doc("video", "v-gargi");
  check("Gargi matched (its image is the one the mock CDN fails)", gargi?.artwork?.backdropPath === "/brokenOnCdn.jpg");
  const broken = await api("/api/thumbnail/v-gargi", { token: viewer });
  // Locally there are no Drive credentials either, so the fallback ends in the route's own 404 —
  // the point is that it falls through cleanly instead of erroring or hanging.
  check("a CDN failure falls back to the Drive path, not a 500", broken.status === 404 && broken.json?.error === "No thumbnail", `${broken.status}`);
  check("no half-written files left behind", !readdirSync(artworkDir).some((f) => f.endsWith(".part")));
  const cdnHits = imageHits.get("w1280/brokenOnCdn.jpg");
  await api("/api/thumbnail/v-gargi", { token: viewer });
  check("a failed image isn't re-downloaded on every view", imageHits.get("w1280/brokenOnCdn.jpg") === cdnHits, `${cdnHits} → ${imageHits.get("w1280/brokenOnCdn.jpg")}`);
} catch (error) {
  failures.push(String(error?.stack ?? error));
  console.error(error);
} finally {
  await cleanup();
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
