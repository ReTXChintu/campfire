import 'package:flutter/widgets.dart';
import 'party_sync_engine.dart';

/// Who this device is in the party's playback.
enum PartyPlaybackRole {
  /// Not in a party (or not connected yet).
  none,

  /// The leader: its playback is the party's truth. It announces every action and a heartbeat
  /// every few seconds, and never steers toward anyone else's heartbeat.
  leader,

  /// May act (play, pause, seek, tracks, episodes) — the host granted control — but follows the
  /// leader's heartbeats like everyone else between its own actions.
  controller,

  /// Follows. Playback controls are locked while "Keep me in sync" is on.
  follower,
}

/// The one channel between WatchPartyOverlay (which owns the LiveKit room, the roster and the
/// network) and MediaKitVideoPlayer (which owns playback). Created once by WatchScreen and handed
/// to both, so neither has to know about the other.
///
/// Inbound: the overlay hands over each accepted [PartyPlaybackState] via [applyInbound]; the
/// player reads [target]/[targetVersion] and steers with [PartySyncEngine].
/// Outbound: the player calls [announce] for actions and heartbeats; the overlay sends them.
/// Chrome: the player's top bar shows the party button with [memberCount]/[unreadChat] and calls
/// [openPanel] — so party UI lives *in* the player's own control row instead of floating over it.
class WatchPartySyncController extends ChangeNotifier {
  /// The party the route says we're in at mount time (`?party=`), set by WatchScreen before the
  /// player bootstraps — a player opened into a party starts where the *party* is, not at its own
  /// saved resume point.
  String? initialPartyId;

  bool _enabled = false;
  PartyPlaybackRole _role = PartyPlaybackRole.none;
  bool _following = true;
  ServerClock _clock = ServerClock();
  PartyPlaybackState? _target;
  int _targetVersion = 0;
  bool _announceOnReady = false;
  String? _partyId;
  Future<void> Function(PartyPlaybackState state)? _broadcaster;
  void Function(String fileId)? _onFollowFile;

  int _memberCount = 0;
  int _unreadChat = 0;
  VoidCallback? _openPanel;
  VoidCallback? _openStartOrJoin;
  SyncHealth _health = SyncHealth.synced;

  // Android TV only: lets WatchPartyOverlay's TvPartyRail hand D-pad focus back to the player's
  // chrome when Back is pressed on the rail (rail -> chrome -> exit player).
  final tvChromeFocusNode = FocusNode(debugLabel: 'tv-chrome-anchor');

  bool get enabled => _enabled;
  PartyPlaybackRole get role => _role;
  bool get isLeader => _role == PartyPlaybackRole.leader;

  /// Whether this device may drive playback (leader or granted controller).
  bool get canControl => _role == PartyPlaybackRole.leader || _role == PartyPlaybackRole.controller;

  /// "Keep me in sync" — off lets a follower pause/seek on their own without being pulled back.
  bool get following => _following;
  ServerClock get clock => _clock;
  PartyPlaybackState? get target => _target;
  int get targetVersion => _targetVersion;
  String? get partyId => _partyId;

  /// True once, for a leader whose party has no playback history yet: its own position (e.g. the
  /// resume point it already had) becomes the party's, rather than the empty party's 0:00.
  bool get announceOnReady => _announceOnReady;

  int get memberCount => _memberCount;
  int get unreadChat => _unreadChat;
  bool get hasPanel => _openPanel != null;
  SyncHealth get health => _health;

  @override
  void dispose() {
    tvChromeFocusNode.dispose();
    super.dispose();
  }

  /// Called by the overlay once connected, and whenever role/control changes. Pass
  /// `enabled: false` on disconnect.
  void configure({
    required bool enabled,
    required PartyPlaybackRole role,
    String? partyId,
    ServerClock? clock,
    Future<void> Function(PartyPlaybackState state)? broadcaster,
    void Function(String fileId)? onFollowFile,
  }) {
    final changed = _enabled != enabled || _role != role || _partyId != partyId;
    _enabled = enabled;
    _role = enabled ? role : PartyPlaybackRole.none;
    _partyId = enabled ? partyId : null;
    if (clock != null) _clock = clock;
    _broadcaster = broadcaster;
    _onFollowFile = onFollowFile;
    if (!enabled) {
      _target = null;
      _announceOnReady = false;
    }
    if (changed) notifyListeners();
  }

  /// The party chrome the player renders in its own top bar.
  void configureChrome({
    required int memberCount,
    required int unreadChat,
    VoidCallback? openPanel,
    VoidCallback? openStartOrJoin,
  }) {
    final changed = _memberCount != memberCount ||
        _unreadChat != unreadChat ||
        (_openPanel == null) != (openPanel == null) ||
        (_openStartOrJoin == null) != (openStartOrJoin == null);
    _memberCount = memberCount;
    _unreadChat = unreadChat;
    _openPanel = openPanel;
    _openStartOrJoin = openStartOrJoin;
    if (changed) notifyListeners();
  }

  /// The party button in the player's top bar: the panel when connected, start/join otherwise.
  void openPartyUi() {
    final open = _openPanel ?? _openStartOrJoin;
    open?.call();
  }

  void setFollowing(bool value) {
    if (_following == value) return;
    _following = value;
    // Rejoining sync snaps straight back to the party rather than drifting back over seconds.
    if (value && _target != null) {
      _target = _target!.copyWith(kind: PartyStateKind.action);
      _targetVersion++;
    }
    notifyListeners();
  }

  /// A state from the network, already accepted as fresh by the overlay.
  void applyInbound(PartyPlaybackState state, {bool announceOnReady = false}) {
    _target = state;
    _targetVersion++;
    _announceOnReady = announceOnReady;
    notifyListeners();
  }

  /// The leader-with-no-history case consumed: the player announced itself.
  void clearAnnounceOnReady() => _announceOnReady = false;

  /// Called by the player for each action (leader/controller) and heartbeat (leader).
  Future<void> announce(PartyPlaybackState state) async {
    final broadcaster = _broadcaster;
    if (!_enabled || !canControl || broadcaster == null) return;
    if (state.kind == PartyStateKind.heartbeat && !isLeader) return;
    // What we just did is now the target too, so a controller doesn't steer back to the
    // pre-action heartbeat it heard a moment ago.
    _target = state;
    await broadcaster(state);
  }

  /// The player found the party on a different episode — the overlay reopens us on it.
  void followFile(String fileId) => _onFollowFile?.call(fileId);

  /// The player's own view of how in-sync it is, for the roster pill the overlay broadcasts.
  void reportHealth(SyncHealth health) => _health = health;
}
