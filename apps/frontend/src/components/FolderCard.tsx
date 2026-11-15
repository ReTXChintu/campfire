import { Link } from "react-router-dom";
import type { CatalogFolderListItem } from "../lib/catalogListItem";
import Poster, { PosterAction } from "./Poster";
import { RatingChip } from "./MetaLine";

/** A series (or any folder of videos). The API gives a name, its artwork, and — once it's matched
 * on TMDb — a year and a score. There is still no season or episode count on a library list item,
 * so the line under the name says what this is rather than inventing a number. */
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
      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text-tertiary">
        <RatingChip rating={item.rating} className="text-xs" />
        {item.rating && <span aria-hidden="true">·</span>}
        {item.year && (
          <>
            <span>{item.year}</span>
            <span aria-hidden="true">·</span>
          </>
        )}
        <span>{itemCount === undefined ? "Series" : `${itemCount} ${itemCount === 1 ? "episode" : "episodes"}`}</span>
      </p>
    </Link>
  );
}
