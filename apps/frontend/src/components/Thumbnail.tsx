import { useAuthedImage } from "../hooks/useAuthedImage";

export default function Thumbnail({ fileId, alt }: { fileId: string; alt: string }) {
  const { url, failed } = useAuthedImage(`/api/thumbnail/${fileId}`);

  if (failed) {
    return (
      <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900 text-3xl">
        🎬
      </div>
    );
  }

  if (!url) {
    return <div className="aspect-video w-full animate-pulse bg-surface" />;
  }

  return (
    <img
      src={url}
      alt={alt}
      className="aspect-video w-full scale-100 object-cover transition duration-300 ease-out group-hover:scale-110"
    />
  );
}
