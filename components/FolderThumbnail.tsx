"use client";

import { useState } from "react";

export default function FolderThumbnail({
  folderId,
  alt,
  className,
}: {
  folderId: string;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-surface-hover to-surface text-3xl ${className ?? ""}`}>
        🎬
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/thumbnail/folder/${folderId}`}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
