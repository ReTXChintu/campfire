// End-to-end smoke test for the movie/series requests feature: submission (link and image),
// validation, dedupe, upvoting, the admin queue and its enforced transitions, and the
// fulfilled-request spotlight slide that comes out the other end.
//
// It writes real data, so it must never be pointed at the production database. Run it against a
// throwaway one:
//
//   1. node scripts/smoke-seed.mjs                 # drops + seeds `campfire_smoke`
//   2. MONGODB_DB_NAME=campfire_smoke PORT=4111 //      REQUEST_IMAGES_DIR=/tmp/campfire-smoke-images npx tsx src/index.ts
//   3. SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... node scripts/smoke-requests.mjs
//
// Step 1 has to come before step 2: the backend seeds its admin account at startup, into
// whichever database it is pointed at, and dropping the database afterwards would remove it.
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4111";
const ADMIN_EMAIL = process.env.SMOKE_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.SMOKE_ADMIN_PASSWORD;

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

async function api(path, { token, method = "GET", body, raw, contentType } = {}) {
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
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* binary or empty */ }
  return { status: res.status, json, text, res };
}

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

// --- result --------------------------------------------------------------------------------------
console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
