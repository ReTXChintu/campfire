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
 * Single-admin app now (no Google login, no signup) — the one account's credentials live in
 * apps/backend/.env and are (re-)synced into Mongo on every startup, so editing ADMIN_PASSWORD and
 * restarting is how you change the password. "Seeding" rather than a one-time insert on purpose:
 * this keeps the DB in sync with .env rather than letting them silently drift apart.
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

export async function verifyPassword(user: UserDoc, password: string): Promise<boolean> {
  return bcrypt.compare(password, user.passwordHash);
}
