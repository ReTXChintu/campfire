import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  useFolderTracks,
  useReadFolderTracks,
  useReadVideoTracks,
  useSaveFolderTracks,
  useSaveVideoTracks,
  useVideoTracks,
  type EffectiveTracks,
  type TrackLayout,
  type TrackReportVideo,
} from "../../hooks/useAdminCatalog";
import { useLanguageOptions } from "../../hooks/useCatalog";
import { languageName } from "../../lib/languageNames";
import type { FileTrack, LanguageOption, TrackNaming } from "../../lib/types";

/*
 * Audio and subtitles in admin: what each file really holds (read once with ffprobe in the
 * background), which episodes of a series hold something different, and the names and defaults
 * viewers' players use. Names are given per track *position* — the apps' player numbers tracks the
 * same way — which is why a series whose episodes disagree on their layout is flagged so loudly:
 * the fix is getting the same files for every episode, and the panel says which ones.
 */

type Kind = "audio" | "subtitles";

const INPUT =
  "min-h-[38px] w-full min-w-0 rounded-md border border-divider-strong bg-background px-2.5 text-sm text-white outline-none focus:border-accent";
const BUTTON =
  "rounded-md border border-divider px-3 py-1.5 text-sm text-white/90 transition hover:bg-white/5 disabled:opacity-50";

function channelsLabel(channels: number | null): string | null {
  if (channels == null) return null;
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return `${channels} ch`;
}

function codeName(code: string | null): string {
  if (!code) return "untagged";
  return languageName(code) ?? code;
}

/** One kind of a layout in words, e.g. "English, Japanese". */
function kindSummary(tracks: FileTrack[], empty: string): string {
  return tracks.length === 0 ? empty : tracks.map((t) => codeName(t.language)).join(", ");
}

function layoutSummary(layout: TrackLayout): string {
  return `Audio: ${kindSummary(layout.audio, "none")} · Subtitles: ${kindSummary(layout.subtitles, "none")}`;
}

function episodeName(video: TrackReportVideo): string {
  return video.season ? `${video.season} · ${video.title}` : video.title;
}

function EpisodeLinks({ videos }: { videos: TrackReportVideo[] }) {
  return (
    <ul className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2 xl:grid-cols-3">
      {videos.map((video) => (
        <li key={video.id} className="min-w-0 truncate">
          <Link to={`/admin/catalog/video/${video.id}`} className="text-white/90 underline-offset-2 hover:underline">
            {episodeName(video)}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------------------------
// Naming form

/** "inherit" leaves the default out (the folder above decides), "none" sends null. */
type DefaultChoice = "inherit" | "none" | number;
type RowValue = { label: string; language: string };
type Rows = Record<string, RowValue>;

function rowsFrom(naming: TrackNaming, kind: Kind): Rows {
  const out: Rows = {};
  for (const [n, value] of Object.entries(naming[kind] ?? {})) {
    out[n] = { label: value.label ?? "", language: value.language ?? "" };
  }
  return out;
}

function choiceFrom(value: number | null | undefined, inheritedValue: number | null | undefined): DefaultChoice {
  if (value === undefined) return "inherit";
  // With nothing set above, "no default here" and "inherit" mean the same thing — the file's own
  // flag — so the form shows them as one choice.
  if (value === null) return inheritedValue == null ? "inherit" : "none";
  return value;
}

/** Rows nobody filled in are left out; rows for tracks this layout doesn't have are kept, since
 * another episode's layout may well have them. */
function pack(rows: Rows): Record<string, { label: string | null; language: string | null }> {
  const out: Record<string, { label: string | null; language: string | null }> = {};
  for (const [n, value] of Object.entries(rows)) {
    const label = value.label.trim();
    if (label || value.language) out[n] = { label: label || null, language: value.language || null };
  }
  return out;
}

function fileFacts(track: FileTrack): string[] {
  return [
    track.language ?? "no language tag",
    track.title ? `“${track.title}”` : null,
    track.codec.toUpperCase(),
    channelsLabel(track.channels),
    track.isDefault ? "default" : null,
    track.forced ? "forced" : null,
  ].filter((fact): fact is string => !!fact);
}

function TrackRows({
  kind,
  idPrefix,
  tracks,
  effective,
  saved,
  inherited,
  inheritsFrom,
  rows,
  onRow,
  defaultChoice,
  onDefault,
  languages,
}: {
  kind: Kind;
  idPrefix: string;
  tracks: FileTrack[];
  effective: EffectiveTracks | null;
  saved: TrackNaming;
  inherited: TrackNaming;
  inheritsFrom: string | null;
  rows: Rows;
  onRow: (n: string, value: RowValue) => void;
  defaultChoice: DefaultChoice;
  onDefault: (choice: DefaultChoice) => void;
  languages: LanguageOption[];
}) {
  const heading = kind === "audio" ? "Audio" : "Subtitles";
  const radioName = `${idPrefix}-default-${kind}`;
  const inheritedDefault = kind === "audio" ? inherited.defaultAudio : inherited.defaultSubtitle;
  const effectiveList = effective?.[kind] ?? [];
  const trackLabel = (n: number) => effectiveList.find((t) => t.n === n)?.label ?? `track ${n}`;

  const inheritLabel =
    inheritedDefault == null
      ? "The file's own default"
      : inheritedDefault === 0
        ? `Same as ${inheritsFrom ?? "above"} (subtitles off)`
        : `Same as ${inheritsFrom ?? "above"} (${trackLabel(inheritedDefault)})`;

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-semibold tracking-wide text-text-secondary uppercase">{heading}</legend>
      {tracks.length === 0 ? (
        <p className="text-sm text-text-tertiary">{kind === "audio" ? "No audio tracks." : "No subtitles in the file."}</p>
      ) : (
        <>
          <div className="hidden gap-3 px-3 pb-1 text-xs text-text-tertiary md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_72px]">
            <span>What the file says</span>
            <span>Name viewers see</span>
            <span>Language</span>
            <span>Default</span>
          </div>
          <ul className="grid gap-2">
            {tracks.map((track) => {
              const n = String(track.n);
              const row = rows[n] ?? { label: "", language: "" };
              const inheritedName = inherited[kind]?.[n];
              const savedLabel = saved[kind]?.[n]?.label;
              // What viewers would see with the box empty: the name from above, else (when this
              // level hasn't named it either) the server's own label for it.
              const placeholder =
                inheritedName?.label ??
                (!savedLabel ? effectiveList.find((t) => t.n === track.n)?.label : null) ??
                `${codeName(inheritedName?.language ?? track.language)}`;
              const fileLanguage = inheritedName?.language
                ? `Same as ${inheritsFrom ?? "above"} (${codeName(inheritedName.language)})`
                : `As the file says (${codeName(track.language)})`;
              const known = languages.some((l) => l.code === row.language);
              return (
                <li
                  key={n}
                  className="grid gap-2 rounded-md border border-divider p-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_72px] md:items-center md:gap-3"
                >
                  <div className="min-w-0 text-sm">
                    <span className="font-mono text-xs text-amber">#{track.n}</span>{" "}
                    <span className="text-text-secondary">{fileFacts(track).join(" · ")}</span>
                  </div>
                  <div className="min-w-0">
                    <label htmlFor={`${idPrefix}-${kind}-${n}-label`} className="mb-1 block text-xs text-text-tertiary md:sr-only">
                      Name for {kind === "audio" ? "audio" : "subtitle"} track {track.n}
                    </label>
                    <input
                      id={`${idPrefix}-${kind}-${n}-label`}
                      type="text"
                      maxLength={60}
                      value={row.label}
                      placeholder={placeholder}
                      onChange={(e) => onRow(n, { ...row, label: e.target.value })}
                      className={INPUT}
                    />
                  </div>
                  <div className="min-w-0">
                    <label htmlFor={`${idPrefix}-${kind}-${n}-language`} className="mb-1 block text-xs text-text-tertiary md:sr-only">
                      Language of {kind === "audio" ? "audio" : "subtitle"} track {track.n}
                    </label>
                    <select
                      id={`${idPrefix}-${kind}-${n}-language`}
                      value={row.language}
                      onChange={(e) => onRow(n, { ...row, language: e.target.value })}
                      className={INPUT}
                    >
                      <option value="">{fileLanguage}</option>
                      {!known && row.language && <option value={row.language}>{codeName(row.language)}</option>}
                      {languages.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm text-text-secondary">
                    <input
                      type="radio"
                      name={radioName}
                      checked={defaultChoice === track.n}
                      onChange={() => onDefault(track.n)}
                    />
                    <span className="md:sr-only">Start on this track</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-text-secondary">
        {kind === "subtitles" && (
          <label className="flex items-center gap-2">
            <input type="radio" name={radioName} checked={defaultChoice === 0} onChange={() => onDefault(0)} />
            Start with subtitles off
          </label>
        )}
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={radioName}
            checked={defaultChoice === "inherit"}
            onChange={() => onDefault("inherit")}
          />
          {inheritLabel}
        </label>
        {inheritedDefault != null && (
          <label className="flex items-center gap-2">
            <input type="radio" name={radioName} checked={defaultChoice === "none"} onChange={() => onDefault("none")} />
            No default (the file&apos;s own)
          </label>
        )}
      </div>
    </fieldset>
  );
}

/**
 * Names, languages and defaults for one layout of tracks. Remount it (via `key`) when the saved
 * naming changes so it starts from what the server kept.
 */
function TrackNamingForm({
  idPrefix,
  layout,
  effective,
  naming,
  inherited,
  inheritsFrom,
  saving,
  onSave,
  onChange,
}: {
  idPrefix: string;
  layout: TrackLayout;
  effective: EffectiveTracks | null;
  naming: TrackNaming;
  inherited: TrackNaming;
  /** What empty fields fall back to, e.g. the series' name; null on a series root or a film. */
  inheritsFrom: string | null;
  saving: boolean;
  onSave: (naming: TrackNaming) => void;
  onChange: () => void;
}) {
  const languages = useLanguageOptions();
  const [audio, setAudio] = useState<Rows>(() => rowsFrom(naming, "audio"));
  const [subtitles, setSubtitles] = useState<Rows>(() => rowsFrom(naming, "subtitles"));
  const [defaultAudio, setDefaultAudio] = useState<DefaultChoice>(() =>
    choiceFrom(naming.defaultAudio, inherited.defaultAudio),
  );
  const [defaultSubtitle, setDefaultSubtitle] = useState<DefaultChoice>(() =>
    choiceFrom(naming.defaultSubtitle, inherited.defaultSubtitle),
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // The server replaces this level's naming wholesale, so the whole thing goes every time.
    const body: TrackNaming = { audio: pack(audio), subtitles: pack(subtitles) };
    if (defaultAudio !== "inherit") body.defaultAudio = defaultAudio === "none" ? null : defaultAudio;
    if (defaultSubtitle !== "inherit") body.defaultSubtitle = defaultSubtitle === "none" ? null : defaultSubtitle;
    onSave(body);
  };

  const shared = {
    idPrefix,
    effective,
    saved: naming,
    inherited,
    inheritsFrom,
    languages: languages.data ?? [],
  };

  return (
    <form onSubmit={submit} className="grid gap-5">
      <TrackRows
        {...shared}
        kind="audio"
        tracks={layout.audio}
        rows={audio}
        onRow={(n, value) => {
          setAudio((prev) => ({ ...prev, [n]: value }));
          onChange();
        }}
        defaultChoice={defaultAudio}
        onDefault={(choice) => {
          setDefaultAudio(choice);
          onChange();
        }}
      />
      <TrackRows
        {...shared}
        kind="subtitles"
        tracks={layout.subtitles}
        rows={subtitles}
        onRow={(n, value) => {
          setSubtitles((prev) => ({ ...prev, [n]: value }));
          onChange();
        }}
        defaultChoice={defaultSubtitle}
        onDefault={(choice) => {
          setDefaultSubtitle(choice);
          onChange();
        }}
      />
      <div>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save names and defaults"}
        </button>
      </div>
    </form>
  );
}

/** A key that changes whenever the server's copy does, so the form restarts from it. */
function formKey(naming: TrackNaming, layout: TrackLayout): string {
  return JSON.stringify([naming, layout.audio.length, layout.subtitles.length]);
}

// ---------------------------------------------------------------------------------------------
// Folder (series or season)

export function FolderTracksPanel({ folderId, inheritsFrom }: { folderId: string; inheritsFrom: string | null }) {
  const query = useFolderTracks(folderId);
  const read = useReadFolderTracks(folderId);
  const save = useSaveFolderTracks(folderId);
  const data = query.data;

  const groups = data?.report.groups ?? [];
  const usual = groups.find((g) => g.usual);
  const others = groups.filter((g) => !g.usual);
  const readCount = groups.reduce((sum, g) => sum + g.videos.length, 0);
  const unread = data?.report.unread ?? [];
  const failed = data?.report.failed ?? [];

  const status = data
    ? [
        `${readCount} read`,
        data.reading > 0 ? `${data.reading} file${data.reading === 1 ? "" : "s"} still being read` : null,
        unread.length > 0 ? `${unread.length} not read yet` : null,
        failed.length > 0 ? `${failed.length} couldn't be read` : null,
      ].filter((part): part is string => !!part)
    : [];

  return (
    <section className="mb-8 rounded-lg border border-divider p-4" aria-labelledby="tracks-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="tracks-heading" className="text-sm font-semibold text-white">
          Audio &amp; subtitles
        </h2>
        <button type="button" onClick={() => read.mutate()} disabled={read.isPending || !data} className={BUTTON}>
          {read.isPending ? "Queuing…" : "Read tracks again"}
        </button>
      </div>

      {query.isLoading && <p className="text-sm text-text-tertiary">Loading…</p>}
      {query.error && <p className="text-sm text-red-400">{query.error.message}</p>}

      {data && (
        <div className="grid gap-5">
          <div aria-live="polite">
            <p className="text-sm text-text-secondary">
              {readCount + unread.length + failed.length === 0
                ? "No videos below this folder yet."
                : status.join(" · ")}
            </p>
            {read.data && !read.error && (
              <p className="mt-1 text-sm text-live">
                Queued {read.data.queued} file{read.data.queued === 1 ? "" : "s"} to be read again.
              </p>
            )}
            {read.error && <p className="mt-1 text-sm text-red-400">{read.error.message}</p>}
            {failed.length > 0 && (
              <ul className="mt-2 grid gap-1 text-sm">
                {failed.map((video) => (
                  <li key={video.id} className="min-w-0">
                    <Link to={`/admin/catalog/video/${video.id}`} className="text-white/90 underline-offset-2 hover:underline">
                      {episodeName(video)}
                    </Link>
                    <span className="text-danger"> — {video.error}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {usual && others.length === 0 && (
            <p className="text-sm text-live">
              {readCount === 1
                ? `The one episode read so far: ${layoutSummary(usual)}.`
                : `All ${readCount} episodes${unread.length + failed.length > 0 ? " read so far" : ""} have the same audio and subtitles — ${layoutSummary(usual)}.`}
            </p>
          )}

          {usual && others.length > 0 && (
            <div className="rounded-md border border-amber/40 bg-amber/10 p-3" role="alert">
              <p className="text-sm font-semibold text-amber">
                {readCount - usual.videos.length} of {readCount} episodes have different audio or subtitles from the
                rest
              </p>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                Most episodes ({usual.videos.length}) have {layoutSummary(usual)}. Names and defaults go by track
                position, so the episodes below can start in the wrong language or show the wrong names. Getting the
                same release for every episode fixes it.
              </p>
              <div className="mt-3 grid gap-3">
                {others.map((group, i) => (
                  <div key={i} className="border-t border-amber/20 pt-3">
                    <p className="text-sm text-white">
                      {group.differences.length > 0 ? group.differences.join(" · ") : layoutSummary(group)}
                    </p>
                    <p className="text-xs text-text-tertiary">
                      {group.videos.length} episode{group.videos.length === 1 ? "" : "s"} · {layoutSummary(group)}
                    </p>
                    <EpisodeLinks videos={group.videos} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.usual && (
            <div className="border-t border-divider pt-4">
              <p className="mb-1 text-sm text-text-secondary">
                Names and defaults for the episodes below this folder. One episode can still override them on its own
                page.
              </p>
              {/* The server stamps each name with the language its position held when saved and
                  applies it only where an episode's track there matches, so a differently laid
                  out episode can't inherit the wrong name. */}
              {others.length > 0 && usual && (
                <p className="mb-1 text-sm text-amber">
                  These names apply to the {usual.videos.length} episode{usual.videos.length === 1 ? "" : "s"} laid out
                  like this. Episodes listed as different keep their own; name those on their own pages.
                </p>
              )}
              <p className="mb-4 text-xs text-text-tertiary">
                {inheritsFrom
                  ? `Anything left empty here comes from ${inheritsFrom}, then from the file itself.`
                  : "Anything left empty comes from the file itself."}
              </p>
              <TrackNamingForm
                key={formKey(data.naming, data.usual)}
                idPrefix={`folder-${folderId}`}
                layout={data.usual}
                effective={data.effective}
                naming={data.naming}
                inherited={data.inherited}
                inheritsFrom={inheritsFrom}
                saving={save.isPending}
                onSave={(naming) => save.mutate(naming)}
                onChange={() => save.reset()}
              />
              <div aria-live="polite">
                {save.error && <p className="mt-2 text-sm text-red-400">{save.error.message}</p>}
                {save.isSuccess && <p className="mt-2 text-sm text-live">Saved.</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// One video

export function VideoTracksPanel({ fileId }: { fileId: string }) {
  const query = useVideoTracks(fileId);
  const read = useReadVideoTracks(fileId);
  const save = useSaveVideoTracks(fileId);
  const data = query.data;
  const tracks = data?.tracks ?? null;
  // A video inherits from every folder above it, the series being the one an admin thinks of.
  const inheritsFrom = data?.series ? `${data.series.title}'s series and season settings` : null;

  const readButton = (
    <button type="button" onClick={() => read.mutate()} disabled={read.isPending || !data} className={BUTTON}>
      {read.isPending ? "Reading…" : tracks ? "Read again" : "Read now"}
    </button>
  );

  return (
    <section className="mt-8 rounded-lg border border-divider p-4" aria-labelledby="video-tracks-heading">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="video-tracks-heading" className="text-sm font-semibold text-white">
          Audio &amp; subtitles
        </h2>
        {readButton}
      </div>

      {query.isLoading && <p className="text-sm text-text-tertiary">Loading…</p>}
      {query.error && <p className="text-sm text-red-400">{query.error.message}</p>}
      <div aria-live="polite">{read.error && <p className="mb-2 text-sm text-red-400">{read.error.message}</p>}</div>

      {data && !tracks && (
        <p className="text-sm text-text-secondary">
          This file&apos;s tracks haven&apos;t been read yet
          {data.reading > 0 ? ` — ${data.reading} file${data.reading === 1 ? " is" : "s are"} queued to be read` : ""}.
          Reading takes a few seconds.
        </p>
      )}

      {tracks?.error && (
        <p className="text-sm text-danger">
          Couldn&apos;t read this file: {tracks.error}
        </p>
      )}

      {data && tracks && !tracks.error && (
        <div className="grid gap-4">
          <p className="text-xs text-text-tertiary">
            Read {new Date(tracks.readAt).toLocaleString()} · {layoutSummary(tracks)}
          </p>

          {data.differences.length > 0 && data.series && (
            <div className="rounded-md border border-amber/40 bg-amber/10 p-3" role="alert">
              <p className="text-sm text-amber">
                This episode&apos;s tracks differ from most of{" "}
                <Link to={`/admin/catalog/folder/${data.series.id}`} className="font-semibold underline-offset-2 hover:underline">
                  {data.series.title}
                </Link>
                : {data.differences.join("; ")}.
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                The series&apos; names and defaults go by track position, so check them below, or replace this file
                with one that matches the other episodes.
              </p>
            </div>
          )}

          <p className="text-xs text-text-tertiary">
            {inheritsFrom
              ? `Set here, these apply to this file only. Anything left empty comes from ${inheritsFrom}, then from the file itself.`
              : "Anything left empty comes from the file itself."}
          </p>
          <TrackNamingForm
            key={formKey(data.naming, tracks)}
            idPrefix={`video-${fileId}`}
            layout={tracks}
            effective={data.effective}
            naming={data.naming}
            inherited={data.inherited}
            inheritsFrom={data.series?.title ?? null}
            saving={save.isPending}
            onSave={(naming) => save.mutate(naming)}
            onChange={() => save.reset()}
          />
          <div aria-live="polite">
            {save.error && <p className="text-sm text-red-400">{save.error.message}</p>}
            {save.isSuccess && <p className="text-sm text-live">Saved.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
