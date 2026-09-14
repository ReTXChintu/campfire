import { ObjectId } from "mongodb";
import { randomInt } from "node:crypto";
import { getDb } from "./mongodb";

// One row per in-flight TV pairing attempt — the TV shows `code`, a phone/browser (already logged
// in) claims it, and the TV polls until it's claimed, then signs in with the resulting JWT. See
// routes/auth.ts's /pair/start, /pair/claim, /pair/poll/:code.
export type DevicePairingDoc = {
  _id: ObjectId;
  code: string;
  status: "pending" | "claimed";
  userId: string | null;
  createdAt: Date;
  expiresAt: Date;
};

const PAIRING_TTL_MS = 10 * 60 * 1000;
// Same alphabet/length as watchParties.ts's party codes — excludes visually-ambiguous characters
// (0/O, 1/I/L) so a code read off a TV screen types back in correctly on a phone.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const MAX_CODE_ATTEMPTS = 10;

async function collection() {
  const db = await getDb();
  return db.collection<DevicePairingDoc>("devicePairings");
}

export async function ensureIndexes() {
  const col = await collection();
  await col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

function generateCandidateCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

async function generateUniqueCode(): Promise<string> {
  const col = await collection();
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const candidate = generateCandidateCode();
    const existing = await col.findOne({ code: candidate }, { projection: { _id: 1 } });
    if (!existing) return candidate;
  }
  throw new Error("Failed to generate a unique pairing code");
}

export async function startPairing(): Promise<{ code: string; expiresAt: Date }> {
  const col = await collection();
  const code = await generateUniqueCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
  await col.insertOne({ _id: new ObjectId(), code, status: "pending", userId: null, createdAt: now, expiresAt });
  return { code, expiresAt };
}

/** Marks a still-pending, unexpired row claimed by `userId`. False if the code doesn't exist,
 * already got claimed, or expired — checked explicitly rather than trusting the TTL index alone to
 * have removed it in time (mirrors watchPartySessions.ts's own "don't rely purely on background
 * cleanup, re-check at read/write time" approach). */
export async function claimPairing(code: string, userId: string): Promise<boolean> {
  const col = await collection();
  const result = await col.updateOne(
    { code, status: "pending", expiresAt: { $gt: new Date() } },
    { $set: { status: "claimed", userId } },
  );
  return result.modifiedCount === 1;
}

export type DevicePairingPollResult =
  | { status: "pending" }
  | { status: "claimed"; userId: string }
  | { status: "not_found" };

/** One-time read: a claimed row is deleted as soon as it's polled, so the same code can never mint
 * a second token. */
export async function pollAndConsumePairing(code: string): Promise<DevicePairingPollResult> {
  const col = await collection();
  const doc = await col.findOne({ code });
  if (!doc || doc.expiresAt < new Date()) return { status: "not_found" };
  if (doc.status === "pending") return { status: "pending" };
  await col.deleteOne({ _id: doc._id });
  return { status: "claimed", userId: doc.userId! };
}
