"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import throttle from "lodash.throttle";
import type { ProbeResult, ConvertedSubtitle } from "@/lib/drive";
import { languageName } from "@/lib/languageNames";
import EpisodesPanel from "@/components/EpisodesPanel";
import TrackSettingsMenu from "@/components/TrackSettingsMenu";
import SubtitleMenu from "@/components/SubtitleMenu";
import {
  PlayIcon,
  PauseIcon,
  SkipNextIcon,
  SkipPreviousIcon,
  Replay10Icon,
  Forward10Icon,
  SettingsIcon,
  ListIcon,
  FullscreenIcon,
  FullscreenExitIcon,
  VolumeHighIcon,
  VolumeMuteIcon,
  ChevronLeftIcon,
} from "@/components/player-icons";

type EpisodeProgress = { positionSeconds: number; completed: boolean };

type Props = {
  fileId: string;
  title: string;
  backHref: string;
  parentFolderId: string;
  nextFileId: string | null;
  previousFileId: string | null;
  episodes: { id: string; name: string }[];
  progressByFileId: Record<string, EpisodeProgress>;
  initialPositionSeconds: number;
  initialCompleted: boolean;
  seekMode: "native" | "restart";
  durationSeconds: number | null;
  initialProbe: ProbeResult | null;
  subtitles: ConvertedSubtitle[];
  introStart: number | null;
  introEnd: number | null;
  outroStart: number | null;
};

const SAVE_INTERVAL_MS = 10_000;
const MIN_RESUME_SECONDS = 5;
const SKIP_SECONDS = 10;
const HIDE_CONTROLS_MS = 3000;
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function isBuffered(video: HTMLVideoElement, targetLocalSeconds: number): boolean {
  const ranges = video.buffered;
  for (let i = 0; i < ranges.length; i++) {
    if (targetLocalSeconds >= ranges.start(i) && targetLocalSeconds <= ranges.end(i)) return true;
  }
  return false;
}

// `lock()` isn't in TypeScript's DOM lib (the API isn't Baseline yet) and isn't implemented at all
// on iOS (Safari or Chrome-on-iOS, both WebKit — Apple doesn't expose it to web content), only on
// Android Chrome/Firefox/Samsung Internet. Feature-detected and best-effort on purpose: on
// unsupported browsers this is a silent no-op, fullscreen itself works exactly the same either way.
type OrientationLock = ScreenOrientation & { lock?: (type: string) => Promise<void> };

async function lockLandscape(): Promise<void> {
  const orientation = screen.orientation as OrientationLock | undefined;
  if (!orientation?.lock) return;
  await orientation.lock("landscape").catch(() => {});
}

function unlockOrientation(): void {
  (screen.orientation as OrientationLock | undefined)?.unlock?.();
}

/**
 * One player for both playback modes. Native MP4 (post-Converter content) is properly
 * Range-seekable, so the browser's own <video> element handles seeking/buffering directly. MKV
 * ("restart" mode, pre-conversion content) is a live, non-seekable ffmpeg remux with no real
 * duration/byte-range info of its own — every seek/track-change restarts the stream at a new `t`
 * via a `src` change, tracked as `baseOffsetSeconds` + the video element's own `currentTime`. All
 * the visual chrome (seek bar, buttons, panels) is shared; only src/seek/subtitle mechanics branch
 * on `seekMode`, via the `isNative` flag below.
 */
export default function VideoPlayer({
  fileId,
  title,
  backHref,
  parentFolderId,
  nextFileId,
  previousFileId,
  episodes,
  progressByFileId,
  initialPositionSeconds,
  initialCompleted,
  seekMode,
  durationSeconds,
  initialProbe,
  subtitles,
  introStart,
  introEnd,
  outroStart,
}: Props) {
  const isNative = seekMode === "native";

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const appliedSubtitleDelayRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  const [baseOffsetSeconds, setBaseOffsetSeconds] = useState(
    !isNative && !initialCompleted && initialPositionSeconds > MIN_RESUME_SECONDS
      ? initialPositionSeconds
      : 0,
  );
  const [isBuffering, setIsBuffering] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const [displaySeconds, setDisplaySeconds] = useState(baseOffsetSeconds);
  // React's onChange for range inputs fires continuously while dragging (mirrors the native
  // `input` event, not `change`), so we track the live drag position separately and only commit
  // it — i.e. actually seek/restart — once the user releases.
  const [scrubValue, setScrubValue] = useState<number | null>(null);

  // restart-mode only
  const [audioIndex, setAudioIndex] = useState<number | null>(null);
  const [audioDelayMs, setAudioDelayMs] = useState(0);
  const [restartSubtitleIndex, setRestartSubtitleIndex] = useState<number | null>(null);
  const [subtitleDelayMs, setSubtitleDelayMs] = useState(0);
  const [probe, setProbe] = useState<ProbeResult | null>(initialProbe);

  // native-mode only
  const [nativeSubtitleIndex, setNativeSubtitleIndex] = useState<number | null>(null);
  const [nativeDuration, setNativeDuration] = useState<number | null>(null);

  const [speed, setSpeed] = useState(1);
  const [timeDisplayMode, setTimeDisplayMode] = useState<"total" | "remaining">("total");
  const [episodesOpen, setEpisodesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showSkipIntro, setShowSkipIntro] = useState(false);
  const [showNextEpisode, setShowNextEpisode] = useState(false);

  // Native: the browser knows real duration from the MP4 itself once metadata loads. Restart:
  // Drive's own duration metadata can't be trusted for MKV (it returns a truthy "0"), so ffprobe's
  // real duration (once it loads) takes over from the server-provided guess.
  const effectiveDuration = isNative ? (nativeDuration ?? durationSeconds) : (probe?.durationSeconds ?? durationSeconds);

  const getAbsolutePosition = useCallback(
    (video: HTMLVideoElement) => (isNative ? video.currentTime : baseOffsetSeconds + video.currentTime),
    [isNative, baseOffsetSeconds],
  );

  // Auto-hide the control overlay during playback, same as any streaming service — always
  // visible while paused, buffering, or a panel is open, hidden after inactivity while playing.
  // State updates live in the event handlers that cause each transition (play/pause/buffering,
  // panel open/close, mouse activity) rather than a reactive effect watching derived state, since
  // synchronously setState-ing inside an effect body causes an avoidable extra render pass.
  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), HIDE_CONTROLS_MS);
  }, [clearHideTimer]);

  useEffect(() => clearHideTimer, [clearHideTimer]);

  const goToNext = useCallback(() => {
    const video = videoRef.current;
    const positionSeconds = effectiveDuration ?? (video ? getAbsolutePosition(video) : 0);
    const payload = JSON.stringify({
      fileId,
      parentFolderId,
      positionSeconds,
      durationSeconds: effectiveDuration ?? 0,
    });
    fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    }).catch(() => {});
    if (nextFileId) {
      router.push(`/watch/${nextFileId}`);
    }
  }, [fileId, parentFolderId, nextFileId, effectiveDuration, getAbsolutePosition, router]);

  // Static, fully-loaded VTT text (not seek-position-dependent like the restart-mode subtitle
  // fetch) — build blob URLs once per subtitles prop change. Only relevant for native mode
  // (`subtitles` is always empty for restart-mode content).
  //
  // Deliberately a useEffect, not a useMemo: `URL.createObjectURL` must never run during server
  // rendering. Node has its own Blob/URL polyfill that produces a `blob:nodedata:...` identifier —
  // meaningless in a real browser — and a useMemo body runs during SSR too. That id got baked into
  // the initial HTML, the browser tried to load it before hydration could fix it ("Not allowed to
  // load local resource: blob:nodedata:..."), and once a <track> fails its initial load, patching
  // the `src` attribute afterward doesn't make the browser retry — confirmed live (0 cues loaded)
  // via headless Chrome, which is what was actually causing "select English, nothing shows".
  const [subtitleUrls, setSubtitleUrls] = useState<
    { index: number; label: string; srcLang: string; url: string }[]
  >([]);
  useEffect(() => {
    const urls = subtitles.map((s) => ({
      index: s.index,
      label: (s.language ? languageName(s.language) : null) ?? s.title ?? `Track ${s.index}`,
      srcLang: s.language ?? "en",
      url: URL.createObjectURL(new Blob([s.vtt], { type: "text/vtt" })),
    }));
    setSubtitleUrls(urls); // eslint-disable-line react-hooks/set-state-in-effect -- synchronizing with the browser's own blob registry, an external system with no server-side equivalent (see comment above)
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u.url));
    };
  }, [subtitles]);

  // Drives which native <track> is actually rendered — a real CC menu instead of relying on the
  // `default` attribute/browser-native captions UI, which is inconsistently discoverable.
  useEffect(() => {
    if (!isNative) return;
    const video = videoRef.current;
    if (!video) return;
    for (let i = 0; i < video.textTracks.length; i++) {
      video.textTracks[i].mode = i === nativeSubtitleIndex ? "showing" : "hidden";
    }
  }, [isNative, nativeSubtitleIndex, subtitleUrls]);

  // Restart-mode only: videos uploaded through the admin flow already have this resolved
  // server-side (initialProbe) — skip the round trip in that case. Otherwise probe client-side so
  // it never delays video start.
  useEffect(() => {
    if (isNative || initialProbe) return;
    let cancelled = false;
    fetch(`/api/probe/${fileId}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setProbe(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isNative, fileId, initialProbe]);

  const src = useMemo(() => {
    if (isNative) return `/api/stream/${fileId}`;
    const params = new URLSearchParams();
    if (baseOffsetSeconds > 0) params.set("t", String(Math.floor(baseOffsetSeconds)));
    if (audioIndex != null) params.set("audio", String(audioIndex));
    if (audioDelayMs !== 0) params.set("adelay", String(audioDelayMs));
    const qs = params.toString();
    return `/api/stream/${fileId}${qs ? `?${qs}` : ""}`;
  }, [isNative, fileId, baseOffsetSeconds, audioIndex, audioDelayMs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const save = (positionSeconds: number) => {
      const payload = JSON.stringify({
        fileId,
        parentFolderId,
        positionSeconds,
        durationSeconds: effectiveDuration ?? 0,
      });
      fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      }).catch(() => {});
    };

    const throttledSave = throttle(
      (positionSeconds: number) => save(positionSeconds),
      SAVE_INTERVAL_MS,
      { leading: false },
    );

    const handleTimeUpdate = () => {
      const absolute = getAbsolutePosition(video);
      setDisplaySeconds(absolute);
      throttledSave(absolute);
      setShowSkipIntro(introStart != null && introEnd != null && absolute >= introStart && absolute < introEnd);
      setShowNextEpisode(outroStart != null && absolute >= outroStart && nextFileId != null);
    };

    const handlePlay = () => {
      setIsPlaying(true);
      scheduleHide();
    };
    const handlePause = () => {
      setIsPlaying(false);
      save(getAbsolutePosition(video));
      clearHideTimer();
      setControlsVisible(true);
    };

    const handleEnded = () => goToNext();

    const handlePageHide = () => {
      const payload = JSON.stringify({
        fileId,
        parentFolderId,
        positionSeconds: getAbsolutePosition(video),
        durationSeconds: effectiveDuration ?? 0,
      });
      navigator.sendBeacon?.("/api/progress", new Blob([payload], { type: "application/json" }));
    };

    const handleLoadStart = () => {
      setIsBuffering(true);
      clearHideTimer();
      setControlsVisible(true);
    };
    const handleWaiting = () => {
      setIsBuffering(true);
      clearHideTimer();
      setControlsVisible(true);
    };
    const handlePlaying = () => {
      setIsBuffering(false);
      if (!video.paused) scheduleHide();
    };
    const handleCanPlay = () => setIsBuffering(false);

    // Native only: the static MP4 always starts serving from byte 0, so resuming means seeking
    // forward once real metadata is available (unlike restart mode, which starts the ffmpeg
    // remux at the right offset from the very first byte via `t` in the src itself).
    const handleLoadedMetadata = () => {
      if (!isNative) return;
      setNativeDuration(video.duration || null);
      if (!initialCompleted && initialPositionSeconds > MIN_RESUME_SECONDS) {
        video.currentTime = initialPositionSeconds;
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("ended", handleEnded);
    video.addEventListener("loadstart", handleLoadStart);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("canplay", handleCanPlay);
    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      throttledSave.cancel();
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("ended", handleEnded);
      video.removeEventListener("loadstart", handleLoadStart);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("canplay", handleCanPlay);
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [
    fileId,
    parentFolderId,
    nextFileId,
    effectiveDuration,
    isNative,
    initialCompleted,
    initialPositionSeconds,
    getAbsolutePosition,
    scheduleHide,
    clearHideTimer,
    goToNext,
    introStart,
    introEnd,
    outroStart,
  ]);

  // Browsers reset playbackRate to 1 whenever `src` changes, not just when the user picks a new
  // speed — reapply on every load, not only on the speed-button click.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const applyRate = () => {
      video.playbackRate = speed;
      video.preservesPitch = true;
    };
    applyRate();
    video.addEventListener("loadedmetadata", applyRate);
    return () => video.removeEventListener("loadedmetadata", applyRate);
  }, [speed, src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
  }, [volume, muted]);

  useEffect(() => {
    // Covers every way fullscreen can end (this button, the OS's own exit gesture, Android back
    // button, ...) uniformly, not just the toggleFullscreen click path below.
    const handleFullscreenChange = () => {
      const nowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(nowFullscreen);
      if (nowFullscreen) {
        lockLandscape();
      } else {
        unlockOrientation();
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const showControls = () => {
    setControlsVisible(true);
    const video = videoRef.current;
    if (video && !video.paused && !settingsOpen && !episodesOpen) scheduleHide();
  };

  const closePanels = () => {
    setSettingsOpen(false);
    setEpisodesOpen(false);
    const video = videoRef.current;
    if (video && !video.paused) {
      scheduleHide();
    } else {
      clearHideTimer();
      setControlsVisible(true);
    }
  };

  const toggleSettings = () => {
    setEpisodesOpen(false);
    const opening = !settingsOpen;
    setSettingsOpen(opening);
    if (opening) {
      clearHideTimer();
      setControlsVisible(true);
    }
  };

  const toggleEpisodes = () => {
    setSettingsOpen(false);
    const opening = !episodesOpen;
    setEpisodesOpen(opening);
    if (opening) {
      clearHideTimer();
      setControlsVisible(true);
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen();
    else document.exitFullscreen();
  };

  const commitSeek = () => {
    if (scrubValue == null) return;
    if (isNative) {
      if (videoRef.current) videoRef.current.currentTime = scrubValue;
    } else {
      setBaseOffsetSeconds(scrubValue);
    }
    setScrubValue(null);
  };

  const currentAbsoluteSeconds = () => baseOffsetSeconds + (videoRef.current?.currentTime ?? 0);

  const changeAudioTrack = (index: number | null) => {
    setBaseOffsetSeconds(currentAbsoluteSeconds());
    setAudioIndex(index);
  };

  const commitAudioDelay = (ms: number) => {
    setBaseOffsetSeconds(currentAbsoluteSeconds());
    setAudioDelayMs(ms);
  };

  function shiftCuesBy(deltaMs: number) {
    const textTrack = trackRef.current?.track;
    if (!textTrack?.cues) return;
    const deltaSeconds = deltaMs / 1000;
    for (const cue of Array.from(textTrack.cues) as VTTCue[]) {
      cue.startTime += deltaSeconds;
      cue.endTime += deltaSeconds;
    }
  }

  const changeSubtitleTrack = (index: number | null) => {
    // Subtitle extraction has to seek+restart just like the video does (MKV interleaves subtitle
    // packets throughout the whole container, so a full-track read is as slow as reading the
    // whole file) — turning subtitles on/switching tracks restarts at the current position so
    // newly loaded cues line up with `video.currentTime` immediately.
    setBaseOffsetSeconds(currentAbsoluteSeconds());
    setRestartSubtitleIndex(index);
    appliedSubtitleDelayRef.current = 0; // fresh cues load unshifted; reapplied in handleSubtitleTrackLoad
  };

  const handleSubtitleTrackLoad = () => {
    const textTrack = trackRef.current?.track;
    if (textTrack) textTrack.mode = "showing";
    appliedSubtitleDelayRef.current = 0;
    shiftCuesBy(subtitleDelayMs);
    appliedSubtitleDelayRef.current = subtitleDelayMs;
  };

  const setSubtitleDelay = (ms: number) => {
    // Cheap in-memory cue arithmetic (at most a few hundred cues) — apply live on every tick,
    // unlike audio delay which must wait for release since it restarts ffmpeg.
    shiftCuesBy(ms - appliedSubtitleDelayRef.current);
    appliedSubtitleDelayRef.current = ms;
    setSubtitleDelayMs(ms);
  };

  const skip = (deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    if (isNative) {
      const target = Math.min(
        Math.max(0, video.currentTime + deltaSeconds),
        effectiveDuration ?? Number.POSITIVE_INFINITY,
      );
      video.currentTime = target;
      return;
    }
    const targetLocal = video.currentTime + deltaSeconds;
    if (targetLocal >= 0 && isBuffered(video, targetLocal)) {
      video.currentTime = targetLocal;
    } else {
      setBaseOffsetSeconds(Math.max(0, video.currentTime + baseOffsetSeconds + deltaSeconds));
    }
  };

  const cycleSpeed = () => {
    const idx = SPEED_OPTIONS.indexOf(speed);
    setSpeed(SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length]);
  };

  const shownSeconds = scrubValue ?? displaySeconds;
  const remainingSeconds =
    effectiveDuration != null ? Math.max(0, effectiveDuration - shownSeconds) : null;
  const progressPercent =
    effectiveDuration && effectiveDuration > 0
      ? Math.min(100, (shownSeconds / effectiveDuration) * 100)
      : 0;

  const iconButton = "text-white/90 transition hover:text-white";

  return (
    <div
      ref={containerRef}
      className="relative aspect-video w-full select-none overflow-hidden rounded-lg bg-black"
      onMouseMove={showControls}
      onMouseLeave={() => isPlaying && !settingsOpen && !episodesOpen && setControlsVisible(false)}
    >
      <video ref={videoRef} src={src} autoPlay className="h-full w-full" onClick={togglePlay}>
        {isNative &&
          subtitleUrls.map((s) => (
            <track key={s.index} kind="subtitles" src={s.url} srcLang={s.srcLang} label={s.label} />
          ))}
        {!isNative && restartSubtitleIndex != null && (
          <track
            key={`${restartSubtitleIndex}-${Math.floor(baseOffsetSeconds)}`}
            ref={trackRef}
            kind="subtitles"
            src={`/api/subtitle/${fileId}?track=${restartSubtitleIndex}&t=${Math.floor(baseOffsetSeconds)}`}
            default
            onLoad={handleSubtitleTrackLoad}
          />
        )}
      </video>

      {/* Top bar: back + title, fades with the rest of the controls */}
      <div
        className={`absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent p-4 transition-opacity duration-300 ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <Link href={backHref} className={iconButton} aria-label="Back">
          <ChevronLeftIcon className="h-7 w-7" />
        </Link>
        <h1 className="truncate text-sm font-medium text-white/90">{title}</h1>
      </div>

      {isBuffering && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        </div>
      )}

      {!isPlaying && !isBuffering && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play"
          className="absolute inset-0 flex items-center justify-center"
        >
          <div className="rounded-full bg-black/50 p-5 transition hover:bg-black/70">
            <PlayIcon className="h-12 w-12 text-white" />
          </div>
        </button>
      )}

      {showSkipIntro && (
        <button
          type="button"
          onClick={() => {
            if (introEnd == null) return;
            if (isNative) {
              if (videoRef.current) videoRef.current.currentTime = introEnd;
            } else {
              setBaseOffsetSeconds(introEnd);
            }
          }}
          className="absolute bottom-24 right-4 rounded-md border border-white/20 bg-black/70 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/90"
        >
          Skip Intro
        </button>
      )}

      {showNextEpisode && (
        <button
          type="button"
          onClick={goToNext}
          className="absolute bottom-24 right-4 rounded-md border border-white/20 bg-black/70 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/90"
        >
          Next Episode ›
        </button>
      )}

      <EpisodesPanel
        episodes={episodes}
        progressByFileId={progressByFileId}
        currentFileId={fileId}
        open={episodesOpen}
        onClose={closePanels}
      />

      {isNative ? (
        <SubtitleMenu
          tracks={subtitleUrls.map((s) => ({ index: s.index, label: s.label }))}
          selectedIndex={nativeSubtitleIndex}
          onSelect={setNativeSubtitleIndex}
          open={settingsOpen}
          onClose={closePanels}
        />
      ) : (
        <TrackSettingsMenu
          probe={probe}
          audioIndex={audioIndex}
          subtitleIndex={restartSubtitleIndex}
          audioDelayMs={audioDelayMs}
          subtitleDelayMs={subtitleDelayMs}
          onSelectAudio={changeAudioTrack}
          onSelectSubtitle={changeSubtitleTrack}
          onCommitAudioDelay={commitAudioDelay}
          onSubtitleDelay={setSubtitleDelay}
          open={settingsOpen}
          onClose={closePanels}
        />
      )}

      {/* Bottom bar: seek bar + controls, fades during playback */}
      <div
        className={`absolute inset-x-0 bottom-0 flex flex-col gap-1.5 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-4 pb-2 pt-12 transition-opacity duration-300 ${
          controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="flex items-center gap-3">
          <span className="w-12 shrink-0 text-right text-xs tabular-nums text-white/70">
            {formatTime(shownSeconds)}
          </span>
          <input
            type="range"
            min={0}
            max={effectiveDuration ?? 0}
            step={1}
            value={Math.min(shownSeconds, effectiveDuration ?? shownSeconds)}
            disabled={effectiveDuration == null}
            onChange={(e) => setScrubValue(Number(e.target.value))}
            onMouseUp={commitSeek}
            onTouchEnd={commitSeek}
            onKeyUp={commitSeek}
            style={{
              background: `linear-gradient(to right, white ${progressPercent}%, rgba(255,255,255,0.3) ${progressPercent}%)`,
            }}
            className="h-1 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          />
          <button
            type="button"
            onClick={() => setTimeDisplayMode((m) => (m === "total" ? "remaining" : "total"))}
            className="w-14 shrink-0 text-right text-xs tabular-nums text-white/70 hover:text-white"
          >
            {timeDisplayMode === "total"
              ? effectiveDuration != null
                ? formatTime(effectiveDuration)
                : "--:--"
              : remainingSeconds != null
                ? `-${formatTime(remainingSeconds)}`
                : "--:--"}
          </button>
        </div>

        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => previousFileId && router.push(`/watch/${previousFileId}`)}
              disabled={!previousFileId}
              aria-label="Previous episode"
              className={`${iconButton} disabled:opacity-30`}
            >
              <SkipPreviousIcon className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => skip(-SKIP_SECONDS)}
              aria-label="Back 10 seconds"
              className={iconButton}
            >
              <Replay10Icon className="h-7 w-7" />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
              className={iconButton}
            >
              {isPlaying ? <PauseIcon className="h-8 w-8" /> : <PlayIcon className="h-8 w-8" />}
            </button>
            <button
              type="button"
              onClick={() => skip(SKIP_SECONDS)}
              aria-label="Forward 10 seconds"
              className={iconButton}
            >
              <Forward10Icon className="h-7 w-7" />
            </button>
            <button
              type="button"
              onClick={() => nextFileId && router.push(`/watch/${nextFileId}`)}
              disabled={!nextFileId}
              aria-label="Next episode"
              className={`${iconButton} disabled:opacity-30`}
            >
              <SkipNextIcon className="h-6 w-6" />
            </button>

            <div className="ml-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                aria-label={muted ? "Unmute" : "Mute"}
                className={iconButton}
              >
                {muted || volume === 0 ? (
                  <VolumeMuteIcon className="h-5 w-5" />
                ) : (
                  <VolumeHighIcon className="h-5 w-5" />
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVolume(v);
                  setMuted(v === 0);
                }}
                className="hidden w-20 accent-white sm:block"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button type="button" onClick={cycleSpeed} className="text-sm text-white/80 hover:text-white">
              {speed}x
            </button>
            <button type="button" onClick={toggleSettings} aria-label="Settings" className={iconButton}>
              <SettingsIcon className="h-5 w-5" />
            </button>
            {episodes.length > 0 && (
              <button type="button" onClick={toggleEpisodes} aria-label="Episodes" className={iconButton}>
                <ListIcon className="h-5 w-5" />
              </button>
            )}
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              className={iconButton}
            >
              {isFullscreen ? <FullscreenExitIcon className="h-5 w-5" /> : <FullscreenIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
