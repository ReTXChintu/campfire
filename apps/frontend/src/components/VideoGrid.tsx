import type { CatalogListItem } from "../lib/catalogListItem";
import type { WatchProgress } from "../lib/types";
import VideoCard from "./VideoCard";
import FolderCard from "./FolderCard";
import { EmptyState } from "./ui/States";

/** The catalog grid. Full width, 2 columns on a phone up to 7 on a wide desktop — the extra width
 * goes into more columns rather than a gutter. */
export default function VideoGrid({
  items,
  progressByFileId,
  emptyTitle = "Nothing here",
  emptyMessage,
  emptyAction,
}: {
  items: CatalogListItem[];
  progressByFileId?: Map<string, WatchProgress>;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
}) {
  if (items.length === 0) {
    return <EmptyState title={emptyTitle} message={emptyMessage} action={emptyAction} />;
  }

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
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
