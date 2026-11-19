// End-to-end smoke test for the movie/series requests feature: submission (link and image),
// validation, dedupe, the form's TMDb title search, upvoting, the admin queue and its enforced
// transitions, and the fulfilled-request spotlight slide that comes out the other end.
//
// Self-contained, like smoke-artwork.mjs — from apps/backend:
//
//   node --import tsx scripts/smoke-requests.mjs [path/to/.env]
//
// It seeds two throwaway databases (`campfire_requests_smoke`, and `…_nokey` for the backend
// started without a TMDb key; both dropped again at the end), starts a mock TMDb, and starts the
// real backend twice — once pointed at the mock, once with no TMDB_API_KEY at all — then drives
// both over HTTP. Needs MONGODB_URI, DRIVE_ROOT_FOLDER_ID and the admin login from the backend
// .env; nothing here reaches TMDb, Drive or LiveKit, and the database the .env names is never
// touched.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient } from "mongodb";

const envPath = process.argv[2] || join(import.meta.dirname, "..", ".env");
const envText = readFileSync(envPath, "utf-8");
const envValue = (name) => envText.match(new RegExp(`^${name}=(.*)$`, "m"))?.[1].trim().replace(/^"|"$/g, "");
const ROOT = envValue("DRIVE_ROOT_FOLDER_ID");
const ADMIN_EMAIL = envValue("ADMIN_EMAIL");
const ADMIN_PASSWORD = envValue("ADMIN_PASSWORD");
const DB_NAME = "campfire_requests_smoke";
const NOKEY_DB_NAME = "campfire_requests_smoke_nokey";
const PORT = 4111;
const NOKEY_PORT = 4115;
const MOCK_PORT = 4116;
const BASE = `http://127.0.0.1:${PORT}`;
const NOKEY_BASE = `http://127.0.0.1:${NOKEY_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function api(path, { token, method = "GET", body, raw, contentType, base = BASE } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (raw) {
    headers["content-type"] = contentType;
    payload = raw;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* binary or empty */ }
  return { status: res.status, json, text, res };
}

// --- mock TMDb -----------------------------------------------------------------------------------
// One search ("smoke") covering every case the endpoint has to tell apart: a person and a
// collection to drop, a film and a series already in the library, a film sharing the series' id
// (TMDb numbers the two separately), one that's in the catalog but unpublished, titles already
// asked for three different ways, and enough filler to go past the ten-result cap.
const longOverview =
  "A smoke test film whose synopsis runs on and on, far longer than a search result row has room " +
  "for, so that the endpoint has to cut it at a word boundary and add an ellipsis instead of " +
  "sending the whole paragraph to a phone that will only ever show two lines of it anyway.";
const multi = {
  smoke: [
    { media_type: "person", id: 1, name: "Smoke Person", known_for: [] },
    { media_type: "movie", id: 9001, title: "Smoke Linked Movie", release_date: "2019-05-01", poster_path: "/smokeMovie.jpg", overview: longOverview },
    { media_type: "tv", id: 9002, name: "Smoke Linked Series", first_air_date: "2021-01-01", poster_path: null, overview: "A series." },
    { media_type: "collection", id: 77, name: "Smoke Collection" },
    { media_type: "movie", id: 9002, title: "Smoke Namesake Film", release_date: "", poster_path: null },
    { media_type: "movie", id: 9003, title: "Smoke Picked Film", release_date: "2020-02-02", poster_path: "/picked.jpg", overview: "Picked from search." },
    { media_type: "tv", id: 9004, name: "Smoke Unenriched Show", first_air_date: "2018-03-03" },
    { media_type: "movie", id: 9005, title: "Smoke Held Back", release_date: "2017-01-01" },
    { media_type: "movie", id: 9006, title: "Smoke Requested Film", release_date: "1999-03-31" },
    ...Array.from({ length: 6 }, (_, i) => ({ media_type: "movie", id: 9100 + i, title: `Smoke Filler ${i + 1}` })),
  ],
};
let multiHits = 0;
const mock = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  if (url.searchParams.get("api_key") !== "smoke-key") return res.writeHead(401).end("{}");
  const json = (body, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  if (url.pathname === "/3/search/multi") {
    multiHits++;
    const query = (url.searchParams.get("query") ?? "").toLowerCase();
    if (query === "fail") return json({ status_code: 11 }, 500);
    if (url.searchParams.get("include_adult") !== "false") return json({ results: [{ media_type: "movie", id: 666, title: "Adult content leaked" }] });
    return json({ results: multi[query] ?? [] });
  }
  // The startup auto-match searches the seeded titles; nothing should match them.
  if (url.pathname === "/3/search/movie" || url.pathname === "/3/search/tv") return json({ results: [] });
  if (url.pathname === "/3/movie/9003") {
    return json({ id: 9003, title: "Smoke Picked Film", release_date: "2020-02-02", poster_path: "/picked.jpg", overview: "Picked from search." });
  }
  // The IMDb link the request flow below submits resolves, through TMDb's /find, to 9006.
  if (url.pathname === "/3/find/tt0133093") {
    return json({ movie_results: [{ id: 9006, title: "Smoke Requested Film", release_date: "1999-03-31", poster_path: null }], tv_results: [] });
  }
  // Everything else — /tv/9004 included, which is how that request ends up unenriched.
  json({ status_code: 34 }, 404);
});
await new Promise((r) => mock.listen(MOCK_PORT, "127.0.0.1", r));

// --- seed ----------------------------------------------------------------------------------------
// The backend seeds its admin account at startup, into whichever database it's pointed at, so the
// databases are dropped and seeded *before* either backend starts. The library endpoint only lists
// children of DRIVE_ROOT_FOLDER_ID, so the seeded items hang off the real configured root.
const mongo = new MongoClient(envValue("MONGODB_URI"));
await mongo.connect();
const db = mongo.db(DB_NAME);
const nokeyDb = mongo.db(NOKEY_DB_NAME);
await db.dropDatabase();
await nokeyDb.dropDatabase();
const now = new Date();
const artwork = (tmdbType, tmdbId, title) => ({
  source: "link", tmdbType, tmdbId, title, year: null, overview: null, backdropPath: null, posterPath: null,
  // `cast` marks a current match, so the startup top-up doesn't try to re-fetch it.
  matchedAt: now, cast: [],
});
const video = (id, title, extra = {}) => ({
  _id: id, parentFolderId: ROOT, driveName: `${title}.mkv`, mimeType: "video/x-matroska", sizeBytes: 1234567,
  durationSeconds: 5400, status: "published", title, subtitleSetIds: [], introStart: null, introEnd: null,
  outroStart: null, episodeOrder: null, titleOverridden: true, introOverridden: false, renditions: {},
  createdAt: now, curatedAt: now, curatedBy: "smoke", updatedAt: now, ...extra,
});
const folder = (id, title, extra = {}) => ({
  _id: id, parentFolderId: ROOT, driveName: title, status: "published", title, thumbnailFileId: null,
  createdAt: now, curatedAt: now, curatedBy: "smoke", updatedAt: now, ...extra,
});
await db.collection("catalogVideos").insertMany([
  // What the fulfilled request below gets linked to (and the spotlight slide plays).
  video("smoke-video-1", "Smoke Test Movie"),
  video("smoke-video-tmdb", "Smoke Linked Movie", { artwork: artwork("movie", "9001", "Smoke Linked Movie") }),
  // Matched, but held back by the admin — not something a requester can open yet.
  video("smoke-video-held", "Smoke Held Back", { status: "curated", artwork: artwork("movie", "9005", "Smoke Held Back") }),
]);
await db.collection("catalogFolders").insertMany([
  folder("smoke-folder-1", "Smoke Test Series"),
  folder("smoke-folder-tmdb", "Smoke Linked Series", { artwork: artwork("tv", "9002", "Smoke Linked Series") }),
]);

// --- start the backend, twice ----------------------------------------------------------------------
const imagesDir = mkdtempSync(join(tmpdir(), "campfire-request-images-"));
const artworkDir = mkdtempSync(join(tmpdir(), "campfire-request-artwork-"));
const backendDir = join(import.meta.dirname, "..");
function startBackend(port, env) {
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: backendDir,
    env: { ...env, PORT: String(port), REQUEST_IMAGES_DIR: imagesDir, ARTWORK_DIR: artworkDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const handle = { child, log: "" };
  child.stdout.on("data", (d) => (handle.log += d));
  child.stderr.on("data", (d) => (handle.log += d));
  return handle;
}
const keyed = startBackend(PORT, {
  ...process.env,
  MONGODB_DB_NAME: DB_NAME,
  TMDB_API_KEY: "smoke-key",
  TMDB_API_BASE: `http://127.0.0.1:${MOCK_PORT}/3`,
  TMDB_IMAGE_BASE: `http://127.0.0.1:${MOCK_PORT}/t/p`,
});
// The .env sets a real TMDB_API_KEY, and an empty variable can't be relied on to reach a child
// process on Windows, so the key-less backend reads a copy of the .env with that one line removed.
const nokeyEnvPath = join(imagesDir, "nokey.env");
writeFileSync(nokeyEnvPath, envText.replace(/^TMDB_API_KEY=.*$/m, ""));
const nokeyProcessEnv = { ...process.env, MONGODB_DB_NAME: NOKEY_DB_NAME, DOTENV_CONFIG_PATH: nokeyEnvPath };
delete nokeyProcessEnv.TMDB_API_KEY;
const nokey = startBackend(NOKEY_PORT, nokeyProcessEnv);

async function cleanup() {
  keyed.child.kill();
  nokey.child.kill();
  mock.close();
  await db.dropDatabase().catch(() => {});
  await nokeyDb.dropDatabase().catch(() => {});
  await mongo.close();
  rmSync(imagesDir, { recursive: true, force: true });
  rmSync(artworkDir, { recursive: true, force: true });
}

try {
  // Up to three minutes (the two start side by side): on a loaded machine, or against a freshly
  // created Atlas database still building its indexes, the backend can take well over a minute.
  const up = (h) => h.log.includes("listening");
  const exited = () => keyed.child.exitCode !== null || nokey.child.exitCode !== null;
  for (let i = 0; i < 360 && !(up(keyed) && up(nokey)) && !exited(); i++) await sleep(500);
  if (!up(keyed)) throw new Error(`backend didn't start:\n${keyed.log}`);
  if (!up(nokey)) throw new Error(`key-less backend didn't start:\n${nokey.log}`);

  // --- sign in -----------------------------------------------------------------------------------
  const adminLogin = await api("/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  check("admin can sign in", adminLogin.status === 200 && !!adminLogin.json?.token, `status ${adminLogin.status}`);
  const adminToken = adminLogin.json?.token;

  const viewerEmail = `smoke-viewer-${Date.now()}@example.test`;
  const signup = await api("/auth/signup", { method: "POST", body: { email: viewerEmail, password: "smoke-pass-123", name: "Smoke Viewer" } });
  check("a normal viewer can sign up", signup.status === 200 || signup.status === 201, `status ${signup.status} ${signup.text.slice(0, 120)}`);
  const viewerToken = signup.json?.token ?? (await api("/auth/login", { method: "POST", body: { email: viewerEmail, password: "smoke-pass-123" } })).json?.token;
  check("viewer has a token", !!viewerToken);

  // --- validation --------------------------------------------------------------------------------
  const noRef = await api("/api/requests", { token: viewerToken, method: "POST", body: { title: "No Reference Here" } });
  check("request with no reference is rejected", noRef.status === 400 && noRef.json?.field === "reference", `status ${noRef.status} field ${noRef.json?.field}`);

  const noTitle = await api("/api/requests", { token: viewerToken, method: "POST", body: { refLink: "https://www.imdb.com/title/tt0133093/" } });
  check("request with no title is rejected", noTitle.status === 400 && noTitle.json?.field === "title", `status ${noTitle.status} field ${noTitle.json?.field}`);

  const badLink = await api("/api/requests", { token: viewerToken, method: "POST", body: { title: "Bad Link", refLink: "https://example.com/not-a-title" } });
  check("unsupported link is rejected", badLink.status === 400 && badLink.json?.field === "refLink", `status ${badLink.status}`);

  const resolveBad = await api("/api/requests/resolve-link", { token: viewerToken, method: "POST", body: { link: "https://example.com/nope" } });
  check("resolve-link rejects a non-title URL", resolveBad.status === 400 && resolveBad.json?.code === "unsupported_link", `status ${resolveBad.status}`);

  const resolveImdb = await api("/api/requests/resolve-link", { token: viewerToken, method: "POST", body: { link: "https://www.imdb.com/title/tt0133093/" } });
  check("resolve-link accepts an IMDb URL", resolveImdb.status === 200 && resolveImdb.json?.ok === true, `status ${resolveImdb.status}`);
  console.log(`        (enrichment ${resolveImdb.json?.meta ? "ON — TMDB_API_KEY configured" : "OFF — no TMDB_API_KEY, link stored bare"})`);

  const resolveBare = await api("/api/requests/resolve-link", { token: viewerToken, method: "POST", body: { link: "tt0133093" } });
  check("resolve-link accepts a bare tt id", resolveBare.status === 200 && resolveBare.json?.ok === true);

  const resolveTmdb = await api("/api/requests/resolve-link", { token: viewerToken, method: "POST", body: { link: "https://www.themoviedb.org/tv/1399" } });
  check("resolve-link accepts a TMDb tv URL", resolveTmdb.status === 200 && resolveTmdb.json?.ok === true);

  // --- submit via link ---------------------------------------------------------------------------
  const linkReq = await api("/api/requests", { token: viewerToken, method: "POST", body: { title: "Smoke Requested Film", refLink: "https://www.imdb.com/title/tt0133093/" } });
  check("submit with an IMDb link", linkReq.status === 201 && !!linkReq.json?.request?.id, `status ${linkReq.status} ${linkReq.text.slice(0, 160)}`);
  const linkReqId = linkReq.json?.request?.id;
  check("requester counts as wanting it", linkReq.json?.request?.wantCount === 1 && linkReq.json?.request?.iWantIt === true);
  check("new request starts in 'new'", linkReq.json?.request?.status === "new");

  // --- dedupe ------------------------------------------------------------------------------------
  const match = await api(`/api/requests/match?title=${encodeURIComponent("the smoke requested film!")}`, { token: viewerToken });
  check("dedupe match ignores articles/punctuation", match.status === 200 && match.json?.match?.id === linkReqId, `got ${match.json?.match?.id}`);

  const shortMatch = await api("/api/requests/match?title=a", { token: viewerToken });
  check("dedupe ignores 1-char queries", shortMatch.json?.match === null);

  // --- title search ------------------------------------------------------------------------------
  const search = (q, token, base) => api(`/api/requests/tmdb-search?q=${encodeURIComponent(q)}`, { token, base });
  const find = (list, tmdbType, tmdbId) => list?.find((r) => r.tmdbType === tmdbType && r.tmdbId === tmdbId);

  const anonSearch = await search("smoke");
  check("search needs a signed-in user", anonSearch.status === 401, `status ${anonSearch.status}`);

  const hitsBeforeShort = multiHits;
  const shortSearch = await search("a", viewerToken);
  check("a 1-character search answers empty without asking TMDb", shortSearch.status === 200 && shortSearch.json?.available === true && shortSearch.json?.results?.length === 0 && multiHits === hitsBeforeShort, `${shortSearch.status} ${shortSearch.text.slice(0, 120)}`);
  const emptySearch = await search("", viewerToken);
  check("an empty search says search is available", emptySearch.json?.available === true && emptySearch.json?.results?.length === 0);

  const smoke = await search("smoke", viewerToken);
  const results = smoke.json?.results ?? [];
  check("search returns available results", smoke.status === 200 && smoke.json?.available === true && results.length > 0, `${smoke.status} ${smoke.text.slice(0, 160)}`);
  check("search caps results at ten", results.length === 10, `${results.length} results`);
  check("search keeps only films and series", results.every((r) => r.tmdbType === "movie" || r.tmdbType === "tv") && !results.some((r) => r.tmdbId === "1" || r.tmdbId === "77"), JSON.stringify(results.map((r) => `${r.tmdbType}:${r.tmdbId}`)));
  check("search asks TMDb for no adult titles", !results.some((r) => r.tmdbId === "666"));
  check(
    "every result has the documented shape",
    results.every((r) => typeof r.tmdbId === "string" && typeof r.title === "string" && r.title && (r.year === null || Number.isInteger(r.year)) &&
      "overview" in r && "posterUrl" in r && typeof r.link === "string" && "inLibrary" in r && "existingRequest" in r),
    JSON.stringify(results[0]),
  );
  const linkedMovie = find(results, "movie", "9001");
  check("a film result has its year, link and w185 poster", linkedMovie?.year === 2019 && linkedMovie?.link === "https://www.themoviedb.org/movie/9001" && linkedMovie?.posterUrl === "https://image.tmdb.org/t/p/w185/smokeMovie.jpg", JSON.stringify(linkedMovie));
  check("a long overview is cut short", linkedMovie?.overview?.length <= 181 && linkedMovie?.overview?.endsWith("…"), JSON.stringify(linkedMovie?.overview));
  const linkedSeries = find(results, "tv", "9002");
  check("a series result links to TMDb's tv page, no poster → null", linkedSeries?.link === "https://www.themoviedb.org/tv/9002" && linkedSeries?.posterUrl === null && linkedSeries?.year === 2021, JSON.stringify(linkedSeries));
  check("a film already in the library says so", linkedMovie?.inLibrary?.kind === "video" && linkedMovie?.inLibrary?.id === "smoke-video-tmdb", JSON.stringify(linkedMovie?.inLibrary));
  check("a series already in the library says so", linkedSeries?.inLibrary?.kind === "folder" && linkedSeries?.inLibrary?.id === "smoke-folder-tmdb", JSON.stringify(linkedSeries?.inLibrary));
  check("a film sharing a series' TMDb id isn't mistaken for it", find(results, "movie", "9002")?.inLibrary === null && find(results, "movie", "9002")?.year === null);
  check("an unpublished match isn't offered as in the library", find(results, "movie", "9005")?.inLibrary === null);
  const imdbAsked = find(results, "movie", "9006");
  check("a request made with an IMDb link is found by its TMDb id", imdbAsked?.existingRequest?.id === linkReqId && imdbAsked?.existingRequest?.wantCount === 1 && imdbAsked?.existingRequest?.status === "new", JSON.stringify(imdbAsked?.existingRequest));
  check("…and the requester is told it's already theirs", imdbAsked?.existingRequest?.iWantIt === true);
  const picked = find(results, "movie", "9003");
  check("a title nobody asked for has no existing request", picked && picked.existingRequest === null && picked.inLibrary === null, JSON.stringify(picked));

  // A third account does the picking, so the viewer's own list stays what the checks below expect.
  const searcherEmail = `smoke-searcher-${Date.now()}@example.test`;
  await api("/auth/signup", { method: "POST", body: { email: searcherEmail, password: "smoke-pass-123", name: "Smoke Searcher" } });
  const searcherToken = (await api("/auth/login", { method: "POST", body: { email: searcherEmail, password: "smoke-pass-123" } })).json?.token;
  const pickedReq = await api("/api/requests", { token: searcherToken, method: "POST", body: { title: picked?.title, refLink: picked?.link } });
  check("a picked result submits with its exact TMDb link", pickedReq.status === 201 && pickedReq.json?.request?.refLink === "https://www.themoviedb.org/movie/9003" && pickedReq.json?.request?.refMeta?.sourceId === "9003" && pickedReq.json?.request?.type === "movie", `${pickedReq.status} ${pickedReq.text.slice(0, 200)}`);
  const unenriched = await api("/api/requests", { token: searcherToken, method: "POST", body: { title: "Smoke Unenriched Show", refLink: "https://www.themoviedb.org/tv/9004" } });
  check("a TMDb link the lookup can't resolve is still accepted", unenriched.status === 201 && unenriched.json?.request?.refMeta === null, `${unenriched.status}`);

  const again = (await search("smoke", adminToken)).json?.results ?? [];
  check("the picked title now shows its open request", find(again, "movie", "9003")?.existingRequest?.id === pickedReq.json?.request?.id && find(again, "movie", "9003")?.existingRequest?.wantCount === 1);
  check("…which someone else hasn't voted for yet", find(again, "movie", "9003")?.existingRequest?.iWantIt === false);
  check("an unenriched TMDb link still matches by the link itself", find(again, "tv", "9004")?.existingRequest?.id === unenriched.json?.request?.id, JSON.stringify(find(again, "tv", "9004")));
  check("matching is per type: the film 9002 has no request", find(again, "movie", "9002")?.existingRequest === null);
  const voted = await api(`/api/requests/${find(again, "movie", "9003")?.existingRequest?.id}/upvote`, { token: adminToken, method: "POST", body: { wantsIt: true } });
  check("voting from a search result uses the existing upvote", voted.json?.request?.wantCount === 2, `count ${voted.json?.request?.wantCount}`);
  const afterVote = (await search("smoke", adminToken)).json?.results ?? [];
  check("…and the next search reflects the vote", find(afterVote, "movie", "9003")?.existingRequest?.wantCount === 2 && find(afterVote, "movie", "9003")?.existingRequest?.iWantIt === true);

  const failing = await search("fail", viewerToken);
  check("a TMDb outage is an error, not an empty list", failing.status === 502 && typeof failing.json?.error === "string", `${failing.status} ${failing.text.slice(0, 120)}`);

  const nokeyViewerEmail = `smoke-nokey-${Date.now()}@example.test`;
  await api("/auth/signup", { method: "POST", body: { email: nokeyViewerEmail, password: "smoke-pass-123", name: "No Key" }, base: NOKEY_BASE });
  const nokeyToken = (await api("/auth/login", { method: "POST", body: { email: nokeyViewerEmail, password: "smoke-pass-123" }, base: NOKEY_BASE })).json?.token;
  const hitsBeforeNokey = multiHits;
  const nokeySearch = await search("smoke", nokeyToken, NOKEY_BASE);
  check("without a TMDb key search reports itself unavailable", nokeySearch.status === 200 && nokeySearch.json?.available === false && nokeySearch.json?.results?.length === 0 && multiHits === hitsBeforeNokey, `${nokeySearch.status} ${nokeySearch.text.slice(0, 120)}`);
  const nokeyEmpty = await search("", nokeyToken, NOKEY_BASE);
  check("…including for the empty probe a form sends on open", nokeyEmpty.json?.available === false);
  const nokeyLink = await api("/api/requests", { token: nokeyToken, method: "POST", body: { title: "Smoke No Key Film", refLink: "https://www.themoviedb.org/movie/9003" }, base: NOKEY_BASE });
  check("…and the paste-a-link fallback still works there", nokeyLink.status === 201 && nokeyLink.json?.request?.refMeta === null, `${nokeyLink.status}`);

  // --- image upload ------------------------------------------------------------------------------
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const upload = await api("/api/requests/reference-image", { token: viewerToken, method: "POST", raw: PNG, contentType: "image/png" });
  check("reference image uploads", upload.status === 200 && !!upload.json?.imageId, `status ${upload.status} ${upload.text.slice(0, 120)}`);
  const imageId = upload.json?.imageId;

  const badType = await api("/api/requests/reference-image", { token: viewerToken, method: "POST", raw: Buffer.from("not an image"), contentType: "text/plain" });
  check("non-image upload is refused", badType.status === 415, `status ${badType.status}`);

  const tooBig = await api("/api/requests/reference-image", { token: viewerToken, method: "POST", raw: Buffer.alloc(6 * 1024 * 1024, 1), contentType: "image/png" });
  check("over-5MB upload is refused", tooBig.status === 413, `status ${tooBig.status}`);

  const imageReq = await api("/api/requests", { token: viewerToken, method: "POST", body: { title: "Smoke Image Only Ask", refImageId: imageId } });
  check("submit with an image only", imageReq.status === 201, `status ${imageReq.status} ${imageReq.text.slice(0, 160)}`);
  const imageReqId = imageReq.json?.request?.id;
  check("image-only request has null type/year", imageReq.json?.request?.type === null && imageReq.json?.request?.year === null);

  const imgFetch = await api(`/api/request-image/${imageId}`, { token: viewerToken });
  check("reference image is served to a signed-in user", imgFetch.status === 200 && imgFetch.res.headers.get("content-type") === "image/png", `status ${imgFetch.status}`);
  const imgNoAuth = await api(`/api/request-image/${imageId}`);
  check("reference image refuses anonymous access", imgNoAuth.status === 401, `status ${imgNoAuth.status}`);
  const imgTraversal = await api("/api/request-image/..%2F..%2F.env", { token: viewerToken });
  check("reference image rejects a traversal id", imgTraversal.status === 400 || imgTraversal.status === 404, `status ${imgTraversal.status}`);

  // --- board + upvote ----------------------------------------------------------------------------
  const board = await api("/api/requests", { token: adminToken });
  check("board shows everyone's requests", board.json?.requests?.length >= 2, `${board.json?.requests?.length} rows`);

  const upvote = await api(`/api/requests/${linkReqId}/upvote`, { token: adminToken, method: "POST", body: { wantsIt: true } });
  check("another user can upvote", upvote.json?.request?.wantCount === 2, `count ${upvote.json?.request?.wantCount}`);
  const upvoteAgain = await api(`/api/requests/${linkReqId}/upvote`, { token: adminToken, method: "POST", body: { wantsIt: true } });
  check("upvote is idempotent", upvoteAgain.json?.request?.wantCount === 2, `count ${upvoteAgain.json?.request?.wantCount}`);
  const unvote = await api(`/api/requests/${linkReqId}/upvote`, { token: adminToken, method: "POST", body: { wantsIt: false } });
  check("upvote can be withdrawn", unvote.json?.request?.wantCount === 1);
  await api(`/api/requests/${linkReqId}/upvote`, { token: adminToken, method: "POST", body: { wantsIt: true } });

  // --- admin -------------------------------------------------------------------------------------
  const adminList = await api("/api/admin/requests", { token: adminToken });
  check("admin list returns counts", adminList.status === 200 && adminList.json?.counts?.new >= 2, `counts ${JSON.stringify(adminList.json?.counts)}`);
  check("admin list exposes requester + voters", !!adminList.json?.requests?.[0]?.requestedBy?.email && Array.isArray(adminList.json?.requests?.[0]?.voters));

  const viewerHitsAdmin = await api("/api/admin/requests", { token: viewerToken });
  check("non-admin is refused the admin queue", viewerHitsAdmin.status === 403, `status ${viewerHitsAdmin.status}`);

  const toPlanned = await api(`/api/admin/requests/${linkReqId}`, { token: adminToken, method: "PATCH", body: { status: "planned" } });
  check("admin can move a request to planned", toPlanned.json?.request?.status === "planned", `status ${toPlanned.status}`);

  const declineNoNote = await api(`/api/admin/requests/${imageReqId}`, { token: adminToken, method: "PATCH", body: { status: "declined" } });
  check("declining without a note is refused", declineNoNote.status === 400 && declineNoNote.json?.field === "adminNote", `status ${declineNoNote.status}`);

  const addedNoRef = await api(`/api/admin/requests/${linkReqId}`, { token: adminToken, method: "PATCH", body: { status: "added" } });
  check("marking added without a catalog link is refused", addedNoRef.status === 400 && addedNoRef.json?.field === "catalogRef", `status ${addedNoRef.status}`);

  const badRef = await api(`/api/admin/requests/${linkReqId}`, { token: adminToken, method: "PATCH", body: { status: "added", catalogRef: { kind: "video", id: "does-not-exist" } } });
  check("a dangling catalog link is refused", badRef.status === 404, `status ${badRef.status}`);

  const bulkAdded = await api("/api/admin/requests/bulk-status", { token: adminToken, method: "POST", body: { ids: [linkReqId], status: "added" } });
  check("bulk refuses 'added'", bulkAdded.status === 400, `status ${bulkAdded.status}`);
  const bulkSourcing = await api("/api/admin/requests/bulk-status", { token: adminToken, method: "POST", body: { ids: [linkReqId, imageReqId], status: "sourcing" } });
  check("bulk status change works", bulkSourcing.json?.updated === 2, `updated ${bulkSourcing.json?.updated}`);

  const added = await api(`/api/admin/requests/${linkReqId}`, { token: adminToken, method: "PATCH", body: { status: "added", catalogRef: { kind: "video", id: "smoke-video-1" } } });
  check("admin can fulfil a request", added.json?.request?.status === "added" && added.json?.request?.catalogTitle === "Smoke Test Movie", `${added.status} ${added.text.slice(0, 160)}`);

  const declined = await api(`/api/admin/requests/${imageReqId}`, { token: adminToken, method: "PATCH", body: { status: "declined", adminNote: "Can't source this one." } });
  check("declining with a note works", declined.json?.request?.status === "declined" && declined.json?.request?.adminNote === "Can't source this one.");
  const afterAdded = (await search("smoke", viewerToken)).json?.results ?? [];
  check("a fulfilled request is no longer offered to vote on", find(afterAdded, "movie", "9006")?.existingRequest === null, JSON.stringify(find(afterAdded, "movie", "9006")?.existingRequest));

  // --- the payoff: the spotlight slide -------------------------------------------------------------
  const library = await api("/api/library", { token: viewerToken });
  check("library returns a spotlight array", Array.isArray(library.json?.spotlight), `got ${typeof library.json?.spotlight}`);
  const slide = library.json?.spotlight?.find((s) => s.kind === "request");
  check("a fulfilled request becomes a spotlight slide", !!slide, `slides: ${JSON.stringify(library.json?.spotlight?.map((s) => s.kind))}`);
  check("the requester sees 'You asked for this'", slide?.youAsked === true && slide?.badge === "You asked for this", `badge "${slide?.badge}" youAsked ${slide?.youAsked}`);
  check("the slide plays the fulfilled item", slide?.playHref === "/watch/smoke-video-1", `playHref ${slide?.playHref}`);
  check("the slide links back to its request", slide?.requestId === linkReqId);
  check("slide 1 is a library pick, not a request", library.json?.spotlight?.[0]?.kind !== "request", `first slide ${library.json?.spotlight?.[0]?.kind}`);
  check("deprecated hero field still sent", !!library.json?.hero?.playHref);

  // Deliberately a third account: the admin upvoted this request earlier, and an upvoter is
  // supposed to see "You asked for this" too — only someone with no stake sees the credit line.
  const bystanderEmail = `smoke-bystander-${Date.now()}@example.test`;
  await api("/auth/signup", { method: "POST", body: { email: bystanderEmail, password: "smoke-pass-123", name: "Smoke Bystander" } });
  const bystanderToken = (await api("/auth/login", { method: "POST", body: { email: bystanderEmail, password: "smoke-pass-123" } })).json?.token;
  const bystanderLibrary = await api("/api/library", { token: bystanderToken });
  const bystanderSlide = bystanderLibrary.json?.spotlight?.find((s) => s.kind === "request");
  check("a bystander sees the requester credited", bystanderSlide?.youAsked === false && /Requested by Smoke Viewer/.test(bystanderSlide?.badge ?? ""), `badge "${bystanderSlide?.badge}"`);

  const adminLibrary = await api("/api/library", { token: adminToken });
  const adminSlide = adminLibrary.json?.spotlight?.find((s) => s.kind === "request");
  check("an upvoter also sees 'You asked for this'", adminSlide?.youAsked === true, `badge "${adminSlide?.badge}"`);

  // --- withdraw ------------------------------------------------------------------------------------
  const mine = await api("/api/requests/mine", { token: viewerToken });
  check("my requests lists only mine", mine.json?.requests?.length === 2 && mine.json.requests.every((r) => r.isMine));

  const otherDelete = await api(`/api/requests/${linkReqId}`, { token: adminToken, method: "DELETE" });
  check("admin can delete any request", otherDelete.status === 200, `status ${otherDelete.status}`);

  const viewerDelete = await api(`/api/requests/${imageReqId}`, { token: viewerToken, method: "DELETE" });
  check("a requester can withdraw their own", viewerDelete.status === 200, `status ${viewerDelete.status}`);

  const imgAfterDelete = await api(`/api/request-image/${imageId}`, { token: viewerToken });
  check("withdrawing deletes its reference image", imgAfterDelete.status === 404, `status ${imgAfterDelete.status}`);
} catch (error) {
  failures.push(String(error?.stack ?? error));
  console.error(error);
} finally {
  await cleanup();
}

// --- result --------------------------------------------------------------------------------------
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exitCode = 1;
}
