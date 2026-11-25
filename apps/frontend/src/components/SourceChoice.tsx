/** One source to play from, as a link or a button. */
export const SOURCE_CHOICE =
  "group flex min-h-16 w-full items-center gap-4 rounded-xl border border-divider bg-surface px-4 py-3 text-left transition hover:border-white/40 hover:bg-surface-hover";

export function SourceChoiceLabel({ name }: { name: string }) {
  return (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-black transition group-hover:bg-accent">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
          <polygon points="8,5 19,12 8,19" />
        </svg>
      </span>
      <span className="min-w-0 truncate text-sm font-bold text-white">
        <span className="sr-only">Play from </span>
        {name}
      </span>
    </>
  );
}
