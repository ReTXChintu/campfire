/** One "Up next" choice — see apps/backend/src/lib/upNext.ts. */
export type UpNextItem = {
  kind: "episode" | "suggestion";
  /** The video to play — for a suggested series, its first episode. */
  fileId: string;
  title: string;
  /** "S2 E1 · House of the Dragon", or a suggestion's reason ("With Matt Smith"). */
  subtitle: string | null;
  /** Backend image path: an episode's still, or the suggested title's artwork. */
  imagePath: string;
  overview: string | null;
  /** A suggested series' own page; null for an episode or a film. */
  infoHref: string | null;
};

/**
 * How many titles in a row have started on their own with nobody touching the player. Module
 * scope, so it survives the player remounting for the next title. After UP_NEXT_STREAK_LIMIT the
 * next one waits for "Still watching?" — the same rule as the apps (widgets/up_next.dart).
 */
let autoplayStreak = 0;
export const UP_NEXT_STREAK_LIMIT = 2;
export const getAutoplayStreak = () => autoplayStreak;
export const bumpAutoplayStreak = () => {
  autoplayStreak++;
};
export const resetAutoplayStreak = () => {
  autoplayStreak = 0;
};

/** Seconds before an episode starts on its own; a different title gets longer to be turned down. */
export const upNextCountdownSeconds = (item: UpNextItem) => (item.kind === "episode" ? 10 : 15);

const AUTOPLAY_KEY = "campfire-autoplay-next";

export function loadAutoplay(): boolean {
  try {
    return localStorage.getItem(AUTOPLAY_KEY) !== "0";
  } catch {
    return true;
  }
}

export function saveAutoplay(on: boolean): void {
  try {
    localStorage.setItem(AUTOPLAY_KEY, on ? "1" : "0");
  } catch {
    // Private mode or blocked storage: the switch just doesn't persist.
  }
}

/** Where the card appears: the credits when they're known, else 25 seconds from the end. */
export function upNextAt(outroStart: number | null, duration: number | null): number | null {
  if (outroStart != null && (duration == null || outroStart < duration)) return outroStart;
  if (duration == null || duration < 90) return null;
  return duration - 25;
}
