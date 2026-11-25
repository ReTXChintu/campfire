import { Link } from "react-router-dom";
import { useExploreTitle } from "../lib/explore";
import type { SourceCheck, TmdbRef } from "../lib/types";
import WhereToWatch from "./explore/WhereToWatch";

const SAID: Record<SourceCheck["result"], string> = {
  found: "has it, but it didn't play",
  none: "doesn't have it",
  unreachable: "didn't answer",
};

/** In place of the player once every source has been tried — or the one it was to play from: what
 * each said, a way to ask for the title, and where else it streams. */
export default function NotInAnySource({
  tmdb,
  title,
  checked,
  only,
  onRetry,
  retrying,
}: {
  tmdb: Pick<TmdbRef, "type" | "id"> | null;
  title: string;
  checked: SourceCheck[];
  /** The one source it was to play from; `allHref` tries them all. */
  only: { name: string; allHref: string } | null;
  onRetry: () => void;
  retrying: boolean;
}) {
  const { data } = useExploreTitle(tmdb?.type ?? null, tmdb?.id ?? null);
  return (
    <div className="grid gap-8 rounded-2xl border border-divider bg-surface p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
      <div className="grid content-start gap-4">
        <h2 className="font-display text-4xl leading-none tracking-wide text-white">
          {only ? `Not found in ${only.name}` : "Not found in any source"}
        </h2>
        <p className="text-text-secondary">
          {title} couldn&apos;t be played. {only ? "It was checked just now:" : "Every source was checked just now:"}
        </p>
        <ul className="grid gap-2">
          {checked.map((c) => (
            <li key={c.name} className="flex items-center gap-3 rounded-xl border border-divider bg-background px-4 py-3 text-sm">
              <span className="font-semibold text-white">{c.name}</span>
              <span className="text-text-tertiary">{SAID[c.result]}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          {only && (
            <Link
              to={only.allHref}
              replace
              className="inline-flex min-h-12 items-center rounded-lg bg-white px-6 text-sm font-bold text-black transition hover:bg-white/85"
            >
              Try all sources
            </Link>
          )}
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className={`min-h-12 rounded-lg px-6 text-sm font-bold transition disabled:opacity-60 ${
              only ? "border border-divider-strong text-white hover:bg-surface-hover" : "bg-white text-black hover:bg-white/85"
            }`}
          >
            {retrying ? "Checking…" : "Check again"}
          </button>
        </div>
      </div>
      {data && <WhereToWatch d={data} />}
    </div>
  );
}
