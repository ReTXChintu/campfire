import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../services/watch_party_service.dart';
import '../theme/app_theme.dart';

/// "Join a watch party" — lifted out of the old avatar popup menu that the redesign removes, and
/// kept as a first-class header action on Home plus a row in Profile.
///
/// Joining doesn't need a video open first: this looks up the party's own video and navigates
/// straight there. Starting a *new* party still needs something playing (see
/// WatchPartyOverlay's "Start Watch Party"), since a party is always tied to the current video.
class JoinPartyButton extends StatelessWidget {
  const JoinPartyButton({super.key});

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: const Icon(Icons.group_add_outlined, color: AppColors.foreground),
      tooltip: 'Join watch party',
      onPressed: () => promptJoinWatchParty(context),
    );
  }
}

Future<void> promptJoinWatchParty(BuildContext context) async {
  final controller = TextEditingController();
  final code = await showDialog<String>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      backgroundColor: AppColors.bgElevated,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.lg)),
      title: const Text('Join watch party', style: TextStyle(color: AppColors.foreground)),
      content: TextField(
        controller: controller,
        autofocus: true,
        style: const TextStyle(color: AppColors.foreground),
        decoration: const InputDecoration(
          labelText: 'Party code or invite link',
          hintText: '7F-QUILT',
          hintStyle: TextStyle(color: AppColors.textTertiary),
        ),
        onSubmitted: (value) => Navigator.of(dialogContext).pop(value),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(dialogContext).pop(controller.text),
          child: const Text('Join'),
        ),
      ],
    ),
  );
  if (code == null) return;

  final partyId = WatchPartyService.extractPartyCode(code);
  if (partyId.isEmpty) return;

  try {
    // Looks up the party's own video rather than assuming any video is already open — this is the
    // whole point of a home-screen join entry point (see WatchPartyOverlay's identical redirect
    // for the same reason when a pasted code turns out to belong to a *different* video than the
    // one currently playing).
    final party = await WatchPartyService.getByCode(partyId);
    if (!context.mounted) return;
    context.push('/watch/${party.fileId}?party=$partyId');
  } catch (_) {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text("Couldn't find that watch party — check the code and try again.")),
      );
    }
  }
}
