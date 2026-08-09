import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { getJob } from "@/lib/uploadJobs";
import { getSubtitleSet } from "@/lib/subtitleSets";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { jobId } = await params;
  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  // Lightweight track list only (no `vtt` payload) — this route is polled every 2s, keep it small.
  const subtitleSet = job.subtitleSetId ? await getSubtitleSet(job.subtitleSetId) : null;

  return NextResponse.json({
    status: job.status,
    downloadId: job.downloadId ?? null,
    filename: job.filename ?? null,
    subtitleSetId: job.subtitleSetId ?? null,
    subtitleTracks:
      subtitleSet?.subtitles.map((s) => ({ index: s.index, language: s.language, title: s.title })) ??
      [],
    error: job.error ?? null,
  });
}
