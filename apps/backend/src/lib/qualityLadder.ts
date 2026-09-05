// Single source of truth for adjustable-quality streaming. Unlike the earlier live-transcode
// design, quality tiers are now pre-generated once (see lib/renditions.ts, admin-triggered) and
// served as plain files from disk (routes/stream.ts's `h` param) — so the ladder is deliberately
// small: just the handful of tiers actually worth storing a permanent extra copy of per video,
// not a full 144p-4K spread. "Original" is always available separately via zero-cost Drive
// passthrough (see routes/stream.ts), so a source above 1080p never needs its own stored rendition
// — passthrough already serves it at full/native resolution for free.
export const QUALITY_LADDER = [
  { label: "480p", height: 480 },
  { label: "720p", height: 720 },
  { label: "1080p", height: 1080 },
] as const;

export type RenditionHeight = (typeof QUALITY_LADDER)[number]["height"];

const VIDEO_BITRATE_KBPS: Record<number, number> = {
  480: 1200,
  720: 2500,
  1080: 5000,
};

// Ballpark, personal-app-grade numbers — not tuned to a formal ABR spec. Falls back to a linear
// scale-down from the nearest known rung for any height that isn't exactly on the ladder (shouldn't
// happen in practice since targetHeight always comes from QUALITY_LADDER, but stay safe regardless).
export function videoBitrateKbpsFor(height: number): number {
  const exact = VIDEO_BITRATE_KBPS[height];
  if (exact) return exact;
  const nearest = QUALITY_LADDER.reduce((best, q) =>
    Math.abs(q.height - height) < Math.abs(best.height - height) ? q : best,
  );
  return Math.max(150, Math.round((VIDEO_BITRATE_KBPS[nearest.height] * height) / nearest.height));
}

export function audioBitrateKbpsFor(height: number): number {
  return height <= 480 ? 128 : 192;
}

// Strictly less-than — "Original" is always a separate entry (see routes/probe.ts), never
// duplicated as the top ladder rung, since real Drive rips are rarely exactly 1080/720/etc.
// (1088p, 816p, anamorphic sources are common) and a viewer must always be able to get back to
// true zero-transcode passthrough regardless of how oddly-shaped the source is. This is the
// theoretical set a video's resolution *permits* storing — routes/probe.ts further filters this
// down to whichever of these tiers actually have a generated (status "done") file on disk.
export function storableTiersFor(sourceHeight: number | null): { label: string; height: RenditionHeight }[] {
  if (!sourceHeight) return [];
  return QUALITY_LADDER.filter((q) => q.height < sourceHeight).map((q) => ({ ...q }));
}
