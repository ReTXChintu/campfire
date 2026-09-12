import 'package:flutter/material.dart';
import 'package:livekit_client/livekit_client.dart';

/// LiveKit's own reserved topic for its first-party chat feature (mirrors what
/// apps/frontend/src/components/WatchPartyChat.tsx's useChat() sends under) — using the same topic
/// is what makes mobile and web chat interoperate in the same room.
const _chatTopic = 'lk.chat';

class _ChatMessage {
  final String senderIdentity;
  final String senderName;
  final String text;
  final DateTime receivedAt;
  const _ChatMessage({
    required this.senderIdentity,
    required this.senderName,
    required this.text,
    required this.receivedAt,
  });
}

/// Text chat over the LiveKit room's text-stream channel — self-contained (registers/unregisters
/// its own stream handler), so it can be dropped into WatchPartyOverlay without that widget needing
/// to know anything about the chat wire protocol.
class WatchPartyChat extends StatefulWidget {
  final Room room;

  const WatchPartyChat({super.key, required this.room});

  @override
  State<WatchPartyChat> createState() => _WatchPartyChatState();
}

class _WatchPartyChatState extends State<WatchPartyChat> {
  final List<_ChatMessage> _messages = [];
  final _draftController = TextEditingController();
  final _scrollController = ScrollController();
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    widget.room.registerTextStreamHandler(_chatTopic, _onTextStream);
  }

  @override
  void dispose() {
    widget.room.unregisterTextStreamHandler(_chatTopic);
    _draftController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _onTextStream(TextStreamReader reader, String participantIdentity) async {
    final text = await reader.readAll();
    if (!mounted) return;
    final sender = widget.room.remoteParticipants.values
        .where((p) => p.identity == participantIdentity)
        .map((p) => p.name.isNotEmpty ? p.name : p.identity)
        .firstOrNull;
    setState(() {
      _messages.add(
        _ChatMessage(
          senderIdentity: participantIdentity,
          senderName: sender ?? 'Guest',
          text: text,
          receivedAt: DateTime.now(),
        ),
      );
    });
    _scrollToBottom();
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 150),
        curve: Curves.easeOut,
      );
    });
  }

  Future<void> _send() async {
    final text = _draftController.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    _draftController.clear();
    try {
      await widget.room.localParticipant?.sendText(text, options: SendTextOptions(topic: _chatTopic));
      final localParticipant = widget.room.localParticipant;
      if (localParticipant != null && mounted) {
        setState(() {
          _messages.add(
            _ChatMessage(
              senderIdentity: localParticipant.identity,
              senderName: 'You',
              text: text,
              receivedAt: DateTime.now(),
            ),
          );
        });
        _scrollToBottom();
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          height: 160,
          child: _messages.isEmpty
              ? const Center(
                  child: Text('No chat yet.', style: TextStyle(color: Colors.white38, fontSize: 12)),
                )
              : ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  itemCount: _messages.length,
                  itemBuilder: (context, index) {
                    final message = _messages[index];
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 3),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            message.senderName,
                            style: const TextStyle(color: Colors.white54, fontSize: 11),
                          ),
                          Text(
                            message.text,
                            style: const TextStyle(color: Colors.white, fontSize: 13),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _draftController,
                style: const TextStyle(color: Colors.white, fontSize: 13),
                decoration: const InputDecoration(
                  hintText: 'Say something...',
                  hintStyle: TextStyle(color: Colors.white38),
                  isDense: true,
                  contentPadding: EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                  border: OutlineInputBorder(),
                ),
                onSubmitted: (_) => _send(),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.send, color: Colors.white, size: 20),
              onPressed: _sending ? null : _send,
            ),
          ],
        ),
      ],
    );
  }
}
