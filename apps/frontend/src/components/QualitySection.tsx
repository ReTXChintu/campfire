export type QualitySelection = "auto" | "original" | number;

type Props = {
  availableQualities: { label: string; height: number }[];
  sourceHeight: number | null;
  selection: QualitySelection;
  autoResolvedHeight: number | null;
  onSelect: (value: QualitySelection) => void;
};

// Shared by both SubtitleMenu (native mode) and TrackSettingsMenu (restart mode) — which quality
// is playing is orthogonal to which of those two panels is mounted (that split is about subtitle
// mechanics, not streaming mechanics), so this one section is rendered inside both rather than
// adding a third top-level settings panel. "Original" is always its own entry, separate from the
// ladder (see apps/backend/src/lib/qualityLadder.ts) — real Drive rips are rarely exactly
// 1080/720/etc., so it's the only way back to true zero-transcode passthrough regardless of the
// source's exact resolution.
export default function QualitySection({
  availableQualities,
  sourceHeight,
  selection,
  autoResolvedHeight,
  onSelect,
}: Props) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wide text-white/40">Quality</h3>
      <label className="flex items-center gap-2 text-sm text-white/80">
        <input type="radio" name="quality" checked={selection === "auto"} onChange={() => onSelect("auto")} />
        Auto{selection === "auto" && autoResolvedHeight != null ? ` (${autoResolvedHeight}p)` : ""}
      </label>
      <label className="flex items-center gap-2 text-sm text-white/80">
        <input
          type="radio"
          name="quality"
          checked={selection === "original"}
          onChange={() => onSelect("original")}
        />
        {sourceHeight != null ? `Original (${sourceHeight}p)` : "Original"}
      </label>
      {availableQualities.map((q) => (
        <label key={q.height} className="flex items-center gap-2 text-sm text-white/80">
          <input
            type="radio"
            name="quality"
            checked={selection === q.height}
            onChange={() => onSelect(q.height)}
          />
          {q.label}
        </label>
      ))}
    </section>
  );
}
