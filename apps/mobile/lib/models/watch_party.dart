// Mirrors apps/frontend/src/lib/types.ts's WatchParty*/WatchPartySyncState shapes and
// apps/backend/src/routes/watchParties.ts's responses — same fields, Dart-side fromJson.

class WatchParty {
  final String id;
  final String roomName;
  final String fileId;
  final String? title;
  final String hostUserId;
  final String hostParticipantIdentity;
  final bool playing;
  final double positionSeconds;
  final double effectivePositionSeconds;
  final double playbackRate;
  final String createdAt;
  final String updatedAt;
  final String? endedAt;

  const WatchParty({
    required this.id,
    required this.roomName,
    required this.fileId,
    required this.title,
    required this.hostUserId,
    required this.hostParticipantIdentity,
    required this.playing,
    required this.positionSeconds,
    required this.effectivePositionSeconds,
    required this.playbackRate,
    required this.createdAt,
    required this.updatedAt,
    required this.endedAt,
  });

  factory WatchParty.fromJson(Map<String, dynamic> json) => WatchParty(
        id: json['id'] as String,
        roomName: json['roomName'] as String,
        fileId: json['fileId'] as String,
        title: json['title'] as String?,
        hostUserId: json['hostUserId'] as String,
        hostParticipantIdentity: json['hostParticipantIdentity'] as String,
        playing: json['playing'] as bool,
        positionSeconds: (json['positionSeconds'] as num).toDouble(),
        effectivePositionSeconds: (json['effectivePositionSeconds'] as num).toDouble(),
        playbackRate: (json['playbackRate'] as num).toDouble(),
        createdAt: json['createdAt'] as String,
        updatedAt: json['updatedAt'] as String,
        endedAt: json['endedAt'] as String?,
      );
}

/// One (partyCode, userId, deviceId) session snapshot from the backend's authoritative roster
/// (GET /:partyId/participants) — separate from LiveKit's own room presence, which only knows
/// display name/local-ness, not userId/deviceId/role/grant state. `identity` reconstructs the
/// LiveKit participant identity the same way the backend mints it, for matching against a
/// livekit_client Participant.identity.
class WatchPartyParticipant {
  final String userId;
  final String deviceId;
  final String deviceLabel;
  final String clientKind; // "web" | "windows" | "android" | "ios"
  final String role; // "host" | "guest"
  final String deviceRole; // "main" | "companion"
  final bool canControlPlayback;

  const WatchPartyParticipant({
    required this.userId,
    required this.deviceId,
    required this.deviceLabel,
    required this.clientKind,
    required this.role,
    required this.deviceRole,
    required this.canControlPlayback,
  });

  factory WatchPartyParticipant.fromJson(Map<String, dynamic> json) => WatchPartyParticipant(
        userId: json['userId'] as String,
        deviceId: json['deviceId'] as String,
        deviceLabel: json['deviceLabel'] as String,
        clientKind: json['clientKind'] as String,
        role: json['role'] as String,
        deviceRole: json['deviceRole'] as String,
        canControlPlayback: json['canControlPlayback'] as bool,
      );

  String get identity => '$role-$userId-$deviceId';
}

class WatchPartyExistingSession {
  final String deviceLabel;
  final String clientKind;

  const WatchPartyExistingSession({required this.deviceLabel, required this.clientKind});

  factory WatchPartyExistingSession.fromJson(Map<String, dynamic> json) => WatchPartyExistingSession(
        deviceLabel: json['deviceLabel'] as String,
        clientKind: json['clientKind'] as String,
      );
}

/// join-token doesn't always succeed outright — if this user already has another active device in
/// this party, it instead asks the caller to confirm (or, for a mobile+mobile pairing, to pick
/// which device is main) before actually joining. See apps/backend/src/routes/watchParties.ts and
/// apps/frontend/src/routes/WatchPage.tsx's identical three-way handling.
sealed class WatchPartyJoinResult {
  const WatchPartyJoinResult();

  factory WatchPartyJoinResult.fromJson(Map<String, dynamic> json) {
    if (json['requiresConfirmation'] == true) {
      return WatchPartyJoinRequiresConfirmation(
        existingSession: WatchPartyExistingSession.fromJson(json['existingSession'] as Map<String, dynamic>),
      );
    }
    if (json['requiresRoleChoice'] == true) {
      return WatchPartyJoinRequiresRoleChoice(
        existingSession: WatchPartyExistingSession.fromJson(json['existingSession'] as Map<String, dynamic>),
      );
    }
    return WatchPartyJoinSuccess.fromJson(json);
  }
}

class WatchPartyJoinRequiresConfirmation extends WatchPartyJoinResult {
  final WatchPartyExistingSession existingSession;
  const WatchPartyJoinRequiresConfirmation({required this.existingSession});
}

class WatchPartyJoinRequiresRoleChoice extends WatchPartyJoinResult {
  final WatchPartyExistingSession existingSession;
  const WatchPartyJoinRequiresRoleChoice({required this.existingSession});
}

class WatchPartyJoinSuccess extends WatchPartyJoinResult {
  final String serverUrl;
  final String participantToken;
  final String participantIdentity;
  final String participantName;
  final bool isHost;
  final String deviceRole; // "main" | "companion"
  final bool canControlPlayback;
  final WatchParty party;

  const WatchPartyJoinSuccess({
    required this.serverUrl,
    required this.participantToken,
    required this.participantIdentity,
    required this.participantName,
    required this.isHost,
    required this.deviceRole,
    required this.canControlPlayback,
    required this.party,
  });

  factory WatchPartyJoinSuccess.fromJson(Map<String, dynamic> json) => WatchPartyJoinSuccess(
        serverUrl: json['serverUrl'] as String,
        participantToken: json['participantToken'] as String,
        participantIdentity: json['participantIdentity'] as String,
        participantName: json['participantName'] as String,
        isHost: json['isHost'] as bool,
        deviceRole: json['deviceRole'] as String,
        canControlPlayback: json['canControlPlayback'] as bool,
        party: WatchParty.fromJson(json['party'] as Map<String, dynamic>),
      );
}

/// The data-channel payload host/guest playback broadcasts over LiveKit's "watch-party-sync" topic
/// — mirrors WatchPage.tsx's toSyncState/isSyncState exactly, since mobile and web must
/// interoperate in the same room.
class WatchPartySyncState {
  final bool playing;
  final double positionSeconds;
  final double playbackRate;
  final String updatedAt;

  const WatchPartySyncState({
    required this.playing,
    required this.positionSeconds,
    required this.playbackRate,
    required this.updatedAt,
  });

  factory WatchPartySyncState.fromParty(WatchParty party) => WatchPartySyncState(
        playing: party.playing,
        positionSeconds: party.positionSeconds,
        playbackRate: party.playbackRate,
        updatedAt: party.updatedAt,
      );

  static WatchPartySyncState? tryParse(dynamic value) {
    if (value is! Map ||
        value['type'] != 'sync-state' ||
        value['playing'] is! bool ||
        value['positionSeconds'] is! num ||
        value['playbackRate'] is! num ||
        value['updatedAt'] is! String) {
      return null;
    }
    return WatchPartySyncState(
      playing: value['playing'] as bool,
      positionSeconds: (value['positionSeconds'] as num).toDouble(),
      playbackRate: (value['playbackRate'] as num).toDouble(),
      updatedAt: value['updatedAt'] as String,
    );
  }

  Map<String, dynamic> toJson() => {
        'type': 'sync-state',
        'playing': playing,
        'positionSeconds': positionSeconds,
        'playbackRate': playbackRate,
        'updatedAt': updatedAt,
      };
}
