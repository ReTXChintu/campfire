import { Link } from "react-router-dom";
import type { CatalogFolderListItem } from "../lib/catalogListItem";
import Poster, { PosterAction } from "./Poster";

/** A series (or any folder of videos). The API gives a name and, when the admin picked one, a
 * folder thumbnail — there is no season or episode count on a library list item, so the meta line
 * says what this is rather than inventing a number. */
export default function FolderCard({ item, itemCount }: { item: CatalogFolderListItem; itemCount?: number }) {
  return (
    <Link to={`/folder/${item.id}`} className="group block rounded-xl">
      <Poster
        path={item.thumbnailFileId ? `/api/thumbnail-folder/${item.id}` : null}
        title={item.name}
        id={item.id}
      >
        <PosterAction label="Open" />
      </Poster>
      <h3 className="mt-2.5 line-clamp-2 text-sm font-semibold text-white transition group-hover:text-amber">
        {item.name}
      </h3>
      <p className="mt-0.5 text-xs text-text-tertiary">
        {itemCount === undefined ? "Series" : `${itemCount} ${itemCount === 1 ? "episode" : "episodes"}`}
      </p>
    </Link>
  );
}
