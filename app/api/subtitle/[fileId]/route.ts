import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { extractSubtitle } from "@/lib/drive";
import { toWebStream } from "@/lib/webStream";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;
  const trackIndex = Number(req.nextUrl.searchParams.get("track"));
  if (!Number.isFinite(trackIndex)) {
    return NextResponse.json({ error: "track is required" }, { status: 400 });
  }

  const tParam = req.nextUrl.searchParams.get("t");
  const parsed = tParam ? Number(tParam) : 0;
  const startSeconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

  const vttStream = await extractSubtitle(fileId, trackIndex, startSeconds, req.signal);

  return new NextResponse(toWebStream(vttStream), {
    status: 200,
    headers: {
      "content-type": "text/vtt; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
