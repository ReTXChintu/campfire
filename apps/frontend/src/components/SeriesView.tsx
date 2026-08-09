import { Link } from "react-router-dom";
import SeasonDropdown from "./SeasonDropdown";
import VideoGrid from "./VideoGrid";
import FolderThumbnail from "./FolderThumbnail";
import type { WatchProgress } from "../lib/types";
import type { CatalogListItem } from "../lib/catalogListItem";

export default function SeriesView({
  folderId,
  title,
  backHref,
  thumbnailFileId,
  seasons,
  selectedSeasonId,
  seasonItems,
  specialItems,
  progressByFileId,
}: {
  folderId: string;
  title: string;
  backHref?: string;
  thumbnailFileId: string | null;
  seasons: { id: string; name: string }[];
  selectedSeasonId: string;
  seasonItems: CatalogListItem[];
  specialItems: CatalogListItem[];
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

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-4xl tracking-wide text-white sm:text-5xl">{title}</h1>
        {seasons.length > 1 && (
          <SeasonDropdown folderId={folderId} seasons={seasons} selectedId={selectedSeasonId} />
        )}
      </div>

      <VideoGrid items={seasonItems} progressByFileId={progressByFileId} />

      {specialItems.length > 0 && (
        <div className="mt-10">
          <h2 className="mb-4 text-lg font-bold text-white">Specials</h2>
          <VideoGrid items={specialItems} progressByFileId={progressByFileId} />
        </div>
      )}
    </div>
  );
}
