// Checks anime titles' AniList tables (lib/anilistLink.ts, lib/anilist.ts, lib/animeMap.ts) and the
// players that use them (lib/frameSource.ts, playersFor in lib/videoSources.ts):
//
//   1. the placement rules on fixed seasons shaped like real series (no network, no database);
//   2. the whole path against a local mock of AniList, TMDb and the mapping file — sequels the file
//      doesn't list, a sequel that belongs to another series, the search fallback, a film, AniList
//      down (nothing is stored) and rate-limited, an admin's table, and the players a viewer gets;
//   3. with --live, real series against the real AniList, TMDb (TMDB_API_KEY) and mapping file.
//
//   node apps/backend/scripts/smoke-anilist.mjs [path/to/.env] [--live]
//
// Uses a throwaway database (`campfire_anilist_smoke`, dropped at the end); needs MONGODB_URI.

import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LIVE = process.argv.includes("--live");
const envPath = process.argv.slice(2).find((a) => !a.startsWith("--")) || join(import.meta.dirname, "..", ".env");
for (const line of readFileSync(envPath, "utf-8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
}
const DB_NAME = "campfire_anilist_smoke";
process.env.MONGODB_DB_NAME = DB_NAME;
const REAL_TMDB_KEY = process.env.TMDB_API_KEY;
const MOCK_PORT = Number(process.env.SMOKE_PORT || 4141);
const MOCK = `http://127.0.0.1:${MOCK_PORT}`;
process.env.ANILIST_API_BASE = `${MOCK}/anilist`;
process.env.ANIME_MAP_URL = `${MOCK}/map.json`;
process.env.TMDB_API_BASE = `${MOCK}/tmdb`;
process.env.TMDB_API_KEY = "mock-key";

const require = createRequire(import.meta.url);
require("tsx/cjs");
const link = require("../src/lib/anilistLink.ts");
const animeMap = require("../src/lib/animeMap.ts");
const frame = require("../src/lib/frameSource.ts");
const sources = require("../src/lib/videoSources.ts");
const explore = require("../src/lib/explore.ts");
const { default: getClientPromise } = require("../src/lib/mongodb.ts");

let pass = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) pass++;
  else failures.push(`${name}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** `count` weekly episodes from `first`. */
function weekly(first, count, from = 1) {
  const start = Date.parse(first);
  return Array.from({ length: count }, (_, i) => ({ number: from + i, airDate: new Date(start + i * 7 * 86_400_000).toISOString().slice(0, 10) }));
}
const entry = (id, count, startDate, anchor = null, airing = false) => ({ id, count, startDate, airing, anchor, label: `entry ${id}` });

// ---- 1. Placement ------------------------------------------------------------------------------------
{
  // One TMDb season per AniList entry (Demon Slayer).
  const { segments, problems } = link.buildSegments(
    [
      { number: 1, episodes: weekly("2019-04-06", 26) },
      { number: 2, episodes: weekly("2021-10-10", 7) },
      { number: 3, episodes: weekly("2021-12-05", 11) },
    ],
    [entry(101922, 26, "2019-04-06", { season: 1, offset: 0 }), entry(129874, 7, "2021-10-10", { season: 2, offset: 0 }), entry(142329, 11, "2021-12-05", { season: 3, offset: 0 })],
  );
  check("season per entry: S1E26", same(link.episodeIn(segments, 1, 26), { id: 101922, episode: 26 }));
  check("season per entry: S3E1", same(link.episodeIn(segments, 3, 1), { id: 142329, episode: 1 }));
  check("season per entry: nothing past the end", link.episodeIn(segments, 3, 12) === null);
  check("season per entry: no problems", problems.length === 0, problems);
}
{
  // A TMDb season split in two on AniList (Attack on Titan S3).
  const { segments } = link.buildSegments(
    [{ number: 3, episodes: [...weekly("2018-07-23", 12), ...weekly("2019-04-29", 10, 13)] }],
    [entry(99147, 12, "2018-07-23", { season: 3, offset: 0 }), entry(104578, 10, "2019-04-29", { season: 3, offset: 12 })],
  );
  check("split season: S3E12 is part 1's last", same(link.episodeIn(segments, 3, 12), { id: 99147, episode: 12 }));
  check("split season: S3E13 is part 2's first", same(link.episodeIn(segments, 3, 13), { id: 104578, episode: 1 }));
  check("split season: S3E22", same(link.episodeIn(segments, 3, 22), { id: 104578, episode: 10 }));
}
{
  // TMDb lumps three entries into one season, and the file sends the middle one to a season TMDb
  // doesn't have (Jujutsu Kaisen); the last one isn't out yet.
  const { segments, problems } = link.buildSegments(
    [{ number: 1, episodes: [...weekly("2020-10-03", 24), ...weekly("2023-07-06", 23, 25), ...weekly("2026-01-08", 12, 48)] }],
    [
      entry(113415, 24, "2020-10-03", { season: 1, offset: 0 }),
      entry(145064, 23, "2023-07-06", { season: 2, offset: 0 }),
      entry(172463, 12, "2026-01-09", { season: 1, offset: 47 }),
      entry(209895, 0, null, { season: 1, offset: 59 }),
    ],
  );
  check("stale anchor: S1E25 placed by air date", same(link.episodeIn(segments, 1, 25), { id: 145064, episode: 1 }));
  check("stale anchor: S1E47", same(link.episodeIn(segments, 1, 47), { id: 145064, episode: 23 }));
  check("stale anchor: S1E48", same(link.episodeIn(segments, 1, 48), { id: 172463, episode: 1 }));
  check("stale anchor: S1E59", same(link.episodeIn(segments, 1, 59), { id: 172463, episode: 12 }));
  check("stale anchor: no problems", problems.length === 0, problems);
}
{
  // One AniList entry for the whole series, counted across TMDb's seasons (One Piece), still airing.
  const { segments } = link.buildSegments(
    [
      { number: 1, episodes: weekly("1999-10-20", 8) },
      { number: 2, episodes: weekly("1999-12-15", 22) },
      { number: 3, episodes: weekly("2000-05-17", 17) },
    ],
    [entry(21, 40, "1999-10-20", { season: null, offset: 0 }, true)],
  );
  check("whole series: S2E1 is episode 9", same(link.episodeIn(segments, 2, 1), { id: 21, episode: 9 }));
  check("whole series: S3E10 is episode 40", same(link.episodeIn(segments, 3, 10), { id: 21, episode: 40 }));
  check("whole series: still airing covers its season's rest", same(link.episodeIn(segments, 3, 17), { id: 21, episode: 47 }));
}
{
  // No file and no dates: entries follow one another from a season's start.
  const { segments } = link.buildSegments(
    [
      { number: 1, episodes: Array.from({ length: 12 }, (_, i) => ({ number: i + 1, airDate: null })) },
      { number: 2, episodes: Array.from({ length: 12 }, (_, i) => ({ number: i + 1, airDate: null })) },
    ],
    [entry(1, 12, null), entry(2, 12, null)],
  );
  check("no dates: S2E1 is the second entry", same(link.episodeIn(segments, 2, 1), { id: 2, episode: 1 }));
}
{
  // An entry whose start doesn't match any TMDb episode is left out, and the gap is reported.
  const { segments, problems } = link.buildSegments(
    [{ number: 1, episodes: weekly("2019-01-06", 12) }],
    [entry(5, 12, "2010-01-01", { season: 1, offset: 0 })],
  );
  check("wrong dates: nothing placed", segments.length === 0, segments);
  check("wrong dates: said why", problems.some((p) => p.includes("doesn't line up")) && problems.some((p) => p.includes("Season 1 episodes 1–12")), problems);
}
check("same air date: 3 days apart", link.sameAirDate("2021-12-05", "2021-12-08") === true);
check("same air date: a week apart", link.sameAirDate("2021-12-05", "2021-12-12") === false);
check("same air date: unknown", link.sameAirDate(null, "2021-12-05") === null);

// ---- Embed codes ---------------------------------------------------------------------------------------
{
  const code = (src) => `<iframe src="${src}" allowfullscreen></iframe>`;
  const anime = frame.parseFrameCode(code("https://anime.example/e/{{anilist_id}}/{{episode}}")).config;
  check("anilist code: episode alone is fine", anime.template === "https://anime.example/e/{{anilist_id}}/{{episode}}", anime.template);
  check("anilist code: filled", frame.frameUrl(anime, { id: "85937", season: 3, episode: 1 }, { id: 142329, episode: 1 }) === "https://anime.example/e/142329/1");
  check("anilist code: never a TMDb id", frame.frameUrl(anime, { id: "85937", season: 3, episode: 1 }, null) === null);
  const withSeason = frame.parseFrameCode(code("https://anime.example/{{anilist_id}}/{{season}}/{{episode}}")).config;
  check("anilist code: a season is 1", frame.frameUrl(withSeason, { id: "1", season: 3, episode: 5 }, { id: 9, episode: 2 }) === "https://anime.example/9/1/2");
  let refused = null;
  try {
    frame.parseFrameCode(code("https://tv.example/{{tmdb_id}}/{{episode}}"));
  } catch (error) {
    refused = error.message;
  }
  check("tmdb code: episode alone refused", !!refused && refused.includes("together"), refused);
  const tv = frame.parseFrameCode(code("https://tv.example/{{tmdb_id}}/{{season}}/{{episode}}")).config;
  check("tmdb code: unchanged", frame.frameUrl(tv, { id: "1396", season: 1, episode: 2 }) === "https://tv.example/1396/1/2");
}

// ---- 2. Mocked end to end ----------------------------------------------------------------------------
const anime = (id, format, episodes, startDate, status, native, sequels = [], extra = {}) => {
  const [y, m, d] = startDate ? startDate.split("-").map(Number) : [null, null, null];
  return {
    id, format, status, episodes, startDate: { year: y, month: m, day: d }, nextAiringEpisode: extra.next ? { episode: extra.next } : null,
    title: { native, romaji: extra.romaji ?? native, english: extra.english ?? null },
    relations: { edges: sequels.map(([sid, f]) => ({ relationType: "SEQUEL", node: { id: sid, type: "ANIME", format: f } })) },
  };
};
const ANILIST = new Map(
  [
    anime(101922, "TV", 26, "2019-04-06", "FINISHED", "鬼滅の刃", [[112151, "MOVIE"], [129874, "TV"]]),
    anime(112151, "MOVIE", 1, "2020-10-16", "FINISHED", "鬼滅の刃 無限列車編", [[142329, "TV"]]),
    anime(129874, "TV", 7, "2021-10-10", "FINISHED", "鬼滅の刃 無限列車編 (TV)", [[142329, "TV"]]),
    anime(142329, "TV", 11, "2021-12-05", "FINISHED", "鬼滅の刃 遊郭編", [[145139, "TV"], [777, "TV"]]),
    // Not in the file: found as a sequel.
    anime(145139, "TV", 11, "2023-04-09", "FINISHED", "鬼滅の刃 刀鍛冶の里編"),
    // A sequel the file gives to another series.
    anime(777, "TV", 12, "2023-04-09", "FINISHED", "別の作品"),
    anime(900, "SPECIAL", 1, "2020-08-26", "FINISHED", "鬼滅の刃 特別編"),
    anime(21519, "MOVIE", 1, "2016-08-26", "FINISHED", "君の名は。", [], { english: "Your Name." }),
    // Only findable by search; a decoy with the same title from another year.
    anime(5551, "TV", 12, "2022-01-09", "FINISHED", "検索の物語", [], { romaji: "Kensaku no Monogatari" }),
    anime(5552, "TV", 12, "2008-04-02", "FINISHED", "検索の物語"),
    anime(6001, "TV", 12, "2024-01-07", "FINISHED", "止まる物語"),
  ].map((m) => [m.id, m]),
);
const MAP = [
  { anilist_id: 101922, mal_id: 38000, themoviedb_id: { tv: 85937 }, season: { tvdb: 1, tmdb: 1 } },
  { anilist_id: 129874, mal_id: 49926, themoviedb_id: { tv: 85937 }, season: { tvdb: 2, tmdb: 2 } },
  { anilist_id: 142329, mal_id: 47778, themoviedb_id: { tv: 85937 }, season: { tvdb: 3, tmdb: 3 } },
  { anilist_id: 900, themoviedb_id: { tv: 85937 }, season: { tvdb: 0, tmdb: 0 } },
  { anilist_id: 777, themoviedb_id: { tv: 888 }, season: { tvdb: 1, tmdb: 1 } },
  { anilist_id: 6001, themoviedb_id: { tv: 556 }, season: { tvdb: 1, tmdb: 1 } },
  { anilist_id: 21519, themoviedb_id: { movie: 372058 } },
  { anilist_id: 1, mal_id: 1 }, // no TMDb id: skipped
];
const tvDetail = (id, name, original, first, seasons, language = "ja") => ({
  id, name, original_name: original, first_air_date: first, original_language: language, genres: language === "ja" ? [{ id: 16, name: "Animation" }] : [{ id: 18, name: "Drama" }],
  seasons: seasons.map(([n, count]) => ({ season_number: n, episode_count: count, name: `Season ${n}` })),
});
const TMDB = {
  "/tv/85937": tvDetail(85937, "Demon Slayer", "鬼滅の刃", "2019-04-06", [[0, 3], [1, 26], [2, 7], [3, 11], [4, 11]]),
  "/tv/85937/season/1": { episodes: weekly("2019-04-06", 26) },
  "/tv/85937/season/2": { episodes: weekly("2021-10-10", 7) },
  "/tv/85937/season/3": { episodes: weekly("2021-12-05", 11) },
  "/tv/85937/season/4": { episodes: weekly("2023-04-09", 11) },
  "/tv/555": tvDetail(555, "The Search Story", "検索の物語", "2022-01-09", [[1, 12]]),
  "/tv/555/season/1": { episodes: weekly("2022-01-09", 12) },
  "/tv/556": tvDetail(556, "The Stopped Story", "止まる物語", "2024-01-07", [[1, 12]]),
  "/tv/556/season/1": { episodes: weekly("2024-01-07", 12) },
  "/tv/1396": tvDetail(1396, "Breaking Bad", "Breaking Bad", "2008-01-20", [[1, 7]], "en"),
  "/tv/1396/season/1": { episodes: weekly("2008-01-20", 7) },
  "/movie/372058": { id: 372058, title: "Your Name.", original_title: "君の名は。", release_date: "2016-08-26", original_language: "ja", genres: [{ id: 16 }] },
};
for (const value of Object.values(TMDB)) {
  for (const e of value.episodes ?? []) {
    e.episode_number = e.number;
    e.air_date = e.airDate;
  }
}

let anilistDown = false;
let throttleNext = false;
let anilistCalls = 0;
const mock = createServer((req, res) => {
  const url = new URL(req.url, MOCK);
  const json = (status, body, headers = {}) => res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
  if (url.pathname === "/map.json") return json(200, MAP);
  if (url.pathname.startsWith("/tmdb/")) {
    const found = TMDB[url.pathname.slice("/tmdb".length)];
    return found ? json(200, found) : json(404, {});
  }
  if (url.pathname === "/anilist" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      anilistCalls++;
      if (anilistDown) return json(500, {});
      if (throttleNext) {
        throttleNext = false;
        return json(429, { errors: [{ message: "Too Many Requests." }] }, { "retry-after": "1" });
      }
      const { query, variables } = JSON.parse(body);
      let media = [];
      if (query.includes("id_in")) media = variables.ids.map((id) => ANILIST.get(id)).filter(Boolean);
      else if (query.includes("search")) {
        media = [...ANILIST.values()].filter(
          (m) => variables.f.includes(m.format) && [m.title.native, m.title.romaji, m.title.english].some((t) => t && t.includes(variables.q)),
        );
      }
      json(200, { data: { Page: { media } } }, { "x-ratelimit-limit": "90", "x-ratelimit-remaining": "80" });
    });
    return;
  }
  json(404, {});
});

const client = await getClientPromise();
const db = client.db(DB_NAME);
await db.dropDatabase();
await new Promise((resolve) => mock.listen(MOCK_PORT, "127.0.0.1", resolve));

try {
  await animeMap.ensureIndexes();
  const count = await animeMap.refreshAnimeMap();
  check("map: rows with a TMDb id", count === 7, count);
  const ds = await animeMap.mapEntriesFor("tv", "85937");
  check("map: a series' entries", ds.length === 4 && ds.some((e) => e.anilistId === 142329 && e.season === 3 && e.offset === 0), ds);

  const ep = (id, season, episode) => link.anilistFor({ type: "tv", id, season, episode }, 15_000);
  check("mock: S3E1 from the file", same(await ep("85937", 3, 1), { id: 142329, episode: 1 }));
  check("mock: S2E7", same(await ep("85937", 2, 7), { id: 129874, episode: 7 }));
  check("mock: S4E11 from a sequel the file lacks", same(await ep("85937", 4, 11), { id: 145139, episode: 11 }));
  check("mock: specials aren't matched", (await ep("85937", 0, 1)) === null);
  const details = await link.linkDetails("tv", "85937");
  check("mock: another series' sequel left out", !details.entries.some((e) => e.id === 777), details.entries.map((e) => e.id));
  check("mock: films and specials left out", !details.entries.some((e) => e.id === 112151 || e.id === 900));
  check("mock: from the file", details.origin === "map", details.origin);

  check("mock: a series found by search", same(await ep("555", 1, 12), { id: 5551, episode: 12 }));
  check("mock: search origin", (await link.linkDetails("tv", "555")).origin === "match");
  check("mock: a film", same(await link.anilistFor({ type: "movie", id: "372058" }, 15_000), { id: 21519, episode: 1 }));

  // AniList down: nothing is stored as "not on AniList".
  anilistDown = true;
  check("down: nothing for a new title", (await ep("556", 1, 1)) === null);
  check("down: nothing stored", (await db.collection("anilistLinks").findOne({ _id: "tv:556" })) === null);
  anilistDown = false;
  // Rate-limited: waits as told, then carries on.
  throttleNext = true;
  const before = Date.now();
  check("throttled: answers after the wait", same(await ep("556", 1, 3), { id: 6001, episode: 3 }));
  check("throttled: waited", Date.now() - before >= 900, Date.now() - before);

  // Stored: asking again costs AniList nothing.
  const calls = anilistCalls;
  await ep("85937", 3, 2);
  check("stored: no AniList call", anilistCalls === calls, anilistCalls - calls);

  // An admin's table, then off, then back to automatic.
  const bad = await link.parseAdminLink("tv", { segments: [{ season: 3, from: 1, to: 11, anilistId: 142329, shift: 0 }, { season: 3, from: 5, to: 6, anilistId: 142329, shift: 0 }] });
  check("admin: overlapping rows refused", typeof bad === "string" && bad.includes("overlap"), bad);
  const unknown = await link.parseAdminLink("tv", { segments: [{ season: 3, from: 1, to: 11, anilistId: 424242, shift: 0 }] });
  check("admin: unknown entry refused", typeof unknown === "string" && unknown.includes("424242"), unknown);
  const table = await link.parseAdminLink("tv", { segments: [{ season: 3, from: 1, to: 11, anilistId: 142329, shift: 5 }] });
  check("admin: a table", typeof table === "object", table);
  await link.setAdminLink("tv", "85937", table);
  check("admin: used", same(await ep("85937", 3, 1), { id: 142329, episode: 6 }));
  check("admin: only its rows", (await ep("85937", 1, 1)) === null);
  await link.setAdminLink("tv", "85937", await link.parseAdminLink("tv", { off: true }));
  check("admin: off", (await ep("85937", 3, 1)) === null);
  await link.setAdminLink("tv", "85937", null);
  check("admin: back to automatic", same(await ep("85937", 3, 1), { id: 142329, episode: 1 }));
  const film = await link.parseAdminLink("movie", { movie: 21519 });
  check("admin: a film's entry", typeof film === "object" && film.movie === 21519, film);

  // The players a viewer gets.
  await sources.createSource("frame", {
    name: "Anime player",
    codes: {
      tv: '<iframe src="https://tv.example/{{tmdb_id}}/{{season}}/{{episode}}"></iframe>',
      anime: '<iframe src="https://anime.example/e/{{anilist_id}}/{{episode}}"></iframe>',
    },
  });
  const frames = async (seriesTmdbId, season, episode) =>
    (await sources.playersFor({ _id: `tmdb:tv:${seriesTmdbId}:s${season}e${episode}`, episodeArtwork: { seriesTmdbId, season, episode } }, { all: true }))
      .filter((p) => p.kind === "frame")
      .map((p) => p.url);
  check("players: an anime episode by AniList id", same(await frames("85937", 4, 2), ["https://anime.example/e/145139/2"]), await frames("85937", 4, 2));
  check("players: not anime, by TMDb id", same(await frames("1396", 1, 2), ["https://tv.example/1396/1/2"]));
  check("players: a special gets none", same(await frames("85937", 0, 1), []));
} finally {
  mock.close();
}

// ---- 3. Live --------------------------------------------------------------------------------------------
if (LIVE) {
  if (!REAL_TMDB_KEY) {
    failures.push("live: TMDB_API_KEY isn't set");
  } else {
    await db.dropDatabase();
    delete process.env.ANILIST_API_BASE;
    delete process.env.ANIME_MAP_URL;
    delete process.env.TMDB_API_BASE;
    process.env.TMDB_API_KEY = REAL_TMDB_KEY;
    explore.clearExploreCache();
    await animeMap.ensureIndexes();
    const rows = await animeMap.refreshAnimeMap();
    check("live: the mapping file", rows > 5000, rows);
    const cases = [
      ["Demon Slayer S1E26", "tv", "85937", 1, 26, 101922, 26],
      ["Demon Slayer S2E1", "tv", "85937", 2, 1, 129874, 1],
      ["Demon Slayer S3E1", "tv", "85937", 3, 1, 142329, 1],
      ["Demon Slayer S5E8", "tv", "85937", 5, 8, 166240, 8],
      ["Attack on Titan S3E12", "tv", "1429", 3, 12, 99147, 12],
      ["Attack on Titan S3E13", "tv", "1429", 3, 13, 104578, 1],
      ["Jujutsu Kaisen S1E24", "tv", "95479", 1, 24, 113415, 24],
      ["Jujutsu Kaisen S1E25", "tv", "95479", 1, 25, 145064, 1],
      ["Jujutsu Kaisen S1E48", "tv", "95479", 1, 48, 172463, 1],
      ["Spy x Family S1E13", "tv", "120089", 1, 13, 142838, 1],
      ["One Piece S1E1", "tv", "37854", 1, 1, 21, 1],
      ["Your Name (film)", "movie", "372058", null, null, 21519, 1],
    ];
    for (const [name, type, id, season, episode, wantId, wantEpisode] of cases) {
      const got = await link.anilistFor(type === "movie" ? { type, id } : { type, id, season, episode }, 60_000);
      console.log(`  ${name.padEnd(24)} → ${got ? `AniList ${got.id} episode ${got.episode}` : "none"}`);
      check(`live: ${name}`, same(got, { id: wantId, episode: wantEpisode }), got);
    }
    // TMDb numbers One Piece's episodes across the series even within its seasons: S2 starts at 62.
    const onePiece = await link.anilistFor({ type: "tv", id: "37854", season: 2, episode: 62 }, 60_000);
    console.log(`  ${"One Piece S2E62".padEnd(24)} → ${onePiece ? `AniList ${onePiece.id} episode ${onePiece.episode}` : "none"}`);
    check("live: One Piece S2E62", same(onePiece, { id: 21, episode: 62 }), onePiece);
    for (const [type, id] of [["tv", "85937"], ["tv", "1429"], ["tv", "95479"], ["tv", "37854"]]) {
      const d = await link.linkDetails(type, id);
      if (d.problems.length) console.log(`  ${d.title}: ${d.problems.join("; ")}`);
    }
  }
}

await db.dropDatabase();
await client.close();
console.log(`\n${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length ? 1 : 0);
