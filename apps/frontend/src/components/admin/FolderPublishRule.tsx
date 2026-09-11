import { useState } from "react";
import { useApplyFolderPublishRule, useBulkPublishFolder } from "../../hooks/useAdminCatalog";
import type { CatalogFolderPublishRule, CatalogVideo } from "../../lib/types";

function naturalSortVideos(videos: CatalogVideo[]): CatalogVideo[] {
  return [...videos].sort((a, b) =>
    (a.title ?? a.driveName).localeCompare(b.title ?? b.driveName, undefined, { numeric: true }),
  );
}

/** Initial drag-list order: whatever episodeOrder already says (ascending), then anything without
 * one appended in natural (filename-numeric) order — mirrors the backend's orderEpisodes(). */
function initialOrder(videos: CatalogVideo[]): CatalogVideo[] {
  const ordered = videos.filter((v) => v.episodeOrder != null).sort((a, b) => a.episodeOrder! - b.episodeOrder!);
  const unordered = naturalSortVideos(videos.filter((v) => v.episodeOrder == null));
  return [...ordered, ...unordered];
}

function applyPattern(namePattern: string, padding: number, episodeNumber: number): string {
  const padded = padding > 0 ? String(episodeNumber).padStart(padding, "0") : String(episodeNumber);
  return namePattern.replace("{n}", padded);
}

export default function FolderPublishRule({
  folderId,
  childVideos,
  initialRule,
  folderStatus,
}: {
  folderId: string;
  childVideos: CatalogVideo[];
  initialRule: CatalogFolderPublishRule | null;
  folderStatus: "pending" | "curated" | "published";
}) {
  const [order, setOrder] = useState<CatalogVideo[]>(() => initialOrder(childVideos));
  const [namePattern, setNamePattern] = useState(initialRule?.namePattern ?? "");
  const [padding, setPadding] = useState(initialRule?.padding ?? 0);
  const [introStart, setIntroStart] = useState<number | null>(initialRule?.introStart ?? null);
  const [introEnd, setIntroEnd] = useState<number | null>(initialRule?.introEnd ?? null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [applySummary, setApplySummary] = useState<{ updated: number; skippedTitle: number; skippedIntro: number } | null>(
    null,
  );

  const applyMutation = useApplyFolderPublishRule(folderId);
  const publishMutation = useBulkPublishFolder(folderId);

  const moveTo = (from: number, to: number) => {
    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const patternValid = namePattern.trim().includes("{n}");
  const introValid = introStart == null || introEnd == null || introStart < introEnd;
  const firstPreviewable = order.find((v) => !v.titleOverridden);
  const previewIndex = firstPreviewable ? order.indexOf(firstPreviewable) + 1 : 1;
  const previewTitle = patternValid ? applyPattern(namePattern.trim(), padding, previewIndex) : null;

  const apply = () => {
    setApplySummary(null);
    applyMutation.mutate(
      {
        namePattern: namePattern.trim(),
        padding,
        introStart,
        introEnd,
        order: order.map((v) => v._id),
      },
      {
        onSuccess: (res) => setApplySummary({ updated: res.updated, skippedTitle: res.skippedTitle, skippedIntro: res.skippedIntro }),
      },
    );
  };

  const error = applyMutation.error?.message ?? publishMutation.error?.message ?? null;
  const anyCurated = childVideos.some((v) => v.status !== "pending") || folderStatus !== "pending";

  return (
    <div className="mb-8 rounded-lg border border-divider p-4">
      <h2 className="mb-1 text-lg font-bold text-white">Batch publish rule</h2>
      <p className="mb-4 text-xs text-text-tertiary">
        Names, orders, and sets a default intro-skip window for every video below in one step. A
        video you've edited directly on its own page is left untouched.
      </p>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1">
          <label className="mb-1.5 block text-sm font-medium text-white/90">Naming pattern</label>
          <input
            type="text"
            value={namePattern}
            onChange={(e) => setNamePattern(e.target.value)}
            placeholder="S1E{n}: Show Name"
            className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
          />
          <p className="mt-1 text-xs text-text-tertiary">Use {"{n}"} where the episode number should go.</p>
        </div>
        <div className="w-full sm:w-40">
          <label className="mb-1.5 block text-sm font-medium text-white/90">Pad number to</label>
          <input
            type="number"
            min={0}
            max={4}
            value={padding}
            onChange={(e) => setPadding(Math.max(0, Number(e.target.value) || 0))}
            className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
          />
          <p className="mt-1 text-xs text-text-tertiary">0 = no padding (1, 2…); 2 = 01, 02…</p>
        </div>
      </div>

      {previewTitle && (
        <p className="mb-4 text-sm text-text-secondary">
          Preview: Episode {previewIndex} → <span className="text-white">{previewTitle}</span>
        </p>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          value={introStart ?? ""}
          onChange={(e) => setIntroStart(e.target.value === "" ? null : Number(e.target.value))}
          placeholder="Intro start (s)"
          className="w-36 rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
        />
        <input
          type="number"
          min={0}
          value={introEnd ?? ""}
          onChange={(e) => setIntroEnd(e.target.value === "" ? null : Number(e.target.value))}
          placeholder="Intro end (s)"
          className="w-36 rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
        />
        {!introValid && <span className="text-xs text-red-400">Start must be before end.</span>}
      </div>

      <p className="mb-1.5 text-sm font-medium text-white/90">Episode order (drag to reorder)</p>
      <div className="mb-4 flex flex-col gap-1 rounded-md border border-divider">
        {order.map((video, index) => (
          <div
            key={video._id}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== index) moveTo(dragIndex, index);
              setDragIndex(null);
            }}
            onDragEnd={() => setDragIndex(null)}
            className={`flex cursor-grab items-center gap-3 border-b border-divider px-3 py-2 text-sm last:border-b-0 active:cursor-grabbing ${
              dragIndex === index ? "opacity-50" : ""
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-text-tertiary" fill="currentColor">
              <circle cx="8" cy="6" r="1.5" />
              <circle cx="8" cy="12" r="1.5" />
              <circle cx="8" cy="18" r="1.5" />
              <circle cx="16" cy="6" r="1.5" />
              <circle cx="16" cy="12" r="1.5" />
              <circle cx="16" cy="18" r="1.5" />
            </svg>
            <span className="w-6 shrink-0 text-text-tertiary">{index + 1}.</span>
            <span className="flex-1 truncate text-white/90">{video.title ?? video.driveName}</span>
            {(video.titleOverridden || video.introOverridden) && (
              <span className="shrink-0 text-xs text-amber">Overridden</span>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={apply}
          disabled={applyMutation.isPending || !patternValid || !introValid || order.length === 0}
          className="rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          {applyMutation.isPending ? "Applying…" : `Apply to ${order.length} episode(s)`}
        </button>
        <button
          onClick={() => publishMutation.mutate()}
          disabled={publishMutation.isPending || !anyCurated}
          title={!anyCurated ? "Nothing here is curated yet — apply the rule first" : undefined}
          className="rounded-md border border-divider px-4 py-2 text-sm font-bold text-white/90 transition hover:bg-white/5 disabled:opacity-50"
        >
          {publishMutation.isPending ? "Publishing…" : "Publish all in this folder"}
        </button>
      </div>

      {applySummary && (
        <p className="mt-2 text-sm text-live">
          Applied to {applySummary.updated} video(s)
          {(applySummary.skippedTitle > 0 || applySummary.skippedIntro > 0) &&
            ` — skipped ${applySummary.skippedTitle} overridden title(s), ${applySummary.skippedIntro} overridden timing(s)`}
          .
        </p>
      )}
      {publishMutation.isSuccess && (
        <p className="mt-2 text-sm text-live">
          Published {publishMutation.data.publishedVideos} video(s){publishMutation.data.folderPublished && " and the folder"}.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
