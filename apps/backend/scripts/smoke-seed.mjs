// Seeds a throwaway database with two published catalog items so the requests smoke test can
// exercise the "added -> spotlight slide" path without touching the real library.
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const envText = readFileSync(process.argv[2] || join(import.meta.dirname, "..", ".env"), "utf-8");
const uri = envText.match(/^MONGODB_URI=(.*)$/m)[1].trim();
const dbName = process.argv[3] || "campfire_smoke";
// The library endpoint only lists children of DRIVE_ROOT_FOLDER_ID, so the seeded items have to
// hang off the real configured root or the library comes back empty.
const root = envText.match(/^DRIVE_ROOT_FOLDER_ID=(.*)$/m)[1].trim();

const client = new MongoClient(uri);
await client.connect();
// Always start from nothing: a half-finished earlier run leaves requests behind that make the
// dedupe assertions ambiguous.
await client.db(dbName).dropDatabase();
const db = client.db(dbName);

const now = new Date();
await db.collection("catalogVideos").insertOne({
  _id: "smoke-video-1",
  parentFolderId: root,
  driveName: "Smoke Test Movie.mkv",
  mimeType: "video/x-matroska",
  sizeBytes: 1234567,
  durationSeconds: 5400,
  status: "published",
  title: "Smoke Test Movie",
  subtitleSetIds: [],
  introStart: null, introEnd: null, outroStart: null,
  episodeOrder: null,
  titleOverridden: true, introOverridden: false,
  renditions: {},
  createdAt: now, curatedAt: now, curatedBy: "smoke", updatedAt: now,
});
await db.collection("catalogFolders").insertOne({
  _id: "smoke-folder-1",
  parentFolderId: root,
  driveName: "Smoke Test Series",
  status: "published",
  title: "Smoke Test Series",
  thumbnailFileId: null,
  createdAt: now, curatedAt: now, curatedBy: "smoke", updatedAt: now,
});

console.log("seeded", dbName);
await client.close();
