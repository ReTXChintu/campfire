import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import throttle from "lodash.throttle";
import type { ProbeResult, ConvertedSubtitle, WatchPartySyncState } from "../lib/types";
import { languageName } from "../lib/languageNames";
import { API_URL, apiGet, apiPost, apiPostKeepalive } from "../lib/api";
import { useMediaToken } from "../lib/mediaToken";
import EpisodesPanel from "./EpisodesPanel";
import TrackSettingsMenu from "./TrackSettingsMenu";
import SubtitleMenu from "./SubtitleMenu";
import type { QualitySelection } from "./QualitySection";
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
} from "./player-icons";

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
  subtitles: ConvertedSubtitle[];
  introStart: number | null;
  introEnd: number | null;
  outroStart: number | null;
  watchPartySync?: {
    enabled: boolean;
    isHost: boolean;
    inboundState: WatchPartySyncState | null;
    onStateChange?: (state: WatchPartySyncState) => void | Promise<void>;
  };
};

const SAVE_INTERVAL_MS = 10_000;
const MIN_RESUME_SECONDS = 5;
const SKIP_SECONDS = 10;
const HIDE_CONTROLS_MS = 3000;
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// Auto-mode quality heuristic — same constants and shape as the mobile players' (kept in sync by
// hand, no shared code across TS/Dart): react to buffering events, not real throughput/segment
// measurement (there are no segments, it's one continuous stream). See the effect below for the
// full algorithm; this is deliberately MVP-realistic, not broadcast-grade ABR.
const AUTO_WINDOW_MS = 30_000; // sliding window for counting buffering events
const AUTO_STEP_DOWN_EVENT_COUNT = 2; // ≥2 buffering events within the window → step down
const AUTO_STALL_MS = 4_000; // one buffering stall this long → step down immediately
const AUTO_SUSTAINED_MS = 180_000; // this long with zero buffering events → eligible to step up
const AUTO_COOLDOWN_MS = 60_000; // minimum gap between automatic changes (anti-oscillation)
const AUTO_QUALITY_STORAGE_KEY = "campfire-auto-quality-ceiling";

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
 *
 * `src`/subtitle-track URLs point at the backend origin (`API_URL`, cross-origin from this SPA) and
 * carry a scoped media token (see lib/mediaToken.ts) — a plain <video>/<track> element can't send
 * an Authorization header, so this is how they still hit an auth-gated route.
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
  subtitles,
  introStart,
  introEnd,
  outroStart,
  watchPartySync,
}: Props) {
  const isNative = seekMode === "native";
  const syncEnabled = !!watchPartySync?.enabled && isNative;
  // Guests can't seek/skip/change speed during a synced party — those actions would silently
  // desync them until the host's next broadcast, with no indication anything "failed".
  const locked = syncEnabled && watchPartySync?.isHost === false;

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLTrackElement>(null);
  const appliedSubtitleDelayRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingInboundSyncRef = useRef(false);
  // Set when a quality change is about to land on a resource with real Range/seek support of its
  // own — either the zero-transcode passthrough path (Original, on native content) or a specific
  // quality tier (a pre-generated rendition file, see lib/renditions.ts on the backend). Neither
  // has a `t=` URL param to resume at (a rendition file's `h=` branch in routes/stream.ts ignores
  // `t` entirely, same as passthrough always has), so the position captured at switch time has to
  // be re-applied manually once the reloaded element's metadata is ready (see handleLoadedMetadata
  // below). Unused for the one remaining case (true restart mode: a non-native container at
  // Original, no rendition involved), which still resumes via the `t=` param.
  const pendingSeekRef = useRef<number | null>(null);
  const navigate = useNavigate();

  const { data: mediaToken } = useMediaToken(fileId);

  // "auto" starts unresolved (null) — see QualitySection/the Auto-mode heuristic — so it behaves
  // exactly like "original" until that adaptive logic actually seeds/adjusts it.
  const [qualitySelection, setQualitySelection] = useState<QualitySelection>("auto");
  const [autoResolvedHeight, setAutoResolvedHeight] = useState<number | null>(null);
  const effectiveHeight =
    qualitySelection === "auto"
      ? autoResolvedHeight
      : qualitySelection === "original"
        ? null
        : qualitySelection;
  // True only for real Range-seekable byte passthrough — native content at its own source
  // resolution.
  const usingPassthrough = isNative && effectiveHeight == null;
  // True for passthrough OR any specific quality tier — every tier the quality menu offers is a
  // pre-generated file with real Range support of its own (see lib/renditions.ts on the backend),
  // not a live re-encode, so it's just as directly seekable as passthrough. Only true restart mode
  // (a non-native container at Original, no rendition involved — the live ffmpeg remux) has no
  // real seeking and needs the reload-at-`t=` trick instead.
  const streamIsSeekable = usingPassthrough || effectiveHeight != null;

  const [baseOffsetSeconds, setBaseOffsetSeconds] = useState(
    !usingPassthrough && !initialCompleted && initialPositionSeconds > MIN_RESUME_SECONDS
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
  const [probe, setProbe] = useState<ProbeResult | null>(null);

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

  // Passthrough: the browser knows real duration from the MP4 itself once metadata loads.
  // Everything else (restart mode, or any downscaled quality): Drive's own duration metadata can't
  // be trusted for MKV (it returns a truthy "0"), and a live re-encode has no reliable duration of
  // its own either, so ffprobe's real duration (once it loads) takes over from the server guess.
  const effectiveDuration = usingPassthrough
    ? (nativeDuration ?? durationSeconds)
    : (probe?.durationSeconds ?? durationSeconds);

  const getAbsolutePosition = useCallback(
    (video: HTMLVideoElement) => (usingPassthrough ? video.currentTime : baseOffsetSeconds + video.currentTime),
    [usingPassthrough, baseOffsetSeconds],
  );

  const currentAbsoluteSeconds = useCallback(
    () => (videoRef.current ? getAbsolutePosition(videoRef.current) : baseOffsetSeconds),
    [getAbsolutePosition, baseOffsetSeconds],
  );

  const emitWatchPartyState = useCallback(
    (input?: Partial<Omit<WatchPartySyncState, "type" | "updatedAt">>) => {
      if (!syncEnabled || !watchPartySync?.isHost || !watchPartySync.onStateChange || !videoRef.current) return;
      void watchPartySync.onStateChange({
        type: "sync-state",
        playing: input?.playing ?? !videoRef.current.paused,
        positionSeconds: input?.positionSeconds ?? getAbsolutePosition(videoRef.current),
        playbackRate: input?.playbackRate ?? speed,
        updatedAt: new Date().toISOString(),
      });
    },
    // Deliberately keyed on the individual fields we read, not the `watchPartySync` object
    // itself — that object is a fresh literal on every WatchPage render (participant join/leave,
    // mic toggle, connection-state change, ...), and depending on its reference would recreate
    // this callback — and every effect that lists it as a dependency below — on each of those
    // unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [getAbsolutePosition, speed, syncEnabled, watchPartySync?.isHost, watchPartySync?.onStateChange],
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
    apiPost("/api/progress", {
      fileId,
      parentFolderId,
      positionSeconds,
      durationSeconds: effectiveDuration ?? 0,
    }).catch(() => {});
    if (nextFileId) {
      navigate(`/watch/${nextFileId}`);
    }
  }, [fileId, parentFolderId, nextFileId, effectiveDuration, getAbsolutePosition, navigate]);

  // Static, fully-loaded VTT text (not seek-position-dependent like the restart-mode subtitle
  // fetch) — build blob URLs once per subtitles prop change. Only relevant for native mode
  // (`subtitles` is always empty for restart-mode content).
  //
  // Deliberately a useEffect, not a useMemo: `URL.createObjectURL` must never run during server
  // rendering in an SSR app; kept as an effect here too since blob URLs are an external-registry
  // side effect either way, not a pure derivation.
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
    setSubtitleUrls(urls);
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

  // Probes audio/subtitle tracks (and, now, source resolution/available qualities — see
  // QualitySection) client-side so it never delays video start. Fetched for every video
  // regardless of seekMode now, not just restart-mode content, since the quality menu needs
  // sourceHeight/availableQualities either way.
  useEffect(() => {
    let cancelled = false;
    apiGet<ProbeResult>(`/api/probe/${fileId}`)
      .then((data) => {
        if (!cancelled) setProbe(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  const src = useMemo(() => {
    if (!mediaToken) return undefined;
    const params = new URLSearchParams();
    params.set("token", mediaToken);
    if (effectiveHeight != null) params.set("h", String(effectiveHeight));
    if (!streamIsSeekable) {
      if (baseOffsetSeconds > 0) params.set("t", String(Math.floor(baseOffsetSeconds)));
      if (!isNative) {
        if (audioIndex != null) params.set("audio", String(audioIndex));
        if (audioDelayMs !== 0) params.set("adelay", String(audioDelayMs));
      }
    }
    return `${API_URL}/api/stream/${fileId}?${params.toString()}`;
  }, [streamIsSeekable, isNative, fileId, baseOffsetSeconds, audioIndex, audioDelayMs, effectiveHeight, mediaToken]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const save = (positionSeconds: number) => {
      apiPost("/api/progress", {
        fileId,
        parentFolderId,
        positionSeconds,
        durationSeconds: effectiveDuration ?? 0,
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
      if (!applyingInboundSyncRef.current) emitWatchPartyState({ playing: true });
    };
    const handlePause = () => {
      setIsPlaying(false);
      save(getAbsolutePosition(video));
      clearHideTimer();
      setControlsVisible(true);
      if (!applyingInboundSyncRef.current) {
        emitWatchPartyState({ playing: false, positionSeconds: getAbsolutePosition(video) });
      }
    };

    const handleEnded = () => goToNext();

    const handlePageHide = () => {
      apiPostKeepalive("/api/progress", {
        fileId,
        parentFolderId,
        positionSeconds: getAbsolutePosition(video),
        durationSeconds: effectiveDuration ?? 0,
      });
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

    // Any seekable resource (passthrough or a specific quality tier) always starts serving from
    // byte 0, so resuming means seeking forward once real metadata is available (unlike true
    // restart mode, which starts the live stream at the right offset from its very first byte via
    // `t` in the src itself). A pending quality-switch-triggered seek (see changeQuality) takes
    // priority over the original server-provided resume position — it means the viewer already had
    // a newer position mid-session.
    const handleLoadedMetadata = () => {
      if (!streamIsSeekable) return;
      setNativeDuration(video.duration || null);
      const pendingSeek = pendingSeekRef.current;
      if (pendingSeek != null) {
        pendingSeekRef.current = null;
        video.currentTime = pendingSeek;
      } else if (usingPassthrough && !initialCompleted && initialPositionSeconds > MIN_RESUME_SECONDS) {
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
    usingPassthrough,
    streamIsSeekable,
    initialCompleted,
    initialPositionSeconds,
    getAbsolutePosition,
    scheduleHide,
    clearHideTimer,
    goToNext,
    introStart,
    introEnd,
    outroStart,
    emitWatchPartyState,
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
    if (!syncEnabled || watchPartySync?.isHost || !watchPartySync?.inboundState || !videoRef.current) return;
    const video = videoRef.current;
    const state = watchPartySync.inboundState;
    const elapsedSeconds = Math.max(0, Date.now() - Date.parse(state.updatedAt)) / 1000;
    const targetPosition = Math.max(
      0,
      state.positionSeconds + (state.playing ? elapsedSeconds * state.playbackRate : 0),
    );

    applyingInboundSyncRef.current = true;
    video.currentTime = targetPosition;
    video.playbackRate = state.playbackRate;
    video.preservesPitch = true;
    setSpeed(state.playbackRate);
    setDisplaySeconds(targetPosition);

    if (state.playing) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }

    const timeout = setTimeout(() => {
      applyingInboundSyncRef.current = false;
    }, 0);
    return () => clearTimeout(timeout);
    // Keyed on the actual inbound state, not the wrapping `watchPartySync` object (see the note
    // on `emitWatchPartyState` above) — otherwise this re-applies the same, increasingly stale
    // position on every unrelated WatchPage render, visibly re-seeking/replaying a guest's video.
  }, [syncEnabled, watchPartySync?.isHost, watchPartySync?.inboundState]);

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
    if (scrubValue == null || locked) return;
    if (streamIsSeekable) {
      if (videoRef.current) videoRef.current.currentTime = scrubValue;
      emitWatchPartyState({ positionSeconds: scrubValue });
    } else {
      setBaseOffsetSeconds(scrubValue);
    }
    setScrubValue(null);
  };

  const changeQuality = (value: QualitySelection) => {
    const nextEffectiveHeight =
      value === "auto" ? autoResolvedHeight : value === "original" ? null : value;
    const nextStreamIsSeekable = nextEffectiveHeight != null || (isNative && nextEffectiveHeight == null);
    const position = currentAbsoluteSeconds();
    if (nextStreamIsSeekable) {
      // No `t=` param exists on a seekable resource to resume at — re-apply the position by hand
      // once the reloaded element's metadata is ready (see handleLoadedMetadata).
      pendingSeekRef.current = position;
    } else {
      setBaseOffsetSeconds(position);
    }
    setQualitySelection(value);
  };

  // Auto-mode's own quality changes reuse the exact same position-preserving reload mechanics as a
  // manual pick (changeQuality above) — the only difference is who decided the target height.
  const applyAutoChange = useCallback(
    (newHeight: number | null) => {
      const nextStreamIsSeekable = newHeight != null || isNative;
      const position = currentAbsoluteSeconds();
      if (nextStreamIsSeekable) {
        pendingSeekRef.current = position;
      } else {
        setBaseOffsetSeconds(position);
      }
      try {
        localStorage.setItem(AUTO_QUALITY_STORAGE_KEY, newHeight == null ? "original" : String(newHeight));
      } catch {
        // Unavailable (private mode, disabled) — Auto still works, just doesn't remember across sessions.
      }
      setAutoResolvedHeight(newHeight);
    },
    [isNative, currentAbsoluteSeconds],
  );

  // Seeds Auto's starting tier from this device's last learned ceiling once probe resolves (so a
  // known-weak device doesn't have to rediscover its ceiling via a rough patch on every video) —
  // clamped to this video's own ladder, since a remembered height might not apply to a
  // lower-resolution source. Only runs once per mount, before any buffering-driven adjustment has
  // had a chance to set autoResolvedHeight itself.
  useEffect(() => {
    if (qualitySelection !== "auto" || autoResolvedHeight != null || !probe) return;
    try {
      const stored = localStorage.getItem(AUTO_QUALITY_STORAGE_KEY);
      if (!stored || stored === "original") return; // no memory, or remembered "original" — already the default
      const storedHeight = Number(stored);
      const ladderHeights = probe.availableQualities.map((q) => q.height);
      if (Number.isFinite(storedHeight) && ladderHeights.includes(storedHeight)) {
        applyAutoChange(storedHeight);
      }
    } catch {
      // localStorage unavailable — fall back to the "start at Original" default.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qualitySelection, probe]);

  // The actual Auto-mode adaptive heuristic: steps quality down on buffering trouble, back up
  // after a sustained stretch of smooth playback, with a shared cooldown on both directions as the
  // whole anti-oscillation mechanism. Buffering is used as a single unified signal because it
  // already captures both hardware- and network-limited struggles without needing to tell them
  // apart. Own event listeners, independent of the main playback effect above, active only while
  // "Auto" is actually selected.
  useEffect(() => {
    if (qualitySelection !== "auto") return;
    const video = videoRef.current;
    if (!video) return;

    const ladderHeights = (probe?.availableQualities ?? []).map((q) => q.height);
    let stallStart: number | null = null;
    let bufferEventTimes: number[] = [];
    let lastChangeAt = Date.now();
    let stableSinceAt = Date.now();

    const stepDown = () => {
      const now = Date.now();
      if (now - lastChangeAt < AUTO_COOLDOWN_MS || ladderHeights.length === 0) return;
      const next =
        autoResolvedHeight == null
          ? ladderHeights[ladderHeights.length - 1]
          : ladderHeights[Math.max(0, ladderHeights.indexOf(autoResolvedHeight) - 1)];
      if (next === autoResolvedHeight) return;
      lastChangeAt = now;
      stableSinceAt = now;
      bufferEventTimes = [];
      applyAutoChange(next);
    };

    const stepUp = () => {
      const now = Date.now();
      if (now - lastChangeAt < AUTO_COOLDOWN_MS) return;
      if (now - stableSinceAt < AUTO_SUSTAINED_MS) return;
      if (autoResolvedHeight == null) return; // already at Original, nowhere higher to go
      const idx = ladderHeights.indexOf(autoResolvedHeight);
      const next = idx === -1 || idx === ladderHeights.length - 1 ? null : ladderHeights[idx + 1];
      lastChangeAt = now;
      stableSinceAt = now;
      applyAutoChange(next);
    };

    const handleWaitingForAuto = () => {
      const now = Date.now();
      stallStart = now;
      bufferEventTimes.push(now);
      bufferEventTimes = bufferEventTimes.filter((t) => now - t < AUTO_WINDOW_MS);
    };
    const handleRecoveredForAuto = () => {
      if (stallStart != null && Date.now() - stallStart >= AUTO_STALL_MS) {
        stepDown();
      } else if (bufferEventTimes.length >= AUTO_STEP_DOWN_EVENT_COUNT) {
        stepDown();
      }
      stallStart = null;
    };

    video.addEventListener("waiting", handleWaitingForAuto);
    video.addEventListener("playing", handleRecoveredForAuto);
    video.addEventListener("canplay", handleRecoveredForAuto);
    const interval = setInterval(() => {
      if (!video.paused) stepUp();
    }, AUTO_WINDOW_MS);

    return () => {
      video.removeEventListener("waiting", handleWaitingForAuto);
      video.removeEventListener("playing", handleRecoveredForAuto);
      video.removeEventListener("canplay", handleRecoveredForAuto);
      clearInterval(interval);
    };
  }, [qualitySelection, probe, autoResolvedHeight, applyAutoChange]);

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
    if (locked) return;
    const video = videoRef.current;
    if (!video) return;
    if (streamIsSeekable) {
      const target = Math.min(
        Math.max(0, video.currentTime + deltaSeconds),
        effectiveDuration ?? Number.POSITIVE_INFINITY,
      );
      video.currentTime = target;
      emitWatchPartyState({ positionSeconds: target });
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
    if (locked) return;
    const idx = SPEED_OPTIONS.indexOf(speed);
    const nextSpeed = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setSpeed(nextSpeed);
    emitWatchPartyState({ playbackRate: nextSpeed });
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
        {!isNative && restartSubtitleIndex != null && mediaToken && (
          <track
            key={`${restartSubtitleIndex}-${Math.floor(baseOffsetSeconds)}`}
            ref={trackRef}
            kind="subtitles"
            src={`${API_URL}/api/subtitle/${fileId}?track=${restartSubtitleIndex}&t=${Math.floor(baseOffsetSeconds)}&token=${mediaToken}`}
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
        <Link to={backHref} className={iconButton} aria-label="Back">
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
            if (streamIsSeekable) {
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
          availableQualities={probe?.availableQualities ?? []}
          sourceHeight={probe?.sourceHeight ?? null}
          qualitySelection={qualitySelection}
          autoResolvedHeight={autoResolvedHeight}
          onSelectQuality={changeQuality}
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
          availableQualities={probe?.availableQualities ?? []}
          sourceHeight={probe?.sourceHeight ?? null}
          qualitySelection={qualitySelection}
          autoResolvedHeight={autoResolvedHeight}
          onSelectQuality={changeQuality}
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
            disabled={effectiveDuration == null || locked}
            title={locked ? "Only the host can seek during a watch party" : undefined}
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
              onClick={() => previousFileId && navigate(`/watch/${previousFileId}`)}
              disabled={!previousFileId}
              aria-label="Previous episode"
              className={`${iconButton} disabled:opacity-30`}
            >
              <SkipPreviousIcon className="h-6 w-6" />
            </button>
            <button
              type="button"
              onClick={() => skip(-SKIP_SECONDS)}
              disabled={locked}
              title={locked ? "Only the host can seek during a watch party" : undefined}
              aria-label="Back 10 seconds"
              className={`${iconButton} disabled:opacity-30`}
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
              disabled={locked}
              title={locked ? "Only the host can seek during a watch party" : undefined}
              aria-label="Forward 10 seconds"
              className={`${iconButton} disabled:opacity-30`}
            >
              <Forward10Icon className="h-7 w-7" />
            </button>
            <button
              type="button"
              onClick={() => nextFileId && navigate(`/watch/${nextFileId}`)}
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
            <button
              type="button"
              onClick={cycleSpeed}
              disabled={locked}
              title={locked ? "Only the host can change speed during a watch party" : undefined}
              className="text-sm text-white/80 hover:text-white disabled:opacity-30"
            >
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
