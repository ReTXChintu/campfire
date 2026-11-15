import { useAuthedImage } from "../../hooks/useAuthedImage";

/** Deterministic hue per request id, so the same request always gets the same placeholder colour
 * (lifted from the prototype's `hue()` — a stable colour reads as identity, a random one as noise). */
function hueFor(id: string): number {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) % 360;
  return (n * 7) % 360;
}

function initialFor(title: string): string {
  return (title.replace(/^(the|a|an)\s+/i, "").trim().charAt(0) || "?").toUpperCase();
}

/** An uploaded reference image is Bearer-gated (`/api/request-image/<id>`), which a bare `<img
 * src>` can't fetch — it goes through useAuthedImage like every other authed image on web. A
 * `refMeta.posterUrl` is a public TMDB URL instead, so that one is a plain `<img>`. */
function AuthedReferenceImage({ path, alt, className }: { path: string; alt: string; className: string }) {
  const { url, failed } = useAuthedImage(path);
  if (failed) return null;
  if (!url) return <div className={`${className} animate-pulse bg-surface-hover`} />;
  return <img src={url} alt={alt} className={`${className} object-cover`} />;
}

export default function RequestPoster({
  id,
  title,
  refImagePath,
  posterUrl,
  className = "",
  ratio = "aspect-[2/3]",
}: {
  id: string;
  title: string;
  refImagePath?: string | null;
  posterUrl?: string | null;
  className?: string;
  /** The gradient placeholder keeps the poster ratio; override for a wide still. */
  ratio?: string;
}) {
  const shell = `relative w-full overflow-hidden rounded-lg ${ratio} ${className}`;

  if (refImagePath) {
    return (
      <div className={shell}>
        <AuthedReferenceImage path={refImagePath} alt={`Reference image for ${title}`} className="h-full w-full" />
      </div>
    );
  }

  if (posterUrl) {
    return (
      <div className={shell}>
        <img src={posterUrl} alt={`Poster for ${title}`} className="h-full w-full object-cover" />
      </div>
    );
  }

  const h = hueFor(id);
  return (
    <div
      className={`${shell} grid place-items-center`}
      style={{
        background: `linear-gradient(160deg, hsl(${h} 46% 26%) 0%, hsl(${h} 34% 13%) 55%, #0c0b0a 100%)`,
      }}
      aria-hidden="true"
    >
      <span className="font-display text-5xl leading-none tracking-wide text-white/15">{initialFor(title)}</span>
    </div>
  );
}
