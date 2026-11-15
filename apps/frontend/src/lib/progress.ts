import type { LibraryResponse, WatchProgress } from "./types";

/** How much of the bar to fill, 0-100. A finished title is a *full* bar — not the ~95% the
 * completion threshold happens to land on — so "watched" reads at a glance in a grid or list. */
export function progressPercent(progress: Pick<WatchProgress, "positionSeconds" | "durationSeconds" | "completed"> | undefined): number {
  if (!progress) return 0;
  if (progress.completed) return 100;
  if (!(progress.durationSeconds > 0)) return 0;
  return Math.min(100, Math.max(0, (progress.positionSeconds / progress.durationSeconds) * 100));
}

/** Every progress record the library response carries, keyed by fileId: the library's own list
 * (finished titles too) overlaid with Continue Watching. */
export function libraryProgressMap(data: LibraryResponse | undefined): Map<string, WatchProgress> {
  const map = new Map<string, WatchProgress>();
  for (const entry of data?.progress ?? []) map.set(entry.fileId, entry);
  for (const entry of data?.continueWatching ?? []) map.set(entry.progress.fileId, entry.progress);
  return map;
}
