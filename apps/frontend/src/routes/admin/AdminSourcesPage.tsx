import { useState } from "react";
import AdminShell from "../../components/admin/AdminShell";
import SourceForm from "../../components/admin/SourceForm";
import { ErrorCard, Skeleton } from "../../components/ui/States";
import {
  FEATURE_LABELS,
  useDeleteSource,
  useOrderSources,
  useSources,
  useSyncSource,
  useUpdateSource,
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
      description="Every title is tried in every source, from the top down, until one plays it. There's nothing to select: on Bunny and Cloudflare, put the title's TMDb id in the video's name, such as tmdb-603 for a film or tmdb-1396-s1e2 for an episode."
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
            {hosted && source.sync && ` · ${source.sync.videos} videos`}
            {hosted && source.sync && source.sync.videos > source.sync.matched && (
              <span className="text-amber"> · {source.sync.videos - source.sync.matched} without a TMDb id in the name, so never found</span>
            )}
            {isFrame && " · every video in your library"}
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
              <button type="button" className={BUTTON} aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
                {isFrame ? "Player" : "Connection"}
              </button>
              <button
                type="button"
                className="min-h-9 rounded-lg border border-danger/40 px-3 text-sm text-danger transition hover:bg-danger/10 disabled:opacity-50"
                disabled={remove.isPending}
                onClick={() => {
                  if (window.confirm(
                    isFrame ? `Remove ${source.name}?` : `Remove ${source.name}? Its videos stay on ${KIND_LABELS[source.kind]}.`,
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
    </li>
  );
}
