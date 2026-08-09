import { Link } from "react-router-dom";
import type { CatalogListItem } from "../lib/catalogListItem";
import type { WatchProgress } from "../lib/types";
import VideoGrid from "./VideoGrid";
import FolderThumbnail from "./FolderThumbnail";

export default function FolderView({
  folderId,
  title,
  backHref,
  thumbnailFileId,
  items,
  progressByFileId,
}: {
  folderId: string;
  title: string;
  backHref?: string;
  thumbnailFileId: string | null;
  items: CatalogListItem[];
  progressByFileId: Map<string, WatchProgress>;
}) {
  return (
    <div className="w-full px-4 py-8 sm:px-6">
      {backHref && (
        <Link
          to={backHref}
          className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary transition hover:text-white"
        >
          ← Back
        </Link>
      )}

      {thumbnailFileId && (
        <div className="mb-6 overflow-hidden rounded-lg">
          <FolderThumbnail folderId={folderId} alt={title} className="max-h-[420px] w-full object-cover" />
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
