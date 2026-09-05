import { join } from "node:path";
import { env } from "../config/env";

/** Where a given video's rendition at `height` lives on disk (see config/env.ts's renditionsDir). */
export function renditionFilePath(fileId: string, height: number): string {
  return join(env.renditionsDir, fileId, `${height}p.mp4`);
}
