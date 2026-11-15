import { useMemo, useState } from "react";
import { useLibrary } from "../hooks/useCatalog";
import VideoCard from "../components/VideoCard";
import FolderCard from "../components/FolderCard";
import RequestModal from "../components/requests/RequestModal";
import { CardSkeletonGrid, EmptyState, ErrorCard } from "../components/ui/States";
import { playsInBrowser } from "../lib/mediaFormat";
import { PAGE_X } from "../lib/layout";
import type { WatchProgress } from "../lib/types";

type Kind = "series" | "movies";
type Sort = "az" | "za";

/** The filter chips are only the ones the data can actually answer. The catalog has no genres,
 * years or resolutions, and `continueWatching` is in-progress only (the backend filters
 * `completed: false`), so there is deliberately no "Watched" or "Not started" chip — those two
 * would be indistinguishable from each other and the chip would be a lie. */
type Filter = "all" | "in-progress" | "needs-app";

const FILTERS: Record<Kind, { value: Filter; label: string }[]> = {
  series: [
    { value: "all", label: "All" },
    { value: "in-progress", label: "In progress" },
  ],
  movies: [
    { value: "all", label: "All" },
    { value: "in-progress", label: "In progress" },
    { value: "needs-app", label: "Needs the app" },
  ],
};

export default function BrowsePage({ kind }: { kind: Kind }) {
  const { data, isLoading, error, refetch, isFetching } = useLibrary();
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("az");
  const [query, setQuery] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);

  const title = kind === "series" ? "Series" : "Films";

  /** In-progress is derived from the progress records the library already ships: a film by its own
   * fileId, a series by whether any episode of it is in progress (`parentFolderId`). */
  const inProgress = useMemo(() => {
    const progress: WatchProgress[] = (data?.continueWatching ?? []).map((entry) => entry.progress);
    return {
      fileIds: new Set(progress.map((entry) => entry.fileId)),
      folderIds: new Set(progress.map((entry) => entry.parentFolderId)),
    };
  }, [data]);

  const items = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    const source = kind === "series" ? data.folders : data.videos;
    const filtered = source.filter((item) => {
      if (needle && !item.name.toLowerCase().includes(needle)) return false;
      if (filter === "in-progress") {
        return item.kind === "folder" ? inProgress.folderIds.has(item.id) : inProgress.fileIds.has(item.id);
      }
      if (filter === "needs-app") {
        return item.kind === "video" && !playsInBrowser(item.mimeType);
      }
      return true;
    });
    return [...filtered].sort((a, b) =>
      sort === "az" ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name),
    );
  }, [data, kind, filter, sort, query, inProgress]);

  const progressByFileId = useMemo(() => {
    const map = new Map<string, WatchProgress>();
    for (const entry of data?.continueWatching ?? []) map.set(entry.progress.fileId, entry.progress);
    return map;
  }, [data]);

  return (
    <main className={`w-full flex-1 ${PAGE_X} py-8`}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-xs tracking-[0.16em] text-text-tertiary uppercase">Browse</p>
          <h1 className="font-display text-4xl tracking-wide text-white">{title}</h1>
          {data && (
            <p className="mt-1 text-sm text-text-secondary">
              {items.length} of {(kind === "series" ? data.folders : data.videos).length} shown
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="browse-filter" className="sr-only">
              Filter {title} by name
            </label>
            <input
              id="browse-filter"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Filter ${title.toLowerCase()}`}
              className="min-h-10 w-44 rounded-lg border border-divider-strong bg-[var(--bg-elevated)] px-3 py-2 text-sm text-white outline-none transition focus:border-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="browse-sort" className="text-xs font-semibold text-text-secondary">
              Sort
            </label>
            <select
              id="browse-sort"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
              className="min-h-10 rounded-lg border border-divider-strong bg-[var(--bg-elevated)] px-2.5 py-2 text-sm text-white outline-none focus:border-accent"
            >
              <option value="az">A to Z</option>
              <option value="za">Z to A</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
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

      {error ? (
        <ErrorCard
          title={`${title} did not load`}
          message={error.message}
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      ) : isLoading ? (
        <CardSkeletonGrid count={14} label={`Loading ${title.toLowerCase()}`} />
      ) : items.length === 0 ? (
        <EmptyState
          title={query || filter !== "all" ? "Nothing matches that" : `No ${title.toLowerCase()} yet`}
          message={
            query || filter !== "all"
              ? "Clear the filter to see everything in your library."
              : "Nothing has been published in this shelf yet. You can ask for something instead."
          }
          action={
            query || filter !== "all" ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
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
