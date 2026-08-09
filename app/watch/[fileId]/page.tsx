import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { isNativelyPlayable, type ConvertedSubtitle } from "@/lib/drive";
import { isAdminEmail } from "@/lib/admin";
import { getProgress, getProgressForFolder } from "@/lib/progress";
import { getCatalogVideo, listPublishedVideosByParent } from "@/lib/catalogVideos";
import { listSubtitleSetsByIds } from "@/lib/subtitleSets";
import { naturalSort } from "@/lib/catalogListItem";
import { env } from "@/lib/env";
import VideoPlayer from "@/components/VideoPlayer";

export default async function WatchPage({
  params,
}: {
  params: Promise<{ fileId: string }>;
}) {
  const { fileId } = await params;
  const session = await auth();

  const video = await getCatalogVideo(fileId);
  // "pending" (no title yet) is never watchable — preview happens on the curation page instead.
  // "curated" (title set, not yet published) is admin-only, so you can check timing/subtitles
  // before making it visible. "published" is open to any signed-in viewer.
  const isAdmin = isAdminEmail(session?.user?.email);
  if (!video) notFound();
  if (video.status === "pending") notFound();
  if (video.status === "curated" && !isAdmin) notFound();

  const parentFolderId = video.parentFolderId;
  const isStandalone = parentFolderId === env.driveRootFolderId;

  let nextFileId: string | null = null;
  let previousFileId: string | null = null;
  let episodes: { id: string; name: string }[] = [];
  let progressByFileId: Record<string, { positionSeconds: number; completed: boolean }> = {};

  if (!isStandalone) {
    const [episodeDocs, progressList] = await Promise.all([
      listPublishedVideosByParent(parentFolderId),
      session?.user?.id ? getProgressForFolder(session.user.id, parentFolderId) : Promise.resolve([]),
    ]);
    const episodeList = naturalSort(episodeDocs.map((e) => ({ id: e._id, name: e.title! })));
    const index = episodeList.findIndex((e) => e.id === fileId);
    nextFileId = index >= 0 ? (episodeList[index + 1]?.id ?? null) : null;
    previousFileId = index >= 0 ? (episodeList[index - 1]?.id ?? null) : null;
    episodes = episodeList;
    progressByFileId = Object.fromEntries(
      progressList.map((p) => [p.fileId, { positionSeconds: p.positionSeconds, completed: p.completed }]),
    );
  }

  const progress = session?.user?.id ? await getProgress(session.user.id, fileId) : null;
  const backHref = isStandalone ? "/" : `/folder/${parentFolderId}`;

  const seekMode = isNativelyPlayable(video.mimeType) ? "native" : "restart";
  const subtitleSets = await listSubtitleSetsByIds(video.subtitleSetIds ?? []);
  // Re-index sequentially — track `index` is only meaningful within the source it came from, and
  // multiple merged sets could otherwise collide (used as the player's <track> key).
  const subtitles: ConvertedSubtitle[] = subtitleSets
    .flatMap((s) => s.subtitles)
    .map((s, i) => ({ ...s, index: i }));

  return (
    <div className="w-full flex-1 px-4 py-6 sm:px-6">
      <VideoPlayer
        fileId={fileId}
        title={video.title!}
        backHref={backHref}
        parentFolderId={parentFolderId}
        nextFileId={nextFileId}
        previousFileId={previousFileId}
        episodes={episodes}
        progressByFileId={progressByFileId}
        initialPositionSeconds={progress?.positionSeconds ?? 0}
        initialCompleted={progress?.completed ?? false}
        seekMode={seekMode}
        durationSeconds={video.durationSeconds}
        initialProbe={null}
        subtitles={subtitles}
        introStart={video.introStart}
        introEnd={video.introEnd}
        outroStart={video.outroStart}
      />
    </div>
  );
}
