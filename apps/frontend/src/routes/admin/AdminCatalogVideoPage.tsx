import { Link, useParams } from "react-router-dom";
import { useAdminVideo } from "../../hooks/useAdminCatalog";
import AdminNav from "../../components/admin/AdminNav";
import VideoCurationForm from "../../components/admin/VideoCurationForm";
import NotFoundPage from "../NotFoundPage";

export default function AdminCatalogVideoPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const { data, isLoading, error } = useAdminVideo(fileId!);

  if (isLoading) {
    return (
      <div className="w-full flex-1 px-4 py-8 sm:px-6">
        <div className="h-40 animate-pulse rounded-lg bg-surface" />
      </div>
    );
  }

  if (error || !data) return <NotFoundPage />;

  const { video, parentFolder, subtitleSetOptions } = data;

  return (
    <div className="w-full flex-1 px-4 py-8 sm:px-6">
      <AdminNav active="catalog" />

      <div className="mb-4 flex flex-wrap items-center gap-1 text-sm text-text-secondary">
        <Link to="/admin/catalog" className="transition hover:text-white">
          Catalog
        </Link>
        {parentFolder && (
          <span className="flex items-center gap-1">
            <span className="text-text-tertiary">/</span>
            <Link to={`/admin/catalog/folder/${parentFolder._id}`} className="transition hover:text-white">
              {parentFolder.title ?? parentFolder.driveName}
            </Link>
          </span>
        )}
      </div>

      <h1 className="mb-6 font-display text-4xl tracking-wide text-white">
        {video.title ?? video.driveName}
      </h1>

      <VideoCurationForm
        fileId={fileId!}
        driveName={video.driveName}
        initialTitle={video.title}
        initialIntroStart={video.introStart}
        initialIntroEnd={video.introEnd}
        initialOutroStart={video.outroStart}
        initialSubtitleSetIds={video.subtitleSetIds ?? []}
        subtitleSetOptions={subtitleSetOptions}
        status={video.status}
      />
    </div>
  );
}
