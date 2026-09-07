import { ObjectId } from "mongodb";
import { getDb } from "./mongodb";

// One row per currently-(or recently-)connected device for a watch party — sits alongside
// LiveKit's own room roster (which drives who's actually audible/visible) as the
// backend-authoritative record of who's *allowed* to do what: host vs. guest, whether a guest has
// been granted playback control, and whether this particular device is the "main" screen (has the
// player, can hold control) or a "companion" (voice/video/chat only, never control — see
// getWatchPartySessionForRequest's use in routes/watchParties.ts's state-PATCH authorization).
export type WatchPartyDeviceRole = "main" | "companion";
export type WatchPartyClientKind = "web" | "windows" | "android" | "ios";
export type WatchPartyParticipantRole = "host" | "guest";

export type WatchPartySessionDoc = {
  _id: ObjectId;
  partyCode: string;
  userId: string;
  deviceId: string;
  deviceLabel: string;
  clientKind: WatchPartyClientKind;
  participantIdentity: string; // `${role}-${userId}-${deviceId}` — the LiveKit identity minted for this session
  role: WatchPartyParticipantRole;
  deviceRole: WatchPartyDeviceRole;
  canControlPlayback: boolean;
  connectedAt: Date;
  lastSeenAt: Date;
  disconnectedAt: Date | null;
};

export type WatchPartySessionSnapshot = {
  userId: string;
  deviceId: string;
  deviceLabel: string;
  clientKind: WatchPartyClientKind;
  role: WatchPartyParticipantRole;
  deviceRole: WatchPartyDeviceRole;
  canControlPlayback: boolean;
};

// A session counts as "active" only if it's been heartbeated recently — a killed app/dropped
// connection never fires a clean "leave" call, so liveness is read-time-filtered rather than
// tracked via a boolean that could get stuck true forever. No LiveKit webhook receiver exists in
// this backend (and adding one wouldn't remove the need for a heartbeat anyway, since a killed app
// doesn't fire a clean webhook event either) — this is intentionally the simpler of the two.
const STALE_AFTER_MS = 45_000;

function serialize(doc: WatchPartySessionDoc): WatchPartySessionSnapshot {
  return {
    userId: doc.userId,
    deviceId: doc.deviceId,
    deviceLabel: doc.deviceLabel,
    clientKind: doc.clientKind,
    role: doc.role,
    deviceRole: doc.deviceRole,
    canControlPlayback: doc.canControlPlayback,
  };
}

async function collection() {
  const db = await getDb();
  return db.collection<WatchPartySessionDoc>("watchPartySessions");
}

/** Active (non-disconnected, recently-heartbeated) sessions for one party, across all users. */
export async function getActiveSessions(partyCode: string): Promise<WatchPartySessionDoc[]> {
  const col = await collection();
  return col
    .find({
      partyCode,
      disconnectedAt: null,
      lastSeenAt: { $gt: new Date(Date.now() - STALE_AFTER_MS) },
    })
    .toArray();
}

export async function getActiveSessionSnapshots(partyCode: string): Promise<WatchPartySessionSnapshot[]> {
  return (await getActiveSessions(partyCode)).map(serialize);
}

/** This same user's other active sessions in this party (excludes `deviceId` itself) — the
 * multi-device decision point join-token uses to decide main vs. companion. */
export async function getOtherActiveSessionsForUser(
  partyCode: string,
  userId: string,
  excludeDeviceId: string,
): Promise<WatchPartySessionDoc[]> {
  const sessions = await getActiveSessions(partyCode);
  return sessions.filter((s) => s.userId === userId && s.deviceId !== excludeDeviceId);
}

export async function getSessionForRequest(
  partyCode: string,
  userId: string,
  deviceId: string,
): Promise<WatchPartySessionDoc | null> {
  const col = await collection();
  return col.findOne({ partyCode, userId, deviceId, disconnectedAt: null });
}

export async function upsertSession(input: {
  partyCode: string;
  userId: string;
  deviceId: string;
  deviceLabel: string;
  clientKind: WatchPartyClientKind;
  participantIdentity: string;
  role: WatchPartyParticipantRole;
  deviceRole: WatchPartyDeviceRole;
}): Promise<WatchPartySessionDoc> {
  const col = await collection();
  const now = new Date();
  await col.updateOne(
    { partyCode: input.partyCode, userId: input.userId, deviceId: input.deviceId },
    {
      $set: {
        deviceLabel: input.deviceLabel,
        clientKind: input.clientKind,
        participantIdentity: input.participantIdentity,
        role: input.role,
        deviceRole: input.deviceRole,
        lastSeenAt: now,
        disconnectedAt: null,
      },
      $setOnInsert: {
        _id: new ObjectId(),
        partyCode: input.partyCode,
        userId: input.userId,
        deviceId: input.deviceId,
        // A main-device host session holds control implicitly (see routes/watchParties.ts's
        // authorization check); everything else — a guest's own row, or a host's own companion
        // device — starts false. Guests are only ever flipped by the host-only grant route; a
        // companion device (host's or a guest's) is additionally hard-blocked from ever being
        // granted control regardless of this default (see setControlPermission/setDeviceRole).
        canControlPlayback: input.role === "host" && input.deviceRole === "main",
        connectedAt: now,
      },
    },
    { upsert: true },
  );
  const doc = await col.findOne({ partyCode: input.partyCode, userId: input.userId, deviceId: input.deviceId });
  if (!doc) throw new Error("Failed to upsert watch party session");
  return doc;
}

export async function touchSession(partyCode: string, userId: string, deviceId: string): Promise<void> {
  const col = await collection();
  await col.updateOne({ partyCode, userId, deviceId }, { $set: { lastSeenAt: new Date() } });
}

export async function closeSession(partyCode: string, userId: string, deviceId: string): Promise<void> {
  const col = await collection();
  await col.updateOne({ partyCode, userId, deviceId }, { $set: { disconnectedAt: new Date() } });
}

export async function setDeviceRole(
  partyCode: string,
  userId: string,
  deviceId: string,
  deviceRole: WatchPartyDeviceRole,
): Promise<void> {
  const col = await collection();
  // A companion device can never hold control — enforced here too, not just at grant time, so
  // demoting an already-controlling session to companion (the mobile+mobile role-choice flow)
  // can't leave a stale grant behind.
  const set: Partial<WatchPartySessionDoc> = { deviceRole };
  if (deviceRole === "companion") set.canControlPlayback = false;
  await col.updateOne({ partyCode, userId, deviceId }, { $set: set });
}

/** Host-only grant/revoke. Refuses to grant control to a companion-role session — defense in
 * depth beyond the UI simply not offering the option, since role is always server-derived. */
export async function setControlPermission(
  partyCode: string,
  userId: string,
  deviceId: string,
  grant: boolean,
): Promise<WatchPartySessionDoc | null> {
  const col = await collection();
  const session = await col.findOne({ partyCode, userId, deviceId });
  if (!session) return null;
  if (grant && session.deviceRole === "companion") {
    throw new Error("A companion device can't be granted playback control");
  }
  await col.updateOne({ partyCode, userId, deviceId }, { $set: { canControlPlayback: grant } });
  return col.findOne({ partyCode, userId, deviceId });
}
