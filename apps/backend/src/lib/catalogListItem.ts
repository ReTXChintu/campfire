// Structurally identical to the old Drive-sourced `DriveListItem`/`DriveVideoItem`/`DriveFolderItem`
// types (see lib/drive.ts) — kept as a separate, catalog-owned type so browsing pages don't depend
// on Drive's shape, even though the card components that render these only ever read `.id`/`.name`.
export type CatalogVideoListItem = { kind: "video"; id: string; name: string; mimeType: string };
export type CatalogFolderListItem = {
  kind: "folder";
  id: string;
  name: string;
  thumbnailFileId: string | null;
};
export type CatalogListItem = CatalogVideoListItem | CatalogFolderListItem;

/** Drive's own listing used `orderBy: "name_natural"` (so "Episode 2" sorts before "Episode 10") —
 * catalog queries have no such built-in ordering, so sort client-side with the numeric-aware
 * comparator to keep the same behavior. */
export function naturalSort<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Episode order within a single folder: items with an explicit `episodeOrder` (set by that
 * folder's publish-rule apply, or manual drag-reorder) sort by it ascending; anything without one
 * falls back to naturalSort and is appended after. Videos-only — folders/seasons never carry
 * episodeOrder, so those listings stay on plain naturalSort. */
export function orderEpisodes<T extends { name: string; episodeOrder: number | null }>(items: T[]): T[] {
  const ordered = items
    .filter((item) => item.episodeOrder != null)
    .sort((a, b) => a.episodeOrder! - b.episodeOrder!);
  const unordered = naturalSort(items.filter((item) => item.episodeOrder == null));
  return [...ordered, ...unordered];
}
