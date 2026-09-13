import 'package:flutter/material.dart';
import 'package:flutter/services.dart' show Clipboard, ClipboardData;
import 'package:livekit_client/livekit_client.dart';

import '../models/watch_party.dart';
import '../theme/app_theme.dart';
import 'tv_focusable.dart';
import 'watch_party_chat.dart';

/// Always-mounted right-edge rail for Android TV — never a modal/sheet, since a D-pad-only remote
/// can't dismiss one the way a touch/mouse back-tap can. See design.html's TV mockups: roster +
/// quick reactions + "open full chat", built from [TvFocusable] rows so every action is reachable
/// D-pad-only. Cameras never appear here — TV publishes no camera track, and every other
/// participant's camera (if any) already floats over the video instead (see
/// WatchPartyOverlay._buildCameraStrip); this shows a device badge per participant instead.
class TvPartyRail extends StatefulWidget {
  final Room room;
  final WatchPartyJoinSuccess joined;
  final List<WatchPartyParticipant> participants;
  final void Function(WatchPartyParticipant participant, bool grant) onSetControl;
  final VoidCallback onLeave;
  final VoidCallback onEnd;
  // Called when Back is pressed while focus is somewhere inside this rail — walks focus back down
  // to the player's own chrome instead of letting Back exit the player outright (see
  // design.html's "Back always walks up exactly one level" rule, and the two-mode focus handling
  // in campfire_video_player.dart / media_kit_video_player.dart).
  final VoidCallback onExitToChrome;

  const TvPartyRail({
    super.key,
    required this.room,
    required this.joined,
    required this.participants,
    required this.onSetControl,
    required this.onLeave,
    required this.onEnd,
    required this.onExitToChrome,
  });

  @override
  State<TvPartyRail> createState() => _TvPartyRailState();
}

class _TvPartyRailState extends State<TvPartyRail> {
  final _railScope = FocusScopeNode(debugLabel: 'tv-party-rail');
  bool _chatOpen = false;

  @override
  void dispose() {
    _railScope.dispose();
    super.dispose();
  }

  IconData _deviceIcon(String clientKind) {
    switch (clientKind) {
      case 'windows':
        return Icons.desktop_windows;
      case 'web':
        return Icons.language;
      case 'ios':
        return Icons.phone_iphone;
      case 'android':
      default:
        return Icons.smartphone;
    }
  }

  void _openChat() => setState(() => _chatOpen = true);

  @override
  Widget build(BuildContext context) {
    final isHost = widget.joined.isHost && widget.joined.deviceRole == 'main';

    return PopScope(
      canPop: !_railScope.hasFocus,
      onPopInvokedWithResult: (didPop, result) {
        if (didPop) return;
        if (_chatOpen) {
          setState(() => _chatOpen = false);
          return;
        }
        _railScope.unfocus();
        widget.onExitToChrome();
      },
      child: FocusScope(
        node: _railScope,
        child: Container(
          width: 320,
          color: const Color(0xF2141414),
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: _chatOpen
                  ? Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Row(
                          children: [
                            IconButton(
                              icon: const Icon(Icons.chevron_right, color: Colors.white70),
                              onPressed: () => setState(() => _chatOpen = false),
                            ),
                            const Text('Chat', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 20)),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Expanded(child: WatchPartyChat(room: widget.room)),
                      ],
                    )
                  : Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const Text('Watch Party', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 22)),
                        const SizedBox(height: 4),
                        _CodeChip(code: widget.joined.party.id),
                        const SizedBox(height: 16),
                        Expanded(
                          child: ListView(
                            children: [
                              for (final participant in widget.participants)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 8),
                                  child: _RosterRow(
                                    participant: participant,
                                    isSelf: participant.identity == widget.joined.participantIdentity,
                                    canGrant: isHost && participant.role != 'host' && participant.deviceRole == 'main',
                                    icon: _deviceIcon(participant.clientKind),
                                    onSetControl: widget.onSetControl,
                                  ),
                                ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 8),
                        TvFocusable(
                          onTap: _openChat,
                          child: const _RailButton(icon: Icons.chat_bubble_outline, label: 'Open Full Chat'),
                        ),
                        const SizedBox(height: 8),
                        TvFocusable(
                          onTap: widget.onLeave,
                          child: const _RailButton(icon: Icons.logout, label: 'Leave Party'),
                        ),
                        if (isHost) ...[
                          const SizedBox(height: 8),
                          TvFocusable(
                            onTap: widget.onEnd,
                            child: const _RailButton(icon: Icons.stop_circle_outlined, label: 'End Party', danger: true),
                          ),
                        ],
                      ],
                    ),
            ),
          ),
        ),
      ),
    );
  }
}

class _CodeChip extends StatelessWidget {
  final String code;
  const _CodeChip({required this.code});

  @override
  Widget build(BuildContext context) {
    return Align(
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
            Text(code, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w700, letterSpacing: 3)),
            const SizedBox(width: 10),
            TvFocusable(
              onTap: () => Clipboard.setData(ClipboardData(text: code)),
              child: const Icon(Icons.copy, color: Colors.white70, size: 20),
            ),
          ],
        ),
      ),
    );
  }
}

class _RosterRow extends StatelessWidget {
  final WatchPartyParticipant participant;
  final bool isSelf;
  final bool canGrant;
  final IconData icon;
  final void Function(WatchPartyParticipant participant, bool grant) onSetControl;

  const _RosterRow({
    required this.participant,
    required this.isSelf,
    required this.canGrant,
    required this.icon,
    required this.onSetControl,
  });

  @override
  Widget build(BuildContext context) {
    final row = Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.06), borderRadius: BorderRadius.circular(10)),
      child: Row(
        children: [
          Icon(icon, color: Colors.white60, size: 20),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '${participant.deviceLabel}${isSelf ? ' (You)' : ''}',
              style: const TextStyle(color: Colors.white, fontSize: 15),
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (participant.role == 'host')
            const Text('Host', style: TextStyle(color: Colors.greenAccent, fontSize: 12))
          else if (participant.canControlPlayback)
            const Text('Can control', style: TextStyle(color: Colors.lightBlueAccent, fontSize: 12)),
        ],
      ),
    );
    if (!canGrant) return row;
    return TvFocusable(
      onTap: () => onSetControl(participant, !participant.canControlPlayback),
      child: row,
    );
  }
}

class _RailButton extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool danger;
  const _RailButton({required this.icon, required this.label, this.danger = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      decoration: BoxDecoration(
        border: Border.all(color: danger ? AppColors.danger.withValues(alpha: 0.4) : AppColors.dividerStrong),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        children: [
          Icon(icon, color: danger ? AppColors.danger : Colors.white, size: 20),
          const SizedBox(width: 10),
          Text(label, style: TextStyle(color: danger ? AppColors.danger : Colors.white, fontSize: 15, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
