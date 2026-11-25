import { Fragment, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useLibrary } from "../hooks/useCatalog";
import { useNearEnd } from "../hooks/useNearEnd";
import { useTitlePanel } from "../hooks/useTitlePanel";
import FeedHero from "../components/feed/FeedHero";
import FeedRail from "../components/feed/FeedRail";
import ExploreDetail from "../components/explore/ExploreDetail";
import SpotlightCarousel from "../components/SpotlightCarousel";
import Rail, { RailItem } from "../components/Rail";
import ForYouRails from "../components/ForYouRails";
import VideoCard from "../components/VideoCard";
import FolderCard from "../components/FolderCard";
import RequestModal from "../components/requests/RequestModal";
import { CardSkeletonRail, EmptyState, ErrorCard, Skeleton } from "../components/ui/States";
import { genreShelves, sortItems } from "../lib/discovery";
import type { ExploreItem, ExploreKind } from "../lib/explore";
import { sectionHref, useFeed } from "../lib/feed";
import { PAGE_X } from "../lib/layout";
import type { CatalogListItem, CatalogVideoListItem } from "../lib/catalogListItem";
import { libraryProgressMap } from "../lib/progress";
import type { LibraryResponse, WatchProgress } from "../lib/types";

/** How many items a rail shows before "See all" takes over. */
const RAIL_LIMIT = 18;
/** The library's own row comes after this many of the feed's. */
const LIBRARY_AFTER = 2;

const KINDS: { value: ExploreKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "movie", label: "Films" },
  { value: "tv", label: "Series" },
];

/** Shortcuts into the feed's sections. TMDb has no such genre for series where `films` is set. */
const SHORTCUTS: { id: string; label: string; films?: true }[] = [
  { id: "hot", label: "New and hot" },
  { id: "hindi", label: "Hindi" },
  { id: "south", label: "South Indian" },
  { id: "action", label: "Action" },
  { id: "comedy", label: "Comedy" },
  { id: "thriller", label: "Thriller", films: true },
  { id: "crime", label: "Crime" },
  { id: "romance", label: "Romance", films: true },
  { id: "horror", label: "Horror", films: true },
  { id: "scifi", label: "Sci-fi and fantasy" },
  { id: "korean", label: "Korean" },
  { id: "anime", label: "Anime" },
  { id: "family", label: "Family" },
  { id: "documentary", label: "Documentary" },
  { id: "acclaimed", label: "Acclaimed" },
  { id: "gems", label: "Hidden gems" },
];

const CHIP = "inline-flex min-h-9 shrink-0 items-center rounded-full border px-4 text-[13px] font-semibold transition";

/** Home: all of TMDb as a feed, with what the viewer was watching and what the library can play
 * among it. Without TMDb it's the library alone. */
export default function HomePage() {
  const [params, setParams] = useSearchParams();
  const kind = (["movie", "tv"].includes(params.get("kind") ?? "") ? params.get("kind") : "all") as ExploreKind;
  const library = useLibrary();
  const feed = useFeed(kind);
  const panel = useTitlePanel();
  const [requestOpen, setRequestOpen] = useState(false);
  const openItem = (item: ExploreItem, play = false) => panel.open(item.tmdbType, item.tmdbId, play);

  const loadMore = useNearEnd(() => {
    if (feed.hasNextPage && !feed.isFetchingNextPage && !feed.isFetchNextPageError) feed.fetchNextPage();
  }, feed.sections.length > 0 && !feed.isFetchingNextPage);

  const data = library.data;
  const progress = useMemo(() => libraryProgressMap(data), [data]);
  const added = data?.spotlight.filter((s) => s.kind === "request").slice(0, 2) ?? [];

  const setKind = (next: ExploreKind) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next === "all") p.delete("kind");
        else p.set("kind", next);
        return p;
      },
      { replace: true, preventScrollReset: true },
    );

  const detail = panel.opened && (
    <ExploreDetail
      key={`${panel.opened.type}-${panel.opened.id}`}
      type={panel.opened.type}
      tmdbId={panel.opened.id}
      onClose={panel.close}
    />
  );

  // No TMDb on this server, or it isn't answering: the library as it is.
  if (feed.available === false || (feed.isError && feed.sections.length === 0)) {
    return (
      <>
        <LibraryHome
          library={library}
          progress={progress}
          feedError={feed.isError ? { message: feed.error.message, retry: () => feed.refetch(), retrying: feed.isFetching } : null}
          onRequest={() => setRequestOpen(true)}
        />
        <RequestModal open={requestOpen} onClose={() => setRequestOpen(false)} />
        {detail}
      </>
    );
  }

  const personal = data && !data.empty && (
    <>
      <ContinueWatching data={data} />
      {kind === "all" && <ForYouRails items={[...data.folders, ...data.videos]} onOpen={openItem} />}
    </>
  );
  const mine = data ? (kind === "movie" ? data.videos : kind === "tv" ? data.folders : [...data.folders, ...data.videos]) : [];
  const ready = mine.length > 0 && (
    <Rail
      title="In your library"
      eyebrow={`${mine.length} ${mine.length === 1 ? "title" : "titles"}`}
      seeAllHref={kind === "movie" ? "/discover?type=movies" : kind === "tv" ? "/discover?type=series" : "/discover"}
    >
      {sortItems(mine, "newest")
        .slice(0, RAIL_LIMIT)
        .map((item) => (
          <RailItem key={item.id}>
            <LibraryCard item={item} progress={progress} />
          </RailItem>
        ))}
    </Rail>
  );

  return (
    <main className="w-full flex-1 pb-16">
      <h1 className="sr-only">Home</h1>
      {feed.hero.length > 0 ? (
        <FeedHero key={kind} hero={feed.hero} added={kind === "all" ? added : []} onOpen={openItem} />
      ) : (
        <Skeleton className="h-[78vh] max-h-[880px] min-h-[520px] w-full rounded-none" />
      )}

      <nav aria-label="Browse" className={`no-scrollbar flex items-center gap-2 overflow-x-auto py-4 ${PAGE_X}`}>
        <div role="group" aria-label="Type" className="flex shrink-0 gap-2">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              aria-pressed={kind === k.value}
              onClick={() => setKind(k.value)}
              className={`${CHIP} ${
                kind === k.value ? "border-white bg-white text-black" : "border-divider-strong text-white hover:bg-surface-hover"
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-divider-strong" />
        {SHORTCUTS.filter((s) => !(s.films && kind === "tv")).map((s) => (
          <Link
            key={s.id}
            to={sectionHref(s.id, kind)}
            className={`${CHIP} border-divider-strong text-text-secondary hover:border-text-tertiary hover:text-white`}
          >
            {s.label}
          </Link>
        ))}
      </nav>

      {personal}

      {feed.sections.map((section, i) => (
        <Fragment key={section.id}>
          {i === LIBRARY_AFTER && ready}
          <FeedRail section={section} kind={kind} onOpen={openItem} />
        </Fragment>
      ))}

      <div ref={loadMore} aria-hidden="true" />
      {(feed.isLoading || feed.isFetchingNextPage) && (
        <div className={`${PAGE_X} mt-6 grid gap-10`}>
          <CardSkeletonRail count={10} />
          <CardSkeletonRail count={10} />
        </div>
      )}
      {feed.isFetchNextPageError && (
        <div className={`${PAGE_X} mt-6`}>
          <ErrorCard
            title="The next sections did not load"
            message={feed.error?.message}
            onRetry={() => feed.fetchNextPage()}
            retrying={feed.isFetchingNextPage}
          />
        </div>
      )}

      {!feed.hasNextPage && !feed.isLoading && <Missing onRequest={() => setRequestOpen(true)} />}
      <p className={`${PAGE_X} mt-8 text-[11px] text-text-tertiary`}>
        Titles and artwork from TMDB; streaming availability from JustWatch. This product uses the TMDB API but is not endorsed or
        certified by TMDB.
      </p>

      <RequestModal open={requestOpen} onClose={() => setRequestOpen(false)} />
      {detail}
    </main>
  );
}

function LibraryCard({ item, progress }: { item: CatalogListItem; progress: Map<string, WatchProgress> }) {
  return item.kind === "folder" ? <FolderCard item={item} /> : <VideoCard item={item} progress={progress.get(item.id)} />;
}

function ContinueWatching({ data }: { data: LibraryResponse }) {
  if (data.continueWatching.length === 0) return null;
  return (
    <Rail title="Continue watching" eyebrow="Pick up where you left off">
      {data.continueWatching.map(({ item, progress }) => (
        <RailItem key={item.id} wide>
          <VideoCard item={item as CatalogVideoListItem} progress={progress} ratio="still" />
        </RailItem>
      ))}
    </Rail>
  );
}

function Missing({ onRequest }: { onRequest: () => void }) {
  return (
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
            onClick={onRequest}
            className="min-h-10 rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
          >
            Request a title
          </button>
        </div>
      </div>
    </section>
  );
}

/** Home from the library alone. */
function LibraryHome({
  library,
  progress,
  feedError,
  onRequest,
}: {
  library: ReturnType<typeof useLibrary>;
  progress: Map<string, WatchProgress>;
  feedError: { message: string; retry: () => void; retrying: boolean } | null;
  onRequest: () => void;
}) {
  const { data, isLoading, error, refetch, isFetching } = library;

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
        <ErrorCard title="Your library did not load" message={error.message} onRetry={() => refetch()} retrying={isFetching} />
      </main>
    );
  }
  const problem = feedError && (
    <div className={`${PAGE_X} pt-4`}>
      <ErrorCard title="The feed did not load" message={feedError.message} onRetry={feedError.retry} retrying={feedError.retrying} />
    </div>
  );
  if (!data || data.empty) {
    return (
      <main className={`w-full flex-1 ${PAGE_X} py-10`}>
        {problem}
        <EmptyState
          title="Nothing to watch yet"
          message="Once something is published in the admin Catalog it shows up here. In the meantime you can ask for a title."
          action={
            <button
              type="button"
              onClick={onRequest}
              className="min-h-10 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
            >
              Request a title
            </button>
          }
        />
      </main>
    );
  }

  const { spotlight, folders, videos } = data;
  const rails = [
    { id: "series", title: "Series", items: folders, href: "/discover?type=series" },
    { id: "films", title: "Films", items: videos, href: "/discover?type=movies" },
    ...genreShelves([...folders, ...videos]).map((shelf) => ({
      id: shelf.genre,
      title: shelf.genre,
      items: shelf.items,
      href: `/discover?genre=${encodeURIComponent(shelf.genre)}`,
    })),
  ];
  return (
    <main className="w-full flex-1 pb-16">
      {spotlight.length > 0 && <SpotlightCarousel slides={spotlight} />}
      {problem}
      <ContinueWatching data={data} />
      <ForYouRails items={[...folders, ...videos]} />
      {rails
        .filter((rail) => rail.items.length > 0)
        .map((rail) => (
          <Rail key={rail.id} title={rail.title} eyebrow={`${rail.items.length} in your library`} seeAllHref={rail.href}>
            {rail.items.slice(0, RAIL_LIMIT).map((item) => (
              <RailItem key={item.id}>
                <LibraryCard item={item} progress={progress} />
              </RailItem>
            ))}
          </Rail>
        ))}
      <Missing onRequest={onRequest} />
    </main>
  );
}
