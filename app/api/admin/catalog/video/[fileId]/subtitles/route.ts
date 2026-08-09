import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { getCatalogVideo, addSubtitleSetId } from "@/lib/catalogVideos";
import { createAndLinkSubtitleSet } from "@/lib/subtitleSets";
import { convertSrtTextToVtt } from "@/lib/drive";

export const runtime = "nodejs";

const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024; // subtitle files are plain text — a few KB to low MB at most

// Uploaded directly on a video's curation page — not tied to a Converter run. Accepts the raw
// subtitle text as the request body (small enough that a plain-text body is simpler than
// multipart), with `label`/`format` as query params.
export async function POST(
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

  const label = req.nextUrl.searchParams.get("label")?.trim();
  const format = req.nextUrl.searchParams.get("format");
  if (!label) {
    return NextResponse.json({ error: "label is required" }, { status: 400 });
  }
  if (format !== "srt" && format !== "vtt") {
    return NextResponse.json({ error: "format must be srt or vtt" }, { status: 400 });
  }

  const text = await req.text();
  if (!text.trim()) {
    return NextResponse.json({ error: "Subtitle file is empty" }, { status: 400 });
  }
  if (Buffer.byteLength(text, "utf-8") > MAX_SUBTITLE_BYTES) {
    return NextResponse.json({ error: "Subtitle file is too large" }, { status: 400 });
  }

  let vtt: string;
  try {
    vtt = format === "srt" ? await convertSrtTextToVtt(text) : text;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to convert subtitle" },
      { status: 500 },
    );
  }

  const subtitleSetId = await createAndLinkSubtitleSet({
    sourceLabel: video.title ?? video.driveName,
    label,
    vtt,
    createdBy: session!.user!.email!,
    videoId: fileId,
  });
  await addSubtitleSetId(fileId, subtitleSetId);

  return NextResponse.json({ subtitleSetId });
}
