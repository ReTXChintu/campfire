import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import type { WatchParty, WatchPartyJoinTokenResponse } from "../lib/types";

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

export function useJoinWatchPartyToken(partyId: string | null) {
  return useQuery({
    queryKey: ["watch-party-token", partyId],
    enabled: !!partyId,
    queryFn: async () => {
      return apiPost<WatchPartyJoinTokenResponse>(`/api/watch-parties/${partyId!}/join-token`);
    },
  });
}

export function useUpdateWatchPartyState(partyId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { playing: boolean; positionSeconds: number; playbackRate: number }) => {
      const data = await apiPatch<{ party: WatchParty }>(`/api/watch-parties/${partyId!}/state`, input);
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
