import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart';

class _CameraTile {
  final String identity;
  final String name;
  final VideoTrack track;
  const _CameraTile({required this.identity, required this.name, required this.track});
}

/// Camera tiles for whoever currently has their camera on, mirroring
/// apps/frontend/src/components/WatchPartyVideoGrid.tsx — renders nothing when nobody does, so a
/// voice-only party (camera starts off by default) doesn't reserve empty video space.
class WatchPartyVideoGrid extends StatelessWidget {
  final Room room;

  const WatchPartyVideoGrid({super.key, required this.room});

  List<_CameraTile> _tiles() {
    final tiles = <_CameraTile>[];
    final local = room.localParticipant;
    final localTrack = local?.getTrackPublicationBySource(TrackSource.camera)?.track;
    if (local != null && localTrack is VideoTrack) {
      tiles.add(_CameraTile(identity: local.identity, name: 'You', track: localTrack as VideoTrack));
    }
    for (final participant in room.remoteParticipants.values) {
      final track = participant.getTrackPublicationBySource(TrackSource.camera)?.track;
      if (track is VideoTrack) {
        tiles.add(
          _CameraTile(
            identity: participant.identity,
            name: participant.name.isNotEmpty ? participant.name : 'Guest',
            track: track as VideoTrack,
          ),
        );
      }
    }
    return tiles;
  }

  @override
  Widget build(BuildContext context) {
    final tiles = _tiles();
    if (tiles.isEmpty) return const SizedBox.shrink();

    return SizedBox(
      height: 110,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: tiles.length,
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemBuilder: (context, index) {
          final tile = tiles[index];
          return ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: SizedBox(
              width: 140,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ColoredBox(color: Colors.black),
                  VideoTrackRenderer(tile.track, fit: VideoViewFit.cover),
                  Positioned(
                    left: 4,
                    bottom: 4,
                    child: Text(
                      tile.name,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        shadows: [Shadow(blurRadius: 3, color: Colors.black)],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
