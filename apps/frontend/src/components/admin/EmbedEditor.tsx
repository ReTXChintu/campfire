import { useState } from "react";
import { ApiError } from "../../lib/api";
import {
  formatClock,
  parseClock,
  useSaveEmbeds,
  useVideoEmbeds,
  type EmbedOption,
  type EmbedProvider,
  type SavedEmbed,
} from "../../lib/embeds";
import type { TmdbRef } from "../../lib/types";
import { Skeleton } from "../ui/States";

type Row = {
  id: number;
  url: string;
  enabled: boolean;
  startAt: string; // as typed: "1:30"
  autoplay: boolean;
  muted: boolean;
  hideControls: boolean;
  /** As last saved; gone once the link is edited. */
  saved: SavedEmbed | null;
};

let nextRowId = 0;
const toRow = (e: SavedEmbed): Row => ({
  id: nextRowId++,
  url: e.url,
  enabled: e.enabled,
  startAt: formatClock(e.startAt),
  autoplay: e.autoplay,
  muted: e.muted,
  hideControls: e.hideControls,
  saved: e,
});
const emptyRow = (): Row => ({
  id: nextRowId++,
  url: "",
  enabled: true,
  startAt: "",
  autoplay: false,
  muted: false,
  hideControls: false,
  saved: null,
});

const OPTION_LABELS: [Exclude<EmbedOption, "startAt">, string][] = [
  ["autoplay", "Autoplay"],
  ["muted", "Start muted"],
  ["hideControls", "Hide controls"],
];

const FIELD = "min-h-11 rounded-lg border border-divider-strong bg-background px-3 text-sm text-white";
const SMALL_BUTTON =
  "min-h-9 rounded-lg border border-divider-strong px-3 text-sm text-white transition hover:bg-surface-hover disabled:opacity-40";

/** A title's embedded players: add, order, switch off, set how each starts, and try it out. */
export default function EmbedEditor({ fileId }: { fileId: string }) {
  const { data, error } = useVideoEmbeds(fileId);
  if (error) return <p className="text-sm text-danger">The players did not load.</p>;
  if (!data) return <Skeleton className="h-24" />;
  return (
    <Form key={fileId} fileId={fileId} initial={data.embeds} max={data.max} tmdb={data.tmdb} providers={data.providers} />
  );
}

function Form({
  fileId,
  initial,
  max,
  tmdb,
  providers,
}: {
  fileId: string;
  initial: SavedEmbed[];
  max: number;
  tmdb: TmdbRef | null;
  providers: EmbedProvider[];
}) {
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useSaveEmbeds(fileId);

  const change = (update: (all: Row[]) => Row[]) => {
    save.reset();
    setProblem(null);
    setRows(update);
  };
  const edit = (id: number, fields: Partial<Row>) =>
    change((all) => all.map((r) => (r.id === id ? { ...r, ...fields } : r)));
  const move = (index: number, by: number) =>
    change((all) => {
      const copy = [...all];
      [copy[index], copy[index + by]] = [copy[index + by], copy[index]];
      return copy;
    });

  const submit = () => {
    const filled = rows.filter((r) => r.url.trim());
    const bad = filled.findIndex((r) => parseClock(r.startAt) === undefined);
    if (bad >= 0) {
      setProblem(`Player ${bad + 1}: write the start time as 1:30, 1:02:05 or a number of seconds.`);
      return;
    }
    setProblem(null);
    save.mutate(
      filled.map(({ url, enabled, startAt, autoplay, muted, hideControls }) => ({
        url: url.trim(),
        enabled,
        startAt: parseClock(startAt) ?? null,
        autoplay,
        muted,
        hideControls,
      })),
      {
        onSuccess: ({ embeds }) => {
          setPreviewId(null);
          setRows(embeds.map(toRow));
        },
      },
    );
  };

  const failure =
    problem ?? (save.error ? (save.error instanceof ApiError ? save.error.message : "That did not save.") : null);

  return (
    <div className="grid gap-3">
      <p className="text-sm text-text-secondary">
        Tried from the top down before the Drive file. Paste a link from {providers.map((p) => p.name).join(", ")}.{" "}
        {tmdb
          ? `Saved for TMDb ${tmdb.type === "tv" ? "series" : "film"} ${tmdb.id}${
              tmdb.episode != null ? `, S${tmdb.season} E${tmdb.episode}` : ""
            }, so it stays if the file is replaced.`
          : "This video has no TMDb match, so it's saved for this file only."}
      </p>

      {rows.map((row, index) => {
        const supports = providers.find((p) => p.name === row.saved?.provider)?.supports;
        const can = (option: EmbedOption) => !supports || supports.includes(option);
        return (
          <div key={row.id} className="grid gap-3 rounded-lg border border-divider bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="url"
                aria-label={`Player ${index + 1} link`}
                value={row.url}
                onChange={(event) => edit(row.id, { url: event.target.value, saved: null })}
                placeholder={providers[0]?.example}
                className={`${FIELD} min-w-0 flex-1 basis-64`}
              />
              {row.saved && (
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    row.saved.available ? "border-live/40 text-live" : "border-danger/40 text-danger"
                  }`}
                >
                  {row.saved.provider}
                  {row.saved.available ? "" : " · not available"}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-text-secondary">
              <label className="flex min-h-9 items-center gap-2">
                <input
                  type="checkbox"
                  checked={row.enabled}
                  onChange={(event) => edit(row.id, { enabled: event.target.checked })}
                />
                On
              </label>
              <label className="flex items-center gap-2">
                Start at
                <input
                  value={row.startAt}
                  onChange={(event) => edit(row.id, { startAt: event.target.value })}
                  placeholder="0:00"
                  className={`${FIELD} w-24`}
                />
              </label>
              {OPTION_LABELS.map(([option, label]) => (
                <label
                  key={option}
                  title={can(option) ? undefined : `${row.saved?.provider} doesn't offer this`}
                  className={`flex min-h-9 items-center gap-2 ${can(option) ? "" : "opacity-40"}`}
                >
                  <input
                    type="checkbox"
                    disabled={!can(option)}
                    checked={row[option] && can(option)}
                    onChange={(event) => edit(row.id, { [option]: event.target.checked })}
                  />
                  {label}
                </label>
              ))}
              <span className="ml-auto flex flex-wrap gap-2">
                {row.saved && (
                  <button
                    type="button"
                    className={SMALL_BUTTON}
                    onClick={() => setPreviewId(previewId === row.id ? null : row.id)}
                  >
                    {previewId === row.id ? "Close preview" : "Preview"}
                  </button>
                )}
                <button
                  type="button"
                  className={SMALL_BUTTON}
                  aria-label={`Move player ${index + 1} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={SMALL_BUTTON}
                  aria-label={`Move player ${index + 1} down`}
                  disabled={index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className={SMALL_BUTTON}
                  aria-label={`Remove player ${index + 1}`}
                  onClick={() => change((all) => all.filter((r) => r.id !== row.id))}
                >
                  Remove
                </button>
              </span>
            </div>
            {previewId === row.id && row.saved && (
              <div>
                <iframe
                  src={row.saved.playerUrl}
                  title={`Preview of player ${index + 1}`}
                  className="aspect-video w-full rounded-lg border-0 bg-black lg:w-[640px] lg:max-w-full"
                  allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  sandbox="allow-scripts allow-same-origin allow-presentation"
                />
                <p className="mt-1.5 text-xs text-text-tertiary">As last saved.</p>
              </div>
            )}
          </div>
        );
      })}

      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          disabled={rows.length >= max}
          onClick={() => change((all) => [...all, emptyRow()])}
          className="min-h-11 rounded-lg border border-divider-strong px-4 text-sm font-semibold text-white transition hover:bg-surface-hover disabled:opacity-40"
        >
          Add player
        </button>
        <button
          type="button"
          disabled={save.isPending}
          onClick={submit}
          className="min-h-11 rounded-lg bg-accent px-5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save players"}
        </button>
        {save.isSuccess && (
          <span role="status" className="text-sm text-live">
            Saved.
          </span>
        )}
        {failure && (
          <span role="alert" className="text-sm text-danger">
            {failure}
          </span>
        )}
      </div>
    </div>
  );
}
