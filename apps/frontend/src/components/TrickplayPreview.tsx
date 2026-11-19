import { API_URL } from "../lib/api";
import { tileAt, type TrickplayManifest } from "../lib/trickplay";

const WIDTH = 192; // CSS px; the sheets' own tile size, so no scaling on a 1× screen

/** One frame cut from its sprite sheet, with the time under it — floated above the seek bar.
 * Drawn as a CSS background, so the sheet URL carries the video's media token (an element style
 * can't send an Authorization header). */
export default function TrickplayPreview({
  fileId,
  manifest,
  seconds,
  mediaToken,
  label,
}: {
  fileId: string;
  manifest: TrickplayManifest;
  seconds: number;
  mediaToken: string;
  label: string;
}) {
  const tile = tileAt(manifest, seconds);
  const scale = WIDTH / manifest.tileWidth;
  const height = Math.round(manifest.tileHeight * scale);
  const url = `${API_URL}/api/trickplay/${encodeURIComponent(fileId)}/sheet/${tile.sheet}?token=${encodeURIComponent(mediaToken)}`;
  return (
    <div className="overflow-hidden rounded-lg border border-white/20 bg-black/90 shadow-2xl">
      <div
        aria-hidden
        style={{
          width: WIDTH,
          height,
          backgroundImage: `url("${url}")`,
          backgroundSize: `${manifest.columns * WIDTH}px ${manifest.rows * height}px`,
          backgroundPosition: `-${tile.column * WIDTH}px -${tile.row * height}px`,
          backgroundRepeat: "no-repeat",
        }}
      />
      <div className="py-1 text-center text-xs font-semibold tabular-nums text-white">{label}</div>
    </div>
  );
}
