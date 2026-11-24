import { Link } from "react-router-dom";
import type { CatalogFolderListItem } from "../lib/catalogListItem";
import Poster, { PosterAction, WatchedBadge } from "./Poster";
import { useOpinion } from "../lib/opinions";
import { RatingChip } from "./MetaLine";

/** A series (or any folder of videos). The API gives a name, its artwork, and — once it's matched
 * on TMDb — a year and a score. There is still no season or episode count on a library list item,
 * so the line under the name says what this is rather than inventing a number. */
export default function FolderCard({ item, itemCount }: { item: CatalogFolderListItem; itemCount?: number }) {
  const opinion = useOpinion(item.tmdb);
  return (
    <Link to={`/folder/${item.id}`} className="group block rounded-xl">
      <Poster
        path={item.thumbnailFileId ? `/api/thumbnail-folder/${item.id}` : null}
        title={item.name}
        id={item.id}
      >
        {opinion?.watched && (
          <div className="absolute inset-x-1.5 top-1.5 flex">
            <WatchedBadge />
          </div>
        )}
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
