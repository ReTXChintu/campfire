import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer as createHttpServer } from "node:http";
import { env } from "./config/env";
import { seedAdminUser } from "./lib/users";
import { ensureIndexes as ensureDevicePairingIndexes } from "./lib/devicePairings";
import { ensureIndexes as ensureMediaRequestIndexes } from "./lib/mediaRequests";
import { startRenditionQueue } from "./lib/renditionQueue";

import authRoutes from "./routes/auth";
import mediaTokenRoutes from "./routes/media-token";
import catalogRoutes from "./routes/catalog";
import streamRoutes from "./routes/stream";
import subtitleRoutes from "./routes/subtitle";
import thumbnailRoutes, { folderThumbnailRouter, castImageRouter } from "./routes/thumbnail";
import trickplayRoutes from "./routes/trickplay";
import progressRoutes from "./routes/progress";
import probeRoutes from "./routes/probe";
import healthRoutes from "./routes/health";
import appVersionRoutes from "./routes/appVersion";
import watchPartyRoutes from "./routes/watchParties";
import requestRoutes, { requestImageRouter } from "./routes/requests";
import exploreRoutes from "./routes/explore";

import adminScanRoutes from "./routes/admin/scan";
import adminOverviewRoutes from "./routes/admin/overview";
import adminCatalogFolderRoutes from "./routes/admin/catalogFolder";
import adminCatalogVideoRoutes from "./routes/admin/catalogVideo";
import adminSubtitleSetRoutes from "./routes/admin/subtitleSets";
import adminRequestRoutes from "./routes/admin/requests";
import adminArtworkRoutes from "./routes/admin/artwork";
import { matchCatalog } from "./lib/episodeArtwork";

const app = express();

app.use(cors({ origin: env.frontendUrl }));
// Only parses bodies whose Content-Type is application/json — binary uploads (stage) and raw-text
// uploads (subtitles) declare other content types and pass through untouched.
app.use(express.json({ limit: "5mb" }));

app.use("/auth", authRoutes);
app.use("/api/media-token", mediaTokenRoutes);
app.use("/api", catalogRoutes);
app.use("/api/stream", streamRoutes);
app.use("/api/subtitle", subtitleRoutes);
app.use("/api/thumbnail", thumbnailRoutes);
app.use("/api/trickplay", trickplayRoutes);
app.use("/api/thumbnail-folder", folderThumbnailRouter);
app.use("/api/cast-image", castImageRouter);
app.use("/api/progress", progressRoutes);
app.use("/api/probe", probeRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/app-version", appVersionRoutes);
app.use("/api/watch-parties", watchPartyRoutes);
app.use("/api/requests", requestRoutes);
app.use("/api/request-image", requestImageRouter);
app.use("/api/explore", exploreRoutes);

app.use("/api/admin/scan", adminScanRoutes);
app.use("/api/admin/catalog/overview", adminOverviewRoutes);
app.use("/api/admin/catalog/folder", adminCatalogFolderRoutes);
app.use("/api/admin/catalog/video", adminCatalogVideoRoutes);
app.use("/api/admin/subtitle-sets", adminSubtitleSetRoutes);
app.use("/api/admin/requests", adminRequestRoutes);
app.use("/api/admin/catalog/artwork", adminArtworkRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

const server = createHttpServer(app);

Promise.all([
  seedAdminUser(env.adminEmail, env.adminPassword),
  ensureDevicePairingIndexes(),
  ensureMediaRequestIndexes(),
])
  .then(() => {
    startRenditionQueue();
    server.listen(env.port, () => {
      console.log(`Campfire backend listening on http://0.0.0.0:${env.port}`);
    });
    // Titles already in the library before artwork existed (or added while the key was unset)
    // are matched once on startup. Anything that misses is not retried until its title changes.
    matchCatalog()
      .then((r) => {
        const parts = [
          r.matched.length > 0 ? `matched ${r.matched.length} title(s)` : null,
          r.enriched > 0 ? `topped up ${r.enriched}` : null,
          r.renamed.length > 0 ? `renamed ${r.renamed.length}` : null,
          r.episodes.matched > 0 ? `named ${r.episodes.matched} episode(s)` : null,
        ].filter(Boolean);
        if (parts.length > 0) console.log(`Artwork: ${parts.join(", ")} on TMDb`);
      })
      .catch((error) => console.error("Artwork auto-match failed:", error));
  })
  .catch((error) => {
    console.error("Failed to seed admin user:", error);
    process.exit(1);
  });
