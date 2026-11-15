// Structurally identical to the backend's lib/catalogListItem.ts — the backend already returns
// items pre-sorted (naturalSort runs server-side), so only the type shapes are duplicated here.
/** The TMDb facts small enough to fit on a card. Optional throughout: an older backend doesn't
 * send them, and an unmatched title has none. */
type CardFacts = { year?: number | null; rating?: { average: number; count: number } | null };

export type CatalogVideoListItem = {
  kind: "video";
  id: string;
  name: string;
  mimeType: string;
  /** Episode listings only — see the backend's `episodeRow`. `episodeNumber` is the episode's own
   * number on TMDb, which is what an "E4" label should read, not its position in the folder. */
  episodeOrder?: number | null;
  episodeNumber?: number | null;
  overview?: string | null;
  runtimeMinutes?: number | null;
  airDate?: string | null;
} & CardFacts;

export type CatalogFolderListItem = {
  kind: "folder";
  id: string;
  name: string;
  thumbnailFileId: string | null;
} & CardFacts;
export type CatalogListItem = CatalogVideoListItem | CatalogFolderListItem;
