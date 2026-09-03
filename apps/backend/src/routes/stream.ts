import { Router } from "express";
import {
  streamFile,
  getMimeType,
  isNativelyPlayable,
  isMkv,
  remuxToMp4,
  readDriveHeader,
} from "../lib/drive";
import { requireMediaAccess } from "../middleware/mediaAuth";

const router = Router();

router.get("/:fileId", requireMediaAccess("fileId"), async (req, res) => {
  const { fileId } = req.params;
  const range = req.headers.range ?? null;
  const mimeType = await getMimeType(fileId);

  // MKV only takes the raw byte-passthrough path when a capable client explicitly asks for it
  // (desktop/mobile's media_kit-based player — see MkvVideoPlayer) — by default (and always for
  // web, which never sends this param) it still goes through the ffmpeg remux below, same as any
  // other non-native container. This keeps the web admin curation page's plain <video> preview
  // working for MKV files exactly as before, since a browser can't demux raw MKV at all.
  const wantsRaw = req.query.raw === "1";
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

  // Any other non-natively-playable container: remux to fragmented MP4 on the fly, seeking near
  // `t` seconds via ffmpeg input-level -ss. Each request is a fresh non-seekable resource (no
  // Range/duration) — the player restarts the stream at a new `t` whenever the user scrubs.
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
