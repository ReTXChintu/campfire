import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { env } from "@/lib/env";
import { listPendingFolders, listUnpublishedCuratedFolders, listChildFolders } from "@/lib/catalogFolders";
import { listPendingVideos, listUnpublishedCuratedVideos, listVideosByParent } from "@/lib/catalogVideos";
import AdminNav from "@/components/admin/AdminNav";
import ScanButton from "@/components/admin/ScanButton";
import CatalogChildrenList from "@/components/admin/CatalogChildrenList";

function Worklist({
  title,
  badge,
  folders,
  videos,
}: {
  title: string;
  badge: string;
  folders: { _id: string; driveName: string }[];
  videos: { _id: string; driveName: string }[];
}) {
  if (folders.length === 0 && videos.length === 0) return null;
  return (
    <div className="mb-10">
      <h2 className="mb-3 text-lg font-bold text-white">
        {title} ({folders.length + videos.length})
      </h2>
      <div className="flex flex-col gap-1 border-t border-divider pt-2">
        {folders.map((folder) => (
          <Link
            key={folder._id}
            href={`/admin/catalog/folder/${folder._id}`}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-white/90 transition hover:bg-white/5"
          >
            <span className="shrink-0 text-xs text-amber">{badge} · Folder</span>
            <span className="flex-1 truncate">{folder.driveName}</span>
          </Link>
        ))}
        {videos.map((video) => (
          <Link
            key={video._id}
            href={`/admin/catalog/video/${video._id}`}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-white/90 transition hover:bg-white/5"
          >
            <span className="shrink-0 text-xs text-amber">{badge} · Video</span>
            <span className="flex-1 truncate">{video.driveName}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default async function AdminCatalogPage() {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    redirect("/");
  }

  const [pendingFolders, pendingVideos, unpublishedFolders, unpublishedVideos, rootFolders, rootVideos] =
    await Promise.all([
      listPendingFolders(),
      listPendingVideos(),
      listUnpublishedCuratedFolders(),
      listUnpublishedCuratedVideos(),
      listChildFolders(env.driveRootFolderId),
      listVideosByParent(env.driveRootFolderId),
    ]);

  return (
    <div className="w-full flex-1 px-4 py-8 sm:px-6">
      <AdminNav active="catalog" />
      <h1 className="mb-2 font-display text-4xl tracking-wide text-white">Catalog</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Scan Drive to find new folders and videos, curate them, then publish so they show up in the
        app. Curating alone doesn&apos;t make something visible to viewers — Publish does.
      </p>

      <ScanButton />

      <Worklist title="Needs curation" badge="Pending" folders={pendingFolders} videos={pendingVideos} />
      <Worklist
        title="Ready to publish"
        badge="Curated"
        folders={unpublishedFolders}
        videos={unpublishedVideos}
      />

      <h2 className="mb-1 text-lg font-bold text-white">Library</h2>
      <CatalogChildrenList folders={rootFolders} videos={rootVideos} />
    </div>
  );
}
