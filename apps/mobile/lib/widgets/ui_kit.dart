import 'package:flutter/material.dart';
import '../theme/app_theme.dart';
import 'tv_focusable.dart';

/// Small shared pieces of the redesign's visual language — the skeleton/empty/error trio, the
/// section header, the chip row, the filmstrip divider and the badge. Kept in one file because
/// each is a dozen lines and they're always used together; anything with real behaviour (cards,
/// nav, sheets) lives in its own file.

/// A shimmering placeholder block. Always given the *real* dimensions of the thing it stands in
/// for, so the layout doesn't jump when content lands.
class Shimmer extends StatefulWidget {
  final double? width;
  final double? height;
  final double radius;
  final double? aspectRatio;

  const Shimmer({super.key, this.width, this.height, this.radius = AppRadius.sm, this.aspectRatio});

  @override
  State<Shimmer> createState() => _ShimmerState();
}

class _ShimmerState extends State<Shimmer> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1300),
  );

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Respecting reduced motion: a still block is a perfectly good skeleton.
    final reduced = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    if (reduced && _controller.isAnimating) {
      _controller.stop();
    } else if (!reduced && !_controller.isAnimating) {
      _controller.repeat();
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    Widget block = AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final t = _controller.value;
        return DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(widget.radius),
            gradient: LinearGradient(
              begin: Alignment(-1 - 2 * (1 - t), 0),
              end: Alignment(1 + 2 * t, 0),
              colors: const [AppColors.surface, AppColors.surfaceHover, AppColors.surface],
              stops: const [0.25, 0.5, 0.75],
            ),
          ),
          child: const SizedBox.expand(),
        );
      },
    );
    if (widget.aspectRatio != null) {
      block = AspectRatio(aspectRatio: widget.aspectRatio!, child: block);
    }
    return SizedBox(width: widget.width, height: widget.height, child: block);
  }
}

/// One card-shaped skeleton at the exact dimensions MediaCard renders at.
class CardSkeleton extends StatelessWidget {
  const CardSkeleton({super.key});

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Shimmer(aspectRatio: 16 / 9, radius: AppRadius.md),
        SizedBox(height: 8),
        Shimmer(height: 11, radius: 4),
        SizedBox(height: 6),
        Shimmer(width: 70, height: 10, radius: 4),
      ],
    );
  }
}

/// A rail of card skeletons, matching Rail's own geometry.
class RailSkeleton extends StatelessWidget {
  final String title;
  const RailSkeleton({super.key, this.title = ''});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 18, 16, 10),
          child: title.isEmpty
              ? const Shimmer(width: 150, height: 17, radius: 4)
              : Text(title, style: AppTheme.display(fontSize: 20)),
        ),
        SizedBox(
          height: 160,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            physics: const NeverScrollableScrollPhysics(),
            padding: const EdgeInsets.symmetric(horizontal: 16),
            itemCount: 5,
            separatorBuilder: (context, index) => const SizedBox(width: 12),
            itemBuilder: (context, index) => const SizedBox(width: 196, child: CardSkeleton()),
          ),
        ),
      ],
    );
  }
}

/// A grid of card skeletons at the live grid's column count.
class GridSkeleton extends StatelessWidget {
  final int columns;
  final int count;
  const GridSkeleton({super.key, required this.columns, this.count = 9});

  @override
  Widget build(BuildContext context) {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: count,
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: columns,
        crossAxisSpacing: 12,
        mainAxisSpacing: 18,
        childAspectRatio: 0.82,
      ),
      itemBuilder: (context, index) => const CardSkeleton(),
    );
  }
}

/// Empty state: one icon, one sentence, exactly one action. Centred text is allowed here (it's a
/// short empty state) but the surrounding pane stays full width.
class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String body;
  final String? actionLabel;
  final VoidCallback? onAction;

  const EmptyState({
    super.key,
    required this.icon,
    required this.title,
    required this.body,
    this.actionLabel,
    this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 48),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 360),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 56,
                height: 56,
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(AppRadius.lg),
                  border: Border.all(color: AppColors.dividerStrong),
                ),
                child: Icon(icon, color: AppColors.amber, size: 26),
              ),
              const SizedBox(height: 14),
              Text(
                title,
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 6),
              Text(
                body,
                textAlign: TextAlign.center,
                style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.5),
              ),
              if (actionLabel != null && onAction != null) ...[
                const SizedBox(height: 18),
                FilledButton(onPressed: onAction, child: Text(actionLabel!)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// Inline, retryable error card — never a dead end, never a bare exception string as the headline.
class ErrorRetry extends StatelessWidget {
  final String title;
  final Object? error;
  final VoidCallback onRetry;

  const ErrorRetry({super.key, required this.title, this.error, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.all(16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.dangerSoft,
        border: Border.all(color: AppColors.danger.withValues(alpha: 0.45)),
        borderRadius: BorderRadius.circular(AppRadius.md),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.error_outline, color: AppColors.danger, size: 22),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    color: AppColors.danger,
                    fontWeight: FontWeight.w700,
                    fontSize: 13,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _message,
                  style: const TextStyle(color: AppColors.foreground, fontSize: 12.5, height: 1.45),
                ),
                const SizedBox(height: 10),
                OutlinedButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh, size: 16),
                  label: const Text('Try again'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.foreground,
                    side: const BorderSide(color: AppColors.dividerStrong),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String get _message {
    final text = error?.toString() ?? '';
    if (text.isEmpty) return 'Check that the server is reachable, then try again.';
    return text.length > 180 ? '${text.substring(0, 180)}…' : text;
  }
}

/// Rail/section heading with an optional "See all" into the browse grid.
class SectionHeader extends StatelessWidget {
  final String title;
  final String? seeAllLabel;
  final VoidCallback? onSeeAll;
  final EdgeInsetsGeometry padding;

  const SectionHeader({
    super.key,
    required this.title,
    this.seeAllLabel,
    this.onSeeAll,
    this.padding = const EdgeInsets.fromLTRB(16, 18, 16, 10),
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          Expanded(child: Text(title, style: AppTheme.display(fontSize: 20))),
          if (onSeeAll != null)
            TvFocusable(
              borderRadius: BorderRadius.circular(AppRadius.pill),
              onTap: onSeeAll!,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
                child: Text(
                  seeAllLabel ?? 'See all',
                  style: const TextStyle(
                    color: AppColors.accent,
                    fontSize: 12.5,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The filmstrip sprocket divider — the one piece of Campfire motif kept from the old design.
/// Used sparingly (a section separator, never after every rail).
class FilmstripDivider extends StatelessWidget {
  const FilmstripDivider({super.key, this.margin = const EdgeInsets.symmetric(vertical: 20)});

  final EdgeInsetsGeometry margin;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: margin,
      height: 10,
      decoration: const BoxDecoration(
        border: Border(
          top: BorderSide(color: AppColors.divider),
          bottom: BorderSide(color: AppColors.divider),
        ),
      ),
      child: CustomPaint(painter: _FilmstripPainter(), child: const SizedBox.expand()),
    );
  }
}

class _FilmstripPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = AppColors.dividerStrong.withValues(alpha: 0.7);
    for (var x = 0.0; x < size.width; x += 14) {
      canvas.drawRect(Rect.fromLTWH(x, 1, 6, size.height - 2), paint);
    }
  }

  @override
  bool shouldRepaint(covariant _FilmstripPainter oldDelegate) => false;
}

/// A quality / container tag. Only ever built from a non-null value (see MediaMeta).
class MetaBadge extends StatelessWidget {
  final String label;
  final Color color;

  const MetaBadge({super.key, required this.label, this.color = AppColors.amber});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 3),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.6),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: AppColors.dividerStrong),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 9.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

/// A focusable filter chip. Material's FilterChip has no clearly visible D-pad focus ring on
/// these dark surfaces, so the chip row is built on TvFocusable like every other interactive
/// element here.
class CampfireChip extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  final IconData? icon;
  final int? count;

  const CampfireChip({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
    this.icon,
    this.count,
  });

  @override
  Widget build(BuildContext context) {
    return TvFocusable(
      borderRadius: BorderRadius.circular(AppRadius.pill),
      onTap: onTap,
      child: Semantics(
        button: true,
        selected: selected,
        label: label,
        child: Container(
          height: 36,
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: selected ? AppColors.accent : AppColors.bgElevated,
            borderRadius: BorderRadius.circular(AppRadius.pill),
            border: Border.all(color: selected ? AppColors.accent : AppColors.dividerStrong),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[
                Icon(icon, size: 15, color: selected ? AppColors.onAccent : AppColors.textSecondary),
                const SizedBox(width: 6),
              ],
              Text(
                count == null ? label : '$label ($count)',
                style: TextStyle(
                  color: selected ? AppColors.onAccent : AppColors.textSecondary,
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One row of [showOptionPicker].
class PickerOption<T> {
  final T value;
  final String label;
  final String? detail;

  const PickerOption({required this.value, required this.label, this.detail});
}

/// A list-of-options picker — used for sort order, the season picker and the player's track
/// menus. A bottom sheet on a phone and a centred dialog on desktop/TV, both built from plain
/// focusable rows with 50dp targets so a D-pad can walk them (a Material `PopupMenuButton`
/// anchored to a card is awkward with a remote, and its items have no visible focus ring on
/// these surfaces).
Future<T?> showOptionPicker<T>({
  required BuildContext context,
  required String title,
  required List<PickerOption<T>> options,
  T? selected,
}) {
  final wide = MediaQuery.sizeOf(context).width >= AppLayout.sidebarBreakpoint;

  Widget list(BuildContext sheetContext) => Column(
    mainAxisSize: MainAxisSize.min,
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
        child: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
      ),
      Flexible(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
          children: [
            for (final option in options)
              TvFocusable(
                autofocus: option.value == selected,
                borderRadius: BorderRadius.circular(AppRadius.sm),
                onTap: () => Navigator.of(sheetContext).pop(option.value),
                child: Container(
                  constraints: const BoxConstraints(minHeight: 50),
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              option.label,
                              style: const TextStyle(color: AppColors.foreground, fontSize: 14),
                            ),
                            if (option.detail != null)
                              Text(
                                option.detail!,
                                style: const TextStyle(
                                  color: AppColors.textTertiary,
                                  fontSize: 11.5,
                                ),
                              ),
                          ],
                        ),
                      ),
                      if (option.value == selected)
                        const Icon(Icons.check, size: 18, color: AppColors.accent),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    ],
  );

  if (wide) {
    return showDialog<T>(
      context: context,
      builder: (dialogContext) => Dialog(
        backgroundColor: AppColors.bgElevated,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.lg)),
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420, maxHeight: 520),
          child: list(dialogContext),
        ),
      ),
    );
  }

  return showModalBottomSheet<T>(
    context: context,
    backgroundColor: AppColors.bgElevated,
    showDragHandle: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(AppRadius.xl)),
    ),
    builder: (sheetContext) => SafeArea(top: false, child: list(sheetContext)),
  );
}

/// A password field with the eye show/hide toggle every password input in this app is required to
/// have (see the project's UI rules) — the button's accessible label flips between
/// "Show password" and "Hide password" so a screen reader announces the state, not just the icon.
class PasswordField extends StatefulWidget {
  final TextEditingController controller;
  final String label;
  final String? helperText;
  final String? errorText;
  final TextInputAction textInputAction;
  final ValueChanged<String>? onSubmitted;
  final bool autofillNewPassword;

  const PasswordField({
    super.key,
    required this.controller,
    this.label = 'Password',
    this.helperText,
    this.errorText,
    this.textInputAction = TextInputAction.done,
    this.onSubmitted,
    this.autofillNewPassword = false,
  });

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _visible = false;

  @override
  Widget build(BuildContext context) {
    final label = _visible ? 'Hide password' : 'Show password';
    return TextField(
      controller: widget.controller,
      obscureText: !_visible,
      autocorrect: false,
      enableSuggestions: false,
      autofillHints: [
        widget.autofillNewPassword ? AutofillHints.newPassword : AutofillHints.password,
      ],
      textInputAction: widget.textInputAction,
      onSubmitted: widget.onSubmitted,
      style: const TextStyle(color: AppColors.foreground),
      decoration: InputDecoration(
        labelText: widget.label,
        helperText: widget.helperText,
        errorText: widget.errorText,
        suffixIcon: IconButton(
          // The accessible name, not just the glyph, carries the state.
          tooltip: label,
          onPressed: () => setState(() => _visible = !_visible),
          icon: Icon(
            _visible ? Icons.visibility_off_outlined : Icons.visibility_outlined,
            color: AppColors.textSecondary,
            size: 21,
            semanticLabel: label,
          ),
        ),
      ),
    );
  }
}
