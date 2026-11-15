import { useState, type FormEvent } from "react";
import { useArtworkAction, useUseTmdbTitle, type ArtworkKind } from "../../hooks/useAdminCatalog";
import { useAuthedImage } from "../../hooks/useAuthedImage";
import type { CatalogArtwork } from "../../lib/types";
import { ratingLabel, runtimeLabel } from "../../lib/tmdbFormat";

/**
 * Artwork for a top-level movie or series: what it's matched to on TMDb, the image viewers see,
 * and the three ways to change it — paste an IMDb/TMDb link, search automatically, or remove.
 * Viewers get the image through the same thumbnail routes as before, so nothing else changes.
 */
/**
 * What came back with the match, so an admin can see at a glance whether it's the right title and
 * what viewers will now see on its page. A title matched by an older backend has none of these
 * fields; the next automatic run tops it up, and meanwhile this just shows less.
 */
function MatchedFacts({ artwork }: { artwork: CatalogArtwork }) {
  const runtime = runtimeLabel(artwork.runtimeMinutes);
  const facts = [
    ratingLabel(artwork.rating) ? `★ ${ratingLabel(artwork.rating)}` : null,
    artwork.certificate,
    runtime,
    artwork.genres?.length ? artwork.genres.join(", ") : null,
    artwork.tmdbType === "tv" && artwork.seasonCount
      ? `${artwork.seasonCount} season${artwork.seasonCount === 1 ? "" : "s"} on TMDb`
      : null,
    artwork.cast?.length ? `${artwork.cast.length} cast` : null,
    artwork.logoPath ? "wordmark" : null,
  ].filter((fact): fact is string => !!fact);

  if (facts.length === 0) {
    return (
      <p className="mt-1.5 text-xs text-text-tertiary">
        Matched before this version, so there are no details yet — &ldquo;Find automatically&rdquo; fetches them.
      </p>
    );
  }
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
      {facts.map((fact, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden="true">·</span>}
          {fact}
        </span>
      ))}
    </p>
  );
}

export default function ArtworkPanel({
  kind,
  id,
  artwork,
  autoOff,
  hasDriveThumbnail,
  currentTitle,
}: {
  kind: ArtworkKind;
  id: string;
  artwork: CatalogArtwork | null | undefined;
  autoOff: boolean | undefined;
  /** A folder with its own thumbnail.* image in Drive. */
  hasDriveThumbnail: boolean;
  /** What this title is called now, so the panel can offer TMDb's name when they differ. */
  currentTitle: string | null;
}) {
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const action = useArtworkAction(kind, id);
  const useTitle = useUseTmdbTitle(kind, id);
  // A match only renames a raw filename when the two are plainly the same title, so a hand-typed
  // name (and anything less clear-cut) is still sitting here waiting to be asked about.
  const titleDiffers = !!artwork && !!currentTitle && currentTitle.trim() !== artwork.title.trim();

  // The image routes are cached for an hour; a version in the query makes the preview follow a
  // change immediately (the server ignores it).
  const version = artwork?.matchedAt ?? (autoOff ? "off" : "none");
  const imagePath = `${kind === "folder" ? "/api/thumbnail-folder" : "/api/thumbnail"}/${id}?v=${encodeURIComponent(version)}`;
  const { url, failed } = useAuthedImage(imagePath);

  const run = (input: Parameters<typeof action.mutate>[0], done: string) => {
    setNotice(null);
    action.mutate(input, {
      onSuccess: () => {
        setNotice(done);
        if (input.type === "link") setLink("");
      },
    });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (link.trim()) run({ type: "link", link: link.trim() }, "Artwork updated from the link.");
  };

  // TMDb artwork wins whenever there is some; the Drive image is only the fallback.
  const showingDrive = kind === "folder" && hasDriveThumbnail && !artwork;
  const tmdbUrl = artwork ? `https://www.themoviedb.org/${artwork.tmdbType}/${artwork.tmdbId}` : null;

  return (
    <section className="mb-8 rounded-lg border border-divider p-4" aria-labelledby="artwork-heading">
      <h2 id="artwork-heading" className="mb-3 text-sm font-semibold text-white">
        Artwork
      </h2>
      <div className="grid gap-5 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="relative aspect-video overflow-hidden rounded-md border border-divider bg-surface">
          {url ? (
            <img src={url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center px-4 text-center text-xs text-text-tertiary">
              {failed ? "No image yet" : "Loading…"}
            </div>
          )}
        </div>

        <div className="min-w-0">
          {artwork ? (
            <p className="text-sm text-text-secondary">
              Matched to{" "}
              <a href={tmdbUrl!} target="_blank" rel="noreferrer" className="text-white underline-offset-2 hover:underline">
                {artwork.title}
                {artwork.year ? ` (${artwork.year})` : ""}
              </a>{" "}
              on TMDb · {artwork.source === "link" ? "from a pasted link" : "found automatically"}
            </p>
          ) : (
            <p className="text-sm text-text-secondary">
              {autoOff
                ? "Artwork removed. It won't be matched automatically again."
                : "Not matched yet. Paste the title's IMDb or TMDb link, or search for it."}
            </p>
          )}
          {showingDrive && (
            <p className="mt-1 text-xs text-text-tertiary">
              Until it&apos;s matched, viewers see the thumbnail image in this folder in Drive.
            </p>
          )}
          {artwork && <MatchedFacts artwork={artwork} />}
          {artwork?.overview && (
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-text-tertiary">{artwork.overview}</p>
          )}

          <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label htmlFor={`artwork-link-${id}`} className="sr-only">
              IMDb or TMDb link
            </label>
            <input
              id={`artwork-link-${id}`}
              type="url"
              inputMode="url"
              placeholder="https://www.imdb.com/title/tt…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
            />
            <button
              type="submit"
              disabled={action.isPending || !link.trim()}
              className="rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
            >
              Use link
            </button>
          </form>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => run({ type: "auto" }, "Matched automatically.")}
              disabled={action.isPending}
              className="rounded-md border border-divider px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/5 disabled:opacity-50"
            >
              {action.isPending && action.variables?.type === "auto" ? "Searching…" : "Find automatically"}
            </button>
            {titleDiffers && (
              <button
                type="button"
                onClick={() => useTitle.mutate()}
                disabled={useTitle.isPending}
                className="rounded-md border border-divider px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/5 disabled:opacity-50"
              >
                {useTitle.isPending ? "Renaming…" : `Rename to "${artwork!.title}"`}
              </button>
            )}
            {artwork && (
              <button
                type="button"
                onClick={() => run({ type: "remove" }, "Artwork removed.")}
                disabled={action.isPending}
                className="rounded-md border border-divider px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/5 disabled:opacity-50"
              >
                Remove
              </button>
            )}
          </div>

          <div aria-live="polite">
            {useTitle.error && <p className="mt-2 text-sm text-red-400">{useTitle.error.message}</p>}
            {useTitle.data && !useTitle.error && (
              <p className="mt-2 text-sm text-live">Renamed to &ldquo;{useTitle.data.to}&rdquo;.</p>
            )}
            {action.error && <p className="mt-2 text-sm text-red-400">{action.error.message}</p>}
            {notice && !action.error && <p className="mt-2 text-sm text-live">{notice}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
