import { Link } from "react-router-dom";
import { useAdminOverview } from "../../hooks/useAdminCatalog";
import AdminShell from "../../components/admin/AdminShell";
import ScanButton from "../../components/admin/ScanButton";
import MatchArtworkButton from "../../components/admin/MatchArtworkButton";
import CatalogChildrenList from "../../components/admin/CatalogChildrenList";
import { ErrorCard, Skeleton } from "../../components/ui/States";

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
    <section className="mb-8 rounded-2xl border border-divider bg-surface p-5">
      <h2 className="mb-3 font-display text-xl tracking-wide text-white">
        {title} ({folders.length + videos.length})
      </h2>
      <div className="grid gap-1 lg:grid-cols-2">
        {folders.map((folder) => (
          <Link
            key={folder._id}
            to={`/admin/catalog/folder/${folder._id}`}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/90 transition hover:bg-surface-hover"
          >
            <span className="shrink-0 text-xs text-amber">{badge} · Folder</span>
            <span className="min-w-0 flex-1 truncate">{folder.driveName}</span>
          </Link>
        ))}
        {videos.map((video) => (
          <Link
            key={video._id}
            to={`/admin/catalog/video/${video._id}`}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-white/90 transition hover:bg-surface-hover"
          >
            <span className="shrink-0 text-xs text-amber">{badge} · Video</span>
            <span className="min-w-0 flex-1 truncate">{video.driveName}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function AdminCatalogPage() {
  const { data, isLoading, error, refetch, isFetching } = useAdminOverview();

  return (
    <AdminShell
      section="catalog"
      title="Catalog"
      description="Scan Drive to find new folders and videos, curate them, then publish so they show up in the app. Curating alone does not make something visible to viewers — Publish does."
      actions={
        <div className="flex flex-wrap items-start gap-3">
          <ScanButton />
          <MatchArtworkButton />
        </div>
      }
    >
      {error && (
        <ErrorCard
          title="The catalog did not load"
          message={error.message}
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      )}
      {isLoading && (
        <div className="grid gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      )}

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

          <h2 className="mb-1 font-display text-xl tracking-wide text-white">Library</h2>
          <CatalogChildrenList folders={data.rootFolders} videos={data.rootVideos} />
        </>
      )}
    </AdminShell>
  );
}
