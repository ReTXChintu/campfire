import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./api";

// Mints (and caches) a scoped media token for one fileId — see the backend's
// routes/media-token.ts. Tokens are valid for 2h; staleTime here is set comfortably under that so
// a long-open tab re-mints before the token a <video>/<track> is using could expire mid-playback.
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const STALE_MS = TOKEN_TTL_MS - 15 * 60 * 1000;

export function useMediaToken(fileId: string | null) {
  return useQuery({
    queryKey: ["media-token", fileId],
    queryFn: () => apiGet<{ token: string }>(`/api/media-token?fileId=${encodeURIComponent(fileId!)}`),
    enabled: !!fileId,
    staleTime: STALE_MS,
    select: (data) => data.token,
  });
}
