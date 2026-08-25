import { Router } from "express";
import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";
import {
  createWatchParty,
  endWatchParty,
  getWatchPartyByCode,
  serializeWatchParty,
  updateWatchPartyState,
} from "../lib/watchParties";
import { getUserById } from "../lib/users";

const router = Router();

function assertLiveKitConfigured() {
  if (!env.livekitUrl || !env.livekitApiKey || !env.livekitApiSecret) {
    throw new Error("LiveKit is not configured");
  }
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
  if (party.hostUserId !== req.authUser!.userId) {
    res.status(403).json({ error: "Only the host can control this watch party" });
    return;
  }

  const { playing, positionSeconds, playbackRate } = req.body as {
    playing?: boolean;
    positionSeconds?: number;
    playbackRate?: number;
  };
  if (typeof playing !== "boolean" || typeof positionSeconds !== "number") {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }
  if (typeof playbackRate !== "undefined" && typeof playbackRate !== "number") {
    res.status(400).json({ error: "Invalid payload" });
    return;
  }

  const updated = await updateWatchPartyState(req.params.partyId, { playing, positionSeconds, playbackRate });
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
    const roomService = new RoomServiceClient(env.livekitUrl, env.livekitApiKey, env.livekitApiSecret);
    await roomService.deleteRoom(party.roomName).catch(() => {});
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

  const isHost = party.hostUserId === req.authUser!.userId;
  const user = await getUserById(req.authUser!.userId);
  const participantIdentity = isHost ? party.hostParticipantIdentity : `guest-${randomUUID()}`;
  const participantName = user?.name?.trim() || (isHost ? "Host" : "Guest");

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
    party: serializeWatchParty(party),
  });
});

export default router;
