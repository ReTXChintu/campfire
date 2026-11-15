import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:go_router/go_router.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';

import '../models/watch_party.dart';
import '../platform_info.dart';
import '../services/device_id_service.dart';
import '../services/party_chat_controller.dart';
import '../services/party_sync_engine.dart';
import '../services/watch_party_service.dart';
import '../services/watch_party_sync_controller.dart';
import '../theme/app_theme.dart';
import 'reaction_overlay.dart';
import 'reaction_picker.dart';
import 'tv_party_rail.dart';
import 'watch_party_chat.dart';
import 'watch_party_toast.dart';
import 'watch_party_video_grid.dart';

const _syncTopic = 'watch-party-sync';
const _statusTopic = 'watch-party-status';
const _controlTopic = 'watch-party-control';
const _reactionTopic = 'watch-party-reaction';

/// Watch Party: the LiveKit room, the roster, voice/video, chat, reactions — and the network half
/// of playback sync. The player half (actually steering playback) lives in MediaKitVideoPlayer;
/// the two talk only through [WatchPartySyncController].
///
/// Layout: the party never floats over the player's controls. Its entry point is a button in the
/// player's own top bar (see [WatchPartySyncController.configureChrome]); the panel docks beside
/// the video when the screen is wider than tall (landscape phone, Windows) and is a bottom sheet
/// in portrait. Android TV keeps its always-mounted D-pad rail.
///
/// Sync roles: the host's main screen is the **leader** — when the host isn't connected, the
/// first device holding control takes over — and every other device follows its heartbeats. See
/// services/party_sync_engine.dart for how following works.
class WatchPartyOverlay extends StatefulWidget {
  final String fileId;
  final String? videoTitle;
  final String? partyId;
  final ValueChanged<String?> onPartyIdChanged;
  final WatchPartySyncController syncController;
  final Widget child;

  const WatchPartyOverlay({
    super.key,
    required this.fileId,
    required this.videoTitle,
    required this.partyId,
    required this.onPartyIdChanged,
    required this.syncController,
    required this.child,
  });

  @override
  State<WatchPartyOverlay> createState() => _WatchPartyOverlayState();
}

class _PeerStatus {
  final SyncHealth health;
  final DateTime at;
  const _PeerStatus(this.health, this.at);
}

class _WatchPartyOverlayState extends State<WatchPartyOverlay> {
  Room? _room;
  EventsListener<RoomEvent>? _listener;
  PartyChatController? _chat;
  WatchPartyJoinSuccess? _joined;
  WatchPartyJoinResult? _pendingChoice;
  List<WatchPartyParticipant> _participants = [];
  final _clock = ServerClock();
  Timer? _heartbeatTimer;
  Timer? _statusTimer;
  bool _connecting = false;
  bool _micEnabled = false;
  bool _cameraEnabled = false;
  bool _panelOpen = false;
  bool _following = false; // navigating to the party's episode — don't trigger twice
  int _heartbeatsSincePatch = 0;
  final Map<String, _PeerStatus> _peerStatus = {};

  final List<FloatingReactionData> _reactions = [];
  int _nextReactionId = 0;
  final List<WatchPartyToastData> _toasts = [];
  bool _hasSeenInitialRoster = false;
  int _nextToastId = 0;

  WatchPartySyncController get _sync => widget.syncController;
  bool get _connected => _room != null && _joined != null;

  @override
  void initState() {
    super.initState();
    _sync.addListener(_onSyncChanged);
    _publishChrome();
    if (widget.partyId != null) _startJoinFlow();
  }

  @override
  void didUpdateWidget(covariant WatchPartyOverlay oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.partyId == oldWidget.partyId) return;
    if (widget.partyId == null) {
      unawaited(_teardownRoom());
      setState(() {
        _joined = null;
        _participants = [];
        _pendingChoice = null;
        _panelOpen = false;
      });
      _publishChrome();
    } else {
      _startJoinFlow();
    }
  }

  @override
  void dispose() {
    _sync.removeListener(_onSyncChanged);
    unawaited(_teardownRoom(notify: false));
    super.dispose();
  }

  // The player's "Keep me in sync" state feeds the roster; nothing else to do here.
  void _onSyncChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _teardownRoom({bool notify = true}) async {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    _statusTimer?.cancel();
    _statusTimer = null;
    _chat?.removeListener(_publishChrome);
    _chat?.dispose();
    _chat = null;
    await _listener?.cancelAll();
    _listener = null;
    final room = _room;
    _room = null;
    if (room != null) {
      await room.disconnect();
      await room.dispose();
    }
    _sync.configure(enabled: false, role: PartyPlaybackRole.none);
    if (notify) _publishChrome();
  }

  // ---------------------------------------------------------------------------------------------
  // Roles

  /// The leader's identity — the device whose playback is the party's truth. Every client
  /// computes this from the same roster, so they all agree on it.
  ///
  /// Only a device that can actually play the video can lead: the web build can't play MKV (the
  /// whole library, today), so a host watching on web would leave everyone following a player
  /// that never moves. In order: the host's main device; else the first device the host gave
  /// control to; else the first app device in the room.
  String? _leaderIdentity() {
    final joined = _joined;
    if (joined == null) return null;
    if (_participants.isEmpty) {
      // Roster not loaded yet (the first second after connecting): trust join-token.
      if (joined.isHost && joined.deviceRole == 'main') return joined.participantIdentity;
      return joined.party.hostParticipantIdentity;
    }
    bool canPlay(WatchPartyParticipant p) => p.deviceRole == 'main' && p.clientKind != 'web';
    for (final p in _participants) {
      if (p.role == 'host' && canPlay(p)) return p.identity;
    }
    int byIdentity(WatchPartyParticipant a, WatchPartyParticipant b) => a.identity.compareTo(b.identity);
    final controllers = _participants.where((p) => canPlay(p) && p.canControlPlayback).toList()..sort(byIdentity);
    if (controllers.isNotEmpty) return controllers.first.identity;
    final players = _participants.where(canPlay).toList()..sort(byIdentity);
    return players.isEmpty ? null : players.first.identity;
  }

  bool _identityCanControl(String identity) {
    final joined = _joined;
    if (joined == null) return false;
    if (_participants.isEmpty) return identity == joined.party.hostParticipantIdentity;
    return _participants.any((p) => p.identity == identity && p.deviceRole == 'main' && p.canControlPlayback);
  }

  PartyPlaybackRole _myRole() {
    final joined = _joined;
    if (joined == null) return PartyPlaybackRole.none;
    final me = joined.participantIdentity;
    if (_leaderIdentity() == me) return PartyPlaybackRole.leader;
    final canControl = _participants.isEmpty
        ? joined.canControlPlayback && joined.deviceRole == 'main'
        : _identityCanControl(me);
    return canControl ? PartyPlaybackRole.controller : PartyPlaybackRole.follower;
  }

  void _reconfigureSync() {
    final joined = _joined;
    if (joined == null) return;
    _sync.configure(
      enabled: true,
      role: _myRole(),
      partyId: joined.party.id,
      clock: _clock,
      broadcaster: _broadcastSyncState,
      onFollowFile: _followFile,
    );
  }

  /// Keeps the player's top-bar party button current: member count, unread chat, what it opens.
  void _publishChrome() {
    if (!mounted) return;
    final distinctPeople = _participants.map((p) => p.userId).toSet().length;
    _sync.configureChrome(
      memberCount: _connected ? max(1, distinctPeople) : 0,
      unreadChat: _chat?.unread ?? 0,
      openPanel: _connected ? _openPanel : null,
      openStartOrJoin: _connected ? null : _openStartOrJoinSheet,
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Outbound

  Future<void> _broadcastSyncState(PartyPlaybackState state) async {
    final joined = _joined;
    final room = _room;
    if (joined == null || room == null) return;
    final payload = utf8.encode(jsonEncode(state.toJson()));
    // Actions must arrive; a lost heartbeat is replaced by the next one in 3s.
    final reliable = state.kind != PartyStateKind.heartbeat;
    unawaited(room.localParticipant
        ?.publishData(payload, reliable: reliable, topic: _syncTopic)
        .catchError((_) {}));

    // The server's copy is what a late joiner starts from. Every action, plus every third
    // heartbeat, keeps it within ~10s even through a long uninterrupted stretch.
    final patch = state.kind != PartyStateKind.heartbeat || ++_heartbeatsSincePatch >= 3;
    if (patch) {
      _heartbeatsSincePatch = 0;
      await WatchPartyService.updateState(
        joined.party.id,
        playing: state.playing,
        positionSeconds: state.positionSeconds,
        playbackRate: state.playbackRate,
        fileId: state.fileId,
        audioTrack: state.audio,
        subtitleTrack: state.subtitle,
      ).then((_) {}, onError: (_) {});
    }
  }

  void _broadcastStatus() {
    final room = _room;
    if (room == null) return;
    final health = _sync.following ? _sync.health : SyncHealth.independent;
    final payload = utf8.encode(jsonEncode({'type': 'status', 'health': health.name}));
    unawaited(room.localParticipant?.publishData(payload, reliable: false, topic: _statusTopic).catchError((_) {}));
  }

  /// The party moved to another episode — reopen the player on it, still in the party.
  void _followFile(String fileId) {
    final joined = _joined;
    if (joined == null || _following || fileId == widget.fileId || !mounted) return;
    _following = true;
    _pushToast('Following the party to the next title…');
    context.pushReplacement('/watch/$fileId?party=${joined.party.id}');
  }

  // ---------------------------------------------------------------------------------------------
  // Join + connect

  Future<void> _startJoinFlow({bool confirmed = false, String? chosenMainDeviceId}) async {
    final partyId = widget.partyId;
    if (partyId == null) return;
    setState(() {
      _connecting = true;
    });
    try {
      final result = await WatchPartyService.joinToken(
        partyId,
        confirmed: confirmed,
        chosenMainDeviceId: chosenMainDeviceId,
      );
      if (!mounted) return;
      if (result is WatchPartyJoinSuccess) {
        // The party is on a different title than the one open — go there first (the new screen's
        // overlay picks the join back up; join-token returns the same session without prompting).
        if (result.party.fileId != widget.fileId) {
          context.pushReplacement('/watch/${result.party.fileId}?party=${result.party.id}');
          return;
        }
        await _connectRoom(result);
      } else {
        setState(() {
          _connecting = false;
          _pendingChoice = result;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _connecting = false;
        });
        _pushToast("Couldn't join the watch party.");
      }
    }
  }

  Future<void> _sampleClock({int samples = 1}) async {
    for (var i = 0; i < samples; i++) {
      try {
        await WatchPartyService.sampleServerClock(_clock);
      } catch (_) {
        // A missing sample only means a slightly worse estimate.
      }
    }
  }

  Future<void> _connectRoom(WatchPartyJoinSuccess joined) async {
    final room = Room();
    final listener = room.createListener();
    listener
      ..on<ParticipantConnectedEvent>(_onParticipantConnected)
      ..on<ParticipantDisconnectedEvent>((_) {
        if (mounted) setState(() {});
        _refreshParticipants();
      })
      ..on<TrackSubscribedEvent>((_) => mounted ? setState(() {}) : null)
      ..on<TrackUnsubscribedEvent>((_) => mounted ? setState(() {}) : null)
      ..on<LocalTrackPublishedEvent>((_) => mounted ? setState(() {}) : null)
      ..on<LocalTrackUnpublishedEvent>((_) => mounted ? setState(() {}) : null)
      ..on<DataReceivedEvent>(_onDataReceived);

    // The clock estimate has to exist before the first sync decision. Five quick samples take
    // well under a second and the best of them is usually within ~20ms.
    final clockReady = _sampleClock(samples: 5);

    try {
      await room.connect(joined.serverUrl, joined.participantToken);
    } catch (_) {
      await listener.cancelAll();
      await room.dispose();
      if (mounted) {
        setState(() {
          _connecting = false;
        });
        _pushToast("Couldn't connect to the watch party room.");
      }
      return;
    }
    await clockReady;
    if (!mounted) {
      await listener.cancelAll();
      await room.disconnect();
      await room.dispose();
      return;
    }

    final chat = PartyChatController(room)..addListener(_publishChrome);
    setState(() {
      _room = room;
      _listener = listener;
      _chat = chat;
      _joined = joined;
      _pendingChoice = null;
      _connecting = false;
    });
    _reconfigureSync();

    // Where should playback start? A leader joining a party nobody has played yet brings its own
    // position (it may have been watching for an hour before starting the party). Everyone else —
    // and a leader rejoining a party already in progress — starts where the party is.
    final snapshot = joined.party.toSnapshot(fallbackServerNowMs: _clock.nowServerMs());
    final leaderWithoutHistory = _myRole() == PartyPlaybackRole.leader && !joined.party.hasPlaybackHistory;
    _sync.applyInbound(snapshot, announceOnReady: leaderWithoutHistory);

    _heartbeatTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      WatchPartyService.heartbeat(joined.party.id).catchError((_) {});
      _refreshParticipants();
      _sampleClock();
    });
    _statusTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      _broadcastStatus();
      if (mounted) setState(() {}); // ages out stale peer statuses
    });
    _refreshParticipants();
    _publishChrome();
  }

  void _onParticipantConnected(ParticipantConnectedEvent event) {
    if (mounted) setState(() {});
    _refreshParticipants();
    // Only the leader sends the newcomer the conversation so far, so they get it exactly once.
    if (_myRole() == PartyPlaybackRole.leader) {
      unawaited(_chat?.sendHistoryTo(event.participant.identity));
    }
  }

  Future<void> _refreshParticipants() async {
    final joined = _joined;
    if (joined == null) return;
    try {
      final list = await WatchPartyService.getParticipants(joined.party.id);
      if (!mounted) return;
      _diffParticipantsForToasts(_participants, list);
      setState(() => _participants = list);
      _reconfigureSync();
      _publishChrome();
    } catch (_) {
      // Best-effort — the next refresh will try again.
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Inbound

  void _onDataReceived(DataReceivedEvent event) {
    final sender = event.participant?.identity;
    switch (event.topic) {
      case _controlTopic:
        try {
          final decoded = jsonDecode(utf8.decode(event.data)) as Map<String, dynamic>;
          final list = decoded['participants'] as List?;
          if (list == null) return;
          final next = list.map((e) => WatchPartyParticipant.fromJson(e as Map<String, dynamic>)).toList();
          _diffParticipantsForToasts(_participants, next);
          setState(() => _participants = next);
          _reconfigureSync();
          _publishChrome();
        } catch (_) {}
      case _reactionTopic:
        try {
          final decoded = jsonDecode(utf8.decode(event.data)) as Map<String, dynamic>;
          final emoji = decoded['emoji'] as String?;
          if (emoji != null) _pushLocalReaction(emoji);
        } catch (_) {}
      case partyChatHistoryTopic:
        _chat?.receiveHistory(event.data);
      case _statusTopic:
        if (sender == null) return;
        try {
          final decoded = jsonDecode(utf8.decode(event.data));
          final name = decoded is Map ? decoded['health'] : null;
          final health = SyncHealth.values.where((h) => h.name == name).firstOrNull;
          if (health != null && mounted) {
            setState(() => _peerStatus[sender] = _PeerStatus(health, DateTime.now()));
          }
        } catch (_) {}
      case _syncTopic:
        if (sender == null) return;
        PartyPlaybackState? state;
        try {
          state = PartyPlaybackState.tryParse(
            jsonDecode(utf8.decode(event.data)),
            receivedAtServerMs: _clock.nowServerMs(),
            senderIdentity: sender,
          );
        } catch (_) {
          return;
        }
        if (state == null) return;
        // Actions from anyone holding control; heartbeats only from the leader, so two devices
        // with control never pull each other back and forth.
        final fromLeader = sender == _leaderIdentity();
        final allowed = state.kind == PartyStateKind.heartbeat ? fromLeader : (fromLeader || _identityCanControl(sender));
        if (!allowed) return;
        _sync.applyInbound(state);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Actions

  void _pushLocalReaction(String emoji) {
    if (!mounted) return;
    final id = _nextReactionId++;
    setState(() => _reactions.add(FloatingReactionData(id: id, emoji: emoji, x: Random().nextDouble() * 0.8)));
    Timer(const Duration(milliseconds: 2200), () {
      if (mounted) setState(() => _reactions.removeWhere((r) => r.id == id));
    });
  }

  Future<void> _sendReaction(String emoji) async {
    _pushLocalReaction(emoji);
    final room = _room;
    if (room == null) return;
    final payload = utf8.encode(jsonEncode({'type': 'reaction', 'emoji': emoji}));
    await room.localParticipant?.publishData(payload, reliable: false, topic: _reactionTopic);
  }

  void _pushToast(String message, {bool control = false}) {
    if (!mounted) return;
    final id = _nextToastId++;
    setState(() => _toasts.add(WatchPartyToastData(id: id, message: message, control: control)));
    Timer(Duration(seconds: control ? 6 : 4), () {
      if (mounted) setState(() => _toasts.removeWhere((t) => t.id == id));
    });
  }

  void _diffParticipantsForToasts(List<WatchPartyParticipant> previous, List<WatchPartyParticipant> next) {
    if (!_hasSeenInitialRoster) {
      _hasSeenInitialRoster = true;
      return;
    }
    final previousIdentities = previous.map((p) => p.identity).toSet();
    final nextIdentities = next.map((p) => p.identity).toSet();
    for (final participant in next) {
      if (!previousIdentities.contains(participant.identity)) _pushToast('${participant.label} joined');
    }
    for (final participant in previous) {
      if (!nextIdentities.contains(participant.identity)) _pushToast('${participant.label} left');
    }
    final myIdentity = _joined?.participantIdentity;
    if (myIdentity == null) return;
    final wasMine = previous.where((p) => p.identity == myIdentity).firstOrNull;
    final isMine = next.where((p) => p.identity == myIdentity).firstOrNull;
    if (wasMine != null && isMine != null && wasMine.canControlPlayback != isMine.canControlPlayback) {
      _pushToast(
        isMine.canControlPlayback ? 'You can now control playback' : 'Playback control was taken back',
        control: true,
      );
    }
  }

  Future<void> _startNewParty() async {
    try {
      final party = await WatchPartyService.create(fileId: widget.fileId, title: widget.videoTitle);
      widget.onPartyIdChanged(party.id);
    } catch (_) {
      if (mounted) _pushToast("Couldn't start a watch party.");
    }
  }

  void _joinByCode(String code) {
    final partyId = WatchPartyService.extractPartyCode(code);
    if (partyId.isEmpty) return;
    widget.onPartyIdChanged(partyId.toUpperCase());
  }

  Future<void> _handleLeavePressed() async {
    final joined = _joined;
    _closePanel();
    await _teardownRoom();
    if (joined != null) WatchPartyService.leave(joined.party.id).catchError((_) {});
    if (mounted) {
      setState(() {
        _joined = null;
        _participants = [];
        _pendingChoice = null;
        _micEnabled = false;
        _cameraEnabled = false;
      });
    }
    widget.onPartyIdChanged(null);
  }

  Future<void> _handleEndPressed() async {
    final joined = _joined;
    if (joined == null) return;
    await WatchPartyService.end(joined.party.id).catchError((_) {});
    await _handleLeavePressed();
  }

  Future<void> _toggleMic() async {
    final localParticipant = _room?.localParticipant;
    if (localParticipant == null) return;
    final next = !_micEnabled;
    if (next && !(await Permission.microphone.request()).isGranted) return;
    await localParticipant.setMicrophoneEnabled(next);
    if (mounted) setState(() => _micEnabled = next);
  }

  Future<void> _toggleCamera() async {
    final localParticipant = _room?.localParticipant;
    if (localParticipant == null) return;
    final next = !_cameraEnabled;
    if (next && !(await Permission.camera.request()).isGranted) return;
    await localParticipant.setCameraEnabled(next);
    if (mounted) setState(() => _cameraEnabled = next);
  }

  Future<void> _setControl(WatchPartyParticipant participant, bool grant) async {
    final joined = _joined;
    if (joined == null) return;
    try {
      final updated = await WatchPartyService.grantControl(
        joined.party.id,
        userId: participant.userId,
        deviceId: participant.deviceId,
        grant: grant,
      );
      if (!mounted) return;
      setState(() => _participants = updated);
      _reconfigureSync();
    } catch (_) {
      _pushToast("Couldn't change control. Try again.");
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Panel

  bool _useSheet(BuildContext context) {
    if (usesDockedPartyPanel) return false;
    final size = MediaQuery.sizeOf(context);
    return size.height > size.width;
  }

  void _openPanel() {
    if (!_connected) return;
    if (_useSheet(context)) {
      _openPanelSheet();
      return;
    }
    setState(() => _panelOpen = true);
  }

  void _closePanel() {
    if (_panelOpen && mounted) setState(() => _panelOpen = false);
  }

  void _openPanelSheet() {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.bgElevated,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl))),
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(sheetContext).bottom),
        child: SizedBox(
          height: MediaQuery.sizeOf(sheetContext).height * 0.82,
          child: _panel(onClose: () => Navigator.of(sheetContext).pop()),
        ),
      ),
    );
  }

  Widget _panel({required VoidCallback onClose}) {
    final room = _room!;
    final joined = _joined!;
    return _PartyPanel(
      room: room,
      joined: joined,
      chat: _chat!,
      participants: _participants,
      leaderIdentity: _leaderIdentity(),
      statusFor: _statusFor,
      role: _sync.role,
      following: _sync.following,
      onToggleFollowing: (v) => _sync.setFollowing(v),
      micEnabled: _micEnabled,
      cameraEnabled: _cameraEnabled,
      onToggleMic: _toggleMic,
      onToggleCamera: _toggleCamera,
      onSetControl: _setControl,
      onLeave: _handleLeavePressed,
      onEnd: _handleEndPressed,
      onSendReaction: _sendReaction,
      onClose: onClose,
    );
  }

  /// The roster pill for one device: what it last told us, or for this device, what our own
  /// player reports.
  SyncHealth? _statusFor(WatchPartyParticipant participant) {
    if (participant.identity == _joined?.participantIdentity) {
      return _sync.following ? _sync.health : SyncHealth.independent;
    }
    final status = _peerStatus[participant.identity];
    if (status == null || DateTime.now().difference(status.at) > const Duration(seconds: 10)) return null;
    return status.health;
  }

  void _openStartOrJoinSheet() {
    final codeController = TextEditingController();
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: AppColors.bgElevated,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl))),
      builder: (sheetContext) => Padding(
        padding: EdgeInsets.fromLTRB(16, 8, 16, MediaQuery.viewInsetsOf(sheetContext).bottom + 16),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Center(
                child: Container(
                  width: 38,
                  height: 4,
                  margin: const EdgeInsets.only(bottom: 14),
                  decoration: BoxDecoration(color: AppColors.dividerStrong, borderRadius: BorderRadius.circular(2)),
                ),
              ),
              const Text('Watch party', style: TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700, fontSize: 17)),
              const SizedBox(height: 6),
              const Text(
                'Everyone plays, pauses and seeks together, with voice and chat. Start one and share the code.',
                style: TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.5),
              ),
              const SizedBox(height: 16),
              FilledButton.icon(
                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                onPressed: () {
                  Navigator.of(sheetContext).pop();
                  _startNewParty();
                },
                icon: const Icon(Icons.groups_outlined),
                label: const Text('Start a watch party'),
              ),
              const SizedBox(height: 20),
              const Text('Join with a code', style: TextStyle(color: AppColors.textSecondary, fontSize: 12.5, fontWeight: FontWeight.w600)),
              const SizedBox(height: 8),
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: codeController,
                      textCapitalization: TextCapitalization.characters,
                      style: const TextStyle(color: AppColors.foreground, letterSpacing: 2, fontWeight: FontWeight.w600),
                      decoration: const InputDecoration(hintText: 'Code or invite link'),
                      onSubmitted: (value) {
                        Navigator.of(sheetContext).pop();
                        _joinByCode(value);
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(minimumSize: const Size(80, 48)),
                    onPressed: () {
                      Navigator.of(sheetContext).pop();
                      _joinByCode(codeController.text);
                    },
                    child: const Text('Join'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Build

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top + 72;
    final toasts = Positioned(top: top, right: 12, child: WatchPartyToastStack(toasts: _toasts));

    if (isAndroidTv && _connected) {
      return Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [widget.child, Positioned.fill(child: ReactionOverlay(reactions: _reactions)), toasts],
            ),
          ),
          TvPartyRail(
            room: _room!,
            joined: _joined!,
            participants: _participants,
            chat: _chat!,
            onSetControl: _setControl,
            onLeave: _handleLeavePressed,
            onEnd: _handleEndPressed,
            onSendReaction: _sendReaction,
            onExitToChrome: () => _sync.tvChromeFocusNode.requestFocus(),
          ),
        ],
      );
    }

    Widget? banner;
    if (_pendingChoice is WatchPartyJoinRequiresConfirmation) {
      final pending = _pendingChoice as WatchPartyJoinRequiresConfirmation;
      banner = _ChoiceBanner(
        message: "You're already in this party on ${pending.existingSession.deviceLabel}. Join from this device too?",
        primaryLabel: 'Join here too',
        onPrimary: () => _startJoinFlow(confirmed: true),
        secondaryLabel: 'Not now',
        onSecondary: () => widget.onPartyIdChanged(null),
      );
    } else if (_pendingChoice is WatchPartyJoinRequiresRoleChoice) {
      final pending = _pendingChoice as WatchPartyJoinRequiresRoleChoice;
      banner = FutureBuilder<String>(
        future: DeviceIdService.getDeviceId(),
        builder: (context, snapshot) {
          final deviceId = snapshot.data;
          return _ChoiceBanner(
            message: 'Which screen should play the video? The other one keeps voice and chat.',
            primaryLabel: 'This device',
            onPrimary: deviceId == null ? null : () => _startJoinFlow(confirmed: true, chosenMainDeviceId: deviceId),
            secondaryLabel: pending.existingSession.deviceLabel,
            onSecondary: () => _startJoinFlow(confirmed: true, chosenMainDeviceId: 'other'),
          );
        },
      );
    } else if (_connecting) {
      banner = const _StatusChip(label: 'Joining the watch party…');
    }

    final stage = Stack(
      fit: StackFit.expand,
      children: [
        widget.child,
        if (_connected) Positioned.fill(child: ReactionOverlay(reactions: _reactions)),
        if (banner != null) Positioned(top: top, left: 12, right: 12, child: Center(child: banner)),
        toasts,
      ],
    );

    final docked = _connected && _panelOpen && !_useSheet(context);
    if (!docked) return stage;

    final width = MediaQuery.sizeOf(context).width;
    final panelWidth = usesDockedPartyPanel ? 360.0 : min(320.0, width * 0.42);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(child: stage),
        SizedBox(
          width: panelWidth,
          child: Material(
            color: AppColors.bgElevated,
            child: DecoratedBox(
              decoration: const BoxDecoration(border: Border(left: BorderSide(color: AppColors.divider))),
              child: SafeArea(left: false, child: _panel(onClose: _closePanel)),
            ),
          ),
        ),
      ],
    );
  }
}

// -----------------------------------------------------------------------------------------------

class _StatusChip extends StatelessWidget {
  final String label;
  const _StatusChip({required this.label});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 9),
      decoration: BoxDecoration(
        color: const Color(0xE6161412),
        borderRadius: BorderRadius.circular(AppRadius.pill),
        border: Border.all(color: AppColors.dividerStrong),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.accent)),
          const SizedBox(width: 10),
          Text(label, style: const TextStyle(color: AppColors.foreground, fontSize: 12.5, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}

class _ChoiceBanner extends StatelessWidget {
  final String message;
  final String primaryLabel;
  final VoidCallback? onPrimary;
  final String secondaryLabel;
  final VoidCallback onSecondary;

  const _ChoiceBanner({
    required this.message,
    required this.primaryLabel,
    required this.onPrimary,
    required this.secondaryLabel,
    required this.onSecondary,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 520),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.bgElevated,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.dividerStrong),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, style: const TextStyle(color: AppColors.foreground, fontSize: 13.5, height: 1.4)),
          const SizedBox(height: 10),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(onPressed: onSecondary, child: Text(secondaryLabel)),
              const SizedBox(width: 8),
              FilledButton(onPressed: onPrimary, child: Text(primaryLabel)),
            ],
          ),
        ],
      ),
    );
  }
}

/// The party panel, as the approved phone design: what a party is, the code to share, who's here
/// and how in-sync each of them is, "Keep me in sync", voice/camera, reactions, chat, and
/// Leave/End. Docked beside the video in landscape and on Windows; a bottom sheet in portrait.
class _PartyPanel extends StatelessWidget {
  final Room room;
  final WatchPartyJoinSuccess joined;
  final PartyChatController chat;
  final List<WatchPartyParticipant> participants;
  final String? leaderIdentity;
  final SyncHealth? Function(WatchPartyParticipant participant) statusFor;
  final PartyPlaybackRole role;
  final bool following;
  final ValueChanged<bool> onToggleFollowing;
  final bool micEnabled;
  final bool cameraEnabled;
  final VoidCallback onToggleMic;
  final VoidCallback onToggleCamera;
  final void Function(WatchPartyParticipant participant, bool grant) onSetControl;
  final VoidCallback onLeave;
  final VoidCallback onEnd;
  final ValueChanged<String> onSendReaction;
  final VoidCallback onClose;

  const _PartyPanel({
    required this.room,
    required this.joined,
    required this.chat,
    required this.participants,
    required this.leaderIdentity,
    required this.statusFor,
    required this.role,
    required this.following,
    required this.onToggleFollowing,
    required this.micEnabled,
    required this.cameraEnabled,
    required this.onToggleMic,
    required this.onToggleCamera,
    required this.onSetControl,
    required this.onLeave,
    required this.onEnd,
    required this.onSendReaction,
    required this.onClose,
  });

  bool get _isHost => joined.isHost && joined.deviceRole == 'main';

  static (String, Color) _pill(WatchPartyParticipant p, SyncHealth? health, bool isLeader) {
    if (health == SyncHealth.buffering) return ('buffering', AppColors.info);
    if (health == SyncHealth.catchingUp) return ('catching up', AppColors.amber);
    if (health == SyncHealth.independent) return ('on their own', AppColors.textTertiary);
    if (p.role == 'host') return ('host', AppColors.amber);
    if (isLeader) return ('leading', AppColors.amber);
    if (p.deviceRole == 'companion') return ('voice only', AppColors.textTertiary);
    if (health == SyncHealth.paused) return ('paused', AppColors.textSecondary);
    if (health == SyncHealth.synced) return ('in sync', AppColors.live);
    return ('connected', AppColors.textSecondary);
  }

  Widget _roster() {
    if (participants.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 8),
        child: Text('Loading who is here…', style: TextStyle(color: AppColors.textTertiary, fontSize: 12.5)),
      );
    }
    return Column(
      children: [
        for (final p in participants)
          _RosterRow(
            participant: p,
            isSelf: p.identity == joined.participantIdentity,
            pill: _pill(p, statusFor(p), p.identity == leaderIdentity),
            canControl: p.canControlPlayback && p.role != 'host',
            canGrant: _isHost && p.role != 'host' && p.deviceRole == 'main',
            onSetControl: onSetControl,
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final follower = role == PartyPlaybackRole.follower || role == PartyPlaybackRole.controller;
    final hasCameras = room.localParticipant?.isCameraEnabled() == true ||
        room.remoteParticipants.values.any((p) => p.isCameraEnabled());

    final header = Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 4, 8),
      child: Row(
        children: [
          const Expanded(
            child: Text('Watch party', style: TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700, fontSize: 16)),
          ),
          IconButton(
            tooltip: micEnabled ? 'Mute microphone' : 'Unmute microphone',
            icon: Icon(micEnabled ? Icons.mic : Icons.mic_off_outlined, color: micEnabled ? AppColors.live : AppColors.textSecondary),
            onPressed: onToggleMic,
          ),
          IconButton(
            tooltip: cameraEnabled ? 'Turn camera off' : 'Turn camera on',
            icon: Icon(
              cameraEnabled ? Icons.videocam : Icons.videocam_off_outlined,
              color: cameraEnabled ? AppColors.live : AppColors.textSecondary,
            ),
            onPressed: onToggleCamera,
          ),
          IconButton(
            tooltip: 'Close watch party panel',
            icon: const Icon(Icons.close, color: AppColors.textSecondary),
            onPressed: onClose,
          ),
        ],
      ),
    );

    final code = Container(
      padding: const EdgeInsets.fromLTRB(14, 6, 6, 6),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: AppColors.dividerStrong),
      ),
      child: Row(
        children: [
          Expanded(
            child: SelectableText(
              joined.party.id,
              style: const TextStyle(
                color: AppColors.amber,
                fontSize: 18,
                fontWeight: FontWeight.w700,
                letterSpacing: 3,
                fontFamily: 'monospace',
              ),
            ),
          ),
          TextButton(
            onPressed: () {
              Clipboard.setData(ClipboardData(text: joined.party.id));
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Party code copied')));
            },
            child: const Text('Copy'),
          ),
        ],
      ),
    );

    final sync = follower
        ? Padding(
            padding: const EdgeInsets.only(top: 6),
            child: SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: following,
              onChanged: onToggleFollowing,
              activeThumbColor: AppColors.accent,
              title: const Text('Keep me in sync', style: TextStyle(color: AppColors.foreground, fontSize: 14, fontWeight: FontWeight.w600)),
              subtitle: Text(
                following
                    ? 'Plays, pauses and seeks with the party'
                    : "You're watching on your own — turn on to jump back to the party",
                style: const TextStyle(color: AppColors.textTertiary, fontSize: 11.5),
              ),
            ),
          )
        : const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        header,
        const Divider(height: 1, color: AppColors.divider),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: CustomScrollView(
              slivers: [
                SliverList.list(
                  children: [
                    const SizedBox(height: 12),
                    code,
                    if (hasCameras) ...[const SizedBox(height: 12), WatchPartyVideoGrid(room: room)],
                    const _SectionLabel('In this party'),
                    _roster(),
                    sync,
                    const SizedBox(height: 8),
                    ReactionPicker(onSend: onSendReaction),
                    const _SectionLabel('Chat'),
                  ],
                ),
                SliverFillRemaining(
                  hasScrollBody: true,
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minHeight: 190),
                    child: WatchPartyChat(chat: chat, expand: true),
                  ),
                ),
              ],
            ),
          ),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 12),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.danger,
                    side: const BorderSide(color: AppColors.danger),
                    minimumSize: const Size.fromHeight(44),
                  ),
                  onPressed: onLeave,
                  child: const Text('Leave party'),
                ),
              ),
              if (_isHost) ...[
                const SizedBox(width: 8),
                Expanded(
                  child: FilledButton(
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.danger,
                      minimumSize: const Size.fromHeight(44),
                    ),
                    onPressed: onEnd,
                    child: const Text('End for everyone'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

class _SectionLabel extends StatelessWidget {
  final String label;
  const _SectionLabel(this.label);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 18, bottom: 6),
      child: Text(
        label.toUpperCase(),
        style: const TextStyle(color: AppColors.textTertiary, fontSize: 10.5, fontWeight: FontWeight.w700, letterSpacing: 1.3),
      ),
    );
  }
}

class _RosterRow extends StatelessWidget {
  final WatchPartyParticipant participant;
  final bool isSelf;
  final (String, Color) pill;
  final bool canControl;
  final bool canGrant;
  final void Function(WatchPartyParticipant participant, bool grant) onSetControl;

  const _RosterRow({
    required this.participant,
    required this.isSelf,
    required this.pill,
    required this.canControl,
    required this.canGrant,
    required this.onSetControl,
  });

  @override
  Widget build(BuildContext context) {
    final name = participant.label;
    final initial = name.isNotEmpty ? name.characters.first.toUpperCase() : '?';
    final (pillLabel, pillColor) = pill;
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 48),
      child: Row(
        children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(colors: [AppColors.accent, AppColors.amber]),
            ),
            child: Text(initial, style: const TextStyle(color: AppColors.onAccent, fontWeight: FontWeight.w700, fontSize: 13)),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  isSelf ? '$name (you)' : name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.foreground, fontSize: 14),
                ),
                Text(
                  [participant.deviceLabel, if (canControl) 'can control'].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.textTertiary, fontSize: 11),
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppRadius.pill),
              border: Border.all(color: pillColor),
            ),
            child: Text(
              pillLabel.toUpperCase(),
              style: TextStyle(color: pillColor, fontSize: 9.5, fontWeight: FontWeight.w700, letterSpacing: 0.5),
            ),
          ),
          if (canGrant)
            TextButton(
              onPressed: () => onSetControl(participant, !participant.canControlPlayback),
              child: Text(participant.canControlPlayback ? 'Revoke' : 'Give control', style: const TextStyle(fontSize: 12)),
            ),
        ],
      ),
    );
  }
}
