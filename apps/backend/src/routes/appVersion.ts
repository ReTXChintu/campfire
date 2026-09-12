import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";
import { env } from "../config/env";

// Backend's own package.json version — kept in lockstep with the mobile app's pubspec.yaml by
// `npm run release` (see scripts/sync-mobile-version.mjs and AGENTS.md), so "the version this
// backend is currently running" and "the version the release workflow just shipped as
// Campfire.apk/Campfire.exe" are always the same number. Read once at startup via fs rather than a
// JSON import — avoids fighting tsconfig's rootDir (this file lives under src/, package.json
// doesn't) for a value that never changes without a restart anyway.
const packageJson = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8")) as {
  version: string;
};

const router = Router();

// Public — no auth required. Side-loaded APK/Windows-installer builds have no Play Store/app-store
// auto-update, so this is the only signal a client gets that a newer build exists; it needs to work
// even for a signed-out user sitting on the login screen. See apps/mobile/lib/services/
// app_update_service.dart. Fixed download filenames (Campfire.apk/Campfire.exe) match
// .github/workflows/release-deploy.yml, which SCPs both to the frontend's own static /public dir.
router.get("/", (_req, res) => {
  res.json({
    version: packageJson.version,
    androidDownloadUrl: `${env.frontendUrl}/Campfire.apk`,
    windowsDownloadUrl: `${env.frontendUrl}/Campfire.exe`,
  });
});

export default router;
