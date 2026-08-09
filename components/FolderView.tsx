import Link from "next/link";
import { auth } from "@/auth";
import { listPublishedFoldersByParent } from "@/lib/catalogFolders";
import { listPublishedVideosByParent } from "@/lib/catalogVideos";
import { getProgressForFolder } from "@/lib/progress";
import { naturalSort } from "@/lib/catalogListItem";
import VideoGrid from "@/components/VideoGrid";
import FolderThumbnail from "@/components/FolderThumbnail";

export default async function FolderView({
  folderId,
  title,
  backHref,
  thumbnailFileId,
}: {
  folderId: string;
  title: string;
  backHref?: string;
  thumbnailFileId: string | null;
}) {
  const session = await auth();
  const [folderDocs, videoDocs, progressList] = await Promise.all([
    listPublishedFoldersByParent(folderId),
    listPublishedVideosByParent(folderId),
    session?.user?.id ? getProgressForFolder(session.user.id, folderId) : Promise.resolve([]),
  ]);

  const items = naturalSort([
    ...folderDocs.map((f) => ({
      kind: "folder" as const,
      id: f._id,
      name: f.title!,
      thumbnailFileId: f.thumbnailFileId,
    })),
    ...videoDocs.map((v) => ({ kind: "video" as const, id: v._id, name: v.title!, mimeType: v.mimeType })),
  ]);

  const progressByFileId = new Map(progressList.map((p) => [p.fileId, p]));

  return (
    <div className="w-full px-4 py-8 sm:px-6">
      {backHref && (
        <Link
          href={backHref}
          className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition hover:text-white"
        >
          ← Back
        </Link>
      )}

      {thumbnailFileId && (
        <div className="mb-6 overflow-hidden rounded-lg">
          <FolderThumbnail
            folderId={folderId}
            alt={title}
            className="max-h-[420px] w-full object-cover"
          />
        </div>
      )}

      <div className="mb-8">
        <h1 className="font-display text-4xl tracking-wide text-white sm:text-5xl">{title}</h1>
        <p className="mt-1 font-mono text-xs uppercase tracking-wide text-text-tertiary">
          {items.length} {items.length === 1 ? "item" : "items"}
        </p>
      </div>
      <VideoGrid items={items} progressByFileId={progressByFileId} />
    </div>
  );
}
