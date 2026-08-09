import { MongoClient } from "mongodb";
import { env } from "../config/env";

let clientPromise: Promise<MongoClient> | undefined;

function createClientPromise(): Promise<MongoClient> {
  const client = new MongoClient(env.mongodbUri);
  return client.connect();
}

// Reuse a single client/connection pool across the whole always-on process.
function getClientPromise(): Promise<MongoClient> {
  if (!clientPromise) clientPromise = createClientPromise();
  return clientPromise;
}

export default getClientPromise;

export async function getDb() {
  const client = await getClientPromise();
  return client.db(env.mongodbDbName);
}
