import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import Poster from "./Poster";
import MetaLine from "./MetaLine";
import OpinionButtons from "./OpinionButtons";
import TitleWordmark from "./TitleWordmark";
import { useAuthedImage } from "../hooks/useAuthedImage";
import { PAGE_X } from "../lib/layout";
import type { TitleMeta } from "../lib/types";

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
  meta,
  thumbnailPath,
  backHref,
  facts,
  metaExtra,
  actions,
  aside,
}: {
  id: string;
  title: string;
  eyebrow?: string;
  /** Everything TMDb knows about this title: the synopsis, the facts line, the wordmark flag. An
   * unmatched title passes `{}` and the header simply has less on it. */
  meta: TitleMeta;
  thumbnailPath: string | null;
  backHref?: string;
  /** The library's own facts, as the labelled list on the right (seasons, formats, counts). */
  facts: { label: string; value: ReactNode }[];
  /** Extra items for the inline facts line, after the TMDb ones. */
  metaExtra?: ReactNode[];
  actions?: ReactNode;
  aside?: ReactNode;
}) {
  const overview = meta.overview;
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
            <h1>
              <TitleWordmark
                path={meta.hasLogo && thumbnailPath ? `${thumbnailPath}${thumbnailPath.includes("?") ? "&" : "?"}shape=logo` : null}
                title={title}
                className="block font-display text-4xl leading-none tracking-wide text-white sm:text-5xl"
                imageClassName="max-h-20 w-auto max-w-full object-contain object-left sm:max-h-24"
              />
            </h1>
            <MetaLine meta={meta} extra={metaExtra} className="mt-3" />
            {meta.tagline && (
              <p className="mt-2 max-w-[60ch] text-sm italic text-text-tertiary">{meta.tagline}</p>
            )}
            {overview && (
              // Capped in characters per line for reading, not a page-width wrapper.
              <p className="mt-3 line-clamp-4 max-w-[68ch] text-sm leading-relaxed text-text-secondary">{overview}</p>
            )}
            {actions && <div className="mt-5 flex flex-wrap gap-2.5">{actions}</div>}
            <OpinionButtons title={meta.tmdb} className="mt-4" />
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
