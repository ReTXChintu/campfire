import "dotenv/config";
import express from "express";
import cors from "cors";
import passport from "passport";
import { env } from "./config/env";

import authRoutes from "./routes/auth";
import mediaTokenRoutes from "./routes/media-token";
import catalogRoutes from "./routes/catalog";
import streamRoutes from "./routes/stream";
import subtitleRoutes from "./routes/subtitle";
import thumbnailRoutes, { folderThumbnailRouter } from "./routes/thumbnail";
import progressRoutes from "./routes/progress";
import probeRoutes from "./routes/probe";
import healthRoutes from "./routes/health";

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
app.use(passport.initialize());
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

app.listen(env.port, () => {
  console.log(`Campfire backend listening on port ${env.port}`);
});
