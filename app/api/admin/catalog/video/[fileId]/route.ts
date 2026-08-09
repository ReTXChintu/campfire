import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { getCatalogVideo, curateVideo } from "@/lib/catalogVideos";
import { getSubtitleSet, linkSubtitleSet, unlinkSubtitleSet } from "@/lib/subtitleSets";

export const runtime = "nodejs";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { fileId } = await params;
  const video = await getCatalogVideo(fileId);
  if (!video) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const body = await req.json();
  const { title, subtitleSetIds, introStart, introEnd, outroStart } = body as {
    title?: string;
    subtitleSetIds?: string[];
    introStart?: number | null;
    introEnd?: number | null;
    outroStart?: number | null;
  };

  const trimmedTitle = title?.trim();
  if (!trimmedTitle) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  if (introStart != null && introEnd != null && introStart >= introEnd) {
    return NextResponse.json({ error: "introStart must be before introEnd" }, { status: 400 });
  }

  const requestedIds = [...new Set(subtitleSetIds ?? [])];
  for (const id of requestedIds) {
    const set = await getSubtitleSet(id).catch(() => null);
    if (!set) {
      return NextResponse.json({ error: "Subtitle set not found" }, { status: 400 });
    }
    if (set.linkedVideoId && set.linkedVideoId !== fileId) {
      return NextResponse.json(
        { error: "Subtitle set is already linked to a different video" },
        { status: 400 },
      );
    }
  }

  // Free up any previously-linked sets that were deselected, so they return to the picker pool.
  const previousIds = video.subtitleSetIds ?? [];
  await Promise.all(
    previousIds.filter((id) => !requestedIds.includes(id)).map((id) => unlinkSubtitleSet(id)),
  );
  await Promise.all(
    requestedIds.filter((id) => !previousIds.includes(id)).map((id) => linkSubtitleSet(id, fileId)),
  );

  await curateVideo(fileId, {
    title: trimmedTitle,
    subtitleSetIds: requestedIds,
    introStart: introStart ?? null,
    introEnd: introEnd ?? null,
    outroStart: outroStart ?? null,
    curatedBy: session!.user!.email!,
  });

  return NextResponse.json({ ok: true });
}
