import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { env } from "./config/env";
import { seedAdminUser } from "./lib/users";

import authRoutes from "./routes/auth";
import mediaTokenRoutes from "./routes/media-token";
import catalogRoutes from "./routes/catalog";
import streamRoutes from "./routes/stream";
import subtitleRoutes from "./routes/subtitle";
import thumbnailRoutes, { folderThumbnailRouter } from "./routes/thumbnail";
import progressRoutes from "./routes/progress";
import probeRoutes from "./routes/probe";
import healthRoutes from "./routes/health";
import watchPartyRoutes from "./routes/watchParties";

import adminStageRoutes from "./routes/admin/stage";
import adminConvertRoutes from "./routes/admin/convert";
import adminJobsRoutes from "./routes/admin/jobs";
import adminDownloadRoutes from "./routes/admin/download";
import adminScanRoutes from "./routes/admin/scan";
import adminOverviewRoutes from "./routes/admin/overview";
import adminCatalogFolderRoutes from "./routes/admin/catalogFolder";
import adminCatalogVideoRoutes from "./routes/admin/catalogVideo";
import adminSubtitleSetRoutes from "./routes/admin/subtitleSets";

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
app.use("/api/thumbnail-folder", folderThumbnailRouter);
app.use("/api/progress", progressRoutes);
app.use("/api/probe", probeRoutes);
app.use("/api/health", healthRoutes);
app.use("/api/watch-parties", watchPartyRoutes);

app.use("/api/admin/stage", adminStageRoutes);
app.use("/api/admin/convert", adminConvertRoutes);
app.use("/api/admin/jobs", adminJobsRoutes);
app.use("/api/admin/download", adminDownloadRoutes);
app.use("/api/admin/scan", adminScanRoutes);
app.use("/api/admin/catalog/overview", adminOverviewRoutes);
app.use("/api/admin/catalog/folder", adminCatalogFolderRoutes);
app.use("/api/admin/catalog/video", adminCatalogVideoRoutes);
app.use("/api/admin/subtitle-sets", adminSubtitleSetRoutes);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// SSL_CERT_PATH/SSL_KEY_PATH are set by the root ecosystem.config.js (pm2) for the
// https://<IP>:<PORT> deployment (self-signed cert, see scripts/generate-self-signed-cert.sh) —
// absent locally, where plain HTTP is fine.
const server =
  env.sslCertPath && env.sslKeyPath
    ? createHttpsServer({ cert: readFileSync(env.sslCertPath), key: readFileSync(env.sslKeyPath) }, app)
    : createHttpServer(app);

seedAdminUser(env.adminEmail, env.adminPassword)
  .then(() => {
    server.listen(env.port, () => {
      const protocol = env.sslCertPath && env.sslKeyPath ? "https" : "http";
      console.log(`Campfire backend listening on ${protocol}://0.0.0.0:${env.port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to seed admin user:", error);
    process.exit(1);
  });
