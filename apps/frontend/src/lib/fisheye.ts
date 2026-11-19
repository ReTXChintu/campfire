/**
 * The Explore wall: hundreds of posters on one endless lattice, seen through a fisheye lens — the
 * poster at the centre is large, and the rest shrink, darken and lose their colour towards the
 * edges, where the wall curves away like the inside of a dome. The frames between posters are
 * drawn as glossy raised ridges, lit by two slowly circling lights (one ember, one cool).
 *
 * Everything is one full-screen fragment shader: for each pixel it runs the lens backwards to find
 * the point on the flat wall underneath, which cell that is, and how far into the cell — so the
 * cost doesn't depend on how many posters there are, only on the screen size. Posters live in a
 * texture array (64 to a layer), filled in as they download, nearest the centre first.
 *
 * Wall coordinates: one cell is 1 × 1.5 (a 2:3 poster), y points up. Columns are staggered by
 * half a cell, like bricks on end. The lens maps a screen point q (in units of half the shorter
 * screen side, from the lens centre) to wall point cam + q · exp(LENS · |q|²) / zoom.
 */

export const PITCH_X = 1.16;
export const PITCH_Y = 1.66;
const LENS = 1.0;
const TILE_W = 112;
const TILE_H = 168;
const TILE_COLS = 8;
const TILE_ROWS = 8;
const PER_LAYER = TILE_COLS * TILE_ROWS;
const LOAD_CONCURRENCY = 6;

export type WallPoster = { posterPath: string };

export type Cell = { c: number; r: number };

const odd = (c: number) => c & 1; // also right for negative columns (two's complement)

export function cellCenter(c: number, r: number): [number, number] {
  return [c * PITCH_X, r * PITCH_Y + odd(c) * PITCH_Y * 0.5];
}

export function cellAt(x: number, y: number): Cell {
  const c = Math.floor(x / PITCH_X + 0.5);
  const r = Math.floor((y - odd(c) * PITCH_Y * 0.5) / PITCH_Y + 0.5);
  return { c, r };
}

/** Item i's cell: the i-th nearest to the middle, on an ellipse wider than it is tall, so the
 * first screenful (landscape) is all real posters and the best ones are in the middle. */
export function layoutCells(count: number) {
  const R = Math.ceil(Math.sqrt(count) * 0.7) + 4;
  const C = Math.ceil(R * 1.3) + 4;
  const cells: { c: number; r: number; m: number }[] = [];
  for (let c = -C; c <= C; c++) {
    for (let r = -R; r <= R; r++) {
      const [x, y] = cellCenter(c, r);
      cells.push({ c, r, m: (x / 1.5) ** 2 + y ** 2 });
    }
  }
  cells.sort((a, b) => a.m - b.m || a.c - b.c || a.r - b.r);
  const min = { c: -C, r: -R };
  const size = { w: 2 * C + 1, h: 2 * R + 1 };
  const grid = new Int32Array(size.w * size.h).fill(-1);
  const itemCells: Cell[] = [];
  for (let i = 0; i < count; i++) {
    const { c, r } = cells[i];
    grid[(r - min.r) * size.w + (c - min.c)] = i;
    itemCells.push({ c, r });
  }
  const itemAt = (c: number, r: number) => {
    const gc = c - min.c;
    const gr = r - min.r;
    return gc < 0 || gr < 0 || gc >= size.w || gr >= size.h ? -1 : grid[gr * size.w + gc];
  };
  // How far the camera may wander: the populated area plus a little.
  const extent = cells[Math.max(0, count - 1)]?.m ?? 1;
  return { grid, min, size, itemCells, itemAt, extent: Math.sqrt(extent) };
}

const VERTEX = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
precision highp isampler2D;
precision mediump sampler2DArray;

uniform vec2 uCenter;
uniform float uHalf;
uniform vec2 uCam;
uniform float uZoom;
uniform float uTime;
uniform ivec2 uGridMin;
uniform ivec2 uGridSize;
uniform isampler2D uGrid;
uniform sampler2D uItems;
uniform int uItemsW;
uniform sampler2DArray uAtlas;
uniform sampler2D uFocusTex;
uniform int uFocusItem;
uniform ivec2 uHover;
uniform ivec2 uFocus;
uniform float uLibOnly;

out vec4 outColor;

const float LENS = ${LENS.toFixed(3)};
const vec2 PITCH = vec2(${PITCH_X.toFixed(3)}, ${PITCH_Y.toFixed(3)});
const vec2 HALF = vec2(0.5, 0.75);
const float RAD = 0.13;
const float RIM = 0.05;
const float HALF_GAP = (PITCH.x - 1.0) * 0.5;
const vec3 BG = vec3(0.043, 0.039, 0.035);
const vec3 EMBER = vec3(1.0, 0.416, 0.239);
const vec3 LIVE = vec3(0.247, 0.796, 0.557);

vec3 envMap(vec3 r) {
  // A dark room with a warm glow above and a cool one to the side, for the frames to reflect.
  float warm = pow(max(r.y * 0.5 + 0.5, 0.0), 5.0);
  float cool = pow(max(-r.x * 0.5 + 0.5, 0.0), 7.0);
  float band = smoothstep(0.75, 1.0, sin(r.x * 3.0 + r.y * 5.0 + uTime * 0.15) * 0.5 + 0.5);
  return vec3(0.02) + warm * vec3(0.55, 0.33, 0.2) + cool * vec3(0.18, 0.24, 0.38) + band * 0.05;
}

void lights(vec3 p, vec3 n, float shininess, out vec3 diff, out vec3 spec) {
  vec3 l1 = vec3(0.95 * sin(uTime * 0.31), 0.55 * cos(uTime * 0.23) + 0.25, 1.1);
  vec3 l2 = vec3(-0.9 * cos(uTime * 0.27), -0.6 * sin(uTime * 0.19) - 0.1, 0.9);
  vec3 c1 = vec3(1.0, 0.66, 0.44) * 1.15;
  vec3 c2 = vec3(0.52, 0.66, 1.0) * 0.8;
  diff = vec3(0.0);
  spec = vec3(0.0);
  vec3 v = vec3(0.0, 0.0, 1.0);
  for (int i = 0; i < 2; i++) {
    vec3 lp = i == 0 ? l1 : l2;
    vec3 lc = i == 0 ? c1 : c2;
    vec3 d = lp - p;
    float dist = length(d);
    vec3 l = d / dist;
    float att = 1.0 / (1.0 + dist * dist * 0.6);
    diff += max(dot(n, l), 0.0) * att * lc;
    spec += pow(max(dot(reflect(-l, n), v), 0.0), shininess) * att * lc;
  }
}

void main() {
  vec2 q = (gl_FragCoord.xy - uCenter) / uHalf;
  float r2 = dot(q, q);
  float f = exp(LENS * r2);
  vec2 w = uCam + q * f / uZoom;

  // How tall a poster is here, in pixels: below a few it's dust, and fades into the dark.
  float cellPx = 1.5 * uZoom / (f * (1.0 + 2.0 * LENS * r2)) * uHalf;
  float density = smoothstep(2.0, 9.0, cellPx);

  int c = int(floor(w.x / PITCH.x + 0.5));
  float oy = float(c & 1) * PITCH.y * 0.5;
  int r = int(floor((w.y - oy) / PITCH.y + 0.5));
  vec2 centre = vec2(float(c) * PITCH.x, float(r) * PITCH.y + oy);
  vec2 local = w - centre;

  // Signed distance to the poster's rounded rectangle, and which way is "out".
  vec2 qb = abs(local) - HALF + RAD;
  float d = length(max(qb, 0.0)) + min(max(qb.x, qb.y), 0.0) - RAD;
  vec2 g = (qb.x > 0.0 && qb.y > 0.0) ? normalize(qb) * sign(local)
         : (qb.x > qb.y ? vec2(sign(local.x), 0.0) : vec2(0.0, sign(local.y)));
  float aa = max(fwidth(d), 1e-4);

  ivec2 gc = ivec2(c, r) - uGridMin;
  int item = -1;
  if (gc.x >= 0 && gc.y >= 0 && gc.x < uGridSize.x && gc.y < uGridSize.y) item = texelFetch(uGrid, gc, 0).r;
  vec4 meta = item >= 0 ? texelFetch(uItems, ivec2(item % uItemsW, item / uItemsW), 0) : vec4(0.0);
  float hover = all(equal(ivec2(c, r), uHover)) ? 1.0 : 0.0;
  float focus = all(equal(ivec2(c, r), uFocus)) ? 1.0 : 0.0;

  // The dome: the whole wall bulges towards you, so its own curve tilts every normal outwards.
  float rd = sqrt(r2) / 1.45;
  float domeZ = sqrt(max(0.0, 1.0 - rd * rd));
  vec2 domeXY = q / 1.45;
  vec3 p = vec3(q, 0.0);

  // ---- The frame: a rounded ridge rising from the poster's edge to the gap's middle.
  float span = HALF_GAP + RIM;
  float u = clamp((d + RIM) / span, 0.0, 1.0);
  float slope = 0.12 * 1.5708 * cos(u * 1.5708) / span;
  vec3 nf = normalize(vec3(-g * slope + domeXY * 0.6, 1.0));
  vec3 fd, fs;
  lights(p + vec3(0.0, 0.0, 0.04 * sin(u * 1.5708)), nf, 42.0, fd, fs);
  float fres = pow(1.0 - max(nf.z, 0.0), 3.0);
  vec3 frame = vec3(0.05, 0.045, 0.042) * (0.35 + fd) + fs * 0.9 + envMap(reflect(vec3(0.0, 0.0, -1.0), nf)) * (0.12 + 0.7 * fres);
  float lip = pow(1.0 - u, 2.0);
  frame += EMBER * (0.7 * hover * lip + 0.35 * focus * pow(1.0 - u, 4.0));
  frame += LIVE * 0.45 * uLibOnly * meta.g * lip;

  // ---- The poster, under slightly domed glass.
  vec2 inner = HALF - RIM;
  float edge = smoothstep(-0.32, -RIM, d);
  vec2 uv = local / (2.0 * inner) + 0.5 - g * 0.022 * edge;
  uv.y = 1.0 - uv.y;
  uv = clamp(uv, 0.004, 0.996);
  // Explicit gradients: the lookups below sit in branches that differ from cell to cell.
  vec2 dx = dFdx(uv);
  vec2 dy = dFdy(uv);
  vec3 poster;
  if (item < 0) {
    poster = vec3(0.028, 0.026, 0.024);
  } else if (meta.r < 0.5) {
    float shimmer = 0.5 + 0.5 * sin(uTime * 2.0 + float(item) * 0.7 + local.y * 3.0);
    poster = vec3(0.055, 0.05, 0.046) + 0.02 * shimmer;
  } else if (item == uFocusItem) {
    poster = textureGrad(uFocusTex, uv, dx, dy).rgb;
  } else {
    int slot = item % ${PER_LAYER};
    vec2 tile = vec2(float(slot % ${TILE_COLS}), float(slot / ${TILE_COLS}));
    vec2 scale = vec2(${TILE_COLS}.0, ${TILE_ROWS}.0);
    poster = textureGrad(uAtlas, vec3((tile + uv) / scale, float(item / ${PER_LAYER})), dx / scale, dy / scale).rgb;
  }
  // Far from the middle: darker and greyer, so the eye stays on what's in front.
  float far = smoothstep(1.2, 9.0, length(centre - uCam));
  float lum = dot(poster, vec3(0.2126, 0.7152, 0.0722));
  poster = mix(poster, vec3(lum), far * 0.7) * mix(1.0, 0.42, far);
  if (uLibOnly > 0.5 && meta.g < 0.5) poster = vec3(lum) * 0.16;

  vec3 ng = normalize(vec3(g * 0.4 * edge + domeXY * 0.35, 1.0));
  vec3 gd, gs;
  lights(p, ng, 90.0, gd, gs);
  float ao = 0.45 + 0.55 * smoothstep(0.0, 0.17, -(d + RIM));
  vec3 glass = poster * (0.8 + 0.28 * dot(gd, vec3(0.333))) * ao + gs * 0.35 + envMap(reflect(vec3(0.0, 0.0, -1.0), ng)) * 0.05;
  glass *= 1.0 + 0.12 * hover;

  float onFrame = smoothstep(-aa, aa, d + RIM);
  vec3 col = mix(glass, frame, onFrame);
  col *= mix(0.3, 1.0, domeZ);
  col = mix(BG, col, density);
  outColor = vec4(col, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Wall shader didn't compile: ${log}`);
  }
  return shader;
}

/** Draws the wall into a canvas; the component around it owns the camera and the input. */
export class WallRenderer {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  private gridTex: WebGLTexture;
  private itemsTex: WebGLTexture;
  private atlas: WebGLTexture | null = null;
  private focusTex: WebGLTexture;
  private itemsData = new Uint8Array(0);
  private itemsW = 64;
  private layout: ReturnType<typeof layoutCells> | null = null;
  private posters: WallPoster[] = [];
  private imageBase = "";
  private generation = 0;
  private queue: number[] = [];
  private queued = new Set<number>();
  private inFlight = 0;
  private mipsDirty = false;
  private lastMips = 0;
  private itemsDirty = false;
  private focusItem = -1;
  private focusWanted = -1;
  private scratch: HTMLCanvasElement;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 isn't available");
    this.gl = gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Wall shader didn't link: ${gl.getProgramInfoLog(program)}`);
    this.program = program;
    gl.useProgram(program);
    for (const name of [
      "uCenter", "uHalf", "uCam", "uZoom", "uTime", "uGridMin", "uGridSize", "uGrid", "uItems", "uItemsW",
      "uAtlas", "uFocusTex", "uFocusItem", "uHover", "uFocus", "uLibOnly",
    ]) {
      this.uniforms[name] = gl.getUniformLocation(program, name);
    }

    // One triangle that covers the screen.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.gridTex = gl.createTexture()!;
    this.itemsTex = gl.createTexture()!;
    this.focusTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.focusTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([10, 10, 10, 255]));
    this.scratch = document.createElement("canvas");
    this.scratch.width = TILE_W;
    this.scratch.height = TILE_H;
  }

  /** A new set of posters: a new layout, a new atlas, and the downloads start over. */
  setPosters(posters: WallPoster[], imageBase: string) {
    const gl = this.gl;
    this.generation++;
    this.posters = posters;
    this.imageBase = imageBase;
    this.queue = [];
    this.queued.clear();
    this.focusItem = -1;
    this.focusWanted = -1;
    const layout = layoutCells(posters.length);
    this.layout = layout;

    gl.bindTexture(gl.TEXTURE_2D, this.gridTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32I, layout.size.w, layout.size.h, 0, gl.RED_INTEGER, gl.INT, layout.grid);
    setNearest(gl);

    this.itemsW = 64;
    const rows = Math.max(1, Math.ceil(posters.length / this.itemsW));
    this.itemsData = new Uint8Array(this.itemsW * rows * 4);
    this.itemsDirty = true;

    if (this.atlas) gl.deleteTexture(this.atlas);
    this.atlas = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas);
    const layers = Math.max(1, Math.ceil(posters.length / PER_LAYER));
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 5, gl.RGBA8, TILE_W * TILE_COLS, TILE_H * TILE_ROWS, layers);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return layout;
  }

  /** Marks which posters are in the library (drawn with a green lip when "In Campfire" is on). */
  setInCampfire(flags: boolean[]) {
    flags.forEach((on, i) => {
      this.itemsData[i * 4 + 1] = on ? 255 : 0;
    });
    this.itemsDirty = true;
  }

  /** Downloads go nearest-first from this wall point; called as the camera moves. */
  prioritise(x: number, y: number) {
    const layout = this.layout;
    if (!layout) return;
    const pending: { i: number; d: number }[] = [];
    for (let i = 0; i < this.posters.length; i++) {
      if (this.itemsData[i * 4] || this.queued.has(i)) continue;
      const [cx, cy] = cellCenter(layout.itemCells[i].c, layout.itemCells[i].r);
      pending.push({ i, d: (cx - x) ** 2 + (cy - y) ** 2 });
    }
    pending.sort((a, b) => a.d - b.d);
    this.queue = pending.map((p) => p.i);
    this.pump();
  }

  private pump() {
    while (this.inFlight < LOAD_CONCURRENCY && this.queue.length) {
      const i = this.queue.shift()!;
      if (this.queued.has(i) || this.itemsData[i * 4]) continue;
      this.queued.add(i);
      this.inFlight++;
      const generation = this.generation;
      loadBitmap(`${this.imageBase}/w154${this.posters[i].posterPath}`)
        .then((bitmap) => {
          if (this.disposed || generation !== this.generation) return bitmap.close();
          this.upload(i, bitmap);
        })
        .catch(() => {
          /* a missing poster stays a dark pane */
        })
        .finally(() => {
          if (generation !== this.generation) return;
          this.inFlight--;
          this.pump();
        });
    }
  }

  private upload(i: number, bitmap: ImageBitmap) {
    const gl = this.gl;
    const ctx = this.scratch.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, TILE_W, TILE_H);
    bitmap.close();
    const slot = i % PER_LAYER;
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0,
      (slot % TILE_COLS) * TILE_W, Math.floor(slot / TILE_COLS) * TILE_H, Math.floor(i / PER_LAYER),
      TILE_W, TILE_H, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.scratch,
    );
    this.itemsData[i * 4] = 255;
    this.itemsDirty = true;
    this.mipsDirty = true;
  }

  /** The centred poster gets a sharp copy of its own. */
  setFocusItem(i: number) {
    if (i === this.focusWanted) return;
    this.focusWanted = i;
    if (i < 0) {
      this.focusItem = -1;
      return;
    }
    const generation = this.generation;
    loadBitmap(`${this.imageBase}/w342${this.posters[i].posterPath}`)
      .then((bitmap) => {
        if (this.disposed || generation !== this.generation || this.focusWanted !== i || !this.itemsData[i * 4]) {
          return bitmap.close();
        }
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.focusTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        bitmap.close();
        this.focusItem = i;
      })
      .catch(() => {});
  }

  get loadedCount() {
    let n = 0;
    for (let i = 0; i < this.posters.length; i++) if (this.itemsData[i * 4]) n++;
    return n;
  }

  render(view: {
    width: number;
    height: number;
    center: [number, number];
    half: number;
    cam: [number, number];
    zoom: number;
    time: number;
    hover: Cell | null;
    focus: Cell | null;
    libOnly: boolean;
  }) {
    const gl = this.gl;
    const layout = this.layout;
    if (!layout || !this.atlas) return;
    if (this.canvas.width !== view.width || this.canvas.height !== view.height) {
      this.canvas.width = view.width;
      this.canvas.height = view.height;
    }
    gl.viewport(0, 0, view.width, view.height);

    if (this.itemsDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.itemsTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.itemsW, this.itemsData.length / 4 / this.itemsW, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.itemsData);
      setNearest(gl);
      this.itemsDirty = false;
    }
    // Mipmaps keep far-off posters from shimmering; rebuilt now and then while posters arrive.
    if (this.mipsDirty && view.time * 1000 - this.lastMips > 400) {
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      this.mipsDirty = false;
      this.lastMips = view.time * 1000;
    }

    const u = this.uniforms;
    gl.useProgram(this.program);
    gl.uniform2f(u.uCenter, view.center[0], view.center[1]);
    gl.uniform1f(u.uHalf, view.half);
    gl.uniform2f(u.uCam, view.cam[0], view.cam[1]);
    gl.uniform1f(u.uZoom, view.zoom);
    gl.uniform1f(u.uTime, view.time);
    gl.uniform2i(u.uGridMin, layout.min.c, layout.min.r);
    gl.uniform2i(u.uGridSize, layout.size.w, layout.size.h);
    gl.uniform1i(u.uItemsW, this.itemsW);
    gl.uniform1i(u.uFocusItem, this.focusItem);
    gl.uniform2i(u.uHover, view.hover?.c ?? -99999, view.hover?.r ?? -99999);
    gl.uniform2i(u.uFocus, view.focus?.c ?? -99999, view.focus?.r ?? -99999);
    gl.uniform1f(u.uLibOnly, view.libOnly ? 1 : 0);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.gridTex);
    gl.uniform1i(u.uGrid, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.itemsTex);
    gl.uniform1i(u.uItems, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlas);
    gl.uniform1i(u.uAtlas, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.focusTex);
    gl.uniform1i(u.uFocusTex, 3);
    gl.activeTexture(gl.TEXTURE0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    const gl = this.gl;
    gl.deleteTexture(this.gridTex);
    gl.deleteTexture(this.itemsTex);
    gl.deleteTexture(this.focusTex);
    if (this.atlas) gl.deleteTexture(this.atlas);
    gl.deleteProgram(this.program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

function setNearest(gl: WebGL2RenderingContext) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url, { mode: "cors", credentials: "omit" });
  if (!res.ok) throw new Error(String(res.status));
  return createImageBitmap(await res.blob());
}

/** Screen (CSS px from the lens centre, y up) → wall point, the same lens as the shader. */
export function screenToWall(dx: number, dy: number, half: number, cam: [number, number], zoom: number): [number, number] {
  const qx = dx / half;
  const qy = dy / half;
  const f = Math.exp(LENS * (qx * qx + qy * qy));
  return [cam[0] + (qx * f) / zoom, cam[1] + (qy * f) / zoom];
}

export function supportsWall(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    const ok = Boolean(gl);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return ok;
  } catch {
    return false;
  }
}
