import 'package:flutter/widgets.dart';
import '../models/watch_party.dart';

/// Bridges a connected WatchPartyOverlay (owns the LiveKit room + backend party session) to
/// the player widget (MediaKitVideoPlayer) on screen — created once by
/// WatchScreen and handed to both, so the overlay and the player never need to know about each
/// other directly. Mirrors apps/frontend/src/routes/WatchPage.tsx's watchPartySync prop shape
/// (enabled/canControl/inboundState/onStateChange), just as a ChangeNotifier instead of React state.
class WatchPartySyncController extends ChangeNotifier {
  bool _enabled = false;
  bool _canControl = false;
  WatchPartySyncState? _inboundState;
  Future<void> Function(WatchPartySyncState state)? _broadcaster;

  // Android TV only: lets WatchPartyOverlay's TvPartyRail hand keyboard/D-pad focus back to the
  // player's chrome when Back is pressed while the rail has focus — see design.html's "Back always
  // walks up exactly one level: rail -> chrome -> exit player" rule. The player widgets use this as
  // their own root Focus node's `focusNode:` (instead of an implicit one) so this can actually
  // reach it; unused/harmless everywhere else.
  final tvChromeFocusNode = FocusNode(debugLabel: 'tv-chrome-anchor');

  bool get enabled => _enabled;
  // Whether *this* session currently drives playback for the party — true for the host's main
  // device, and for any guest's main device the host has granted control to. Not "is the host".
  bool get canControl => _canControl;
  WatchPartySyncState? get inboundState => _inboundState;

  @override
  void dispose() {
    tvChromeFocusNode.dispose();
    super.dispose();
  }

  /// Called by WatchPartyOverlay once connected, and again whenever control permission changes
  /// (a grant/revoke) — pass enabled:false/broadcaster:null on disconnect.
  void configure({
    required bool enabled,
    required bool canControl,
    Future<void> Function(WatchPartySyncState state)? broadcaster,
  }) {
    if (_enabled == enabled && _canControl == canControl && identical(_broadcaster, broadcaster)) return;
    _enabled = enabled;
    _canControl = canControl;
    _broadcaster = broadcaster;
    notifyListeners();
  }

  /// Called by WatchPartyOverlay when a sync-state broadcast arrives from whoever currently holds
  /// control (never from ourselves — the player already skips applying this while canControl is
  /// true, same guard as WatchPage.tsx's inbound-apply effect).
  void applyInbound(WatchPartySyncState state) {
    _inboundState = state;
    notifyListeners();
  }

  /// Called by the active player after a user-driven play/pause/seek/speed change, only while
  /// canControl is true (the player re-checks this itself before calling in, same as
  /// VideoPlayer.tsx's emitWatchPartyState guard).
  Future<void> broadcast(WatchPartySyncState state) async {
    final broadcaster = _broadcaster;
    if (!_enabled || !_canControl || broadcaster == null) return;
    await broadcaster(state);
  }
}
