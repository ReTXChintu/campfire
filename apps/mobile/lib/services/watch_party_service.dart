import '../models/watch_party.dart';
import 'api_client.dart';
import 'device_id_service.dart';

/// Mirrors apps/frontend/src/hooks/useWatchParty.ts — one method per
/// apps/backend/src/routes/watchParties.ts route, same static-method shape as catalog_service.dart.
class WatchPartyService {
  WatchPartyService._();

  static Future<WatchParty> create({required String fileId, String? title}) async {
    final data = await ApiClient.post('/api/watch-parties', {'fileId': fileId, 'title': title})
        as Map<String, dynamic>;
    return WatchParty.fromJson(data['party'] as Map<String, dynamic>);
  }

  static Future<WatchParty> getByCode(String partyId) async {
    final data = await ApiClient.get('/api/watch-parties/$partyId') as Map<String, dynamic>;
    return WatchParty.fromJson(data['party'] as Map<String, dynamic>);
  }

  /// `confirmed`/`chosenMainDeviceId` are set once the caller has resolved a
  /// WatchPartyJoinRequiresConfirmation/RequiresRoleChoice result from a previous call — see
  /// watch_party_join_screen.dart's identical three-way handling to WatchPage.tsx's.
  static Future<WatchPartyJoinResult> joinToken(
    String partyId, {
    bool confirmed = false,
    String? chosenMainDeviceId,
  }) async {
    final deviceId = await DeviceIdService.getDeviceId();
    final data = await ApiClient.post('/api/watch-parties/$partyId/join-token', {
      'deviceId': deviceId,
      'deviceLabel': DeviceIdService.getDeviceLabel(),
      'clientKind': DeviceIdService.getClientKind(),
      'confirmed': confirmed,
      if (chosenMainDeviceId != null) 'chosenMainDeviceId': chosenMainDeviceId,
    }) as Map<String, dynamic>;
    return WatchPartyJoinResult.fromJson(data);
  }

  static Future<WatchParty> updateState(
    String partyId, {
    required bool playing,
    required double positionSeconds,
    required double playbackRate,
  }) async {
    final deviceId = await DeviceIdService.getDeviceId();
    final data = await ApiClient.patch(
      '/api/watch-parties/$partyId/state',
      {'playing': playing, 'positionSeconds': positionSeconds, 'playbackRate': playbackRate},
      {'X-Watch-Party-Device-Id': deviceId},
    ) as Map<String, dynamic>;
    return WatchParty.fromJson(data['party'] as Map<String, dynamic>);
  }

  static Future<void> end(String partyId) async {
    await ApiClient.delete('/api/watch-parties/$partyId');
  }

  static Future<List<WatchPartyParticipant>> getParticipants(String partyId) async {
    final data = await ApiClient.get('/api/watch-parties/$partyId/participants') as Map<String, dynamic>;
    return (data['participants'] as List)
        .map((e) => WatchPartyParticipant.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<List<WatchPartyParticipant>> grantControl(
    String partyId, {
    required String userId,
    required String deviceId,
    required bool grant,
  }) async {
    final data = await ApiClient.post(
      '/api/watch-parties/$partyId/participants/$userId/control',
      {'deviceId': deviceId, 'grant': grant},
    ) as Map<String, dynamic>;
    return (data['participants'] as List)
        .map((e) => WatchPartyParticipant.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  static Future<void> heartbeat(String partyId) async {
    final deviceId = await DeviceIdService.getDeviceId();
    await ApiClient.post('/api/watch-parties/$partyId/heartbeat', {'deviceId': deviceId});
  }

  static Future<void> leave(String partyId) async {
    final deviceId = await DeviceIdService.getDeviceId();
    await ApiClient.post('/api/watch-parties/$partyId/leave', {'deviceId': deviceId});
  }

  /// Mirrors WatchPage.tsx's extractPartyCode — accepts either a bare party code or a full invite
  /// link (`.../watch/<fileId>?party=<code>`) pasted into the "join" field.
  static String extractPartyCode(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return '';
    final uri = Uri.tryParse(trimmed);
    if (uri != null && uri.hasScheme && uri.queryParameters.containsKey('party')) {
      return uri.queryParameters['party'] ?? trimmed;
    }
    return trimmed;
  }
}
