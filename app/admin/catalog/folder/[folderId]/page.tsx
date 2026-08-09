import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { env } from "@/lib/env";
import { getCatalogFolder, getBreadcrumbChain, listChildFolders } from "@/lib/catalogFolders";
import { listVideosByParent } from "@/lib/catalogVideos";
import AdminNav from "@/components/admin/AdminNav";
import FolderTitleForm from "@/components/admin/FolderTitleForm";
import CatalogChildrenList from "@/components/admin/CatalogChildrenList";

export default async function AdminCatalogFolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    redirect("/");
  }

  const { folderId } = await params;
  const folder = await getCatalogFolder(folderId);
  if (!folder) notFound();

  const [breadcrumbs, childFolders, childVideos] = await Promise.all([
    getBreadcrumbChain(folderId, env.driveRootFolderId),
    listChildFolders(folderId),
    listVideosByParent(folderId),
  ]);

  return (
    <div className="w-full flex-1 px-4 py-8 sm:px-6">
      <AdminNav active="catalog" />

      <div className="mb-4 flex flex-wrap items-center gap-1 text-sm text-text-secondary">
        <Link href="/admin/catalog" className="transition hover:text-white">
          Catalog
        </Link>
        {breadcrumbs.map((crumb) => (
          <span key={crumb._id} className="flex items-center gap-1">
            <span className="text-text-tertiary">/</span>
            <Link href={`/admin/catalog/folder/${crumb._id}`} className="transition hover:text-white">
              {crumb.title ?? crumb.driveName}
            </Link>
          </span>
        ))}
      </div>

      <h1 className="mb-6 font-display text-4xl tracking-wide text-white">
        {folder.title ?? folder.driveName}
      </h1>

      <FolderTitleForm
        folderId={folderId}
        initialTitle={folder.title}
        driveName={folder.driveName}
        status={folder.status}
      />

      <h2 className="mb-1 text-lg font-bold text-white">Contents</h2>
      <CatalogChildrenList folders={childFolders} videos={childVideos} />
    </div>
  );
}
