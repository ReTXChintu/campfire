/** What the browser can actually play: the backend only serves a native (seekable) stream for
 * these containers, everything else is handed off to the desktop/mobile apps. The watch page
 * learns this authoritatively from `video.seekMode`; a catalog list item only carries a mimeType,
 * which is enough to warn before the click. */
const BROWSER_PLAYABLE = ["video/mp4", "video/webm", "video/ogg", "video/stream"];

export function playsInBrowser(mimeType: string): boolean {
  return BROWSER_PLAYABLE.includes(mimeType.split(";")[0].trim().toLowerCase());
}

/** "video/x-matroska" -> "MKV". Deliberately derived from the mimeType the API really sends — the
 * catalog has no resolution or bitrate on a list item, so there is no 4K/1080p badge to show. */
export function formatLabel(mimeType: string): string {
  const subtype = (mimeType.split("/")[1] ?? "").split(";")[0].trim().toLowerCase();
  const known: Record<string, string> = {
    mp4: "MP4",
    webm: "WEBM",
    ogg: "OGG",
    "x-matroska": "MKV",
    "x-msvideo": "AVI",
    quicktime: "MOV",
    "x-ms-wmv": "WMV",
    "x-flv": "FLV",
    mpeg: "MPEG",
  };
  return known[subtype] ?? (subtype.replace(/^x-/, "").toUpperCase() || "VIDEO");
}

/** "23 min left" / "Watched" / null — only ever from a real progress record. */
export function remainingLabel(positionSeconds: number, durationSeconds: number, completed: boolean): string | null {
  if (completed) return "Watched";
  if (!durationSeconds || durationSeconds <= 0) return null;
  const left = Math.max(0, durationSeconds - positionSeconds);
  if (left < 60) return "Almost done";
  const minutes = Math.round(left / 60);
  if (minutes < 90) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min left` : `${hours} h left`;
}

export function durationLabel(durationSeconds: number | null): string | null {
  if (!durationSeconds || durationSeconds <= 0) return null;
  const minutes = Math.round(durationSeconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}
