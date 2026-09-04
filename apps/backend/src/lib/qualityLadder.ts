// Single source of truth for adjustable-quality streaming (see routes/stream.ts's `h` param and
// remuxToMp4's targetHeight in drive.ts) — clients never hardcode ladder rungs or bitrates, they
// just render whatever availableQualitiesFor() returns via GET /api/probe/:fileId.
export const QUALITY_LADDER = [
  { label: "144p", height: 144 },
  { label: "240p", height: 240 },
  { label: "360p", height: 360 },
  { label: "720p", height: 720 },
  { label: "1080p", height: 1080 },
  { label: "2160p", height: 2160 }, // "4K"
] as const;

const VIDEO_BITRATE_KBPS: Record<number, number> = {
  144: 200,
  240: 400,
  360: 800,
  720: 2500,
  1080: 5000,
  2160: 16000,
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
  return height <= 360 ? 128 : 192;
}

// Strictly less-than — "Original" is always a separate entry (see routes/probe.ts), never
// duplicated as the top ladder rung, since real Drive rips are rarely exactly 1080/720/etc.
// (1088p, 816p, anamorphic sources are common) and a viewer must always be able to get back to
// true zero-transcode passthrough regardless of how oddly-shaped the source is.
export function availableQualitiesFor(
  sourceHeight: number | null,
): { label: string; height: number }[] {
  if (!sourceHeight) return [];
  return QUALITY_LADDER.filter((q) => q.height < sourceHeight).map((q) => ({ ...q }));
}
