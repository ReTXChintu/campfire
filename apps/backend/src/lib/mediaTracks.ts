import { getDb } from "./mongodb";
import { probeFileTracks, type RawTrack, type ConvertedSubtitle } from "./drive";
import { canonicalLanguage, fileLanguage, languageName } from "./languageNames";
import type { CatalogVideo } from "./catalogVideos";
import type { CatalogFolder } from "./catalogFolders";
import { listSubtitleSetsByIds } from "./subtitleSets";
import { env } from "../config/env";

// Audio and subtitle tracks, read from each file once and kept on its catalog doc, so admin can
// see and name them, the details pages can say which languages a title has, a series can be
// checked for episodes whose tracks differ, and every player can start in the viewer's language.
//
// Tracks are numbered per kind from 1 in file order (`n`) — the same numbering mpv gives them in
// the apps (its aid/sid), which is what lets a name or a default chosen in admin be found again
// in the player.

export type FileTrack = RawTrack & { n: number };

export type FileTracks = {
  audio: FileTrack[];
  subtitles: FileTrack[];
  readAt: Date;
  // The Drive size the read was made at: a replaced file (new size) is read again.
  readSize: number | null;
  error: string | null;
};

/** An admin's name for one track position. Either field left empty falls through to what's
 * inherited (season → series) and then to what the file itself says. */
export type TrackName = {
  label?: string | null;
  language?: string | null;
  // Set by the server on a folder's names: the language the file said for this position in the
  // layout the admin was looking at ("?" for none). An episode whose track at this position says
  // something else is a different layout, and the name isn't applied to it (see fitNaming).
  match?: string;
};

/** Stored on a series folder, a season folder or a single video; the nearest one wins per field.
 * For the defaults, absent means "inherit", null means "no default here", and for subtitles 0
 * means "start with subtitles off". The *Match fields work like TrackName.match. */
export type TrackNaming = {
  audio?: Record<string, TrackName>;
  subtitles?: Record<string, TrackName>;
  defaultAudio?: number | null;
  defaultSubtitle?: number | null;
  defaultAudioMatch?: string;
  defaultSubtitleMatch?: string;
};

function positionLanguage(list: FileTrack[] | undefined, n: number): string | undefined {
  const t = list?.find((x) => x.n === n);
  return t ? (fileLanguage(t.language, t.title) ?? "?") : undefined;
}

/** Records, on a folder's naming, what each named position held in the layout it was set on. */
export function stampNaming(naming: TrackNaming, layout: Pick<FileTracks, "audio" | "subtitles"> | null): TrackNaming {
  if (!layout) return naming;
  const out: TrackNaming = { ...naming, audio: {}, subtitles: {} };
  for (const kind of ["audio", "subtitles"] as const) {
    for (const [key, value] of Object.entries(naming[kind] ?? {})) {
      const match = positionLanguage(layout[kind], Number(key));
      out[kind]![key] = match ? { ...value, match } : value;
    }
  }
  const da = naming.defaultAudio ? positionLanguage(layout.audio, naming.defaultAudio) : undefined;
  const ds = naming.defaultSubtitle ? positionLanguage(layout.subtitles, naming.defaultSubtitle) : undefined;
  delete out.defaultAudioMatch;
  delete out.defaultSubtitleMatch;
  if (da) out.defaultAudioMatch = da;
  if (ds) out.defaultSubtitleMatch = ds;
  return out;
}

/** A folder's naming with whatever doesn't fit this file's layout left out. */
export function fitNaming(
  naming: TrackNaming | null | undefined,
  tracks: Pick<FileTracks, "audio" | "subtitles"> | null | undefined,
): TrackNaming | null | undefined {
  if (!naming || !tracks) return naming;
  const fits = (list: FileTrack[], n: number, match: string | undefined) =>
    match === undefined || positionLanguage(list, n) === match;
  const out: TrackNaming = { audio: {}, subtitles: {} };
  for (const kind of ["audio", "subtitles"] as const) {
    for (const [key, value] of Object.entries(naming[kind] ?? {})) {
      if (fits(tracks[kind], Number(key), value.match)) out[kind]![key] = value;
    }
  }
  if (naming.defaultAudio !== undefined && (naming.defaultAudio === null || fits(tracks.audio, naming.defaultAudio, naming.defaultAudioMatch))) {
    out.defaultAudio = naming.defaultAudio;
  }
  if (
    naming.defaultSubtitle !== undefined &&
    (naming.defaultSubtitle === null || naming.defaultSubtitle === 0 || fits(tracks.subtitles, naming.defaultSubtitle, naming.defaultSubtitleMatch))
  ) {
    out.defaultSubtitle = naming.defaultSubtitle;
  }
  return out;
}

/** What a viewer's player is told about one track. */
export type ViewerTrack = {
  n: number;
  label: string;
  language: string | null; // canonical 3-letter code
  languageName: string | null;
  isDefault: boolean;
  forced: boolean;
  codec: string;
  channels: number | null;
};

export type LanguagePrefs = {
  audio: string[]; // canonical codes, most wanted first
  subtitles: string | null; // canonical code
  subtitleMode: "off" | "always" | "foreign"; // foreign: only when the audio isn't one of `audio`
};

// ---------------------------------------------------------------------------------------------
// Naming

/** Merges naming from the farthest ancestor to the nearest (the video itself last). */
export function mergeNaming(chain: (TrackNaming | null | undefined)[]): TrackNaming {
  const merged: TrackNaming = { audio: {}, subtitles: {} };
  for (const naming of chain) {
    if (!naming) continue;
    for (const kind of ["audio", "subtitles"] as const) {
      for (const [key, value] of Object.entries(naming[kind] ?? {})) {
        const prev = merged[kind]![key] ?? {};
        merged[kind]![key] = {
          label: value.label?.trim() ? value.label.trim() : (prev.label ?? null),
          language: value.language ? value.language : (prev.language ?? null),
        };
      }
    }
    if (naming.defaultAudio !== undefined) merged.defaultAudio = naming.defaultAudio;
    if (naming.defaultSubtitle !== undefined) merged.defaultSubtitle = naming.defaultSubtitle;
  }
  return merged;
}

function channelSuffix(channels: number | null): string {
  if (channels === 6) return " 5.1";
  if (channels === 8) return " 7.1";
  if (channels === 1) return " Mono";
  return "";
}

// Rips stamp every track's title with the uploader's handle or site ("@infinite_anime",
// "HDHub4u.Ag", "www.example.com") — never a useful name for a track.
function isReleaseTag(title: string): boolean {
  return /@|www\.|https?:|\.(com|org|net|in|ag|me|to|cc|io|xyz|tv|ms|mx|lol|vip)\b/i.test(title);
}

function autoLabel(kind: "audio" | "subtitles", track: FileTrack, language: string | null): string {
  const name = language ? (languageName(language) ?? language) : null;
  const title = track.title && !isReleaseTag(track.title) ? track.title : null;
  let base = name ?? title ?? `Track ${track.n}`;
  if (kind === "audio") {
    if (title && /commentary/i.test(title) && !/commentary/i.test(base)) base += " (Commentary)";
    return base + channelSuffix(track.channels);
  }
  if (track.forced || (title && /\bforced\b/i.test(title))) base += " (Forced)";
  else if (title && /\b(sdh|cc)\b/i.test(title)) base += " (SDH)";
  return base;
}

/** The tracks as viewers see them: an admin's names where set, the file's own tags otherwise. */
export function effectiveTracks(
  tracks: Pick<FileTracks, "audio" | "subtitles"> | null | undefined,
  naming: TrackNaming,
): { audio: ViewerTrack[]; subtitles: ViewerTrack[] } {
  const build = (kind: "audio" | "subtitles"): ViewerTrack[] => {
    const list = tracks?.[kind] ?? [];
    const names = naming[kind] ?? {};
    const adminDefault = kind === "audio" ? naming.defaultAudio : naming.defaultSubtitle;
    const hasAdminDefault = adminDefault != null && list.some((t) => t.n === adminDefault);
    const seen = new Map<string, number>();
    return list.map((t) => {
      const named = names[String(t.n)] ?? {};
      const language = canonicalLanguage(named.language) ?? fileLanguage(t.language, t.title);
      let label = named.label?.trim() || null;
      if (!label) {
        // Three tracks that all read "English" get numbered until someone names them.
        const auto = autoLabel(kind, t, language);
        const count = (seen.get(auto) ?? 0) + 1;
        seen.set(auto, count);
        label = count > 1 ? `${auto} ${count}` : auto;
      }
      return {
        n: t.n,
        label,
        language,
        languageName: language ? (languageName(language) ?? language) : null,
        isDefault: hasAdminDefault ? t.n === adminDefault : t.isDefault,
        forced: t.forced,
        codec: t.codec,
        channels: t.channels,
      };
    });
  };
  return { audio: build("audio"), subtitles: build("subtitles") };
}

// ---------------------------------------------------------------------------------------------
// Folder chains

async function folderCollection() {
  const db = await getDb();
  return db.collection<CatalogFolder>("catalogFolders");
}
async function videoCollection() {
  const db = await getDb();
  return db.collection<CatalogVideo>("catalogVideos");
}

/** The folders above a video or folder, nearest first, stopping below the library root. */
export async function ancestorFolders(parentFolderId: string): Promise<CatalogFolder[]> {
  const col = await folderCollection();
  const chain: CatalogFolder[] = [];
  let id: string | null = parentFolderId;
  while (id && id !== env.driveRootFolderId && chain.length < 6) {
    const folder: CatalogFolder | null = await col.findOne({ _id: id });
    if (!folder) break;
    chain.push(folder);
    id = folder.parentFolderId;
  }
  return chain;
}

/** A video's naming with everything above it folded in. */
export async function namingForVideo(video: Pick<CatalogVideo, "parentFolderId" | "trackNaming" | "tracks">): Promise<{
  merged: TrackNaming;
  inherited: TrackNaming;
  folders: CatalogFolder[];
}> {
  const folders = await ancestorFolders(video.parentFolderId);
  const inherited = mergeNaming(folders.map((f) => fitNaming(f.trackNaming, video.tracks)).reverse());
  return { merged: mergeNaming([inherited, video.trackNaming]), inherited, folders };
}

/** Every folder at or below `folderId` (the series, then its seasons). */
export async function folderTree(folderId: string): Promise<CatalogFolder[]> {
  const col = await folderCollection();
  const root = await col.findOne({ _id: folderId });
  if (!root) return [];
  const all = [root];
  let frontier = [root._id];
  for (let depth = 0; depth < 4 && frontier.length > 0; depth++) {
    const children = await col.find({ parentFolderId: { $in: frontier } }).toArray();
    all.push(...children);
    frontier = children.map((c) => c._id);
  }
  return all;
}

// ---------------------------------------------------------------------------------------------
// Consistency

/** A layout's identity: the languages of its tracks in order (codecs and channel counts don't
 * matter to a viewer; a missing or reordered language does, since naming is by position). */
function signature(tracks: Pick<FileTracks, "audio" | "subtitles">): string {
  const part = (list: FileTrack[]) => list.map((t) => fileLanguage(t.language, t.title) ?? "?").join(",");
  return `${part(tracks.audio)}|${part(tracks.subtitles)}`;
}

function languagesOf(list: FileTrack[]): string[] {
  return list.map((t) => fileLanguage(t.language, t.title) ?? "?");
}

function nameOf(code: string): string {
  return code === "?" ? "an untagged track" : (languageName(code) ?? code);
}

/** What one layout has that the usual one doesn't, in words. */
export function describeDifference(
  usual: Pick<FileTracks, "audio" | "subtitles">,
  other: Pick<FileTracks, "audio" | "subtitles">,
): string[] {
  const out: string[] = [];
  for (const [kind, word] of [["audio", "Audio"], ["subtitles", "Subtitles"]] as const) {
    const a = languagesOf(usual[kind]);
    const b = languagesOf(other[kind]);
    if (a.join(",") === b.join(",")) continue;
    const count = (list: string[]) => list.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});
    const ca = count(a);
    const cb = count(b);
    // A language gone altogether reads "no Hindi"; one with fewer or more tracks than usual reads
    // "2 English, not 3" (three English subtitle tracks are common: full, signs & songs, SDH).
    const missing = Object.keys(ca).filter((c) => !cb[c]);
    const extra = Object.keys(cb).filter((c) => !ca[c]);
    const counted = Object.keys(ca).filter((c) => cb[c] && cb[c] !== ca[c]);
    const bits: string[] = [];
    if (b.length === 0) bits.push(kind === "audio" ? "no audio tracks" : "no subtitles");
    else {
      if (missing.length > 0) bits.push(`no ${missing.map(nameOf).join(", ")}`);
      if (extra.length > 0) bits.push(`extra ${extra.map(nameOf).join(", ")}`);
      for (const c of counted) bits.push(`${cb[c]} ${nameOf(c)}, not ${ca[c]}`);
      if (bits.length === 0) bits.push(`same languages in a different order (${b.map(nameOf).join(", ")})`);
    }
    out.push(`${word}: ${bits.join("; ")}`);
  }
  return out;
}

export type ReportVideo = { id: string; title: string; season: string | null; status: CatalogVideo["status"] };

export type TrackReport = {
  groups: {
    usual: boolean;
    audio: FileTrack[];
    subtitles: FileTrack[];
    differences: string[];
    videos: ReportVideo[];
  }[];
  unread: ReportVideo[];
  failed: (ReportVideo & { error: string })[];
};

/** Groups every video at or below a folder by its track layout; the biggest group is "usual". */
export async function trackReport(folderId: string): Promise<{ report: TrackReport; videos: CatalogVideo[] }> {
  const folders = await folderTree(folderId);
  const folderTitle = new Map(folders.map((f) => [f._id, f.title ?? f.driveName]));
  const col = await videoCollection();
  const videos = await col.find({ parentFolderId: { $in: folders.map((f) => f._id) } }).toArray();
  const order = (v: CatalogVideo) => `${folderTitle.get(v.parentFolderId) ?? ""}\u0000${String(v.episodeOrder ?? 9999).padStart(5, "0")}\u0000${v.driveName}`;
  videos.sort((a, b) => order(a).localeCompare(order(b), undefined, { numeric: true }));
  const row = (v: CatalogVideo): ReportVideo => ({
    id: v._id,
    title: v.title ?? v.driveName,
    season: v.parentFolderId === folderId ? null : (folderTitle.get(v.parentFolderId) ?? null),
    status: v.status,
  });

  const groups = new Map<string, { tracks: FileTracks; videos: ReportVideo[] }>();
  const unread: ReportVideo[] = [];
  const failed: (ReportVideo & { error: string })[] = [];
  for (const v of videos) {
    if (!v.tracks) unread.push(row(v));
    else if (v.tracks.error) failed.push({ ...row(v), error: v.tracks.error });
    else {
      const key = signature(v.tracks);
      const group = groups.get(key) ?? { tracks: v.tracks, videos: [] };
      group.videos.push(row(v));
      groups.set(key, group);
    }
  }
  const sorted = [...groups.values()].sort((a, b) => b.videos.length - a.videos.length);
  const usual = sorted[0]?.tracks;
  return {
    videos,
    report: {
      groups: sorted.map((g, i) => ({
        usual: i === 0,
        audio: g.tracks.audio,
        subtitles: g.tracks.subtitles,
        differences: i === 0 || !usual ? [] : describeDifference(usual, g.tracks),
        videos: g.videos,
      })),
      unread,
      failed,
    },
  };
}

/** The topmost folder above a video (the series), or null for a film at the library root. */
export function seriesFolderOf(folders: CatalogFolder[]): CatalogFolder | null {
  return folders.length > 0 ? folders[folders.length - 1] : null;
}

/** How one video's tracks differ from the rest of its series, or [] when they don't. */
export async function differenceFromSeries(video: CatalogVideo, series: CatalogFolder | null): Promise<string[]> {
  if (!series || !video.tracks || video.tracks.error) return [];
  const { report } = await trackReport(series._id);
  const usual = report.groups.find((g) => g.usual);
  if (!usual || usual.videos.some((v) => v.id === video._id)) return [];
  return describeDifference(usual, video.tracks);
}

// ---------------------------------------------------------------------------------------------
// Reading files

const STALE_ERROR_MS = 24 * 60 * 60 * 1000;
const PARALLEL_READS = 2;
const queue = new Set<string>();
let active = 0;

/** Reads one file's tracks now and stores them. */
export async function readTracks(fileId: string): Promise<FileTracks> {
  const col = await videoCollection();
  const video = await col.findOne({ _id: fileId }, { projection: { sizeBytes: 1 } });
  let tracks: FileTracks;
  try {
    const raw = await probeFileTracks(fileId);
    tracks = {
      audio: raw.audio.map((t, i) => ({ ...t, n: i + 1 })),
      subtitles: raw.subtitles.map((t, i) => ({ ...t, n: i + 1 })),
      readAt: new Date(),
      readSize: video?.sizeBytes ?? null,
      error: null,
    };
  } catch (error) {
    tracks = {
      audio: [],
      subtitles: [],
      readAt: new Date(),
      readSize: video?.sizeBytes ?? null,
      error: error instanceof Error ? error.message : "Could not read the file",
    };
  }
  await col.updateOne({ _id: fileId }, { $set: { tracks } });
  return tracks;
}

function pump() {
  while (active < PARALLEL_READS && queue.size > 0) {
    const fileId = queue.values().next().value as string;
    queue.delete(fileId);
    active++;
    readTracks(fileId)
      .catch((error) => console.error(`Tracks: reading ${fileId} failed:`, error))
      .finally(() => {
        active--;
        pump();
      });
  }
}

/** Queues files to be read in the background, two at a time. */
export function queueTrackReads(fileIds: string[]): number {
  for (const id of fileIds) queue.add(id);
  pump();
  return fileIds.length;
}

/** Files still waiting to be read (or being read). */
export function pendingTrackReads(): number {
  return queue.size + active;
}

/** Queues every file never read, replaced since (size changed), or that failed over a day ago. */
export async function queueStaleTrackReads(): Promise<number> {
  const col = await videoCollection();
  const stale = await col
    .find(
      {
        $or: [
          { tracks: { $exists: false } },
          { tracks: null },
          { $expr: { $ne: ["$tracks.readSize", "$sizeBytes"] } },
          { "tracks.error": { $ne: null }, "tracks.readAt": { $lt: new Date(Date.now() - STALE_ERROR_MS) } },
        ],
      },
      { projection: { _id: 1 } },
    )
    .toArray();
  return queueTrackReads(stale.map((v) => v._id));
}

// ---------------------------------------------------------------------------------------------
// What a title has, for the details pages

export type TitleLanguage = { code: string; name: string; partial: boolean };
export type TitleLanguages = { audio: TitleLanguage[]; subtitles: TitleLanguage[] };

/**
 * The languages across a set of videos (a film's one file, or every episode of a series).
 * `partial` marks a language only some of them have. Uploaded subtitle files count as
 * subtitles. Null until at least one of them has been read.
 */
export function titleLanguages(
  entries: { audio: ViewerTrack[]; subtitles: ViewerTrack[]; external: ConvertedSubtitle[] }[],
): TitleLanguages | null {
  if (entries.length === 0) return null;
  const tally = (pick: (e: (typeof entries)[number]) => (string | null)[]): TitleLanguage[] => {
    const counts = new Map<string, number>();
    for (const e of entries) for (const code of new Set(pick(e).filter((c): c is string => !!c))) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => ({ code, name: languageName(code) ?? code, partial: n < entries.length }));
  };
  return {
    audio: tally((e) => e.audio.map((t) => t.language)),
    subtitles: tally((e) => [
      ...e.subtitles.filter((t) => !t.forced).map((t) => t.language),
      ...e.external.map((s) => fileLanguage(s.language, s.title)),
    ]),
  };
}

/** Languages across every published episode of a published series (or folder). */
export async function folderLanguages(folderId: string): Promise<TitleLanguages | null> {
  const tree = (await folderTree(folderId)).filter((f) => f.status === "published");
  if (tree.length === 0) return null;
  const byId = new Map(tree.map((f) => [f._id, f]));
  const above = await ancestorFolders(tree[0].parentFolderId);
  const col = await videoCollection();
  const videos = await col
    .find(
      { parentFolderId: { $in: tree.map((f) => f._id) }, status: "published", "tracks.error": null },
      { projection: { parentFolderId: 1, tracks: 1, trackNaming: 1, subtitleSetIds: 1 } },
    )
    .toArray();
  const read = videos.filter((v) => v.tracks);
  if (read.length === 0) return null;
  const sets = await listSubtitleSetsByIds(read.flatMap((v) => v.subtitleSetIds ?? []));
  const setById = new Map(sets.map((s) => [String(s._id), s]));
  const chainFor = (parentId: string, tracks: FileTracks): (TrackNaming | null | undefined)[] => {
    const chain: CatalogFolder[] = [];
    let id: string | undefined = parentId;
    while (id && byId.has(id)) {
      chain.push(byId.get(id)!);
      id = byId.get(id)!.parentFolderId;
    }
    return [...above, ...chain].reverse().map((f) => fitNaming(f.trackNaming, tracks));
  };
  return titleLanguages(
    read.map((v) => ({
      ...effectiveTracks(v.tracks, mergeNaming([...chainFor(v.parentFolderId, v.tracks!), v.trackNaming])),
      external: (v.subtitleSetIds ?? []).flatMap((id) => setById.get(id)?.subtitles ?? []),
    })),
  );
}

// ---------------------------------------------------------------------------------------------
// Which tracks a player starts on

type SavedPreference = {
  subtitleSource?: string | null;
  subtitleIndex?: number | null;
  subtitleLanguage?: string | null;
  subtitleTitle?: string | null;
  audioLanguage?: string | null;
  audioTitle?: string | null;
} | null;

export type StartSubtitle = { source: "off" } | { source: "embedded"; n: number } | { source: "external"; index: number };

function findAudio(audio: ViewerTrack[], raw: FileTrack[], language: string | null | undefined, title: string | null | undefined): number | null {
  if (!language && !title) return null;
  const exact = raw.find((t) => t.language === (language ?? null) && t.title === (title ?? null));
  if (exact) return exact.n;
  const wanted = canonicalLanguage(language);
  if (wanted) {
    const same = audio.filter((t) => t.language === wanted);
    return (same.find((t) => raw.find((r) => r.n === t.n)?.title === title) ?? same[0])?.n ?? null;
  }
  return raw.find((t) => t.title === title)?.n ?? null;
}

function findSubtitle(
  subtitles: ViewerTrack[],
  external: ConvertedSubtitle[],
  language: string | null,
  preferEmbedded = true,
): StartSubtitle | null {
  const wanted = canonicalLanguage(language);
  if (!wanted) return null;
  const embedded = subtitles.find((t) => t.language === wanted && !t.forced);
  const uploaded = external.find((s) => fileLanguage(s.language, s.title) === wanted);
  const a: StartSubtitle | null = embedded ? { source: "embedded", n: embedded.n } : null;
  const b: StartSubtitle | null = uploaded ? { source: "external", index: uploaded.index } : null;
  return preferEmbedded ? (a ?? b) : (b ?? a);
}

/**
 * The audio and subtitles to start on, first match wins:
 *   1. what the viewer picked on this video,
 *   2. what they last picked elsewhere in the series,
 *   3. their profile's languages,
 *   4. the default an admin marked,
 *   5. nothing (null) — the file's own default, as before.
 */
export function startTracks(input: {
  raw: Pick<FileTracks, "audio" | "subtitles"> | null;
  audio: ViewerTrack[];
  subtitles: ViewerTrack[];
  external: ConvertedSubtitle[];
  own: SavedPreference;
  series: { audio: SavedPreference; subtitles: SavedPreference };
  profile: LanguagePrefs | null;
  naming: TrackNaming;
}): { audio: number | null; subtitle: StartSubtitle | null } {
  const { raw, audio, subtitles, external, own, series, profile, naming } = input;
  const rawAudio = raw?.audio ?? [];
  const rawSubs = raw?.subtitles ?? [];

  let startAudio: number | null =
    findAudio(audio, rawAudio, own?.audioLanguage, own?.audioTitle) ??
    findAudio(audio, rawAudio, series.audio?.audioLanguage, series.audio?.audioTitle);
  if (startAudio == null && profile) {
    for (const code of profile.audio) {
      const hit = audio.find((t) => t.language === code);
      if (hit) {
        startAudio = hit.n;
        break;
      }
    }
  }
  if (startAudio == null && naming.defaultAudio != null && audio.some((t) => t.n === naming.defaultAudio)) {
    startAudio = naming.defaultAudio;
  }

  const fromSaved = (p: SavedPreference, ownVideo: boolean): StartSubtitle | null => {
    if (!p?.subtitleSource) return null;
    if (p.subtitleSource === "off") return { source: "off" };
    if (p.subtitleSource === "external") {
      const byIndex = ownVideo && p.subtitleIndex != null ? external.find((s) => s.index === p.subtitleIndex) : undefined;
      const byName = external.find((s) => s.language === (p.subtitleLanguage ?? null) && s.title === (p.subtitleTitle ?? null));
      const hit = byIndex ?? byName;
      if (hit) return { source: "external", index: hit.index };
      return findSubtitle(subtitles, external, p.subtitleLanguage ?? fileLanguage(null, p.subtitleTitle ?? null), false);
    }
    if (p.subtitleSource === "embedded") {
      // Files often carry several tracks with identical tags (three English tracks all titled
      // with the uploader's handle), so the pick's position — `subtitleIndex` holds its n — comes
      // first: on this video as is, on another episode when that position has the same language.
      if (p.subtitleIndex != null) {
        const at = subtitles.find((t) => t.n === p.subtitleIndex);
        const wanted = canonicalLanguage(p.subtitleLanguage) ?? fileLanguage(null, p.subtitleTitle ?? null);
        if (at && (ownVideo || (wanted != null && at.language === wanted))) return { source: "embedded", n: at.n };
      }
      const exact = rawSubs.find((t) => t.language === (p.subtitleLanguage ?? null) && t.title === (p.subtitleTitle ?? null));
      if (exact) return { source: "embedded", n: exact.n };
      return findSubtitle(subtitles, external, p.subtitleLanguage ?? fileLanguage(null, p.subtitleTitle ?? null));
    }
    return null;
  };

  let startSubtitle: StartSubtitle | null = fromSaved(own, true) ?? fromSaved(series.subtitles, false);
  if (!startSubtitle && profile && profile.subtitleMode !== "always" && profile.subtitleMode !== "foreign") {
    startSubtitle = { source: "off" };
  }
  if (!startSubtitle && profile && profile.subtitles) {
    const playing = audio.find((t) => t.n === startAudio) ?? audio.find((t) => t.isDefault) ?? audio[0];
    const understood = profile.subtitleMode === "foreign" && playing?.language != null && profile.audio.includes(playing.language);
    startSubtitle = understood ? { source: "off" } : findSubtitle(subtitles, external, profile.subtitles);
  }
  if (!startSubtitle && naming.defaultSubtitle != null) {
    if (naming.defaultSubtitle === 0) startSubtitle = { source: "off" };
    else if (subtitles.some((t) => t.n === naming.defaultSubtitle)) startSubtitle = { source: "embedded", n: naming.defaultSubtitle };
  }
  return { audio: startAudio, subtitle: startSubtitle };
}

// ---------------------------------------------------------------------------------------------
// Input checking (admin naming, viewer profile)

const MAX_TRACKS = 64;
const LABEL_MAX = 60;

export function parseNaming(body: unknown): TrackNaming | string {
  if (!body || typeof body !== "object") return "Expected an object";
  const input = body as Record<string, unknown>;
  const out: TrackNaming = { audio: {}, subtitles: {} };
  for (const kind of ["audio", "subtitles"] as const) {
    const entries = input[kind];
    if (entries === undefined || entries === null) continue;
    if (typeof entries !== "object") return `${kind} must be an object`;
    for (const [key, value] of Object.entries(entries as Record<string, unknown>)) {
      const n = Number(key);
      if (!Number.isInteger(n) || n < 1 || n > MAX_TRACKS) return `Bad track number ${key}`;
      if (!value || typeof value !== "object") return `Bad entry for ${kind} ${key}`;
      const { label, language } = value as { label?: unknown; language?: unknown };
      if (label != null && typeof label !== "string") return "label must be text";
      if (language != null && typeof language !== "string") return "language must be a code";
      const cleanLabel = typeof label === "string" && label.trim() ? label.trim().slice(0, LABEL_MAX) : null;
      let cleanLanguage: string | null = null;
      if (typeof language === "string" && language.trim()) {
        if (!/^[a-z]{2,3}$/i.test(language.trim())) return `Unknown language code ${language}`;
        cleanLanguage = canonicalLanguage(language);
      }
      if (cleanLabel || cleanLanguage) out[kind]![String(n)] = { label: cleanLabel, language: cleanLanguage };
    }
  }
  for (const key of ["defaultAudio", "defaultSubtitle"] as const) {
    if (!(key in input)) continue;
    const value = input[key];
    if (value === null) out[key] = null;
    else if (value === undefined) continue;
    else {
      const n = Number(value);
      const min = key === "defaultSubtitle" ? 0 : 1;
      if (!Number.isInteger(n) || n < min || n > MAX_TRACKS) return `Bad ${key}`;
      out[key] = n;
    }
  }
  return out;
}

export function parseLanguagePrefs(body: unknown): LanguagePrefs | string {
  if (!body || typeof body !== "object") return "Expected an object";
  const { audio, subtitles, subtitleMode } = body as Record<string, unknown>;
  if (!Array.isArray(audio) || audio.length > 3) return "audio must be a list of up to three languages";
  const codes: string[] = [];
  for (const code of audio) {
    const c = typeof code === "string" && /^[a-z]{2,3}$/i.test(code) ? canonicalLanguage(code) : null;
    if (!c) return `Unknown language code ${String(code)}`;
    if (!codes.includes(c)) codes.push(c);
  }
  let sub: string | null = null;
  if (subtitles != null) {
    sub = typeof subtitles === "string" && /^[a-z]{2,3}$/i.test(subtitles) ? canonicalLanguage(subtitles) : null;
    if (!sub) return "Unknown subtitle language";
  }
  if (subtitleMode !== "off" && subtitleMode !== "always" && subtitleMode !== "foreign") return "Bad subtitleMode";
  if (subtitleMode !== "off" && !sub) return "Pick a subtitle language";
  return { audio: codes, subtitles: sub, subtitleMode };
}

/** Languages to offer in pickers: common ones plus every language found in the library. */
const COMMON = ["eng", "hin", "tam", "tel", "mal", "kan", "ben", "mar", "guj", "pan", "urd", "jpn", "kor", "spa", "fra", "deu", "zho", "rus", "ara", "por", "ita", "tur", "tha"];

export async function languageOptions(): Promise<{ code: string; name: string; inLibrary: boolean }[]> {
  const col = await videoCollection();
  const found = new Set<string>();
  const docs = await col.find({ "tracks.error": null }, { projection: { "tracks.audio": 1, "tracks.subtitles": 1 } }).toArray();
  for (const d of docs) {
    for (const t of [...(d.tracks?.audio ?? []), ...(d.tracks?.subtitles ?? [])]) {
      const code = fileLanguage(t.language, t.title);
      if (code) found.add(code);
    }
  }
  const all = new Set([...COMMON, ...found]);
  return [...all]
    .map((code) => ({ code, name: languageName(code) ?? code, inLibrary: found.has(code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
