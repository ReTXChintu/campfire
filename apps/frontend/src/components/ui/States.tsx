import type { ReactNode } from "react";

/** A skeleton block. Always sized at the real dimensions of the thing it stands in for, so the
 * layout doesn't jump when the data lands. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-xl ${className}`} aria-hidden="true" />;
}

/** A grid of card-shaped skeletons at the exact poster ratio the real cards use. */
export function CardSkeletonGrid({ count = 10, label = "Loading" }: { count?: number; label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7"
    >
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="grid gap-2.5">
          <Skeleton className="aspect-[2/3] w-full" />
          <Skeleton className="h-3.5 w-4/5 rounded" />
          <Skeleton className="h-3 w-2/5 rounded" />
        </div>
      ))}
    </div>
  );
}

/** A rail of card-shaped skeletons, matching the rail's own card width. */
export function CardSkeletonRail({ count = 7 }: { count?: number }) {
  return (
    <div className="flex gap-4 overflow-hidden" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="grid w-[150px] shrink-0 gap-2.5 sm:w-[176px]">
          <Skeleton className="aspect-[2/3] w-full" />
          <Skeleton className="h-3.5 w-4/5 rounded" />
        </div>
      ))}
    </div>
  );
}

/** An empty state: one line of explanation and exactly one action. Short, centred copy is the one
 * thing the full-width rule exempts. */
export function EmptyState({
  title,
  message,
  action,
  icon,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-md place-items-center gap-3 py-16 text-center">
      {icon && (
        <div className="grid h-13 w-13 place-items-center rounded-xl bg-surface text-text-tertiary">{icon}</div>
      )}
      <h2 className="font-display text-2xl tracking-wide text-white">{title}</h2>
      {message && <p className="text-sm text-text-secondary">{message}</p>}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

/** An inline error card with a Retry that actually refetches. Never a dead end, and never a bare
 * red sentence. */
export function ErrorCard({
  title = "That didn't load",
  message,
  onRetry,
  retrying,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-start gap-3 rounded-xl border border-danger/35 bg-danger-soft p-4"
    >
      <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-danger" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16h.01" />
      </svg>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{title}</p>
        {message && <p className="mt-0.5 text-sm text-text-secondary">{message}</p>}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="min-h-9 rounded-lg border border-divider-strong px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-surface-hover disabled:opacity-60"
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}
