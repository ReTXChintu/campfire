import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useLibrary } from "../hooks/useCatalog";
import type { CatalogListItem } from "../lib/catalogListItem";
import Poster from "./Poster";
import RequestModal from "./requests/RequestModal";
import { CardSkeletonRail, ErrorCard } from "./ui/States";
import { formatLabel, playsInBrowser } from "../lib/mediaFormat";
import { matchItem, reasonLabel, sortItems, type MatchReason } from "../lib/discovery";

/**
 * Instant search over the catalog the app already holds. There is no search endpoint on the
 * backend, so this filters `GET /api/library`'s own folders and videos client-side — which is also
 * why it is instant. It matches titles, genres and lead actors (lib/discovery.ts), and says which
 * when it isn't the title. A query that matches nothing offers the request form instead.
 */
type Result = { item: CatalogListItem; reason: MatchReason };

function search(items: CatalogListItem[], query: string): Result[] {
  const found: Result[] = [];
  for (const item of items) {
    const reason = matchItem(item, query);
    if (reason) found.push({ item, reason });
  }
  // A title match is what was most likely meant, so those lead; within each group, best rated.
  const byTitle = sortItems(found.filter((r) => r.reason.kind === "title").map((r) => r.item), "rating");
  const byOther = sortItems(found.filter((r) => r.reason.kind !== "title").map((r) => r.item), "rating");
  const reasonOf = new Map(found.map((r) => [r.item.id, r.reason]));
  return [...byTitle, ...byOther].map((item) => ({ item, reason: reasonOf.get(item.id)! }));
}

function ResultRow({
  item,
  reason,
  onNavigate,
}: {
  item: CatalogListItem;
  reason: MatchReason;
  onNavigate: () => void;
}) {
  const why = reasonLabel(reason);
  const isFolder = item.kind === "folder";
  const path = isFolder
    ? item.thumbnailFileId
      ? `/api/thumbnail-folder/${item.id}`
      : null
    : `/api/thumbnail/${item.id}`;

  return (
    <Link
      to={isFolder ? `/folder/${item.id}` : `/watch/${item.id}`}
      onClick={onNavigate}
      className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-transparent p-2 transition hover:border-divider hover:bg-surface"
    >
      <Poster path={path} title={item.name} id={item.id} />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-white">{item.name}</p>
        <p className="truncate text-xs text-text-tertiary">
          {why && <span className="text-amber">{why} · </span>}
          {isFolder
            ? "Series"
            : playsInBrowser(item.mimeType)
              ? `Film · ${formatLabel(item.mimeType)}`
              : `Film · ${formatLabel(item.mimeType)} · needs the app`}
          {item.year ? ` · ${item.year}` : ""}
        </p>
      </div>
      <span aria-hidden="true" className="px-2 text-text-tertiary">
        &rsaquo;
      </span>
    </Link>
  );
}

export default function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [requestOpen, setRequestOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data, isLoading, error, refetch, isFetching } = useLibrary();

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setRequestOpen(false);
    }
  }, [open]);

  const needle = query.trim();
  const { series, films } = useMemo(() => {
    if (!data || needle.length === 0) return { series: [], films: [] };
    return { series: search(data.folders, needle), films: search(data.videos, needle) };
  }, [data, needle]);

  if (!open) return null;

  const total = series.length + films.length;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Search the library">
      <button
        type="button"
        aria-label="Close search"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/75 backdrop-blur-sm"
      />
      <div className="relative flex h-full flex-col gap-4 px-4 pt-5 pb-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 rounded-2xl border border-divider-strong bg-[var(--bg-elevated)] px-4 py-3 shadow-2xl">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 shrink-0 text-text-tertiary"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <label className="sr-only" htmlFor="library-search">
            Search titles
          </label>
          <input
            id="library-search"
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            placeholder="Search by title, genre or actor"
            className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-text-tertiary"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-text-secondary transition hover:text-white"
          >
            Esc
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error ? (
            <ErrorCard
              title="Search needs your library"
              message={error.message}
              onRetry={() => refetch()}
              retrying={isFetching}
            />
          ) : isLoading ? (
            <CardSkeletonRail count={5} />
          ) : needle.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-secondary">
              Start typing to filter everything you can watch. Not in the library?{" "}
              <button
                type="button"
                onClick={() => setRequestOpen(true)}
                className="font-semibold text-amber underline"
              >
                Request a title
              </button>
              .
            </p>
          ) : total === 0 ? (
            <div className="mx-auto grid max-w-md place-items-center gap-3 py-14 text-center">
              <h2 className="font-display text-2xl tracking-wide text-white">
                No match for &ldquo;{query.trim()}&rdquo;
              </h2>
              <p className="text-sm text-text-secondary">
                It is not in the library yet. Ask for it and the admin will see it on the requests board.
              </p>
              <button
                type="button"
                onClick={() => setRequestOpen(true)}
                className="min-h-10 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
              >
                Request &ldquo;{query.trim()}&rdquo;
              </button>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-2">
              {series.length > 0 && (
                <section>
                  <h2 className="mb-2 font-display text-sm tracking-[0.16em] text-text-tertiary uppercase">
                    Series ({series.length})
                  </h2>
                  <div className="grid gap-1">
                    {series.map(({ item, reason }) => (
                      <ResultRow key={item.id} item={item} reason={reason} onNavigate={onClose} />
                    ))}
                  </div>
                </section>
              )}
              {films.length > 0 && (
                <section>
                  <h2 className="mb-2 font-display text-sm tracking-[0.16em] text-text-tertiary uppercase">
                    Films ({films.length})
                  </h2>
                  <div className="grid gap-1">
                    {films.map(({ item, reason }) => (
                      <ResultRow key={item.id} item={item} reason={reason} onNavigate={onClose} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>
      </div>

      <RequestModal open={requestOpen} onClose={() => setRequestOpen(false)} initialTitle={query.trim()} />
    </div>
  );
}
