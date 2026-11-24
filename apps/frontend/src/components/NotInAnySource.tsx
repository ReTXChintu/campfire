import { useExploreTitle } from "../lib/explore";
import { titleOfId } from "../lib/play";
import type { SourceCheck } from "../lib/types";
import WhereToWatch from "./explore/WhereToWatch";

const SAID: Record<SourceCheck["result"], string> = {
  found: "has it, but it didn't play",
  none: "doesn't have it",
  unreachable: "didn't answer",
};

/** In place of the player once every source has been tried: what each one said, a way to ask for the
 * title, and where else it streams. */
export default function NotInAnySource({
  fileId,
  title,
  checked,
  onRetry,
  retrying,
}: {
  fileId: string;
  title: string;
  checked: SourceCheck[];
  onRetry: () => void;
  retrying: boolean;
}) {
  const ref = titleOfId(fileId);
  const { data } = useExploreTitle(ref?.type ?? null, ref?.id ?? null);
  return (
    <div className="grid gap-8 rounded-2xl border border-divider bg-surface p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
      <div className="grid content-start gap-4">
        <h2 className="font-display text-4xl leading-none tracking-wide text-white">Not found in any source</h2>
        <p className="text-text-secondary">
          {title} couldn&apos;t be played. Every source was checked just now:
        </p>
        <ul className="grid gap-2">
          {checked.map((c) => (
            <li key={c.name} className="flex items-center gap-3 rounded-xl border border-divider bg-background px-4 py-3 text-sm">
              <span className="font-semibold text-white">{c.name}</span>
              <span className="text-text-tertiary">{SAID[c.result]}</span>
            </li>
          ))}
        </ul>
        <div>
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="min-h-12 rounded-lg bg-white px-6 text-sm font-bold text-black transition hover:bg-white/85 disabled:opacity-60"
          >
            {retrying ? "Checking…" : "Check again"}
          </button>
        </div>
      </div>
      {data && <WhereToWatch d={data} />}
    </div>
  );
}
