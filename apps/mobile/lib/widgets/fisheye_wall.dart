import 'dart:async';
import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/scheduler.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;

import '../models/explore.dart';
import '../utils/fisheye_layout.dart';

/// The Explore wall: hundreds of posters on one endless lattice seen through a fisheye lens
/// (shaders/fisheye.frag draws it; the web app has the same wall). Drag to move it — it coasts,
/// then settles with a poster in the middle — pinch or scroll to push the lens in and out, tap a
/// poster to bring it to the middle and open it. Arrow keys (and a TV remote) step one poster,
/// Enter opens, + and − zoom.
///
/// Posters download nearest-the-middle first and are packed, small, into one atlas image (Flutter
/// shaders can't take texture arrays); the poster in the middle gets a sharp copy of its own.
class FisheyeWall extends StatefulWidget {
  final List<WallItem> items;
  final String imageBase;
  final bool libOnly;

  /// Pushes the lens left (a side panel is open beside it).
  final bool panelOpen;
  final ValueChanged<WallItem> onOpen;
  final ValueChanged<WallItem> onFocusChanged;

  /// The shader couldn't be loaded: the screen shows a plain grid instead.
  final VoidCallback onFail;

  const FisheyeWall({
    super.key,
    required this.items,
    required this.imageBase,
    required this.libOnly,
    required this.panelOpen,
    required this.onOpen,
    required this.onFocusChanged,
    required this.onFail,
  });

  @override
  State<FisheyeWall> createState() => FisheyeWallState();
}

const _tileW = 96;
const _tileH = 144;
const _atlasCols = 32; // 3072px wide; rows follow from the count (at most ~28 rows → 4032px)
const _loadConcurrency = 6;
const _zoomMin = 0.55;
const _zoomMax = 2.6;

Future<ui.FragmentProgram>? _program;

class FisheyeWallState extends State<FisheyeWall> with SingleTickerProviderStateMixin {
  late final Ticker _ticker;
  final _repaint = ValueNotifier<int>(0);
  final _focusNode = FocusNode(debugLabel: 'Explore wall');
  ui.FragmentShader? _shader;
  late WallLayout _layout;
  late List<WallItem> _items;

  // Images the shader samples.
  ui.Image? _index;
  ui.Image? _atlas;
  ui.Image? _focusImage;
  ui.Image? _blank;
  int _focusImageItem = -1;
  int _focusWanted = -1;

  // Poster downloads.
  late List<bool> _loaded;
  final _queued = <int>{};
  List<int> _queue = [];
  int _inFlight = 0;
  final _pending = <(int, ui.Image)>[];
  bool _rebuilding = false;
  int _generation = 0;

  // Camera.
  (double, double) _cam = (0, 0);
  (double, double) _camTarget = (0, 0);
  (double, double) _vel = (0, 0);
  bool _dragging = false;
  bool _coasting = false;
  double _zoom = 1;
  double _zoomTarget = 1;
  double _pinchStartZoom = 1;
  int _pendingOpen = -1;
  WallCell _focusCell = (c: 0, r: 0);
  WallCell? _hoverCell;
  int _focusIndex = 0;
  Duration _lastTick = Duration.zero;
  double _time = 0;
  double _lastPriority = -1;
  double _focusSince = 0;
  double _lastRebuild = -1;
  Size _size = Size.zero;
  late bool _reduced;

  // Overlay state (setState only when these change).
  int? _hoverIndex;
  Offset _hoverAt = Offset.zero;

  @override
  void initState() {
    super.initState();
    _ticker = createTicker(_tick);
    _start();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduced = MediaQuery.of(context).disableAnimations;
  }

  @override
  void didUpdateWidget(FisheyeWall oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.items != widget.items || oldWidget.imageBase != widget.imageBase) _start();
  }

  Future<void> _start() async {
    _generation++;
    final generation = _generation;
    _items = widget.items;
    _layout = WallLayout(_items.length);
    _loaded = List<bool>.filled(_items.length, false);
    _queued.clear();
    _queue = [];
    for (final (_, image) in _pending) {
      image.dispose();
    }
    _pending.clear();
    _cam = (0, 0);
    _camTarget = (0, 0);
    _vel = (0, 0);
    _focusCell = (c: 0, r: 0);
    _focusIndex = 0;
    _focusWanted = -1;
    _focusImageItem = -1;
    _atlas?.dispose();
    _atlas = null;
    try {
      _program ??= ui.FragmentProgram.fromAsset('shaders/fisheye.frag');
      final program = await _program!;
      if (!mounted || generation != _generation) return;
      _shader ??= program.fragmentShader();
      _blank ??= await _solidImage();
      await _rebuildIndex();
      if (!mounted || generation != _generation) return;
      if (_items.isNotEmpty) widget.onFocusChanged(_items.first);
      _prioritise();
      if (!_ticker.isActive) _ticker.start();
    } catch (error) {
      debugPrint('Explore wall: $error');
      _program = null;
      if (mounted) widget.onFail();
    }
  }

  static Future<ui.Image> _solidImage() {
    final recorder = ui.PictureRecorder();
    Canvas(recorder).drawRect(const Rect.fromLTWH(0, 0, 1, 1), Paint()..color = const Color(0xFF0E0D0C));
    return recorder.endRecording().toImage(1, 1);
  }

  @override
  void dispose() {
    _generation++;
    _ticker.dispose();
    _repaint.dispose();
    _focusNode.dispose();
    for (final (_, image) in _pending) {
      image.dispose();
    }
    _index?.dispose();
    _atlas?.dispose();
    _focusImage?.dispose();
    _blank?.dispose();
    super.dispose();
  }

  // ---- Images ---------------------------------------------------------------------------------

  /// The cell → item map, with each item's flags (bit 0 loaded, bit 1 in Campfire).
  Future<void> _rebuildIndex() async {
    final layout = _layout;
    final bytes = Uint8List(layout.width * layout.height * 4);
    for (var i = 0; i < layout.grid.length; i++) {
      final item = layout.grid[i];
      if (item < 0) continue;
      final v = item + 1;
      bytes[i * 4] = v & 255;
      bytes[i * 4 + 1] = (v >> 8) & 255;
      bytes[i * 4 + 2] = (_loaded[item] ? 1 : 0) | (_items[item].inCampfire ? 2 : 0);
      bytes[i * 4 + 3] = 255;
    }
    final completer = Completer<ui.Image>();
    ui.decodeImageFromPixels(bytes, layout.width, layout.height, ui.PixelFormat.rgba8888, completer.complete);
    final image = await completer.future;
    if (!mounted) {
      image.dispose();
      return;
    }
    _index?.dispose();
    _index = image;
  }

  int get _atlasRows => math.max(1, (_items.length / _atlasCols).ceil());

  /// Downloads go nearest-first from where the camera is.
  void _prioritise() {
    final pending = <(int, double)>[];
    for (var i = 0; i < _items.length; i++) {
      if (_loaded[i] || _queued.contains(i)) continue;
      final cell = _layout.itemCells[i];
      final (x, y) = wallCellCenter(cell.c, cell.r);
      final dx = x - _cam.$1;
      final dy = y - _cam.$2;
      pending.add((i, dx * dx + dy * dy));
    }
    pending.sort((a, b) => a.$2.compareTo(b.$2));
    _queue = [for (final p in pending) p.$1];
    _pump();
  }

  void _pump() {
    while (_inFlight < _loadConcurrency && _queue.isNotEmpty) {
      final i = _queue.removeAt(0);
      if (_loaded[i] || _queued.contains(i)) continue;
      _queued.add(i);
      _inFlight++;
      final generation = _generation;
      _loadImage('${widget.imageBase}/w154${_items[i].posterPath}', width: _tileW, height: _tileH).then((image) {
        if (!mounted || generation != _generation) {
          image?.dispose();
          return;
        }
        if (image != null) _pending.add((i, image));
      }).whenComplete(() {
        if (generation != _generation) return;
        _inFlight--;
        if (mounted) _pump();
      });
    }
  }

  static Future<ui.Image?> _loadImage(String url, {int? width, int? height}) async {
    try {
      final res = await http.get(Uri.parse(url));
      if (res.statusCode != 200) return null;
      final codec = await ui.instantiateImageCodec(res.bodyBytes, targetWidth: width, targetHeight: height);
      final frame = await codec.getNextFrame();
      codec.dispose();
      return frame.image;
    } catch (_) {
      return null; // a missing poster stays a dark pane
    }
  }

  /// Draws the posters that arrived since last time onto the atlas.
  Future<void> _flushPending() async {
    if (_rebuilding || _pending.isEmpty) return;
    _rebuilding = true;
    final batch = List.of(_pending);
    _pending.clear();
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    final old = _atlas;
    if (old != null) canvas.drawImage(old, Offset.zero, Paint());
    final paint = Paint()..filterQuality = FilterQuality.medium;
    for (final (i, image) in batch) {
      final dst = Rect.fromLTWH(((i % _atlasCols) * _tileW).toDouble(), ((i ~/ _atlasCols) * _tileH).toDouble(), _tileW.toDouble(), _tileH.toDouble());
      canvas.drawImageRect(image, Rect.fromLTWH(0, 0, image.width.toDouble(), image.height.toDouble()), dst, paint);
    }
    final atlas = recorder.endRecording().toImageSync(_atlasCols * _tileW, _atlasRows * _tileH);
    for (final (i, image) in batch) {
      image.dispose();
      _loaded[i] = true;
    }
    _atlas = atlas;
    old?.dispose();
    await _rebuildIndex();
    _rebuilding = false;
  }

  void _wantFocusImage(int i) {
    if (i == _focusWanted) return;
    _focusWanted = i;
    final generation = _generation;
    _loadImage('${widget.imageBase}/w342${_items[i].posterPath}').then((image) {
      if (!mounted || generation != _generation || _focusWanted != i) {
        image?.dispose();
        return;
      }
      if (image == null) return;
      _focusImage?.dispose();
      _focusImage = image;
      _focusImageItem = i;
    });
  }

  // ---- The camera ---------------------------------------------------------------------------------

  double get _half => 0.5 * math.min(_size.width, _size.height);

  /// Zoom 1 makes the middle poster about 40% of the height (more of the width on a phone).
  double get _baseZoom {
    final targetPx = math.max(170.0, math.min(math.min(_size.height * 0.42, _size.width * 0.62 * 1.5), 440.0));
    return targetPx / (1.5 * _half);
  }

  Offset get _lensCentre {
    final shift = widget.panelOpen && _size.width >= 900 ? math.min(250.0, _size.width * 0.2) : 0.0;
    return Offset(_size.width / 2 - shift, _size.height / 2);
  }

  void _tick(Duration elapsed) {
    final dt = math.min(0.05, (elapsed - _lastTick).inMicroseconds / 1e6);
    _lastTick = elapsed;
    _time = elapsed.inMicroseconds / 1e6;

    if (!_dragging) {
      if (_coasting) {
        _cam = (_cam.$1 + _vel.$1 * dt, _cam.$2 + _vel.$2 * dt);
        final decay = math.exp(-dt * 3.2);
        _vel = (_vel.$1 * decay, _vel.$2 * decay);
        if (math.sqrt(_vel.$1 * _vel.$1 + _vel.$2 * _vel.$2) < 0.35) {
          _coasting = false;
          _settle();
        }
      } else {
        final k = _reduced ? 1.0 : 1 - math.exp(-dt * 8);
        _cam = (_cam.$1 + (_camTarget.$1 - _cam.$1) * k, _cam.$2 + (_camTarget.$2 - _cam.$2) * k);
      }
    }
    final m = math.sqrt(math.pow(_cam.$1 / 1.5, 2) + _cam.$2 * _cam.$2);
    final limit = _layout.extent + 1;
    if (m > limit) {
      _cam = (_cam.$1 * limit / m, _cam.$2 * limit / m);
      _vel = (0, 0);
    }
    _zoom += (_zoomTarget - _zoom) * (_reduced ? 1.0 : 1 - math.exp(-dt * 10));

    final fc = wallCellAt(_cam.$1, _cam.$2);
    final fi = _layout.itemAt(fc.c, fc.r);
    if (fc != _focusCell) {
      _focusCell = fc;
      _focusSince = _time;
      if (fi >= 0 && fi != _focusIndex) {
        _focusIndex = fi;
        widget.onFocusChanged(_items[fi]);
      }
    }
    if (fi >= 0 && _time - _focusSince > 0.18) _wantFocusImage(fi);
    if (_time - _lastPriority > 0.6) {
      _lastPriority = _time;
      _prioritise();
    }
    if (_pending.isNotEmpty && _time - _lastRebuild > 0.4) {
      _lastRebuild = _time;
      _flushPending();
    }
    if (_pendingOpen >= 0 &&
        math.sqrt(math.pow(_cam.$1 - _camTarget.$1, 2) + math.pow(_cam.$2 - _camTarget.$2, 2)) < 0.08) {
      final item = _items[_pendingOpen];
      _pendingOpen = -1;
      widget.onOpen(item);
    }
    _repaint.value++;
  }

  void _settle() {
    final cell = wallCellAt(_cam.$1, _cam.$2);
    _camTarget = _layout.itemAt(cell.c, cell.r) >= 0 ? wallCellCenter(cell.c, cell.r) : _cam;
  }

  void _glideToIndex(int index, {required bool open}) {
    if (index < 0 || index >= _items.length) return;
    final cell = _layout.itemCells[index];
    _camTarget = wallCellCenter(cell.c, cell.r);
    _vel = (0, 0);
    _coasting = false;
    if (_reduced) _cam = _camTarget;
    _pendingOpen = open ? index : -1;
  }

  /// Brings a title to the middle (a search pick); false when it isn't on the wall.
  bool glideTo(String key, {bool open = true}) {
    final index = _items.indexWhere((i) => i.key == key);
    if (index < 0) return false;
    _glideToIndex(index, open: open);
    return true;
  }

  /// A random well-rated title from the first few hundred, brought to the middle and opened.
  void surprise() {
    final pool = [
      for (var i = 0; i < math.min(400, _items.length); i++)
        if ((_items[i].rating ?? 0) >= 7.2) i,
    ];
    if (pool.isEmpty) return;
    _glideToIndex(pool[math.Random().nextInt(pool.length)], open: true);
  }

  int _pick(Offset local) {
    final centre = _lensCentre;
    final (x, y) = wallScreenToWall(local.dx - centre.dx, centre.dy - local.dy, _half, _cam, _zoom * _baseZoom);
    final cell = wallCellAt(x, y);
    return _layout.itemAt(cell.c, cell.r);
  }

  void _zoomBy(double factor) {
    _zoomTarget = (_zoomTarget * factor).clamp(_zoomMin, _zoomMax);
  }

  // ---- Input ----------------------------------------------------------------------------------------

  void _onScaleStart(ScaleStartDetails d) {
    _dragging = true;
    _coasting = false;
    _pendingOpen = -1;
    _vel = (0, 0);
    _camTarget = _cam;
    _pinchStartZoom = _zoomTarget;
    _setHover(null, Offset.zero);
  }

  void _onScaleUpdate(ScaleUpdateDetails d) {
    if (d.pointerCount >= 2) {
      _zoomTarget = (_pinchStartZoom * d.scale).clamp(_zoomMin, _zoomMax);
    }
    final scale = 1 / (_half * _zoom * _baseZoom);
    _cam = (_cam.$1 - d.focalPointDelta.dx * scale, _cam.$2 + d.focalPointDelta.dy * scale);
    _camTarget = _cam;
  }

  void _onScaleEnd(ScaleEndDetails d) {
    _dragging = false;
    final v = d.velocity.pixelsPerSecond;
    final scale = 1 / (_half * _zoom * _baseZoom);
    var vel = (-v.dx * scale, v.dy * scale);
    final speed = math.sqrt(vel.$1 * vel.$1 + vel.$2 * vel.$2);
    if (!_reduced && d.pointerCount <= 1 && speed > 0.8) {
      if (speed > 28) vel = (vel.$1 * 28 / speed, vel.$2 * 28 / speed);
      _vel = vel;
      _coasting = true;
    } else {
      _settle();
    }
  }

  void _onTapUp(TapUpDetails d) {
    _focusNode.requestFocus();
    final index = _pick(d.localPosition);
    if (index >= 0) _glideToIndex(index, open: true);
  }

  void _onHover(PointerHoverEvent e) {
    final index = _pick(e.localPosition);
    if (index >= 0) {
      final cell = _layout.itemCells[index];
      _hoverCell = cell;
    } else {
      _hoverCell = null;
    }
    _setHover(index >= 0 && index != _focusIndex ? index : null, e.localPosition);
  }

  void _setHover(int? index, Offset at) {
    if (index == null) _hoverCell = null;
    if (index == _hoverIndex && (index == null || (at - _hoverAt).distance < 2)) return;
    setState(() {
      _hoverIndex = index;
      _hoverAt = at;
    });
  }

  void _onSignal(PointerSignalEvent e) {
    if (e is PointerScrollEvent) {
      GestureBinding.instance.pointerSignalResolver.register(e, (event) {
        _zoomBy(math.exp(-(event as PointerScrollEvent).scrollDelta.dy * 0.0015));
      });
    } else if (e is PointerScaleEvent) {
      _zoomBy(e.scale);
    }
  }

  KeyEventResult _onKey(FocusNode node, KeyEvent e) {
    if (e is! KeyDownEvent && e is! KeyRepeatEvent) return KeyEventResult.ignored;
    final key = e.logicalKey;
    final (c, r) = (_focusCell.c, _focusCell.r);
    WallCell? next;
    if (key == LogicalKeyboardKey.arrowLeft || key == LogicalKeyboardKey.arrowRight) {
      final nc = c + (key == LogicalKeyboardKey.arrowLeft ? -1 : 1);
      // The next column is staggered by half a poster: whichever row sits nearest.
      final (_, y) = wallCellCenter(c, r);
      next = (c: nc, r: wallCellAt(nc * wallPitchX, y + 0.001).r);
    } else if (key == LogicalKeyboardKey.arrowUp || key == LogicalKeyboardKey.arrowDown) {
      next = (c: c, r: r + (key == LogicalKeyboardKey.arrowUp ? 1 : -1));
    } else if (key == LogicalKeyboardKey.enter ||
        key == LogicalKeyboardKey.numpadEnter ||
        key == LogicalKeyboardKey.select ||
        key == LogicalKeyboardKey.space) {
      if (_focusIndex < _items.length) widget.onOpen(_items[_focusIndex]);
      return KeyEventResult.handled;
    } else if (key == LogicalKeyboardKey.equal || key == LogicalKeyboardKey.add || key == LogicalKeyboardKey.numpadAdd) {
      _zoomBy(1.25);
      return KeyEventResult.handled;
    } else if (key == LogicalKeyboardKey.minus || key == LogicalKeyboardKey.numpadSubtract) {
      _zoomBy(1 / 1.25);
      return KeyEventResult.handled;
    } else if (key == LogicalKeyboardKey.digit0) {
      _zoomTarget = 1;
      _glideToIndex(0, open: false);
      return KeyEventResult.handled;
    } else {
      return KeyEventResult.ignored;
    }
    final index = _layout.itemAt(next.c, next.r);
    // Off the edge of the wall: let focus move on (a TV remote reaches the filters that way).
    if (index < 0) return KeyEventResult.ignored;
    _glideToIndex(index, open: false);
    return KeyEventResult.handled;
  }

  @override
  Widget build(BuildContext context) {
    final hovered = _hoverIndex == null || _hoverIndex! >= _items.length ? null : _items[_hoverIndex!];
    return LayoutBuilder(
      builder: (context, constraints) {
        _size = constraints.biggest;
        return Stack(
          children: [
            Positioned.fill(
              child: Semantics(
                label: 'Poster wall. Drag to move, pinch to zoom, tap a poster to open it.',
                child: Focus(
                  focusNode: _focusNode,
                  autofocus: !_isTouchPlatform(context),
                  onKeyEvent: _onKey,
                  child: Listener(
                    onPointerSignal: _onSignal,
                    child: MouseRegion(
                      cursor: SystemMouseCursors.grab,
                      onHover: _onHover,
                      onExit: (_) => _setHover(null, Offset.zero),
                      child: GestureDetector(
                        behavior: HitTestBehavior.opaque,
                        onScaleStart: _onScaleStart,
                        onScaleUpdate: _onScaleUpdate,
                        onScaleEnd: _onScaleEnd,
                        onTapUp: _onTapUp,
                        child: RepaintBoundary(
                          child: CustomPaint(painter: _WallPainter(this), size: Size.infinite),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            if (hovered != null)
              Positioned(
                left: _hoverAt.dx + 16,
                top: _hoverAt.dy + 14,
                child: IgnorePointer(
                  child: Container(
                    constraints: const BoxConstraints(maxWidth: 240),
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: const Color(0xCC000000),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: const Color(0x1AFFFFFF)),
                    ),
                    child: Text(
                      '${hovered.title}${hovered.year != null ? ' · ${hovered.year}' : ''}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w600),
                    ),
                  ),
                ),
              ),
          ],
        );
      },
    );
  }

  static bool _isTouchPlatform(BuildContext context) {
    final platform = Theme.of(context).platform;
    return platform == TargetPlatform.android || platform == TargetPlatform.iOS;
  }
}

class _WallPainter extends CustomPainter {
  final FisheyeWallState s;
  _WallPainter(this.s) : super(repaint: s._repaint);

  @override
  void paint(Canvas canvas, Size size) {
    final shader = s._shader;
    final index = s._index;
    final blank = s._blank;
    if (shader == null || index == null || blank == null) {
      canvas.drawRect(Offset.zero & size, Paint()..color = const Color(0xFF0B0A09));
      return;
    }
    final centre = s._lensCentre;
    final layout = s._layout;
    final focusItem = s._focusImage != null ? s._focusImageItem : -1;
    final hover = s._hoverCell;
    var i = 0;
    void f(double v) => shader.setFloat(i++, v);
    f(size.width);
    f(size.height);
    f(centre.dx);
    f(centre.dy);
    f(s._half);
    f(s._cam.$1);
    f(s._cam.$2);
    f(s._zoom * s._baseZoom);
    f(s._reduced ? 6 : s._time);
    f(layout.minC.toDouble());
    f(layout.minR.toDouble());
    f(layout.width.toDouble());
    f(layout.height.toDouble());
    f(_atlasCols.toDouble());
    f(s._atlasRows.toDouble());
    f(s._focusCell.c.toDouble());
    f(s._focusCell.r.toDouble());
    f((hover?.c ?? -99999).toDouble());
    f((hover?.r ?? -99999).toDouble());
    f(focusItem.toDouble());
    f(s.widget.libOnly ? 1 : 0);
    shader.setImageSampler(0, index);
    shader.setImageSampler(1, s._atlas ?? blank, filterQuality: FilterQuality.medium);
    shader.setImageSampler(2, s._focusImage ?? blank, filterQuality: FilterQuality.medium);
    canvas.drawRect(Offset.zero & size, Paint()..shader = shader);
  }

  @override
  bool shouldRepaint(_WallPainter oldDelegate) => true;
}
