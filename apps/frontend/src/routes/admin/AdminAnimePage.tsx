import { useState } from "react";
import AdminShell from "../../components/admin/AdminShell";
import { EmptyState, ErrorCard, Skeleton } from "../../components/ui/States";
import {
  parseTmdbTitle,
  useAnimeLink,
  useAnimeTitles,
  useRecheckAnime,
  useResetAnime,
  useSetAnime,
  type AnimeLink,
  type AnimeSegment,
  type AnimeType,
} from "../../lib/anilist";

const ORIGIN: Record<AnimeLink["origin"], string> = {
  map: "From the mapping file, checked by air dates",
  match: "Found by AniList search (Japanese title and first air date)",
  none: "Not on AniList",
};

const INPUT = "min-h-10 w-full rounded-lg border border-divider-strong bg-background px-2.5 text-sm text-white";
const BUTTON = "min-h-10 rounded-lg border border-divider-strong px-4 text-sm font-semibold text-white transition hover:bg-surface-hover disabled:opacity-50";
const PRIMARY = "min-h-10 rounded-lg bg-accent px-4 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50";

const anilistHref = (id: number) => `https://anilist.co/anime/${id}`;

/** Anime titles as AniList knows them: which AniList entry and episode each TMDb episode is, for players
 * that take an AniList id. Every title played is worked out by itself; this is for checking one and
 * putting right the odd one it gets wrong. */
export default function AdminAnimePage() {
  const { data, isLoading, error, refetch, isFetching } = useAnimeTitles();
  const [lookup, setLookup] = useState("");
  const [open, setOpen] = useState<{ type: AnimeType; tmdbId: string } | null>(null);
  const parsed = parseTmdbTitle(lookup);

  return (
    <AdminShell
      section="anime"
      title="Anime"
      description="Players that take an AniList id get the AniList season and episode each TMDb episode is. Titles show up here once they've been played or looked up."
    >
      <div className={`grid gap-6 ${open ? "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]" : ""}`}>
        <div className={`grid min-w-0 content-start items-start gap-6 ${open ? "" : "lg:grid-cols-2"}`}>
          <section className="rounded-2xl border border-divider bg-surface p-5">
            <h2 className="mb-3 font-display text-xl tracking-wide text-white">Look up a title</h2>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (parsed) setOpen(parsed);
              }}
            >
              <input
                aria-label="TMDb link"
                value={lookup}
                onChange={(event) => setLookup(event.target.value)}
                placeholder="themoviedb.org/tv/85937 or movie 372058"
                className={INPUT}
              />
              <button type="submit" disabled={!parsed} className={PRIMARY}>
                Open
              </button>
            </form>
          </section>

          <section className="rounded-2xl border border-divider bg-surface p-5">
            <h2 className="mb-3 font-display text-xl tracking-wide text-white">
              Titles looked at{data ? ` (${data.length})` : ""}
            </h2>
            {error && <ErrorCard title="The titles did not load" message={error.message} onRetry={() => refetch()} retrying={isFetching} />}
            {isLoading && <Skeleton className="h-28" />}
            {data?.length === 0 && <EmptyState title="None yet" message="An anime title shows up here once someone plays it." />}
            <ul className="grid gap-1">
              {data?.map((t) => {
                const selected = open?.type === t.type && open.tmdbId === t.tmdbId;
                return (
                  <li key={`${t.type}-${t.tmdbId}`} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => setOpen({ type: t.type, tmdbId: t.tmdbId })}
                      aria-current={selected}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-hover ${selected ? "bg-surface-hover" : ""}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-white">{t.title}</span>
                        <span className="block truncate text-xs text-text-tertiary">
                          {t.type === "tv" ? "Series" : "Film"} · {ORIGIN[t.origin]}
                        </span>
                      </span>
                      {t.admin && (
                        <span className="shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white">
                          {t.admin === "off" ? "Off" : "Set by hand"}
                        </span>
                      )}
                      {t.problems > 0 && (
                        <span className="shrink-0 rounded-md bg-amber/15 px-2 py-0.5 text-[11px] font-semibold text-amber">
                          {t.problems} to check
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {open && (
          <section className="min-w-0 self-start rounded-2xl border border-divider bg-surface p-5">
            <LinkEditor key={`${open.type}-${open.tmdbId}`} title={open} />
          </section>
        )}
      </div>
    </AdminShell>
  );
}

function LinkEditor({ title }: { title: { type: AnimeType; tmdbId: string } }) {
  const { data: link, isLoading, error, refetch, isFetching } = useAnimeLink(title);
  const recheck = useRecheckAnime();
  const set = useSetAnime();
  const reset = useResetAnime();
  const [editing, setEditing] = useState<AnimeSegment[] | null>(null);
  const [movie, setMovie] = useState("");

  if (isLoading) return <Skeleton className="h-64" />;
  if (error || !link) {
    return <ErrorCard title="That title did not load" message={error?.message} onRetry={() => refetch()} retrying={isFetching} />;
  }
  const busy = recheck.isPending || set.isPending || reset.isPending;
  const failure = recheck.error ?? set.error ?? reset.error;
  const segments = link.admin?.segments ?? link.segments;
  const film = link.admin?.movie ?? link.movie;
  const entry = (id: number) => link.entries.find((e) => e.id === id);

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl tracking-wide text-white">{link.title}</h2>
          <p className="mt-1 text-sm text-text-secondary">
            <a
              href={`https://www.themoviedb.org/${link.type}/${link.tmdbId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-2 hover:underline"
            >
              TMDb {link.type} {link.tmdbId}
            </a>{" "}
            · {ORIGIN[link.origin]} · checked {new Date(link.builtAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => recheck.mutate(title)} className={BUTTON}>
            {recheck.isPending ? "Checking…" : "Check again"}
          </button>
          {link.admin ? (
            <button type="button" disabled={busy} onClick={() => reset.mutate(title)} className={BUTTON}>
              Use the automatic one
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={() => set.mutate({ ...title, body: { off: true } })} className={BUTTON}>
              Turn off
            </button>
          )}
        </div>
      </div>

      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure.message}
        </p>
      )}
      {link.admin?.off && (
        <p className="rounded-lg border border-divider-strong bg-white/5 px-3 py-2.5 text-sm text-white">
          Turned off: players that take an AniList id aren't offered for this title.
        </p>
      )}
      {link.admin && !link.admin.off && (
        <p className="rounded-lg border border-divider-strong bg-white/5 px-3 py-2.5 text-sm text-white">
          Set by hand: kept as it is until you go back to the automatic one.
        </p>
      )}
      {link.problems.length > 0 && (
        <div className="rounded-lg border border-amber/30 bg-amber/10 px-3 py-2.5 text-sm text-amber">
          <p className="font-semibold">Worth a look (these episodes get no anime player)</p>
          <ul className="mt-1 list-disc pl-5">
            {link.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {link.type === "movie" ? (
        <section className="grid gap-3">
          <p className="text-sm text-text-secondary">
            {film ? (
              <>
                Plays as{" "}
                <a href={anilistHref(film)} target="_blank" rel="noopener noreferrer" className="text-white underline-offset-2 hover:underline">
                  {entry(film)?.title ?? `AniList ${film}`} ({film})
                </a>
                , episode 1.
              </>
            ) : (
              "No AniList entry."
            )}
          </p>
          <form
            className="flex max-w-md gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const id = Number(movie);
              if (Number.isInteger(id) && id > 0) set.mutate({ ...title, body: { movie: id } });
            }}
          >
            <input
              aria-label="AniList id"
              inputMode="numeric"
              value={movie}
              onChange={(event) => setMovie(event.target.value.replace(/\D/g, ""))}
              placeholder="AniList id"
              className={INPUT}
            />
            <button type="submit" disabled={busy || !movie} className={PRIMARY}>
              Set
            </button>
          </form>
        </section>
      ) : editing ? (
        <SegmentEditor
          rows={editing}
          onChange={setEditing}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={() => set.mutate({ ...title, body: { segments: editing } }, { onSuccess: () => setEditing(null) })}
        />
      ) : (
        <section className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-lg tracking-wide text-white">Episodes</h3>
            <button type="button" disabled={busy} onClick={() => setEditing(segments.map((s) => ({ ...s })))} className={BUTTON}>
              Edit
            </button>
          </div>
          {segments.length === 0 ? (
            <p className="text-sm text-text-tertiary">No episode is matched to AniList.</p>
          ) : (
            // Columns on a wide screen; on a phone each row stacks.
            <ul className="divide-y divide-divider text-sm">
              <li aria-hidden="true" className="hidden gap-3 pb-2 text-xs uppercase tracking-wider text-text-tertiary sm:grid sm:grid-cols-[7rem_minmax(0,1fr)_8rem]">
                <span className="font-semibold">TMDb</span>
                <span className="font-semibold">AniList entry</span>
                <span className="font-semibold">AniList episodes</span>
              </li>
              {segments.map((s) => {
                const e = entry(s.anilistId);
                const tmdb = `S${s.season} E${s.from}${s.to > s.from ? `–${s.to}` : ""}`;
                const theirs = `${s.from + s.shift}${s.to > s.from ? `–${s.to + s.shift}` : ""}`;
                return (
                  <li key={`${s.season}-${s.from}`} className="grid gap-1 py-2.5 sm:grid-cols-[7rem_minmax(0,1fr)_8rem] sm:gap-3">
                    <span className="whitespace-nowrap font-semibold text-white">
                      {tmdb}
                      <span className="font-normal text-text-tertiary sm:hidden"> → episodes {theirs}</span>
                    </span>
                    <span className="min-w-0">
                      <a href={anilistHref(s.anilistId)} target="_blank" rel="noopener noreferrer" className="break-words text-white underline-offset-2 hover:underline">
                        {e?.title ?? "AniList"} ({s.anilistId})
                      </a>
                      {e && (
                        <span className="block text-xs text-text-tertiary">
                          {[e.format, e.episodes ? `${e.episodes} episodes` : null, e.startDate].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                    <span className="hidden text-white sm:block">{theirs}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

/** Rows typed as "TMDb season, episodes from–to, AniList id, AniList episode of the first". */
function SegmentEditor({
  rows,
  onChange,
  busy,
  onSave,
  onCancel,
}: {
  rows: AnimeSegment[];
  onChange: (rows: AnimeSegment[]) => void;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const update = (i: number, change: Partial<AnimeSegment> & { first?: number }) =>
    onChange(
      rows.map((row, j) => {
        if (j !== i) return row;
        const next = { ...row, ...change };
        // The AniList episode of the first stays put when "from" moves.
        if (change.first !== undefined) next.shift = change.first - next.from;
        else if (change.from !== undefined) next.shift = row.from + row.shift - change.from;
        delete (next as { first?: number }).first;
        return next;
      }),
    );
  const num = (value: string) => (value === "" ? 0 : Number(value.replace(/\D/g, "")));
  const field = (label: string, value: number, set: (n: number) => void) => (
    <label className="grid gap-1 text-xs text-text-tertiary">
      {label}
      <input inputMode="numeric" value={value || ""} onChange={(event) => set(num(event.target.value))} className={INPUT} />
    </label>
  );

  return (
    <section className="grid gap-3">
      <h3 className="font-display text-lg tracking-wide text-white">Episodes, by hand</h3>
      <ul className="grid gap-3">
        {rows.map((row, i) => (
          <li key={i} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-divider p-3 sm:grid-cols-[repeat(5,minmax(0,1fr))_auto]">
            {field("TMDb season", row.season, (n) => update(i, { season: n }))}
            {field("From episode", row.from, (n) => update(i, { from: n }))}
            {field("To episode", row.to, (n) => update(i, { to: n }))}
            {field("AniList id", row.anilistId, (n) => update(i, { anilistId: n }))}
            {field("Its episode for the first", row.from + row.shift, (n) => update(i, { first: n }))}
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="min-h-10 rounded-lg border border-danger/40 px-3 text-sm text-danger transition hover:bg-danger/10"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            const last = rows.at(-1);
            onChange([...rows, { season: last?.season ?? 1, from: (last?.to ?? 0) + 1, to: (last?.to ?? 0) + 1, anilistId: 0, shift: -(last?.to ?? 0) }]);
          }}
          className={BUTTON}
        >
          Add a row
        </button>
        <span className="flex-1" />
        <button type="button" onClick={onCancel} className={BUTTON}>
          Cancel
        </button>
        <button type="button" disabled={busy || rows.length === 0} onClick={onSave} className={PRIMARY}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </section>
  );
}
