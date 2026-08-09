import { useParams } from "react-router-dom";
import { useVideo } from "../hooks/useCatalog";
import VideoPlayer from "../components/VideoPlayer";
import NotFoundPage from "./NotFoundPage";

export default function WatchPage() {
  const { fileId } = useParams<{ fileId: string }>();
  const { data: video, isLoading, error } = useVideo(fileId!);

  if (isLoading) {
    return (
      <div className="w-full flex-1 px-4 py-6 sm:px-6">
        <div className="aspect-video w-full animate-pulse rounded-lg bg-surface" />
      </div>
    );
  }

  if (error || !video) return <NotFoundPage />;

  return (
    <div className="w-full flex-1 px-4 py-6 sm:px-6">
      <VideoPlayer
        fileId={video.fileId}
        title={video.title!}
        backHref={video.backHref}
        parentFolderId={video.parentFolderId}
        nextFileId={video.nextFileId}
        previousFileId={video.previousFileId}
        episodes={video.episodes}
        progressByFileId={video.progressByFileId}
        initialPositionSeconds={video.initialPositionSeconds}
        initialCompleted={video.initialCompleted}
        seekMode={video.seekMode}
        durationSeconds={video.durationSeconds}
        subtitles={video.subtitles}
        introStart={video.introStart}
        introEnd={video.introEnd}
        outroStart={video.outroStart}
      />
    </div>
  );
}
