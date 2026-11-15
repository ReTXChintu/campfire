import 'package:flutter/material.dart';
import '../models/title_meta.dart';
import '../theme/app_theme.dart';
import 'authed_network_image.dart';

/// TMDb's score, as a star and a number. An empty box when there is no score, so callers can put
/// it in a row without checking first.
class RatingChip extends StatelessWidget {
  final TmdbRating? rating;
  final double fontSize;

  const RatingChip({super.key, required this.rating, this.fontSize = 12.5});

  @override
  Widget build(BuildContext context) {
    final rating = this.rating;
    if (rating == null) return const SizedBox.shrink();
    return Semantics(
      label: '${rating.label} out of 10 on TMDb',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.star_rounded, size: fontSize + 3, color: AppColors.amber),
          const SizedBox(width: 3),
          Text(
            rating.label,
            style: TextStyle(color: AppColors.foreground, fontSize: fontSize, fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// The age rating, boxed the way a certificate is printed.
class CertificateChip extends StatelessWidget {
  final String? certificate;
  const CertificateChip({super.key, required this.certificate});

  @override
  Widget build(BuildContext context) {
    final certificate = this.certificate;
    if (certificate == null || certificate.isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        border: Border.all(color: AppColors.dividerStrong),
        borderRadius: BorderRadius.circular(3),
      ),
      child: Text(
        certificate,
        style: const TextStyle(color: AppColors.foreground, fontSize: 11, fontWeight: FontWeight.w700),
      ),
    );
  }
}

/// The line of facts under a title — score, year, certificate, runtime, genres — showing only what
/// TMDb actually knows, dot-separated. [extra] takes facts the library knows rather than TMDb
/// (how many seasons are actually here, for instance). Nothing at all when there is nothing.
class MetaLine extends StatelessWidget {
  final TitleMeta meta;
  final List<String> extra;

  const MetaLine({super.key, required this.meta, this.extra = const []});

  @override
  Widget build(BuildContext context) {
    const style = TextStyle(color: AppColors.textSecondary, fontSize: 12.5);
    final parts = <Widget>[
      if (meta.rating != null) RatingChip(rating: meta.rating),
      if (meta.year != null) Text('${meta.year}', style: style),
      if (meta.certificate != null) CertificateChip(certificate: meta.certificate),
      if (runtimeLabel(meta.runtimeMinutes) != null) Text(runtimeLabel(meta.runtimeMinutes)!, style: style),
      if (meta.genres.isNotEmpty) Text(meta.genres.join(', '), style: style),
      for (final item in extra) Text(item, style: style),
    ];
    if (parts.isEmpty) return const SizedBox.shrink();

    return Wrap(
      spacing: 8,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        for (var i = 0; i < parts.length; i++)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (i > 0) ...[
                const Text('·', style: TextStyle(color: AppColors.textTertiary, fontSize: 12.5)),
                const SizedBox(width: 8),
              ],
              parts[i],
            ],
          ),
      ],
    );
  }
}

/// The billed cast, as a row that scrolls sideways. Nothing when the title isn't matched or TMDb
/// lists nobody, so a page without a cast has no empty section on it.
class CastRow extends StatelessWidget {
  final List<CastMember> cast;
  final double gutter;

  const CastRow({super.key, required this.cast, required this.gutter});

  @override
  Widget build(BuildContext context) {
    if (cast.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: EdgeInsets.fromLTRB(gutter, 22, gutter, 10),
          child: Text('Cast', style: AppTheme.display(fontSize: 20)),
        ),
        SizedBox(
          height: 206,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.symmetric(horizontal: gutter),
            itemCount: cast.length,
            separatorBuilder: (_, _) => const SizedBox(width: 12),
            itemBuilder: (context, index) => _CastCard(member: cast[index]),
          ),
        ),
      ],
    );
  }
}

class _CastCard extends StatelessWidget {
  final CastMember member;
  const _CastCard({required this.member});

  String get _initials => member.name
      .split(RegExp(r'\s+'))
      .take(2)
      .map((part) => part.isEmpty ? '' : part[0].toUpperCase())
      .join();

  @override
  Widget build(BuildContext context) {
    final imagePath = member.imagePath;
    return SizedBox(
      width: 104,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(10),
            child: AspectRatio(
              aspectRatio: 2 / 3,
              child: Container(
                color: AppColors.surface,
                child: imagePath == null
                    ? Center(
                        child: Text(
                          _initials,
                          style: AppTheme.display(fontSize: 22).copyWith(color: Colors.white24),
                        ),
                      )
                    : AuthedNetworkImage(path: imagePath),
              ),
            ),
          ),
          const SizedBox(height: 6),
          Text(
            member.name,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: AppColors.foreground,
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              height: 1.25,
            ),
          ),
          if (member.character != null)
            Text(
              member.character!,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: AppColors.textTertiary, fontSize: 11, height: 1.3),
            ),
        ],
      ),
    );
  }
}

/// A title's own wordmark, with the title set in type as the fallback.
///
/// The backend 404s `?shape=logo` for anything it has no wordmark for, so a failure is the normal
/// case rather than an error — and the text shows until the image arrives, because a heading that
/// appears a beat late reads as a bug while one replaced by the real logo does not.
class TitleWordmark extends StatelessWidget {
  final String? path;
  final String title;
  final TextStyle textStyle;
  final double maxHeight;

  const TitleWordmark({
    super.key,
    required this.path,
    required this.title,
    required this.textStyle,
    this.maxHeight = 92,
  });

  @override
  Widget build(BuildContext context) {
    final path = this.path;
    if (path == null) return Text(title, style: textStyle);
    return ConstrainedBox(
      constraints: BoxConstraints(maxHeight: maxHeight),
      child: AuthedNetworkImage(
        path: path,
        fit: BoxFit.contain,
        alignment: Alignment.centerLeft,
        semanticLabel: title,
        placeholder: Text(title, style: textStyle),
        errorWidget: Text(title, style: textStyle),
      ),
    );
  }
}
