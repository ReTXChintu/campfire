import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  streamFile,
  getMimeType,
  isNativelyPlayable,
  remuxToMp4,
  readDriveHeader,
} from "@/lib/drive";
import { toWebStream } from "@/lib/webStream";

export const runtime = "nodejs"; // ffmpeg requires a real Node process, not Edge

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;
  const range = req.headers.get("range");
  const mimeType = await getMimeType(fileId);

  if (isNativelyPlayable(mimeType)) {
    const driveRes = await streamFile(fileId, range);

    const headers = new Headers();
    const passthroughHeaders = [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
    ];
    for (const key of passthroughHeaders) {
      const value = readDriveHeader(driveRes.headers, key);
      if (value) headers.set(key, value);
    }
    if (!headers.has("accept-ranges")) headers.set("accept-ranges", "bytes");

    return new NextResponse(toWebStream(driveRes.data), {
      status: driveRes.status,
      headers,
    });
  }

  // Non-natively-playable container (e.g. MKV): remux to fragmented MP4 on the fly, seeking
  // near `t` seconds via ffmpeg input-level -ss. Each request is a fresh non-seekable resource
  // (no Range/duration) — the player restarts the stream at a new `t` whenever the user scrubs.
  const tParam = req.nextUrl.searchParams.get("t");
  const parsed = tParam ? Number(tParam) : 0;
  const startSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

  const audioParam = req.nextUrl.searchParams.get("audio");
  const audioIndex =
    audioParam != null && Number.isFinite(Number(audioParam)) ? Number(audioParam) : null;

  const adelayParam = req.nextUrl.searchParams.get("adelay");
  const audioDelayMs =
    adelayParam != null && Number.isFinite(Number(adelayParam)) ? Math.trunc(Number(adelayParam)) : 0;

  const mp4Stream = await remuxToMp4(fileId, startSeconds, req.signal, { audioIndex, audioDelayMs });

  return new NextResponse(toWebStream(mp4Stream), {
    status: 200,
    headers: {
      "content-type": "video/mp4",
      "cache-control": "no-store",
    },
  });
}
