function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
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
};
