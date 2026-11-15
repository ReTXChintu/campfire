import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import type { AdminRequest, RequestCatalogRef, RequestCounts, RequestStatus } from "../lib/types";

type AdminRequestList = { requests: AdminRequest[]; counts: RequestCounts; total: number };

export function useAdminRequests(status: RequestStatus | "all") {
  return useQuery({
    queryKey: ["admin-requests", status],
    queryFn: () =>
      apiGet<AdminRequestList>(`/api/admin/requests${status === "all" ? "" : `?status=${status}`}`),
  });
}

/** Cheap counts-only call, for the admin nav's "N new" badge — the full list pulls a user lookup
 * per request and per voter, so the badge doesn't ride along on it. */
export function useAdminRequestCounts() {
  return useQuery({
    queryKey: ["admin-request-counts"],
    queryFn: () => apiGet<{ counts: RequestCounts }>("/api/admin/requests/counts"),
  });
}

function useInvalidateAdminRequests() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["admin-requests"] });
    queryClient.invalidateQueries({ queryKey: ["admin-request-counts"] });
    queryClient.invalidateQueries({ queryKey: ["requests"] });
    // Marking a request "added" with a catalogRef is what produces its spotlight slide.
    queryClient.invalidateQueries({ queryKey: ["library"] });
  };
}

export type AdminRequestPatch = {
  status?: RequestStatus;
  adminNote?: string | null;
  catalogRef?: RequestCatalogRef | null;
  type?: "movie" | "series" | null;
  year?: number | null;
};

export function useUpdateAdminRequest() {
  const invalidate = useInvalidateAdminRequests();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: AdminRequestPatch }) =>
      apiPatch<{ request: AdminRequest }>(`/api/admin/requests/${id}`, patch),
    onSuccess: invalidate,
  });
}

/** The server refuses "declined" and "added" in bulk (each needs a per-request note or catalog
 * link); the UI only offers the other three, and surfaces the 400 if it ever gets one anyway. */
export function useBulkRequestStatus() {
  const invalidate = useInvalidateAdminRequests();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: RequestStatus }) =>
      apiPost<{ updated: number; counts: RequestCounts }>("/api/admin/requests/bulk-status", { ids, status }),
    onSuccess: invalidate,
  });
}

export function useDeleteAdminRequest() {
  const invalidate = useInvalidateAdminRequests();
  return useMutation({
    mutationFn: (id: string) => apiDelete<{ ok: true }>(`/api/admin/requests/${id}`),
    onSuccess: invalidate,
  });
}
