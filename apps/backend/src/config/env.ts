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
  // Single-admin app now (no Google login, no signup) — this is both the seeded login account
  // (see lib/users.ts's seedAdminUser, called from index.ts at startup) and the only email
  // isAdminEmail() ever matches.
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
};
