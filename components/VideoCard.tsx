import Link from "next/link";
import type { CatalogVideoListItem } from "@/lib/catalogListItem";
import type { WatchProgress } from "@/lib/progress";
import Thumbnail from "@/components/Thumbnail";

export default function VideoCard({
  item,
  progress,
}: {
  item: CatalogVideoListItem;
  progress?: WatchProgress;
}) {
  const percent =
    progress && progress.durationSeconds > 0
      ? Math.min(100, (progress.positionSeconds / progress.durationSeconds) * 100)
      : 0;

  return (
    <Link
      href={`/watch/${item.id}`}
      className="group relative block overflow-hidden rounded-md border border-divider bg-surface shadow-lg shadow-black/30 transition duration-300 ease-out hover:z-10 hover:-translate-y-1.5 hover:scale-[1.04] hover:border-white/25 hover:shadow-2xl hover:shadow-black/60"
    >
      <div className="overflow-hidden">
        <Thumbnail fileId={item.id} alt={item.name} />
      </div>

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/95 via-black/10 to-transparent" />

      {progress?.completed && (
        <div className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-live">
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="black" strokeWidth={3}>
            <polyline points="4 12 9 17 20 6" />
          </svg>
        </div>
      )}

      <p className="absolute inset-x-0 bottom-3 line-clamp-2 px-3 text-sm font-medium text-white/95">
        {item.name}
      </p>

      {percent > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
          <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
        </div>
      )}
    </Link>
  );
}
