// Mirrors conversionQueue.ts's shape (single always-on VPS process, deliberately one ffmpeg job at
// a time — never runs a rendition encode concurrently with a Converter job or another rendition,
// since both are CPU-heavy libx264 encodes competing for the same box).
import { generateRenditionFile } from "./drive";
import { renditionFilePath } from "./renditions";
import { claimNextQueuedRendition, markRenditionDone, markRenditionFailed } from "./catalogVideos";
import { QUALITY_LADDER } from "./qualityLadder";

const POLL_INTERVAL_MS = 15_000;
const HEIGHTS = QUALITY_LADDER.map((q) => q.height);

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function runOne(): Promise<boolean> {
  const claim = await claimNextQueuedRendition(HEIGHTS);
  if (!claim) return false;
  const { fileId, height } = claim;

  try {
    await generateRenditionFile(fileId, height, renditionFilePath(fileId, height));
    await markRenditionDone(fileId, height);
  } catch (error) {
    console.error(`[renditionQueue] ${fileId}@${height}p failed:`, error);
    await markRenditionFailed(fileId, height, error instanceof Error ? error.message : "Generation failed").catch(
      () => {},
    );
  }
  return true;
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (await runOne()) {
      // keep going while more queued renditions are waiting
    }
  } finally {
    running = false;
  }
}

export function startRenditionQueue(): void {
  if (timer) return;
  drain().catch((error) => console.error("[renditionQueue] drain failed:", error));
  timer = setInterval(() => {
    drain().catch((error) => console.error("[renditionQueue] drain failed:", error));
  }, POLL_INTERVAL_MS);
}
