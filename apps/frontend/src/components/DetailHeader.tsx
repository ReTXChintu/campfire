import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Poster from "./Poster";
import { useAuthedImage } from "../hooks/useAuthedImage";
import { PAGE_X } from "../lib/layout";

/** The blurred backdrop behind a detail header — the same artwork as the poster, scaled up and
 * faded out, so the page has a sense of place without a second image to fetch. */
function Backdrop({ path }: { path: string | null }) {
  const { url } = useAuthedImage(path);
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {url && <img src={url} alt="" className="h-full w-full scale-110 object-cover opacity-30 blur-2xl" />}
      <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/30" />
    </div>
  );
}

/**
 * The header a series or collection page opens with: backdrop, poster, title, the facts the API
 * really knows, and the primary action. Full width, three columns from `lg` down to one on a
 * phone.
 */
export default function DetailHeader({
  id,
  title,
  eyebrow,
  overview,
  thumbnailPath,
  backHref,
  facts,
  actions,
  aside,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  /** A synopsis, when the title is matched on TMDb. */
  overview?: string | null;
  thumbnailPath: string | null;
  backHref?: string;
  facts: { label: string; value: ReactNode }[];
  actions?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="relative border-b border-divider">
      <Backdrop path={thumbnailPath} />
      <div className={`relative ${PAGE_X} py-7`}>
        {backHref && (
          <Link
            to={backHref}
            className="mb-5 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-text-secondary transition hover:bg-surface hover:text-white"
          >
            <span aria-hidden="true">&larr;</span> Back
          </Link>
        )}
        <div className="grid gap-7 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
          <div className="max-w-[180px] lg:max-w-none">
            <Poster path={thumbnailPath} title={title} id={id} />
          </div>

          <div className="min-w-0">
            {eyebrow && (
              <p className="font-display text-xs tracking-[0.16em] text-text-tertiary uppercase">{eyebrow}</p>
            )}
            <h1 className="font-display text-4xl leading-none tracking-wide text-white sm:text-5xl">{title}</h1>
            {overview && (
              // Capped in characters per line for reading, not a page-width wrapper.
              <p className="mt-3 line-clamp-4 max-w-[68ch] text-sm leading-relaxed text-text-secondary">{overview}</p>
            )}
            {actions && <div className="mt-5 flex flex-wrap gap-2.5">{actions}</div>}
            {aside && <div className="mt-5">{aside}</div>}
          </div>

          {facts.length > 0 && (
            <dl className="grid content-start gap-2.5">
              {facts.map((fact) => (
                <div
                  key={fact.label}
                  className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-divider pb-2.5 text-sm"
                >
                  <dt className="text-text-tertiary">{fact.label}</dt>
                  <dd className="min-w-0 text-white">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </header>
  );
}
