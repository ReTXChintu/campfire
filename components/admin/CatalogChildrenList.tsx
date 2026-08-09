import Link from "next/link";
import type { CatalogFolder } from "@/lib/catalogFolders";
import type { CatalogVideo } from "@/lib/catalogVideos";

function StatusBadge({ status }: { status: "pending" | "curated" | "published" }) {
  if (status === "published") return <span className="shrink-0 text-xs text-live">Published</span>;
  if (status === "curated") return <span className="shrink-0 text-xs text-accent">Curated</span>;
  return <span className="shrink-0 text-xs text-amber">Needs curation</span>;
}

export default function CatalogChildrenList({
  folders,
  videos,
}: {
  folders: CatalogFolder[];
  videos: CatalogVideo[];
}) {
  if (folders.length === 0 && videos.length === 0) {
    return <p className="py-6 text-text-secondary">No items found here yet — try Scan Drive.</p>;
  }

  return (
    <div className="flex flex-col gap-1 border-t border-divider pt-2">
      {folders.map((folder) => (
        <Link
          key={folder._id}
          href={`/admin/catalog/folder/${folder._id}`}
          className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-white/90 transition hover:bg-white/5"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-amber" fill="currentColor">
            <path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z" />
          </svg>
          <span className="flex-1 truncate">{folder.title ?? folder.driveName}</span>
          <StatusBadge status={folder.status} />
        </Link>
      ))}

      {videos.map((video) => (
        <Link
          key={video._id}
          href={`/admin/catalog/video/${video._id}`}
          className="flex items-center gap-3 rounded-md px-3 py-2.5 text-sm text-white/80 transition hover:bg-white/5"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-text-secondary" fill="currentColor">
            <rect x="3" y="5" width="14" height="14" rx="2" fillOpacity="0.3" />
            <polygon points="10,9 16,12 10,15" />
          </svg>
          <span className="flex-1 truncate">{video.title ?? video.driveName}</span>
          <StatusBadge status={video.status} />
        </Link>
      ))}
    </div>
  );
}
