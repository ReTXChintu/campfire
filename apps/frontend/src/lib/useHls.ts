import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type Hls from "hls.js";

export type HlsTrack = { index: number; label: string; language: string | null };

type HlsState = {
  /** Distinct heights on offer, highest first. Empty until known, or where the browser itself
   * plays HLS (Safari on iPhone) and keeps that to itself. */
  heights: number[];
  activeHeight: number | null;
  audioTracks: HlsTrack[];
  audioIndex: number;
  subtitles: HlsTrack[];
};

const EMPTY: HlsState = { heights: [], activeHeight: null, audioTracks: [], audioIndex: -1, subtitles: [] };

/** A fatal error is worth this many attempts at carrying on before the source counts as failed. */
const MAX_RECOVERIES = 2;

/** Plays an HLS address in a `<video>`, adapting quality by itself. `onFatal` is called once, when
 * it can't start or can't carry on. hls.js is only downloaded when there is something to play. */
export function useHls(videoRef: RefObject<HTMLVideoElement | null>, url: string | null, onFatal: () => void) {
  const [state, setState] = useState<HlsState>(EMPTY);
  const hlsRef = useRef<Hls | null>(null);
  const onFatalRef = useRef(onFatal);
  useEffect(() => {
    onFatalRef.current = onFatal;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!url || !video) return;
    let cancelled = false;
    let recoveries = 0;
    const fail = () => {
      if (cancelled) return;
      cancelled = true;
      onFatalRef.current();
    };
    const patch = (change: Partial<HlsState>) => {
      if (!cancelled) setState((s) => ({ ...s, ...change }));
    };

    import("hls.js")
      .then(({ default: HlsClass }) => {
        if (cancelled) return;
        if (!HlsClass.isSupported()) {
          if (video.canPlayType("application/vnd.apple.mpegurl")) video.src = url;
          else fail();
          return;
        }
        const hls = new HlsClass({ backBufferLength: 60 });
        hlsRef.current = hls;
        const label = (t: { name?: string; lang?: string }, i: number) => t.name || t.lang || `Track ${i + 1}`;
        hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
          const heights = [...new Set(hls.levels.map((l) => l.height).filter((h) => h > 0))];
          patch({ heights: heights.sort((a, b) => b - a) });
        });
        hls.on(HlsClass.Events.LEVEL_SWITCHED, (_e, data) => {
          patch({ activeHeight: hls.levels[data.level]?.height || null });
        });
        hls.on(HlsClass.Events.AUDIO_TRACKS_UPDATED, (_e, data) => {
          patch({
            audioTracks: data.audioTracks.map((t, i) => ({ index: i, label: label(t, i), language: t.lang ?? null })),
            audioIndex: hls.audioTrack,
          });
        });
        hls.on(HlsClass.Events.AUDIO_TRACK_SWITCHED, () => patch({ audioIndex: hls.audioTrack }));
        hls.on(HlsClass.Events.SUBTITLE_TRACKS_UPDATED, (_e, data) => {
          patch({
            subtitles: data.subtitleTracks.map((t, i) => ({ index: i, label: label(t, i), language: t.lang ?? null })),
          });
        });
        hls.on(HlsClass.Events.ERROR, (_e, data) => {
          if (!data.fatal || cancelled) return;
          // Nothing has played yet: there is nothing to recover, so go straight to the next source.
          const started = video.readyState > 0;
          if (!started || recoveries >= MAX_RECOVERIES) {
            fail();
            return;
          }
          recoveries++;
          if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else hls.startLoad();
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      })
      .catch(fail);

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      setState(EMPTY);
    };
  }, [url, videoRef]);

  /** Null goes back to choosing by itself. */
  const setHeight = useCallback((height: number | null) => {
    const hls = hlsRef.current;
    if (!hls) return;
    let best = -1;
    hls.levels.forEach((l, i) => {
      if (height != null && l.height === height && (best < 0 || l.bitrate > hls.levels[best].bitrate)) best = i;
    });
    hls.nextLevel = best;
  }, []);

  const setAudio = useCallback((index: number) => {
    if (hlsRef.current) hlsRef.current.audioTrack = index;
  }, []);

  /** -1 turns them off. */
  const setSubtitle = useCallback((index: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.subtitleDisplay = index >= 0;
    hls.subtitleTrack = index;
  }, []);

  return { ...state, setHeight, setAudio, setSubtitle };
}
