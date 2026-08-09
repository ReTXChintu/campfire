import { Link } from "react-router-dom";
import type { CatalogFolderListItem } from "../lib/catalogListItem";
import FolderThumbnail from "./FolderThumbnail";

export default function FolderCard({ item }: { item: CatalogFolderListItem }) {
  return (
    <Link
      to={`/folder/${item.id}`}
      className="group relative block overflow-hidden rounded-md shadow-lg shadow-black/30 transition duration-300 ease-out hover:z-10 hover:-translate-y-1.5 hover:scale-[1.04] hover:shadow-2xl hover:shadow-black/60"
    >
      {item.thumbnailFileId ? (
        <div className="overflow-hidden">
          <FolderThumbnail
            folderId={item.id}
            alt={item.name}
            className="aspect-video w-full scale-100 object-cover transition duration-300 ease-out group-hover:scale-110"
          />
        </div>
      ) : (
        <div className="relative aspect-video">
          {/* Stacked-card motif hints at "a collection of episodes" rather than a plain folder */}
          <div className="absolute inset-0 translate-x-1.5 translate-y-1.5 rounded-md bg-surface/70 ring-1 ring-white/5" />
          <div className="absolute inset-0 translate-x-0.5 translate-y-0.5 rounded-md bg-surface ring-1 ring-white/5" />
          <div className="absolute inset-0 flex items-center justify-center rounded-md bg-gradient-to-br from-surface-hover to-surface ring-1 ring-white/10">
            <svg
              viewBox="0 0 24 24"
              className="h-8 w-8 text-white/70 transition group-hover:text-white/90"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <rect x="3" y="6" width="7" height="5" rx="1" />
              <rect x="14" y="6" width="7" height="5" rx="1" />
              <rect x="3" y="13" width="7" height="5" rx="1" />
              <rect x="14" y="13" width="7" height="5" rx="1" />
            </svg>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/10 to-transparent" />
      <p className="absolute inset-x-0 bottom-3 line-clamp-2 px-3 text-sm font-medium text-white/95">
        {item.name}
      </p>
    </Link>
  );
}
