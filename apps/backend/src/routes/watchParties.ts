import { Router } from "express";
import { AccessToken, DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";
import {
  type PartyTrackChoice,
  createWatchParty,
  endWatchParty,
  getWatchPartyByCode,
  serializeWatchParty,
  updateHostParticipantIdentity,
  updateWatchPartyState,
} from "../lib/watchParties";
import { getUserById } from "../lib/users";
import {
  closeSession,
  getActiveSessionSnapshots,
  getOtherActiveSessionsForUser,
  getSessionForRequest,
  setControlPermission,
  setDeviceRole,
  touchSession,
  upsertSession,
  type WatchPartyClientKind,
  type WatchPartyDeviceRole,
} from "../lib/watchPartySessions";

const router = Router();

function assertLiveKitConfigured() {
  if (!env.livekitUrl || !env.livekitApiKey || !env.livekitApiSecret) {
    throw new Error("LiveKit is not configured");
  }
}

function roomServiceClient(): RoomServiceClient {
  return new RoomServiceClient(env.livekitUrl!, env.livekitApiKey!, env.livekitApiSecret!);
}

/** Server-initiated broadcast over the room's LiveKit data channel — the same mechanism the host
 * client already uses for sync-state (`publishData`), just sent from the backend instead. Used
 * for control-grant changes and device-role demotions so every affected client updates
 * immediately instead of having to poll. Best-effort: never fails the calling request over this. */
async function broadcastToRoom(
  roomName: string,
  topic: string,
  payload: unknown,
  destinationIdentities?: string[],
): Promise<void> {
  try {
    assertLiveKitConfigured();
  } catch {
    return;
  }
  const data = new TextEncoder().encode(JSON.stringify(payload));
  await roomServiceClient()
    .sendData(roomName, data, DataPacket_Kind.RELIABLE, { topic, destinationIdentities })
    .catch(() => {});
}

const DESKTOP_CLIENT_KINDS = new Set<WatchPartyClientKind>(["web", "windows"]);
function isDesktopClient(kind: WatchPartyClientKind): boolean {
  return DESKTOP_CLIENT_KINDS.has(kind);
}

/** The server clock, for clients to estimate their offset from it (NTP-style: they time the round
 * trip and assume the reply was stamped halfway through). Every sync timestamp in a party is
 * expressed on this clock, so two phones whose own clocks disagree by seconds still agree on
 * "where the video should be now". Registered before `/:partyId` so "time" isn't read as a code. */
router.get("/time", requireAuth, (_req, res) => {
  res.setHeader("cache-control", "no-store");
  res.json({ serverTimeMs: Date.now() });
});

const TRACK_SOURCES = new Set(["off", "external", "embedded"]);
function optionalString(value: unknown, max = 200): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, max);
  throw new Error("invalid");
}

/** undefined = "not sent, leave alone"; null = "no choice"; otherwise a cleaned-up choice. Throws on
 * anything malformed so the route can answer 400 instead of storing junk every guest then parses. */
function parseTrackChoice(value: unknown): PartyTrackChoice | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
  const v = value as Record<string, unknown>;
  const source = optionalString(v.source, 16);
  if (source != null && !TRACK_SOURCES.has(source)) throw new Error("invalid");
  if (v.index !== undefined && v.index !== null && !(typeof v.index === "number" && Number.isInteger(v.index))) {
    throw new Error("invalid");
  }
  return {
    source: (source ?? null) as PartyTrackChoice["source"],
    id: optionalString(v.id, 32) ?? null,
    index: (v.index as number | null | undefined) ?? null,
    language: optionalString(v.language) ?? null,
    title: optionalString(v.title) ?? null,
  };
}

router.post("/", requireAuth, async (req, res) => {
  const { fileId, title } = req.body as { fileId?: string; title?: string | null };
  if (!fileId) {
    res.status(400).json({ error: "fileId is required" });
    return;
  }

  const party = await createWatchParty({
    fileId,
    title: typeof title === "string" && title.trim() ? title.trim() : null,
    hostUserId: req.authUser!.userId,
  });
  res.status(201).json({ party: serializeWatchParty(party) });
});

router.get("/:partyId", requireAuth, async (req, res) => {
  const party = await getWatchPartyByCode(req.params.partyId);
  if (!party || party.endedAt) {
    res.status(404).json({ error: "Watch party not found" });
    return;
  }
  res.json({ party: serializeWatchParty(party) });
});

router.patch("/:partyId/state", requireAuth, async (req, res) => {
  const party = await getWatchPartyByCode(req.params.partyId);
  if (!party || party.endedAt) {
    res.status(404).json({ error: "Watch party not found" });
    return;
  }

  const deviceId = req.headers["x-watch-party-device-id"];
  if (typeof deviceId !== "string" || !deviceId) {
    res.status(400).json({ error: "Missing X-Watch-Party-Device-Id header" });
    return;
  }
  const session = await getSessionForRequest(party.code, req.authUser!.userId, deviceId);
  // A companion device never holds control, even for the host — playback must come from their
  // main device. A guest holds control only once explicitly granted (see the /control route).
  const authorized =
    session?.deviceRole === "main" &&
    (party.hostUserId === req.authUser!.userId || session.canControlPlayback);
  if (!authorized) {
    res.status(403).json({ error: "You don't have playback control for this watch party" });
    return;
  }

  const { playing, positionSeconds, playbackRate, fileId } = req.body as {
    playing?: boolean;
    positionSeconds?: number;
    playbackRate?: number;
    fileId?: unknown;
  };
  if (typeof playing !== "boolean" || typeof positionSeconds !== "number" || !Number.isFinite(positionSeconds)) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }
  if (typeof playbackRate !== "undefined" && (typeof playbackRate !== "number" || !(playbackRate > 0 && playbackRate <= 4))) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }
  if (typeof fileId !== "undefined" && (typeof fileId !== "string" || !fileId || fileId.length > 200)) {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }
  let audioTrack: PartyTrackChoice | null | undefined;
  let subtitleTrack: PartyTrackChoice | null | undefined;
  try {
    audioTrack = parseTrackChoice((req.body as Record<string, unknown>).audioTrack);
    subtitleTrack = parseTrackChoice((req.body as Record<string, unknown>).subtitleTrack);
  } catch {
    res.status(400).json({ error: "Invalid track choice" });
    return;
  }

  const updated = await updateWatchPartyState(req.params.partyId, {
    playing,
    positionSeconds,
    playbackRate,
    fileId,
    audioTrack,
    subtitleTrack,
  });
  if (!updated || updated.endedAt) {
    res.status(404).json({ error: "Watch party not found" });
    return;
  }
  res.json({ party: serializeWatchParty(updated) });
});

router.delete("/:partyId", requireAuth, async (req, res) => {
  const party = await getWatchPartyByCode(req.params.partyId);
  if (!party || party.endedAt) {
    res.status(404).json({ error: "Watch party not found" });
    return;
  }
  if (party.hostUserId !== req.authUser!.userId) {
    res.status(403).json({ error: "Only the host can end this watch party" });
    return;
  }

  const ended = await endWatchParty(req.params.partyId);

  // Best-effort: force-disconnects every connected guest immediately rather than leaving them
  // sitting in a room the app no longer considers active. Not fatal if LiveKit isn't configured
  // or the room's already gone (e.g. everyone already left).
  if (env.livekitUrl && env.livekitApiKey && env.livekitApiSecret) {
    await roomServiceClient()
      .deleteRoom(party.roomName)
      .catch(() => {});
  }

  res.json({ party: ended ? serializeWatchParty(ended) : null });
});

router.post("/:partyId/join-token", requireAuth, async (req, res) => {
  const party = await getWatchPartyByCode(req.params.partyId);
  if (!party || party.endedAt) {
    res.status(404).json({ error: "Watch party not found" });
    return;
  }

  try {
    assertLiveKitConfigured();
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "LiveKit is not configured" });
    return;
  }

  const { deviceId, deviceLabel, clientKind, confirmed, chosenMainDeviceId } = req.body as {
    deviceId?: string;
    deviceLabel?: string;
    clientKind?: WatchPartyClientKind;
    confirmed?: boolean;
    chosenMainDeviceId?: string;
  };
  if (!deviceId || !deviceLabel || !clientKind) {
    res.status(400).json({ error: "deviceId, deviceLabel, and clientKind are required" });
    return;
  }

  const userId = req.authUser!.userId;
  const isHost = party.hostUserId === userId;

  // Resolve this session's deviceRole. A reconnect from the exact same device keeps whatever role
  // it already had (no re-prompting); a genuinely new device for this user goes through the
  // confirm / (mobile+mobile) role-choice flow described in the plan before it's allowed to join.
  let deviceRole: WatchPartyDeviceRole;
  const existingOwnSession = await getSessionForRequest(party.code, userId, deviceId);
  if (existingOwnSession) {
    deviceRole = existingOwnSession.deviceRole;
  } else {
    const others = await getOtherActiveSessionsForUser(party.code, userId, deviceId);
    if (others.length === 0) {
      deviceRole = "main";
    } else {
      if (!confirmed) {
        const other = others[0];
        res.json({
          requiresConfirmation: true,
          existingSession: { deviceLabel: other.deviceLabel, clientKind: other.clientKind },
        });
        return;
      }
      const other = others[0];
      const newIsDesktop = isDesktopClient(clientKind);
      const otherIsDesktop = isDesktopClient(other.clientKind);

      if (newIsDesktop && !otherIsDesktop) {
        // Desktop/web joining while a mobile session is active: desktop/web always takes over as
        // main, mobile is demoted to companion — no further prompt, per the confirmed rule.
        deviceRole = "main";
        await setDeviceRole(party.code, userId, other.deviceId, "companion");
        await broadcastToRoom(party.roomName, "watch-party-device-role", { deviceId: other.deviceId, deviceRole: "companion" }, [
          other.participantIdentity,
        ]);
      } else if (!newIsDesktop && otherIsDesktop) {
        // Mobile joining while desktop/web is active: mobile is always the companion.
        deviceRole = "companion";
      } else if (!newIsDesktop && !otherIsDesktop) {
        // Both mobile — ambiguous, the user must explicitly choose which is main.
        if (!chosenMainDeviceId) {
          res.json({
            requiresRoleChoice: true,
            existingSession: { deviceLabel: other.deviceLabel, clientKind: other.clientKind },
          });
          return;
        }
        if (chosenMainDeviceId === deviceId) {
          deviceRole = "main";
          await setDeviceRole(party.code, userId, other.deviceId, "companion");
          await broadcastToRoom(party.roomName, "watch-party-device-role", { deviceId: other.deviceId, deviceRole: "companion" }, [
            other.participantIdentity,
          ]);
        } else {
          deviceRole = "companion";
          await setDeviceRole(party.code, userId, other.deviceId, "main");
          await broadcastToRoom(party.roomName, "watch-party-device-role", { deviceId: other.deviceId, deviceRole: "main" }, [
            other.participantIdentity,
          ]);
        }
      } else {
        // Two simultaneous desktop/web sessions — not resolved by this design (see the plan's
        // "known open items"); both stay main, last write to /state wins.
        deviceRole = "main";
      }
    }
  }

  const user = await getUserById(userId);
  const role = isHost ? "host" : "guest";
  const participantIdentity = `${role}-${userId}-${deviceId}`;
  const participantName = user?.name?.trim() || (isHost ? "Host" : "Guest");

  const session = await upsertSession({
    partyCode: party.code,
    userId,
    deviceId,
    deviceLabel,
    displayName: user?.name?.trim() || null,
    clientKind,
    participantIdentity,
    role,
    deviceRole,
  });

  // Keep the party doc's `hostParticipantIdentity` accurate for web's existing
  // `handleDataReceived` identity check (see updateHostParticipantIdentity's own comment) — only
  // the host's *main* device counts, never a host's own companion device.
  if (isHost && deviceRole === "main") {
    await updateHostParticipantIdentity(party.code, participantIdentity);
    // Keep the in-memory `party` (already fetched above, serialized into this response below)
    // consistent with what was just written — otherwise this exact response would echo the
    // pre-update value.
    party.hostParticipantIdentity = participantIdentity;
  }

  const token = new AccessToken(env.livekitApiKey!, env.livekitApiSecret!, {
    identity: participantIdentity,
    name: participantName,
  });
  token.addGrant({
    roomJoin: true,
    room: party.roomName,
    canSubscribe: true,
    canPublish: true,
    canPublishData: true,
  });

  res.json({
    serverUrl: env.livekitUrl,
    participantToken: await token.toJwt(),
    participantIdentity,
    participantName,
    isHost,
    deviceRole: session.deviceRole,
    canControlPlayback: session.canControlPlayback,
    party: serializeWatchParty(party),
  });
});

router.get("/:partyId/participants", requireAuth, async (req, res) => {
  const party = await getWatchPartyByCode(req.params.partyId);
  if (!party || party.endedAt) {
    res.status(404).json({ error: "Watch party not found" });
    return;
  }
  res.json({ participants: await getActiveSessionSnapshots(party.code) });
});

router.post("/:partyId/participants/:userId/control", requireAuth, async (req, res) => {
  const party = await getWatchPartyByCode(req.params.partyId);
  if (!party || party.endedAt) {
    res.status(404).json({ error: "Watch party not found" });
    return;
  }
  if (party.hostUserId !== req.authUser!.userId) {
    res.status(403).json({ error: "Only the host can grant playback control" });
    return;
  }

  const { deviceId, grant } = req.body as { deviceId?: string; grant?: boolean };
  if (!deviceId || typeof grant !== "boolean") {
    res.status(400).json({ error: "deviceId and grant are required" });
    return;
  }

  let updated;
  try {
    updated = await setControlPermission(party.code, req.params.userId, deviceId, grant);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update control" });
    return;
  }
  if (!updated) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const participants = await getActiveSessionSnapshots(party.code);
  await broadcastToRoom(party.roomName, "watch-party-control", { participants });
  res.json({ participants });
});

router.post("/:partyId/heartbeat", requireAuth, async (req, res) => {
  const party = await getWatchPartyByCode(req.params.partyId);
  if (!party || party.endedAt) {
    res.status(404).json({ error: "Watch party not found" });
    return;
  }
  const { deviceId } = req.body as { deviceId?: string };
  if (!deviceId) {
    res.status(400).json({ error: "deviceId is required" });
    return;
  }
  await touchSession(party.code, req.authUser!.userId, deviceId);
  res.json({ ok: true, serverTimeMs: Date.now() });
});

router.post("/:partyId/leave", requireAuth, async (req, res) => {
  const party = await getWatchPartyByCode(req.params.partyId);
  if (!party) {
    res.status(404).json({ error: "Watch party not found" });
    return;
  }
  const { deviceId } = req.body as { deviceId?: string };
  if (!deviceId) {
    res.status(400).json({ error: "deviceId is required" });
    return;
  }
  await closeSession(party.code, req.authUser!.userId, deviceId);
  res.json({ ok: true });
});

export default router;
