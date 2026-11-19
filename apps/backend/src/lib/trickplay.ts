import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env";
import { driveInputArgs } from "./drive";

/**
 * Seek-bar previews ("trickplay"): one small frame every INTERVAL seconds, tiled into sprite
 * sheets, so scrubbing shows where you'd land instead of a bare timestamp.
 *
 * Made once per video, the first time anyone plays it, by one sequential read of the file from
 * Drive with only keyframes decoded (`-skip_frame nokey`) — cheap on CPU, even for 4K HEVC, but a
 * full download of the file, which is why it's lazy and one at a time. The frames land in a
 * temporary folder first, then a second, local ffmpeg pass tiles them; the finished folder is
 * renamed into place, so a half-made set is never served.
 *
 *   <TRICKPLAY_DIR>/<fileId>/manifest.json, sheet-0.jpg, sheet-1.jpg, …
 *   <TRICKPLAY_DIR>/<fileId>.failed.json   — a failure, retried after FAILED_RETRY_MS
 */
export const TRICKPLAY_INTERVAL = 10;
export const TILE_WIDTH = 192;
export const TILE_HEIGHT = 108;
export const COLUMNS = 10;
export const ROWS = 10;
const RUN_TIMEOUT_MS = 90 * 60_000;
const FAILED_RETRY_MS = 7 * 24 * 60 * 60_000;

export type TrickplayManifest = {
  version: 1;
  /** Seconds between frames: frame i shows the video at i × interval. */
  interval: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
  rows: number;
  /** Frames in all; the last sheet may be partly empty. */
  count: number;
  sheets: number;
};

export type TrickplayStatus =
  | { status: "ready"; manifest: TrickplayManifest }
  | { status: "queued" | "processing" | "failed" | "off" };

const dirFor = (fileId: string) => join(env.trickplayDir, fileId);
const failedFor = (fileId: string) => join(env.trickplayDir, `${fileId}.failed.json`);
export const sheetPath = (fileId: string, index: number) => join(dirFor(fileId), `sheet-${index}.jpg`);

/** Drive ids are URL-safe base64-ish; anything else never touches the disk. */
export const isSafeFileId = (fileId: string) => /^[A-Za-z0-9_-]{1,128}$/.test(fileId);

export async function readManifest(fileId: string): Promise<TrickplayManifest | null> {
  try {
    return JSON.parse(await readFile(join(dirFor(fileId), "manifest.json"), "utf-8")) as TrickplayManifest;
  } catch {
    return null;
  }
}

async function recentlyFailed(fileId: string): Promise<boolean> {
  try {
    const { at } = JSON.parse(await readFile(failedFor(fileId), "utf-8")) as { at: number };
    return Date.now() - at < FAILED_RETRY_MS;
  } catch {
    return false;
  }
}

function run(args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(env.ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    const tail: string[] = [];
    const timer = setTimeout(() => child.kill("SIGKILL"), RUN_TIMEOUT_MS);
    child.stderr.on("data", (chunk: Buffer) => {
      tail.push(chunk.toString("utf-8"));
      if (tail.length > 20) tail.shift();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ${label} failed (exit ${code}): ${tail.join("").trim().split("\n").slice(-4).join(" | ")}`));
    });
  });
}

/**
 * Makes a video's sheets from `inputArgs` (ffmpeg's `… -i <source>`) into `destDir`. Exported
 * apart from the queue so scripts/smoke-trickplay.mjs can run it on a local file.
 */
export async function buildTrickplay(inputArgs: string[], destDir: string): Promise<TrickplayManifest> {
  const work = `${destDir}.tmp-${randomUUID()}`;
  const frames = join(work, "frames");
  const out = join(work, "out");
  await mkdir(frames, { recursive: true });
  await mkdir(out, { recursive: true });
  try {
    const box = `${TILE_WIDTH}:${TILE_HEIGHT}`;
    await run(
      [
        "-nostdin", "-v", "error",
        // Keyframes only: everything between them is skipped, not decoded.
        "-skip_frame", "nokey",
        ...inputArgs,
        // `V` (capital) skips cover art attached to an MKV, which is also a "video" stream.
        "-map", "0:V:0", "-an", "-sn", "-dn",
        "-vf", `fps=1/${TRICKPLAY_INTERVAL}:round=up,scale=${box}:force_original_aspect_ratio=decrease,pad=${box}:-1:-1:color=black`,
        "-q:v", "5",
        join(frames, "f-%05d.jpg"),
      ],
      "frames",
    );
    const count = (await readdir(frames)).filter((f) => f.endsWith(".jpg")).length;
    if (count === 0) throw new Error("No frames could be read");

    await run(
      [
        "-nostdin", "-v", "error",
        "-framerate", "1",
        "-i", join(frames, "f-%05d.jpg"),
        "-vf", `tile=${COLUMNS}x${ROWS}`,
        "-q:v", "5",
        "-start_number", "0",
        join(out, "sheet-%d.jpg"),
      ],
      "tile",
    );
    const sheets = (await readdir(out)).filter((f) => /^sheet-\d+\.jpg$/.test(f)).length;
    const manifest: TrickplayManifest = {
      version: 1,
      interval: TRICKPLAY_INTERVAL,
      tileWidth: TILE_WIDTH,
      tileHeight: TILE_HEIGHT,
      columns: COLUMNS,
      rows: ROWS,
      count,
      sheets,
    };
    await writeFile(join(out, "manifest.json"), JSON.stringify(manifest));
    await rm(destDir, { recursive: true, force: true });
    await rename(out, destDir);
    return manifest;
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

// ---- The queue: one video at a time, in the order they were first played -------------------------
const queue: string[] = [];
let current: string | null = null;

async function drain(): Promise<void> {
  if (current) return;
  while (queue.length > 0) {
    const fileId = queue.shift()!;
    current = fileId;
    try {
      await mkdir(env.trickplayDir, { recursive: true });
      await buildTrickplay(await driveInputArgs(fileId), dirFor(fileId));
      await rm(failedFor(fileId), { force: true });
      console.log(`[trickplay] ${fileId} ready`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[trickplay] ${fileId} failed: ${message}`);
      await writeFile(failedFor(fileId), JSON.stringify({ at: Date.now(), error: message })).catch(() => {});
    } finally {
      current = null;
    }
  }
}

/** Where a video's previews stand, queueing them on first ask. */
export async function trickplayFor(fileId: string): Promise<TrickplayStatus> {
  const manifest = await readManifest(fileId);
  if (manifest) return { status: "ready", manifest };
  if (current === fileId) return { status: "processing" };
  if (queue.includes(fileId)) return { status: "queued" };
  if (!env.trickplayEnabled) return { status: "off" };
  if (await recentlyFailed(fileId)) return { status: "failed" };
  queue.push(fileId);
  drain().catch((error) => console.error("[trickplay] queue failed:", error));
  return { status: current === fileId ? "processing" : "queued" };
}
