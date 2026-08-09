import { useAuthedImage } from "../hooks/useAuthedImage";

export default function FolderThumbnail({
  folderId,
  alt,
  className,
}: {
  folderId: string;
  alt: string;
  className?: string;
}) {
  const { url, failed } = useAuthedImage(`/api/thumbnail-folder/${folderId}`);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center bg-gradient-to-br from-surface-hover to-surface text-3xl ${className ?? ""}`}
      >
        🎬
      </div>
    );
  }

  if (!url) {
    return <div className={`animate-pulse bg-surface ${className ?? ""}`} />;
  }

  return <img src={url} alt={alt} className={className} />;
}
