import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import ExploreDetail from "../components/explore/ExploreDetail";
import { PosterTitleCard } from "../components/feed/TitleCard";
import { CardSkeletonGrid, ErrorCard } from "../components/ui/States";
import { useNearEnd } from "../hooks/useNearEnd";
import { useTitlePanel } from "../hooks/useTitlePanel";
import type { ExploreKind } from "../lib/explore";
import { itemKey, useFeedSection } from "../lib/feed";
import { PAGE_X } from "../lib/layout";
import NotFoundPage from "./NotFoundPage";

/** One of the feed's sections on its own: every title TMDb has for it, loading on as you scroll. */
export default function SectionPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const kind = (["movie", "tv"].includes(params.get("kind") ?? "") ? params.get("kind") : "all") as ExploreKind;
  const section = useFeedSection(id, kind);
  const panel = useTitlePanel();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id, kind]);
  useEffect(() => {
    if (section.title) document.title = `${section.title} · Campfire`;
    return () => {
      document.title = "Campfire";
    };
  }, [section.title]);

  const loadMore = useNearEnd(() => {
    if (section.hasNextPage && !section.isFetchingNextPage && !section.isFetchNextPageError) section.fetchNextPage();
  }, section.items.length > 0 && !section.isFetchingNextPage);

  if (section.error instanceof ApiError && section.error.status === 404) return <NotFoundPage />;

  return (
    <main className={`w-full flex-1 ${PAGE_X} py-8`}>
      <Link
        to={kind === "all" ? "/" : `/?kind=${kind}`}
        className="mb-4 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-text-secondary transition hover:bg-surface hover:text-white"
      >
        <span aria-hidden="true">&larr;</span> Home
      </Link>
      <h1 className="mb-6 font-display text-4xl tracking-wide text-white sm:text-5xl">{section.title ?? "Loading"}</h1>

      {section.isLoading ? (
        <CardSkeletonGrid count={21} />
      ) : section.isError && section.items.length === 0 ? (
        <ErrorCard message={section.error?.message} onRetry={() => section.refetch()} retrying={section.isFetching} />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-9">
          {section.items.map((item) => (
            <PosterTitleCard key={itemKey(item)} item={item} onOpen={() => panel.open(item.tmdbType, item.tmdbId)} />
          ))}
        </div>
      )}

      <div ref={loadMore} aria-hidden="true" />
      {section.isFetchingNextPage && (
        <div className="mt-7">
          <CardSkeletonGrid count={14} label="Loading more" />
        </div>
      )}
      {section.isFetchNextPageError && (
        <div className="mt-7">
          <ErrorCard
            title="More did not load"
            message={section.error?.message}
            onRetry={() => section.fetchNextPage()}
            retrying={section.isFetchingNextPage}
          />
        </div>
      )}
      <p className="mt-8 text-[11px] text-text-tertiary">Titles and artwork from TMDB.</p>

      {panel.opened && (
        <ExploreDetail
          key={`${panel.opened.type}-${panel.opened.id}`}
          type={panel.opened.type}
          tmdbId={panel.opened.id}
          onClose={panel.close}
        />
      )}
    </main>
  );
}
