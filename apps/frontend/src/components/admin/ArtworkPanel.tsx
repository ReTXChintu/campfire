import { useState, type FormEvent } from "react";
import { useArtworkAction, type ArtworkKind } from "../../hooks/useAdminCatalog";
import { useAuthedImage } from "../../hooks/useAuthedImage";
import type { CatalogArtwork } from "../../lib/types";

/**
 * Artwork for a top-level movie or series: what it's matched to on TMDb, the image viewers see,
 * and the three ways to change it — paste an IMDb/TMDb link, search automatically, or remove.
 * Viewers get the image through the same thumbnail routes as before, so nothing else changes.
 */
export default function ArtworkPanel({
  kind,
  id,
  artwork,
  autoOff,
  hasDriveThumbnail,
}: {
  kind: ArtworkKind;
  id: string;
  artwork: CatalogArtwork | null | undefined;
  autoOff: boolean | undefined;
  /** A folder with its own thumbnail.* image in Drive. */
  hasDriveThumbnail: boolean;
}) {
  const [link, setLink] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const action = useArtworkAction(kind, id);

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

  const driveWins = kind === "folder" && hasDriveThumbnail && artwork?.source !== "link";
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
          {driveWins && (
            <p className="mt-1 text-xs text-text-tertiary">
              This folder&apos;s own thumbnail image in Drive is shown instead. Paste a link to use TMDb&apos;s artwork.
            </p>
          )}
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
            {action.error && <p className="mt-2 text-sm text-red-400">{action.error.message}</p>}
            {notice && !action.error && <p className="mt-2 text-sm text-live">{notice}</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
