import { useExploreTitle } from "../lib/explore";
import type { TmdbRef, ViewerSource } from "../lib/types";
import { SOURCE_CHOICE, SourceChoiceLabel } from "./SourceChoice";
import WhereToWatch from "./explore/WhereToWatch";

/** In place of the player: the sources to pick from, when none is picked yet or the one that was
 * doesn't have the title or couldn't play it. */
export default function SourcePanel({
  title,
  tmdb,
  sources,
  failed,
  onSelect,
}: {
  title: string;
  tmdb: Pick<TmdbRef, "type" | "id"> | null;
  sources: ViewerSource[];
  /** The one that didn't play it; null when none is picked yet. */
  failed: ViewerSource | null;
  onSelect: (id: string) => void;
}) {
  const others = sources.filter((s) => s.id !== failed?.id);
  // Where else it streams only matters once a source hasn't got it.
  const { data } = useExploreTitle(failed ? (tmdb?.type ?? null) : null, tmdb?.id ?? null);
  return (
    <div
      className={`grid gap-8 rounded-2xl border border-divider bg-surface p-5 sm:p-8 ${
        data ? "lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]" : ""
      }`}
    >
      <div className="grid content-start gap-5">
        <div>
          <h2 className="font-display text-4xl leading-none tracking-wide text-white" role={failed ? "alert" : undefined}>
            {failed ? "Not found here" : "Play from"}
          </h2>
          <p className="mt-2 text-text-secondary">
            {failed
              ? `${title} didn't play from ${failed.name}.${others.length > 0 ? " Try another source." : ""}`
              : title}
          </p>
        </div>
        {others.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {others.map((source) => (
              <li key={source.id}>
                <button type="button" onClick={() => onSelect(source.id)} className={SOURCE_CHOICE}>
                  <SourceChoiceLabel name={source.name} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {failed && (
          <div>
            <button
              type="button"
              onClick={() => onSelect(failed.id)}
              className="min-h-11 rounded-lg border border-divider-strong px-5 text-sm font-semibold text-white transition hover:bg-surface-hover"
            >
              Try {failed.name} again
            </button>
          </div>
        )}
      </div>
      {data && <WhereToWatch d={data} />}
    </div>
  );
}
