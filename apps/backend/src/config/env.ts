import { join, resolve } from "node:path";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get port() {
    return Number(process.env.PORT) || 4000;
  },
  get mongodbUri() {
    return required("MONGODB_URI");
  },
  get mongodbDbName() {
    return process.env.MONGODB_DB_NAME || "stream";
  },
  get googleServiceAccountKeyBase64() {
    return required("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64");
  },
  get driveRootFolderId() {
    return required("DRIVE_ROOT_FOLDER_ID");
  },
  // The one seeded admin login account (see lib/users.ts's seedAdminUser, called from index.ts at
  // startup) — the only email isAdminEmail() ever matches, regardless of who else signs up.
  get adminEmail() {
    return required("ADMIN_EMAIL").toLowerCase();
  },
  get adminPassword() {
    return required("ADMIN_PASSWORD");
  },
  get frontendUrl() {
    return required("FRONTEND_URL");
  },
  get authJwtSecret() {
    return required("AUTH_JWT_SECRET");
  },
  get mediaTokenSecret() {
    return required("MEDIA_TOKEN_SECRET");
  },
  get livekitUrl(): string | undefined {
    return process.env.LIVEKIT_URL || undefined;
  },
  get livekitApiKey(): string | undefined {
    return process.env.LIVEKIT_API_KEY || undefined;
  },
  get livekitApiSecret(): string | undefined {
    return process.env.LIVEKIT_API_SECRET || undefined;
  },
  // Optional — defaults to relying on PATH, which is what breaks under pm2 most often (its
  // daemon's PATH doesn't always match an interactive shell's, e.g. nvm/asdf-installed tools or
  // anything only added in .bashrc). Set these to absolute paths (`which ffmpeg`) if you see
  // "spawn ffmpeg ENOENT" / "spawn ffprobe ENOENT" in the logs.
  get ffmpegPath() {
    return process.env.FFMPEG_PATH || "ffmpeg";
  },
  get ffprobePath() {
    return process.env.FFPROBE_PATH || "ffprobe";
  },
  // Where pre-generated quality-rendition files (see lib/renditions.ts) live on disk — a real,
  // permanent directory, not the OS temp dir — these are generated once and then served for good.
  // Defaults to a sibling of dist/ inside the backend package; override for a different disk/mount.
  get renditionsDir() {
    return process.env.RENDITIONS_DIR || join(__dirname, "..", "..", "renditions");
  },
  // Reference images attached to movie/series requests (see lib/requestImages.ts) — permanent,
  // like renditionsDir and for the same reason: a request can sit in the queue for weeks.
  get requestImagesDir() {
    return process.env.REQUEST_IMAGES_DIR || join(__dirname, "..", "..", "request-images");
  },
  // TMDb posters/backdrops for catalog titles (see lib/artwork.ts), downloaded once on first view
  // and served from here. A cache, not a source of truth: delete it and images are re-fetched.
  get artworkDir() {
    return resolve(process.env.ARTWORK_DIR || join(__dirname, "..", "..", "artwork"));
  },
  // Seek-bar preview frames (see lib/trickplay.ts): sprite sheets made once per video on its first
  // play. A cache like artworkDir — delete it and they're made again. TRICKPLAY=off stops new ones
  // being made (each costs one full read of the file from Drive).
  get trickplayDir() {
    return resolve(process.env.TRICKPLAY_DIR || join(__dirname, "..", "..", "trickplay"));
  },
  get trickplayEnabled() {
    return !/^(0|off|false|no)$/i.test(process.env.TRICKPLAY ?? "");
  },
  // Optional. With it, a pasted IMDb/TMDb link on a request is resolved to a real title, year,
  // type and poster; without it the link is simply stored and the admin opens it themselves.
  // Nothing fails when it's missing — see lib/referenceLink.ts.
  get tmdbApiKey(): string | undefined {
    return process.env.TMDB_API_KEY || undefined;
  },
  // Test hooks only (scripts/smoke-artwork.mjs points them at a local mock); never set in prod.
  get tmdbApiBase() {
    return process.env.TMDB_API_BASE || "https://api.themoviedb.org/3";
  },
  get tmdbImageBase() {
    return process.env.TMDB_IMAGE_BASE || "https://image.tmdb.org/t/p";
  },
  // Test hooks (scripts/smoke-anilist.mjs points them at a local mock); never set in prod.
  get anilistApiBase() {
    return process.env.ANILIST_API_BASE || "https://graphql.anilist.co";
  },
  get animeMapUrl() {
    return process.env.ANIME_MAP_URL || "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
  },
  // Test hooks too (scripts/smoke-sources.mjs).
  get bunnyApiBase() {
    return process.env.BUNNY_API_BASE || "https://video.bunnycdn.com";
  },
  get cloudflareApiBase() {
    return process.env.CLOUDFLARE_API_BASE || "https://api.cloudflare.com/client/v4";
  },
};
