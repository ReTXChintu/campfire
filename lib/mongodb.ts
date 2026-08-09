import { MongoClient } from "mongodb";
import { env } from "@/lib/env";

declare global {
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function createClientPromise(): Promise<MongoClient> {
  const client = new MongoClient(env.mongodbUri);
  return client.connect();
}

// Reuse the client across hot reloads in dev and across invocations in prod
// so both NextAuth's adapter and app code share a single connection pool.
const clientPromise =
  global._mongoClientPromise ?? (global._mongoClientPromise = createClientPromise());

export default clientPromise;

export async function getDb() {
  const client = await clientPromise;
  return client.db(env.mongodbDbName);
}
