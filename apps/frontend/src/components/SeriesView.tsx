import { Link } from "react-router-dom";
import SeasonDropdown from "./SeasonDropdown";
import DetailHeader from "./DetailHeader";
import EpisodeRow from "./EpisodeRow";
import { EmptyState } from "./ui/States";
import { formatLabel } from "../lib/mediaFormat";
import { PAGE_X } from "../lib/layout";
import CastRow from "./CastRow";
import type { TitleLanguages, TitleMeta, WatchProgress } from "../lib/types";
import { languageFacts } from "../lib/titleLanguages";
import type { CatalogListItem, CatalogVideoListItem } from "../lib/catalogListItem";

/** The most recently touched in-progress episode, which is what "Resume" should open. Falls back
 * to the first unwatched episode, then to the first episode. */
function resumeTarget(
  items: CatalogListItem[],
  progressByFileId: Map<string, WatchProgress>,
): CatalogVideoListItem | null {
  const videos = items.filter((item): item is CatalogVideoListItem => item.kind === "video");
  const inProgress = videos
    .map((video) => ({ video, progress: progressByFileId.get(video.id) }))
    .filter((entry) => entry.progress && !entry.progress.completed && entry.progress.positionSeconds > 0)
    .sort((a, b) => Date.parse(b.progress!.updatedAt) - Date.parse(a.progress!.updatedAt));
  if (inProgress.length > 0) return inProgress[0].video;
  return videos.find((video) => !progressByFileId.get(video.id)?.completed) ?? videos[0] ?? null;
}

function formatsOf(items: CatalogListItem[]): string[] {
  const formats = new Set<string>();
  for (const item of items) if (item.kind === "video") formats.add(formatLabel(item.mimeType));
  return [...formats];
}

export default function SeriesView({
  folderId,
  title,
  backHref,
  thumbnailFileId,
  meta,
  languages,
  seasons,
  selectedSeasonId,
  seasonItems,
  specialItems,
  progressByFileId,
}: {
  folderId: string;
  title: string;
  backHref?: string;
  thumbnailFileId: string | null;
  /** What TMDb knows about the series (see lib/types' TitleMeta). */
  meta: TitleMeta;
  /** Audio/subtitle languages across its published episodes; hidden while null. */
  languages?: TitleLanguages | null;
  seasons: { id: string; name: string }[];
  selectedSeasonId: string;
  seasonItems: CatalogListItem[];
  specialItems: CatalogListItem[];
  progressByFileId: Map<string, WatchProgress>;
}) {
  const resume = resumeTarget(seasonItems, progressByFileId);
  const resumeProgress = resume ? progressByFileId.get(resume.id) : undefined;
  const formats = formatsOf([...seasonItems, ...specialItems]);
  const selectedSeason = seasons.find((season) => season.id === selectedSeasonId);

  return (
    <main className="w-full flex-1 pb-16">
      <DetailHeader
        id={folderId}
        title={title}
        eyebrow="Series"
        meta={meta}
        thumbnailPath={thumbnailFileId ? `/api/thumbnail-folder/${folderId}` : null}
        backHref={backHref}
        // The seasons the library actually holds, which is often not all TMDb lists.
        metaExtra={[seasons.length > 1 ? `${seasons.length} seasons here` : null]}
        facts={[
          { label: "Seasons", value: seasons.length },
          {
            label: "Episodes",
            value: `${seasonItems.length}${selectedSeason ? ` in ${selectedSeason.name}` : ""}`,
          },
          ...(specialItems.length > 0 ? [{ label: "Specials", value: specialItems.length }] : []),
          ...(formats.length > 0 ? [{ label: "Formats", value: formats.join(", ") }] : []),
          ...languageFacts(languages),
        ]}
        actions={
          resume && (
            <>
              <Link
                to={`/watch/${resume.id}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <polygon points="8,5 19,12 8,19" />
                </svg>
                {resumeProgress && !resumeProgress.completed && resumeProgress.positionSeconds > 0
                  ? "Resume"
                  : "Play first episode"}
              </Link>
              <span className="inline-flex min-h-11 items-center text-sm text-text-secondary">{resume.name}</span>
            </>
          )
        }
      />

      <CastRow cast={meta.cast} />

      <section className={`${PAGE_X} pt-8`}>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-2xl tracking-wide text-white">Episodes</h2>
          {seasons.length > 1 && (
            <div className="flex items-center gap-2">
              <label htmlFor="season-select" className="text-xs font-semibold text-text-secondary">
                Season
              </label>
              <SeasonDropdown folderId={folderId} seasons={seasons} selectedId={selectedSeasonId} />
            </div>
          )}
        </div>

        {seasonItems.length === 0 ? (
          <EmptyState
            title="No episodes in this season yet"
            message="Pick another season, or ask the admin to publish this one."
          />
        ) : (
          <div className="grid gap-1 lg:grid-cols-2 lg:gap-x-6">
            {seasonItems.map((item, index) =>
              item.kind === "video" ? (
                <EpisodeRow key={item.id} item={item} index={index} progress={progressByFileId.get(item.id)} />
              ) : (
                <Link
                  key={item.id}
                  to={`/folder/${item.id}`}
                  className="rounded-xl border border-divider p-3 text-sm font-semibold text-white transition hover:bg-surface"
                >
                  {item.name}
                </Link>
              ),
            )}
          </div>
        )}

        {specialItems.length > 0 && (
          <>
            <div className="filmstrip my-8" />
            <h2 className="mb-4 font-display text-2xl tracking-wide text-white">Specials</h2>
            <div className="grid gap-1 lg:grid-cols-2 lg:gap-x-6">
              {specialItems.map((item, index) =>
                item.kind === "video" ? (
                  <EpisodeRow key={item.id} item={item} index={index} progress={progressByFileId.get(item.id)} />
                ) : null,
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
