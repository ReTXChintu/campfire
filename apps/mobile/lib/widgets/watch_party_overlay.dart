import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:go_router/go_router.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';

import '../models/watch_party.dart';
import '../platform_info.dart';
import '../services/device_id_service.dart';
import '../services/watch_party_service.dart';
import '../services/watch_party_sync_controller.dart';
import '../theme/app_theme.dart';
import 'watch_party_chat.dart';
import 'watch_party_toast.dart';
import 'watch_party_video_grid.dart';

/// Watch Party entry point + live session chrome — voice/video calling, text chat, the participant
/// roster with host grant/revoke controls, and (via `syncController`) playback sync for whichever
/// player widget WatchScreen currently has on screen. Deliberately separate from
/// CampfireVideoPlayer/MediaKitVideoPlayer internals — it wraps the player as `child` so it can
/// decide, per platform, whether party chrome floats over the video (phone/TV, a `Stack`) or narrows
/// it as a docked side panel (Windows, a `Row` — see [usesDockedPartyPanel]); the sync controller
/// remains the only channel through which the player widget and this overlay talk to each other.
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

class _WatchPartyOverlayState extends State<WatchPartyOverlay> {
  Room? _room;
  EventsListener<RoomEvent>? _listener;
  WatchPartyJoinSuccess? _joined;
  WatchPartyJoinResult? _pendingChoice; // requiresConfirmation / requiresRoleChoice, awaiting a tap
  List<WatchPartyParticipant> _participants = [];
  Timer? _heartbeatTimer;
  bool _connecting = false;
  bool _micEnabled = false;
  bool _cameraEnabled = false;
  String? _error;
  // Windows-only: the docked side panel collapses to a thin edge pill instead of a modal sheet —
  // see [usesDockedPartyPanel].
  bool _sidebarCollapsed = false;

  // Join/control-change toasts — see watch_party_toast.dart. `_hasSeenInitialRoster` guards
  // against firing a spurious "X joined" toast for every participant already in the party at the
  // moment *we* connect — only genuinely new arrivals after that point should toast.
  final List<WatchPartyToastData> _toasts = [];
  bool _hasSeenInitialRoster = false;
  int _nextToastId = 0;

  @override
  void initState() {
    super.initState();
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
      });
    } else {
      _startJoinFlow();
    }
  }

  @override
  void dispose() {
    unawaited(_teardownRoom());
    super.dispose();
  }

  Future<void> _teardownRoom() async {
    _heartbeatTimer?.cancel();
    _heartbeatTimer = null;
    await _listener?.cancelAll();
    _listener = null;
    final room = _room;
    _room = null;
    if (room != null) {
      await room.disconnect();
      await room.dispose();
    }
    widget.syncController.configure(enabled: false, canControl: false, broadcaster: null);
  }

  // True for the host's main device, and for any guest's main device the host has granted control
  // to — mirrors WatchPage.tsx's canControlPlayback derivation. Falls back to the join-token
  // response's own snapshot until the roster query has data (a brief window right after joining).
  bool _computeCanControl() {
    final joined = _joined;
    if (joined == null) return false;
    for (final participant in _participants) {
      if (participant.identity == joined.participantIdentity) {
        return participant.deviceRole == 'main' && participant.canControlPlayback;
      }
    }
    return joined.canControlPlayback;
  }

  void _pushToast(String message, {bool control = false}) {
    if (!mounted) return;
    final id = _nextToastId++;
    setState(() => _toasts.add(WatchPartyToastData(id: id, message: message, control: control)));
    Timer(Duration(seconds: control ? 6 : 4), () {
      if (mounted) setState(() => _toasts.removeWhere((t) => t.id == id));
    });
  }

  // Compares the roster we already had against a freshly-fetched/pushed one and toasts on the two
  // events design.html calls out: a new participant joining, and *this session's own* control
  // being granted or revoked (not anyone else's — that's not actionable/relevant to me).
  void _diffParticipantsForToasts(List<WatchPartyParticipant> previous, List<WatchPartyParticipant> next) {
    if (!_hasSeenInitialRoster) {
      _hasSeenInitialRoster = true;
      return;
    }
    final previousIdentities = previous.map((p) => p.identity).toSet();
    for (final participant in next) {
      if (!previousIdentities.contains(participant.identity)) {
        _pushToast('${participant.deviceLabel} joined the party');
      }
    }
    final myIdentity = _joined?.participantIdentity;
    if (myIdentity == null) return;
    final wasMine = previous.where((p) => p.identity == myIdentity).firstOrNull;
    final isMine = next.where((p) => p.identity == myIdentity).firstOrNull;
    if (wasMine != null && isMine != null && wasMine.canControlPlayback != isMine.canControlPlayback) {
      _pushToast(
        isMine.canControlPlayback ? 'You were granted control' : 'Your control was revoked',
        control: true,
      );
    }
  }

  void _reconfigureSyncController() {
    widget.syncController.configure(
      enabled: true,
      canControl: _computeCanControl(),
      broadcaster: _broadcastSyncState,
    );
  }

  Future<void> _broadcastSyncState(WatchPartySyncState state) async {
    final joined = _joined;
    final room = _room;
    if (joined == null || room == null) return;
    await WatchPartyService.updateState(
      joined.party.id,
      playing: state.playing,
      positionSeconds: state.positionSeconds,
      playbackRate: state.playbackRate,
    ).catchError((_) {
      // Best-effort — the local player already reflects the new state either way, and the next
      // successful broadcast (or the party doc's own next fetch) will reconcile the backend.
      return joined.party;
    });
    final payload = utf8.encode(jsonEncode(state.toJson()));
    await room.localParticipant?.publishData(payload, reliable: true, topic: 'watch-party-sync');
  }

  Future<void> _startJoinFlow({bool confirmed = false, String? chosenMainDeviceId}) async {
    final partyId = widget.partyId;
    if (partyId == null) return;
    setState(() {
      _connecting = true;
      _error = null;
    });
    try {
      final result = await WatchPartyService.joinToken(
        partyId,
        confirmed: confirmed,
        chosenMainDeviceId: chosenMainDeviceId,
      );
      if (!mounted) return;
      if (result is WatchPartyJoinSuccess) {
        // A code pasted/joined for a party tied to a *different* video than the one currently open
        // (e.g. the home screen's "Join Watch Party" dialog, or a code shared while watching
        // something else) — redirect to the party's actual video before ever touching LiveKit,
        // mirroring WatchPage.tsx's identical `party.fileId !== fileId` redirect. WatchScreen fully
        // remounts on a fileId change (no persistent route the way web's SPA has), so the new
        // screen's own WatchPartyOverlay picks the join back up from here — a brief extra
        // round-trip, but join-token returns the same session/deviceRole without re-prompting.
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
          _error = "Couldn't join the watch party.";
        });
      }
    }
  }

  Future<void> _connectRoom(WatchPartyJoinSuccess joined) async {
    final room = Room();
    final listener = room.createListener();
    listener
      ..on<ParticipantConnectedEvent>((_) => setState(() {}))
      ..on<ParticipantDisconnectedEvent>((_) => setState(() {}))
      ..on<TrackSubscribedEvent>((_) => setState(() {}))
      ..on<TrackUnsubscribedEvent>((_) => setState(() {}))
      ..on<LocalTrackPublishedEvent>((_) => setState(() {}))
      ..on<LocalTrackUnpublishedEvent>((_) => setState(() {}))
      ..on<DataReceivedEvent>(_onDataReceived);

    try {
      await room.connect(joined.serverUrl, joined.participantToken);
    } catch (_) {
      await listener.cancelAll();
      await room.dispose();
      if (mounted) {
        setState(() {
          _connecting = false;
          _error = "Couldn't connect to the watch party room.";
        });
      }
      return;
    }
    if (!mounted) {
      await listener.cancelAll();
      await room.disconnect();
      await room.dispose();
      return;
    }

    setState(() {
      _room = room;
      _listener = listener;
      _joined = joined;
      _pendingChoice = null;
      _connecting = false;
    });
    _reconfigureSyncController();

    // Same 20s cadence as WatchPage.tsx — keeps the backend's ~45s read-time staleness filter
    // from ever considering this device gone, and doubles as a participants-roster refresh
    // fallback alongside the "watch-party-control" data-channel push (see _onDataReceived).
    _heartbeatTimer = Timer.periodic(const Duration(seconds: 20), (_) {
      WatchPartyService.heartbeat(joined.party.id).catchError((_) {});
      _refreshParticipants();
    });
    _refreshParticipants();
  }

  Future<void> _refreshParticipants() async {
    final joined = _joined;
    if (joined == null) return;
    try {
      final list = await WatchPartyService.getParticipants(joined.party.id);
      if (mounted) {
        _diffParticipantsForToasts(_participants, list);
        setState(() => _participants = list);
        _reconfigureSyncController();
      }
    } catch (_) {
      // Best-effort — the heartbeat timer will try again shortly.
    }
  }

  void _onDataReceived(DataReceivedEvent event) {
    if (event.topic == 'watch-party-control') {
      try {
        final decoded = jsonDecode(utf8.decode(event.data)) as Map<String, dynamic>;
        final list = decoded['participants'] as List?;
        if (list == null) return;
        final next = list.map((e) => WatchPartyParticipant.fromJson(e as Map<String, dynamic>)).toList();
        _diffParticipantsForToasts(_participants, next);
        setState(() => _participants = next);
        _reconfigureSyncController();
      } catch (_) {
        // Ignore malformed payloads.
      }
      return;
    }
    if (event.topic == 'watch-party-sync') {
      // Accept from any current controller identity, not just the party's fixed host identity —
      // mirrors WatchPage.tsx's handleDataReceived (a granted guest's broadcasts look identical to
      // the host's).
      final senderIdentity = event.participant?.identity;
      if (senderIdentity == null) return;
      final isCurrentController = _participants.any(
        (p) => p.identity == senderIdentity && p.deviceRole == 'main' && p.canControlPlayback,
      );
      if (!isCurrentController) return;
      try {
        final decoded = jsonDecode(utf8.decode(event.data));
        final state = WatchPartySyncState.tryParse(decoded);
        if (state != null) widget.syncController.applyInbound(state);
      } catch (_) {
        // Ignore malformed payloads.
      }
    }
  }

  Future<void> _startNewParty() async {
    setState(() => _error = null);
    try {
      final party = await WatchPartyService.create(fileId: widget.fileId, title: widget.videoTitle);
      widget.onPartyIdChanged(party.id);
    } catch (_) {
      if (mounted) setState(() => _error = "Couldn't start a watch party.");
    }
  }

  void _joinByCode(String code) {
    final partyId = WatchPartyService.extractPartyCode(code);
    if (partyId.isEmpty) return;
    widget.onPartyIdChanged(partyId);
  }

  Future<void> _handleLeavePressed() async {
    final joined = _joined;
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
      if (mounted) setState(() => _participants = updated);
    } catch (_) {
      // Best-effort — the button just stays in its current state on failure.
    }
  }

  void _openPartyPanel() {
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xF2141414),
      isScrollControlled: true,
      builder: (context) => _PartyPanel(
        room: _room!,
        joined: _joined!,
        participants: _participants,
        micEnabled: _micEnabled,
        cameraEnabled: _cameraEnabled,
        onToggleMic: _toggleMic,
        onToggleCamera: _toggleCamera,
        onSetControl: _setControl,
        onLeave: () {
          Navigator.of(context).pop();
          _handleLeavePressed();
        },
        onEnd: () {
          Navigator.of(context).pop();
          _handleEndPressed();
        },
      ),
    );
  }

  void _openStartOrJoinSheet() {
    final codeController = TextEditingController();
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xF2141414),
      builder: (context) => Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 16,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text('Watch Party', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 12),
            ElevatedButton(
              onPressed: () {
                Navigator.of(context).pop();
                _startNewParty();
              },
              child: const Text('Start Watch Party'),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: codeController,
                    style: const TextStyle(color: Colors.white),
                    decoration: const InputDecoration(
                      hintText: 'Paste party code or invite link',
                      hintStyle: TextStyle(color: Colors.white38),
                      border: OutlineInputBorder(),
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                OutlinedButton(
                  onPressed: () {
                    Navigator.of(context).pop();
                    _joinByCode(codeController.text);
                  },
                  child: const Text('Join'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCameraStrip() {
    final room = _room;
    if (room == null) return const SizedBox.shrink();
    return WatchPartyVideoGrid(room: room);
  }

  Widget _buildDockedSidebar() {
    if (_sidebarCollapsed) {
      return Material(
        color: const Color(0xF2141414),
        child: InkWell(
          onTap: () => setState(() => _sidebarCollapsed = false),
          child: Container(
            width: 40,
            alignment: Alignment.topCenter,
            padding: const EdgeInsets.only(top: 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.chevron_left, color: Colors.white70),
                const SizedBox(height: 8),
                Text('${_participants.length}', style: const TextStyle(color: Colors.white70, fontSize: 12)),
              ],
            ),
          ),
        ),
      );
    }
    return SizedBox(
      width: 340,
      child: Material(
        color: const Color(0xF2141414),
        child: _PartyPanel(
          room: _room!,
          joined: _joined!,
          participants: _participants,
          micEnabled: _micEnabled,
          cameraEnabled: _cameraEnabled,
          onToggleMic: _toggleMic,
          onToggleCamera: _toggleCamera,
          onSetControl: _setControl,
          onLeave: _handleLeavePressed,
          onEnd: _handleEndPressed,
          docked: true,
          onCollapse: () => setState(() => _sidebarCollapsed = true),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top + 8;

    // Windows: the party panel narrows the video as a persistent docked sidebar instead of
    // floating a modal sheet on top of it — see design.html's desktop/web layout and
    // [usesDockedPartyPanel]. Every other state (connecting, entry point, etc.) still floats over
    // the video like phone/TV, since there's nothing to dock until a room is actually joined.
    if (usesDockedPartyPanel && _room != null && _joined != null) {
      return Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Expanded(
            child: Stack(
              fit: StackFit.expand,
              children: [
                widget.child,
                Positioned(right: 12, top: 12, child: _buildCameraStrip()),
                Positioned(top: top + 44, right: 8, child: WatchPartyToastStack(toasts: _toasts)),
              ],
            ),
          ),
          _buildDockedSidebar(),
        ],
      );
    }

    late final Widget content;

    if (_room != null && _joined != null) {
      content = Positioned(
        top: top,
        right: 8,
        child: _RoundIconButton(
          icon: Icons.groups,
          label: '${_participants.length}',
          onTap: _openPartyPanel,
        ),
      );
    } else if (_connecting) {
      content = Positioned(top: top, right: 8, child: const _RoundIconButton(icon: Icons.sync, onTap: null));
    } else if (_pendingChoice is WatchPartyJoinRequiresConfirmation) {
      final pending = _pendingChoice as WatchPartyJoinRequiresConfirmation;
      content = _ChoiceBanner(
        top: top,
        message: "You're already watching on ${pending.existingSession.deviceLabel}. Join from this device too?",
        primaryLabel: 'Join anyway',
        onPrimary: () => _startJoinFlow(confirmed: true),
        secondaryLabel: 'No',
        onSecondary: () => widget.onPartyIdChanged(null),
      );
    } else if (_pendingChoice is WatchPartyJoinRequiresRoleChoice) {
      final pending = _pendingChoice as WatchPartyJoinRequiresRoleChoice;
      content = FutureBuilder<String>(
        future: DeviceIdService.getDeviceId(),
        builder: (context, snapshot) {
          final deviceId = snapshot.data;
          return _ChoiceBanner(
            top: top,
            message: 'Which device is the main screen?',
            primaryLabel: 'This device',
            onPrimary: deviceId == null ? null : () => _startJoinFlow(confirmed: true, chosenMainDeviceId: deviceId),
            secondaryLabel: pending.existingSession.deviceLabel,
            onSecondary: () => _startJoinFlow(confirmed: true, chosenMainDeviceId: 'other'),
          );
        },
      );
    } else {
      // No active party and nothing pending — just the entry point, plus a small error message if
      // the last attempt failed.
      content = Positioned(
        top: top,
        right: 8,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            _RoundIconButton(icon: Icons.groups_outlined, onTap: _openStartOrJoinSheet),
            if (_error != null)
              Container(
                margin: const EdgeInsets.only(top: 6),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(6)),
                child: Text(_error!, style: const TextStyle(color: Colors.white70, fontSize: 11)),
              ),
          ],
        ),
      );
    }

    // Toasts render above whichever branch above is showing, in their own top-right stack just
    // below it — see design.html's "never over playback controls" placement rule.
    return Stack(
      fit: StackFit.expand,
      children: [
        widget.child,
        content,
        Positioned(top: top + 44, right: 8, child: WatchPartyToastStack(toasts: _toasts)),
      ],
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  final IconData icon;
  final String? label;
  final VoidCallback? onTap;

  const _RoundIconButton({required this.icon, this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.black54,
      shape: const CircleBorder(),
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(10),
          child: label == null
              ? Icon(icon, color: Colors.white, size: 20)
              : Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(icon, color: Colors.white, size: 18),
                    const SizedBox(width: 4),
                    Text(label!, style: const TextStyle(color: Colors.white, fontSize: 12)),
                  ],
                ),
        ),
      ),
    );
  }
}

class _ChoiceBanner extends StatelessWidget {
  final double top;
  final String message;
  final String primaryLabel;
  final VoidCallback? onPrimary;
  final String secondaryLabel;
  final VoidCallback onSecondary;

  const _ChoiceBanner({
    required this.top,
    required this.message,
    required this.primaryLabel,
    required this.onPrimary,
    required this.secondaryLabel,
    required this.onSecondary,
  });

  @override
  Widget build(BuildContext context) {
    return Positioned(
      top: top,
      left: 12,
      right: 12,
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(10)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(message, style: const TextStyle(color: Colors.white, fontSize: 13)),
            const SizedBox(height: 8),
            Row(
              children: [
                TextButton(onPressed: onSecondary, child: Text(secondaryLabel)),
                const Spacer(),
                ElevatedButton(onPressed: onPrimary, child: Text(primaryLabel)),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _PartyPanel extends StatelessWidget {
  final Room room;
  final WatchPartyJoinSuccess joined;
  final List<WatchPartyParticipant> participants;
  final bool micEnabled;
  final bool cameraEnabled;
  final VoidCallback onToggleMic;
  final VoidCallback onToggleCamera;
  final void Function(WatchPartyParticipant participant, bool grant) onSetControl;
  final VoidCallback onLeave;
  final VoidCallback onEnd;
  // Windows' docked sidebar (see usesDockedPartyPanel): no bottom-sheet SafeArea framing, a
  // collapse chevron instead of drag-to-dismiss, and no inline camera grid since that floats over
  // the video itself instead (see WatchPartyOverlay._buildCameraStrip).
  final bool docked;
  final VoidCallback? onCollapse;

  const _PartyPanel({
    required this.room,
    required this.joined,
    required this.participants,
    required this.micEnabled,
    required this.cameraEnabled,
    required this.onToggleMic,
    required this.onToggleCamera,
    required this.onSetControl,
    required this.onLeave,
    required this.onEnd,
    this.docked = false,
    this.onCollapse,
  });

  Widget _buildRoster(BuildContext context) {
    final isHost = joined.isHost && joined.deviceRole == 'main';
    if (participants.isEmpty) {
      return const Text('No participants yet.', style: TextStyle(color: Colors.white38, fontSize: 12));
    }
    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: participants.length,
      itemBuilder: (context, index) {
        final participant = participants[index];
        final isSelf = participant.identity == joined.participantIdentity;
        final canGrant = isHost && participant.role != 'host' && participant.deviceRole == 'main';
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  '${participant.deviceLabel}${isSelf ? ' (You)' : ''}',
                  style: const TextStyle(color: Colors.white, fontSize: 13),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (participant.role == 'host')
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 4),
                  child: Text('Host', style: TextStyle(color: Colors.greenAccent, fontSize: 11)),
                )
              else if (participant.canControlPlayback)
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 4),
                  child: Text('Can control', style: TextStyle(color: Colors.lightBlueAccent, fontSize: 11)),
                ),
              if (canGrant)
                TextButton(
                  onPressed: () => onSetControl(participant, !participant.canControlPlayback),
                  child: Text(
                    participant.canControlPlayback ? 'Revoke' : 'Grant',
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final isHost = joined.isHost && joined.deviceRole == 'main';

    final header = Row(
      children: [
        if (docked)
          IconButton(
            icon: const Icon(Icons.chevron_right, color: Colors.white70),
            tooltip: 'Collapse party panel',
            onPressed: onCollapse,
          ),
        const Text('Watch Party', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
        const Spacer(),
        IconButton(
          icon: Icon(micEnabled ? Icons.mic : Icons.mic_off, color: Colors.white),
          onPressed: onToggleMic,
        ),
        IconButton(
          icon: Icon(cameraEnabled ? Icons.videocam : Icons.videocam_off, color: Colors.white),
          onPressed: onToggleCamera,
        ),
      ],
    );

    // The only way anyone else finds out this party exists — mirrors WatchPage.tsx's
    // "Party #{partyId}" badge + "Copy Invite Link" button. Mobile has no known web frontend URL to
    // build a clickable link from (unlike web, which knows its own origin), so this shares the bare
    // code instead — both this app's "Join Watch Party" dialog (see top_bar.dart) and web's
    // paste-code field already accept a bare code directly, so nothing is lost by not having a full
    // URL.
    final codeChip = Align(
      alignment: Alignment.centerLeft,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: AppColors.surfaceHover,
          border: Border.all(color: AppColors.dividerStrong),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SelectableText(
              joined.party.id,
              style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.w700, letterSpacing: 3),
            ),
            const SizedBox(width: 10),
            IconButton(
              icon: const Icon(Icons.copy, color: Colors.white70, size: 16),
              visualDensity: VisualDensity.compact,
              tooltip: 'Copy party code',
              onPressed: () {
                Clipboard.setData(ClipboardData(text: joined.party.id));
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Party code copied')));
              },
            ),
          ],
        ),
      ),
    );

    final leaveEndRow = Row(
      children: [
        Expanded(child: OutlinedButton(onPressed: onLeave, child: const Text('Leave Party'))),
        if (isHost) ...[
          const SizedBox(width: 8),
          Expanded(
            child: OutlinedButton(
              style: OutlinedButton.styleFrom(foregroundColor: Colors.redAccent),
              onPressed: onEnd,
              child: const Text('End Party'),
            ),
          ),
        ],
      ],
    );

    final Widget body;
    if (docked) {
      // Fills the full-height sidebar (see WatchPartyOverlay._buildDockedSidebar) — the camera grid
      // floats over the video instead of sitting inline here, and the roster+chat area scrolls
      // within whatever vertical space is left instead of being clipped to a fixed height.
      body = Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          header,
          const SizedBox(height: 4),
          codeChip,
          const SizedBox(height: 8),
          Expanded(
            child: SingleChildScrollView(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildRoster(context),
                  const Divider(color: Colors.white24, height: 20),
                  WatchPartyChat(room: room),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          leaveEndRow,
        ],
      );
    } else {
      body = Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          header,
          const SizedBox(height: 4),
          codeChip,
          const SizedBox(height: 8),
          WatchPartyVideoGrid(room: room),
          const SizedBox(height: 8),
          ConstrainedBox(constraints: const BoxConstraints(maxHeight: 180), child: _buildRoster(context)),
          const Divider(color: Colors.white24, height: 20),
          WatchPartyChat(room: room),
          const SizedBox(height: 12),
          leaveEndRow,
        ],
      );
    }

    if (docked) return Padding(padding: const EdgeInsets.all(16), child: body);
    return SafeArea(top: false, child: Padding(padding: const EdgeInsets.all(16), child: body));
  }
}
