import bcrypt from "bcryptjs";
import { getDb } from "./mongodb";

export type UserDoc = {
  _id: string; // email, lowercased — the only user identity now that Google login is gone
  email: string;
  passwordHash: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

async function collection() {
  const db = await getDb();
  return db.collection<UserDoc>("users");
}

export async function getUserById(userId: string): Promise<UserDoc | null> {
  const col = await collection();
  return col.findOne({ _id: userId });
}

export async function getUserByEmail(email: string): Promise<UserDoc | null> {
  const col = await collection();
  return col.findOne({ _id: email.toLowerCase() });
}

/**
 * The one admin account's credentials live in apps/backend/.env and are (re-)synced into Mongo on
 * every startup, so editing ADMIN_PASSWORD and restarting is how you change the password.
 * "Seeding" rather than a one-time insert on purpose: this keeps the DB in sync with .env rather
 * than letting them silently drift apart. Everyone else signs up for their own account (see
 * createUser) — isAdminEmail() only ever matches this one seeded email, regardless of who else
 * signs up.
 */
export async function seedAdminUser(email: string, password: string): Promise<void> {
  const col = await collection();
  const id = email.toLowerCase();
  const now = new Date();
  const passwordHash = await bcrypt.hash(password, 12);

  await col.updateOne(
    { _id: id },
    {
      $set: { email: id, passwordHash, updatedAt: now },
      $setOnInsert: { _id: id, name: null, avatarUrl: null, createdAt: now },
    },
    { upsert: true },
  );
}

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super("An account with this email already exists");
  }
}

/** Open signup — no invite code, matches the old "any Google account can sign in" behavior, just
 * with a password instead of an OAuth handshake. Never grants admin (see seedAdminUser above). */
export async function createUser(input: {
  email: string;
  password: string;
  name: string | null;
}): Promise<UserDoc> {
  const col = await collection();
  const id = input.email.toLowerCase();
  const now = new Date();
  const passwordHash = await bcrypt.hash(input.password, 12);

  try {
    await col.insertOne({
      _id: id,
      email: id,
      passwordHash,
      name: input.name,
      avatarUrl: null,
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    // Mongo duplicate-key error on the _id (email) — someone already has this account.
    if (error instanceof Error && "code" in error && (error as { code?: number }).code === 11000) {
      throw new EmailAlreadyRegisteredError();
    }
    throw error;
  }

  return (await col.findOne({ _id: id }))!;
}

export async function verifyPassword(user: UserDoc, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.passwordHash);
}

/** No email/token step by design — this app is personal-use only. Note the admin account is a
 * special case: seedAdminUser re-syncs its passwordHash from ADMIN_PASSWORD on every backend
 * restart, so a reset here won't stick for that account past the next restart unless .env is
 * also updated. Returns false if no account has this email. */
export async function resetPassword(email: string, newPassword: string): Promise<boolean> {
  const col = await collection();
  const id = email.toLowerCase();
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const result = await col.updateOne({ _id: id }, { $set: { passwordHash, updatedAt: new Date() } });
  return result.matchedCount > 0;
}
