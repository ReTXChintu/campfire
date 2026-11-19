#version 460 core
#include <flutter/runtime_effect.glsl>

// The Explore wall (widgets/fisheye_wall.dart) — the same lens and look as the web app's
// apps/frontend/src/lib/fisheye.ts, in Flutter's shader dialect: no integer textures or texture
// arrays, so item numbers come from an RGBA index image (r + g·256 = item + 1, b = flags) and
// every poster lives in one atlas image.

precision highp float;

uniform vec2 uSize;
uniform vec2 uCenter;     // lens centre, px from the top left
uniform float uHalf;      // px per lens unit
uniform vec2 uCam;
uniform float uZoom;
uniform float uTime;
uniform vec2 uGridMin;    // column, row of the index image's first texel
uniform vec2 uGridSize;
uniform vec2 uAtlasGrid;  // columns, rows of posters in the atlas
uniform vec2 uFocus;      // cell
uniform vec2 uHover;      // cell
uniform float uFocusItem; // item with a sharp copy in uFocusTex, or -1
uniform float uLibOnly;

uniform sampler2D uIndex;
uniform sampler2D uAtlas;
uniform sampler2D uFocusTex;

out vec4 fragColor;

const float LENS = 1.0;
const vec2 PITCH = vec2(1.16, 1.66);
const vec2 HALF = vec2(0.5, 0.75);
const float RAD = 0.13;
const float RIM = 0.05;
const float HALF_GAP = 0.08;
const vec3 BG = vec3(0.043, 0.039, 0.035);
const vec3 EMBER = vec3(1.0, 0.416, 0.239);
const vec3 LIVE = vec3(0.247, 0.796, 0.557);

vec3 envMap(vec3 r) {
  float warm = pow(max(r.y * 0.5 + 0.5, 0.0), 5.0);
  float cool = pow(max(-r.x * 0.5 + 0.5, 0.0), 7.0);
  float band = smoothstep(0.75, 1.0, sin(r.x * 3.0 + r.y * 5.0 + uTime * 0.15) * 0.5 + 0.5);
  return vec3(0.02) + warm * vec3(0.55, 0.33, 0.2) + cool * vec3(0.18, 0.24, 0.38) + band * 0.05;
}

void lightUp(vec3 p, vec3 n, float shininess, vec3 lp, vec3 lc, inout vec3 diff, inout vec3 spec) {
  vec3 d = lp - p;
  float dist = length(d);
  vec3 l = d / dist;
  float att = 1.0 / (1.0 + dist * dist * 0.6);
  diff += max(dot(n, l), 0.0) * att * lc;
  spec += pow(max(dot(reflect(-l, n), vec3(0.0, 0.0, 1.0)), 0.0), shininess) * att * lc;
}

void lights(vec3 p, vec3 n, float shininess, out vec3 diff, out vec3 spec) {
  diff = vec3(0.0);
  spec = vec3(0.0);
  lightUp(p, n, shininess, vec3(0.95 * sin(uTime * 0.31), 0.55 * cos(uTime * 0.23) + 0.25, 1.1), vec3(1.0, 0.66, 0.44) * 1.15, diff, spec);
  lightUp(p, n, shininess, vec3(-0.9 * cos(uTime * 0.27), -0.6 * sin(uTime * 0.19) - 0.1, 0.9), vec3(0.52, 0.66, 1.0) * 0.8, diff, spec);
}

void main() {
  vec2 frag = FlutterFragCoord().xy;
  vec2 q = vec2(frag.x - uCenter.x, uCenter.y - frag.y) / uHalf;
  float r2 = dot(q, q);
  float f = exp(LENS * r2);
  vec2 w = uCam + q * f / uZoom;

  float radial = f * (1.0 + 2.0 * LENS * r2);
  float cellPx = 1.5 * uZoom / radial * uHalf;
  float density = smoothstep(2.0, 9.0, cellPx);
  float aa = radial / (uZoom * uHalf); // wall units per pixel, for smooth edges

  float c = floor(w.x / PITCH.x + 0.5);
  float oy = mod(c, 2.0) * PITCH.y * 0.5;
  float r = floor((w.y - oy) / PITCH.y + 0.5);
  vec2 centre = vec2(c * PITCH.x, r * PITCH.y + oy);
  vec2 local = w - centre;

  vec2 qb = abs(local) - HALF + RAD;
  float d = length(max(qb, 0.0)) + min(max(qb.x, qb.y), 0.0) - RAD;
  vec2 sl = vec2(local.x >= 0.0 ? 1.0 : -1.0, local.y >= 0.0 ? 1.0 : -1.0);
  vec2 g = (qb.x > 0.0 && qb.y > 0.0) ? normalize(qb) * sl : (qb.x > qb.y ? vec2(sl.x, 0.0) : vec2(0.0, sl.y));

  // Which item, from the index image.
  vec2 gc = vec2(c, r) - uGridMin;
  float item = -1.0;
  float loaded = 0.0;
  float lib = 0.0;
  if (gc.x >= 0.0 && gc.y >= 0.0 && gc.x < uGridSize.x && gc.y < uGridSize.y) {
    vec4 t = texture(uIndex, (gc + 0.5) / uGridSize);
    item = floor(t.r * 255.0 + 0.5) + floor(t.g * 255.0 + 0.5) * 256.0 - 1.0;
    float flags = floor(t.b * 255.0 + 0.5);
    loaded = mod(flags, 2.0);
    lib = floor(flags / 2.0);
  }
  float hover = length(vec2(c, r) - uHover) < 0.5 ? 1.0 : 0.0;
  float focus = length(vec2(c, r) - uFocus) < 0.5 ? 1.0 : 0.0;

  float rd = sqrt(r2) / 1.45;
  float domeZ = sqrt(max(0.0, 1.0 - rd * rd));
  vec2 domeXY = q / 1.45;
  vec3 p = vec3(q, 0.0);

  // The frame: a rounded ridge from the poster's edge to the middle of the gap.
  float span = HALF_GAP + RIM;
  float u = clamp((d + RIM) / span, 0.0, 1.0);
  float slope = 0.12 * 1.5708 * cos(u * 1.5708) / span;
  vec3 nf = normalize(vec3(-g * slope + domeXY * 0.6, 1.0));
  vec3 fd;
  vec3 fs;
  lights(p + vec3(0.0, 0.0, 0.04 * sin(u * 1.5708)), nf, 42.0, fd, fs);
  float fres = pow(1.0 - max(nf.z, 0.0), 3.0);
  vec3 frame = vec3(0.05, 0.045, 0.042) * (0.35 + fd) + fs * 0.9 + envMap(reflect(vec3(0.0, 0.0, -1.0), nf)) * (0.12 + 0.7 * fres);
  float lip = pow(1.0 - u, 2.0);
  frame += EMBER * (0.7 * hover * lip + 0.35 * focus * pow(1.0 - u, 4.0));
  frame += LIVE * 0.45 * uLibOnly * lib * lip;

  // The poster, under slightly domed glass.
  vec2 inner = HALF - RIM;
  float edge = smoothstep(-0.32, -RIM, d);
  vec2 uv = local / (2.0 * inner) + 0.5 - g * 0.022 * edge;
  uv.y = 1.0 - uv.y;
  uv = clamp(uv, 0.004, 0.996);
  vec3 poster;
  if (item < 0.0) {
    poster = vec3(0.028, 0.026, 0.024);
  } else if (loaded < 0.5) {
    float shimmer = 0.5 + 0.5 * sin(uTime * 2.0 + item * 0.7 + local.y * 3.0);
    poster = vec3(0.055, 0.05, 0.046) + 0.02 * shimmer;
  } else if (abs(item - uFocusItem) < 0.5) {
    poster = texture(uFocusTex, uv).rgb;
  } else {
    float col = mod(item, uAtlasGrid.x);
    float row = floor(item / uAtlasGrid.x);
    poster = texture(uAtlas, (vec2(col, row) + uv) / uAtlasGrid).rgb;
  }
  float far = smoothstep(1.2, 9.0, length(centre - uCam));
  float lum = dot(poster, vec3(0.2126, 0.7152, 0.0722));
  poster = mix(poster, vec3(lum), far * 0.7) * mix(1.0, 0.42, far);
  if (uLibOnly > 0.5 && lib < 0.5) poster = vec3(lum) * 0.16;

  vec3 ng = normalize(vec3(g * 0.4 * edge + domeXY * 0.35, 1.0));
  vec3 gd;
  vec3 gs;
  lights(p, ng, 90.0, gd, gs);
  float ao = 0.45 + 0.55 * smoothstep(0.0, 0.17, -(d + RIM));
  vec3 glass = poster * (0.8 + 0.28 * dot(gd, vec3(0.333))) * ao + gs * 0.35 + envMap(reflect(vec3(0.0, 0.0, -1.0), ng)) * 0.05;
  glass *= 1.0 + 0.12 * hover;

  float onFrame = smoothstep(-aa, aa, d + RIM);
  vec3 colOut = mix(glass, frame, onFrame);
  colOut *= mix(0.3, 1.0, domeZ);
  colOut = mix(BG, colOut, density);
  fragColor = vec4(colOut, 1.0);
}
