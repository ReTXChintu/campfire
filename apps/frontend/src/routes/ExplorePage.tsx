import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import ExploreRow, { Star } from "../components/explore/ExploreRow";
import ExploreDetail from "../components/explore/ExploreDetail";
import FisheyeWall, { type GlideRequest } from "../components/explore/FisheyeWall";
import { CardSkeletonRail, EmptyState, ErrorCard, Skeleton } from "../components/ui/States";
import { useTmdbSearch } from "../hooks/useRequests";
import {
  exploreMetaLine,
  parseTitleParam,
  titleParam,
  useExplore,
  useExploreWall,
  type ExploreDetail as Detail,
  type ExploreItem,
  type ExploreKind,
  type ExploreService,
  type WallItem,
} from "../lib/explore";
import { supportsWall } from "../lib/fisheye";
import { PAGE_X } from "../lib/layout";

const KINDS: { value: ExploreKind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "movie", label: "Films" },
  { value: "tv", label: "Series" },
];
const MAX_SERVICES = 3;

function chipClass(on: boolean, tone: "accent" | "live" = "accent") {
  const active = tone === "live" ? "border-live bg-live text-background" : "border-accent bg-accent text-background";
  return `inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
    on ? active : "border-divider-strong bg-[var(--bg-elevated)] text-text-secondary hover:text-white"
  }`;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Search all of TMDb from the top of the page; a pick opens the same panel a poster does. */
function ExploreSearch({ onOpen }: { onOpen: (type: "movie" | "tv", id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(q, 350);
  const search = useTmdbSearch(debounced, debounced.trim().length >= 2);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const results = debounced.trim().length >= 2 ? (search.data?.results ?? []) : [];
  const showList = open && q.trim().length >= 2;
  return (
    <div ref={box} className="relative w-full sm:w-[320px]">
      <label htmlFor="explore-search" className="sr-only">
        Search any film or series
      </label>
      <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        id="explore-search"
        type="search"
        value={q}
        autoComplete="off"
        placeholder="Search any title"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        aria-controls="explore-search-results"
        aria-expanded={showList}
        className="min-h-11 w-full rounded-xl border border-divider-strong bg-[var(--bg-elevated)] pl-9 pr-3 text-sm text-white placeholder:text-text-tertiary focus:border-accent focus:outline-none"
      />
      {showList && (
        <div
          id="explore-search-results"
          className="absolute right-0 top-full z-40 mt-2 max-h-[60vh] w-full overflow-y-auto rounded-xl border border-divider-strong bg-[var(--bg-elevated)] p-1.5 shadow-2xl sm:w-[420px]"
        >
          {search.isFetching && !results.length ? (
            <p className="px-3 py-3 text-sm text-text-secondary">Searching…</p>
          ) : search.data && !search.data.available ? (
            <p className="px-3 py-3 text-sm text-text-secondary">Search isn't set up on this server.</p>
          ) : search.isError ? (
            <p className="px-3 py-3 text-sm text-text-secondary">Search isn't answering right now.</p>
          ) : !results.length ? (
            <p className="px-3 py-3 text-sm text-text-secondary">Nothing on TMDb by that name.</p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={`${r.tmdbType}-${r.tmdbId}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onOpen(r.tmdbType, r.tmdbId);
                    }}
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition hover:bg-surface-hover"
                  >
                    {r.posterUrl ? (
                      <img src={r.posterUrl} alt="" className="h-[60px] w-10 shrink-0 rounded-md object-cover" />
                    ) : (
                      <span className="h-[60px] w-10 shrink-0 rounded-md bg-surface" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-white">{r.title}</span>
                      <span className="block text-xs text-text-secondary">
                        {[r.year, r.tmdbType === "tv" ? "Series" : "Film"].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {r.inLibrary && (
                      <span className="shrink-0 rounded-md bg-live px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-background">
                        IN CAMPFIRE
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Hero({ d, onOpen, onSurprise }: { d: Detail; onOpen: () => void; onSurprise: () => void }) {
  const streams = d.watch.stream.slice(0, 3);
  return (
    <section aria-labelledby="explore-pick-title" className="relative overflow-hidden border-b border-divider">
      {d.backdropUrl && (
        <img src={d.backdropUrl} alt="" className="absolute inset-0 h-full w-full object-cover object-[center_30%]" />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(14,13,12,0.96)_0%,rgba(14,13,12,0.82)_38%,rgba(14,13,12,0.25)_70%,rgba(14,13,12,0.1)_100%)]" />
      <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent to-35%" />
      <div className={`relative grid max-w-[680px] gap-3.5 ${PAGE_X} py-10 sm:py-14 lg:py-16`}>
        <span className="justify-self-start rounded-md border border-amber/40 bg-amber/10 px-2.5 py-1 text-[11px] font-bold tracking-[0.12em] text-amber">
          TONIGHT'S PICK · TRENDING THIS WEEK
        </span>
        <h1 id="explore-pick-title" className="font-display text-[clamp(42px,6vw,76px)] leading-[0.95] tracking-[0.01em] text-white">
          {d.title}
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-secondary">
          {d.rating !== null && (
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              <Star className="h-3.5 w-3.5 text-amber" />
              {d.rating.toFixed(1)}
            </span>
          )}
          <span>{exploreMetaLine(d)}</span>
          {d.genres.length > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <span>{d.genres.slice(0, 3).join(", ")}</span>
            </>
          )}
        </p>
        {d.tagline && <p className="text-sm italic text-text-tertiary">{d.tagline}</p>}
        {d.overview && <p className="line-clamp-3 text-[15px] leading-relaxed text-[#d8d1c6]">{d.overview}</p>}
        {(streams.length > 0 || d.inLibrary) && (
          <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-text-secondary">
            {d.inLibrary && (
              <span className="rounded-md bg-live px-2 py-1 text-[11px] font-bold tracking-wider text-background">IN CAMPFIRE</span>
            )}
            {streams.length > 0 && <span>Streaming on</span>}
            {streams.map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-2 rounded-full border border-divider-strong bg-surface/85 py-1 pl-1 pr-2.5 font-semibold text-white"
              >
                {s.logoUrl && <img src={s.logoUrl} alt="" className="h-6 w-6 rounded-full" />}
                {s.name}
              </span>
            ))}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={onOpen}
            className="min-h-[46px] rounded-xl bg-accent px-5 text-sm font-bold text-background transition hover:brightness-110"
          >
            Where to watch
          </button>
          <button
            type="button"
            onClick={onSurprise}
            className="inline-flex min-h-[46px] items-center gap-2 rounded-xl border border-divider-strong bg-[var(--bg-elevated)]/85 px-4.5 text-sm font-semibold text-white transition hover:bg-surface-hover"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
            </svg>
            Surprise me
          </button>
        </div>
      </div>
    </section>
  );
}

type View = "wall" | "rows";

/** Wall or rows. The wall is the default wherever WebGL2 works, except for anyone whose system
 * asks for reduced motion (they can still switch to it). */
function ViewToggle({ view, onChange, canWall }: { view: View; onChange: (v: View) => void; canWall: boolean }) {
  if (!canWall) return null;
  return (
    <div role="group" aria-label="View" className="inline-flex shrink-0 rounded-full border border-divider-strong bg-black/60 p-1 backdrop-blur">
      {(
        [
          ["wall", "Wall", "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"],
          ["rows", "Rows", "M3 5h18M3 12h18M3 19h18"],
        ] as const
      ).map(([value, label, path]) => (
        <button
          key={value}
          type="button"
          aria-pressed={view === value}
          onClick={() => onChange(value)}
          className={`inline-flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition ${
            view === value ? "bg-white text-background" : "text-text-secondary hover:text-white"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path d={path} />
          </svg>
          {label}
        </button>
      ))}
    </div>
  );
}

function FilterChips({
  kind,
  libOnly,
  services,
  available,
  onKind,
  onLib,
  onService,
  compact,
}: {
  kind: ExploreKind;
  libOnly: boolean;
  services: number[];
  available: ExploreService[];
  onKind: (k: ExploreKind) => void;
  onLib: () => void;
  onService: (id: number) => void;
  compact?: boolean;
}) {
  const glass = compact ? "bg-black/55 backdrop-blur" : "";
  return (
    <div className="flex min-w-0 items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
      <div role="group" aria-label="Type" className="flex shrink-0 gap-2">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            aria-pressed={kind === k.value}
            onClick={() => onKind(k.value)}
            className={`${chipClass(kind === k.value)} px-4 ${kind === k.value ? "" : glass}`}
          >
            {k.label}
          </button>
        ))}
      </div>
      <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-divider-strong" />
      <button type="button" aria-pressed={libOnly} onClick={onLib} className={`${chipClass(libOnly, "live")} px-4 ${libOnly ? "" : glass}`}>
        In Campfire
      </button>
      {available.length > 0 && (
        <>
          <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-divider-strong" />
          <div role="group" aria-label="Streaming on" className="flex shrink-0 items-center gap-2">
            {!compact && <span className="mr-0.5 shrink-0 text-xs text-text-tertiary">Streaming on</span>}
            {available.map((s) => {
              const on = services.includes(s.id);
              const full = !on && services.length >= MAX_SERVICES;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={compact ? `Streaming on ${s.name}` : undefined}
                  disabled={full}
                  title={full ? `Up to ${MAX_SERVICES} at once` : compact ? s.name : undefined}
                  onClick={() => onService(s.id)}
                  className={`${chipClass(on)} py-1 pl-1 ${compact ? "pr-1 2xl:pr-3" : "pr-3"} ${on ? "" : glass}`}
                >
                  {s.logoUrl ? (
                    <img src={s.logoUrl} alt="" className="h-7 w-7 rounded-full" />
                  ) : (
                    <span className="h-7 w-7 rounded-full bg-surface" aria-hidden="true" />
                  )}
                  <span className={compact ? "hidden 2xl:inline" : undefined}>{s.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const TMDB_NOTICE = "Titles and artwork: TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.";

export default function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const kind = (["movie", "tv"].includes(params.get("kind") ?? "") ? params.get("kind") : "all") as ExploreKind;
  const services = useMemo(
    () =>
      (params.get("services") ?? "")
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n) && n > 0)
        .slice(0, MAX_SERVICES),
    [params],
  );
  const libOnly = params.get("lib") === "1";
  const opened = parseTitleParam(params.get("title"));

  const canWall = useMemo(() => supportsWall(), []);
  const [wallFailed, setWallFailed] = useState(false);
  const reduced = useMemo(() => Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches), []);
  const wantsWall = params.get("view") === "wall" || (params.get("view") !== "rows" && !reduced);
  const view: View = canWall && !wallFailed && wantsWall ? "wall" : "rows";

  const page = useExplore(kind, services, view === "rows");
  const wall = useExploreWall(kind, services, view === "wall");
  const data = page.data;
  const [glide, setGlide] = useState<GlideRequest | null>(null);

  useEffect(() => {
    document.title = "Explore · Campfire";
  }, []);

  /** Filters replace the history entry; opening a title pushes one, so Back closes the panel. */
  const update = useCallback(
    (changes: Record<string, string | null>, push = false) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(changes)) {
            if (v === null || v === "") next.delete(k);
            else next.set(k, v);
          }
          return next;
        },
        // The flag tells closing that Back will land on the page without the panel.
        push ? { state: { exploreOpened: true } } : { replace: true, state: location.state },
      );
    },
    [setParams, location.state],
  );

  const openTitle = useCallback((type: "movie" | "tv", id: string) => update({ title: titleParam(type, id) }, true), [update]);
  const openItem = useCallback(
    (item: Pick<ExploreItem, "tmdbType" | "tmdbId">) => openTitle(item.tmdbType, item.tmdbId),
    [openTitle],
  );
  const closeTitle = useCallback(() => {
    if ((location.state as { exploreOpened?: boolean } | null)?.exploreOpened) navigate(-1);
    else update({ title: null }); // opened from a link: there's nothing behind it to go back to
  }, [location.state, navigate, update]);

  const toggleService = (id: number) => {
    const next = services.includes(id) ? services.filter((s) => s !== id) : [...services, id];
    update({ services: next.length ? next.join(",") : null });
  };
  const setKind = (k: ExploreKind) => update({ kind: k === "all" ? null : k });
  const toggleLib = () => update({ lib: libOnly ? null : "1" });
  const setView = (v: View) => update({ view: v === "wall" ? (reduced ? "wall" : null) : "rows" });

  /** On the wall, a search pick that's on the wall glides there first; anything else just opens. */
  const searchPick = (type: "movie" | "tv", id: string) => {
    const key = titleParam(type, id);
    if (view === "wall" && wall.data?.items.some((i) => titleParam(i.tmdbType, i.tmdbId) === key)) {
      setGlide({ key, open: true, nonce: Date.now() });
    } else {
      openTitle(type, id);
    }
  };

  const serviceList = useMemo(() => data?.services ?? wall.data?.services ?? [], [data?.services, wall.data?.services]);
  const serviceMap = useMemo(() => new Map<number, ExploreService>(serviceList.map((s) => [s.id, s])), [serviceList]);
  const rows = useMemo(
    () =>
      (data?.rows ?? [])
        .map((row) => (libOnly ? { ...row, items: row.items.filter((i) => i.inLibrary) } : row))
        .filter((row) => row.items.length > 0),
    [data?.rows, libOnly],
  );
  const shown = useMemo(() => new Set(rows.flatMap((r) => r.items.map((i) => `${i.tmdbType}-${i.tmdbId}`))).size, [rows]);

  /** A random well-rated title from what's on the page — one you can watch, when there are any. */
  const surprise = () => {
    const all = rows.flatMap((r) => r.items);
    const good = all.filter((i) => (i.rating ?? 0) >= 7);
    const watchable = good.filter((i) => i.inLibrary || i.services.length);
    const pool = watchable.length >= 5 ? watchable : good.length ? good : all;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) openItem(pick);
  };

  // "In Campfire" on the wall brings the library's titles to the middle (the rest stay, dimmed),
  // rather than leaving a handful of them scattered among hundreds.
  const wallItems = useMemo(() => {
    const all = wall.data?.items ?? [];
    return libOnly ? [...all.filter((i) => i.inCampfire), ...all.filter((i) => !i.inCampfire)] : all;
  }, [wall.data, libOnly]);

  // The wall fills exactly the screen below the top bar.
  const wallBox = useRef<HTMLDivElement>(null);
  const [wallHeight, setWallHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (view !== "wall") return;
    const measure = () => {
      const top = (wallBox.current?.getBoundingClientRect().top ?? 0) + window.scrollY;
      setWallHeight(Math.max(320, window.innerHeight - Math.max(0, top)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [view]);

  const unavailable = (view === "rows" ? data : wall.data)?.available === false;
  if (unavailable) {
    return (
      <main className={`w-full flex-1 ${PAGE_X}`}>
        <EmptyState title="Explore isn't set up" message="It needs a TMDb API key on the server (TMDB_API_KEY)." />
      </main>
    );
  }

  const panel = opened && <ExploreDetail key={`${opened.type}-${opened.id}`} type={opened.type} tmdbId={opened.id} onClose={closeTitle} />;

  if (view === "wall") {
    const items: WallItem[] = wallItems;
    return (
      <main className="relative w-full flex-1">
        <h1 className="sr-only">Explore</h1>
        <div ref={wallBox} style={{ height: wallHeight ?? "calc(100dvh - 4.3rem)" }} className="relative overflow-hidden bg-[#0b0a09]">
          {wall.data && items.length > 0 && wall.data.imageBase ? (
            <FisheyeWall
              key={`${kind}-${services.join(",")}-${libOnly}`}
              items={items}
              imageBase={wall.data.imageBase}
              libOnly={libOnly}
              panelOpen={Boolean(opened)}
              glide={glide}
              onOpen={openItem}
              onFail={() => setWallFailed(true)}
            />
          ) : wall.isError ? (
            <div className={`${PAGE_X} pt-28`}>
              <ErrorCard message={wall.error.message} onRetry={() => wall.refetch()} retrying={wall.isFetching} />
            </div>
          ) : wall.data ? (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-text-secondary">
              Nothing matches those filters. Try another service.
            </div>
          ) : (
            <div role="status" className="grid h-full place-items-center">
              <div className="grid justify-items-center gap-3 text-sm text-text-secondary">
                <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-accent" aria-hidden="true" />
                Gathering hundreds of films and series…
              </div>
            </div>
          )}

          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/80 via-black/45 to-transparent pb-14 pt-4">
            <div className={`pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-2.5 ${PAGE_X}`}>
              <ViewToggle view={view} onChange={setView} canWall={canWall} />
              <div className="order-3 w-full min-w-0 md:order-none md:w-auto md:flex-1">
                <FilterChips
                  kind={kind}
                  libOnly={libOnly}
                  services={services}
                  available={serviceList}
                  onKind={setKind}
                  onLib={toggleLib}
                  onService={toggleService}
                  compact
                />
              </div>
              <div className="ml-auto w-[min(100%,320px)] max-md:flex-1">
                <ExploreSearch onOpen={searchPick} />
              </div>
            </div>
          </div>
          <p className="pointer-events-none absolute bottom-1 right-4 z-20 text-[10px] text-white/35 sm:right-6 lg:right-8" title={TMDB_NOTICE}>
            Data: TMDB · Where to watch: JustWatch
          </p>
        </div>
        {panel}
      </main>
    );
  }

  return (
    <main className="w-full flex-1 pb-4">
      {data?.featured ? (
        <Hero d={data.featured} onOpen={() => openTitle(data.featured!.tmdbType, data.featured!.tmdbId)} onSurprise={surprise} />
      ) : page.isLoading ? (
        <div className={`${PAGE_X} grid gap-4 py-14`} aria-hidden="true">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-16 w-[min(560px,90%)]" />
          <Skeleton className="h-20 w-[min(640px,95%)]" />
        </div>
      ) : null}

      <section aria-label="Filters" className={`grid gap-3 ${PAGE_X} pb-1.5 pt-6`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="grid gap-0.5">
            <h2 className="font-display text-[32px] leading-none tracking-wide text-white">Explore everything</h2>
            <p className="text-[13px] text-text-tertiary">
              Every film and series on TMDb, not just your library{data ? ` · ${shown} titles shown` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 max-sm:w-full">
            <ViewToggle view={view} onChange={setView} canWall={canWall} />
            <ExploreSearch onOpen={openTitle} />
          </div>
        </div>
        <FilterChips
          kind={kind}
          libOnly={libOnly}
          services={services}
          available={serviceList}
          onKind={setKind}
          onLib={toggleLib}
          onService={toggleService}
        />
      </section>

      {page.isError && !data ? (
        <div className={`${PAGE_X} py-6`}>
          <ErrorCard message={page.error.message} onRetry={() => page.refetch()} retrying={page.isFetching} />
        </div>
      ) : page.isLoading ? (
        <div className={`grid gap-8 ${PAGE_X} py-6`}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid gap-3">
              <Skeleton className="h-6 w-60" />
              <CardSkeletonRail />
            </div>
          ))}
        </div>
      ) : (
        <div aria-busy={page.isFetching} className={page.isPlaceholderData ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {rows.map((row, i) => (
            <ExploreRow key={`${kind}-${services.join(",")}-${row.id}`} row={row} index={i} services={serviceMap} onOpen={openItem} />
          ))}
          {rows.length === 0 && (
            <div className="mx-4 my-6 rounded-2xl border border-dashed border-divider-strong p-7 text-center text-sm text-text-secondary sm:mx-6 lg:mx-8">
              {libOnly
                ? 'Nothing here is in Campfire yet. Turn off "In Campfire" to see everything.'
                : "Nothing matches those filters. Try another service."}
            </div>
          )}
        </div>
      )}

      <footer className={`flex flex-wrap gap-x-5 gap-y-2 ${PAGE_X} pb-6 pt-7 text-xs text-text-tertiary`}>
        <span>{TMDB_NOTICE}</span>
        <span>Where to watch: JustWatch.</span>
      </footer>

      {panel}
    </main>
  );
}
