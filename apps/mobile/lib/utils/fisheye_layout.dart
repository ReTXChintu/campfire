import 'dart:math' as math;

/// The Explore wall's geometry — the same numbers as apps/frontend/src/lib/fisheye.ts and
/// shaders/fisheye.frag, so a tap lands on the poster drawn under it.
///
/// Wall coordinates: one cell is 1 × 1.5 (a 2:3 poster), y points up, columns are staggered by
/// half a cell. The lens maps a screen point q (in units of half the shorter screen side, from the
/// lens centre, y up) to the wall point cam + q · exp(lens · |q|²) / zoom.
const double wallPitchX = 1.16;
const double wallPitchY = 1.66;
const double wallLens = 1.0;

typedef WallCell = ({int c, int r});

bool _odd(int c) => c.isOdd; // Dart's isOdd is right for negatives too (-1 is odd)

(double, double) wallCellCenter(int c, int r) => (c * wallPitchX, r * wallPitchY + (_odd(c) ? wallPitchY * 0.5 : 0));

WallCell wallCellAt(double x, double y) {
  final c = (x / wallPitchX + 0.5).floor();
  final r = ((y - (_odd(c) ? wallPitchY * 0.5 : 0)) / wallPitchY + 0.5).floor();
  return (c: c, r: r);
}

/// Screen offset from the lens centre (logical px, y up) → wall point.
(double, double) wallScreenToWall(double dx, double dy, double half, (double, double) cam, double zoom) {
  final qx = dx / half;
  final qy = dy / half;
  final f = math.exp(wallLens * (qx * qx + qy * qy));
  return (cam.$1 + qx * f / zoom, cam.$2 + qy * f / zoom);
}

/// Item i's cell: the i-th nearest the middle, on an ellipse wider than it is tall, so the best
/// titles are in the middle and the first screenful is all real posters.
class WallLayout {
  final int count;
  final int minC;
  final int minR;
  final int width;
  final int height;
  final List<int> grid; // width × height, item index or -1
  final List<WallCell> itemCells;

  /// How far the camera may wander: the populated area.
  final double extent;

  WallLayout._(this.count, this.minC, this.minR, this.width, this.height, this.grid, this.itemCells, this.extent);

  factory WallLayout(int count) {
    final rr = (math.sqrt(count) * 0.7).ceil() + 4;
    final cc = (rr * 1.3).ceil() + 4;
    final cells = <({int c, int r, double m})>[];
    for (var c = -cc; c <= cc; c++) {
      for (var r = -rr; r <= rr; r++) {
        final (x, y) = wallCellCenter(c, r);
        cells.add((c: c, r: r, m: (x / 1.5) * (x / 1.5) + y * y));
      }
    }
    cells.sort((a, b) {
      final byM = a.m.compareTo(b.m);
      if (byM != 0) return byM;
      final byC = a.c.compareTo(b.c);
      return byC != 0 ? byC : a.r.compareTo(b.r);
    });
    final w = 2 * cc + 1;
    final h = 2 * rr + 1;
    final grid = List<int>.filled(w * h, -1);
    final itemCells = <WallCell>[];
    for (var i = 0; i < count; i++) {
      final cell = cells[i];
      grid[(cell.r + rr) * w + (cell.c + cc)] = i;
      itemCells.add((c: cell.c, r: cell.r));
    }
    final extent = count == 0 ? 1.0 : math.sqrt(cells[count - 1].m);
    return WallLayout._(count, -cc, -rr, w, h, grid, itemCells, extent);
  }

  int itemAt(int c, int r) {
    final gc = c - minC;
    final gr = r - minR;
    if (gc < 0 || gr < 0 || gc >= width || gr >= height) return -1;
    return grid[gr * width + gc];
  }
}
