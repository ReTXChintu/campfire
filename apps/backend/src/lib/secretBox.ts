import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env";

/** Secrets an admin types into the app (a video host's API key), kept encrypted in the database:
 * a copy of the database alone doesn't reveal them. The key comes from AUTH_JWT_SECRET, so changing
 * that means entering them again. */

const key = () => createHash("sha256").update(`secret-box:${env.authJwtSecret}`).digest();

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
}

/** Null when it can't be read back (AUTH_JWT_SECRET changed since). */
export function unseal(sealed: string): string | null {
  try {
    const raw = Buffer.from(sealed, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
