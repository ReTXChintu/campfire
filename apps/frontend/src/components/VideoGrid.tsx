import type { CatalogListItem } from "../lib/catalogListItem";
import type { WatchProgress } from "../lib/types";
import VideoCard from "./VideoCard";
import FolderCard from "./FolderCard";

export default function VideoGrid({
  items,
  progressByFileId,
}: {
  items: CatalogListItem[];
  progressByFileId?: Map<string, WatchProgress>;
}) {
  if (items.length === 0) {
    return <p className="text-white/50">This folder is empty.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {items.map((item) =>
        item.kind === "folder" ? (
          <FolderCard key={item.id} item={item} />
        ) : (
          <VideoCard key={item.id} item={item} progress={progressByFileId?.get(item.id)} />
        ),
      )}
    </div>
  );
}
