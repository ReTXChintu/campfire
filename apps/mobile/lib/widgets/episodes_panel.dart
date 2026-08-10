import 'package:flutter/material.dart';
import '../models/catalog.dart';
import '../theme/app_theme.dart';

class EpisodesPanel extends StatelessWidget {
  final List<EpisodeRef> episodes;
  final Map<String, EpisodeProgress> progressByFileId;
  final String currentFileId;
  final ValueChanged<String> onSelect;
  final VoidCallback onClose;

  const EpisodesPanel({
    super.key,
    required this.episodes,
    required this.progressByFileId,
    required this.currentFileId,
    required this.onSelect,
    required this.onClose,
  });

  @override
  Widget build(BuildContext context) {
    return Positioned.fill(
      child: Row(
        children: [
          Expanded(child: GestureDetector(onTap: onClose, child: Container(color: Colors.black54))),
          Container(
            width: 300,
            color: const Color(0xF2141414),
            child: SafeArea(
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        const Expanded(
                          child: Text('Episodes', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w600)),
                        ),
                        IconButton(icon: const Icon(Icons.close, color: Colors.white70), onPressed: onClose),
                      ],
                    ),
                  ),
                  Expanded(
                    child: ListView.builder(
                      itemCount: episodes.length,
                      itemBuilder: (context, index) {
                        final episode = episodes[index];
                        final progress = progressByFileId[episode.id];
                        final isCurrent = episode.id == currentFileId;
                        return ListTile(
                          onTap: () {
                            onClose();
                            if (!isCurrent) onSelect(episode.id);
                          },
                          tileColor: isCurrent ? Colors.white.withValues(alpha: 0.1) : null,
                          leading: Text('${index + 1}', style: const TextStyle(color: Colors.white38)),
                          title: Text(
                            episode.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(color: isCurrent ? Colors.white : Colors.white.withValues(alpha: 0.8), fontSize: 13),
                          ),
                          trailing: progress == null
                              ? null
                              : Text(
                                  progress.completed ? 'Watched' : 'In progress',
                                  style: TextStyle(
                                    color: progress.completed ? AppColors.live : Colors.white38,
                                    fontSize: 11,
                                  ),
                                ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
