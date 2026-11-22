import { Link } from "react-router-dom";
import type { CatalogListItem, CatalogVideoListItem } from "../lib/catalogListItem";
import type { TitleLanguages, TitleMeta, WatchProgress } from "../lib/types";
import { languageFacts } from "../lib/titleLanguages";
import CastRow from "./CastRow";
import DetailHeader from "./DetailHeader";
import EpisodeRow from "./EpisodeRow";
import VideoGrid from "./VideoGrid";
import { formatLabel } from "../lib/mediaFormat";
import { PAGE_X } from "../lib/layout";

/** A folder that isn't organised into seasons: either a shelf of films or a flat list of videos.
 * Videos get the episode list (it reads better than a grid for an ordered run), folders keep the
 * poster grid. */
export default function FolderView({
  folderId,
  title,
  backHref,
  thumbnailFileId,
  meta,
  languages,
  items,
  progressByFileId,
}: {
  folderId: string;
  title: string;
  backHref?: string;
  thumbnailFileId: string | null;
  /** What TMDb knows about this title (see lib/types' TitleMeta). */
  meta: TitleMeta;
  /** Audio/subtitle languages across its published videos; hidden while null. */
  languages?: TitleLanguages | null;
  items: CatalogListItem[];
  progressByFileId: Map<string, WatchProgress>;
}) {
  const videos = items.filter((item): item is CatalogVideoListItem => item.kind === "video");
  const folders = items.filter((item) => item.kind === "folder");
  const formats = [...new Set(videos.map((video) => formatLabel(video.mimeType)))];
  const first = videos[0];

  return (
    <main className="w-full flex-1 pb-16">
      <DetailHeader
        id={folderId}
        title={title}
        eyebrow="Collection"
        meta={meta}
        thumbnailPath={thumbnailFileId ? `/api/thumbnail-folder/${folderId}` : null}
        backHref={backHref}
        facts={[
          { label: "Items", value: items.length },
          ...(folders.length > 0 ? [{ label: "Folders", value: folders.length }] : []),
          ...(formats.length > 0 ? [{ label: "Formats", value: formats.join(", ") }] : []),
          // A shelf can mix films and episodes, so a partial language is just "some".
          ...languageFacts(languages, "some"),
        ]}
        actions={
          first && (
            <Link
              to={`/watch/${first.id}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <polygon points="8,5 19,12 8,19" />
              </svg>
              Play {first.name}
            </Link>
          )
        }
      />

      <CastRow cast={meta.cast} />

      <section className={`${PAGE_X} pt-8`}>
        {folders.length > 0 && (
          <>
            <h2 className="mb-4 font-display text-2xl tracking-wide text-white">Folders</h2>
            <VideoGrid items={folders} emptyTitle="No folders" />
            {videos.length > 0 && <div className="filmstrip my-8" />}
          </>
        )}

        {videos.length > 0 && (
          <>
            <h2 className="mb-4 font-display text-2xl tracking-wide text-white">
              {videos.length} {videos.length === 1 ? "video" : "videos"}
            </h2>
            <div className="grid gap-1 lg:grid-cols-2 lg:gap-x-6">
              {videos.map((video, index) => (
                <EpisodeRow key={video.id} item={video} index={index} progress={progressByFileId.get(video.id)} />
              ))}
            </div>
          </>
        )}

        {items.length === 0 && (
          <VideoGrid
            items={[]}
            emptyTitle="This folder is empty"
            emptyMessage="Nothing in it has been published yet."
          />
        )}
      </section>
    </main>
  );
}
