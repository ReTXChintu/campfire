import Rail from "../Rail";
import type { ExploreItem, ExploreKind } from "../../lib/explore";
import { itemKey, sectionHref, type FeedSection } from "../../lib/feed";
import { PosterTitleCard, RankTitleCard, WideTitleCard } from "./TitleCard";

const WIDTHS = {
  poster: "w-[150px] sm:w-[176px]",
  wide: "w-[270px] sm:w-[340px]",
  rank: "w-[215px] sm:w-[264px]",
};

/** One section of the feed as a row. */
export default function FeedRail({
  section,
  kind,
  onOpen,
}: {
  section: FeedSection;
  kind: ExploreKind;
  onOpen: (item: ExploreItem) => void;
}) {
  return (
    <Rail title={section.title} seeAllHref={section.look === "rank" ? undefined : sectionHref(section.id, kind)}>
      {section.items.map((item, i) => (
        // Room for a card to grow under the pointer without the row cutting it off.
        <div key={itemKey(item)} className={`shrink-0 snap-start py-2 ${WIDTHS[section.look]}`}>
          {section.look === "rank" ? (
            <RankTitleCard item={item} rank={i + 1} onOpen={onOpen} />
          ) : section.look === "wide" ? (
            <WideTitleCard item={item} onOpen={onOpen} />
          ) : (
            <PosterTitleCard item={item} onOpen={onOpen} />
          )}
        </div>
      ))}
    </Rail>
  );
}
