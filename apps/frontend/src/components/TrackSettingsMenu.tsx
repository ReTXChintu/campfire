import { useState } from "react";
import type { ProbeResult } from "../lib/types";
import { CloseIcon } from "./player-icons";
import { trackLabel } from "../lib/languageNames";

type Props = {
  probe: ProbeResult | null;
  audioIndex: number | null;
  subtitleIndex: number | null;
  audioDelayMs: number;
  subtitleDelayMs: number;
  onSelectAudio: (index: number | null) => void;
  onSelectSubtitle: (index: number | null) => void;
  onCommitAudioDelay: (ms: number) => void;
  onSubtitleDelay: (ms: number) => void;
  open: boolean;
  onClose: () => void;
};

const AUDIO_DELAY_MIN = -5000;
const AUDIO_DELAY_MAX = 5000;
const SUBTITLE_DELAY_MIN = -10000;
const SUBTITLE_DELAY_MAX = 10000;

export default function TrackSettingsMenu({
  probe,
  audioIndex,
  subtitleIndex,
  audioDelayMs,
  subtitleDelayMs,
  onSelectAudio,
  onSelectSubtitle,
  onCommitAudioDelay,
  onSubtitleDelay,
  open,
  onClose,
}: Props) {
  // Audio delay must only restart the stream on release (each tick would kill/respawn ffmpeg),
  // mirroring the same draft-until-commit pattern the seek bar uses.
  const [audioDelayDraft, setAudioDelayDraft] = useState(audioDelayMs);
  const commitAudioDelay = () => onCommitAudioDelay(audioDelayDraft);

  if (!open) return null;

  const hasAudioTracks = (probe?.audioTracks.length ?? 0) > 0;
  const hasSubtitleTracks = (probe?.subtitleTracks.length ?? 0) > 0;

  return (
    <div className="absolute inset-0 z-20 flex justify-end">
      <button
        type="button"
        aria-label="Close settings"
        onClick={onClose}
        className="flex-1 cursor-default bg-black/60"
      />
      <div className="flex w-full max-w-sm flex-col gap-5 overflow-y-auto bg-neutral-900/95 p-4 backdrop-blur">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white/90">Settings</h2>
          <button type="button" onClick={onClose} aria-label="Close settings" className="text-white/60 hover:text-white">
            <CloseIcon className="h-5 w-5" />
          </button>
        </div>

        {!probe && <p className="text-sm text-white/50">Loading tracks…</p>}

        {probe && !hasAudioTracks && !hasSubtitleTracks && (
          <p className="text-sm text-white/50">No additional audio or subtitle tracks found.</p>
        )}

        {hasAudioTracks && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-wide text-white/40">Audio Track</h3>
            {probe!.audioTracks.map((track) => (
              <label key={track.index} className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="radio"
                  name="audio-track"
                  checked={
                    audioIndex === track.index ||
                    (audioIndex == null && track.index === probe!.audioTracks[0].index)
                  }
                  onChange={() => onSelectAudio(track.index)}
                />
                {trackLabel(track)}
              </label>
            ))}
            <div className="mt-1 flex flex-col gap-1">
              <span className="text-xs text-white/40">
                Audio delay: {audioDelayDraft > 0 ? `+${audioDelayDraft}` : audioDelayDraft} ms
              </span>
              <input
                type="range"
                min={AUDIO_DELAY_MIN}
                max={AUDIO_DELAY_MAX}
                step={50}
                value={audioDelayDraft}
                onChange={(e) => setAudioDelayDraft(Number(e.target.value))}
                onMouseUp={commitAudioDelay}
                onTouchEnd={commitAudioDelay}
                onKeyUp={commitAudioDelay}
                className="w-full accent-white"
              />
            </div>
          </section>
        )}

        {hasSubtitleTracks && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-wide text-white/40">Subtitles</h3>
            <label className="flex items-center gap-2 text-sm text-white/80">
              <input
                type="radio"
                name="subtitle-track"
                checked={subtitleIndex == null}
                onChange={() => onSelectSubtitle(null)}
              />
              Off
            </label>
            {probe!.subtitleTracks.map((track) => (
              <label key={track.index} className="flex items-center gap-2 text-sm text-white/80">
                <input
                  type="radio"
                  name="subtitle-track"
                  checked={subtitleIndex === track.index}
                  onChange={() => onSelectSubtitle(track.index)}
                />
                {trackLabel(track)}
              </label>
            ))}
            {subtitleIndex != null && (
              <div className="mt-1 flex flex-col gap-1">
                <span className="text-xs text-white/40">
                  Subtitle delay: {subtitleDelayMs > 0 ? `+${subtitleDelayMs}` : subtitleDelayMs} ms
                </span>
                <input
                  type="range"
                  min={SUBTITLE_DELAY_MIN}
                  max={SUBTITLE_DELAY_MAX}
                  step={100}
                  value={subtitleDelayMs}
                  onChange={(e) => onSubtitleDelay(Number(e.target.value))}
                  className="w-full accent-white"
                />
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
