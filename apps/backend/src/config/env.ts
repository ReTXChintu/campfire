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
  // Optional — both unset means "serve plain HTTP" (local dev). Set by pm2's ecosystem.config.js
  // in the https://<IP>:<PORT> deployment; see scripts/generate-self-signed-cert.sh.
  get sslCertPath(): string | undefined {
    return process.env.SSL_CERT_PATH || undefined;
  },
  get sslKeyPath(): string | undefined {
    return process.env.SSL_KEY_PATH || undefined;
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
};
