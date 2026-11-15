import 'package:flutter/foundation.dart';

/// Fires each time a player closes. Progress is saved by the player while you watch, but the
/// screens you return to (Home's cards, a series' episode list) fetched theirs before you started,
/// so without this they keep showing the old bar until a manual refresh.
class WatchEvents {
  WatchEvents._();

  /// Bumped once per closed player; listeners just reload.
  static final playerClosed = ValueNotifier<int>(0);

  static void notifyPlayerClosed() => playerClosed.value++;
}
