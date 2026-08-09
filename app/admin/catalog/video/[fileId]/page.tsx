import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { getCatalogVideo } from "@/lib/catalogVideos";
import { getCatalogFolder } from "@/lib/catalogFolders";
import { listUnlinkedSubtitleSets, listSubtitleSetsByIds } from "@/lib/subtitleSets";
import AdminNav from "@/components/admin/AdminNav";
import VideoCurationForm from "@/components/admin/VideoCurationForm";

export default async function AdminCatalogVideoPage({
  params,
}: {
  params: Promise<{ fileId: string }>;
}) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    redirect("/");
  }

  const { fileId } = await params;
  const video = await getCatalogVideo(fileId);
  if (!video) notFound();

  const [parentFolder, unlinkedSets, linkedSets] = await Promise.all([
    getCatalogFolder(video.parentFolderId),
    listUnlinkedSubtitleSets(),
    listSubtitleSetsByIds(video.subtitleSetIds ?? []),
  ]);

  const subtitleSetOptions = [...unlinkedSets, ...linkedSets].map((set) => ({
    id: set._id.toString(),
    sourceLabel: set.sourceLabel,
    createdAt: set.createdAt.toISOString(),
    tracks: set.subtitles.map((s) => ({ index: s.index, language: s.language, title: s.title })),
  }));

  return (
    <div className="w-full flex-1 px-4 py-8 sm:px-6">
      <AdminNav active="catalog" />

      <div className="mb-4 flex flex-wrap items-center gap-1 text-sm text-text-secondary">
        <Link href="/admin/catalog" className="transition hover:text-white">
          Catalog
        </Link>
        {parentFolder && (
          <span className="flex items-center gap-1">
            <span className="text-text-tertiary">/</span>
            <Link href={`/admin/catalog/folder/${parentFolder._id}`} className="transition hover:text-white">
              {parentFolder.title ?? parentFolder.driveName}
            </Link>
          </span>
        )}
      </div>

      <h1 className="mb-6 font-display text-4xl tracking-wide text-white">
        {video.title ?? video.driveName}
      </h1>

      <VideoCurationForm
        fileId={fileId}
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
