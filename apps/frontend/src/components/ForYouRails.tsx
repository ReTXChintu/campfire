import { Link } from "react-router-dom";
import Rail, { RailItem } from "./Rail";
import FolderCard from "./FolderCard";
import VideoCard from "./VideoCard";
import { Star } from "./explore/ExploreRow";
import { titleParam } from "../lib/explore";
import { useForYou } from "../lib/opinions";
import type { CatalogFolderListItem, CatalogListItem, CatalogVideoListItem } from "../lib/catalogListItem";

function Reason({ text }: { text: string | null }) {
  if (!text) return null;
  return <p className="mt-0.5 line-clamp-2 text-xs text-amber">{text}</p>;
}

/** What to watch next, from what the viewer has liked and watched: the library's titles, then ones
 * on TMDb that aren't in it. Nothing until there's something to go on. */
export default function ForYouRails({ items }: { items: CatalogListItem[] }) {
  const { data } = useForYou();
  if (!data?.ready) return null;
  const byKey = new Map(items.map((item) => [`${item.kind}:${item.id}`, item]));
  const library = data.library.flatMap((pick) => {
    const item = byKey.get(`${pick.kind}:${pick.id}`);
    return item ? [{ item, reason: pick.reason }] : [];
  });

  return (
    <>
      {library.length > 0 && (
        <Rail title="For you" eyebrow="From what you liked and watched">
          {library.map(({ item, reason }) => (
            <RailItem key={item.id}>
              {item.kind === "folder" ? (
                <FolderCard item={item as CatalogFolderListItem} />
              ) : (
                <VideoCard item={item as CatalogVideoListItem} />
              )}
              <Reason text={reason} />
            </RailItem>
          ))}
        </Rail>
      )}
      {data.explore.length > 0 && (
        <Rail title="You might also like" eyebrow="Not in your library yet" seeAllHref="/explore" seeAllLabel="Explore">
          {data.explore.map((item) => (
            <RailItem key={`${item.tmdbType}-${item.tmdbId}`}>
              <Link to={`/explore?title=${titleParam(item.tmdbType, item.tmdbId)}`} className="group block rounded-xl">
                <div className="aspect-[2/3] overflow-hidden rounded-xl border border-divider bg-surface transition group-hover:border-divider-strong">
                  {item.posterUrl && (
                    <img src={item.posterUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  )}
                </div>
                <h3 className="mt-2.5 line-clamp-2 text-sm font-semibold text-white transition group-hover:text-amber">{item.title}</h3>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-text-tertiary">
                  {item.rating !== null && (
                    <span className="inline-flex items-center gap-1 font-semibold text-white">
                      <Star className="h-3 w-3 text-amber" />
                      {item.rating.toFixed(1)}
                    </span>
                  )}
                  <span>{[item.year, item.tmdbType === "tv" ? "Series" : "Film"].filter(Boolean).join(" · ")}</span>
                </p>
              </Link>
              <Reason text={item.reason} />
            </RailItem>
          ))}
        </Rail>
      )}
    </>
  );
}
