"use client";

import { useState } from "react";

export default function Thumbnail({ fileId, alt }: { fileId: string; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex aspect-video items-center justify-center bg-gradient-to-br from-neutral-800 to-neutral-900 text-3xl">
        🎬
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/thumbnail/${fileId}`}
      alt={alt}
      className="aspect-video w-full scale-100 object-cover transition duration-300 ease-out group-hover:scale-110"
      onError={() => setFailed(true)}
    />
  );
}
