import { Link, useParams } from "react-router-dom";
import { useAdminFolder } from "../../hooks/useAdminCatalog";
import AdminShell from "../../components/admin/AdminShell";
import FolderTitleForm from "../../components/admin/FolderTitleForm";
import ArtworkPanel from "../../components/admin/ArtworkPanel";
import FolderPublishRule from "../../components/admin/FolderPublishRule";
import CatalogChildrenList from "../../components/admin/CatalogChildrenList";
import NotFoundPage from "../NotFoundPage";

export default function AdminCatalogFolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const { data, isLoading, error } = useAdminFolder(folderId!);

  if (isLoading) {
    return (
      <div className="w-full flex-1 px-4 py-8 sm:px-6">
        <div className="h-40 animate-pulse rounded-lg bg-surface" />
      </div>
    );
  }

  if (error || !data) return <NotFoundPage />;

  const { folder, breadcrumbs, childFolders, childVideos, isTopLevel } = data;

  return (
    <AdminShell section="catalog" title={folder.title ?? folder.driveName}>
      <div className="mb-4 flex flex-wrap items-center gap-1 text-sm text-text-secondary">
        <Link to="/admin/catalog" className="transition hover:text-white">
          Catalog
        </Link>
        {breadcrumbs.map((crumb) => (
          <span key={crumb._id} className="flex items-center gap-1">
            <span className="text-text-tertiary">/</span>
            <Link to={`/admin/catalog/folder/${crumb._id}`} className="transition hover:text-white">
              {crumb.title ?? crumb.driveName}
            </Link>
          </span>
        ))}
      </div>

      <FolderTitleForm
        folderId={folderId!}
        initialTitle={folder.title}
        driveName={folder.driveName}
        status={folder.status}
      />

      {isTopLevel && (
        <ArtworkPanel
          kind="folder"
          id={folderId!}
          artwork={folder.artwork}
          autoOff={folder.artworkAutoOff}
          hasDriveThumbnail={Boolean(folder.thumbnailFileId)}
        />
      )}

      {childVideos.length > 0 && (
        <FolderPublishRule
          folderId={folderId!}
          childVideos={childVideos}
          initialRule={folder.publishRule}
        />
      )}

      <h2 className="mb-1 font-display text-xl tracking-wide text-white">Contents</h2>
      <CatalogChildrenList folders={childFolders} videos={childVideos} />
    </AdminShell>
  );
}
