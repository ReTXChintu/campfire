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
  get adminEmails(): string[] {
    return (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
  },
  get googleClientId() {
    return required("GOOGLE_CLIENT_ID");
  },
  get googleClientSecret() {
    return required("GOOGLE_CLIENT_SECRET");
  },
  get authCallbackUrl() {
    return required("AUTH_CALLBACK_URL");
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
};
