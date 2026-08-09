import { auth } from "@/auth";
import { env } from "@/lib/env";
import { listPublishedFoldersByParent } from "@/lib/catalogFolders";
import { listPublishedVideosByParent, getCatalogVideo } from "@/lib/catalogVideos";
import { getRecentInProgress } from "@/lib/progress";
import { naturalSort, type CatalogListItem } from "@/lib/catalogListItem";
import Hero from "@/components/Hero";
import Rail from "@/components/Rail";
import VideoCard from "@/components/VideoCard";
import FolderCard from "@/components/FolderCard";

export default async function LibraryPage() {
  const session = await auth();
  const [folderDocs, videoDocs] = await Promise.all([
    listPublishedFoldersByParent(env.driveRootFolderId),
    listPublishedVideosByParent(env.driveRootFolderId),
  ]);

  const folders = naturalSort(
    folderDocs.map((f) => ({
      kind: "folder" as const,
      id: f._id,
      name: f.title!,
      thumbnailFileId: f.thumbnailFileId,
    })),
  );
  const videos = naturalSort(
    videoDocs.map((v) => ({ kind: "video" as const, id: v._id, name: v.title!, mimeType: v.mimeType })),
  );
  const items: (CatalogListItem & { curatedAt: Date | null })[] = [
    ...folderDocs.map((f) => ({
      kind: "folder" as const,
      id: f._id,
      name: f.title!,
      thumbnailFileId: f.thumbnailFileId,
      curatedAt: f.curatedAt,
    })),
    ...videoDocs.map((v) => ({
      kind: "video" as const,
      id: v._id,
      name: v.title!,
      mimeType: v.mimeType,
      curatedAt: v.curatedAt,
    })),
  ];

  if (items.length === 0) {
    return (
      <div className="w-full flex-1 px-4 py-16 sm:px-6">
        <p className="text-text-secondary">
          Your library is empty — curate something in the admin Catalog to get started.
        </p>
      </div>
    );
  }

  // Real "most recently curated" pick, not a fabricated hero slot.
  const hero = [...items].sort((a, b) => {
    const at = a.curatedAt ? new Date(a.curatedAt).getTime() : 0;
    const bt = b.curatedAt ? new Date(b.curatedAt).getTime() : 0;
    return bt - at;
  })[0];

  let heroPlayHref = `/folder/${hero.id}`;
  const heroInfoHref = hero.kind === "folder" ? `/folder/${hero.id}` : undefined;
  if (hero.kind === "video") {
    heroPlayHref = `/watch/${hero.id}`;
  } else {
    const episodesInFolder = naturalSort(
      (await listPublishedVideosByParent(hero.id)).map((v) => ({ id: v._id, name: v.title! })),
    );
    heroPlayHref = episodesInFolder[0] ? `/watch/${episodesInFolder[0].id}` : `/folder/${hero.id}`;
  }

  const continueWatching = session?.user?.id ? await getRecentInProgress(session.user.id, 12) : [];
  const continueWatchingItems = (
    await Promise.all(
      continueWatching.map(async (progress) => {
        const video = await getCatalogVideo(progress.fileId);
        if (!video || video.status !== "published") return null; // unpublished or deleted — skip rather than break the row
        return {
          item: { kind: "video" as const, id: video._id, name: video.title!, mimeType: video.mimeType },
          progress,
        };
      }),
    )
  ).filter((v): v is NonNullable<typeof v> => v !== null);

  return (
    <>
      <Hero title={hero.name} badge="Recently Added" playHref={heroPlayHref} infoHref={heroInfoHref} />
      <div className="filmstrip" />

      <main className="pb-16">
        {continueWatchingItems.length > 0 && (
          <Rail title="Continue Watching">
            {continueWatchingItems.map(({ item, progress }) => (
              <div key={item.id} className="w-56 shrink-0">
                <VideoCard item={item} progress={progress} />
              </div>
            ))}
          </Rail>
        )}

        {folders.length > 0 && (
          <Rail title="Series">
            {folders.map((folder) => (
              <div key={folder.id} className="w-56 shrink-0">
                <FolderCard item={folder} />
              </div>
            ))}
          </Rail>
        )}

        {videos.length > 0 && (
          <Rail title="Movies">
            {videos.map((video) => (
              <div key={video.id} className="w-56 shrink-0">
                <VideoCard item={video} />
              </div>
            ))}
          </Rail>
        )}
      </main>
    </>
  );
}
