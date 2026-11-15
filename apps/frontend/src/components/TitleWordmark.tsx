import { useAuthedImage } from "../hooks/useAuthedImage";

/**
 * A title's own wordmark, with the title set in type as the fallback.
 *
 * The backend 404s `?shape=logo` for anything it has no wordmark for, so `failed` is the normal
 * case rather than an error — and until the request settles we show the text, because a heading
 * that appears a beat late reads as a bug while one that is replaced by the real logo does not.
 */
export default function TitleWordmark({
  path,
  title,
  className = "",
  imageClassName = "",
}: {
  /** The title's logo path, or null when the backend says it has none. */
  path: string | null | undefined;
  title: string;
  /** Applied to the text fallback (so it can carry the display font and size). */
  className?: string;
  /** Applied to the image (height and max-width — a wordmark's aspect ratio varies wildly). */
  imageClassName?: string;
}) {
  const { url } = useAuthedImage(path ?? null);
  if (url) {
    // The <img> carries the title as its alt text, so the heading still reads correctly aloud.
    return <img src={url} alt={title} className={imageClassName} />;
  }
  return <span className={className}>{title}</span>;
}
