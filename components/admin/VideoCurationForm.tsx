"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { languageName } from "@/lib/languageNames";

type SubtitleSetOption = {
  id: string;
  sourceLabel: string;
  createdAt: string;
  tracks: { index: number; language: string | null; title: string | null }[];
};

type Status = "pending" | "curated" | "published";

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function trackSummary(tracks: SubtitleSetOption["tracks"]): string {
  return tracks
    .map((t) => (t.language ? languageName(t.language) : null) ?? t.title ?? `Track ${t.index}`)
    .join(", ");
}

export default function VideoCurationForm({
  fileId,
  driveName,
  initialTitle,
  initialIntroStart,
  initialIntroEnd,
  initialOutroStart,
  initialSubtitleSetIds,
  subtitleSetOptions,
  status,
}: {
  fileId: string;
  driveName: string;
  initialTitle: string | null;
  initialIntroStart: number | null;
  initialIntroEnd: number | null;
  initialOutroStart: number | null;
  initialSubtitleSetIds: string[];
  subtitleSetOptions: SubtitleSetOption[];
  status: Status;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadFileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(initialTitle ?? driveName);
  const [introStart, setIntroStart] = useState<number | null>(initialIntroStart);
  const [introEnd, setIntroEnd] = useState<number | null>(initialIntroEnd);
  const [outroStart, setOutroStart] = useState<number | null>(initialOutroStart);
  const [subtitleSetIds, setSubtitleSetIds] = useState<string[]>(initialSubtitleSetIds);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);

  const [uploadLabel, setUploadLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const captureTime = () => videoRef.current?.currentTime ?? 0;

  const toggleSubtitleSet = (id: string) => {
    setSubtitleSetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/catalog/video/${fileId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, introStart, introEnd, outroStart, subtitleSetIds }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Save failed");
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async () => {
    setPublishing(true);
    setError(null);
    try {
      const action = status === "published" ? "unpublish" : "publish";
      const res = await fetch(`/api/admin/catalog/video/${fileId}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setPublishing(false);
    }
  };

  const uploadSubtitle = async () => {
    const file = uploadFileRef.current?.files?.[0];
    if (!file || !uploadLabel.trim()) return;
    setUploading(true);
    setUploadError(null);
    try {
      const format = file.name.toLowerCase().endsWith(".vtt") ? "vtt" : "srt";
      const text = await file.text();
      const res = await fetch(
        `/api/admin/catalog/video/${fileId}/subtitles?label=${encodeURIComponent(uploadLabel.trim())}&format=${format}`,
        { method: "POST", headers: { "Content-Type": "text/plain" }, body: text },
      );
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Upload failed");
      const data = (await res.json()) as { subtitleSetId: string };
      setSubtitleSetIds((prev) => [...prev, data.subtitleSetId]);
      setUploadLabel("");
      if (uploadFileRef.current) uploadFileRef.current.value = "";
      router.refresh();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const timeButton = "rounded-md border border-divider px-2.5 py-1 text-xs text-white/90 transition hover:bg-white/5";

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <div className="overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            src={`/api/stream/${fileId}`}
            controls
            className="aspect-video w-full bg-black"
            onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          />
        </div>
        <p className="mt-2 text-xs text-text-tertiary">
          Scrub to the right moment, then use the buttons on the right to capture the current time
          (currently {formatTime(currentTime)}).
        </p>
      </div>

      <div className="flex flex-col gap-6">
        <div>
          <p className="mb-2 text-xs text-text-tertiary">Drive name: {driveName}</p>
          <label className="mb-1.5 block text-sm font-medium text-white/90">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
          />
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-white/90">Skip Intro window</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={introStart ?? ""}
              onChange={(e) => setIntroStart(e.target.value === "" ? null : Number(e.target.value))}
              placeholder="Start (s)"
              className="w-28 rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
            />
            <button type="button" className={timeButton} onClick={() => setIntroStart(captureTime())}>
              Set from preview
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={introEnd ?? ""}
              onChange={(e) => setIntroEnd(e.target.value === "" ? null : Number(e.target.value))}
              placeholder="End (s)"
              className="w-28 rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
            />
            <button type="button" className={timeButton} onClick={() => setIntroEnd(captureTime())}>
              Set from preview
            </button>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-white/90">Next Episode prompt start</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              value={outroStart ?? ""}
              onChange={(e) => setOutroStart(e.target.value === "" ? null : Number(e.target.value))}
              placeholder="Start (s)"
              className="w-28 rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
            />
            <button type="button" className={timeButton} onClick={() => setOutroStart(captureTime())}>
              Set from preview
            </button>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-white/90">Subtitles</p>
          {subtitleSetOptions.length === 0 ? (
            <p className="mb-2 text-sm text-text-tertiary">
              None yet — upload a file below, or convert a video with subtitles in the Converter tab.
            </p>
          ) : (
            <div className="mb-3 flex flex-col gap-1.5">
              {subtitleSetOptions.map((set) => (
                <label
                  key={set.id}
                  className="flex flex-col gap-1 rounded-md border border-divider px-3 py-2 text-sm text-white/90 has-checked:border-accent"
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={subtitleSetIds.includes(set.id)}
                      onChange={() => toggleSubtitleSet(set.id)}
                    />
                    {set.sourceLabel}
                  </span>
                  <span className="pl-6 text-xs text-text-tertiary">{trackSummary(set.tracks)}</span>
                </label>
              ))}
            </div>
          )}

          <div className="rounded-md border border-dashed border-divider p-3">
            <p className="mb-2 text-xs font-medium text-white/90">Upload a subtitle file</p>
            <div className="flex flex-col gap-2">
              <input
                ref={uploadFileRef}
                type="file"
                accept=".srt,.vtt"
                className="text-xs text-text-secondary file:mr-2 file:rounded file:border-0 file:bg-white/10 file:px-2 file:py-1 file:text-xs file:text-white"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={uploadLabel}
                  onChange={(e) => setUploadLabel(e.target.value)}
                  placeholder="Label, e.g. English"
                  className="flex-1 rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
                />
                <button
                  type="button"
                  onClick={uploadSubtitle}
                  disabled={uploading || !uploadLabel.trim()}
                  className="rounded-md border border-divider px-3 py-2 text-sm text-white/90 transition hover:bg-white/5 disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "Upload"}
                </button>
              </div>
            </div>
            {uploadError && <p className="mt-2 text-xs text-red-400">{uploadError}</p>}
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={save}
          disabled={saving || !title.trim()}
          className="rounded-md bg-white px-4 py-2.5 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <p className="text-sm text-live">Saved.</p>}

        <div className="flex items-center gap-3 border-t border-divider pt-4">
          <span className="text-sm text-text-secondary">
            Status:{" "}
            <span className={status === "published" ? "text-live" : "text-white/90"}>
              {status === "published" ? "Published" : status === "curated" ? "Curated, not published" : "Pending"}
            </span>
          </span>
          {status !== "pending" && (
            <button
              onClick={togglePublish}
              disabled={publishing}
              className={`ml-auto rounded-md px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${
                status === "published"
                  ? "border border-divider text-white/90 hover:bg-white/5"
                  : "bg-live text-black hover:opacity-90"
              }`}
            >
              {publishing ? "Working…" : status === "published" ? "Unpublish" : "Publish"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
