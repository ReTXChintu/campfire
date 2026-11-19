// Structurally identical to the backend's lib/catalogListItem.ts — the backend already returns
// items pre-sorted (naturalSort runs server-side), so only the type shapes are duplicated here.
/** The TMDb facts a list item carries: a year and a score for the card, and the genres and lead
 * actors that search, the browse page's genre chips and Home's genre rows work from (see
 * lib/discovery.ts). Optional throughout: an older backend doesn't send them, and an unmatched
 * title has none. */
type CardFacts = {
  year?: number | null;
  rating?: { average: number; count: number } | null;
  genres?: string[];
  castNames?: string[];
};

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
