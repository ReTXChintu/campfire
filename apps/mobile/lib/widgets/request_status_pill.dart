import 'package:flutter/material.dart';

import '../models/media_request.dart';
import '../theme/app_theme.dart';

/// One colour per status, shared by the board card, the "my requests" timeline and the admin
/// list so a status reads the same everywhere: Ember for a fresh ask, Gold once it's planned,
/// a cool blue while it's being sourced, Live green when it lands, Ash-red when it's declined.
Color requestStatusColor(RequestStatus status) {
  switch (status) {
    case RequestStatus.newRequest:
      return AppColors.accent;
    case RequestStatus.planned:
      return AppColors.amber;
    case RequestStatus.sourcing:
      return const Color(0xFF7AA7D9);
    case RequestStatus.added:
      return AppColors.live;
    case RequestStatus.declined:
      return AppColors.danger;
  }
}

class RequestStatusPill extends StatelessWidget {
  final RequestStatus status;
  final bool dense;

  const RequestStatusPill(this.status, {super.key, this.dense = false});

  @override
  Widget build(BuildContext context) {
    final color = requestStatusColor(status);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: dense ? 7 : 9, vertical: dense ? 2 : 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        border: Border.all(color: color.withValues(alpha: 0.55)),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        status.label.toUpperCase(),
        style: TextStyle(
          color: color,
          fontSize: dense ? 9.5 : 10.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
        ),
      ),
    );
  }
}

/// New → Planned → Sourcing → Added, with Declined as the off-ramp rather than a fifth step.
/// Rendered from `status` alone, which is exactly why the backend keeps the ladder small.
class RequestStatusTimeline extends StatelessWidget {
  final RequestStatus status;

  const RequestStatusTimeline(this.status, {super.key});

  @override
  Widget build(BuildContext context) {
    final steps = status == RequestStatus.declined
        ? const [RequestStatus.newRequest, RequestStatus.declined]
        : RequestStatus.progression;
    final currentIndex = steps.indexOf(status);

    return Row(
      children: [
        for (var i = 0; i < steps.length; i++)
          Expanded(
            child: _Step(
              label: steps[i].label,
              first: i == 0,
              last: i == steps.length - 1,
              state: steps[i] == RequestStatus.declined && status == RequestStatus.declined
                  ? _StepState.off
                  : i < currentIndex
                      ? _StepState.done
                      : i == currentIndex
                          ? _StepState.current
                          : _StepState.todo,
            ),
          ),
      ],
    );
  }
}

enum _StepState { done, current, todo, off }

class _Step extends StatelessWidget {
  final String label;
  final bool first;
  final bool last;
  final _StepState state;

  const _Step({required this.label, required this.first, required this.last, required this.state});

  @override
  Widget build(BuildContext context) {
    final (dotColor, textColor) = switch (state) {
      _StepState.done => (AppColors.live, AppColors.textSecondary),
      _StepState.current => (AppColors.accent, AppColors.accent),
      _StepState.todo => (AppColors.dividerStrong, AppColors.textTertiary),
      _StepState.off => (AppColors.danger, AppColors.danger),
    };

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          height: 12,
          child: Row(
            children: [
              Expanded(child: _Connector(visible: !first)),
              Container(
                width: 11,
                height: 11,
                decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
              ),
              Expanded(child: _Connector(visible: !last)),
            ],
          ),
        ),
        const SizedBox(height: 5),
        Text(
          label.toUpperCase(),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: textColor,
            fontSize: 9.5,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.5,
          ),
        ),
      ],
    );
  }
}

class _Connector extends StatelessWidget {
  final bool visible;
  const _Connector({required this.visible});

  @override
  Widget build(BuildContext context) => Container(
    height: 1,
    color: visible ? AppColors.dividerStrong : Colors.transparent,
  );
}

/// "7 people want this" / "You and 2 others want this" — the board's social proof, and the reason
/// the dedupe hint in the form is worth offering at all.
String wantCountLabel(int count, {required bool youWantIt}) {
  if (count <= 0) return 'Nobody else yet';
  if (youWantIt) {
    final others = count - 1;
    if (others <= 0) return 'Just you so far';
    return 'You and $others ${others == 1 ? "other" : "others"} want this';
  }
  return '$count ${count == 1 ? "person wants" : "people want"} this';
}
