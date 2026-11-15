import { useState } from "react";
import { Link } from "react-router-dom";
import { useLibrary } from "../hooks/useCatalog";
import SpotlightCarousel from "../components/SpotlightCarousel";
import Rail, { RailItem } from "../components/Rail";
import VideoCard from "../components/VideoCard";
import FolderCard from "../components/FolderCard";
import RequestModal from "../components/requests/RequestModal";
import { CardSkeletonRail, EmptyState, ErrorCard, Skeleton } from "../components/ui/States";
import { PAGE_X } from "../lib/layout";
import type { CatalogFolderListItem, CatalogVideoListItem } from "../lib/catalogListItem";
import { libraryProgressMap } from "../lib/progress";

/** How many items a rail shows before "See all" takes over — a rail is a sampler, the grid is the
 * whole shelf. */
const RAIL_LIMIT = 18;

export default function LibraryPage() {
  const { data, isLoading, error, refetch, isFetching } = useLibrary();
  const [requestOpen, setRequestOpen] = useState(false);

  if (isLoading) {
    return (
      <main className="w-full flex-1 pb-16">
        <Skeleton className="h-[52vh] min-h-[360px] w-full rounded-none" />
        <div className={`${PAGE_X} mt-8 grid gap-10`}>
          <CardSkeletonRail />
          <CardSkeletonRail />
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className={`w-full flex-1 ${PAGE_X} py-10`}>
        <ErrorCard
          title="Your library did not load"
          message={error.message}
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      </main>
    );
  }

  if (!data || data.empty) {
    return (
      <main className={`w-full flex-1 ${PAGE_X} py-10`}>
        <EmptyState
          title="Nothing to watch yet"
          message="Once something is published in the admin Catalog it shows up here. In the meantime you can ask for a title."
          action={
            <button
              type="button"
              onClick={() => setRequestOpen(true)}
              className="min-h-10 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
            >
              Request a title
            </button>
          }
        />
        <RequestModal open={requestOpen} onClose={() => setRequestOpen(false)} />
      </main>
    );
  }

  const { spotlight, continueWatching, folders, videos } = data;
  const progress = libraryProgressMap(data);

  return (
    <main className="w-full flex-1 pb-16">
      {spotlight.length > 0 && (
        <>
          <SpotlightCarousel slides={spotlight} />
          <div className="filmstrip" />
        </>
      )}

      {continueWatching.length > 0 && (
        <Rail title="Continue watching" eyebrow="Pick up where you left off">
          {continueWatching.map(({ item, progress }) => (
            <RailItem key={item.id} wide>
              <VideoCard item={item as CatalogVideoListItem} progress={progress} ratio="still" />
            </RailItem>
          ))}
        </Rail>
      )}

      {folders.length > 0 && (
        <Rail title="Series" eyebrow={`${folders.length} in your library`} seeAllHref="/discover?type=series">
          {folders.slice(0, RAIL_LIMIT).map((folder) => (
            <RailItem key={folder.id}>
              <FolderCard item={folder as CatalogFolderListItem} />
            </RailItem>
          ))}
        </Rail>
      )}

      {videos.length > 0 && (
        <>
          <div className="filmstrip" />
          <Rail title="Films" eyebrow={`${videos.length} in your library`} seeAllHref="/discover?type=movies">
            {videos.slice(0, RAIL_LIMIT).map((video) => (
              <RailItem key={video.id}>
                <VideoCard item={video as CatalogVideoListItem} progress={progress.get(video.id)} />
              </RailItem>
            ))}
          </Rail>
        </>
      )}

      <section className={`${PAGE_X} mt-6`}>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-divider bg-surface p-5">
          <div>
            <h2 className="font-display text-xl tracking-wide text-white">Missing something?</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Ask for a film or a series and follow it from New through Added on the requests board.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/requests"
              className="min-h-10 rounded-lg border border-divider-strong px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-surface-hover"
            >
              Open requests
            </Link>
            <button
              type="button"
              onClick={() => setRequestOpen(true)}
              className="min-h-10 rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
            >
              Request a title
            </button>
          </div>
        </div>
      </section>

      <RequestModal open={requestOpen} onClose={() => setRequestOpen(false)} />
    </main>
  );
}
