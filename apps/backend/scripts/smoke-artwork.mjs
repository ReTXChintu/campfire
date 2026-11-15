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
import { cleanedTitle, parseReleaseName, pickMatch } from "../src/lib/artwork.ts";
import { guessSeasonNumber } from "../src/lib/episodeArtwork.ts";

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

console.log("\nTitles safe to replace");
const asArtwork = (title) => ({ source: "auto", tmdbType: "movie", tmdbId: "1", title, year: null, overview: null, backdropPath: null, posterPath: null, matchedAt: new Date() });
const cleans = [
  ["Gargi.2022.1080p.HD.mkv", "Gargi", "Gargi"],
  ["House of The Dragon", "House of the Dragon", "House of the Dragon"],
  ["Weapons (2025) Dual Audio 1080p", "Weapons", "Weapons"],
  // Already right, or deliberately not the same title — left alone either way.
  ["Gargi", "Gargi", null],
  ["Gargi - Director's Cut", "Gargi", null],
  ["The Office (US)", "The Office", null],
  ["Avengers Endgame", "Avengers: Endgame", "Avengers: Endgame"],
];
for (const [current, tmdbTitle, expected] of cleans) {
  const got = cleanedTitle(current, asArtwork(tmdbTitle));
  check(`"${current}" + "${tmdbTitle}" → ${expected === null ? "kept" : `"${expected}"`}`, got === expected, JSON.stringify(got));
}
check("a title we have nothing for is left alone", cleanedTitle(null, asArtwork("Gargi")) === null);

console.log("\nSeason numbers in folder names");
const seasonNames = [
  ["Season 1", 1], ["Season 02", 2], ["season-3", 3], ["S4", 4], ["S05", 5],
  ["Series 2", 2], ["2", 2], ["Specials", 0], ["Extras", 0],
  ["India's got Latent s2", 2], ["Attack on Titan", null], ["Behind The Scenes", null],
  ["Stranger Things", null], ["Part One", null],
];
for (const [name, expected] of seasonNames) {
  const got = guessSeasonNumber(name);
  check(`"${name}" → ${expected === null ? "unknown" : expected}`, got === expected, JSON.stringify(got));
}
check("the Drive name is used when the title has lost the hint", guessSeasonNumber("India's Got Latent", "India's got Latent s2") === 2);

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
// Detail responses, as TMDb returns them for `/movie/{id}` and `/tv/{id}` with everything
// appended. These carry the facts, the image lists and the cast — the deliberately awkward bits
// are what the checks below are about: a higher-voted English backdrop that must lose to a
// textless one, a higher-voted Hindi poster that must lose to the English one, an SVG wordmark
// that must be skipped for the PNG, a blank Indian certificate that must fall through to the
// real one, and four genres where only three are kept.
const details = {
  "movie/1078605": {
    id: 1078605, title: "Weapons", release_date: "2025-08-06", overview: "Kids vanish.",
    backdrop_path: "/weaponsBackdrop.jpg", poster_path: "/weaponsPoster.jpg",
    tagline: "Who took the children?", runtime: 128, vote_average: 7.432, vote_count: 1200,
    genres: [{ name: "Horror" }, { name: "Mystery" }, { name: "Thriller" }, { name: "Drama" }],
    images: {
      backdrops: [
        { file_path: "/weaponsTexted.jpg", iso_639_1: "en", vote_average: 9 },
        { file_path: "/weaponsClean.jpg", iso_639_1: null, vote_average: 4 },
      ],
      posters: [
        { file_path: "/weaponsEnPoster.jpg", iso_639_1: "en", vote_average: 5 },
        { file_path: "/weaponsHiPoster.jpg", iso_639_1: "hi", vote_average: 9 },
      ],
      logos: [
        { file_path: "/weaponsLogo.svg", iso_639_1: "en", vote_average: 10 },
        { file_path: "/weaponsLogo.png", iso_639_1: "en", vote_average: 6 },
      ],
    },
    credits: {
      cast: [
        { name: "Josh Brolin", character: "Archer Graff", profile_path: "/brolin.jpg", order: 1 },
        { name: "Julia Garner", character: "Justine Gandy", profile_path: "/garner.jpg", order: 0 },
        { name: "Nobody Pictured", character: "Extra", profile_path: null, order: 2 },
      ],
    },
    release_dates: {
      results: [
        { iso_3166_1: "US", release_dates: [{ certification: "R" }] },
        { iso_3166_1: "IN", release_dates: [{ certification: "" }, { certification: "A" }] },
      ],
    },
  },
  "movie/43949": {
    id: 43949, title: "Flipped", release_date: "2010-08-06", overview: "First love.",
    backdrop_path: "/flippedBackdrop.jpg", poster_path: "/flippedPoster.jpg", runtime: 90,
    vote_average: 7.6, vote_count: 900, genres: [{ name: "Romance" }],
  },
  "movie/5": {
    id: 5, title: "Gargi", release_date: "2022-07-15", overview: "A father accused.",
    backdrop_path: "/brokenOnCdn.jpg", runtime: 141, vote_average: 7.9, vote_count: 60,
    genres: [{ name: "Drama" }],
  },
  "tv/94997": {
    id: 94997, name: "House of the Dragon", first_air_date: "2022-08-21", overview: "Targaryens.",
    backdrop_path: "/hotdBackdrop.jpg", poster_path: "/hotdPoster.jpg",
    tagline: "All must choose.", episode_run_time: [60], vote_average: 8.4, vote_count: 5000,
    number_of_seasons: 2, number_of_episodes: 18, genres: [{ name: "Drama" }, { name: "Fantasy" }],
    images: { backdrops: [{ file_path: "/hotdClean.jpg", iso_639_1: null, vote_average: 5 }], logos: [{ file_path: "/hotdLogo.png", iso_639_1: "en" }] },
    content_ratings: { results: [{ iso_3166_1: "US", rating: "TV-MA" }, { iso_3166_1: "IN", rating: "A" }] },
    aggregate_credits: { cast: [{ name: "Matt Smith", roles: [{ character: "Daemon Targaryen" }], profile_path: "/smith.jpg", order: 0 }] },
  },
  "tv/101": {
    id: 101, name: "India's Got Latent", first_air_date: "2024-06-16", overview: "A comedy talent show.",
    backdrop_path: "/latentBackdrop.jpg", poster_path: "/latentPoster.jpg",
    episode_run_time: [75], number_of_seasons: 2, number_of_episodes: 20, genres: [{ name: "Comedy" }],
  },
};

// Season listings, keyed `<seriesId>/<seasonNumber>`. Episode 2 has no still and no name, so the
// checks can show an episode TMDb knows nothing about keeps the name it already had.
const seasons = {
  "94997/1": [
    { episode_number: 1, name: "The Heirs of the Dragon", overview: "Viserys hosts a tourney.", still_path: "/hotdS1E1.jpg", air_date: "2022-08-21", runtime: 66, vote_average: 8.1, vote_count: 400 },
    { episode_number: 2, name: "", overview: "", still_path: null, air_date: "2022-08-28", runtime: 54 },
    { episode_number: 3, name: "Second of His Name", overview: "A war in the Stepstones.", still_path: "/hotdS1E3.jpg", air_date: "2022-09-04", runtime: 63 },
  ],
  "101/2": [
    { episode_number: 1, name: "Episode One", overview: "The judges arrive.", still_path: "/latentS2E1.jpg", air_date: "2025-01-05", runtime: 80 },
  ],
};

const detailHits = new Map();
const mock = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const image = url.pathname.match(/^\/t\/p\/(w\d+)(\/[A-Za-z0-9]+\.(?:jpg|png))$/);
  if (image) {
    const key = `${image[1]}${image[2]}`;
    imageHits.set(key, (imageHits.get(key) ?? 0) + 1);
    if (image[2] === "/brokenOnCdn.jpg") return res.writeHead(500).end();
    const type = image[2].endsWith(".png") ? "image/png" : "image/jpeg";
    return res.writeHead(200, { "content-type": type }).end(jpeg(key));
  }
  if (url.searchParams.get("api_key") !== "smoke-key") return res.writeHead(401).end("{}");
  const json = (body) => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
  const search = url.pathname.match(/^\/3\/(search\/(?:tv|movie))$/);
  if (search) {
    const query = url.searchParams.get("query");
    searchHits.set(`${search[1]}:${query}`, (searchHits.get(`${search[1]}:${query}`) ?? 0) + 1);
    const table = tmdb[search[1]];
    const key = Object.keys(table).find((k) => k.toLowerCase() === query.toLowerCase());
    return json({ results: (key ? table[key] : null) ?? [] });
  }
  const detail = url.pathname.match(/^\/3\/(movie|tv)\/(\d+)$/);
  if (detail) {
    detailHits.set(`${detail[1]}/${detail[2]}`, (detailHits.get(`${detail[1]}/${detail[2]}`) ?? 0) + 1);
    const body = details[`${detail[1]}/${detail[2]}`];
    if (body) return json(body);
  }
  const season = url.pathname.match(/^\/3\/tv\/(\d+)\/season\/(\d+)$/);
  if (season) {
    const episodes = seasons[`${season[1]}/${season[2]}`];
    if (episodes) return json({ season_number: Number(season[2]), episodes });
    return res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ status_code: 34 }));
  }
  if (url.pathname === "/3/find/tt0817177") {
    return json({ movie_results: [{ id: 43949, title: "Flipped", release_date: "2010-08-06", overview: "First love.", backdrop_path: "/flippedBackdrop.jpg", poster_path: "/flippedPoster.jpg" }], tv_results: [] });
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
const video = (id, parentFolderId, driveName, title, extra = {}) => ({
  _id: id, parentFolderId, driveName, mimeType: "video/x-matroska", sizeBytes: 1, durationSeconds: 6000,
  status: "published", title, subtitleSetIds: [], introStart: null, introEnd: null, outroStart: null,
  episodeOrder: null, titleOverridden: true, introOverridden: false, renditions: {},
  createdAt: now, curatedAt: now, curatedBy: "smoke", updatedAt: now, ...extra,
});
await db.collection("catalogFolders").insertMany([
  folder("f-latent", ROOT, "India's got Latent s2"),
  folder("f-hotd", ROOT, "House of The Dragon", "drive-thumb-hotd"),
  folder("f-unknown", ROOT, "Zzqx Unheard Of Show"),
  folder("f-hotd-s1", "f-hotd", "Season 1"),
  folder("f-hotd-extras", "f-hotd", "Behind The Scenes"),
]);
const weaponsName = "Weapons (2025) (Hindi DD5.1-224Kbps HQ   English DD5.1-192Kbps) Dual Audio Hollywood Movie HD 1080p ESub.mkv";
await db.collection("catalogVideos").insertMany([
  video("v-weapons", ROOT, weaponsName, weaponsName),
  video("v-flipped", ROOT, "Flipped.2010.1080P.Bluray.English.Esub.MoviesMod.org.mkv", "Flipped (2010)"),
  // Never curated by hand, so its raw filename is open to being replaced by TMDb's title.
  video("v-gargi", ROOT, "Gargi.2022.1080p.HD.mkv", "Gargi.2022.1080p.HD.mkv", { titleOverridden: false }),
  // A season folder's episodes: numbered, un-overridden, named by a publish-rule pattern.
  video("v-ep1", "f-hotd-s1", "HOTD S01E01.mkv", "Episode 1", { titleOverridden: false, episodeOrder: 1 }),
  video("v-ep2", "f-hotd-s1", "HOTD S01E02.mkv", "Episode 2", { titleOverridden: false, episodeOrder: 2 }),
  video("v-ep3", "f-hotd-s1", "HOTD S01E03.mkv", "Renamed by hand", { titleOverridden: true, episodeOrder: 3 }),
  // A flat series: episodes straight inside the series folder, whose own name says "s2".
  video("v-latent-e1", "f-latent", "Latent S02E01.mkv", "Episode 1", { titleOverridden: false, episodeOrder: 1 }),
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
  check("seasons and episodes get no title match of their own", (await doc("folder", "f-hotd-s1"))?.artwork === undefined && (await doc("video", "v-ep1"))?.artwork === undefined);
  await sleep(500); // let the background image warm-up land
  check("matched images are fetched ahead of the first view", imageHits.get("w1280/latentBackdrop.jpg") === 1 && imageHits.get("w1280/weaponsClean.jpg") === 1, JSON.stringify([...imageHits]));
  check("the wordmark is warmed too, so the spotlight has it", imageHits.get("w500/weaponsLogo.png") === 1, JSON.stringify([...imageHits]));

  console.log("\nWhat clients see");
  const library = (await api("/api/library", { token: viewer })).json;
  const listed = Object.fromEntries((library?.folders ?? []).map((f) => [f.id, f.thumbnailFileId]));
  check("artwork-only series is listed with a non-null thumbnailFileId (old apps load it)", listed["f-latent"] === "tmdb", JSON.stringify(listed));
  check("TMDb artwork wins over a Drive thumbnail.*", listed["f-hotd"] === "tmdb");
  check("a series with neither stays null", listed["f-unknown"] === null);
  const spotlightLatent = library?.spotlight?.find((s) => s.id === "f-latent");
  check("spotlight slide gets an image path for the artwork-only series", spotlightLatent?.thumbnailPath === "/api/thumbnail-folder/f-latent", JSON.stringify(spotlightLatent));

  const folderImage = await api("/api/thumbnail-folder/f-latent", { token: viewer });
  check("folder image route serves the TMDb backdrop", folderImage.status === 200 && folderImage.type.startsWith("image/jpeg") && folderImage.buffer.equals(jpeg("w1280/latentBackdrop.jpg")), `${folderImage.status} ${folderImage.type}`);
  await api("/api/thumbnail-folder/f-latent", { token: viewer });
  check("second view comes from the disk cache, not TMDb", imageHits.get("w1280/latentBackdrop.jpg") === 1);
  check("cache is a plain file in ARTWORK_DIR", readdirSync(artworkDir).includes("w1280_latentBackdrop.jpg"), readdirSync(artworkDir).join(","));
  const movieImage = await api("/api/thumbnail/v-weapons", { token: viewer });
  check("movie image route serves its backdrop", movieImage.status === 200 && movieImage.buffer.equals(jpeg("w1280/weaponsClean.jpg")));
  check("?shape=poster serves the 2:3 poster instead", (await api("/api/thumbnail/v-weapons?shape=poster", { token: viewer })).buffer.equals(jpeg("w780/weaponsEnPoster.jpg")));
  check("folder ?shape=poster too", (await api("/api/thumbnail-folder/f-hotd?shape=poster", { token: viewer })).buffer.equals(jpeg("w780/hotdPoster.jpg")));
  check("unknown shape is treated as wide", (await api("/api/thumbnail/v-weapons?shape=../../x", { token: viewer })).buffer.equals(jpeg("w1280/weaponsClean.jpg")));
  check("image routes still require sign-in", (await api("/api/thumbnail/v-weapons")).status === 401);

  const seriesPage = (await api("/api/folder/f-latent", { token: viewer })).json;
  check("series page carries year and synopsis", seriesPage?.year === 2024 && seriesPage?.overview === "A comedy talent show.", JSON.stringify({ y: seriesPage?.year, o: seriesPage?.overview }));
  const moviePage = (await api("/api/video/v-weapons", { token: viewer })).json;
  check("movie player data carries year and synopsis", moviePage?.year === 2025 && moviePage?.overview === "Kids vanish.");


  console.log("\nFacts from TMDb");
  const movieFacts = (await api("/api/video/v-weapons", { token: viewer })).json;
  check("tagline", movieFacts?.tagline === "Who took the children?", JSON.stringify(movieFacts?.tagline));
  check("runtime", movieFacts?.runtimeMinutes === 128);
  check("at most three genres, in TMDb's order", JSON.stringify(movieFacts?.genres) === JSON.stringify(["Horror", "Mystery", "Thriller"]), JSON.stringify(movieFacts?.genres));
  check("certificate prefers India and skips a blank one", movieFacts?.certificate === "A", JSON.stringify(movieFacts?.certificate));
  check("TMDb score, rounded, with its vote count", movieFacts?.rating?.average === 7.4 && movieFacts.rating.count === 1200, JSON.stringify(movieFacts?.rating));
  check("the film has a wordmark", movieFacts?.hasLogo === true);
  const seriesFacts = (await api("/api/folder/f-hotd", { token: viewer })).json;
  check("a series reports its episode length, seasons and episode count", seriesFacts?.runtimeMinutes === 60 && seriesFacts?.seasonCount === 2 && seriesFacts?.episodeCount === 18, JSON.stringify(seriesFacts && { r: seriesFacts.runtimeMinutes, s: seriesFacts.seasonCount, e: seriesFacts.episodeCount }));
  check("a series certificate comes from content ratings", seriesFacts?.certificate === "A");
  const unmatchedPage = (await api("/api/folder/f-unknown", { token: viewer })).json;
  check("an unmatched title reports no facts rather than failing", unmatchedPage?.certificate === null && unmatchedPage?.rating === null && JSON.stringify(unmatchedPage?.genres) === "[]" && unmatchedPage?.cast.length === 0, JSON.stringify(unmatchedPage?.genres));

  console.log("\nCast");
  check("billing order is TMDb's, not the order it sent them in", movieFacts?.cast?.[0]?.name === "Julia Garner" && movieFacts.cast[1].name === "Josh Brolin", JSON.stringify(movieFacts?.cast?.map((c) => c.name)));
  check("characters come through", movieFacts?.cast?.[0]?.character === "Justine Gandy");
  check("someone with no headshot gets no image path", movieFacts?.cast?.[2]?.imagePath === null && movieFacts.cast[2].name === "Nobody Pictured");
  check("a series' cast comes from its aggregate credits", seriesFacts?.cast?.[0]?.character === "Daemon Targaryen", JSON.stringify(seriesFacts?.cast));
  const headshot = await api(movieFacts.cast[0].imagePath, { token: viewer });
  check("headshot route serves the right person's image", headshot.status === 200 && headshot.buffer.equals(jpeg("w185/garner.jpg")), String(headshot.status));
  check("headshot past the end of the cast list is a 404", (await api("/api/cast-image/video/v-weapons/99", { token: viewer })).status === 404);
  check("headshots require sign-in", (await api("/api/cast-image/video/v-weapons/0")).status === 401);

  console.log("\nWordmarks");
  const logo = await api("/api/thumbnail/v-weapons?shape=logo", { token: viewer });
  check("?shape=logo serves the PNG wordmark, not the SVG", logo.status === 200 && logo.buffer.equals(jpeg("w500/weaponsLogo.png")), String(logo.status));
  check("a title with no wordmark 404s rather than serving a photo", (await api("/api/thumbnail-folder/f-latent?shape=logo", { token: viewer })).status === 404);
  check("a folder with a Drive image doesn't stand in for one either", (await api("/api/thumbnail-folder/f-unknown?shape=logo", { token: viewer })).status === 404);
  const spotlightHotd = (await api("/api/library", { token: viewer })).json?.spotlight?.find((s) => s.id === "f-hotd");
  check("spotlight slide points at the wordmark when there is one", spotlightHotd?.logoPath === "/api/thumbnail-folder/f-hotd?shape=logo", JSON.stringify(spotlightHotd?.logoPath));
  check("and at null when there isn't", (await api("/api/library", { token: viewer })).json?.spotlight?.find((s) => s.id === "f-latent")?.logoPath === null);

  console.log("\nReal titles");
  check("a raw filename is replaced by TMDb's title", (await doc("video", "v-gargi"))?.title === "Gargi", JSON.stringify((await doc("video", "v-gargi"))?.title));
  check("a title an admin typed is left alone", (await doc("video", "v-weapons"))?.title === weaponsName);
  check("a folder's capitalisation is corrected to TMDb's", (await doc("folder", "f-hotd"))?.title === "House of the Dragon", JSON.stringify((await doc("folder", "f-hotd"))?.title));
  check("cards carry the year and score", (await api("/api/library", { token: viewer })).json?.videos?.find((v) => v.id === "v-weapons")?.rating?.average === 7.4);

  console.log("\nEpisodes");
  const ep1 = await doc("video", "v-ep1");
  check("episode 1 is named from TMDb", ep1?.title === "The Heirs of the Dragon", JSON.stringify(ep1?.title));
  check("and keeps its synopsis, still, air date and number", ep1?.episodeArtwork?.overview === "Viserys hosts a tourney." && ep1.episodeArtwork.stillPath === "/hotdS1E1.jpg" && ep1.episodeArtwork.airDate === "2022-08-21" && ep1.episodeArtwork.episode === 1 && ep1.episodeArtwork.season === 1, JSON.stringify(ep1?.episodeArtwork));
  check("an episode TMDb has no name for keeps the one it had", (await doc("video", "v-ep2"))?.title === "Episode 2");
  check("an episode an admin named by hand is left alone", (await doc("video", "v-ep3"))?.title === "Renamed by hand");
  check("but still gets its synopsis and still", (await doc("video", "v-ep3"))?.episodeArtwork?.name === "Second of His Name");
  check("the episode's own still is served as its image", (await api("/api/thumbnail/v-ep1", { token: viewer })).buffer.equals(jpeg("w780/hotdS1E1.jpg")));
  check("an episode with no still falls through to Drive's frame", (await api("/api/thumbnail/v-ep2", { token: viewer })).status === 404);
  const seasonPage = (await api("/api/folder/f-hotd?season=f-hotd-s1", { token: viewer })).json;
  const rows = seasonPage?.seasonItems ?? [];
  check("episode rows carry the number, synopsis, runtime and score", rows[0]?.episodeNumber === 1 && rows[0]?.overview === "Viserys hosts a tourney." && rows[0]?.runtimeMinutes === 66 && rows[0]?.rating?.average === 8.1, JSON.stringify(rows[0]));
  const playerEp = (await api("/api/video/v-ep1", { token: viewer })).json;
  check("the player knows which episode it is", playerEp?.episode?.number === 1 && playerEp?.episode?.season === 1 && playerEp?.episode?.overview === "Viserys hosts a tourney.", JSON.stringify(playerEp?.episode));
  check("a film has no episode block", movieFacts?.episode === null);
  const latentEp = await doc("video", "v-latent-e1");
  check("a flat series takes its season from its own name", latentEp?.episodeArtwork?.season === 2 && latentEp?.title === "Episode One", JSON.stringify(latentEp?.episodeArtwork));

  console.log("\nSeasons the names don't give away");
  const extras = (await api("/api/admin/catalog/folder/f-hotd-extras", { token: admin })).json;
  check("a folder whose name says no season is offered the control", extras?.episodeSeries?.title === "House of the Dragon" && extras.episodeSeries.season === null, JSON.stringify(extras?.episodeSeries));
  check("a season folder's guess is reported as a guess", (await api("/api/admin/catalog/folder/f-hotd-s1", { token: admin })).json?.episodeSeries?.season === 1);
  const named = await api("/api/admin/catalog/artwork/folder/f-hotd/episodes", { token: admin, method: "POST" });
  check("naming one series' episodes on demand reports what it couldn't place", named.status === 200 && named.json?.unresolved?.some((u) => u.folderId === "f-hotd-extras"), JSON.stringify(named.json));
  check("setting a season is validated", (await api("/api/admin/catalog/artwork/folder/f-hotd-extras/season", { token: admin, method: "PUT", body: { season: 200 } })).status === 400);
  const setSeason = await api("/api/admin/catalog/artwork/folder/f-hotd-extras/season", { token: admin, method: "PUT", body: { season: 1 } });
  check("setting it sticks", setSeason.status === 200 && (await doc("folder", "f-hotd-extras"))?.tmdbSeason === 1);
  check("a title that isn't a series can't have episodes named", (await api("/api/admin/catalog/artwork/folder/f-unknown/episodes", { token: admin, method: "POST" })).json?.code === "not-found");
  await api("/api/admin/catalog/artwork/folder/f-hotd/episode-naming", { token: admin, method: "PUT", body: { enabled: false } });
  check("episode naming can be turned off for a series", (await doc("folder", "f-hotd"))?.episodeArtworkOff === true);

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
  check("a pasted link replaces the automatic match", hotdLink.json?.artwork?.source === "link" && (await api("/api/thumbnail-folder/f-hotd", { token: viewer })).buffer.equals(jpeg("w1280/hotdClean.jpg")));
  await api("/api/admin/catalog/artwork/folder/f-hotd", { token: admin, method: "DELETE" });
  check("removing artwork brings the Drive thumbnail.* back", (await api("/api/library", { token: viewer })).json.folders.find((f) => f.id === "f-hotd")?.thumbnailFileId === "drive-thumb-hotd");

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
