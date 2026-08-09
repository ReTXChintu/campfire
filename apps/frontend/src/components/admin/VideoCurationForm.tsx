import { useRef, useState } from "react";
import { languageName } from "../../lib/languageNames";
import { API_URL } from "../../lib/api";
import { useMediaToken } from "../../lib/mediaToken";
import {
  useSaveVideo,
  useToggleVideoPublish,
  useUploadSubtitle,
  type SubtitleSetOption,
} from "../../hooks/useAdminCatalog";

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
  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadFileRef = useRef<HTMLInputElement>(null);
  const { data: mediaToken } = useMediaToken(fileId);

  const [title, setTitle] = useState(initialTitle ?? driveName);
  const [introStart, setIntroStart] = useState<number | null>(initialIntroStart);
  const [introEnd, setIntroEnd] = useState<number | null>(initialIntroEnd);
  const [outroStart, setOutroStart] = useState<number | null>(initialOutroStart);
  const [subtitleSetIds, setSubtitleSetIds] = useState<string[]>(initialSubtitleSetIds);
  const [saved, setSaved] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");

  const saveMutation = useSaveVideo(fileId);
  const publishMutation = useToggleVideoPublish(fileId);
  const uploadMutation = useUploadSubtitle(fileId);

  const captureTime = () => videoRef.current?.currentTime ?? 0;

  const toggleSubtitleSet = (id: string) => {
    setSubtitleSetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const save = () => {
    setSaved(false);
    saveMutation.mutate(
      { title, introStart, introEnd, outroStart, subtitleSetIds },
      { onSuccess: () => setSaved(true) },
    );
  };

  const togglePublish = () => {
    publishMutation.mutate(status === "published" ? "unpublish" : "publish");
  };

  const uploadSubtitle = async () => {
    const file = uploadFileRef.current?.files?.[0];
    if (!file || !uploadLabel.trim()) return;
    const format = file.name.toLowerCase().endsWith(".vtt") ? "vtt" : "srt";
    const text = await file.text();
    uploadMutation.mutate(
      { label: uploadLabel.trim(), format, text },
      {
        onSuccess: (data) => {
          setSubtitleSetIds((prev) => [...prev, data.subtitleSetId]);
          setUploadLabel("");
          if (uploadFileRef.current) uploadFileRef.current.value = "";
        },
      },
    );
  };

  const timeButton = "rounded-md border border-divider px-2.5 py-1 text-xs text-white/90 transition hover:bg-white/5";
  const error = saveMutation.error?.message ?? publishMutation.error?.message ?? null;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <div className="overflow-hidden rounded-lg bg-black">
          {mediaToken && (
            <video
              ref={videoRef}
              src={`${API_URL}/api/stream/${fileId}?token=${mediaToken}`}
              controls
              className="aspect-video w-full bg-black"
              onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
            />
          )}
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
                  disabled={uploadMutation.isPending || !uploadLabel.trim()}
                  className="rounded-md border border-divider px-3 py-2 text-sm text-white/90 transition hover:bg-white/5 disabled:opacity-50"
                >
                  {uploadMutation.isPending ? "Uploading…" : "Upload"}
                </button>
              </div>
            </div>
            {uploadMutation.error && <p className="mt-2 text-xs text-red-400">{uploadMutation.error.message}</p>}
          </div>
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          onClick={save}
          disabled={saveMutation.isPending || !title.trim()}
          className="rounded-md bg-white px-4 py-2.5 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          {saveMutation.isPending ? "Saving…" : "Save"}
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
              disabled={publishMutation.isPending}
              className={`ml-auto rounded-md px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${
                status === "published"
                  ? "border border-divider text-white/90 hover:bg-white/5"
                  : "bg-live text-black hover:opacity-90"
              }`}
            >
              {publishMutation.isPending ? "Working…" : status === "published" ? "Unpublish" : "Publish"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
