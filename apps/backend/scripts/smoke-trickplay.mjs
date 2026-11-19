// Seek-bar previews (src/lib/trickplay.ts) end to end on local files — no Drive, no Mongo, just
// ffmpeg. Makes a few short synthetic videos (a 16:9 one, an upright one, an MKV with cover art
// attached, one with sparse keyframes) and checks the sheets and manifest that come out.
//
//   node --import tsx scripts/smoke-trickplay.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTrickplay, COLUMNS, ROWS, TILE_HEIGHT, TILE_WIDTH, TRICKPLAY_INTERVAL } from "../src/lib/trickplay.ts";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || "ffprobe";
let passed = 0;
let failed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || detail == null ? "" : `  — ${detail}`}`);
}

function sh(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf-8" });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")}\n${r.stderr}`);
  return r.stdout;
}

function sizeOf(path) {
  const out = sh(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path]);
  const { width, height } = JSON.parse(out).streams[0];
  return { width, height };
}

const work = mkdtempSync(join(tmpdir(), "trickplay-smoke-"));
try {
  // 16:9, 125 s, a keyframe every 2 s: frames at 0, 10, … 120 → 13.
  const wide = join(work, "wide.mp4");
  sh(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24:duration=125", "-c:v", "libx264", "-preset", "ultrafast", "-g", "48", "-pix_fmt", "yuv420p", "-y", wide]);

  console.log("\n16:9 film");
  const dest = join(work, "out-wide");
  const m = await buildTrickplay(["-i", wide], dest);
  check("a frame every interval", m.interval === TRICKPLAY_INTERVAL && Math.abs(m.count - 13) <= 1, JSON.stringify(m));
  check("one sheet for under a hundred frames", m.sheets === 1 && existsSync(join(dest, "sheet-0.jpg")));
  check("the manifest is written beside the sheets", JSON.parse(readFileSync(join(dest, "manifest.json"), "utf-8")).count === m.count);
  const sheet = sizeOf(join(dest, "sheet-0.jpg"));
  check("a sheet is the full grid of tiles", sheet.width === TILE_WIDTH * COLUMNS && sheet.height === TILE_HEIGHT * ROWS, JSON.stringify(sheet));
  check("the working folder is cleaned up", !readdirSync(work).some((f) => f.includes(".tmp-")), readdirSync(work).join(", "));

  console.log("\nRe-running replaces the old set");
  writeFileSync(join(dest, "stale.txt"), "x");
  await buildTrickplay(["-i", wide], dest);
  check("nothing left from before", !existsSync(join(dest, "stale.txt")));

  console.log("\nA long video spans several sheets");
  const long = join(work, "long.mp4");
  // 1 fps source keeps it quick; 1,250 s → 126 frames → two sheets.
  sh(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=1:duration=1250", "-c:v", "libx264", "-preset", "ultrafast", "-g", "5", "-pix_fmt", "yuv420p", "-y", long]);
  const ml = await buildTrickplay(["-i", long], join(work, "out-long"));
  check("over a hundred frames make a second sheet", ml.sheets === 2 && ml.count > 100, JSON.stringify(ml));
  check("the last, part-filled sheet still has the full grid size", (() => {
    const s = sizeOf(join(work, "out-long", "sheet-1.jpg"));
    return s.width === TILE_WIDTH * COLUMNS && s.height === TILE_HEIGHT * ROWS;
  })());

  console.log("\nUpright video and an MKV with cover art");
  const tall = join(work, "tall.mkv");
  const cover = join(work, "cover.png");
  sh(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "color=c=red:size=300x450", "-frames:v", "1", "-y", cover]);
  sh(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=24:duration=35", "-c:v", "libx264", "-preset", "ultrafast", "-g", "24", "-pix_fmt", "yuv420p", "-attach", cover, "-metadata:s:t", "mimetype=image/png", "-y", tall]);
  const mt = await buildTrickplay(["-i", tall], join(work, "out-tall"));
  check("an upright video is letterboxed into the same tile", mt.count >= 3 && mt.tileWidth === TILE_WIDTH, JSON.stringify(mt));

  console.log("\nSparse keyframes (one every 30 s)");
  const sparse = join(work, "sparse.mp4");
  sh(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=10:duration=95", "-c:v", "libx264", "-preset", "ultrafast", "-g", "300", "-keyint_min", "300", "-sc_threshold", "0", "-pix_fmt", "yuv420p", "-y", sparse]);
  const ms = await buildTrickplay(["-i", sparse], join(work, "out-sparse"));
  check("still one frame per interval, so times line up", Math.abs(ms.count - 10) <= 1, JSON.stringify(ms));

  console.log("\nA file that isn't a video");
  const junk = join(work, "junk.mp4");
  writeFileSync(junk, "not a video");
  let threw = false;
  try {
    await buildTrickplay(["-i", junk], join(work, "out-junk"));
  } catch {
    threw = true;
  }
  check("fails, and leaves nothing behind to be served", threw && !existsSync(join(work, "out-junk", "manifest.json")));
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
