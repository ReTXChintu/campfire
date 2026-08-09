import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { getSubtitleSet } from "@/lib/subtitleSets";
import { languageName } from "@/lib/languageNames";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ subtitleSetId: string; trackIndex: string }> },
) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { subtitleSetId, trackIndex } = await params;
  const index = Number(trackIndex);

  const set = await getSubtitleSet(subtitleSetId).catch(() => null);
  const track = set?.subtitles.find((s) => s.index === index);
  if (!track) {
    return NextResponse.json({ error: "Subtitle track not found" }, { status: 404 });
  }

  const label = (track.language ? languageName(track.language) : null) ?? track.title ?? `track-${track.index}`;
  const filename = `${set!.sourceLabel} - ${label}.vtt`.replace(/[\\/]/g, "-");

  return new NextResponse(track.vtt, {
    headers: {
      "Content-Type": "text/vtt",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
