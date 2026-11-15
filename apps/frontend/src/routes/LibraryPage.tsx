import { Link } from "react-router-dom";
import { useLibrary } from "../hooks/useCatalog";
import SpotlightCarousel from "../components/SpotlightCarousel";
import Rail from "../components/Rail";
import VideoCard from "../components/VideoCard";
import FolderCard from "../components/FolderCard";
import type { CatalogFolderListItem, CatalogVideoListItem } from "../lib/catalogListItem";

export default function LibraryPage() {
  const { data, isLoading, error } = useLibrary();

  if (isLoading) {
    return (
      <div className="w-full flex-1 px-4 py-16 sm:px-6">
        <div className="h-[50vh] animate-pulse rounded-lg bg-surface" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full flex-1 px-4 py-16 sm:px-6">
        <p className="text-red-400">Failed to load your library: {error.message}</p>
      </div>
    );
  }

  if (!data || data.empty) {
    return (
      <div className="w-full flex-1 px-4 py-16 sm:px-6">
        <p className="text-text-secondary">
          Your library is empty — curate something in the admin Catalog to get started, or{" "}
          <Link to="/requests" className="font-semibold text-amber underline">
            ask for a title
          </Link>
          .
        </p>
      </div>
    );
  }

  const { spotlight, continueWatching, folders, videos } = data;

  return (
    <>
      {spotlight.length > 0 && (
        <>
          <SpotlightCarousel slides={spotlight} />
          <div className="filmstrip" />
        </>
      )}

      <main className="pb-16">
        {continueWatching.length > 0 && (
          <Rail title="Continue Watching">
            {continueWatching.map(({ item, progress }) => (
              <div key={item.id} className="w-56 shrink-0">
                <VideoCard item={item as CatalogVideoListItem} progress={progress} />
              </div>
            ))}
          </Rail>
        )}

        {folders.length > 0 && (
          <Rail title="Series">
            {folders.map((folder) => (
              <div key={folder.id} className="w-56 shrink-0">
                <FolderCard item={folder as CatalogFolderListItem} />
              </div>
            ))}
          </Rail>
        )}

        {videos.length > 0 && (
          <Rail title="Movies">
            {videos.map((video) => (
              <div key={video.id} className="w-56 shrink-0">
                <VideoCard item={video as CatalogVideoListItem} />
              </div>
            ))}
          </Rail>
        )}
      </main>
    </>
  );
}
