import 'package:flutter/material.dart';

import '../models/media_request.dart';
import '../theme/app_theme.dart';
import 'authed_network_image.dart';

/// A request's one visual, in the order it's worth trusting: the reference image the requester
/// uploaded (behind the backend's Bearer-auth route, hence [AuthedNetworkImage]), then the poster
/// the TMDb link lookup found (a plain public URL), then a lettered placeholder — there is no
/// catalog thumbnail to fall back on, because the whole point is that we don't have the title yet.
class RequestPoster extends StatelessWidget {
  final String title;
  final String? refImagePath;
  final String? posterUrl;
  final double width;
  final double aspectRatio;

  const RequestPoster({
    super.key,
    required this.title,
    this.refImagePath,
    this.posterUrl,
    this.width = 64,
    this.aspectRatio = 2 / 3,
  });

  RequestPoster.of(MediaRequest request, {super.key, this.width = 64, this.aspectRatio = 2 / 3})
      : title = request.title,
        refImagePath = request.refImagePath,
        posterUrl = request.refMeta?.posterUrl;

  RequestPoster.ofAdmin(
    AdminMediaRequest request, {
    super.key,
    this.width = 64,
    this.aspectRatio = 2 / 3,
  })  : title = request.title,
        refImagePath = request.refImagePath,
        posterUrl = request.refMeta?.posterUrl;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: width,
      child: AspectRatio(
        aspectRatio: aspectRatio,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(8),
          child: DecoratedBox(
            decoration: BoxDecoration(
              color: AppColors.surface,
              border: Border.all(color: AppColors.divider),
            ),
            child: _image(),
          ),
        ),
      ),
    );
  }

  Widget _image() {
    if (refImagePath != null) {
      return AuthedNetworkImage(path: refImagePath!, fit: BoxFit.cover);
    }
    if (posterUrl != null && posterUrl!.isNotEmpty) {
      return Image.network(
        posterUrl!,
        fit: BoxFit.cover,
        errorBuilder: (context, error, stackTrace) => _Initial(title: title),
      );
    }
    return _Initial(title: title);
  }
}

class _Initial extends StatelessWidget {
  final String title;
  const _Initial({required this.title});

  @override
  Widget build(BuildContext context) {
    // Strips a leading article so "The Fen Road" shows F, not T — the prototype's own rule.
    final stripped = title.replaceFirst(RegExp(r'^(the|a|an)\s+', caseSensitive: false), '').trim();
    final source = stripped.isNotEmpty ? stripped : title;
    final letter = source.isNotEmpty ? source.substring(0, 1).toUpperCase() : '?';
    return Container(
      color: AppColors.surface,
      alignment: Alignment.center,
      child: Text(letter, style: AppTheme.display(fontSize: 28, color: AppColors.textTertiary)),
    );
  }
}
