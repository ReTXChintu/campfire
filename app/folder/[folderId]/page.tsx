import { notFound } from "next/navigation";
import { auth } from "@/auth";
import { env } from "@/lib/env";
import { getCatalogFolder, listPublishedFoldersByParent } from "@/lib/catalogFolders";
import { listPublishedVideosByParent } from "@/lib/catalogVideos";
import { getProgressForFolder } from "@/lib/progress";
import { naturalSort } from "@/lib/catalogListItem";
import FolderView from "@/components/FolderView";
import SeriesView from "@/components/SeriesView";

export default async function FolderPage({
  params,
  searchParams,
}: {
  params: Promise<{ folderId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { folderId } = await params;
  const folder = await getCatalogFolder(folderId);
  if (!folder || folder.status !== "published") notFound();

  const backHref =
    folder.parentFolderId === env.driveRootFolderId ? "/" : `/folder/${folder.parentFolderId}`;

  // Case 1: no subfolders — just a flat grid of whatever videos/folders sit directly inside.
  const childFolderDocs = await listPublishedFoldersByParent(folderId);
  if (childFolderDocs.length === 0) {
    return (
      <FolderView
        folderId={folderId}
        title={folder.title!}
        backHref={backHref}
        thumbnailFileId={folder.thumbnailFileId}
      />
    );
  }

  // Case 2: subfolders are seasons — thumbnail, season dropdown, that season's videos, and any
  // videos sitting directly in the series folder itself shown separately as "Specials" (they don't
  // change when the season switches).
  const seasons = naturalSort(childFolderDocs.map((f) => ({ id: f._id, name: f.title! })));
  const { season: requestedSeasonId } = await searchParams;
  const selectedSeasonId =
    requestedSeasonId && seasons.some((s) => s.id === requestedSeasonId)
      ? requestedSeasonId
      : seasons[0].id;

  const session = await auth();
  const [seasonVideoDocs, specialVideoDocs, progressList] = await Promise.all([
    listPublishedVideosByParent(selectedSeasonId),
    listPublishedVideosByParent(folderId),
    session?.user?.id ? getProgressForFolder(session.user.id, folderId) : Promise.resolve([]),
  ]);

  const seasonItems = naturalSort(
    seasonVideoDocs.map((v) => ({ kind: "video" as const, id: v._id, name: v.title!, mimeType: v.mimeType })),
  );
  const specialItems = naturalSort(
    specialVideoDocs.map((v) => ({ kind: "video" as const, id: v._id, name: v.title!, mimeType: v.mimeType })),
  );
  const progressByFileId = new Map(progressList.map((p) => [p.fileId, p]));

  return (
    <SeriesView
      folderId={folderId}
      title={folder.title!}
      backHref={backHref}
      thumbnailFileId={folder.thumbnailFileId}
      seasons={seasons}
      selectedSeasonId={selectedSeasonId}
      seasonItems={seasonItems}
      specialItems={specialItems}
      progressByFileId={progressByFileId}
    />
  );
}
