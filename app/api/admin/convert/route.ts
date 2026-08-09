import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { randomUUID } from "node:crypto";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { convertLocalFileToMp4 } from "@/lib/drive";
import { createJob, completeJob, failJob } from "@/lib/uploadJobs";
import { stagedFilePath, deleteStagedFile } from "@/lib/staging";
import { moveToDownload } from "@/lib/downloads";
import { createSubtitleSet } from "@/lib/subtitleSets";

export const runtime = "nodejs";

// Converts a locally-staged file (see /api/admin/stage) to a browser-native MP4 entirely on this
// machine — no Drive involved at all. The admin downloads the result and uploads it to Drive by
// hand; this endpoint never writes to Drive (that path is what hit "Service Accounts do not have
// storage quota" — service accounts have no storage of their own outside a shared drive).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { stagingId, title, audioIndex } = body as {
    stagingId?: string;
    title?: string;
    audioIndex?: number;
  };
  if (!stagingId || !title || audioIndex == null) {
    return NextResponse.json(
      { error: "stagingId, title, and audioIndex are required" },
      { status: 400 },
    );
  }

  const jobId = randomUUID();
  const requestedBy = session!.user!.email!;
  await createJob(jobId, requestedBy);

  after(async () => {
    const localPath = stagedFilePath(stagingId);
    try {
      const result = await convertLocalFileToMp4(localPath, audioIndex);
      const downloadId = randomUUID();
      await moveToDownload(result.tempFilePath, downloadId);

      const subtitleSetId =
        result.subtitles.length > 0
          ? await createSubtitleSet({
              sourceLabel: title,
              subtitles: result.subtitles,
              jobId,
              createdBy: requestedBy,
            })
          : null;

      await completeJob(jobId, downloadId, `${title}.mp4`, subtitleSetId);
    } catch (error) {
      console.error(`[convert] job ${jobId} failed:`, error);
      await failJob(jobId, error instanceof Error ? error.message : "Conversion failed").catch(() => {});
    } finally {
      await deleteStagedFile(stagingId);
    }
  });

  return NextResponse.json({ jobId });
}
