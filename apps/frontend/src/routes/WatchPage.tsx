import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RoomAudioRenderer, RoomContext } from "@livekit/components-react";
import { ConnectionState, Room, RoomEvent, type Participant } from "livekit-client";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import VideoPlayer from "../components/VideoPlayer";
import DesktopAppRequiredNotice from "../components/DesktopAppRequiredNotice";
import WatchPartyChat from "../components/WatchPartyChat";
import { useVideo } from "../hooks/useCatalog";
import {
  leaveWatchParty,
  sendWatchPartyHeartbeat,
  useCreateWatchParty,
  useEndWatchParty,
  useJoinWatchPartyToken,
  useUpdateWatchPartyState,
  useWatchParty,
} from "../hooks/useWatchParty";
import { useAuth } from "../lib/auth";
import { getDeviceId } from "../lib/deviceId";
import type { WatchParty, WatchPartyJoinTokenResponse, WatchPartySyncState } from "../lib/types";
import NotFoundPage from "./NotFoundPage";

type PartyParticipant = {
  identity: string;
  name: string;
  isHost: boolean;
  isLocal: boolean;
};

function extractPartyCode(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    return parsed.searchParams.get("party") ?? trimmed;
  } catch {
    return trimmed;
  }
}

function toSyncState(party: WatchParty): WatchPartySyncState {
  return {
    type: "sync-state",
    playing: party.playing,
    positionSeconds: party.positionSeconds,
    playbackRate: party.playbackRate,
    updatedAt: party.updatedAt,
  };
}

function isSyncState(value: unknown): value is WatchPartySyncState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<WatchPartySyncState>;
  return (
    candidate.type === "sync-state" &&
    typeof candidate.playing === "boolean" &&
    typeof candidate.positionSeconds === "number" &&
    typeof candidate.playbackRate === "number" &&
    typeof candidate.updatedAt === "string"
  );
}

export default function WatchPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { fileId } = useParams<{ fileId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const partyId = searchParams.get("party");
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const [participants, setParticipants] = useState<PartyParticipant[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [incomingSyncState, setIncomingSyncState] = useState<WatchPartySyncState | null>(null);
  const [audioReady, setAudioReady] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [partyNotice, setPartyNotice] = useState<string | null>(null);
  // Set right before we ourselves clear `party` from the URL (leave/end), so the room's
  // resulting Disconnected transition isn't mistaken for a kick/network drop and doesn't pop the
  // "you were disconnected" notice right after the user chose to leave.
  const intentionalDisconnectRef = useRef(false);

  // Answers to the "you're already watching on {device} — join from this device too?" /
  // "which device is main?" prompts join-token can respond with instead of joining outright (see
  // apps/backend/src/routes/watchParties.ts) — reset whenever the party being joined changes, so
  // a stale confirmation never silently carries over to a different party.
  const [joinConfirmed, setJoinConfirmed] = useState(false);
  const [joinChosenMainDeviceId, setJoinChosenMainDeviceId] = useState<string | undefined>(undefined);
  useEffect(() => {
    setJoinConfirmed(false);
    setJoinChosenMainDeviceId(undefined);
  }, [partyId]);

  const { data: video, isLoading, error } = useVideo(fileId!);
  const watchParty = useWatchParty(partyId);
  const createWatchParty = useCreateWatchParty();
  const joinWatchPartyToken = useJoinWatchPartyToken(partyId, {
    confirmed: joinConfirmed,
    chosenMainDeviceId: joinChosenMainDeviceId,
  });
  const updateWatchPartyState = useUpdateWatchPartyState(partyId);
  const endWatchParty = useEndWatchParty(partyId);

  const tokenResult = joinWatchPartyToken.data;
  const needsConfirmation = tokenResult?.requiresConfirmation === true;
  const needsRoleChoice = tokenResult?.requiresRoleChoice === true;
  const joinedTokenData: WatchPartyJoinTokenResponse | undefined =
    tokenResult && !tokenResult.requiresConfirmation && !tokenResult.requiresRoleChoice ? tokenResult : undefined;

  const party = watchParty.data ?? joinedTokenData?.party ?? null;
  const deviceRole = joinedTokenData?.deviceRole ?? "main";
  // A companion device never holds playback control, even the host's own — so `isHost` here means
  // specifically "this session may control playback," not just "this account owns the party."
  const isHost = (joinedTokenData?.isHost ?? party?.hostUserId === user?.userId) && deviceRole === "main";
  const syncEnabled = !!partyId && video?.seekMode === "native";

  const syncParticipants = useCallback((nextRoom: Room | null, hostIdentity: string | null) => {
    if (!nextRoom) {
      setParticipants([]);
      return;
    }

    const local = nextRoom.localParticipant
      ? [
          {
            identity: nextRoom.localParticipant.identity,
            name: nextRoom.localParticipant.name || "You",
            isHost: nextRoom.localParticipant.identity === hostIdentity,
            isLocal: true,
          },
        ]
      : [];
    const remote = Array.from(nextRoom.remoteParticipants.values()).map((participant) => ({
      identity: participant.identity,
      name: participant.name || "Guest",
      isHost: participant.identity === hostIdentity,
      isLocal: false,
    }));
    setParticipants([...local, ...remote]);
  }, []);

  useEffect(() => {
    if (!partyId || !party) return;
    if (party.fileId === fileId) return;
    navigate(`/watch/${party.fileId}?party=${partyId}`, { replace: true });
  }, [fileId, navigate, party, partyId]);

  useEffect(() => {
    if (!party || isHost) return;
    setIncomingSyncState(toSyncState(party));
  }, [isHost, party]);

  useEffect(() => {
    const tokenData = joinedTokenData;
    if (!tokenData?.serverUrl || !tokenData.participantToken || !partyId) return;

    let cancelled = false;
    intentionalDisconnectRef.current = false;
    const nextRoom = new Room();
    roomRef.current = nextRoom;
    setRoom(nextRoom);
    setParticipants([]);
    setAudioReady(false);
    setMicEnabled(false);
    setPartyNotice(null);

    const handleParticipantsChanged = () => {
      syncParticipants(nextRoom, tokenData.party.hostParticipantIdentity);
    };

    const handleDataReceived = (payload: Uint8Array, participant?: Participant) => {
      if (!participant || participant.identity !== tokenData.party.hostParticipantIdentity) return;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(payload));
        if (isSyncState(parsed)) setIncomingSyncState(parsed);
      } catch {
        // Ignore non-sync payloads.
      }
    };

    let hasConnected = false;
    nextRoom.on(RoomEvent.ConnectionStateChanged, (state) => {
      setConnectionState(state);
      if (state === ConnectionState.Connected) {
        hasConnected = true;
        handleParticipantsChanged();
        return;
      }
      // A drop after we were actually connected — the host ended the party (its LiveKit room
      // gets closed server-side), we got removed, or the connection failed unrecoverably.
      // Whatever the cause, the party UI shouldn't keep sitting there looking live.
      if (state === ConnectionState.Disconnected && hasConnected && !intentionalDisconnectRef.current) {
        setPartyNotice("You were disconnected from the watch party.");
        setSearchParams({});
      }
    });
    nextRoom.on(RoomEvent.ParticipantConnected, handleParticipantsChanged);
    nextRoom.on(RoomEvent.ParticipantDisconnected, handleParticipantsChanged);
    nextRoom.on(RoomEvent.LocalTrackPublished, handleParticipantsChanged);
    nextRoom.on(RoomEvent.LocalTrackUnpublished, handleParticipantsChanged);
    nextRoom.on(RoomEvent.DataReceived, handleDataReceived);

    // Lets the backend's read-time staleness filter (~45s) know this device is still around —
    // without it, a session with no clean "leave" (killed tab, dropped network) would never
    // disappear from the participant roster / multi-device "is this user already connected"
    // check. See apps/backend/src/lib/watchPartySessions.ts.
    const heartbeatInterval = setInterval(() => sendWatchPartyHeartbeat(partyId), 20_000);

    void nextRoom
      .connect(tokenData.serverUrl, tokenData.participantToken)
      .then(() => {
        if (cancelled) return;
        setConnectionState(nextRoom.state);
        handleParticipantsChanged();
        if (!tokenData.isHost) setIncomingSyncState(toSyncState(tokenData.party));
      })
      .catch((connectError) => {
        console.error("Failed to connect watch party room", connectError);
        if (!cancelled) {
          setPartyNotice("Couldn't connect to the watch party room.");
          setSearchParams({});
        }
      });

    return () => {
      cancelled = true;
      clearInterval(heartbeatInterval);
      leaveWatchParty(partyId);
      nextRoom.removeAllListeners();
      nextRoom.disconnect();
      if (roomRef.current === nextRoom) roomRef.current = null;
      setRoom((current) => (current === nextRoom ? null : current));
      setParticipants([]);
      setConnectionState(ConnectionState.Disconnected);
      setAudioReady(false);
      setMicEnabled(false);
    };
  }, [joinedTokenData, partyId, syncParticipants, setSearchParams]);

  const inviteLink = useMemo(() => {
    if (!party || typeof window === "undefined") return null;
    return `${window.location.origin}/watch/${party.fileId}?party=${party.id}`;
  }, [party]);

  const handleCreateParty = async () => {
    if (!video) return;
    setPartyNotice(null);
    const created = await createWatchParty.mutateAsync({ fileId: video.fileId, title: video.title });
    setSearchParams({ party: created.id });
  };

  const handleJoinParty = () => {
    const code = extractPartyCode(joinCode);
    if (!code) return;
    setPartyNotice(null);
    setSearchParams({ party: code });
  };

  const handleCopyInvite = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink).catch(() => {});
  };

  const handleLeaveParty = () => {
    intentionalDisconnectRef.current = true;
    setPartyNotice(null);
    setSearchParams({});
  };

  const handleEndParty = async () => {
    intentionalDisconnectRef.current = true;
    await endWatchParty.mutateAsync().catch(() => {});
    setSearchParams({});
  };

  const handleToggleMic = async () => {
    const currentRoom = roomRef.current;
    if (!currentRoom) return;
    const nextValue = !micEnabled;
    await currentRoom.localParticipant.setMicrophoneEnabled(nextValue);
    setMicEnabled(nextValue);
    syncParticipants(currentRoom, party?.hostParticipantIdentity ?? null);
  };

  const handleEnablePartyAudio = async () => {
    const currentRoom = roomRef.current;
    if (!currentRoom) return;
    await currentRoom.startAudio().catch(() => {});
    setAudioReady(true);
  };

  const handlePartySyncState = useCallback(
    async (state: WatchPartySyncState) => {
      if (!partyId || !isHost) return;
      setIncomingSyncState(state);
      await updateWatchPartyState
        .mutateAsync({
          playing: state.playing,
          positionSeconds: state.positionSeconds,
          playbackRate: state.playbackRate,
        })
        .catch(() => {});

      const currentRoom = roomRef.current;
      if (!currentRoom) return;
      const payload = new TextEncoder().encode(JSON.stringify(state));
      await currentRoom.localParticipant.publishData(payload, { reliable: true, topic: "watch-party-sync" });
    },
    [isHost, partyId, updateWatchPartyState],
  );

  // A bad/expired party code 404s both queries — without this, the UI just sits on "Joining
  // party room..." forever with the invalid code still shown in the badge, no explanation.
  const partyLoadFailed = !!partyId && (watchParty.isError || joinWatchPartyToken.isError);

  const watchPartySyncProp = useMemo(
    () =>
      partyId
        ? {
            enabled: syncEnabled,
            isHost: !!isHost,
            inboundState: incomingSyncState,
            onStateChange: handlePartySyncState,
          }
        : undefined,
    [partyId, syncEnabled, isHost, incomingSyncState, handlePartySyncState],
  );

  if (isLoading) {
    return (
      <div className="w-full flex-1 px-4 py-6 sm:px-6">
        <div className="aspect-video w-full animate-pulse rounded-lg bg-surface" />
      </div>
    );
  }

  if (error || !video) return <NotFoundPage />;

  return (
    <div className="w-full flex-1 px-4 py-6 sm:px-6">
      <section className="mb-6 rounded-2xl border border-white/10 bg-surface/70 p-4 backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.25em] text-white/45">Watch Party</p>
            <h2 className="mt-1 text-xl font-semibold text-white">Watch together with voice chat and synced playback</h2>
            <p className="mt-2 text-sm text-white/60">
              Invite people into this room, talk over LiveKit, and keep native-mode playback aligned.
            </p>
            {partyNotice && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                <span>{partyNotice}</span>
                <button
                  type="button"
                  onClick={() => setPartyNotice(null)}
                  className="ml-auto text-xs font-semibold text-amber-200/70 hover:text-amber-100"
                >
                  Dismiss
                </button>
              </div>
            )}
            {partyLoadFailed && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-sm text-red-200">
                <span>This watch party link is invalid or has ended.</span>
                <button
                  type="button"
                  onClick={handleLeaveParty}
                  className="ml-auto text-xs font-semibold text-red-200/70 hover:text-red-100"
                >
                  Dismiss
                </button>
              </div>
            )}
            {needsConfirmation && tokenResult && "existingSession" in tokenResult && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/85">
                <span>
                  You're already watching this party on <strong>{tokenResult.existingSession.deviceLabel}</strong>. Join
                  from this device too?
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={handleLeaveParty}
                    className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={() => setJoinConfirmed(true)}
                    className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-white/90"
                  >
                    Join anyway
                  </button>
                </div>
              </div>
            )}
            {needsRoleChoice && tokenResult && "existingSession" in tokenResult && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white/85">
                <span>
                  Which device should be the main screen (plays the movie, controls playback)? Your other device
                  becomes a voice/video/chat companion.
                </span>
                <div className="ml-auto flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setJoinConfirmed(true);
                      setJoinChosenMainDeviceId(getDeviceId());
                    }}
                    className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-black hover:bg-white/90"
                  >
                    This device
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setJoinConfirmed(true);
                      // Any id other than this device's own — the backend only checks
                      // `chosenMainDeviceId === deviceId` (this device) vs. "anything else" (the
                      // other device), so a sentinel is enough; it never needs to actually match
                      // the other device's real id.
                      setJoinChosenMainDeviceId("other");
                    }}
                    className="rounded-md border border-white/20 px-3 py-1.5 text-xs font-semibold text-white/80 hover:bg-white/10"
                  >
                    {tokenResult.existingSession.deviceLabel}
                  </button>
                </div>
              </div>
            )}
          </div>

          {!partyId || partyLoadFailed ? (
            <div className="grid gap-3 sm:min-w-96">
              <button
                type="button"
                onClick={handleCreateParty}
                disabled={createWatchParty.isPending}
                className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/30"
              >
                {createWatchParty.isPending ? "Starting..." : "Start Watch Party"}
              </button>
              <div className="flex gap-2">
                <input
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  placeholder="Paste party code or invite link"
                  className="flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-white/30"
                />
                <button
                  type="button"
                  onClick={handleJoinParty}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Join
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:min-w-96">
              <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200">
                Party #{partyId}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleCopyInvite}
                  disabled={!inviteLink}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90 disabled:bg-white/40"
                >
                  Copy Invite Link
                </button>
                <button
                  type="button"
                  onClick={handleLeaveParty}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  Leave Party
                </button>
                {isHost && (
                  <button
                    type="button"
                    onClick={handleEndParty}
                    className="rounded-lg border border-red-400/30 px-4 py-2 text-sm font-semibold text-red-200 transition hover:bg-red-400/10"
                  >
                    End Party
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {partyId && !partyLoadFailed && (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-white/65">
                <span>Connection: {connectionState}</span>
                <span>•</span>
                <span>{participants.length} participant{participants.length === 1 ? "" : "s"}</span>
                {syncEnabled ? (
                  <>
                    <span>•</span>
                    <span className="text-emerald-300">Playback sync enabled</span>
                  </>
                ) : (
                  <>
                    <span>•</span>
                    <span className="text-amber-300">Playback sync requires converted/native video</span>
                  </>
                )}
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleToggleMic}
                  disabled={!room}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {micEnabled ? "Mute Mic" : "Unmute Mic"}
                </button>
                <button
                  type="button"
                  onClick={handleEnablePartyAudio}
                  disabled={!room}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {audioReady ? "Party Audio Ready" : "Enable Party Audio"}
                </button>
              </div>

              <div className="space-y-2">
                {participants.length === 0 ? (
                  <p className="text-sm text-white/45">Waiting for participants to join...</p>
                ) : (
                  participants.map((participant) => (
                    <div
                      key={participant.identity}
                      className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium text-white">
                          {participant.name}
                          {participant.isLocal ? " (You)" : ""}
                        </p>
                        <p className="text-xs text-white/45">{participant.identity}</p>
                      </div>
                      {participant.isHost && (
                        <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-200">
                          Host
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {room ? (
              <RoomContext.Provider value={room}>
                <RoomAudioRenderer />
                <WatchPartyChat />
              </RoomContext.Provider>
            ) : (
              <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm text-white/45">
                Joining party room...
              </div>
            )}
          </div>
        )}
      </section>

      {video.seekMode === "raw" ? (
        <DesktopAppRequiredNotice title={video.title ?? "This video"} />
      ) : (
        <VideoPlayer
          fileId={video.fileId}
          title={video.title!}
          backHref={video.backHref}
          parentFolderId={video.parentFolderId}
          nextFileId={video.nextFileId}
          previousFileId={video.previousFileId}
          episodes={video.episodes}
          progressByFileId={video.progressByFileId}
          initialPositionSeconds={video.initialPositionSeconds}
          initialCompleted={video.initialCompleted}
          seekMode={video.seekMode}
          durationSeconds={video.durationSeconds}
          subtitles={video.subtitles}
          introStart={video.introStart}
          introEnd={video.introEnd}
          outroStart={video.outroStart}
          initialSubtitleSource={video.initialSubtitleSource}
          initialSubtitleIndex={video.initialSubtitleIndex}
          initialAudioLanguage={video.initialAudioLanguage}
          initialAudioTitle={video.initialAudioTitle}
          watchPartySync={watchPartySyncProp}
        />
      )}
    </div>
  );
}
