// Serves the static `dist/` build in production (run by pm2 via the root ecosystem.config.js —
// see apps/frontend/README-ish notes in the root README's "Deployment" section). Not used in
// local dev, where `vite dev` already serves the app directly.
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sirv from "sirv";

const port = process.env.PORT || 50000;

const distDir = join(dirname(fileURLToPath(import.meta.url)), "dist");
// `single: true` — SPA fallback, same as netlify.toml's redirect rule: every path serves
// index.html so react-router's client-side routes (e.g. /watch/:fileId) work on a hard refresh.
const serve = sirv(distDir, { single: true, gzip: true });

// sirv resolves Content-Type via mrmime, whose built-in table has no `.apk` entry — with no
// Content-Type at all, browsers sniff the file's own bytes, and since an APK is itself a ZIP
// container, that resolves to application/zip and gets saved as "Campfire.apk.zip" instead of
// "Campfire.apk". The frontend's download links now also set an explicit `download` attribute
// (see TopBar.tsx/DesktopAppRequiredNotice.tsx/LoginPage.tsx) to force the right filename
// regardless, but this covers anyone hitting the URL directly.
const server = createHttpServer((req, res) => {
  if (req.url === "/Campfire.apk") {
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", 'attachment; filename="Campfire.apk"');
  } else if (req.url === "/Campfire.exe") {
    res.setHeader("Content-Disposition", 'attachment; filename="Campfire.exe"');
  }
  serve(req, res);
});

server.listen(port, () => {
  console.log(`Campfire frontend serving ${distDir} on http://0.0.0.0:${port}`);
});
