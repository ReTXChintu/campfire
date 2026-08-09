import { useRunScan } from "../../hooks/useAdminCatalog";

export default function ScanButton() {
  const { mutate, data: result, error, isPending } = useRunScan();

  return (
    <div className="mb-8">
      <button
        onClick={() => mutate()}
        disabled={isPending}
        className="rounded-md bg-white px-4 py-2 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
      >
        {isPending ? "Scanning Drive…" : "Scan Drive"}
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
      {error && <p className="mt-2 text-sm text-red-400">{error.message}</p>}
    </div>
  );
}
