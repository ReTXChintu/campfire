import { Link } from "react-router-dom";
import { useAdminOverview } from "../../hooks/useAdminCatalog";
import AdminNav from "../../components/admin/AdminNav";
import ScanButton from "../../components/admin/ScanButton";
import CatalogChildrenList from "../../components/admin/CatalogChildrenList";

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
            to={`/admin/catalog/folder/${folder._id}`}
            className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-white/90 transition hover:bg-white/5"
          >
            <span className="shrink-0 text-xs text-amber">{badge} · Folder</span>
            <span className="flex-1 truncate">{folder.driveName}</span>
          </Link>
        ))}
        {videos.map((video) => (
          <Link
            key={video._id}
            to={`/admin/catalog/video/${video._id}`}
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

export default function AdminCatalogPage() {
  const { data, isLoading, error } = useAdminOverview();

  return (
    <div className="w-full flex-1 px-4 py-8 sm:px-6">
      <AdminNav active="catalog" />
      <h1 className="mb-2 font-display text-4xl tracking-wide text-white">Catalog</h1>
      <p className="mb-6 text-sm text-text-secondary">
        Scan Drive to find new folders and videos, curate them, then publish so they show up in the
        app. Curating alone doesn&apos;t make something visible to viewers — Publish does.
      </p>

      <ScanButton />

      {isLoading && <div className="h-40 animate-pulse rounded-lg bg-surface" />}
      {error && <p className="text-red-400">Failed to load: {error.message}</p>}

      {data && (
        <>
          <Worklist
            title="Needs curation"
            badge="Pending"
            folders={data.pendingFolders}
            videos={data.pendingVideos}
          />
          <Worklist
            title="Ready to publish"
            badge="Curated"
            folders={data.unpublishedFolders}
            videos={data.unpublishedVideos}
          />

          <h2 className="mb-1 text-lg font-bold text-white">Library</h2>
          <CatalogChildrenList folders={data.rootFolders} videos={data.rootVideos} />
        </>
      )}
    </div>
  );
}
