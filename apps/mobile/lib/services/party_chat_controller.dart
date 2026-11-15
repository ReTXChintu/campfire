import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:livekit_client/livekit_client.dart';

/// LiveKit's own reserved topic for its first-party chat (what the web's `useChat()` sends on), so
/// phone, Windows and web chat in the same room.
const partyChatTopic = 'lk.chat';

/// Recent messages, sent privately to someone who just joined so they don't walk into a silent
/// room. LiveKit keeps no history of its own.
const partyChatHistoryTopic = 'watch-party-chat-history';

class PartyChatMessage {
  final String id;
  final String senderIdentity;
  final String senderName;
  final String text;
  final DateTime sentAt;
  final bool mine;

  const PartyChatMessage({
    required this.id,
    required this.senderIdentity,
    required this.senderName,
    required this.text,
    required this.sentAt,
    required this.mine,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'senderIdentity': senderIdentity,
        'senderName': senderName,
        'text': text,
        'sentAtMs': sentAt.millisecondsSinceEpoch,
      };

  static PartyChatMessage? fromJson(Object? json, {required String? myIdentity}) {
    if (json is! Map) return null;
    final id = json['id'], sender = json['senderIdentity'], text = json['text'], at = json['sentAtMs'];
    if (id is! String || sender is! String || text is! String || at is! num) return null;
    final name = json['senderName'];
    return PartyChatMessage(
      id: id,
      senderIdentity: sender,
      senderName: name is String && name.isNotEmpty ? name : 'Guest',
      text: text,
      sentAt: DateTime.fromMillisecondsSinceEpoch(at.round()),
      mine: sender == myIdentity,
    );
  }
}

/// Party chat for one room, owned by WatchPartyOverlay for the whole time it is connected.
///
/// It used to live inside the chat *widget*, which is destroyed whenever the party panel closes —
/// so collapsing the panel threw the conversation away, and anything sent while it was closed
/// was never received at all (the stream handler went with the widget). Now the handler is
/// registered once per room, messages accumulate here, and [unread] counts what arrived while
/// the panel was closed for the badge on the player's party button.
class PartyChatController extends ChangeNotifier {
  final Room room;
  final List<PartyChatMessage> _messages = [];
  final Set<String> _seenIds = {};
  int _unread = 0;
  bool _panelOpen = false;
  bool _disposed = false;

  static const _historyLimit = 60;

  PartyChatController(this.room) {
    room.registerTextStreamHandler(partyChatTopic, _onTextStream);
  }

  List<PartyChatMessage> get messages => List.unmodifiable(_messages);
  int get unread => _unread;

  @override
  void dispose() {
    _disposed = true;
    try {
      room.unregisterTextStreamHandler(partyChatTopic);
    } catch (_) {}
    super.dispose();
  }

  /// The panel is showing the conversation — nothing is unread while it is.
  set panelOpen(bool open) {
    _panelOpen = open;
    if (open && _unread != 0) {
      _unread = 0;
      notifyListeners();
    }
  }

  String _nameFor(String identity) {
    final local = room.localParticipant;
    if (local != null && local.identity == identity) return local.name.isNotEmpty ? local.name : 'You';
    for (final p in room.remoteParticipants.values) {
      if (p.identity == identity) return p.name.isNotEmpty ? p.name : 'Guest';
    }
    return 'Guest';
  }

  void _add(PartyChatMessage message, {bool countUnread = true}) {
    if (_disposed || !_seenIds.add(message.id)) return;
    _messages.add(message);
    _messages.sort((a, b) => a.sentAt.compareTo(b.sentAt));
    if (_messages.length > 200) _messages.removeRange(0, _messages.length - 200);
    if (countUnread && !_panelOpen && !message.mine) _unread++;
    notifyListeners();
  }

  Future<void> _onTextStream(TextStreamReader reader, String participantIdentity) async {
    final text = await reader.readAll();
    if (_disposed || text.trim().isEmpty) return;
    final info = reader.info;
    _add(PartyChatMessage(
      id: info?.id ?? '${participantIdentity}_${DateTime.now().microsecondsSinceEpoch}',
      senderIdentity: participantIdentity,
      senderName: _nameFor(participantIdentity),
      text: text,
      // Arrival time, not the sender's stamp: their clock may be off, and order is what matters.
      sentAt: DateTime.now(),
      mine: false,
    ));
  }

  /// Sends on the shared chat topic and shows it locally (LiveKit doesn't echo to the sender).
  Future<bool> send(String text) async {
    final trimmed = text.trim();
    final local = room.localParticipant;
    if (trimmed.isEmpty || local == null) return false;
    try {
      final info = await local.sendText(trimmed, options: SendTextOptions(topic: partyChatTopic));
      _add(PartyChatMessage(
        id: info.id,
        senderIdentity: local.identity,
        senderName: 'You',
        text: trimmed,
        sentAt: DateTime.now(),
        mine: true,
      ));
      return true;
    } catch (_) {
      return false;
    }
  }

  /// Sends the recent conversation to one newcomer. Only the leader does this, so a joiner gets
  /// one copy, not one per person in the room.
  Future<void> sendHistoryTo(String identity) async {
    final local = room.localParticipant;
    if (local == null || _messages.isEmpty) return;
    final recent = _messages.length > _historyLimit
        ? _messages.sublist(_messages.length - _historyLimit)
        : _messages;
    final payload = utf8.encode(jsonEncode({
      'type': 'chat-history',
      'messages': [
        for (final m in recent)
          {...m.toJson(), 'senderName': m.mine ? (local.name.isNotEmpty ? local.name : 'Host') : m.senderName},
      ],
    }));
    try {
      await local.publishData(payload, reliable: true, topic: partyChatHistoryTopic, destinationIdentities: [identity]);
    } catch (_) {
      // Best-effort — they still see everything said from now on.
    }
  }

  /// A history packet someone sent us on joining.
  void receiveHistory(List<int> data) {
    try {
      final decoded = jsonDecode(utf8.decode(data));
      if (decoded is! Map || decoded['type'] != 'chat-history' || decoded['messages'] is! List) return;
      final myIdentity = room.localParticipant?.identity;
      for (final raw in decoded['messages'] as List) {
        final m = PartyChatMessage.fromJson(raw, myIdentity: myIdentity);
        if (m != null) _add(m, countUnread: false);
      }
    } catch (_) {
      // Ignore malformed history.
    }
  }
}
