import { useParams, useSearchParams } from "react-router-dom";
import { useFolder } from "../hooks/useCatalog";
import FolderView from "../components/FolderView";
import SeriesView from "../components/SeriesView";
import NotFoundPage from "./NotFoundPage";
import type { WatchProgress } from "../lib/types";

export default function FolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const [searchParams] = useSearchParams();
  const season = searchParams.get("season");
  const { data, isLoading, error } = useFolder(folderId!, season);

  if (isLoading) {
    return (
      <div className="w-full px-4 py-8 sm:px-6">
        <div className="mb-6 h-[300px] animate-pulse rounded-lg bg-surface" />
      </div>
    );
  }

  if (error || !data) return <NotFoundPage />;

  if (data.mode === "flat") {
    const progressByFileId = new Map<string, WatchProgress>(data.progress.map((p) => [p.fileId, p]));
    return (
      <FolderView
        folderId={data.folderId}
        title={data.title!}
        backHref={data.backHref}
        thumbnailFileId={data.thumbnailFileId}
        items={data.items}
        progressByFileId={progressByFileId}
      />
    );
  }

  const progressByFileId = new Map<string, WatchProgress>(data.progress.map((p) => [p.fileId, p]));
  return (
    <SeriesView
      folderId={data.folderId}
      title={data.title!}
      backHref={data.backHref}
      thumbnailFileId={data.thumbnailFileId}
      seasons={data.seasons}
      selectedSeasonId={data.selectedSeasonId}
      seasonItems={data.seasonItems}
      specialItems={data.specialItems}
      progressByFileId={progressByFileId}
    />
  );
}
