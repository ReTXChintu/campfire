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
import { guessSeasonNumber, matchSpecial, parseBonusNumber, parseEpisodeNumber } from "../src/lib/episodeArtwork.ts";

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

console.log("\nEpisode numbers in filenames");
const episodeNames = [
  // The shapes that turn up in a real library.
  ["HOTD S01E01.mkv", 1, 1],
  ["S1E1 The Heirs of the Dragon.mkv", 1, 1],
  ["S01E01: VisionQuest.mkv", 1, 1],
  ["Show.Name.S02E10.1080p.WEB-DL.x264.mkv", 2, 10],
  ["show_s03e07_720p.mkv", 3, 7],
  ["Show S01 E04.mkv", 1, 4],
  ["Show S01 - E04.mkv", 1, 4],
  ["Breaking Bad 2x05.mkv", 2, 5],
  // The anime convention, as this library's Attack on Titan is named.
  ["AOT S1 - 01 [1080p] [Dual] @infinite_anime.mkv", 1, 1],
  ["AOT S4 - 30 [1080p] [Dual].mkv", 4, 30],
  // A long release name whose only episode marker is buried among audio specs.
  ["Game of Thrones (2011) S05E05 1080p 10bit BluRay x265 HEVC [DDP 2.0 - 192Kbps] ESub - site.mkv", 5, 5],
  ["Season 1 Episode 3.mp4", 1, 3],
  ["Episode 7.mkv", null, 7],
  ["AOT E05.mkv", null, 5],
];
for (const [raw, season, episode] of episodeNames) {
  const got = parseEpisodeNumber(raw);
  check(`"${raw}" → ${season === null ? "" : `season ${season} `}episode ${episode}`, got?.season === season && got?.episode === episode, JSON.stringify(got));
}
const unreadable = [
  // A part of a season: TMDb numbers the season straight through, and part 1's length isn't here.
  "S4P1E1 Attack on Titan.mkv",
  // A DOS short name — the real name is gone.
  "GA4CB6~1.MKV",
  // Release noise that looks numeric but isn't an episode.
  "Movie.2019.1080p.x264.mkv",
  "Show 1920x1080.mkv",
  "Weapons (2025) Hindi DD5.1-224Kbps HQ English.mkv",
  // A pilot or extra numbered 0, and a number spelled out.
  "Pilot E00.mkv",
  "Episode One.mkv",
];
for (const raw of unreadable) {
  check(`"${raw}" → says nothing usable`, parseEpisodeNumber(raw) === null, JSON.stringify(parseEpisodeNumber(raw)));
}

console.log("\nBonus episodes");
// India's Got Latent's season-2 bonus files, as they are in production.
const bonusNames = [
  ["INDIAS.GOT.LATENT.S02.Bonus.E03.2026.1080p.YT.WEB-DL.Hindi.AAC2.0.H.264.mkv", 2, 3],
  ["Indias.Got.Latent.S02.Bonus.Ep.02.1080p.Hindi.WEB-DL.2.0.x264.mkv", 2, 2],
  ["INDIAS.GOT.LATENT.S2.Bonus.EP1.1080p.YT.WEBRip.Hindi.AAC2.0.H.264.mkv", 2, 1],
  ["INDIAS.GOT.LATENT.S02.Bonus.E04.2026.720p.YT.WEB-DL.Hindi.AAC2.0.H.264.mkv", 2, 4],
];
for (const [raw, season, bonus] of bonusNames) {
  const got = parseBonusNumber(raw);
  check(`"${raw.slice(0, 44)}…" → season ${season} bonus ${bonus}`, got?.season === season && got?.bonus === bonus, JSON.stringify(got));
  check(`…and is never read as regular episode ${bonus}`, parseEpisodeNumber(raw) === null, JSON.stringify(parseEpisodeNumber(raw)));
}
check("a bonus with no number is still a bonus, just unmatchable", parseBonusNumber("Show Bonus Clip.mkv")?.bonus === null);
check("a regular episode isn't a bonus", parseBonusNumber("HOTD S01E01.mkv") === null);
// TMDb's actual India's Got Latent specials, abridged: one running list across both seasons.
const latentSpecials = [
  { episode_number: 2, name: "Bonus EP 1" },
  { episode_number: 3, name: "Bonus EP 2" },
  { episode_number: 4, name: "Bonus EP 3" },
  { episode_number: 11, name: "S2 Bonus EP1 ft. Raghav Juyal, Munawar, Niharika NM, Rohan Joshi" },
  { episode_number: 12, name: "Bonus Clip ft. Karan Aujla, Tanmay Bhat, Gurleen Pannu, Rahul Dua" },
  { episode_number: 13, name: "S2 Bonus EP2 ft. Badshah, Sourav Joshi, Harssh Limbachiyaa, Rajat Sood" },
  { episode_number: 15, name: "S2 Bonus EP3 ft. Deepak Kalal, Ravi Gupta and Agu Stanley" },
  { episode_number: 16, name: "S2 Bonus EP4 ft. Ayushmann Khurrana, Suhani Shah, Kullu, Rajat Sood" },
];
check("season 2 bonuses find their specials (11, 13, 15, 16)", [1, 2, 3, 4].map((b) => matchSpecial(latentSpecials, { season: 2, bonus: b })).join() === "11,13,15,16");
check("a season-1 bonus finds the special with no season in its name", matchSpecial(latentSpecials, { season: 1, bonus: 3 }) === 4);
check("no candidate → no match", matchSpecial(latentSpecials, { season: 3, bonus: 1 }) === null);
check("two candidates → no guess", matchSpecial([{ episode_number: 1, name: "Bonus 1" }, { episode_number: 2, name: "Bonus EP 1" }], { season: 1, bonus: 1 }) === null);

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
    { episode_number: 4, name: "King of the Narrow Sea", overview: "Rhaenyra sees the city.", still_path: "/hotdS1E4.jpg", air_date: "2022-09-11", runtime: 64 },
  ],
  "94997/2": [
    { episode_number: 1, name: "A Son for a Son", overview: "Blood and cheese.", still_path: "/hotdS2E1.jpg" },
    { episode_number: 2, name: "Rhaenyra the Cruel", overview: "Aftermath.", still_path: "/hotdS2E2.jpg" },
    { episode_number: 3, name: "The Burning Mill", overview: "A feud.", still_path: "/hotdS2E3.jpg" },
    { episode_number: 4, name: "The Red Dragon and the Gold", overview: "Rook's Rest.", still_path: "/hotdS2E4.jpg" },
  ],
  "94997/3": [
    { episode_number: 1, name: "Third Season One", overview: "x", still_path: "/hotdS3E1.jpg" },
    // Sorts *before* episode 1's name, so renaming a position-matched folder would reshuffle it
    // if its order weren't frozen.
    { episode_number: 2, name: "Another Third Two", overview: "x", still_path: "/hotdS3E2.jpg" },
    { episode_number: 3, name: "Third Season Three", overview: "x", still_path: "/hotdS3E3.jpg" },
    { episode_number: 4, name: "Third Season Four", overview: "x", still_path: "/hotdS3E4.jpg" },
  ],
  "101/0": [
    { episode_number: 3, name: "Bonus EP 2", overview: "Season one's.", still_path: "/latentB1.jpg" },
    { episode_number: 13, name: "S2 Bonus EP2 ft. Badshah", overview: "The real bonus two.", still_path: "/latentS2B2.jpg" },
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
  // Episode 3 was never uploaded. By position the third file would become episode 3; its name
  // says it is episode 4.
  folder("f-hotd-s2", "f-hotd", "Season 2"),
  // A folder whose name says nothing, but whose file names its own season.
  folder("f-hotd-lost", "f-hotd", "Lost Episode"),
  // One readable name and one DOS short name: all-or-nothing, so this folder goes by position.
  { ...folder("f-hotd-s3", "f-hotd", "Season 3"), status: "pending", title: null },
  folder("f-hotd-nofit", "f-hotd", "Season 3 Extras"),
  folder("f-hotd-frozen", "f-hotd", "Season 3 Again"),
  // Curated but unpublished: an admin is holding this season back on purpose.
  { ...folder("f-hotd-held", "f-hotd", "Season 1 Directors Cut"), status: "curated" },
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
  video("v-ep-pending", "f-hotd-s1", "HOTD S01E04.mkv", null, { titleOverridden: false, episodeOrder: 4, status: "pending" }),
  // A file in "Behind The Scenes" that names no episode, so the folder stays unplaced.
  video("v-making-of", "f-hotd-extras", "HOTD Making Of.mkv", null, { status: "pending", titleOverridden: false }),
  video("v-s2e1", "f-hotd-s2", "HOTD S02E01.mkv", "Episode 1", { titleOverridden: false }),
  video("v-s2e2", "f-hotd-s2", "HOTD S02E02.mkv", "Episode 2", { titleOverridden: false }),
  video("v-s2e4", "f-hotd-s2", "HOTD S02E04.mkv", "Episode 3", { titleOverridden: false, episodeOrder: 3 }),
  video("v-lost", "f-hotd-lost", "HOTD S02E03.mkv", "The lost one", { titleOverridden: false }),
  video("v-s3e3", "f-hotd-s3", "HOTD S03E03.mkv", null, { status: "pending", titleOverridden: false }),
  video("v-s3e4", "f-hotd-s3", "HOTD S03E04.mkv", null, { status: "pending", titleOverridden: false }),
  video("v-s3-short1", "f-hotd-s3", "HOTDS3~1.MKV", null, { status: "pending", titleOverridden: false }),
  video("v-s3-short2", "f-hotd-s3", "HOTDS3~2.MKV", null, { status: "pending", titleOverridden: false }),
  // Too many gaps to fill: one readable episode 4 and a single short name could be any of 1–3.
  // An admin ordered this folder by hand — the short-name file first — which name sorting would
  // reverse. (An admin's order is always complete: drag-reorder and publish-rule apply set every
  // file at once.)
  video("v-nofit-e4", "f-hotd-nofit", "HOTD S03E04.mkv", null, { status: "pending", titleOverridden: false, episodeOrder: 2 }),
  video("v-nofit-short", "f-hotd-nofit", "HOTDX~1.MKV", null, { status: "pending", titleOverridden: false, episodeOrder: 1 }),
  // Season 3's position-matched twin with no order at all: it should be frozen after one pass.
  video("v-frozen-a", "f-hotd-frozen", "HOTDF~1.MKV", "Zebra", { titleOverridden: false }),
  video("v-frozen-b", "f-hotd-frozen", "HOTDF~2.MKV", "Aardvark", { titleOverridden: false }),
  // Curated, not published: held back for a subtitle check.
  video("v-held", "f-hotd-s1", "HOTD S01E05.mkv", "Held for subtitles", { status: "curated", titleOverridden: true }),
  // Never curated, but inside the held-back folder.
  video("v-in-held", "f-hotd-held", "HOTD S01E01 DC.mkv", null, { status: "pending", titleOverridden: false }),
  video("v-bonus2", "f-latent", "LATENT.S02.Bonus.Ep.02.mkv", "Wrongly named", {
    titleOverridden: false,
    episodeOrder: 1,
    episodeArtwork: { seriesTmdbId: "101", season: 2, episode: 1, name: "Episode One", overview: "wrong", stillPath: "/latentS2E1.jpg", airDate: null, runtimeMinutes: null, rating: null, matchedAt: new Date() },
  }),
  video("v-bonus-clip", "f-latent", "LATENT.S02.Bonus.Clip.mkv", "A clip", {
    titleOverridden: true,
    episodeArtwork: { seriesTmdbId: "101", season: 2, episode: 1, name: "Episode One", overview: "wrong", stillPath: null, airDate: null, runtimeMinutes: null, rating: null, matchedAt: new Date() },
  }),
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
  // Up to three minutes: on a loaded machine, or against a freshly created Atlas database still
  // building its indexes, the backend can take well over a minute to start listening.
  for (let i = 0; i < 360 && !serverLog.includes("listening") && server.exitCode === null; i++) await sleep(500);
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
  const weaponsCard = (await api("/api/library", { token: viewer })).json?.videos?.find((v) => v.id === "v-weapons");
  check("cards carry the year and score", weaponsCard?.rating?.average === 7.4 && weaponsCard?.year === 2025);
  check("…and the genres and lead actors search and genre rows work from", JSON.stringify(weaponsCard?.genres) === JSON.stringify(["Horror", "Mystery", "Thriller"]) && weaponsCard?.castNames?.[0] === "Julia Garner", JSON.stringify({ g: weaponsCard?.genres, c: weaponsCard?.castNames }));
  const unknownCard = (await api("/api/library", { token: viewer })).json?.folders?.find((f) => f.id === "f-unknown");
  check("an unmatched title lists empty genres and cast, not missing fields", Array.isArray(unknownCard?.genres) && unknownCard.genres.length === 0 && unknownCard.castNames.length === 0, JSON.stringify(unknownCard));

  console.log("\nUsing TMDb's titles on purpose");
  // v-weapons has a hand-typed title, so the automatic pass left it alone (checked above). Asking
  // for TMDb's title is a different question, and overrides that.
  const renameOne = await api("/api/admin/catalog/artwork/video/v-weapons/use-tmdb-title", { token: admin, method: "POST" });
  check("a hand-typed name can be replaced on request", renameOne.status === 200 && renameOne.json?.to === "Weapons" && (await doc("video", "v-weapons"))?.title === "Weapons", JSON.stringify(renameOne.json));
  check("…and it stops counting as hand-typed, so re-matching keeps it current", (await doc("video", "v-weapons"))?.titleOverridden === false);
  check("an unmatched title has no TMDb name to take", (await api("/api/admin/catalog/artwork/folder/f-unknown/use-tmdb-title", { token: admin, method: "POST" })).json?.code === "not-found");
  check("viewers can't rename anything", (await api("/api/admin/catalog/artwork/video/v-weapons/use-tmdb-title", { token: viewer, method: "POST" })).status === 403);
  const renameAll = await api("/api/admin/catalog/artwork/use-tmdb-titles", { token: admin, method: "POST" });
  check("renaming everything reports only what it changed", renameAll.status === 200 && Array.isArray(renameAll.json?.renamed) && renameAll.json.renamed.every((r) => r.from !== r.to), JSON.stringify(renameAll.json));
  check("…and leaves an already-correct title alone", !renameAll.json.renamed.some((r) => r.id === "v-weapons"));

  console.log("\nEpisodes");
  const ep1 = await doc("video", "v-ep1");
  check("episode 1 is named from TMDb", ep1?.title === "The Heirs of the Dragon", JSON.stringify(ep1?.title));
  check("and keeps its synopsis, still, air date and number", ep1?.episodeArtwork?.overview === "Viserys hosts a tourney." && ep1.episodeArtwork.stillPath === "/hotdS1E1.jpg" && ep1.episodeArtwork.airDate === "2022-08-21" && ep1.episodeArtwork.episode === 1 && ep1.episodeArtwork.season === 1, JSON.stringify(ep1?.episodeArtwork));
  check("an episode TMDb has no name for keeps the one it had", (await doc("video", "v-ep2"))?.title === "Episode 2");
  check("an episode an admin named by hand is left alone", (await doc("video", "v-ep3"))?.title === "Renamed by hand");
  const forced = await api("/api/admin/catalog/artwork/folder/f-hotd/episodes", { token: admin, method: "POST", body: { force: true } });
  check("…until an admin asks for TMDb's names outright", forced.status === 200 && (await doc("video", "v-ep3"))?.title === "Second of His Name", JSON.stringify(forced.json));
  check("…and it stops counting as hand-typed", (await doc("video", "v-ep3"))?.titleOverridden === false);
  check("…while a never-curated episode still gets no title", (await doc("video", "v-ep-pending"))?.title === null);
  check("but still gets its synopsis and still", (await doc("video", "v-ep3"))?.episodeArtwork?.name === "Second of His Name");
  check("the episode's own still is served as its image", (await api("/api/thumbnail/v-ep1", { token: viewer })).buffer.equals(jpeg("w780/hotdS1E1.jpg")));
  check("an episode with no still falls through to Drive's frame", (await api("/api/thumbnail/v-ep2", { token: viewer })).status === 404);
  const seasonPage = (await api("/api/folder/f-hotd?season=f-hotd-s1", { token: viewer })).json;
  const rows = seasonPage?.seasonItems ?? [];
  check("episode rows carry the number, synopsis, runtime and score", rows[0]?.episodeNumber === 1 && rows[0]?.overview === "Viserys hosts a tourney." && rows[0]?.runtimeMinutes === 66 && rows[0]?.rating?.average === 8.1, JSON.stringify(rows[0]));
  const ordered = (await api("/api/folder/f-hotd?season=f-hotd-s1", { token: viewer })).json?.seasonItems ?? [];
  // Three, not four: the never-curated episode is still "pending", so viewers don't see it.
  check("renaming episodes doesn't scatter the season out of order", JSON.stringify(ordered.map((e) => e.episodeNumber)) === JSON.stringify([1, 2, 3]), JSON.stringify(ordered.map((e) => [e.episodeNumber, e.name])));
  check("…because the matched number is stored as the episode's order", (await doc("video", "v-ep3"))?.episodeOrder === 3);
  const playerEp = (await api("/api/video/v-ep1", { token: viewer })).json;
  check("the player knows which episode it is", playerEp?.episode?.number === 1 && playerEp?.episode?.season === 1 && playerEp?.episode?.overview === "Viserys hosts a tourney.", JSON.stringify(playerEp?.episode));
  check("a film has no episode block", movieFacts?.episode === null);
  const pending = await doc("video", "v-ep-pending");
  check("a never-curated episode gets the data but not a title", pending?.episodeArtwork?.episode === 4 && pending?.title === null && pending?.status === "pending", JSON.stringify({ t: pending?.title, s: pending?.status }));
  // Filenames, not positions.
  check("a missing episode doesn't shift the rest: the third file is episode 4", (await doc("video", "v-s2e4"))?.episodeArtwork?.episode === 4 && (await doc("video", "v-s2e4"))?.title === "The Red Dragon and the Gold", JSON.stringify((await doc("video", "v-s2e4"))?.episodeArtwork));
  check("…and the files before it are unaffected", (await doc("video", "v-s2e2"))?.title === "Rhaenyra the Cruel");
  check("a folder whose name says nothing is placed by its files' own season", (await doc("video", "v-lost"))?.episodeArtwork?.season === 2 && (await doc("video", "v-lost"))?.episodeArtwork?.episode === 3, JSON.stringify((await doc("video", "v-lost"))?.episodeArtwork));
  const epOf = async (id) => (await doc("video", id))?.episodeArtwork?.episode;
  check("readable names keep their numbers beside unreadable ones", (await epOf("v-s3e3")) === 3 && (await epOf("v-s3e4")) === 4, JSON.stringify([await epOf("v-s3e3"), await epOf("v-s3e4")]));
  check("unreadable short names fill the leftover numbers, in name order", (await epOf("v-s3-short1")) === 1 && (await epOf("v-s3-short2")) === 2, JSON.stringify([await epOf("v-s3-short1"), await epOf("v-s3-short2")]));
  check("more gaps than files to fill them: back to the library's own order, not a guess", (await epOf("v-nofit-short")) === 1 && (await epOf("v-nofit-e4")) === 2, JSON.stringify([await epOf("v-nofit-short"), await epOf("v-nofit-e4")]));
  check("a file that names its episode repairs a wrong stored order", (await doc("video", "v-s2e4"))?.episodeOrder === 4, String((await doc("video", "v-s2e4"))?.episodeOrder));
  check("in a folder matched by position, an admin's order is left alone", (await doc("video", "v-nofit-e4"))?.episodeOrder === 2 && (await doc("video", "v-nofit-short"))?.episodeOrder === 1, String((await doc("video", "v-nofit-e4"))?.episodeOrder));
  // Unordered and position-matched: "Aardvark" sorts first, so it's episode 1 — and renaming both
  // to their TMDb names must not reshuffle them on the next pass.
  check("an unordered position-matched folder is frozen in the order it was matched", (await doc("video", "v-frozen-b"))?.episodeOrder === 1 && (await doc("video", "v-frozen-a"))?.episodeOrder === 2, JSON.stringify([(await doc("video", "v-frozen-b"))?.episodeOrder, (await doc("video", "v-frozen-a"))?.episodeOrder]));
  await api("/api/admin/catalog/artwork/folder/f-hotd/episodes", { token: admin, method: "POST", body: {} });
  await api("/api/admin/catalog/artwork/folder/f-hotd/episodes", { token: admin, method: "POST", body: {} });
  check("…and stays matched the same way, run after run", (await epOf("v-frozen-b")) === 1 && (await epOf("v-frozen-a")) === 2 && (await epOf("v-nofit-short")) === 1 && (await epOf("v-nofit-e4")) === 2, JSON.stringify([await epOf("v-frozen-b"), await epOf("v-frozen-a"), await epOf("v-nofit-short"), await epOf("v-nofit-e4")]));
  check("an unordered episode is given its number as its order", (await doc("video", "v-s3e3"))?.episodeOrder === 3);
  check("a folder with nothing to go on stays unmatched", !(await doc("video", "v-making-of"))?.episodeArtwork);
  const bonus2 = await doc("video", "v-bonus2");
  check("a bonus file is matched to its TMDb special by name, not to a regular episode", bonus2?.episodeArtwork?.season === 0 && bonus2?.episodeArtwork?.episode === 13 && bonus2?.episodeArtwork?.overview === "The real bonus two.", JSON.stringify(bonus2?.episodeArtwork));
  check("…its wrong name is replaced with the special's", bonus2?.title === "S2 Bonus EP2 ft. Badshah", JSON.stringify(bonus2?.title));
  check("…and it sorts after the regular episodes, in bonus order", bonus2?.episodeOrder === 3, String(bonus2?.episodeOrder));
  const clip = await doc("video", "v-bonus-clip");
  check("a bonus nobody can match loses the wrong data it had", !clip?.episodeArtwork && clip?.title === "A clip", JSON.stringify(clip?.episodeArtwork));
  const latentRows = (await api("/api/folder/f-latent", { token: viewer })).json?.items ?? [];
  const bonusRow = latentRows.find((r) => r.id === "v-bonus2");
  check("a bonus row is labelled by its own order, not TMDb's special number", bonusRow?.episodeNumber === 3 && bonusRow?.overview === "The real bonus two.", JSON.stringify(bonusRow));
  check("the player doesn't call a special \"E13\"", (await api("/api/video/v-bonus2", { token: viewer })).json?.episode?.number === null);
  const latentEp = await doc("video", "v-latent-e1");
  check("a flat series takes its season from its own name", latentEp?.episodeArtwork?.season === 2 && latentEp?.title === "Episode One", JSON.stringify(latentEp?.episodeArtwork));

  console.log("\nPublishing what TMDb named");
  const publishPath = "/api/admin/catalog/artwork/folder/f-hotd/publish-episodes";
  check("viewers can't publish anything", (await api(publishPath, { token: viewer, method: "POST", body: { dryRun: true } })).status === 403);
  const preview = (await api(publishPath, { token: admin, method: "POST", body: { dryRun: true } })).json;
  const seasonOf = (id) => preview?.seasons?.find((s) => s.folderId === id);
  check("the preview lists never-curated episodes TMDb named", seasonOf("f-hotd-s1")?.episodes?.some((e) => e.id === "v-ep-pending" && e.name === "King of the Narrow Sea" && e.episode === 4), JSON.stringify(seasonOf("f-hotd-s1")));
  check("a season folder nobody published is published along with it", seasonOf("f-hotd-s3")?.publishesFolder === true && seasonOf("f-hotd-s3")?.episodes?.length === 4, JSON.stringify(seasonOf("f-hotd-s3")));
  check("episodes are listed in episode order", JSON.stringify(seasonOf("f-hotd-s3")?.episodes?.map((e) => e.episode)) === JSON.stringify([1, 2, 3, 4]));
  check("each season says how it was matched", seasonOf("f-hotd-s1")?.matchedBy === "filename" && seasonOf("f-hotd-s3")?.matchedBy === "filename+gaps");
  check("a season matched by position is flagged, since nothing confirms its names", seasonOf("f-hotd-nofit")?.matchedBy === "position", JSON.stringify(seasonOf("f-hotd-nofit")));
  const skippedFor = (id) => preview?.skipped?.find((x) => x.id === id)?.reason;
  check("a curated, unpublished episode is left alone — it was held back", skippedFor("v-held") === "held-back");
  check("so is everything in a held-back season folder", skippedFor("v-in-held") === "folder-held-back" && !seasonOf("f-hotd-held"));
  check("an episode TMDb couldn't name is reported, not guessed", skippedFor("v-making-of") === "no-tmdb-name");
  check("the preview writes nothing", preview?.published === false && (await doc("video", "v-ep-pending"))?.status === "pending" && (await doc("folder", "f-hotd-s3"))?.status === "pending");
  const noFlag = (await api(publishPath, { token: admin, method: "POST", body: {} })).json;
  check("anything short of an explicit dryRun: false is still only a preview", noFlag?.published === false && (await doc("video", "v-ep-pending"))?.status === "pending");

  const done = (await api(publishPath, { token: admin, method: "POST", body: { dryRun: false } })).json;
  const publishedEp = await doc("video", "v-ep-pending");
  check("publishing goes live with TMDb's name", done?.published === true && publishedEp?.status === "published" && publishedEp?.title === "King of the Narrow Sea", JSON.stringify({ s: publishedEp?.status, t: publishedEp?.title }));
  check("…credited to the admin who pressed it, and not counted as hand-typed", publishedEp?.curatedBy === envValue("ADMIN_EMAIL") && publishedEp?.titleOverridden === false);
  const s3 = await doc("folder", "f-hotd-s3");
  check("the season folder goes live under its Drive name", s3?.status === "published" && s3?.title === "Season 3", JSON.stringify({ s: s3?.status, t: s3?.title }));
  check("…with every episode in it", (await doc("video", "v-s3-short1"))?.status === "published" && (await doc("video", "v-s3-short1"))?.title === "Third Season One");
  check("held-back things are still held back", (await doc("video", "v-held"))?.status === "curated" && (await doc("video", "v-held"))?.title === "Held for subtitles" && (await doc("video", "v-in-held"))?.status === "pending" && (await doc("folder", "f-hotd-held"))?.status === "curated");
  check("the unnamed episode is still pending", (await doc("video", "v-making-of"))?.status === "pending");
  const liveSeason = (await api("/api/folder/f-hotd?season=f-hotd-s3", { token: viewer })).json;
  check("viewers can see the newly published season", liveSeason?.seasons?.some((s) => s.id === "f-hotd-s3") && liveSeason?.seasonItems?.length === 4, JSON.stringify(liveSeason?.seasonItems?.map((e) => e.name)));
  check("a title that isn't a series can't publish episodes", (await api("/api/admin/catalog/artwork/folder/f-unknown/publish-episodes", { token: admin, method: "POST", body: { dryRun: true } })).json?.code === "not-found");

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
