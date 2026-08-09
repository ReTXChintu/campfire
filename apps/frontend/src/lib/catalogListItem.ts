// Structurally identical to the backend's lib/catalogListItem.ts — the backend already returns
// items pre-sorted (naturalSort runs server-side), so only the type shapes are duplicated here.
export type CatalogVideoListItem = { kind: "video"; id: string; name: string; mimeType: string };
export type CatalogFolderListItem = {
  kind: "folder";
  id: string;
  name: string;
  thumbnailFileId: string | null;
};
export type CatalogListItem = CatalogVideoListItem | CatalogFolderListItem;
