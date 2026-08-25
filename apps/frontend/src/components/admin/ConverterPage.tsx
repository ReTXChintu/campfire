import { useCallback, useEffect, useRef, useState } from "react";
import { languageName } from "../../lib/languageNames";
import { API_URL, apiGet, apiPost, downloadAuthedFile, getToken } from "../../lib/api";

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

type RowStage = "staging" | "staged" | "staging-error" | "queued" | "converting" | "done" | "error";

type SubtitleTrackInfo = { index: number; language: string | null; title: string | null };

type QueueRow = {
  id: string;
  file: File;
  stage: RowStage;
  uploadProgress: number;
  stagingId: string | null;
  probe: ProbeResult | null;
  sizeBytes: number | null;
  title: string;
  audioIndex: number | null;
  jobId: string | null;
  downloadId: string | null;
  downloadFilename: string | null;
  subtitleSetId: string | null;
  subtitleTracks: SubtitleTrackInfo[];
  error: string | null;
};

type JobStatus = {
  jobId: string;
  status: "queued" | "processing" | "done" | "failed";
  downloadId: string | null;
  filename: string | null;
  subtitleSetId: string | null;
  subtitleTracks: SubtitleTrackInfo[];
  error: string | null;
};

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

function statusLabel(stage: RowStage): string {
  switch (stage) {
    case "staging":
      return "Uploading…";
    case "staged":
      return "Ready to convert";
    case "staging-error":
      return "Upload failed";
    case "queued":
      return "Queued";
    case "converting":
      return "Converting…";
    case "done":
      return "Done";
    case "error":
      return "Failed";
  }
}

let nextRowId = 0;

export default function ConverterPage() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const rowsRef = useRef<QueueRow[]>(rows);
  rowsRef.current = rows;
  // Guards the upload queue so at most one XHR is ever in flight, regardless of how many times
  // stageNext gets (re)triggered (new files added mid-upload, etc.) — row state alone isn't a safe
  // enough signal since it only updates after React re-renders.
  const uploadingRef = useRef(false);

  const patchRow = useCallback((id: string, patch: Partial<QueueRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  // Uploads (stages) exactly one file at a time — predictable progress UI, and avoids hitting the
  // backend with many simultaneous large uploads/disk writes. Each row moves staging -> staged (or
  // staging-error) before the next queued upload starts.
  const stageNext = useCallback(() => {
    if (uploadingRef.current) return;
    const next = rowsRef.current.find((r) => r.stage === "staging" && !r.stagingId);
    if (!next) return;
    uploadingRef.current = true;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/admin/stage`);
    xhr.setRequestHeader("Content-Type", next.file.type || "application/octet-stream");
    const token = getToken();
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) patchRow(next.id, { uploadProgress: Math.round((e.loaded / e.total) * 100) });
    };
    xhr.onload = () => {
      uploadingRef.current = false;
      if (xhr.status !== 200) {
        patchRow(next.id, { stage: "staging-error", error: `Staging failed: ${xhr.responseText || xhr.status}` });
        stageNext();
        return;
      }
      try {
        const data = JSON.parse(xhr.responseText) as { stagingId: string; sizeBytes: number; probe: ProbeResult };
        const hasAudio = data.probe.audioTracks.length > 0;
        patchRow(next.id, {
          stagingId: data.stagingId,
          sizeBytes: data.sizeBytes,
          probe: data.probe,
          audioIndex: data.probe.audioTracks[0]?.index ?? null,
          stage: hasAudio ? "staged" : "staging-error",
          error: hasAudio ? null : "No audio track detected — skipped",
        });
      } catch {
        patchRow(next.id, { stage: "staging-error", error: "Staging failed: invalid server response" });
      }
      stageNext();
    };
    xhr.onerror = () => {
      uploadingRef.current = false;
      patchRow(next.id, { stage: "staging-error", error: "Staging failed: network error" });
      stageNext();
    };
    xhr.send(next.file);
  }, [patchRow]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const newRows: QueueRow[] = files.map((file) => ({
        id: String(nextRowId++),
        file,
        stage: "staging",
        uploadProgress: 0,
        stagingId: null,
        probe: null,
        sizeBytes: null,
        title: file.name.replace(/\.[^/.]+$/, ""),
        audioIndex: null,
        jobId: null,
        downloadId: null,
        downloadFilename: null,
        subtitleSetId: null,
        subtitleTracks: [],
        error: null,
      }));
      setRows((prev) => [...prev, ...newRows]);
      setBatchId(null);
      setBatchError(null);
      // Deferred so rowsRef reflects the newly added rows by the time stageNext runs; safe to call
      // even if an upload is already in flight (stageNext no-ops via uploadingRef in that case).
      setTimeout(stageNext, 0);
    },
    [stageNext],
  );

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      addFiles(Array.from(e.dataTransfer.files ?? []));
    },
    [addFiles],
  );

  const removeRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const resetAll = useCallback(() => {
    setRows([]);
    setBatchId(null);
    setBatchError(null);
  }, []);

  const allStaged = rows.length > 0 && rows.every((r) => r.stage === "staged" || r.stage === "staging-error");
  const convertableRows = rows.filter((r) => r.stage === "staged" && r.audioIndex != null);
  const isConverting = rows.some((r) => r.stage === "queued" || r.stage === "converting");
  const allTerminal = rows.length > 0 && rows.every((r) => r.stage === "done" || r.stage === "error" || r.stage === "staging-error");

  const startConvertAll = useCallback(async () => {
    if (convertableRows.length === 0) return;
    setBatchError(null);
    try {
      const data = await apiPost<{ batchId: string; jobIds: string[] }>("/api/admin/convert", {
        items: convertableRows.map((r) => ({
          stagingId: r.stagingId,
          title: r.title.trim() || "video",
          audioIndex: r.audioIndex,
        })),
      });
      setRows((prev) => {
        let i = 0;
        return prev.map((r) => {
          if (r.stage !== "staged" || r.audioIndex == null) return r;
          const jobId = data.jobIds[i];
          i += 1;
          return { ...r, stage: "queued", jobId };
        });
      });
      setBatchId(data.batchId);
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Failed to start conversion");
    }
  }, [convertableRows]);

  useEffect(() => {
    if (!batchId || !isConverting) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await apiGet<{ jobs: JobStatus[] }>(`/api/admin/jobs?batchId=${batchId}`);
        if (cancelled) return;
        setRows((prev) =>
          prev.map((row) => {
            const job = data.jobs.find((j) => j.jobId === row.jobId);
            if (!job) return row;
            if (job.status === "processing") return { ...row, stage: "converting" };
            if (job.status === "done") {
              return {
                ...row,
                stage: "done",
                downloadId: job.downloadId,
                downloadFilename: job.filename,
                subtitleSetId: job.subtitleSetId,
                subtitleTracks: job.subtitleTracks,
              };
            }
            if (job.status === "failed") {
              return { ...row, stage: "error", error: job.error || "Conversion failed" };
            }
            return row;
          }),
        );
        setTimeout(poll, 2000);
      } catch {
        if (!cancelled) setTimeout(poll, 3000);
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [batchId, isConverting]);

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-center transition ${
            dragActive ? "border-accent bg-accent/5" : "border-divider hover:border-white/30"
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-text-tertiary" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 16V4m0 0-4 4m4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="text-white/90">Drag and drop video files here</p>
          <p className="text-sm text-text-tertiary">or click to browse — select multiple files at once</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>

        {rows.length === 0 && (
          <p className="mt-4 text-sm text-text-secondary">
            Select videos from your device to inspect their tracks and convert them to browser-native
            MP4s. Nothing is uploaded to Drive — as each conversion finishes, download the result and
            upload it to your Drive folder yourself. Queue as many files as you like; they convert one
            at a time in the background, and each one's download becomes available as soon as it's
            done.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {rows.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-white/90">
              {rows.length} file{rows.length === 1 ? "" : "s"}
            </p>
            {allTerminal ? (
              <button onClick={resetAll} className="text-sm text-text-secondary underline transition hover:text-white">
                Convert another batch
              </button>
            ) : (
              !isConverting &&
              batchId == null && (
                <button
                  onClick={startConvertAll}
                  disabled={!allStaged || convertableRows.length === 0}
                  className="rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
                >
                  Convert All ({convertableRows.length})
                </button>
              )
            )}
          </div>
        )}

        {batchError && <p className="text-sm text-red-400">{batchError}</p>}

        <div className="flex flex-col gap-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-lg border border-divider p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium text-white/90">{row.file.name}</p>
                <div className="flex items-center gap-2">
                  <span className="whitespace-nowrap text-xs text-text-tertiary">{statusLabel(row.stage)}</span>
                  {(row.stage === "staging" || row.stage === "staged" || row.stage === "staging-error") && (
                    <button
                      onClick={() => removeRow(row.id)}
                      className="text-xs text-text-tertiary underline transition hover:text-white"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {row.stage === "staging" && (
                <div className="mb-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-divider">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${row.uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              {row.stage === "staging-error" && <p className="text-sm text-red-400">{row.error}</p>}

              {row.probe && (row.stage === "staged" || row.stage === "queued" || row.stage === "converting") && (
                <div className="mb-3 flex flex-col gap-3">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <dt className="text-text-tertiary">Duration</dt>
                    <dd className="text-white/90">{formatDuration(row.probe.durationSeconds)}</dd>
                    <dt className="text-text-tertiary">File size</dt>
                    <dd className="text-white/90">{formatSize(row.sizeBytes)}</dd>
                  </dl>

                  <div>
                    <label className="mb-1 block text-xs font-medium text-white/90">Title</label>
                    <input
                      type="text"
                      value={row.title}
                      onChange={(e) => patchRow(row.id, { title: e.target.value })}
                      disabled={row.stage !== "staged"}
                      className="w-full rounded-md border border-divider bg-surface px-2.5 py-1.5 text-sm text-white outline-none focus:border-white/30 disabled:opacity-50"
                      placeholder="Video title"
                    />
                  </div>

                  {row.probe.audioTracks.length > 1 && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-white/90">Audio track</label>
                      <div className="flex flex-col gap-1">
                        {row.probe.audioTracks.map((track) => (
                          <label
                            key={track.index}
                            className="flex items-center gap-2 rounded-md border border-divider px-2.5 py-1.5 text-xs text-white/90 has-checked:border-accent"
                          >
                            <input
                              type="radio"
                              name={`audioTrack-${row.id}`}
                              checked={row.audioIndex === track.index}
                              onChange={() => patchRow(row.id, { audioIndex: track.index })}
                              disabled={row.stage !== "staged"}
                            />
                            {trackLabel(track)}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {row.stage === "error" && <p className="text-sm text-red-400">{row.error}</p>}

              {row.stage === "done" && row.downloadId && (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      downloadAuthedFile(
                        `/api/admin/download/${row.downloadId}?filename=${encodeURIComponent(row.downloadFilename ?? "video.mp4")}`,
                        row.downloadFilename ?? "video.mp4",
                      )
                    }
                    className="rounded-md bg-live px-3 py-2 text-center text-sm font-bold text-black transition hover:opacity-90"
                  >
                    Download {row.downloadFilename}
                  </button>

                  {row.subtitleSetId && row.subtitleTracks.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                      {row.subtitleTracks.map((track) => {
                        const label =
                          (track.language ? languageName(track.language) : null) ?? track.title ?? `Track ${track.index}`;
                        return (
                          <button
                            key={track.index}
                            type="button"
                            onClick={() =>
                              downloadAuthedFile(`/api/admin/subtitle-sets/${row.subtitleSetId}/download/${track.index}`, `${label}.vtt`)
                            }
                            className="rounded-md border border-divider px-2.5 py-1.5 text-center text-xs text-white/90 transition hover:bg-white/5"
                          >
                            Download {label} .vtt
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
