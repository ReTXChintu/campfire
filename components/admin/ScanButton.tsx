"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ScanResult = {
  foldersScanned: number;
  videosScanned: number;
  foldersAdded: number;
  videosAdded: number;
  foldersDeleted: number;
  videosDeleted: number;
  deletedFolders: { id: string; driveName: string }[];
  deletedVideos: { id: string; driveName: string }[];
  erroredFolderIds: string[];
};

export default function ScanButton() {
  const router = useRouter();
  const [scanning, setScanning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runScan = async () => {
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/scan", { method: "POST" });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Scan failed");
      const data = (await res.json()) as ScanResult;
      setResult(data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="mb-8">
      <button
        onClick={runScan}
        disabled={scanning}
        className="rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
      >
        {scanning ? "Scanning Drive…" : "Scan Drive"}
      </button>

      {result && (
        <div className="mt-2 text-sm text-text-secondary">
          <p>
            Scanned {result.foldersScanned} folders / {result.videosScanned} videos — found{" "}
            <span className="text-white">{result.foldersAdded} new folders</span> and{" "}
            <span className="text-white">{result.videosAdded} new videos</span>.
            {result.erroredFolderIds.length > 0 && (
              <span className="text-amber"> ({result.erroredFolderIds.length} folders failed to scan)</span>
            )}
          </p>
          {(result.foldersDeleted > 0 || result.videosDeleted > 0) && (
            <p className="mt-1">
              Removed from the catalog — no longer in Drive:{" "}
              <span className="text-white">
                {result.foldersDeleted} folders, {result.videosDeleted} videos
              </span>
              {(result.deletedFolders.length > 0 || result.deletedVideos.length > 0) && (
                <span className="text-text-tertiary">
                  {" "}
                  ({[...result.deletedFolders, ...result.deletedVideos].map((d) => d.driveName).join(", ")})
                </span>
              )}
            </p>
          )}
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
