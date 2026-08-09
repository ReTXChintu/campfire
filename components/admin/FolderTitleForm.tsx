"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Status = "pending" | "curated" | "published";

export default function FolderTitleForm({
  folderId,
  initialTitle,
  driveName,
  status,
}: {
  folderId: string;
  initialTitle: string | null;
  driveName: string;
  status: Status;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle ?? driveName);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/catalog/folder/${folderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
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
      const res = await fetch(`/api/admin/catalog/folder/${folderId}/${action}`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="mb-8 rounded-lg border border-divider p-4">
      <p className="mb-2 text-xs text-text-tertiary">Drive name: {driveName}</p>
      <label className="mb-1.5 block text-sm font-medium text-white/90">Title</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setSaved(false);
          }}
          className="flex-1 rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
        />
        <button
          onClick={save}
          disabled={saving || !title.trim()}
          className="rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      {saved && <p className="mt-2 text-sm text-live">Saved.</p>}

      <div className="mt-4 flex items-center gap-3 border-t border-divider pt-4">
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
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
