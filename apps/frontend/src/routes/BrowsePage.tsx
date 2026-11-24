import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useLibrary } from "../hooks/useCatalog";
import VideoCard from "../components/VideoCard";
import FolderCard from "../components/FolderCard";
import RequestModal from "../components/requests/RequestModal";
import { CardSkeletonGrid, EmptyState, ErrorCard } from "../components/ui/States";
import { playsInBrowser } from "../lib/mediaFormat";
import { PAGE_X } from "../lib/layout";
import { libraryProgressMap } from "../lib/progress";
import { allGenres, matchItem, sortItems, type SortKey } from "../lib/discovery";

type Kind = "all" | "series" | "movies";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "az", label: "A to Z" },
  { value: "za", label: "Z to A" },
  { value: "rating", label: "Highest rated" },
  { value: "newest", label: "Newest" },
];

/** Status chips — only the ones the data can actually answer. The library carries finished
 * progress for its own videos, so "Watched" is real for films; a series is "in progress" when any
 * of its episodes is. Genres come from TMDb, so they get their own row of chips below. */
type Filter = "all" | "in-progress" | "watched" | "needs-app";

const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "series", label: "Series" },
  { value: "movies", label: "Movies" },
];

const FILTERS: Record<Kind, { value: Filter; label: string }[]> = {
  all: [
    { value: "all", label: "Everything" },
    { value: "in-progress", label: "In progress" },
    { value: "watched", label: "Watched" },
    { value: "needs-app", label: "Needs the app" },
  ],
  series: [
    { value: "all", label: "Everything" },
    { value: "in-progress", label: "In progress" },
  ],
  movies: [
    { value: "all", label: "Everything" },
    { value: "in-progress", label: "In progress" },
    { value: "watched", label: "Watched" },
    { value: "needs-app", label: "Needs the app" },
  ],
};

function parseKind(value: string | null): Kind {
  return value === "series" || value === "movies" ? value : "all";
}

function chipClass(active: boolean): string {
  return `min-h-9 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
    active
      ? "border-accent bg-accent text-black"
      : "border-divider-strong text-text-secondary hover:border-text-tertiary hover:text-white"
  }`;
}

/** The whole library in one grid. Series and Movies are chips here rather than two
 * separate destinations; `?type=` keeps the chip in the URL so the Home rails' "See all" (and the
 * old /series and /movies bookmarks) land on the right one. */
export default function BrowsePage() {
  const { data, isLoading, error, refetch, isFetching } = useLibrary();
  const [searchParams, setSearchParams] = useSearchParams();
  const kind = parseKind(searchParams.get("type"));
  // The genre lives in the URL like the type does, so a genre row's "See all" on Home lands here
  // with its chip already picked.
  const genre = searchParams.get("genre");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<SortKey>("az");
  const [query, setQuery] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);

  const setParams = (next: { type?: Kind; genre?: string | null }) => {
    const type = next.type ?? kind;
    const g = next.genre === undefined ? genre : next.genre;
    const params: Record<string, string> = {};
    if (type !== "all") params.type = type;
    if (g) params.genre = g;
    setSearchParams(params, { replace: true });
  };

  const setKind = (next: Kind) => {
    setParams({ type: next });
    if (!FILTERS[next].some((f) => f.value === filter)) setFilter("all");
  };

  const progressByFileId = useMemo(() => libraryProgressMap(data), [data]);

  /** Series progress comes through Continue Watching (episodes in progress, by parent folder). */
  const seriesInProgress = useMemo(
    () => new Set((data?.continueWatching ?? []).map((entry) => entry.progress.parentFolderId)),
    [data],
  );

  const source = useMemo(() => {
    if (!data) return [];
    if (kind === "series") return data.folders;
    if (kind === "movies") return data.videos;
    return [...data.folders, ...data.videos];
  }, [data, kind]);

  const genres = useMemo(() => allGenres(source), [source]);

  const items = useMemo(() => {
    const filtered = source.filter((item) => {
      // Title, genre or an actor's name — the same matching search uses (lib/discovery.ts).
      if (query.trim() && !matchItem(item, query)) return false;
      if (genre && !(item.genres ?? []).includes(genre)) return false;
      const progress = item.kind === "video" ? progressByFileId.get(item.id) : undefined;
      if (filter === "in-progress") {
        return item.kind === "folder" ? seriesInProgress.has(item.id) : !!progress && !progress.completed;
      }
      if (filter === "watched") return item.kind === "video" && !!progress?.completed;
      if (filter === "needs-app") return item.kind === "video" && !playsInBrowser(item.mimeType);
      return true;
    });
    return sortItems(filtered, sort);
  }, [source, filter, sort, query, genre, progressByFileId, seriesInProgress]);

  const anyFilter = !!query || filter !== "all" || !!genre;

  return (
    <main className={`w-full flex-1 ${PAGE_X} py-8`}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-wide text-white">Your library</h1>
          {data && (
            <p className="mt-1 text-sm text-text-secondary">
              {items.length} of {source.length} shown
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="browse-filter" className="sr-only">
            Filter by name, genre or cast
          </label>
          <input
            id="browse-filter"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, genre or cast"
            className="min-h-10 w-56 rounded-lg border border-divider-strong bg-[var(--bg-elevated)] px-3 py-2 text-sm text-white outline-none transition focus:border-accent"
          />
          <div className="flex items-center gap-2">
            <label htmlFor="browse-sort" className="text-xs font-semibold text-text-secondary">
              Sort
            </label>
            <select
              id="browse-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortKey)}
              className="min-h-10 rounded-lg border border-divider-strong bg-[var(--bg-elevated)] px-2.5 py-2 text-sm text-white outline-none focus:border-accent"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Type" className="flex flex-wrap gap-2">
          {KINDS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              aria-pressed={kind === chip.value}
              onClick={() => setKind(chip.value)}
              className={chipClass(kind === chip.value)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <span aria-hidden="true" className="mx-1 h-6 w-px bg-divider-strong" />
        <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
          {FILTERS[kind].map((chip) => (
            <button
              key={chip.value}
              type="button"
              aria-pressed={filter === chip.value}
              onClick={() => setFilter(chip.value)}
              className={`min-h-9 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                filter === chip.value
                  ? "border-accent-dim bg-accent-soft text-amber"
                  : "border-divider-strong text-text-secondary hover:border-text-tertiary hover:text-white"
              }`}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {genres.length > 0 && (
        <div role="group" aria-label="Genre" className="-mt-3 mb-6 flex flex-wrap gap-2">
          {genres.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={genre === g}
              onClick={() => setParams({ genre: genre === g ? null : g })}
              className={`min-h-8 rounded-full border px-3 py-1 text-xs transition ${
                genre === g
                  ? "border-white bg-white text-black"
                  : "border-divider text-text-tertiary hover:border-text-tertiary hover:text-white"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <ErrorCard title="The library did not load" message={error.message} onRetry={() => refetch()} retrying={isFetching} />
      ) : isLoading ? (
        <CardSkeletonGrid count={14} label="Loading the library" />
      ) : items.length === 0 ? (
        <EmptyState
          title={anyFilter ? "Nothing matches that" : "Nothing here yet"}
          message={
            anyFilter
              ? "Clear the filter to see everything in your library."
              : "Nothing has been published here yet. You can ask for something instead."
          }
          action={
            anyFilter ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                  setParams({ genre: null });
                }}
                className="min-h-10 rounded-lg border border-divider-strong px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-surface-hover"
              >
                Clear filters
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setRequestOpen(true)}
                className="min-h-10 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
              >
                Request a title
              </button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {items.map((item) =>
            item.kind === "folder" ? (
              <FolderCard key={item.id} item={item} />
            ) : (
              <VideoCard key={item.id} item={item} progress={progressByFileId.get(item.id)} />
            ),
          )}
        </div>
      )}

      <RequestModal open={requestOpen} onClose={() => setRequestOpen(false)} initialTitle={query.trim()} />
    </main>
  );
}
