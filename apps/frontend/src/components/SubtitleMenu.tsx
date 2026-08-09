
import { CloseIcon } from "./player-icons";

export type SubtitleOption = { index: number; label: string };

type Props = {
  tracks: SubtitleOption[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  open: boolean;
  onClose: () => void;
};

// The native-playback counterpart to TrackSettingsMenu — much simpler, since a converted video
// bakes in exactly one audio track (no switching, no delay controls needed) and its subtitles are
// fully static text already loaded as <track> elements, so selecting one is just picking which
// TextTrack is "showing", not a live re-fetch like the restart-mode path.
export default function SubtitleMenu({ tracks, selectedIndex, onSelect, open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-20 flex justify-end">
      <button
        type="button"
        aria-label="Close subtitles"
        onClick={onClose}
        className="flex-1 cursor-default bg-black/60"
      />
      <div className="flex w-full max-w-sm flex-col gap-5 overflow-y-auto bg-neutral-900/95 p-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white/90">Subtitles</h2>
          <button type="button" onClick={onClose} aria-label="Close subtitles" className="text-white/60 hover:text-white">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-white/80">
            <input type="radio" name="native-subtitle" checked={selectedIndex == null} onChange={() => onSelect(null)} />
            Off
          </label>
          {tracks.map((track) => (
            <label key={track.index} className="flex items-center gap-2 text-sm text-white/80">
              <input
                type="radio"
                name="native-subtitle"
                checked={selectedIndex === track.index}
                onChange={() => onSelect(track.index)}
              />
              {track.label}
            </label>
          ))}
          {tracks.length === 0 && <p className="text-sm text-white/50">No subtitles available.</p>}
        </section>
      </div>
    </div>
  );
}
