import { useState } from "react";
import AdminShell from "../../components/admin/AdminShell";
import SourceForm from "../../components/admin/SourceForm";
import { ErrorCard, Skeleton } from "../../components/ui/States";
import { useEmbedVideoSearch } from "../../lib/embeds";
import {
  FEATURE_LABELS,
  useAddFrameVideos,
  useDeleteSource,
  useLinkSourceVideo,
  useOrderSources,
  useRemoveFrameVideo,
  useSources,
  useSourceVideos,
  useSyncSource,
  useUpdateSource,
  type SourceVideo,
  type VideoSource,
} from "../../lib/sources";
import type { PlayerFeature } from "../../lib/types";

const BUTTON =
  "min-h-9 rounded-lg border border-divider-strong px-3 text-sm text-white transition hover:bg-surface-hover disabled:opacity-40";
const KIND_LABELS = { bunny: "Bunny Stream", cloudflare: "Cloudflare Stream", frame: "Any player", drive: "Google Drive" };

/** Where titles play from, in the order they're tried. */
export default function AdminSourcesPage() {
  const { data, isLoading, error, refetch, isFetching } = useSources();
  const [adding, setAdding] = useState(false);
  const order = useOrderSources();

  const move = (index: number, by: number) => {
    const ids = data!.sources.map((s) => s.id);
    [ids[index], ids[index + by]] = [ids[index + by], ids[index]];
    order.mutate(ids);
  };

  return (
    <AdminShell
      section="sources"
      title="Sources"
      description="Where every title plays from, tried from the top down. Put a title's TMDb id in the video's name, such as tmdb-603 for a film or tmdb-1396-s1e2 for an episode, and it's matched by itself. Any other site's player can be added with its embed code."
      actions={
        !adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="min-h-11 rounded-lg bg-accent px-5 text-sm font-bold text-black transition hover:brightness-110"
          >
            Add source
          </button>
        )
      }
    >
      {error && (
        <ErrorCard title="The sources did not load" message={error.message} onRetry={() => refetch()} retrying={isFetching} />
      )}
      {isLoading && <Skeleton className="h-40" />}

      {adding && (
        <section className="mb-6 rounded-2xl border border-divider bg-surface p-5">
          <h2 className="mb-4 font-display text-xl tracking-wide text-white">New source</h2>
          <SourceForm onDone={() => setAdding(false)} />
        </section>
      )}

      <ol className="grid gap-4">
        {data?.sources.map((source, index) => (
          <SourceCard
            key={source.id}
            source={source}
            position={index + 1}
            features={data.features}
            onUp={index > 0 ? () => move(index, -1) : null}
            onDown={index < data.sources.length - 1 ? () => move(index, 1) : null}
            moving={order.isPending}
          />
        ))}
      </ol>
      {order.error && <p className="mt-3 text-sm text-danger">{order.error.message}</p>}
    </AdminShell>
  );
}

function SourceCard({
  source,
  position,
  features,
  onUp,
  onDown,
  moving,
}: {
  source: VideoSource;
  position: number;
  features: PlayerFeature[];
  onUp: (() => void) | null;
  onDown: (() => void) | null;
  moving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [showVideos, setShowVideos] = useState(false);
  const update = useUpdateSource();
  const remove = useDeleteSource();
  const sync = useSyncSource();
  const isFrame = source.kind === "frame";
  const hosted = source.kind !== "drive" && !isFrame;
  const problem = update.error ?? remove.error ?? sync.error;

  return (
    <li className="rounded-2xl border border-divider bg-surface p-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <span className="font-display text-2xl text-text-tertiary" aria-label={`Position ${position}`}>
          {position}
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-white">{source.name}</h2>
          <p className="text-xs text-text-tertiary">
            {KIND_LABELS[source.kind]}
            {!source.enabled && " · off"}
            {source.sync && ` · ${source.sync.videos} videos, ${source.sync.matched} matched`}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" className={BUTTON} aria-label={`Move ${source.name} up`} disabled={!onUp || moving} onClick={() => onUp?.()}>
            ↑
          </button>
          <button type="button" className={BUTTON} aria-label={`Move ${source.name} down`} disabled={!onDown || moving} onClick={() => onDown?.()}>
            ↓
          </button>
          {source.kind !== "drive" && (
            <>
              <button type="button" className={BUTTON} disabled={update.isPending} onClick={() => update.mutate({ id: source.id, enabled: !source.enabled })}>
                {source.enabled ? "Turn off" : "Turn on"}
              </button>
              {hosted && (
                <button type="button" className={BUTTON} disabled={sync.isPending} onClick={() => sync.mutate(source.id)}>
                  {sync.isPending ? "Checking…" : "Check for new videos"}
                </button>
              )}
              <button type="button" className={BUTTON} aria-expanded={showVideos} onClick={() => setShowVideos((v) => !v)}>
                {showVideos ? "Hide videos" : "Videos"}
              </button>
              <button type="button" className={BUTTON} aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
                {isFrame ? "Player" : "Connection"}
              </button>
              <button
                type="button"
                className="min-h-9 rounded-lg border border-danger/40 px-3 text-sm text-danger transition hover:bg-danger/10 disabled:opacity-50"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(
                    isFrame
                      ? `Remove ${source.name}? The videos you listed for it and their links are lost.`
                      : `Remove ${source.name}? Its videos stay on ${KIND_LABELS[source.kind]}; links you made by hand are lost.`,
                  )) {
                    remove.mutate(source.id);
                  }
                }}
              >
                Remove
              </button>
            </>
          )}
        </div>
      </div>

      {source.sync?.error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {source.sync.error}
        </p>
      )}
      {problem && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {problem.message}
        </p>
      )}

      {/* Another site's player brings its own controls. */}
      {!isFrame && (
        <fieldset className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-divider pt-3" disabled={update.isPending}>
          <legend className="sr-only">Player controls</legend>
          {features.map((feature) => (
            <label key={feature} className="flex min-h-9 items-center gap-2 text-sm text-text-secondary">
              <input
                type="checkbox"
                checked={source.features[feature]}
                onChange={(event) =>
                  update.mutate({ id: source.id, features: { ...source.features, [feature]: event.target.checked } })
                }
              />
              {FEATURE_LABELS[feature]}
            </label>
          ))}
        </fieldset>
      )}

      {editing && (
        <div className="mt-4 border-t border-divider pt-4">
          <SourceForm source={source} onDone={() => setEditing(false)} />
        </div>
      )}
      {showVideos && isFrame && <AddFrameVideos sourceId={source.id} />}
      {showVideos && <Videos sourceId={source.id} isFrame={isFrame} />}
    </li>
  );
}

function AddFrameVideos({ sourceId }: { sourceId: string }) {
  const [lines, setLines] = useState("");
  const add = useAddFrameVideos();
  return (
    <form
      className="mt-4 grid gap-2 border-t border-divider pt-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate({ id: sourceId, lines }, { onSuccess: () => setLines("") });
      }}
    >
      <label className="grid gap-1.5">
        <span className="text-xs font-semibold tracking-wide text-text-secondary uppercase">Add videos</span>
        <textarea
          value={lines}
          onChange={(event) => setLines(event.target.value)}
          placeholder={"a1b2c3 Holiday film\nd4e5f6 The Matrix tmdb-603"}
          rows={3}
          autoComplete="off"
          spellCheck={false}
          className="w-full rounded-lg border border-divider-strong bg-background px-3 py-2.5 font-mono text-sm text-white outline-none focus:border-accent"
        />
        <span className="text-xs text-text-tertiary">
          One per line: the video's ID on that site, then a name. A TMDb id in the name matches it by itself; link the rest below.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-2.5">
        <button type="submit" className={BUTTON} disabled={add.isPending || !lines.trim()}>
          {add.isPending ? "Adding…" : "Add"}
        </button>
        {add.error && (
          <span role="alert" className="text-sm text-danger">
            {add.error.message}
          </span>
        )}
      </div>
    </form>
  );
}

function Videos({ sourceId, isFrame }: { sourceId: string; isFrame: boolean }) {
  const { data, error } = useSourceVideos(sourceId, true);
  if (error) return <p className="mt-4 text-sm text-danger">The videos did not load.</p>;
  if (!data) return <Skeleton className="mt-4 h-24" />;
  if (data.length === 0) {
    return <p className="mt-4 text-sm text-text-tertiary">{isFrame ? "No videos yet." : "Nothing uploaded there yet."}</p>;
  }
  return (
    <ul className="mt-4 grid gap-x-6 border-t border-divider pt-3 xl:grid-cols-2">
      {data.map((video) => (
        <VideoRow key={video.videoId} sourceId={sourceId} video={video} removable={isFrame} />
      ))}
    </ul>
  );
}

function matchText(video: SourceVideo): string {
  if (!video.ready) return "Still processing";
  if (video.title) return `${video.title}${video.linkedByHand ? " (linked by hand)" : ""}`;
  return video.key ? `${video.key}: not in the library` : "No TMDb id in its name";
}

function VideoRow({ sourceId, video, removable }: { sourceId: string; video: SourceVideo; removable: boolean }) {
  const [linking, setLinking] = useState(false);
  const [search, setSearch] = useState("");
  const results = useEmbedVideoSearch(linking ? search : "");
  const link = useLinkSourceVideo();
  const remove = useRemoveFrameVideo();
  const set = (fileId: string | null) =>
    link.mutate({ id: sourceId, videoId: video.videoId, fileId }, { onSuccess: () => setLinking(false) });

  return (
    <li className="min-w-0 border-b border-divider py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-white">{video.name}</p>
          <p className={`truncate text-xs ${video.title ? "text-live" : "text-amber"}`}>
            {matchText(video)}
            {video.height ? ` · ${video.height}p` : ""}
            {removable && video.name !== video.videoId ? ` · ${video.videoId}` : ""}
          </p>
        </div>
        {video.linkedByHand && (
          <button type="button" className={BUTTON} disabled={link.isPending} onClick={() => set(null)}>
            Unlink
          </button>
        )}
        <button type="button" className={BUTTON} aria-expanded={linking} onClick={() => setLinking((v) => !v)}>
          {linking ? "Cancel" : "Link"}
        </button>
        {removable && (
          <button
            type="button"
            className={BUTTON}
            aria-label={`Remove ${video.name}`}
            disabled={remove.isPending}
            onClick={() => remove.mutate({ id: sourceId, videoId: video.videoId })}
          >
            Remove
          </button>
        )}
      </div>
      {remove.error && <p className="mt-1 text-sm text-danger">{remove.error.message}</p>}
      {linking && (
        <div className="mt-2">
          <input
            type="search"
            autoFocus
            aria-label={`Find the title for ${video.name}`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search films and episodes"
            className="min-h-11 w-full rounded-lg border border-divider-strong bg-background px-3 text-sm text-white"
          />
          {results.data?.map((r) => (
            <button
              key={r.fileId}
              type="button"
              disabled={link.isPending}
              onClick={() => set(r.fileId)}
              className="mt-1 block w-full truncate rounded-lg px-3 py-2 text-left text-sm text-white transition hover:bg-surface-hover"
            >
              {r.title} <span className="text-xs text-text-tertiary">{r.driveName}</span>
            </button>
          ))}
          {results.data?.length === 0 && <p className="px-3 py-2 text-sm text-text-tertiary">Nothing matches.</p>}
          {link.error && <p className="px-3 py-2 text-sm text-danger">{link.error.message}</p>}
        </div>
      )}
    </li>
  );
}
