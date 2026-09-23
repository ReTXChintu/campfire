import { google, drive_v3 } from "googleapis";
import { spawn } from "node:child_process";
import type { Readable } from "node:stream";
import { writeFile, unlink, mkdir, rename } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { env } from "../config/env";
import { videoBitrateKbpsFor, audioBitrateKbpsFor } from "./qualityLadder";

// The app never *uploads* to Drive. (It briefly did, for an in-app upload flow — abandoned
// because service accounts have no storage quota of their own, so any byte-upload under a regular
// "My Drive" folder fails with "Service Accounts do not have storage quota" — only shared drives
// or real-user OAuth delegation can, neither of which fits a personal account. Uploads happen by
// hand in Drive's own UI; the admin panel is a local convert-and-download tool.) The one write it
// does do is trashing a file from the admin "Delete video" action (see trashDriveFile) — a
// metadata update, no storage involved, so it works fine as long as the service account has
// Editor access on the shared library folder. Hence the full scope rather than drive.readonly.
const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"];

let driveClient: drive_v3.Drive | undefined;
let jwtClient: InstanceType<typeof google.auth.JWT> | undefined;

function getAuthClient() {
  if (jwtClient) return jwtClient;

  const credentials = JSON.parse(
    Buffer.from(env.googleServiceAccountKeyBase64, "base64").toString("utf-8"),
  ) as { client_email: string; private_key: string };

  jwtClient = new google.auth.JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: DRIVE_SCOPES,
  });
  return jwtClient;
}

function getDrive(): drive_v3.Drive {
  if (driveClient) return driveClient;
  driveClient = google.drive({ version: "v3", auth: getAuthClient() });
  return driveClient;
}

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

/** Moves a file to Drive's trash (recoverable there for 30 days) rather than deleting it outright
 * — permanent deletion needs file ownership, which a service account never has on a personal
 * account's files. Throws on a Drive error (typically 403: the service account only has Viewer
 * access on the library folder, so it can't modify files there). */
export async function trashDriveFile(fileId: string): Promise<void> {
  await getDrive().files.update({ fileId, requestBody: { trashed: true } });
}

export type DriveVideoItem = {
  kind: "video";
  id: string;
  name: string;
  mimeType: string;
  size?: string | null;
  durationMillis?: string | null;
  createdTime?: string | null;
};

export type DriveFolderItem = {
  kind: "folder";
  id: string;
  name: string;
  createdTime?: string | null;
};

export type DriveListItem = DriveVideoItem | DriveFolderItem;

const LIST_FIELDS =
  "nextPageToken, files(id, name, mimeType, size, videoMediaMetadata, parents, createdTime)";

function toListItem(file: drive_v3.Schema$File): DriveListItem | null {
  if (!file.id || !file.name) return null;

  if (file.mimeType === FOLDER_MIME_TYPE) {
    return { kind: "folder", id: file.id, name: file.name, createdTime: file.createdTime };
  }

  if (file.mimeType?.startsWith("video/")) {
    return {
      kind: "video",
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      durationMillis: file.videoMediaMetadata?.durationMillis,
      createdTime: file.createdTime,
    };
  }

  return null;
}

async function listChildren(
  folderId: string,
  extraQuery?: string,
): Promise<drive_v3.Schema$File[]> {
  const drive = getDrive();
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;

  const q = [`'${folderId}' in parents`, "trashed = false", extraQuery]
    .filter(Boolean)
    .join(" and ");

  do {
    const res = await drive.files.list({
      q,
      fields: LIST_FIELDS,
      orderBy: "name_natural",
      pageSize: 1000,
      pageToken,
    });
    files.push(...(res.data.files ?? []));
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return files;
}

// A folder-level poster: the admin uploads a file with this name (any of these three extensions,
// case-insensitive) directly into a Drive folder via Drive's own UI — no separate image-upload
// route needed, consistent with how every other piece of content gets into this app (manual Drive
// upload, picked up by the next scan).
const THUMBNAIL_NAME_RE = /^thumbnail\.(jpe?g|png)$/i;

export type FolderContents = { items: DriveListItem[]; thumbnailFileId: string | null };

/** Lists the direct children of a folder, classified as videos or subfolders (folders nest
 * arbitrarily deep), and separately reports a "thumbnail.*" image file if one's present — a single
 * Drive listing call serves both, since the scan needs both anyway. */
export async function listFolderWithThumbnail(folderId: string): Promise<FolderContents> {
  const files = await listChildren(folderId);
  const items = files.map(toListItem).filter((item): item is DriveListItem => item !== null);
  const thumbnailFile = files.find(
    (f) => f.name && THUMBNAIL_NAME_RE.test(f.name) && f.mimeType?.startsWith("image/"),
  );
  return { items, thumbnailFileId: thumbnailFile?.id ?? null };
}

export async function getFileMeta(fileId: string) {
  const drive = getDrive();
  const res = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, parents, videoMediaMetadata, thumbnailLink",
  });
  return res.data;
}

// Formats the <video> element can decode/demux natively in mainstream browsers.
// Anything else (mkv, avi, wmv, ...) is remuxed to fragmented MP4 on the fly, see remuxToMp4().
const NATIVE_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/ogg"]);

const mimeTypeCache = new Map<string, string>();

export async function getMimeType(fileId: string): Promise<string> {
  const cached = mimeTypeCache.get(fileId);
  if (cached) return cached;

  const meta = await getFileMeta(fileId);
  const mimeType = meta.mimeType ?? "application/octet-stream";
  mimeTypeCache.set(fileId, mimeType);
  return mimeType;
}

export function isNativelyPlayable(mimeType: string): boolean {
  return NATIVE_MIME_TYPES.has(mimeType);
}

// MKV gets a third streaming mode of its own, but — unlike native mp4/webm/ogg — only on explicit
// request (see routes/stream.ts's `raw` query param): its bytes are just as Range-servable as
// MP4's (see streamFile below), but a plain browser <video> can't demux the container at all, so
// the *default* behavior for an MKV fileId must stay the ffmpeg remux, same as before this existed
// — that's what the web admin curation page's plain <video> preview relies on, for any video
// regardless of seekMode. Only a capable client that explicitly asks for raw bytes (the desktop/
// mobile MKV player, built on libmpv via media_kit) gets true seeking and native embedded audio/
// subtitle track selection instead of ffmpeg's live restart-on-seek hack.
// "video/x-matroska" is the IANA-registered type, but Google Drive's own detector reports plain
// "video/matroska" for at least some MKV files (confirmed live — Drive doesn't consistently use
// the x- prefixed form) — both are accepted so isMkv() doesn't silently miss real MKV files and
// fall back to the ffmpeg remux path.
const MKV_MIME_TYPES = new Set(["video/x-matroska", "video/matroska"]);

export function isMkv(mimeType: string): boolean {
  return MKV_MIME_TYPES.has(mimeType);
}

export async function getDriveAccessToken(): Promise<string> {
  const { token } = await getAuthClient().getAccessToken();
  if (!token) throw new Error("Failed to obtain Drive access token");
  return token;
}

// gaxios's response.headers is typed as the Fetch `Headers` class but at runtime is an
// undici Headers instance that fails `instanceof Headers` (duplicate-class/realm issue) —
// duck-type on `.get` instead of relying on bracket access or instanceof.
export function readDriveHeader(headers: unknown, key: string): string | undefined {
  const get = (headers as { get?: (k: string) => string | null } | undefined)?.get;
  if (typeof get === "function") return get.call(headers, key) ?? undefined;

  const value = (headers as Record<string, string | string[]> | undefined)?.[key];
  return Array.isArray(value) ? value[0] : value;
}

/** Streams raw file bytes from Drive, forwarding a Range header for seekable playback. */
export async function streamFile(fileId: string, range: string | null) {
  const drive = getDrive();
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "stream", headers: range ? { Range: range } : undefined },
  );
  return res;
}

export type RemuxOptions = { audioIndex?: number | null; audioDelayMs?: number };

/**
 * Remuxes a non-natively-playable container (e.g. MKV) into fragmented MP4 on the fly via ffmpeg.
 * ffmpeg fetches directly from Drive's HTTP media endpoint (rather than us piping bytes through
 * Node) so its own demuxer can issue Range requests and seek near `startSeconds` via input-level
 * `-ss` — this is what makes scrubbing possible despite the output being a live, moov-less stream
 * with no byte-range/duration info of its own. Audio is transcoded to AAC since browsers can't
 * decode the AC3/DTS/etc. tracks common in MKV rips. Video is always stream-copied (no re-encode) —
 * adjustable-quality playback below source resolution is served from a pre-generated rendition file
 * instead (see lib/renditions.ts / routes/stream.ts's `h` param), not by re-encoding here.
 *
 * `audioIndex` (an absolute ffprobe stream index, from `probeStreams`) selects a non-default audio
 * track — omitted, this falls back to ffmpeg's own "first audio stream" shorthand. `audioDelayMs`
 * shifts audio relative to video via an ffmpeg filter (positive = audio starts later, via `adelay`;
 * negative = audio starts earlier, via trimming its leading edge) since audio is baked into the
 * muxed output and can't be shifted client-side the way subtitle cues can.
 */
export async function remuxToMp4(
  fileId: string,
  startSeconds: number,
  signal: AbortSignal,
  { audioIndex = null, audioDelayMs = 0 }: RemuxOptions = {},
): Promise<Readable> {
  const accessToken = await getDriveAccessToken();
  const mediaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const audioMapArg = audioIndex != null ? `0:${audioIndex}` : "0:a:0";

  const args = [
    "-headers", `Authorization: Bearer ${accessToken}\r\n`,
    "-ss", String(Math.max(0, startSeconds)),
    "-i", mediaUrl,
    "-map", "0:v:0",
    "-map", audioMapArg,
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    // Downmix to stereo: ffmpeg's native AAC encoder can't reliably encode >2 channels (hit
    // live: "Unsupported channel layout '6 channels'" on a 5.1 AC3/EAC3 source track, common in
    // MKV rips) — browsers don't render surround differently from stereo, so this is a pure
    // reliability fix, not a quality tradeoff that matters for web playback.
    "-ac", "2",
  ];
  if (audioDelayMs > 0) {
    args.push("-af", `adelay=${audioDelayMs}:all=1`);
  } else if (audioDelayMs < 0) {
    args.push("-af", `atrim=start=${-audioDelayMs / 1000},asetpts=PTS-STARTPTS`);
  }
  args.push("-f", "mp4", "-movflags", "frag_keyframe+empty_moov+default_base_moof", "pipe:1");

  const ffmpeg = spawn(env.ffmpegPath, args, { signal, killSignal: "SIGKILL" });

  ffmpeg.on("error", (err) => {
    // spawn's `signal` abort emits 'error' too (AbortError) — expected, not a real failure.
    if (isEnoent(err)) logBinaryNotFound("ffmpeg", env.ffmpegPath);
  });
  ffmpeg.stdout.on("error", () => {}); // client disconnects mid-stream (EPIPE), expected
  ffmpeg.stderr.on("data", (chunk) => process.stderr.write(`[ffmpeg ${chunk}`));

  return ffmpeg.stdout;
}

/**
 * Encodes one full, permanent quality rendition of a Drive video to `destPath` — used by
 * lib/renditionQueue.ts, not per-request. Unlike `remuxToMp4` (a live, seek-on-request, pipe-to-
 * stdout stream with no real duration/Range of its own), this writes a real on-disk MP4 with
 * `-movflags +faststart` so routes/stream.ts can serve it later with genuine Range support, same as
 * a natively-playable passthrough file. A `preset` of "medium" (vs. `remuxToMp4`'s "veryfast") is
 * fine here since this only ever runs once per video/height, not on the latency-sensitive request
 * path. Only the default video/audio track are muxed (no embedded subtitles) — same tradeoff
 * `remuxToMp4` already makes; a video's admin-curated subtitleSets are a separate, unaffected
 * mechanism. Writes to a temp file alongside the destination first, then renames into place, so a
 * request that races a still-in-progress generation can never see a truncated/partial file.
 */
export async function generateRenditionFile(fileId: string, targetHeight: number, destPath: string): Promise<void> {
  await mkdir(dirname(destPath), { recursive: true });
  const tempPath = `${destPath}.tmp-${randomUUID()}`;

  const inputArgs = await sourceInputArgs({ type: "drive", fileId });
  const videoBitrate = videoBitrateKbpsFor(targetHeight);
  const args = [
    ...inputArgs,
    "-map", "0:v:0",
    "-map", "0:a:0",
    "-c:v", "libx264",
    "-preset", "medium",
    "-vf", `scale=-2:${targetHeight}`,
    "-b:v", `${videoBitrate}k`,
    "-maxrate", `${Math.round(videoBitrate * 1.5)}k`,
    "-bufsize", `${videoBitrate * 2}k`,
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", `${audioBitrateKbpsFor(targetHeight)}k`,
    "-ac", "2",
    "-movflags", "+faststart",
    "-f", "mp4",
    "-y",
    tempPath,
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(env.ffmpegPath, args);
      const stderrTail: string[] = [];
      ffmpeg.stderr.on("data", (chunk: Buffer) => {
        process.stderr.write(`[ffmpeg-rendition ${chunk}`);
        stderrTail.push(chunk.toString("utf-8"));
        if (stderrTail.length > 20) stderrTail.shift();
      });
      ffmpeg.on("error", (err) => reject(friendlyBinaryError(err, "ffmpeg")));
      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          const detail = stderrTail.join("").trim().split("\n").slice(-5).join(" | ");
          reject(new Error(`ffmpeg rendition generation failed (exit ${code})${detail ? `: ${detail}` : ""}`));
        }
      });
    });
    await rename(tempPath, destPath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && (err as NodeJS.ErrnoException).code === "ENOENT";
}

function logBinaryNotFound(label: "ffmpeg" | "ffprobe", triedPath: string): void {
  const envVar = label === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH";
  console.error(
    `[${label}] binary not found (tried "${triedPath}") — install it and make sure it's on PATH, or set ${envVar} in .env to its absolute path (e.g. the output of \`which ${label}\`). This is a common gotcha under pm2, whose daemon's PATH doesn't always match an interactive shell's.`,
  );
}

/** Wraps a spawn/exit failure with an actionable message when the binary itself couldn't be
 * found — the raw "spawn ffmpeg ENOENT" Node error isn't obvious about what to do next. */
function friendlyBinaryError(err: unknown, label: "ffmpeg" | "ffprobe"): Error {
  if (isEnoent(err)) {
    logBinaryNotFound(label, label === "ffmpeg" ? env.ffmpegPath : env.ffprobePath);
    const envVar = label === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH";
    return new Error(
      `${label} was not found — install it and make sure it's on PATH, or set ${envVar} in .env to its absolute path.`,
    );
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Spawns a process, buffers its full stdout, and kills it if it hasn't exited within `timeoutMs`. */
function runBuffered(cmd: string, label: "ffmpeg" | "ffprobe", args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);

    proc.stdout.on("data", (chunk) => chunks.push(chunk));
    proc.stderr.on("data", (chunk) => process.stderr.write(`[${label} ${chunk}`));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(friendlyBinaryError(err, label));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

export type StreamTrack = {
  index: number;
  language: string | null;
  title: string | null;
  codecName: string;
};

export type ProbeResult = {
  videoTrack: { index: number; codecName: string; width: number | null; height: number | null } | null;
  audioTracks: StreamTrack[];
  subtitleTracks: StreamTrack[];
  durationSeconds: number | null;
};

// Subtitle codecs ffmpeg can losslessly convert to WebVTT for a <track> element. Image-based
// formats (PGS/VobSub/DVB) need OCR to become text and are deliberately excluded — those tracks
// just won't show up as selectable rather than erroring.
const TEXT_SUBTITLE_CODECS = new Set(["subrip", "ass", "ssa", "mov_text", "webvtt"]);

const probeCache = new Map<string, ProbeResult>();

// A probe/convert operation reads either from Drive (over HTTP, with a bearer token) or from a
// local file already staged on disk (see the admin upload staging flow) — the ffmpeg/ffprobe
// argument-building logic is identical either way except for how the input is specified, so both
// entry points funnel through here rather than duplicating the (already debugged once) details
// like `-ss` placement, video-codec detection, and subtitle extraction.
type MediaSource = { type: "drive"; fileId: string } | { type: "local"; path: string };

async function sourceInputArgs(source: MediaSource): Promise<string[]> {
  if (source.type === "local") return ["-i", source.path];
  const accessToken = await getDriveAccessToken();
  const mediaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(source.fileId)}?alt=media`;
  return ["-headers", `Authorization: Bearer ${accessToken}\r\n`, "-i", mediaUrl];
}

async function probeSource(source: MediaSource): Promise<ProbeResult> {
  const raw = await runBuffered(
    env.ffprobePath,
    "ffprobe",
    [
      "-v", "error",
      "-print_format", "json",
      "-show_format",
      "-show_streams",
      ...(await sourceInputArgs(source)),
    ],
    20_000,
  );

  const parsed = JSON.parse(raw.toString("utf-8")) as {
    format?: { duration?: string };
    streams: {
      index: number;
      codec_type: string;
      codec_name: string;
      width?: number;
      height?: number;
      tags?: { language?: string; title?: string };
    }[];
  };

  const toTrack = (s: (typeof parsed.streams)[number]): StreamTrack => ({
    index: s.index,
    language: s.tags?.language ?? null,
    title: s.tags?.title ?? null,
    codecName: s.codec_name,
  });

  const durationSeconds = parsed.format?.duration ? Number(parsed.format.duration) : null;
  const videoStream = parsed.streams.find((s) => s.codec_type === "video");

  return {
    videoTrack: videoStream
      ? {
          index: videoStream.index,
          codecName: videoStream.codec_name,
          width: videoStream.width ?? null,
          height: videoStream.height ?? null,
        }
      : null,
    audioTracks: parsed.streams.filter((s) => s.codec_type === "audio").map(toTrack),
    subtitleTracks: parsed.streams
      .filter((s) => s.codec_type === "subtitle" && TEXT_SUBTITLE_CODECS.has(s.codec_name))
      .map(toTrack),
    durationSeconds: durationSeconds && durationSeconds > 0 ? durationSeconds : null,
  };
}

/**
 * Probes a Drive file's audio/subtitle streams and real duration via ffprobe, so the player can
 * offer track switching and a working seek bar. Drive's own `videoMediaMetadata.durationMillis`
 * (used elsewhere for natively-playable files) can't be trusted for MKV — confirmed live that
 * Google's backend doesn't properly probe this container format and just returns `"0"` (a
 * non-empty, truthy string, so a naive falsy-check doesn't catch it) instead of leaving the field
 * absent. Cached per fileId since this fetches over the network.
 */
export async function probeStreams(fileId: string): Promise<ProbeResult> {
  const cached = probeCache.get(fileId);
  if (cached) return cached;
  const result = await probeSource({ type: "drive", fileId });
  probeCache.set(fileId, result);
  return result;
}

/** Probes a file already staged on local disk (admin upload flow, before it's on Drive at all) —
 * much faster/more reliable than the Drive-URL path since there's no network or bearer-token
 * round trip involved. Not cached — staged files are single-use and short-lived. */
export async function probeLocalFile(filePath: string): Promise<ProbeResult> {
  return probeSource({ type: "local", path: filePath });
}

/**
 * Extracts one subtitle stream and converts it to WebVTT for use in a <track> element, streamed
 * (not buffered) and seeking near `startSeconds` first — like `remuxToMp4`. This has to work the
 * same way as the video remux, not just "run ffmpeg and wait": MKV interleaves subtitle packets
 * throughout the whole container alongside audio/video, so extracting the FULL track for a movie
 * means ffmpeg reading through the entire multi-GB file (confirmed live: ~7x realtime, i.e.
 * minutes for a single file) — reading only the tiny subtitle payload isn't possible without it.
 * Seeking via `-ss` first (fast, same keyframe/cluster seek as video) and streaming cues onward
 * from there keeps this fast and in sync with wherever the player currently is.
 */
export async function extractSubtitle(
  fileId: string,
  subtitleIndex: number,
  startSeconds: number,
  signal: AbortSignal,
): Promise<Readable> {
  const accessToken = await getDriveAccessToken();
  const mediaUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;

  const ffmpeg = spawn(
    env.ffmpegPath,
    [
      "-headers", `Authorization: Bearer ${accessToken}\r\n`,
      "-ss", String(Math.max(0, startSeconds)),
      "-i", mediaUrl,
      "-map", `0:${subtitleIndex}`,
      "-c:s", "webvtt",
      "-f", "webvtt",
      "pipe:1",
    ],
    { signal, killSignal: "SIGKILL" },
  );

  ffmpeg.on("error", (err) => {
    // spawn's `signal` abort emits 'error' too (AbortError) — expected, not a real failure.
    if (isEnoent(err)) logBinaryNotFound("ffmpeg", env.ffmpegPath);
  });
  ffmpeg.stdout.on("error", () => {});
  ffmpeg.stderr.on("data", (chunk) => process.stderr.write(`[ffmpeg-sub ${chunk}`));

  return ffmpeg.stdout;
}

export type ConvertedSubtitle = {
  index: number;
  language: string | null;
  title: string | null;
  vtt: string;
};

export type ConvertResult = {
  tempFilePath: string;
  chosenAudioTrack: StreamTrack | null;
  durationSeconds: number | null;
  subtitles: ConvertedSubtitle[];
};

/** Converts a file already staged on local disk to MP4 — no Drive round trip for the source at
 * all, only the eventual upload of the result. */
export async function convertLocalFileToMp4(
  filePath: string,
  audioIndex: number,
): Promise<ConvertResult> {
  const source: MediaSource = { type: "local", path: filePath };
  const probe = await probeLocalFile(filePath);
  const tempFilePath = join(tmpdir(), `convert-local-${randomUUID()}.mp4`);
  return convertWithInputArgs(source, probe, audioIndex, tempFilePath);
}

async function convertWithInputArgs(
  source: MediaSource,
  probe: ProbeResult,
  audioIndex: number,
  tempFilePath: string,
): Promise<ConvertResult> {
  const videoArgs = probe.videoTrack?.codecName === "h264" ? ["-c:v", "copy"] : ["-c:v", "libx264"];
  const inputArgs = await sourceInputArgs(source);
  const subtitleMapArgs = probe.subtitleTracks.flatMap((t) => ["-map", `0:${t.index}`]);

  try {
    await new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(env.ffmpegPath, [
        ...inputArgs,
        "-map", "0:v:0",
        "-map", `0:${audioIndex}`,
        ...subtitleMapArgs,
        ...videoArgs,
        "-c:a", "aac",
        "-b:a", "192k",
        // Downmix to stereo: ffmpeg's native AAC encoder can't reliably encode >2 channels (hit
        // live: "Unsupported channel layout '6 channels'" on a 5.1 AC3/EAC3 source track, which is
        // common in MKV rips) — browsers don't render surround differently from stereo anyway, so
        // this is a pure reliability fix, not a quality tradeoff that matters for web playback.
        "-ac", "2",
        ...(subtitleMapArgs.length > 0 ? ["-c:s", "mov_text"] : []),
        "-movflags", "+faststart",
        "-f", "mp4",
        "-y",
        tempFilePath,
      ]);
      const stderrTail: string[] = [];
      ffmpeg.stderr.on("data", (chunk: Buffer) => {
        process.stderr.write(`[ffmpeg-convert ${chunk}`);
        stderrTail.push(chunk.toString("utf-8"));
        if (stderrTail.length > 20) stderrTail.shift();
      });
      ffmpeg.on("error", (err) => reject(friendlyBinaryError(err, "ffmpeg")));
      ffmpeg.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          // Surface ffmpeg's own diagnostic (e.g. "Unsupported channel layout") in the error that
          // ends up on the job doc, instead of just the exit code — that's what's actually useful
          // for figuring out what went wrong without digging through server logs.
          const detail = stderrTail.join("").trim().split("\n").slice(-5).join(" | ");
          reject(new Error(`ffmpeg conversion failed (exit ${code})${detail ? `: ${detail}` : ""}`));
        }
      });
    });

    const chosenAudioTrack = probe.audioTracks.find((t) => t.index === audioIndex) ?? null;
    const subtitles = await extractAllSubtitlesToVtt(tempFilePath, probe.subtitleTracks);

    return { tempFilePath, chosenAudioTrack, durationSeconds: probe.durationSeconds, subtitles };
  } catch (error) {
    // ffmpeg's -y flag creates/truncates tempFilePath immediately, so a failure partway through
    // (bad channel layout, unsupported codec, killed process, ...) leaves a broken partial file
    // behind — nothing else ever cleans this up, since the caller's own cleanup only covers the
    // staged *input*. Best-effort delete before re-throwing so the real error still propagates.
    await unlink(tempFilePath).catch(() => {});
    throw error;
  }
}

/**
 * Extracts every subtitle track to full WebVTT text, for permanent storage (subtitle sets get
 * linked to a catalog video later, independent of this conversion job). Reads from the
 * just-produced `outputPath`, not the original (possibly multi-GB) source — the output already has
 * these tracks muxed in as `mov_text` (see `convertWithInputArgs`), so this is a fast read of a
 * small, already-muxed file rather than a full demux pass over a huge source (which live subtitle
 * extraction elsewhere in this file notes can take minutes per track on a large MKV). Uses ordinal
 * subtitle-stream selectors (`0:s:N`) rather than the original absolute stream indices, since the
 * output's stream numbering doesn't match the source's — `-map 0:s:N` addresses the Nth subtitle
 * stream regardless of container, working identically against source or output.
 */
// Pirated rips commonly embed a fake extra "subtitle" stream that's really just a promotional
// watermark (e.g. a single cue reading "Downloaded From <site>" for the first few seconds) — not
// a real subtitle track. A genuine track for a full-length video is always at least tens of KB;
// confirmed live on a real file where the watermark track was 76 bytes against a legitimate
// 32KB track for the same episode. Anything this small is filtered out rather than surfaced as a
// confusing, effectively-empty "subtitle" option.
const MIN_REAL_SUBTITLE_BYTES = 500;

async function extractAllSubtitlesToVtt(
  outputPath: string,
  tracks: StreamTrack[],
): Promise<ConvertedSubtitle[]> {
  const subtitles: ConvertedSubtitle[] = [];
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    try {
      const vtt = await runBuffered(
        env.ffmpegPath,
        "ffmpeg",
        ["-i", outputPath, "-map", `0:s:${i}`, "-c:s", "webvtt", "-f", "webvtt", "pipe:1"],
        120_000,
      );
      if (vtt.byteLength < MIN_REAL_SUBTITLE_BYTES) continue;
      subtitles.push({
        index: track.index,
        language: track.language,
        title: track.title,
        vtt: vtt.toString("utf-8"),
      });
    } catch {
      // Don't fail the whole conversion over one bad subtitle track — just skip it.
    }
  }
  return subtitles;
}

/** Converts a standalone .srt file's text to WebVTT — for a subtitle uploaded directly on a
 * video's curation page (not extracted from a converted video, see `extractAllSubtitlesToVtt`).
 * ffmpeg needs a real input, not stdin piping (keeps this consistent with the rest of this file's
 * temp-file-based conversion calls), so this writes to a short-lived temp file first. */
export async function convertSrtTextToVtt(srtText: string): Promise<string> {
  const tempPath = join(tmpdir(), `subtitle-upload-${randomUUID()}.srt`);
  await writeFile(tempPath, srtText, "utf-8");
  try {
    const vtt = await runBuffered(env.ffmpegPath, "ffmpeg", ["-i", tempPath, "-f", "webvtt", "pipe:1"], 30_000);
    return vtt.toString("utf-8");
  } finally {
    await unlink(tempPath).catch(() => {});
  }
}

export async function getThumbnail(fileId: string): Promise<Response | null> {
  const meta = await getFileMeta(fileId);
  if (!meta.thumbnailLink) return null;

  const headers = await getAuthClient().getRequestHeaders();
  const res = await fetch(meta.thumbnailLink, { headers });
  if (!res.ok) return null;
  return res;
}
