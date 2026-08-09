"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { languageName } from "@/lib/languageNames";

type StreamTrack = {
  index: number;
  language: string | null;
  title: string | null;
  codecName: string;
};

type ProbeResult = {
  videoTrack: { index: number; codecName: string } | null;
  audioTracks: StreamTrack[];
  subtitleTracks: StreamTrack[];
  durationSeconds: number | null;
};

type Stage = "idle" | "staging" | "staged" | "converting" | "done" | "error";

function formatDuration(seconds: number | null): string {
  if (!seconds) return "Unknown";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "Unknown";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function trackLabel(track: StreamTrack): string {
  const parts = [track.title, track.language, track.codecName].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : `Track ${track.index}`;
}

export default function ConverterPage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [stagingId, setStagingId] = useState<string | null>(null);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);

  const [title, setTitle] = useState("");
  const [audioIndex, setAudioIndex] = useState<number | null>(null);

  const [jobId, setJobId] = useState<string | null>(null);
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState<string | null>(null);
  const [subtitleSetId, setSubtitleSetId] = useState<string | null>(null);
  const [subtitleTracks, setSubtitleTracks] = useState<
    { index: number; language: string | null; title: string | null }[]
  >([]);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const reset = useCallback(() => {
    setStage("idle");
    setFile(null);
    setUploadProgress(0);
    setStagingId(null);
    setProbe(null);
    setSizeBytes(null);
    setTitle("");
    setAudioIndex(null);
    setJobId(null);
    setDownloadId(null);
    setDownloadFilename(null);
    setSubtitleSetId(null);
    setSubtitleTracks([]);
    setError(null);
  }, []);

  const stageFile = useCallback((selected: File) => {
    setFile(selected);
    setTitle(selected.name.replace(/\.[^/.]+$/, ""));
    setStage("staging");
    setUploadProgress(0);
    setError(null);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/stage");
    xhr.setRequestHeader("Content-Type", selected.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status !== 200) {
        setError(`Staging failed: ${xhr.responseText || xhr.status}`);
        setStage("error");
        return;
      }
      try {
        const data = JSON.parse(xhr.responseText) as {
          stagingId: string;
          sizeBytes: number;
          probe: ProbeResult;
        };
        setStagingId(data.stagingId);
        setSizeBytes(data.sizeBytes);
        setProbe(data.probe);
        setAudioIndex(data.probe.audioTracks[0]?.index ?? null);
        setStage("staged");
      } catch {
        setError("Staging failed: invalid server response");
        setStage("error");
      }
    };
    xhr.onerror = () => {
      setError("Staging failed: network error");
      setStage("error");
    };
    xhr.send(selected);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const dropped = e.dataTransfer.files?.[0];
      if (dropped) stageFile(dropped);
    },
    [stageFile],
  );

  const startConvert = useCallback(async () => {
    if (!stagingId || audioIndex == null) return;
    setStage("converting");
    setError(null);
    try {
      const res = await fetch("/api/admin/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stagingId, title: title.trim() || "video", audioIndex }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed to start conversion");
      const data = (await res.json()) as { jobId: string };
      setJobId(data.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start conversion");
      setStage("error");
    }
  }, [stagingId, audioIndex, title]);

  useEffect(() => {
    if (!jobId || stage !== "converting") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/admin/jobs/${jobId}`);
        const data = (await res.json()) as {
          status: "processing" | "done" | "failed";
          downloadId: string | null;
          filename: string | null;
          subtitleSetId: string | null;
          subtitleTracks: { index: number; language: string | null; title: string | null }[];
          error: string | null;
        };
        if (cancelled) return;
        if (data.status === "done") {
          setDownloadId(data.downloadId);
          setDownloadFilename(data.filename);
          setSubtitleSetId(data.subtitleSetId);
          setSubtitleTracks(data.subtitleTracks);
          setStage("done");
        } else if (data.status === "failed") {
          setError(data.error || "Conversion failed");
          setStage("error");
        } else {
          setTimeout(poll, 2000);
        }
      } catch {
        if (!cancelled) setTimeout(poll, 3000);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [jobId, stage]);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        {!file ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex h-64 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed text-center transition ${
              dragActive ? "border-accent bg-accent/5" : "border-divider hover:border-white/30"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-10 w-10 text-text-tertiary" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 16V4m0 0-4 4m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-white/90">Drag and drop a video file here</p>
            <p className="text-sm text-text-tertiary">or click to browse your device</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => {
                const selected = e.target.files?.[0];
                if (selected) stageFile(selected);
              }}
            />
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg bg-black">
            {previewUrl && <video src={previewUrl} controls className="aspect-video w-full bg-black" />}
          </div>
        )}

        {file && (
          <div className="mt-4 rounded-lg border border-divider p-4">
            <p className="mb-3 truncate text-sm font-medium text-white/90">{file.name}</p>

            {stage === "staging" && (
              <div>
                <div className="mb-1 flex justify-between text-xs text-text-secondary">
                  <span>Uploading to server for analysis…</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-divider">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {probe && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-text-tertiary">Duration</dt>
                <dd className="text-white/90">{formatDuration(probe.durationSeconds)}</dd>
                <dt className="text-text-tertiary">File size</dt>
                <dd className="text-white/90">{formatSize(sizeBytes)}</dd>
                <dt className="text-text-tertiary">Video codec</dt>
                <dd className="text-white/90">{probe.videoTrack?.codecName ?? "None detected"}</dd>
                <dt className="text-text-tertiary">Audio tracks</dt>
                <dd className="text-white/90">{probe.audioTracks.length}</dd>
                <dt className="text-text-tertiary">Subtitle tracks</dt>
                <dd className="text-white/90">{probe.subtitleTracks.length}</dd>
              </dl>
            )}
          </div>
        )}
      </div>

      <div>
        {!file && (
          <p className="text-sm text-text-secondary">
            Select a video from your device to inspect its tracks and convert it to a browser-native
            MP4. Nothing is uploaded to Drive — once the conversion finishes you download the result
            and upload it to your Drive folder yourself.
          </p>
        )}

        {file && (
          <div className="flex flex-col gap-6">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-white/90">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={stage === "converting" || stage === "done"}
                className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30 disabled:opacity-50"
                placeholder="Video title"
              />
            </div>

            {probe && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-white/90">Audio track</label>
                {probe.audioTracks.length === 0 ? (
                  <p className="text-sm text-text-tertiary">No audio tracks detected.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {probe.audioTracks.map((track) => (
                      <label
                        key={track.index}
                        className="flex items-center gap-2.5 rounded-md border border-divider px-3 py-2 text-sm text-white/90 has-checked:border-accent"
                      >
                        <input
                          type="radio"
                          name="audioTrack"
                          checked={audioIndex === track.index}
                          onChange={() => setAudioIndex(track.index)}
                          disabled={stage === "converting" || stage === "done"}
                        />
                        {trackLabel(track)}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}

            {stage === "staged" && (
              <button
                onClick={startConvert}
                disabled={audioIndex == null}
                className="rounded-md bg-white px-4 py-2.5 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
              >
                Convert &amp; Download
              </button>
            )}

            {stage === "converting" && (
              <p className="text-sm text-amber">Converting on the server — this can take a while for large files…</p>
            )}

            {stage === "done" && downloadId && (
              <div className="flex flex-col gap-3">
                <a
                  href={`/api/admin/download/${downloadId}?filename=${encodeURIComponent(downloadFilename ?? "video.mp4")}`}
                  download={downloadFilename ?? "video.mp4"}
                  className="rounded-md bg-live px-4 py-2.5 text-center text-sm font-bold text-black transition hover:opacity-90"
                >
                  Download {downloadFilename}
                </a>

                {subtitleSetId && subtitleTracks.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-sm font-medium text-white/90">Subtitles</p>
                    {subtitleTracks.map((track) => {
                      const label =
                        (track.language ? languageName(track.language) : null) ??
                        track.title ??
                        `Track ${track.index}`;
                      return (
                        <a
                          key={track.index}
                          href={`/api/admin/subtitle-sets/${subtitleSetId}/download/${track.index}`}
                          className="rounded-md border border-divider px-3 py-2 text-center text-sm text-white/90 transition hover:bg-white/5"
                        >
                          Download {label} .vtt
                        </a>
                      );
                    })}
                    <p className="mt-1 text-xs text-text-tertiary">
                      Already saved — you can also link these to this video later in the Catalog tab
                      without re-uploading them.
                    </p>
                  </div>
                )}

                <button
                  onClick={reset}
                  className="text-sm text-text-secondary underline transition hover:text-white"
                >
                  Convert another video
                </button>
              </div>
            )}

            {stage === "error" && (
              <button
                onClick={reset}
                className="rounded-md border border-divider px-4 py-2.5 text-sm text-white/90 transition hover:bg-white/5"
              >
                Start over
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
