import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { probeStreams } from "@/lib/drive";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;

  try {
    const probe = await probeStreams(fileId);
    return NextResponse.json(probe, {
      headers: { "cache-control": "private, max-age=3600" },
    });
  } catch {
    // Degrade gracefully: no track menus rather than a broken player if ffprobe fails.
    return NextResponse.json({ audioTracks: [], subtitleTracks: [], durationSeconds: null });
  }
}
