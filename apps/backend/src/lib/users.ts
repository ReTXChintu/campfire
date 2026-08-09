import { getDb } from "./mongodb";

export type UserDoc = {
  _id: string; // Google profile id
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

async function collection() {
  const db = await getDb();
  return db.collection<UserDoc>("users");
}

export async function upsertUser(input: {
  googleId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}): Promise<UserDoc> {
  const col = await collection();
  const now = new Date();
  await col.updateOne(
    { _id: input.googleId },
    {
      $set: { email: input.email, name: input.name, avatarUrl: input.avatarUrl, updatedAt: now },
      $setOnInsert: { _id: input.googleId, createdAt: now },
    },
    { upsert: true },
  );
  return (await col.findOne({ _id: input.googleId }))!;
}

export async function getUserById(userId: string): Promise<UserDoc | null> {
  const col = await collection();
  return col.findOne({ _id: userId });
}
