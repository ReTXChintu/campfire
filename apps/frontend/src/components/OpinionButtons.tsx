import type { ReactNode } from "react";
import { useOpinion, useSetOpinion, type Rating, type TitleRef } from "../lib/opinions";

const THUMB = "M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3zm0 0l4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7";

function Icon({ children, flipped = false }: { children: ReactNode; flipped?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-4 w-4 ${flipped ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function Toggle({
  label,
  on,
  tone,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  tone: "live" | "accent" | "danger";
  onClick: () => void;
  children: ReactNode;
}) {
  const active = {
    live: "border-live bg-live/15 text-live",
    accent: "border-accent bg-accent-soft text-amber",
    danger: "border-danger bg-danger/15 text-danger",
  }[tone];
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3.5 text-sm font-semibold transition ${
        on ? active : "border-divider-strong text-white hover:bg-surface-hover"
      }`}
    >
      {children}
      {label}
    </button>
  );
}

/** Watched it, liked it, didn't: for a film or a whole series, whether or not it's in the library.
 * What's set here shapes the For you rows on Home. Nothing for a title TMDb doesn't have. */
export default function OpinionButtons({ title, className = "" }: { title: TitleRef | null | undefined; className?: string }) {
  if (!title) return null;
  return <Buttons title={title} className={className} />;
}

function Buttons({ title, className }: { title: TitleRef; className: string }) {
  const opinion = useOpinion(title);
  const set = useSetOpinion(title);
  const watched = !!opinion?.watched;
  const rate = (rating: Rating) => set.mutate({ rating: opinion?.rating === rating ? null : rating });

  return (
    <div className={className}>
      <div role="group" aria-label="Your opinion" className="flex flex-wrap items-center gap-2">
        <Toggle label="Watched" on={watched} tone="live" onClick={() => set.mutate({ watched: !watched })}>
          <Icon>
            <polyline points="4 12 9 17 20 6" />
          </Icon>
        </Toggle>
        <Toggle label="Like" on={opinion?.rating === "like"} tone="accent" onClick={() => rate("like")}>
          <Icon>
            <path d={THUMB} />
          </Icon>
        </Toggle>
        <Toggle label="Dislike" on={opinion?.rating === "dislike"} tone="danger" onClick={() => rate("dislike")}>
          <Icon flipped>
            <path d={THUMB} />
          </Icon>
        </Toggle>
      </div>
      {set.isError && (
        <p role="alert" className="mt-2 text-sm text-danger">
          That wasn't saved. Try again.
        </p>
      )}
    </div>
  );
}
