import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { getDeviceId, getDeviceLabel } from "../lib/deviceId";
import type { WatchParty, WatchPartyJoinTokenResult, WatchPartyParticipant } from "../lib/types";

export function useWatchParty(partyId: string | null) {
  return useQuery({
    queryKey: ["watch-party", partyId],
    enabled: !!partyId,
    queryFn: async () => {
      const data = await apiGet<{ party: WatchParty }>(`/api/watch-parties/${partyId!}`);
      return data.party;
    },
  });
}

export function useCreateWatchParty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { fileId: string; title: string | null }) => {
      const data = await apiPost<{ party: WatchParty }>("/api/watch-parties", input);
      return data.party;
    },
    onSuccess: (party) => {
      queryClient.setQueryData(["watch-party", party.id], party);
    },
  });
}

// `confirmed`/`chosenMainDeviceId` are set once the caller has resolved a `requiresConfirmation`/
// `requiresRoleChoice` response (see WatchPage.tsx) — included in the query key so answering the
// prompt triggers a fresh join-token call with the user's choice attached, rather than replaying
// the original (still-pending) request.
export function useJoinWatchPartyToken(
  partyId: string | null,
  options?: { confirmed?: boolean; chosenMainDeviceId?: string },
) {
  return useQuery({
    queryKey: ["watch-party-token", partyId, options?.confirmed ?? false, options?.chosenMainDeviceId ?? null],
    enabled: !!partyId,
    queryFn: async () => {
      return apiPost<WatchPartyJoinTokenResult>(`/api/watch-parties/${partyId!}/join-token`, {
        deviceId: getDeviceId(),
        deviceLabel: getDeviceLabel(),
        clientKind: "web",
        confirmed: options?.confirmed,
        chosenMainDeviceId: options?.chosenMainDeviceId,
      });
    },
  });
}

export function useUpdateWatchPartyState(partyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { playing: boolean; positionSeconds: number; playbackRate: number }) => {
      const data = await apiPatch<{ party: WatchParty }>(`/api/watch-parties/${partyId!}/state`, input, {
        "X-Watch-Party-Device-Id": getDeviceId(),
      });
      return data.party;
    },
    onSuccess: (party) => {
      queryClient.setQueryData(["watch-party", party.id], party);
    },
  });
}

export function useEndWatchParty(partyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const data = await apiDelete<{ party: WatchParty | null }>(`/api/watch-parties/${partyId!}`);
      return data.party;
    },
    onSuccess: (_party) => {
      if (partyId) {
        queryClient.removeQueries({ queryKey: ["watch-party", partyId] });
        queryClient.removeQueries({ queryKey: ["watch-party-token", partyId] });
      }
    },
  });
}

export function useWatchPartyParticipants(partyId: string | null) {
  return useQuery({
    queryKey: ["watch-party-participants", partyId],
    enabled: !!partyId,
    // Belt-and-suspenders fallback to the "watch-party-control" LiveKit data-channel push
    // (WatchPage.tsx applies that live; this just guards against a missed message).
    refetchInterval: 5000,
    queryFn: async () => {
      const data = await apiGet<{ participants: WatchPartyParticipant[] }>(
        `/api/watch-parties/${partyId!}/participants`,
      );
      return data.participants;
    },
  });
}

export function useGrantWatchPartyControl(partyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: string; deviceId: string; grant: boolean }) => {
      const data = await apiPost<{ participants: WatchPartyParticipant[] }>(
        `/api/watch-parties/${partyId!}/participants/${input.userId}/control`,
        { deviceId: input.deviceId, grant: input.grant },
      );
      return data.participants;
    },
    onSuccess: (participants) => {
      if (partyId) queryClient.setQueryData(["watch-party-participants", partyId], participants);
    },
  });
}

export function sendWatchPartyHeartbeat(partyId: string): void {
  apiPost(`/api/watch-parties/${partyId}/heartbeat`, { deviceId: getDeviceId() }).catch(() => {});
}

export function leaveWatchParty(partyId: string): void {
  apiPost(`/api/watch-parties/${partyId}/leave`, { deviceId: getDeviceId() }).catch(() => {});
}
