import { ObjectId } from "mongodb";
import { randomInt, randomUUID } from "node:crypto";
import { getDb } from "./mongodb";

export type WatchPartyDoc = {
  _id: ObjectId;
  // Short, human-typeable code — this is the id the rest of the app (URLs, invite links,
  // `WatchPartySnapshot.id`) actually deals with; `_id` stays purely an internal Mongo key.
  code: string;
  roomName: string;
  fileId: string;
  title: string | null;
  hostUserId: string;
  hostParticipantIdentity: string;
  playing: boolean;
  positionSeconds: number;
  playbackRate: number;
  createdAt: Date;
  updatedAt: Date;
  endedAt: Date | null;
};

export type WatchPartySnapshot = {
  id: string;
  roomName: string;
  fileId: string;
  title: string | null;
  hostUserId: string;
  hostParticipantIdentity: string;
  playing: boolean;
  positionSeconds: number;
  effectivePositionSeconds: number;
  playbackRate: number;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
};

async function collection() {
  const db = await getDb();
  return db.collection<WatchPartyDoc>("watchParties");
}

// Excludes visually-ambiguous characters (0/O, 1/I/L) so a code read off a screen or spoken aloud
// types back in correctly. 32 symbols ^ 6 chars =~ 1 billion combinations — collisions are only
// realistically possible as a freak coincidence, hence the tiny retry loop rather than a unique
// index (this codebase's `ensureIndexes()` helpers are never actually called at startup).
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_CODE_ATTEMPTS = 10;

function generateCandidateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

async function generateUniqueCode(): Promise<string> {
  const col = await collection();
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const candidate = generateCandidateCode();
    const existing = await col.findOne({ code: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  throw new Error("Failed to generate a unique watch party code");
}

export async function createWatchParty(input: {
  fileId: string;
  title: string | null;
  hostUserId: string;
}): Promise<WatchPartyDoc> {
  const col = await collection();

  // Reusing an already-active party for the same host+file instead of always minting a new one —
  // otherwise clicking "Start Watch Party" again (e.g. after a refresh dropped the party code)
  // orphans the original room, stranding anyone still connected to it.
  const existing = await col.findOne({ fileId: input.fileId, hostUserId: input.hostUserId, endedAt: null });
  if (existing) return existing;

  const now = new Date();
  const doc: WatchPartyDoc = {
    _id: new ObjectId(),
    code: await generateUniqueCode(),
    roomName: `watch-party-${randomUUID()}`,
    fileId: input.fileId,
    title: input.title,
    hostUserId: input.hostUserId,
    hostParticipantIdentity: `host-${randomUUID()}`,
    playing: false,
    positionSeconds: 0,
    playbackRate: 1,
    createdAt: now,
    updatedAt: now,
    endedAt: null,
  };
  await col.insertOne(doc);
  return doc;
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export async function getWatchPartyByCode(code: string): Promise<WatchPartyDoc | null> {
  const col = await collection();
  return col.findOne({ code: normalizeCode(code) });
}

export async function updateWatchPartyState(
  code: string,
  input: {
    playing: boolean;
    positionSeconds: number;
    playbackRate?: number;
  },
): Promise<WatchPartyDoc | null> {
  const col = await collection();
  const now = new Date();
  const normalized = normalizeCode(code);
  await col.findOneAndUpdate(
    { code: normalized, endedAt: null },
    {
      $set: {
        playing: input.playing,
        positionSeconds: Math.max(0, input.positionSeconds),
        updatedAt: now,
        ...(typeof input.playbackRate === "number" ? { playbackRate: input.playbackRate } : {}),
      },
    },
  );
  return col.findOne({ code: normalized });
}

/** Keeps `hostParticipantIdentity` pointing at whatever identity the host's current *main* device
 * session actually holds. Identity used to be minted once at party creation and reused forever
 * (`host-${randomUUID()}`); it's now `${role}-${userId}-${deviceId}` — a real per-device value
 * computed in routes/watchParties.ts's join-token handler — so this field has to be updated
 * whenever the host's main device (re)joins, or web's existing `handleDataReceived` identity
 * check (which still trusts this field) would never match a real sender again. */
export async function updateHostParticipantIdentity(code: string, participantIdentity: string): Promise<void> {
  const col = await collection();
  await col.updateOne({ code: normalizeCode(code), endedAt: null }, { $set: { hostParticipantIdentity: participantIdentity } });
}

export async function endWatchParty(code: string): Promise<WatchPartyDoc | null> {
  const col = await collection();
  const now = new Date();
  const normalized = normalizeCode(code);
  await col.findOneAndUpdate(
    { code: normalized, endedAt: null },
    {
      $set: {
        endedAt: now,
        updatedAt: now,
        playing: false,
      },
    },
  );
  return col.findOne({ code: normalized });
}

/** Ends every still-open party on one video — the admin "Delete video" action. Participants get
 * the same "party ended" experience as a host ending it (their LiveKit room closes on the next
 * heartbeat/roster fetch finding the party gone). */
export async function endWatchPartiesForFile(fileId: string): Promise<number> {
  const col = await collection();
  const now = new Date();
  const res = await col.updateMany({ fileId, endedAt: null }, { $set: { endedAt: now, updatedAt: now, playing: false } });
  return res.modifiedCount;
}

export function getEffectivePartyPositionSeconds(
  party: Pick<WatchPartyDoc, "playing" | "positionSeconds" | "updatedAt" | "playbackRate">,
): number {
  if (!party.playing) return party.positionSeconds;
  const elapsedSeconds = Math.max(0, Date.now() - party.updatedAt.getTime()) / 1000;
  return party.positionSeconds + elapsedSeconds * party.playbackRate;
}

export function serializeWatchParty(party: WatchPartyDoc): WatchPartySnapshot {
  return {
    id: party.code,
    roomName: party.roomName,
    fileId: party.fileId,
    title: party.title,
    hostUserId: party.hostUserId,
    hostParticipantIdentity: party.hostParticipantIdentity,
    playing: party.playing,
    positionSeconds: party.positionSeconds,
    effectivePositionSeconds: getEffectivePartyPositionSeconds(party),
    playbackRate: party.playbackRate,
    createdAt: party.createdAt.toISOString(),
    updatedAt: party.updatedAt.toISOString(),
    endedAt: party.endedAt?.toISOString() ?? null,
  };
}
