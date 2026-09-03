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

const server = createHttpServer(serve);

server.listen(port, () => {
  console.log(`Campfire frontend serving ${distDir} on http://0.0.0.0:${port}`);
});
