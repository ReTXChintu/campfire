import { useEffect, useMemo, useRef, useState } from "react";
import { cellAt, cellCenter, layoutCells, PITCH_X, screenToWall, WallRenderer, type Cell } from "../../lib/fisheye";
import type { WallItem } from "../../lib/explore";
import { Star } from "./ExploreRow";

/** A request from outside to bring one title to the middle (a search pick, say). */
export type GlideRequest = { key: string; open: boolean; nonce: number };

const DRAG_SLOP_PX = 6;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 2.6;
const keyOf = (item: Pick<WallItem, "tmdbType" | "tmdbId">) => `${item.tmdbType}-${item.tmdbId}`;

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/**
 * The fisheye wall (lib/fisheye.ts draws it): drag to move it (it coasts, then settles with a
 * poster in the middle), scroll or pinch to push the lens in and out, click a poster to bring it
 * to the middle and open where to watch. Keyboard: arrows move one poster, Enter opens, + and −
 * zoom, 0 resets. The poster in the middle is named in the card at the bottom left.
 */
export default function FisheyeWall({
  items,
  imageBase,
  libOnly,
  glide,
  onOpen,
  onFail,
}: {
  items: WallItem[];
  imageBase: string;
  libOnly: boolean;
  glide: GlideRequest | null;
  onOpen: (item: WallItem) => void;
  onFail: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const [live, setLive] = useState("");
  const [loaded, setLoaded] = useState(0);

  // Phones get fewer posters: a texture array is memory, and a small screen shows fewer anyway.
  const shown = useMemo(() => {
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    return items.slice(0, small ? 360 : 720);
  }, [items]);
  const layout = useMemo(() => layoutCells(shown.length), [shown.length]);
  const indexByKey = useMemo(() => new Map(shown.map((item, i) => [keyOf(item), i])), [shown]);

  // Everything the animation loop reads lives in one ref, so input never waits on a re-render.
  const state = useRef({
    cam: [0, 0] as [number, number],
    camTarget: [0, 0] as [number, number],
    vel: [0, 0] as [number, number],
    zoom: 1,
    zoomTarget: 1,
    dragging: false,
    coasting: false,
    pointers: new Map<number, { x: number; y: number }>(),
    pinchDist: 0,
    moved: 0,
    down: { x: 0, y: 0, t: 0 },
    last: { x: 0, y: 0, t: 0 },
    hoverCell: null as Cell | null,
    focusCell: { c: 0, r: 0 } as Cell,
    focusIndex: 0,
    pendingOpen: -1,
    lastInput: performance.now(),
    viaKeyboard: false,
    css: { w: 1, h: 1 },
    dpr: Math.min(window.devicePixelRatio || 1, 1.5),
    libOnly,
    reduced: prefersReducedMotion(),
  });
  state.current.libOnly = libOnly;

  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;
  const shownRef = useRef(shown);
  shownRef.current = shown;

  /** The lens centre in CSS px from the left and bottom. */
  const lensCentre = () => {
    const s = state.current;
    return [s.css.w / 2, s.css.h / 2] as const;
  };
  const halfOf = () => 0.5 * Math.min(state.current.css.w, state.current.css.h);
  /** Zoom 1 makes the middle poster about 40% of the height (more of the width on a phone). */
  const baseZoom = () => {
    const { w, h } = state.current.css;
    const targetPx = Math.max(170, Math.min(h * 0.42, w * 0.62 * 1.5, 440));
    return targetPx / (1.5 * halfOf());
  };

  const glideTo = (index: number, open: boolean) => {
    const s = state.current;
    const cell = layout.itemCells[index];
    if (!cell) return;
    const [x, y] = cellCenter(cell.c, cell.r);
    s.camTarget = [x, y];
    s.vel = [0, 0];
    s.coasting = false;
    if (s.reduced) s.cam = [x, y];
    s.pendingOpen = open ? index : -1;
  };

  // ---- The renderer and the animation loop -------------------------------------------------------
  useEffect(() => {
    const el = canvas.current;
    const box = wrap.current;
    if (!el || !box) return;
    let renderer: WallRenderer;
    try {
      renderer = new WallRenderer(el);
    } catch (error) {
      console.warn(error);
      onFailRef.current();
      return;
    }
    renderer.setPosters(shown, imageBase);
    renderer.setInCampfire(shown.map((i) => i.inCampfire));
    const s = state.current;
    s.cam = [0, 0];
    s.camTarget = [0, 0];
    s.vel = [0, 0];
    s.focusCell = { c: 0, r: 0 };
    s.focusIndex = 0;
    setFocusIndex(0);
    renderer.prioritise(0, 0);

    const onLost = (e: Event) => {
      e.preventDefault();
      onFailRef.current();
    };
    el.addEventListener("webglcontextlost", onLost);

    const resize = new ResizeObserver(([entry]) => {
      s.css = { w: Math.max(1, entry.contentRect.width), h: Math.max(1, entry.contentRect.height) };
    });
    resize.observe(box);

    let raf = 0;
    let prev = performance.now();
    let slowFrames = 0;
    let lastPriority = 0;
    let focusSince = 0;
    let loadedShown = -1;
    const start = prev;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;

      // Too slow to keep up? Draw fewer pixels.
      if (dt > 0.03) slowFrames++;
      else slowFrames = Math.max(0, slowFrames - 1);
      if (slowFrames > 40 && s.dpr > 0.75) {
        s.dpr -= 0.25;
        slowFrames = 0;
      }

      // Camera: follows the finger while dragging, coasts after a flick, then settles on a poster.
      if (!s.dragging) {
        if (s.coasting) {
          s.cam[0] += s.vel[0] * dt;
          s.cam[1] += s.vel[1] * dt;
          const decay = Math.exp(-dt * 3.2);
          s.vel[0] *= decay;
          s.vel[1] *= decay;
          if (Math.hypot(s.vel[0], s.vel[1]) < 0.35) {
            s.coasting = false;
            const cell = cellAt(s.cam[0], s.cam[1]);
            const index = layout.itemAt(cell.c, cell.r);
            s.camTarget = index >= 0 ? cellCenter(cell.c, cell.r) : [...s.cam];
          }
        } else {
          const k = s.reduced ? 1 : 1 - Math.exp(-dt * 8);
          s.cam[0] += (s.camTarget[0] - s.cam[0]) * k;
          s.cam[1] += (s.camTarget[1] - s.cam[1]) * k;
        }
      }
      // Never wander far past the last poster.
      const m = Math.hypot(s.cam[0] / 1.5, s.cam[1]);
      const limit = layout.extent + 1;
      if (m > limit) {
        s.cam[0] *= limit / m;
        s.cam[1] *= limit / m;
        s.vel = [0, 0];
      }
      s.zoom += (s.zoomTarget - s.zoom) * (s.reduced ? 1 : 1 - Math.exp(-dt * 10));

      // The poster under the middle of the lens.
      const fc = cellAt(s.cam[0], s.cam[1]);
      const fi = layout.itemAt(fc.c, fc.r);
      if (fc.c !== s.focusCell.c || fc.r !== s.focusCell.r) {
        s.focusCell = fc;
        focusSince = now;
        if (fi >= 0 && fi !== s.focusIndex) {
          s.focusIndex = fi;
          setFocusIndex(fi);
          if (s.viaKeyboard) {
            const item = shownRef.current[fi];
            setLive(`${item.title}${item.year ? `, ${item.year}` : ""}, ${item.tmdbType === "tv" ? "series" : "film"}`);
          }
        }
      }
      if (fi >= 0 && now - focusSince > 180) renderer.setFocusItem(fi);
      if (now - lastPriority > 600) {
        renderer.prioritise(s.cam[0], s.cam[1]);
        lastPriority = now;
        const count = renderer.loadedCount;
        if (count !== loadedShown) {
          loadedShown = count;
          setLoaded(count);
        }
      }

      // A click or a search pick opens its title once the glide has nearly arrived.
      if (s.pendingOpen >= 0 && Math.hypot(s.cam[0] - s.camTarget[0], s.cam[1] - s.camTarget[1]) < 0.08) {
        const item = shownRef.current[s.pendingOpen];
        s.pendingOpen = -1;
        if (item) onOpenRef.current(item);
      }

      const [cx, cy] = lensCentre();
      const dpr = s.dpr;
      renderer.render({
        width: Math.round(s.css.w * dpr),
        height: Math.round(s.css.h * dpr),
        center: [cx * dpr, cy * dpr],
        half: halfOf() * dpr,
        cam: s.cam,
        zoom: s.zoom * baseZoom(),
        time: s.reduced ? 6 : (now - start) / 1000,
        hover: s.hoverCell,
        focus: s.focusCell,
        libOnly: s.libOnly,
      });
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      el.removeEventListener("webglcontextlost", onLost);
      renderer.dispose();
    };
    // A new set of posters is a new wall; everything else is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, imageBase, layout]);

  // A search pick or "surprise me" from outside.
  useEffect(() => {
    if (!glide) return;
    const index = indexByKey.get(glide.key);
    if (index !== undefined) glideTo(index, glide.open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glide?.nonce]);

  // ---- Input ------------------------------------------------------------------------------------
  /** Pointer position → the item under it (or -1), in the same lens as the drawing. */
  const pick = (clientX: number, clientY: number) => {
    const box = wrap.current!.getBoundingClientRect();
    const [cx, cy] = lensCentre();
    const s = state.current;
    const [x, y] = screenToWall(clientX - box.left - cx, box.bottom - clientY - cy, halfOf(), s.cam, s.zoom * baseZoom());
    const cell = cellAt(x, y);
    return { cell, index: layout.itemAt(cell.c, cell.r) };
  };

  useEffect(() => {
    const box = wrap.current;
    if (!box) return;
    // Not a React handler: the wheel has to be non-passive to keep the page from scrolling.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = state.current;
      const delta = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      s.zoomTarget = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s.zoomTarget * Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015))));
      s.lastInput = performance.now();
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    const s = state.current;
    wrap.current?.setPointerCapture(e.pointerId);
    s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    s.viaKeyboard = false;
    s.lastInput = performance.now();
    if (s.pointers.size === 2) {
      const [a, b] = [...s.pointers.values()];
      s.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      s.moved = DRAG_SLOP_PX + 1; // a pinch is never a click
      return;
    }
    s.dragging = true;
    s.coasting = false;
    s.pendingOpen = -1;
    s.moved = 0;
    s.vel = [0, 0];
    s.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    s.last = { ...s.down };
    s.camTarget = [...s.cam];
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = state.current;
    if (s.pointers.has(e.pointerId)) s.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (s.pointers.size === 2) {
      const [a, b] = [...s.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (s.pinchDist > 0) s.zoomTarget = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s.zoomTarget * (dist / s.pinchDist)));
      s.pinchDist = dist;
      return;
    }
    if (s.dragging) {
      const now = performance.now();
      const dx = e.clientX - s.last.x;
      const dy = e.clientY - s.last.y;
      s.moved += Math.abs(dx) + Math.abs(dy);
      const scale = 1 / (halfOf() * s.zoom * baseZoom());
      s.cam[0] -= dx * scale;
      s.cam[1] += dy * scale;
      s.camTarget = [...s.cam];
      const dtS = Math.max(0.001, (now - s.last.t) / 1000);
      // Smoothed, so the flick speed is the last few moves', not just the very last one's.
      s.vel = [s.vel[0] * 0.6 + ((-dx * scale) / dtS) * 0.4, s.vel[1] * 0.6 + ((dy * scale) / dtS) * 0.4];
      s.last = { x: e.clientX, y: e.clientY, t: now };
      if (s.hoverCell) {
        s.hoverCell = null;
        setHover(null);
      }
      return;
    }
    if (e.pointerType === "mouse") {
      const { cell, index } = pick(e.clientX, e.clientY);
      s.hoverCell = index >= 0 ? cell : null;
      const box = wrap.current!.getBoundingClientRect();
      setHover(index >= 0 && index !== s.focusIndex ? { index, x: e.clientX - box.left, y: e.clientY - box.top } : null);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const s = state.current;
    s.pointers.delete(e.pointerId);
    if (s.pointers.size > 0) return;
    s.pinchDist = 0;
    if (!s.dragging) return;
    s.dragging = false;
    if (s.moved <= DRAG_SLOP_PX) {
      const { index } = pick(e.clientX, e.clientY);
      if (index >= 0) glideTo(index, true);
      return;
    }
    const idle = performance.now() - s.last.t > 90; // held still before letting go: no flick
    if (!idle && !s.reduced && Math.hypot(s.vel[0], s.vel[1]) > 0.8) {
      const speed = Math.hypot(s.vel[0], s.vel[1]);
      const cap = 28 / speed;
      if (cap < 1) s.vel = [s.vel[0] * cap, s.vel[1] * cap];
      s.coasting = true;
    } else {
      const cell = cellAt(s.cam[0], s.cam[1]);
      if (layout.itemAt(cell.c, cell.r) >= 0) s.camTarget = cellCenter(cell.c, cell.r);
    }
  };

  const onPointerLeave = () => {
    state.current.hoverCell = null;
    setHover(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const s = state.current;
    const { c, r } = s.focusCell;
    let next: Cell | null = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const nc = c + (e.key === "ArrowLeft" ? -1 : 1);
      // The next column is staggered by half a poster: take whichever row sits nearest.
      const [, y] = cellCenter(c, r);
      next = cellAt(nc * PITCH_X, y + 0.001);
      next = { c: nc, r: next.r };
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      next = { c, r: r + (e.key === "ArrowUp" ? 1 : -1) };
    } else if (e.key === "Enter" || e.key === " ") {
      const item = shown[s.focusIndex];
      if (item) {
        e.preventDefault();
        onOpen(item);
      }
      return;
    } else if (e.key === "+" || e.key === "=") {
      s.zoomTarget = Math.min(ZOOM_MAX, s.zoomTarget * 1.25);
    } else if (e.key === "-" || e.key === "_") {
      s.zoomTarget = Math.max(ZOOM_MIN, s.zoomTarget / 1.25);
    } else if (e.key === "0") {
      s.zoomTarget = 1;
      glideTo(0, false);
    } else {
      return;
    }
    e.preventDefault();
    s.viaKeyboard = true;
    if (next) {
      const index = layout.itemAt(next.c, next.r);
      if (index >= 0) glideTo(index, false);
    }
  };

  const surprise = () => {
    const pool = shown.map((item, i) => ({ item, i })).filter(({ item, i }) => i < 400 && (item.rating ?? 0) >= 7.2);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) glideTo(pick.i, true);
  };

  const focused = shown[focusIndex];
  const hovered = hover ? shown[hover.index] : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#0b0a09]">
      <div
        ref={wrap}
        tabIndex={0}
        role="application"
        aria-roledescription="poster wall"
        aria-label="Poster wall. Arrow keys move between posters, Enter opens one, plus and minus zoom."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        className="absolute inset-0 cursor-grab touch-none select-none outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
      >
        <canvas ref={canvas} className="block h-full w-full" />
      </div>

      <p className="sr-only" aria-live="polite">
        {live}
      </p>

      {hovered && hover && (
        <div
          className="pointer-events-none absolute z-10 max-w-[240px] rounded-lg border border-white/10 bg-black/80 px-2.5 py-1.5 text-xs text-white shadow-xl backdrop-blur"
          style={{ left: hover.x + 16, top: hover.y + 14 }}
        >
          <span className="font-semibold">{hovered.title}</span>
          {hovered.year && <span className="text-text-secondary"> · {hovered.year}</span>}
        </div>
      )}

      {focused && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-4 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-4 pb-4 pt-16 sm:px-6 lg:px-8 lg:pb-6">
          <div className="pointer-events-auto grid max-w-[560px] gap-2">
            <div className="flex flex-wrap items-center gap-2">
              {focused.inCampfire && (
                <span className="rounded-md bg-live px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-background">IN CAMPFIRE</span>
              )}
              <span className="text-[11px] font-bold tracking-[0.12em] text-text-tertiary">{focused.tmdbType === "tv" ? "SERIES" : "FILM"}</span>
            </div>
            <h2 className="font-display text-[clamp(32px,4.4vw,56px)] leading-[0.95] tracking-[0.01em] text-white [text-shadow:0_2px_18px_rgba(0,0,0,0.7)]">
              {focused.title}
            </h2>
            <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-text-secondary">
              {focused.rating !== null && (
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  <Star className="h-3.5 w-3.5 text-amber" />
                  {focused.rating.toFixed(1)}
                </span>
              )}
              {focused.year && <span>{focused.year}</span>}
              {focused.genres.length > 0 && <span>{focused.genres.join(" · ")}</span>}
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onOpen(focused)}
                className="min-h-11 rounded-xl bg-accent px-5 text-sm font-bold text-background transition hover:brightness-110"
              >
                Where to watch
              </button>
              <button
                type="button"
                onClick={surprise}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 bg-black/50 px-4 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/10"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
                </svg>
                Surprise me
              </button>
            </div>
          </div>
          <div className="hidden shrink-0 gap-1.5 text-right text-[11px] text-text-tertiary md:grid">
            <span>
              <Kbd>Drag</Kbd> move · <Kbd>Scroll</Kbd> zoom · <Kbd>Click</Kbd> open
            </span>
            <span>
              <Kbd>←</Kbd>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              <Kbd>→</Kbd> step · <Kbd>Enter</Kbd> open · <Kbd>+</Kbd>
              <Kbd>−</Kbd> zoom
            </span>
            {loaded < shown.length && (
              <span aria-hidden="true">
                {loaded} of {shown.length} posters
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 inline-grid min-w-[1.6rem] place-items-center rounded-md border border-white/15 border-b-white/25 bg-white/[0.06] px-1.5 py-0.5 font-sans text-[11px] font-semibold text-text-secondary">
      {children}
    </kbd>
  );
}
