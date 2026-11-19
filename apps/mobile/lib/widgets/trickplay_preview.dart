import 'package:flutter/material.dart';
import '../config.dart';
import '../services/api_client.dart';
import '../services/media_headers.dart';
import 'player_chrome.dart' show formatPlayerTime;

/// A video's seek-bar previews — see apps/backend/src/lib/trickplay.ts. Frame i shows the video at
/// i × [interval] seconds, laid out [columns] × [rows] to a sheet.
class TrickplayManifest {
  final int interval;
  final int tileWidth;
  final int tileHeight;
  final int columns;
  final int rows;
  final int count;
  final int sheets;

  const TrickplayManifest({
    required this.interval,
    required this.tileWidth,
    required this.tileHeight,
    required this.columns,
    required this.rows,
    required this.count,
    required this.sheets,
  });

  static TrickplayManifest? tryParse(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    int? n(String k) => (json[k] as num?)?.toInt();
    final interval = n('interval'), w = n('tileWidth'), h = n('tileHeight');
    final cols = n('columns'), rows = n('rows'), count = n('count'), sheets = n('sheets');
    if ([interval, w, h, cols, rows, count, sheets].any((v) => v == null || v <= 0)) return null;
    return TrickplayManifest(
      interval: interval!,
      tileWidth: w!,
      tileHeight: h!,
      columns: cols!,
      rows: rows!,
      count: count!,
      sheets: sheets!,
    );
  }

  /// The frame nearest before [seconds]: which sheet, and its column and row on it.
  ({int sheet, int column, int row}) tileAt(double seconds) {
    final i = (seconds / interval).floor().clamp(0, count - 1);
    final perSheet = columns * rows;
    final within = i % perSheet;
    return (sheet: i ~/ perSheet, column: within % columns, row: within ~/ columns);
  }
}

/// The headers the sheet images need.
Future<Map<String, String>> trickplayHeaders() => authHeaders();

/// The ready manifest, or null when there is none (yet). The first ask queues the previews on the
/// backend, so a video's first play usually has none and every later play does.
Future<({TrickplayManifest? manifest, bool pending})> fetchTrickplay(String fileId) async {
  try {
    final data = await ApiClient.get('/api/trickplay/$fileId');
    if (data is Map<String, dynamic>) {
      final manifest = TrickplayManifest.tryParse(data['manifest']);
      final status = data['status'];
      return (manifest: manifest, pending: manifest == null && (status == 'queued' || status == 'processing'));
    }
  } catch (_) {
    // Failed, switched off, or an older backend without the route: no previews, nothing more.
  }
  return (manifest: null, pending: false);
}

/// One preview frame cut out of its sheet, with the time under it — what floats above the scrub
/// bar while dragging (and, with a mouse, while hovering).
class TrickplayPreview extends StatelessWidget {
  final String fileId;
  final TrickplayManifest manifest;
  final double seconds;
  final double width;

  /// The auth headers for the sheets, looked up once by the player.
  final Map<String, String> headers;

  const TrickplayPreview({
    super.key,
    required this.fileId,
    required this.manifest,
    required this.seconds,
    required this.headers,
    this.width = 176,
  });

  @override
  Widget build(BuildContext context) {
    final tile = manifest.tileAt(seconds);
    final scale = width / manifest.tileWidth;
    final height = manifest.tileHeight * scale;
    return Container(
      padding: const EdgeInsets.all(2),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.9),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white24),
        boxShadow: const [BoxShadow(color: Color(0x80000000), blurRadius: 12)],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: SizedBox(
              width: width,
              height: height,
              child: OverflowBox(
                alignment: Alignment.topLeft,
                minWidth: 0,
                minHeight: 0,
                maxWidth: double.infinity,
                maxHeight: double.infinity,
                child: Transform.translate(
                  offset: Offset(-tile.column * width, -tile.row * height),
                  child: Image.network(
                    '$apiBaseUrl/api/trickplay/$fileId/sheet/${tile.sheet}',
                    headers: headers,
                    width: manifest.columns * width,
                    height: manifest.rows * height,
                    fit: BoxFit.fill,
                    filterQuality: FilterQuality.medium,
                    // Keeps the last frame up while the next sheet loads, instead of a flash.
                    gaplessPlayback: true,
                    errorBuilder: (_, _, _) => const ColoredBox(color: Colors.black),
                  ),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 4),
            child: Text(
              formatPlayerTime(Duration(milliseconds: (seconds * 1000).round())),
              style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}
