import type { ReactNode } from "react";
import type { TitleMeta, TmdbRating } from "../lib/types";
import { ratingLabel, ratingTitle, runtimeLabel } from "../lib/tmdbFormat";

/** TMDb's score, as a star and a number. Nothing when the title has no score. */
export function RatingChip({ rating, className = "" }: { rating: TmdbRating | null | undefined; className?: string }) {
  const label = ratingLabel(rating);
  if (!label) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title={ratingTitle(rating)}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-amber" fill="currentColor" aria-hidden="true">
        <path d="M12 2.5l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17.6l-5.9 3.1 1.2-6.6L2.5 9.5l6.6-.9z" />
      </svg>
      <span className="font-semibold text-white">{label}</span>
      <span className="sr-only">out of 10 on TMDb</span>
    </span>
  );
}

/** The age rating, in a box the way a certificate is printed. */
export function CertificateChip({ certificate }: { certificate: string | null | undefined }) {
  if (!certificate) return null;
  return (
    <span className="inline-flex items-center rounded border border-divider-strong px-1.5 py-px text-[11px] font-bold tracking-wide text-white/90">
      {certificate}
    </span>
  );
}

/**
 * The line of facts under a title: score, year, certificate, runtime, genres — whichever of them
 * TMDb actually knows, separated by dots, and nothing at all when it knows none of them. This is
 * the row that makes a detail page read like a catalogue entry rather than a file listing.
 */
export default function MetaLine({
  meta,
  extra,
  className = "",
}: {
  meta: TitleMeta;
  /** Facts the library knows rather than TMDb — "3 seasons", a format label. */
  extra?: ReactNode[];
  className?: string;
}) {
  const runtime = runtimeLabel(meta.runtimeMinutes);
  const genres = meta.genres ?? [];
  // Built by appending only what there is, so no entry can render empty and leave a stray dot.
  const parts: ReactNode[] = [];
  if (ratingLabel(meta.rating)) parts.push(<RatingChip rating={meta.rating} />);
  if (meta.year) parts.push(meta.year);
  if (meta.certificate) parts.push(<CertificateChip certificate={meta.certificate} />);
  if (runtime) parts.push(runtime);
  if (genres.length > 0) parts.push(genres.join(", "));
  for (const node of extra ?? []) if (node) parts.push(node);

  if (parts.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-text-secondary ${className}`}>
      {/* The separator rides with the item *before* it, so a line that wraps begins with a fact
          rather than a stray dot — which on a phone otherwise reads as a bullet list. */}
      {parts.map((node, i) => (
        <span key={i} className="inline-flex items-center gap-2.5">
          {node}
          {i < parts.length - 1 && (
            <span className="text-text-tertiary" aria-hidden="true">
              ·
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
