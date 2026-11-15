import 'package:flutter/material.dart';

import '../services/party_chat_controller.dart';
import '../theme/app_theme.dart';

/// The party conversation. A view over [PartyChatController], which the overlay owns for as long
/// as the room is connected — closing the panel no longer loses anything (see that class).
///
/// [expand] fills whatever height the parent gives it (the docked side panel); otherwise it takes
/// a fixed band (the TV rail, a bottom sheet).
class WatchPartyChat extends StatefulWidget {
  final PartyChatController chat;
  final bool expand;

  const WatchPartyChat({super.key, required this.chat, this.expand = false});

  @override
  State<WatchPartyChat> createState() => _WatchPartyChatState();
}

class _WatchPartyChatState extends State<WatchPartyChat> {
  final _draft = TextEditingController();
  final _scroll = ScrollController();
  bool _sending = false;
  bool _failed = false;
  int _lastCount = 0;

  @override
  void initState() {
    super.initState();
    widget.chat.addListener(_onChat);
    widget.chat.panelOpen = true;
    _lastCount = widget.chat.messages.length;
    WidgetsBinding.instance.addPostFrameCallback((_) => _jumpToEnd());
  }

  @override
  void didUpdateWidget(WatchPartyChat oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (!identical(oldWidget.chat, widget.chat)) {
      oldWidget.chat.removeListener(_onChat);
      widget.chat.addListener(_onChat);
      widget.chat.panelOpen = true;
    }
  }

  @override
  void dispose() {
    widget.chat.removeListener(_onChat);
    widget.chat.panelOpen = false;
    _draft.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _onChat() {
    if (!mounted) return;
    final count = widget.chat.messages.length;
    setState(() {});
    if (count != _lastCount) {
      _lastCount = count;
      WidgetsBinding.instance.addPostFrameCallback((_) => _animateToEnd());
    }
  }

  void _jumpToEnd() {
    if (_scroll.hasClients) _scroll.jumpTo(_scroll.position.maxScrollExtent);
  }

  void _animateToEnd() {
    if (!_scroll.hasClients) return;
    _scroll.animateTo(
      _scroll.position.maxScrollExtent,
      duration: const Duration(milliseconds: 160),
      curve: Curves.easeOut,
    );
  }

  Future<void> _send() async {
    final text = _draft.text;
    if (text.trim().isEmpty || _sending) return;
    setState(() {
      _sending = true;
      _failed = false;
    });
    final ok = await widget.chat.send(text);
    if (!mounted) return;
    setState(() {
      _sending = false;
      _failed = !ok;
    });
    if (ok) _draft.clear();
  }

  @override
  Widget build(BuildContext context) {
    final messages = widget.chat.messages;
    final list = messages.isEmpty
        ? const Center(
            child: Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: Text(
                'No messages yet. Say hi.',
                style: TextStyle(color: AppColors.textTertiary, fontSize: 12.5),
              ),
            ),
          )
        : ListView.builder(
            controller: _scroll,
            padding: const EdgeInsets.symmetric(vertical: 4),
            itemCount: messages.length,
            itemBuilder: (context, index) {
              final m = messages[index];
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 4),
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: '${m.mine ? 'You' : m.senderName}  ',
                        style: TextStyle(
                          color: m.mine ? AppColors.amber : AppColors.foreground,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      TextSpan(text: m.text),
                    ],
                  ),
                  style: const TextStyle(color: AppColors.textSecondary, fontSize: 13, height: 1.35),
                ),
              );
            },
          );

    final input = Row(
      children: [
        Expanded(
          child: TextField(
            controller: _draft,
            style: const TextStyle(color: AppColors.foreground, fontSize: 14),
            textInputAction: TextInputAction.send,
            onSubmitted: (_) => _send(),
            decoration: InputDecoration(
              hintText: 'Say something…',
              isDense: true,
              filled: true,
              fillColor: AppColors.surface,
              contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadius.sm),
                borderSide: const BorderSide(color: AppColors.dividerStrong),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadius.sm),
                borderSide: const BorderSide(color: AppColors.dividerStrong),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppRadius.sm),
                borderSide: const BorderSide(color: AppColors.accent),
              ),
            ),
          ),
        ),
        const SizedBox(width: 8),
        SizedBox(
          height: 44,
          width: 48,
          child: FilledButton(
            style: FilledButton.styleFrom(padding: EdgeInsets.zero),
            onPressed: _sending ? null : _send,
            child: _sending
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2, color: AppColors.onAccent),
                  )
                : const Icon(Icons.send, size: 18, semanticLabel: 'Send'),
          ),
        ),
      ],
    );

    return Column(
      mainAxisSize: widget.expand ? MainAxisSize.max : MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.expand) Expanded(child: list) else SizedBox(height: 150, child: list),
        if (_failed)
          const Padding(
            padding: EdgeInsets.only(bottom: 6),
            child: Text(
              "Couldn't send — check your connection and try again.",
              style: TextStyle(color: AppColors.danger, fontSize: 11.5),
            ),
          ),
        const SizedBox(height: 6),
        input,
      ],
    );
  }
}
