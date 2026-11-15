import { useParams, useSearchParams } from "react-router-dom";
import { useFolder } from "../hooks/useCatalog";
import FolderView from "../components/FolderView";
import SeriesView from "../components/SeriesView";
import NotFoundPage from "./NotFoundPage";
import { CardSkeletonGrid, ErrorCard, Skeleton } from "../components/ui/States";
import { ApiError } from "../lib/api";
import { PAGE_X } from "../lib/layout";
import type { WatchProgress } from "../lib/types";

export default function FolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const [searchParams] = useSearchParams();
  const season = searchParams.get("season");
  const { data, isLoading, error, refetch, isFetching } = useFolder(folderId!, season);

  if (isLoading) {
    return (
      <main className={`w-full flex-1 ${PAGE_X} py-8`}>
        <div className="mb-8 grid gap-7 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
          <Skeleton className="aspect-[2/3] w-full max-w-[180px] lg:max-w-none" />
          <div className="grid content-start gap-3">
            <Skeleton className="h-10 w-2/3 rounded" />
            <Skeleton className="h-11 w-40" />
          </div>
          <div className="grid content-start gap-2.5">
            <Skeleton className="h-5 w-full rounded" />
            <Skeleton className="h-5 w-4/5 rounded" />
          </div>
        </div>
        <CardSkeletonGrid count={8} />
      </main>
    );
  }

  // A missing folder is a 404 page; anything else (offline, server error) is a retryable card —
  // the old code turned both into "Not Found", which made a flaky network look like a dead link.
  if (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return <NotFoundPage />;
    return (
      <main className={`w-full flex-1 ${PAGE_X} py-8`}>
        <ErrorCard
          title="This page did not load"
          message={error.message}
          onRetry={() => refetch()}
          retrying={isFetching}
        />
      </main>
    );
  }

  if (!data) return <NotFoundPage />;

  const progressByFileId = new Map<string, WatchProgress>(data.progress.map((entry) => [entry.fileId, entry]));

  if (data.mode === "flat") {
    return (
      <FolderView
        folderId={data.folderId}
        title={data.title!}
        backHref={data.backHref}
        thumbnailFileId={data.thumbnailFileId}
        meta={data}
        items={data.items}
        progressByFileId={progressByFileId}
      />
    );
  }

  return (
    <SeriesView
      folderId={data.folderId}
      title={data.title!}
      backHref={data.backHref}
      thumbnailFileId={data.thumbnailFileId}
      meta={data}
      seasons={data.seasons}
      selectedSeasonId={data.selectedSeasonId}
      seasonItems={data.seasonItems}
      specialItems={data.specialItems}
      progressByFileId={progressByFileId}
    />
  );
}
