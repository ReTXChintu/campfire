import 'dart:async';
import 'dart:convert';
import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_inappwebview/flutter_inappwebview.dart';
import 'package:window_manager/window_manager.dart';
import '../config.dart';
import '../models/catalog.dart';
import '../platform_info.dart';
import '../services/catalog_service.dart';
import '../theme/app_theme.dart';

/// Nothing at all after this long means the provider can't be reached from here.
const _loadTimeout = Duration(seconds: 12);
const _saveEvery = Duration(seconds: 10);

final _youtubeHost = RegExp(r'^www\.youtube(-nocookie)?\.com$');
bool _isZoryva(String host) => host == 'zoryva.me' || host == 'www.zoryva.me';

/// A Zoryva player starts where the viewer left off (`startAt`); every other address is as it is.
String zoryvaUrlAt(String url, double positionSeconds) {
  if (!positionSeconds.isFinite || positionSeconds < 3) return url;
  final parsed = Uri.tryParse(url);
  if (parsed == null || !_isZoryva(parsed.host)) return url;
  return parsed.replace(queryParameters: {...parsed.queryParameters, 'startAt': '${positionSeconds.floor()}'}).toString();
}

/// YouTube only reports errors to a page that asks for its API.
String _withApi(String url) {
  final u = Uri.tryParse(url);
  if (u == null || !_youtubeHost.hasMatch(u.host)) return url;
  return u.replace(queryParameters: {...u.queryParameters, 'enablejsapi': '1', 'origin': Uri.parse(webBaseUrl).origin}).toString();
}

String _attr(String value) =>
    value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/// The page the web view loads: the player in one full-size frame with the attributes its embed code
/// gave it — the same sandbox the web app applies — and a script passing the frame's messages on.
String playerPage(String url, PlayerFrame look) {
  final src = _withApi(url);
  final host = Uri.tryParse(src)?.host ?? '';
  final kind = _youtubeHost.hasMatch(host) ? 'youtube' : (host == 'player.vimeo.com' ? 'vimeo' : 'other');
  return '''<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style>
</head><body>
<iframe id="f" src="${_attr(src)}" allow="${_attr(look.allow)}"${look.allowFullscreen ? ' allowfullscreen' : ''} sandbox="${_attr(look.sandbox)}" referrerpolicy="${_attr(look.referrerPolicy)}"></iframe>
<script>
(function(){
  var f = document.getElementById('f');
  var origin = ${jsonEncode(Uri.tryParse(src)?.origin ?? '')};
  var kind = ${jsonEncode(kind)};
  var queue = [];
  var ready = false;
  function send(name, payload){
    var bridge = window.flutter_inappwebview;
    if (ready && bridge && bridge.callHandler) bridge.callHandler(name, payload); else queue.push([name, payload]);
  }
  function flush(){
    ready = true;
    var bridge = window.flutter_inappwebview;
    while (queue.length && bridge && bridge.callHandler) { var m = queue.shift(); bridge.callHandler(m[0], m[1]); }
  }
  window.addEventListener('flutterInAppWebViewPlatformReady', flush);
  if (window.flutter_inappwebview && window.flutter_inappwebview.callHandler) flush();
  window.addEventListener('message', function(e){
    if (e.source !== f.contentWindow) return;
    var d = e.data;
    try { send('message', { origin: e.origin, data: typeof d === 'string' ? d : JSON.stringify(d) }); } catch (_) {}
  });
  f.addEventListener('load', function(){
    send('loaded', null);
    var post = function(m){ try { f.contentWindow.postMessage(JSON.stringify(m), origin); } catch (_) {} };
    if (kind === 'youtube') {
      post({ event: 'listening', id: 1, channel: 'widget' });
      post({ event: 'command', func: 'addEventListener', args: ['onError'], id: 1, channel: 'widget' });
    } else if (kind === 'vimeo') {
      post({ method: 'addEventListener', value: 'error' });
    }
  });
})();
</script></body></html>''';
}

/// What a message from the frame means, as far as Campfire cares.
sealed class FrameMessage {
  const FrameMessage();
}

class FrameFailed extends FrameMessage {
  const FrameFailed();
}

class FrameClosed extends FrameMessage {
  const FrameClosed();
}

class FrameProgress extends FrameMessage {
  final String event;
  final double currentTime;
  final double duration;
  const FrameProgress(this.event, this.currentTime, this.duration);
}

// Vimeo also reports harmless things as errors, such as autoplay being refused.
const _vimeoFatal = ['NotFoundError', 'PrivacyError'];

/// Reads a message the player's page posted (web EmbedPlayer.tsx's saysFailed / Zoryva handling).
FrameMessage? readFrameMessage(String host, String raw) {
  Object? message;
  try {
    message = jsonDecode(raw);
  } catch (_) {
    return null;
  }
  if (message is! Map) return null;
  if (_isZoryva(host)) {
    if (message['type'] == 'zoryva:embed-close') return const FrameClosed();
    final data = message['type'] == 'ZORYVA_PLAYER_EVENT' ? message['data'] : null;
    if (data is Map && data['event'] is String && data['currentTime'] is num && data['duration'] is num) {
      final at = (data['currentTime'] as num).toDouble();
      final total = (data['duration'] as num).toDouble();
      if (at.isFinite && total.isFinite) return FrameProgress(data['event'] as String, at, total);
    }
    return null;
  }
  if (message['event'] == 'onError') return _youtubeHost.hasMatch(host) ? const FrameFailed() : null;
  final data = message['data'];
  if (host == 'player.vimeo.com' && message['event'] == 'error' && data is Map && _vimeoFatal.contains(data['name'])) {
    return const FrameFailed();
  }
  return null;
}

/// Plays a title in another site's own player (an embed set on the title, or an any-player source)
/// inside a web view, calling [onFailed] when that says it can't or the site doesn't load. No watch
/// party, tracks or Campfire controls here; a Zoryva player reports progress, which is saved.
class WebPlayer extends StatefulWidget {
  final VideoResponse video;
  final PlayerOption player;

  /// Where to start, when a Zoryva player can be told.
  final double startAt;

  /// The other ways to play it.
  final List<ViewerSource> others;

  /// Switches source, carrying on from the position the player last reported (null when unknown).
  final void Function(String sourceId, double? positionSeconds) onSelect;
  final VoidCallback onFailed;

  /// Leaves the player.
  final VoidCallback onExit;

  /// Plays the next episode from the same source.
  final VoidCallback? onNext;

  const WebPlayer({
    super.key,
    required this.video,
    required this.player,
    required this.startAt,
    required this.others,
    required this.onSelect,
    required this.onFailed,
    required this.onExit,
    this.onNext,
  });

  @override
  State<WebPlayer> createState() => _WebPlayerState();
}

class _WebPlayerState extends State<WebPlayer> {
  Timer? _timeout;
  bool _loaded = false;
  bool _failed = false;
  bool _fullscreen = false;
  FrameProgress? _last;
  DateTime _lastSave = DateTime.fromMillisecondsSinceEpoch(0);

  late final String _url =
      widget.player.kind == PlayerKind.frame ? zoryvaUrlAt(widget.player.url!, widget.startAt) : widget.player.url!;
  late final String _host = Uri.tryParse(_url)?.host ?? '';

  @override
  void initState() {
    super.initState();
    _timeout = Timer(_loadTimeout, () {
      if (!_loaded) _fail();
    });
    // Another site's player turns with the phone, as a video should.
    if (Platform.isAndroid && !isAndroidTv) SystemChrome.setPreferredOrientations(DeviceOrientation.values);
  }

  @override
  void dispose() {
    _timeout?.cancel();
    _save(force: true);
    if (_fullscreen) windowManager.setFullScreen(false);
    if (Platform.isAndroid && !isAndroidTv) {
      SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp, DeviceOrientation.portraitDown]);
    }
    super.dispose();
  }

  void _fail() {
    if (_failed || !mounted) return;
    _failed = true;
    widget.onFailed();
  }

  void _save({bool force = false}) {
    final last = _last;
    if (last == null || last.duration <= 0) return;
    final now = DateTime.now();
    if (!force && now.difference(_lastSave) < _saveEvery) return;
    _lastSave = now;
    CatalogService.saveProgress(
      fileId: widget.video.fileId,
      parentFolderId: widget.video.parentFolderId,
      positionSeconds: last.currentTime,
      durationSeconds: last.duration,
    ).catchError((_) {});
  }

  void _onMessage(List<dynamic> args) {
    final payload = args.isEmpty ? null : args.first;
    if (payload is! Map || payload['data'] is! String) return;
    final origin = Uri.tryParse(payload['origin'] as String? ?? '');
    // Only what the player's own site says counts.
    if (origin == null || origin.host != _host) return;
    switch (readFrameMessage(_host, payload['data'] as String)) {
      case FrameClosed():
        _save(force: true);
        widget.onExit();
      case FrameProgress progress when const ['timeupdate', 'pause', 'seeked', 'ended'].contains(progress.event):
        if (progress.duration <= 0) return;
        _last = progress;
        _save(force: progress.event != 'timeupdate');
      case FrameFailed():
        _fail();
      default:
        break;
    }
  }

  Future<void> _toggleFullscreen() async {
    final next = !_fullscreen;
    await windowManager.setFullScreen(next);
    if (mounted) setState(() => _fullscreen = next);
  }

  void _switch(String id) => widget.onSelect(id, _last?.currentTime);

  @override
  Widget build(BuildContext context) {
    final video = widget.video;
    final title = [video.seriesTitle, video.title].whereType<String>().where((s) => s.isNotEmpty).join(': ');
    final size = MediaQuery.sizeOf(context);
    // A phone held sideways gives the player everything; the bar comes back upright.
    final bare = Platform.isAndroid && !isAndroidTv && size.width > size.height;

    final view = InAppWebView(
      initialData: InAppWebViewInitialData(
        data: playerPage(_url, widget.player.frame),
        baseUrl: WebUri(webBaseUrl),
        mimeType: 'text/html',
        encoding: 'utf-8',
      ),
      initialSettings: InAppWebViewSettings(
        javaScriptEnabled: true,
        mediaPlaybackRequiresUserGesture: false,
        allowsInlineMediaPlayback: true,
        supportMultipleWindows: false,
        javaScriptCanOpenWindowsAutomatically: false,
        useShouldOverrideUrlLoading: true,
        transparentBackground: true,
        supportZoom: false,
      ),
      onWebViewCreated: (controller) {
        controller.addJavaScriptHandler(handlerName: 'message', callback: _onMessage);
        controller.addJavaScriptHandler(
          handlerName: 'loaded',
          callback: (_) {
            _loaded = true;
            _timeout?.cancel();
          },
        );
      },
      // The page itself never goes anywhere else: what a player's frame does stays in the frame.
      shouldOverrideUrlLoading: (controller, action) async {
        if (!action.isForMainFrame) return NavigationActionPolicy.ALLOW;
        final scheme = action.request.url?.scheme ?? '';
        final initial = action.request.url?.toString().startsWith(webBaseUrl) ?? false;
        return scheme == 'about' || scheme == 'data' || initial ? NavigationActionPolicy.ALLOW : NavigationActionPolicy.CANCEL;
      },
      onCreateWindow: (controller, request) async => false,
      onPermissionRequest: (controller, request) async =>
          PermissionResponse(resources: request.resources, action: PermissionResponseAction.DENY),
      onReceivedError: (controller, request, error) {
        if (request.isForMainFrame ?? false) _fail();
      },
    );

    return ColoredBox(
      color: Colors.black,
      child: SafeArea(
        top: !bare,
        bottom: false,
        left: !bare,
        right: !bare,
        child: Column(
          children: [
            if (!bare) _bar(title),
            Expanded(child: view),
          ],
        ),
      ),
    );
  }

  Widget _bar(String title) {
    final others = widget.others;
    return Container(
      color: AppColors.bgElevated,
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
      child: Row(
        children: [
          IconButton(
            autofocus: true,
            tooltip: 'Back',
            icon: const Icon(Icons.arrow_back, color: AppColors.foreground),
            onPressed: () {
              _save(force: true);
              widget.onExit();
            },
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title.isEmpty ? 'Video' : title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.foreground, fontWeight: FontWeight.w700, fontSize: 15),
                ),
                Text(
                  'Playing from ${widget.player.name}.${others.isNotEmpty ? ' Not working? Try another.' : ''}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: AppColors.textTertiary, fontSize: 12),
                ),
              ],
            ),
          ),
          if (others.isNotEmpty)
            PopupMenuButton<String>(
              tooltip: 'Play from another source',
              color: AppColors.surface,
              icon: const Icon(Icons.swap_horiz, color: AppColors.foreground),
              onSelected: _switch,
              itemBuilder: (context) => [
                for (final source in others)
                  PopupMenuItem(
                    value: source.id,
                    child: Text('Play from ${source.name}', style: const TextStyle(color: AppColors.foreground)),
                  ),
              ],
            ),
          if (widget.onNext != null)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: FilledButton(
                onPressed: () {
                  _save(force: true);
                  widget.onNext!();
                },
                child: const Text('Next episode'),
              ),
            ),
          if (Platform.isWindows)
            IconButton(
              tooltip: _fullscreen ? 'Exit full screen' : 'Full screen',
              icon: Icon(_fullscreen ? Icons.fullscreen_exit : Icons.fullscreen, color: AppColors.foreground),
              onPressed: _toggleFullscreen,
            ),
        ],
      ),
    );
  }
}
