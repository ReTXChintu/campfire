import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, apiPostBinary } from "../lib/api";
import type { PublicRequest, ResolveLinkResult } from "../lib/types";

/** Everything the requests board and the request form touch. Same shape as useCatalog.ts: one
 * useQuery per endpoint, mutations that invalidate the queries their write could have changed. */

type RequestListResponse = { requests: PublicRequest[] };

export function useRequests() {
  return useQuery({
    queryKey: ["requests"],
    queryFn: () => apiGet<RequestListResponse>("/api/requests"),
  });
}

export function useMyRequests() {
  return useQuery({
    queryKey: ["requests", "mine"],
    queryFn: () => apiGet<RequestListResponse>("/api/requests/mine"),
  });
}

/** The form's dedupe hint. `title` is already debounced by the caller, and the server answers
 * `{ match: null }` under two characters, so there's nothing to guard here beyond not firing on an
 * empty field. */
export function useRequestMatch(title: string) {
  const trimmed = title.trim();
  return useQuery({
    queryKey: ["requests", "match", trimmed],
    queryFn: () => apiGet<{ match: PublicRequest | null }>(`/api/requests/match?title=${encodeURIComponent(trimmed)}`),
    enabled: trimmed.length >= 2,
    // A dedupe hint that's a few seconds stale is still a good hint, and the field re-queries on
    // every debounce tick as it is.
    staleTime: 30_000,
  });
}

/** Invalidates every list a write to one request could change — the board, your own list, the
 * admin list and counts, plus the library (an "added" request can produce a spotlight slide). */
function useInvalidateRequests() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["requests"] });
    queryClient.invalidateQueries({ queryKey: ["admin-requests"] });
    queryClient.invalidateQueries({ queryKey: ["library"] });
  };
}

export function useResolveLink() {
  return useMutation({
    mutationFn: (link: string) => apiPost<ResolveLinkResult>("/api/requests/resolve-link", { link }),
  });
}

/** Uploads the reference image on its own, before submit: the create call then references the
 * returned id, so an abandoned form costs one orphaned file rather than a half-written request. */
export function useUploadReferenceImage() {
  return useMutation({
    mutationFn: (file: File) =>
      apiPostBinary<{ imageId: string; sizeBytes: number; path: string }>("/api/requests/reference-image", file),
  });
}

export function useCreateRequest() {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (input: { title: string; refLink?: string; refImageId?: string }) =>
      apiPost<{ request: PublicRequest }>("/api/requests", input),
    onSuccess: invalidate,
  });
}

export function useToggleUpvote() {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: ({ id, wantsIt }: { id: string; wantsIt: boolean }) =>
      apiPost<{ request: PublicRequest }>(`/api/requests/${id}/upvote`, { wantsIt }),
    onSuccess: invalidate,
  });
}

export function useDeleteRequest() {
  const invalidate = useInvalidateRequests();
  return useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: true }>(`/api/requests/${id}`),
    onSuccess: invalidate,
  });
}
