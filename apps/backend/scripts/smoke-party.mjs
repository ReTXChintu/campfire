// End-to-end smoke test for watch-party sync's backend half and the watch-progress fixes:
// the server clock endpoint, party state carrying the episode and the party-wide audio/subtitle
// choice, its validation, control authorization, server-side extrapolation, the roster's display
// names, and progress showing up for season episodes and finished movies.
//
// Writes real data — run it against a throwaway database only:
//
//   1. node scripts/smoke-party-seed.mjs            # drops + seeds `campfire_party_smoke`
//   2. MONGODB_DB_NAME=campfire_party_smoke PORT=4112 \
//      LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=smoke LIVEKIT_API_SECRET=<any 32+ chars> \
//      npx tsx src/index.ts
//      (join tokens are signed offline, so no LiveKit server is needed for anything checked here)
//   3. SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... node scripts/smoke-party.mjs
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:4112";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { token, method = "GET", body, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (body !== undefined) h["content-type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: res.status, json, text };
}

// --- accounts ----------------------------------------------------------------------------------
const admin = (await api("/auth/login", { method: "POST", body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })).json?.token;
check("host (admin) signs in", !!admin);
const guestEmail = `smoke-guest-${Date.now()}@example.test`;
const signup = await api("/auth/signup", { method: "POST", body: { email: guestEmail, password: "smoke-pass-123", name: "Smoke Guest" } });
const guest = signup.json?.token ?? (await api("/auth/login", { method: "POST", body: { email: guestEmail, password: "smoke-pass-123" } })).json?.token;
check("guest signs up", !!guest, `status ${signup.status}`);

// --- server clock ------------------------------------------------------------------------------
const before = Date.now();
const time = await api("/api/watch-parties/time", { token: admin });
const after = Date.now();
check("GET /time answers (not mistaken for a party code)", time.status === 200, `status ${time.status}`);
check("serverTimeMs is the server's now", typeof time.json?.serverTimeMs === "number" && time.json.serverTimeMs >= before - 2000 && time.json.serverTimeMs <= after + 2000);
check("/time needs auth", (await api("/api/watch-parties/time")).status === 401);

// --- create + join -----------------------------------------------------------------------------
const created = await api("/api/watch-parties", { token: admin, method: "POST", body: { fileId: "smoke-ep1", title: "Smoke Series S01E01" } });
const code = created.json?.party?.id;
check("host creates a party", created.status === 201 && !!code, `status ${created.status}`);
const fresh = created.json?.party;
check("a new party has no playback history (createdAt == updatedAt)", fresh?.createdAt === fresh?.updatedAt);
check("party carries serverTimeMs", typeof fresh?.serverTimeMs === "number");
check("party starts with no track choice", fresh?.audioTrack === null && fresh?.subtitleTrack === null);

const hostJoin = await api(`/api/watch-parties/${code}/join-token`, { token: admin, method: "POST", body: { deviceId: "host-dev", deviceLabel: "Windows PC", clientKind: "windows" } });
check("host gets a join token", hostJoin.status === 200 && !!hostJoin.json?.participantToken, `status ${hostJoin.status} ${hostJoin.text.slice(0, 160)}`);
check("host can control", hostJoin.json?.isHost === true && hostJoin.json?.canControlPlayback === true);
const guestJoin = await api(`/api/watch-parties/${code}/join-token`, { token: guest, method: "POST", body: { deviceId: "guest-dev", deviceLabel: "Pixel 8", clientKind: "android" } });
check("guest gets a join token", guestJoin.status === 200 && !!guestJoin.json?.participantToken);
check("guest can't control yet", guestJoin.json?.canControlPlayback === false && guestJoin.json?.isHost === false);

const roster = await api(`/api/watch-parties/${code}/participants`, { token: guest });
const guestRow = roster.json?.participants?.find((p) => p.deviceId === "guest-dev");
check("roster lists both devices", roster.json?.participants?.length === 2, JSON.stringify(roster.json).slice(0, 200));
check("roster carries the person's name, not just the device", guestRow?.displayName === "Smoke Guest", JSON.stringify(guestRow));

// --- state: authorization ----------------------------------------------------------------------
const state = (token, deviceId, body) => api(`/api/watch-parties/${code}/state`, { token, method: "PATCH", body, headers: { "x-watch-party-device-id": deviceId } });
check("a guest without control can't drive playback", (await state(guest, "guest-dev", { playing: true, positionSeconds: 5 })).status === 403);

// --- state: episode + tracks -------------------------------------------------------------------
const audio = { id: "2", language: "hin", title: "Hindi DD5.1" };
const subs = { source: "external", index: 0, language: "en", title: "English" };
const moved = await state(admin, "host-dev", { playing: true, positionSeconds: 0, playbackRate: 1, fileId: "smoke-ep2", audioTrack: audio, subtitleTrack: subs });
check("host moves the party to the next episode", moved.status === 200 && moved.json?.party?.fileId === "smoke-ep2", moved.text.slice(0, 200));
check("party-wide audio choice is stored", moved.json?.party?.audioTrack?.language === "hin" && moved.json?.party?.audioTrack?.id === "2");
check("party-wide subtitle choice is stored", moved.json?.party?.subtitleTrack?.source === "external" && moved.json?.party?.subtitleTrack?.index === 0);

const noTracks = await state(admin, "host-dev", { playing: true, positionSeconds: 100, playbackRate: 1 });
check("a state without tracks leaves the stored choice alone", noTracks.json?.party?.audioTrack?.language === "hin" && noTracks.json?.party?.fileId === "smoke-ep2");

const cleared = await state(admin, "host-dev", { playing: true, positionSeconds: 100, playbackRate: 1, subtitleTrack: { source: "off" } });
check("subtitles can be turned off party-wide", cleared.json?.party?.subtitleTrack?.source === "off");

// --- state: server-side extrapolation ----------------------------------------------------------
await sleep(1500);
const later = (await api(`/api/watch-parties/${code}`, { token: guest })).json?.party;
const expected = 100 + (later.serverTimeMs - Date.parse(later.updatedAt)) / 1000;
check("a joiner's snapshot is extrapolated to now", later.effectivePositionSeconds > 101 && later.effectivePositionSeconds < 103, `got ${later?.effectivePositionSeconds}`);
check("…exactly to the serverTimeMs it reports", Math.abs(later.effectivePositionSeconds - expected) < 0.01, `got ${later.effectivePositionSeconds} vs ${expected}`);
check("a party that has been played has history", later.createdAt !== later.updatedAt);

const paused = await state(admin, "host-dev", { playing: false, positionSeconds: 250, playbackRate: 1 });
await sleep(600);
const pausedNow = (await api(`/api/watch-parties/${code}`, { token: guest })).json?.party;
check("a paused party doesn't advance", paused.status === 200 && pausedNow.effectivePositionSeconds === 250);

// --- state: validation -------------------------------------------------------------------------
const bad = async (name, body) => check(`rejects ${name}`, (await state(admin, "host-dev", body)).status === 400);
await bad("a missing position", { playing: true });
await bad("a non-number position", { playing: true, positionSeconds: "12" });
await bad("a zero rate", { playing: true, positionSeconds: 1, playbackRate: 0 });
await bad("an absurd rate", { playing: true, positionSeconds: 1, playbackRate: 50 });
await bad("a non-string fileId", { playing: true, positionSeconds: 1, fileId: 7 });
await bad("an empty fileId", { playing: true, positionSeconds: 1, fileId: "" });
await bad("an unknown subtitle source", { playing: true, positionSeconds: 1, subtitleTrack: { source: "bogus" } });
await bad("a fractional track index", { playing: true, positionSeconds: 1, subtitleTrack: { source: "external", index: 1.5 } });
await bad("a track that isn't an object", { playing: true, positionSeconds: 1, audioTrack: "hindi" });
const stillThere = (await api(`/api/watch-parties/${code}`, { token: guest })).json?.party;
check("rejected states changed nothing", stillThere.effectivePositionSeconds === 250 && stillThere.fileId === "smoke-ep2");

// --- control grant -----------------------------------------------------------------------------
const guestUserId = guestRow?.userId;
const grant = await api(`/api/watch-parties/${code}/participants/${guestUserId}/control`, { token: admin, method: "POST", body: { deviceId: "guest-dev", grant: true } });
check("host grants the guest control", grant.status === 200 && grant.json?.participants?.find((p) => p.deviceId === "guest-dev")?.canControlPlayback === true);
const guestDrives = await state(guest, "guest-dev", { playing: true, positionSeconds: 300, playbackRate: 1.25 });
check("a granted guest can drive playback", guestDrives.status === 200 && guestDrives.json?.party?.playbackRate === 1.25);
check("a guest can't grant control", (await api(`/api/watch-parties/${code}/participants/${guestUserId}/control`, { token: guest, method: "POST", body: { deviceId: "guest-dev", grant: false } })).status === 403);

// --- heartbeat ---------------------------------------------------------------------------------
const beat = await api(`/api/watch-parties/${code}/heartbeat`, { token: guest, method: "POST", body: { deviceId: "guest-dev" } });
check("heartbeat answers with the server clock", beat.status === 200 && typeof beat.json?.serverTimeMs === "number");

// --- end ---------------------------------------------------------------------------------------
check("a guest can't end the party", (await api(`/api/watch-parties/${code}`, { token: guest, method: "DELETE" })).status === 403);
check("the host ends it", (await api(`/api/watch-parties/${code}`, { token: admin, method: "DELETE" })).status === 200);
check("an ended party is gone", (await api(`/api/watch-parties/${code}`, { token: guest })).status === 404);

// --- progress: season episodes + finished movies -----------------------------------------------
const save = (token, body) => api("/api/progress", { token, method: "POST", body });
await save(guest, { fileId: "smoke-ep1", parentFolderId: "smoke-s1", positionSeconds: 2990, durationSeconds: 3000 });
await save(guest, { fileId: "smoke-ep2", parentFolderId: "smoke-s1", positionSeconds: 900, durationSeconds: 3000 });
await save(guest, { fileId: "smoke-movie", parentFolderId: "root-ignored", positionSeconds: 2995, durationSeconds: 3000 });

const series = await api("/api/folder/smoke-series", { token: guest });
const seriesProgress = series.json?.progress ?? [];
check("series page loads in season mode", series.status === 200 && series.json?.mode === "series", `status ${series.status} ${series.text.slice(0, 160)}`);
check("season episodes now carry progress (was always empty)", seriesProgress.length === 2, `got ${seriesProgress.length}`);
check("a finished episode is marked completed", seriesProgress.find((p) => p.fileId === "smoke-ep1")?.completed === true);
check("a part-watched episode is not", seriesProgress.find((p) => p.fileId === "smoke-ep2")?.completed === false);

const library = await api("/api/library", { token: guest });
const movieProgress = library.json?.progress?.find((p) => p.fileId === "smoke-movie");
check("library carries progress for its own movies", Array.isArray(library.json?.progress), library.text.slice(0, 160));
check("…including finished ones (Continue Watching never could)", movieProgress?.completed === true);
check("finished movie isn't in Continue Watching", !library.json?.continueWatching?.some((e) => e.item.id === "smoke-movie"));

const episodeView = await api("/api/video/smoke-ep1", { token: guest });
const epMap = episodeView.json?.progressByFileId ?? {};
check("player's episode list gets durations for real bars", episodeView.status === 200 && epMap["smoke-ep2"]?.durationSeconds === 3000, `status ${episodeView.status} ${JSON.stringify(epMap).slice(0, 160)}`);

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
