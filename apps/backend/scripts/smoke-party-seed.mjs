// Seeds a throwaway database for smoke-party.mjs: a movie at the library root, and a series laid
// out the way real ones are (series folder -> season folder -> episodes), which is the shape that
// exposed the "season episodes never show progress" bug.
//
//   node scripts/smoke-party-seed.mjs [path/to/.env] [dbName]
import { MongoClient } from "mongodb";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const envText = readFileSync(process.argv[2] || join(import.meta.dirname, "..", ".env"), "utf-8");
const uri = envText.match(/^MONGODB_URI=(.*)$/m)[1].trim();
const dbName = process.argv[3] || "campfire_party_smoke";
if (/^(stream|prod|production)$/i.test(dbName)) throw new Error(`refusing to seed "${dbName}"`);
const root = envText.match(/^DRIVE_ROOT_FOLDER_ID=(.*)$/m)[1].trim();

const client = new MongoClient(uri);
await client.connect();
await client.db(dbName).dropDatabase();
const db = client.db(dbName);
const now = new Date();

const video = (id, parentFolderId, title, episodeOrder = null) => ({
  _id: id,
  parentFolderId,
  driveName: `${title}.mkv`,
  mimeType: "video/x-matroska",
  sizeBytes: 1234567,
  durationSeconds: 3000,
  status: "published",
  title,
  subtitleSetIds: [],
  introStart: null, introEnd: null, outroStart: null,
  episodeOrder,
  titleOverridden: true, introOverridden: false,
  renditions: {},
  createdAt: now, curatedAt: now, curatedBy: "smoke", updatedAt: now,
});
const folder = (id, parentFolderId, title) => ({
  _id: id, parentFolderId, driveName: title, status: "published", title, thumbnailFileId: null,
  createdAt: now, curatedAt: now, curatedBy: "smoke", updatedAt: now,
});

await db.collection("catalogFolders").insertMany([
  folder("smoke-series", root, "Smoke Series"),
  folder("smoke-s1", "smoke-series", "Season 1"),
]);
await db.collection("catalogVideos").insertMany([
  video("smoke-movie", root, "Smoke Movie (2024)"),
  video("smoke-ep1", "smoke-s1", "Smoke Series S01E01", 1),
  video("smoke-ep2", "smoke-s1", "Smoke Series S01E02", 2),
]);
console.log("seeded", dbName);
await client.close();
