import { useState } from "react";
import { useMatchEpisodes, useSetEpisodeNaming, useSetFolderSeason } from "../../hooks/useAdminCatalog";

/**
 * Episode naming for a matched series: name every episode under it from TMDb now, or turn that
 * off. Shown on a series' own admin page, under its artwork.
 *
 * Which season a folder of episodes belongs to is guessed from its name ("Season 2", "S02") — the
 * seasons this can't place are listed here with a box to type the number into, which is the one
 * thing TMDb can't work out on its own.
 */
export default function EpisodeNamingPanel({
  folderId,
  namingOff,
}: {
  folderId: string;
  namingOff: boolean | undefined;
}) {
  const match = useMatchEpisodes(folderId);
  const setNaming = useSetEpisodeNaming(folderId);
  const result = match.data;
  const enabled = !namingOff;

  return (
    <section className="mb-8 rounded-lg border border-divider p-4" aria-labelledby="episodes-heading">
      <h2 id="episodes-heading" className="mb-3 text-sm font-semibold text-white">
        Episode names
      </h2>
      <p className="text-sm text-text-secondary">
        {enabled
          ? "Episodes under this series take their name, synopsis and still from TMDb, matched by position within their season."
          : "Turned off. Episodes keep whatever names they already have."}
      </p>
      <p className="mt-1 text-xs text-text-tertiary">
        An episode whose title you typed yourself is never renamed.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => match.mutate()}
          disabled={match.isPending || !enabled}
          className="rounded-md border border-divider px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/5 disabled:opacity-50"
        >
          {match.isPending ? "Naming…" : "Name episodes now"}
        </button>
        <button
          type="button"
          onClick={() => setNaming.mutate(!enabled)}
          disabled={setNaming.isPending}
          className="rounded-md border border-divider px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/5 disabled:opacity-50"
        >
          {enabled ? "Turn off" : "Turn back on"}
        </button>
      </div>

      <div aria-live="polite">
        {match.error && <p className="mt-2 text-sm text-red-400">{match.error.message}</p>}
        {setNaming.error && <p className="mt-2 text-sm text-red-400">{setNaming.error.message}</p>}
        {result && !match.error && (
          <p className="mt-2 text-sm text-live">
            {result.matched === 0
              ? "No episodes to name — check the season numbers below."
              : `Matched ${result.matched} episode${result.matched === 1 ? "" : "s"}, renaming ${result.renamed}.`}
          </p>
        )}
      </div>

      {result && result.unresolved.length > 0 && (
        <div className="mt-4 border-t border-divider pt-4">
          <p className="text-sm text-text-secondary">
            These folders hold episodes but don&apos;t say which season — set the number and they&apos;ll be named too.
          </p>
          <ul className="mt-3 grid gap-2">
            {result.unresolved.map((folder) => (
              <li key={folder.folderId}>
                <SeasonField seriesFolderId={folderId} folderId={folder.folderId} name={folder.name} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** One "this folder is season N" box. Saving re-matches the whole series straight away. */
export function SeasonField({
  seriesFolderId,
  folderId,
  name,
  initial,
  hint,
}: {
  seriesFolderId: string;
  folderId: string;
  name: string;
  initial?: number | null;
  /** Shown under the box — e.g. that the current number was guessed from the folder's name. */
  hint?: string;
}) {
  const [value, setValue] = useState(initial == null ? "" : String(initial));
  const save = useSetFolderSeason(folderId, seriesFolderId);

  return (
    <div className="rounded-md border border-divider p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <label htmlFor={`season-${folderId}`} className="block truncate text-sm font-semibold text-white">
            {name}
          </label>
          <input
            id={`season-${folderId}`}
            type="number"
            inputMode="numeric"
            min={0}
            max={99}
            placeholder="Season number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
          />
        </div>
        <button
          type="button"
          onClick={() => save.mutate(value.trim() === "" ? null : Number(value))}
          disabled={save.isPending}
          className="rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-text-tertiary">
        {hint ?? "Use 0 for specials. Leave it empty to go back to guessing from the folder's name."}
      </p>
      <div aria-live="polite">
        {save.error && <p className="mt-1.5 text-sm text-red-400">{save.error.message}</p>}
        {save.data && !save.error && (
          <p className="mt-1.5 text-sm text-live">
            Saved — named {save.data.matched} episode{save.data.matched === 1 ? "" : "s"} across the series.
          </p>
        )}
      </div>
    </div>
  );
}
