import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { createWriteStream } from "node:fs";
import { writeFile, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { probeLocalFile } from "@/lib/drive";
import { stagedFilePath, stagedMetaPath, sweepStaleStagedFiles } from "@/lib/staging";
import { sweepStaleDownloads } from "@/lib/downloads";

export const runtime = "nodejs";

// Stages an uploaded file to local disk (not Drive yet) so we can probe it with ffprobe directly
// — much faster/more reliable than the Drive-URL+bearer-token path, and lets the admin see real
// audio/subtitle track info before committing to a destination or an audio-track choice.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!req.body) {
    return NextResponse.json({ error: "Missing request body" }, { status: 400 });
  }

  // Opportunistic cleanup of anything abandoned from a past session — best-effort, never blocks
  // this upload if it fails for some reason.
  await Promise.all([sweepStaleStagedFiles().catch(() => {}), sweepStaleDownloads().catch(() => {})]);

  const stagingId = randomUUID();
  const filePath = stagedFilePath(stagingId);
  const mimeType = req.headers.get("content-type") || "application/octet-stream";

  try {
    const nodeBody = Readable.fromWeb(req.body as NodeWebReadableStream<Uint8Array>);
    await pipeline(nodeBody, createWriteStream(filePath));

    const { size } = await stat(filePath);
    await writeFile(stagedMetaPath(stagingId), JSON.stringify({ mimeType, sizeBytes: size }));

    const probe = await probeLocalFile(filePath);

    return NextResponse.json({ stagingId, sizeBytes: size, probe });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Staging failed" },
      { status: 500 },
    );
  }
}
