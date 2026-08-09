import { useEffect, useState } from "react";
import { fetchAuthedBlobUrl } from "../lib/api";

/** Loads an admin/auth-gated image via a Bearer-authenticated fetch and exposes it as an object
 * URL a plain <img> can use — simpler than a scoped media token for something that's never
 * Range-requested (see lib/mediaToken.ts for why video/subtitle need the token approach instead). */
export function useAuthedImage(path: string | null): { url: string | null; failed: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setFailed(false);
    setUrl(null);

    fetchAuthedBlobUrl(path)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        objectUrl = u;
        setUrl(u);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return { url, failed };
}
