import { Link, useNavigate, useParams } from "react-router-dom";
import { useAdminVideo, useDeleteVideo } from "../../hooks/useAdminCatalog";
import { ApiError } from "../../lib/api";
import AdminNav from "../../components/admin/AdminNav";
import VideoCurationForm from "../../components/admin/VideoCurationForm";
import NotFoundPage from "../NotFoundPage";

export default function AdminCatalogVideoPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useAdminVideo(fileId!);
  const deleteMutation = useDeleteVideo(fileId!);

  if (isLoading) {
    return (
      <div className="w-full flex-1 px-4 py-8 sm:px-6">
        <div className="h-40 animate-pulse rounded-lg bg-surface" />
      </div>
    );
  }

  if (error || !data) return <NotFoundPage />;

  const { video, parentFolder, subtitleSetOptions } = data;
  const displayName = video.title ?? video.driveName;

  const handleDelete = () => {
    const confirmed = window.confirm(
      `Delete "${displayName}"?\n\nThis moves the file to Drive's trash and removes it from Campfire along with its subtitles, everyone's watch progress on it, and its generated quality tiers. Drive keeps trashed files for 30 days; everything else is gone immediately.`,
    );
    if (!confirmed) return;
    deleteMutation.mutate(undefined, {
      onSuccess: ({ parentFolderId }) => {
        navigate(parentFolder ? `/admin/catalog/folder/${parentFolderId}` : "/admin/catalog", { replace: true });
      },
    });
  };

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

      <h1 className="mb-6 font-display text-4xl tracking-wide text-white">{displayName}</h1>

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
        renditions={video.renditions ?? {}}
        titleOverridden={video.titleOverridden}
        introOverridden={video.introOverridden}
      />

      <section className="mt-10 rounded-xl border border-danger/30 bg-danger-soft p-4">
        <h2 className="text-sm font-semibold text-danger">Danger zone</h2>
        <p className="mt-1 max-w-xl text-sm text-text-secondary">
          Removes this video from Campfire and moves the file to Drive&apos;s trash. Its subtitles, everyone&apos;s
          watch progress, and any generated quality tiers go with it.
        </p>
        {deleteMutation.error && (
          <p className="mt-2 text-sm text-danger">
            {deleteMutation.error instanceof ApiError ? deleteMutation.error.message : "Delete failed"}
          </p>
        )}
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleteMutation.isPending}
          className="mt-3 rounded-full border border-danger/40 px-4 py-2 text-sm font-semibold text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {deleteMutation.isPending ? "Deleting…" : "Delete video"}
        </button>
      </section>
    </div>
  );
}
