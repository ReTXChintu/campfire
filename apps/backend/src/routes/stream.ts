import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Router, type Response } from "express";
import {
  streamFile,
  getMimeType,
  isNativelyPlayable,
  isMkv,
  remuxToMp4,
  readDriveHeader,
} from "../lib/drive";
import { getCatalogVideo } from "../lib/catalogVideos";
import { renditionFilePath } from "../lib/renditions";
import { QUALITY_LADDER } from "../lib/qualityLadder";
import { requireMediaAccess } from "../middleware/mediaAuth";

const router = Router();

const STORED_HEIGHTS = new Set<number>(QUALITY_LADDER.map((q) => q.height));

/** Serves a pre-generated rendition file from disk with real Range support — the same passthrough
 * headers/semantics as the Drive passthrough branch below, just against a local file. */
async function serveLocalFile(filePath: string, range: string | null, res: Response) {
  const stats = await stat(filePath);
  res.setHeader("content-type", "video/mp4");
  res.setHeader("accept-ranges", "bytes");

  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (match) {
    // A suffix range ("bytes=-500", empty start) means "the last 500 bytes" — distinct from an
    // open-ended range ("bytes=0-"), which means "from 0 to the end". Video players in practice
    // only ever send the latter, but Drive's own passthrough branch above handles both correctly
    // (it just forwards the header), so this local-file path should too.
    const isSuffixRange = match[1] === "" && match[2] !== "";
    const start = isSuffixRange ? Math.max(0, stats.size - Number(match[2])) : match[1] ? Number(match[1]) : 0;
    const end = isSuffixRange ? stats.size - 1 : match[2] ? Number(match[2]) : stats.size - 1;
    const clampedEnd = Math.min(end, stats.size - 1);
    res.status(206);
    res.setHeader("content-range", `bytes ${start}-${clampedEnd}/${stats.size}`);
    res.setHeader("content-length", String(clampedEnd - start + 1));
    const readStream = createReadStream(filePath, { start, end: clampedEnd });
    readStream.pipe(res);
    res.on("close", () => readStream.destroy());
    return;
  }

  res.status(200);
  res.setHeader("content-length", String(stats.size));
  const readStream = createReadStream(filePath);
  readStream.pipe(res);
  res.on("close", () => readStream.destroy());
}

router.get("/:fileId", requireMediaAccess("fileId"), async (req, res) => {
  const { fileId } = req.params;
  const range = req.headers.range ?? null;
  const mimeType = await getMimeType(fileId);

  // MKV only takes the raw byte-passthrough path when a capable client explicitly asks for it
  // (desktop/mobile's media_kit-based player — see MediaKitVideoPlayer) — by default (and always
  // for web, which never sends this param) it still goes through the ffmpeg remux below, same as
  // any other non-native container. This keeps the web admin curation page's plain <video> preview
  // working for MKV files exactly as before, since a browser can't demux raw MKV at all.
  const wantsRaw = req.query.raw === "1";

  // `h`: request one of the pre-generated quality renditions (see lib/qualityLadder.ts /
  // lib/renditions.ts) — admin-triggered ahead of time, not transcoded on this request. Only wins
  // over the passthrough/raw branch below when that rendition actually exists and is ready
  // ("done"); anything else (omitted, an unrecognized height, or a rendition that's still queued/
  // processing/failed — shouldn't normally happen since the player only ever offers heights probe
  // already reported as ready) falls straight through to today's default passthrough/remux
  // behavior, byte-identical to a video with no `h` param at all.
  const hParam = req.query.h;
  const requestedHeight = typeof hParam === "string" && Number.isFinite(Number(hParam)) ? Number(hParam) : null;
  if (requestedHeight != null && STORED_HEIGHTS.has(requestedHeight)) {
    const video = await getCatalogVideo(fileId);
    const entry = video?.renditions?.[String(requestedHeight)];
    if (entry?.status === "done") {
      const filePath = renditionFilePath(fileId, requestedHeight);
      try {
        await serveLocalFile(filePath, range, res);
        return;
      } catch (error) {
        // The DB says "done" but the file's missing/unreadable (disk cleared, moved renditionsDir,
        // ...) — log it and fall through to the normal passthrough/remux path below rather than
        // erroring the whole request over a quality that was only ever a nice-to-have.
        console.error(`[stream] rendition file for ${fileId}@${requestedHeight}p unreadable:`, error);
      }
    }
  }

  if (isNativelyPlayable(mimeType) || (isMkv(mimeType) && wantsRaw)) {
    const driveRes = await streamFile(fileId, range);

    const passthroughHeaders = ["content-type", "content-length", "content-range", "accept-ranges"];
    for (const key of passthroughHeaders) {
      const value = readDriveHeader(driveRes.headers, key);
      if (value) res.setHeader(key, value);
    }
    if (!res.getHeader("accept-ranges")) res.setHeader("accept-ranges", "bytes");
    res.status(driveRes.status);

    driveRes.data.pipe(res);
    res.on("close", () => driveRes.data.destroy());
    return;
  }

  // A non-natively-playable container: remux to fragmented MP4 on the fly, seeking near `t` seconds
  // via ffmpeg input-level -ss. Each request is a fresh non-seekable resource (no Range/duration) —
  // the player restarts the stream at a new `t` whenever the user scrubs.
  const tParam = req.query.t;
  const parsed = typeof tParam === "string" ? Number(tParam) : 0;
  const startSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

  const audioParam = req.query.audio;
  const audioIndex =
    typeof audioParam === "string" && Number.isFinite(Number(audioParam)) ? Number(audioParam) : null;

  const adelayParam = req.query.adelay;
  const audioDelayMs =
    typeof adelayParam === "string" && Number.isFinite(Number(adelayParam))
      ? Math.trunc(Number(adelayParam))
      : 0;

  const abortController = new AbortController();
  req.on("close", () => abortController.abort());

  const mp4Stream = await remuxToMp4(fileId, startSeconds, abortController.signal, {
    audioIndex,
    audioDelayMs,
  });

  res.status(200);
  res.setHeader("content-type", "video/mp4");
  res.setHeader("cache-control", "no-store");
  mp4Stream.pipe(res);
  res.on("close", () => mp4Stream.destroy());
});

export default router;
