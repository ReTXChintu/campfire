import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../models/title_meta.dart';
import '../services/catalog_service.dart';

/// Opens the title's official trailer on YouTube. Takes no room until one is found.
class TrailerButton extends StatefulWidget {
  final TmdbRef tmdb;
  final EdgeInsets padding;

  const TrailerButton({super.key, required this.tmdb, this.padding = EdgeInsets.zero});

  @override
  State<TrailerButton> createState() => _TrailerButtonState();
}

class _TrailerButtonState extends State<TrailerButton> {
  String? _youtubeId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final id = await CatalogService.fetchTrailer(widget.tmdb);
      if (mounted) setState(() => _youtubeId = id);
    } catch (_) {
      // An older backend, or TMDb isn't answering: no trailer.
    }
  }

  @override
  Widget build(BuildContext context) {
    final id = _youtubeId;
    if (id == null) return const SizedBox.shrink();
    return Padding(
      padding: widget.padding,
      child: OutlinedButton.icon(
        icon: const Icon(Icons.movie_outlined, size: 18),
        label: const Text('Trailer'),
        onPressed: () async {
          try {
            await launchUrl(
              Uri.parse('https://www.youtube.com/watch?v=$id'),
              mode: LaunchMode.externalApplication,
            );
          } catch (_) {
            // Nothing on this device opens links.
          }
        },
      ),
    );
  }
}
