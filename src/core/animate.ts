import { easings } from './easing.ts';
import { lerpColor } from './color.ts';
import { center, lerpPath, pathLength, pointAlong, rect, transformPoint } from './geometry.ts';
import type { Frame } from './render.ts';
import { nodeBox } from './render.ts';
import type { RNode } from './widget.ts';

export type TransitionKind = 'morph' | 'fade' | 'cut' | 'wipe' | 'iris' | 'slide' | 'push' | 'zoom-in' | 'zoom-out';
export type Direction = 'left' | 'right' | 'up' | 'down';
export type IrisShape = 'circle' | 'diamond' | 'square' | 'star';
export const DIRECTIONS: Direction[] = ['left', 'right', 'up', 'down'];
export const IRIS_SHAPES: IrisShape[] = ['circle', 'diamond', 'square', 'star'];

/** Options of the whole-picture transitions (wipe, iris, slide, push). */
export interface TransitionStyle {
  /** where things move: wipe's edge (default right), slide/push's pictures (default left) */
  direction?: Direction;
  shape?: IrisShape;
  /** zoom-in: the widget of the current slide the next one grows out of; zoom-out: the widget of the next slide the current one shrinks into */
  target?: string;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const COLOR_ATTRS = new Set(['fill', 'stroke', 'stop-color']);
const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g;

/** Frame shown while holding (transient nodes are only visible while they appear). */
export function still(f: Frame): Frame {
  return { view: f.view, nodes: f.nodes.filter((n) => !n.transient), boxes: f.boxes };
}

/**
 * Interpolate two frames. Nodes are matched by key ("magic move"):
 * matched nodes tween their attributes, new ones play their enter effect,
 * vanished ones play their exit effect.
 */
export function interpolate(A: Frame, B: Frame, p: number, kind: TransitionKind, style: TransitionStyle = {}, elapsed?: number): Frame {
  if (kind === 'wipe' || kind === 'iris' || kind === 'slide' || kind === 'push') return reveal(A, B, p, kind, style);
  // Prezi-like: fly into a part of the slide, which opens up into the next one (and back out)
  if (kind === 'zoom-in') return zoom(A, B, p, style.target ? A.boxes?.[style.target] : undefined, B.view);
  if (kind === 'zoom-out') return zoom(B, A, 1 - p, style.target ? B.boxes?.[style.target] : undefined, B.view);
  const view = rect(lerp(A.view.x, B.view.x, p), lerp(A.view.y, B.view.y, p), lerp(A.view.w, B.view.w, p), lerp(A.view.h, B.view.h, p));
  const aNodes = A.nodes.filter((n) => !n.transient);
  if (kind === 'cut') return p < 1 ? { view: A.view, nodes: aNodes } : still(B);
  if (kind === 'fade') {
    const out: RNode[] = [];
    for (const a of aNodes) push(out, effect(a, 'fade', 1 - p));
    for (const b of B.nodes) if (!b.transient) push(out, effect(b, 'fade', p));
    return { view, nodes: out };
  }

  const aMap = new Map(aNodes.map((n) => [n.key, n]));
  const aTransient = new Set(A.nodes.filter((n) => n.transient).map((n) => n.key));
  const bKeys = new Set(B.nodes.map((n) => n.key));
  // exiting nodes are drawn right after the last surviving node that preceded them
  const exitAfter = new Map<string, RNode[]>();
  let prev = '';
  for (const a of aNodes) {
    if (bKeys.has(a.key)) prev = a.key;
    else {
      if (!exitAfter.has(prev)) exitAfter.set(prev, []);
      exitAfter.get(prev)!.push(a);
    }
  }

  const out: RNode[] = [];
  const flushExits = (k: string) => {
    for (const a of exitAfter.get(k) ?? []) push(out, effect(a, a.exit ?? 'fade', 1 - p));
  };
  flushExits('');
  for (const b of B.nodes) {
    const a = aMap.get(b.key);
    if (b.transient) {
      // only on the step that creates it
      if (!aTransient.has(b.key) && (b.timing ? (elapsed ?? p * b.timing.duration) < b.timing.duration : p < 1)) {
        if (b.timing) out.push(...timed(b, b.origin ? aMap.get(b.origin) : undefined, elapsed ?? p * b.timing.duration));
        else if (b.leave === undefined) push(out, effect(b, b.enter ?? 'fade', p));
        else out.push(...staged(b, b.origin ? aMap.get(b.origin) : undefined, p));
      }
      continue;
    }
    if (a) {
      tween(out, a, b, p);
      flushExits(b.key);
      continue;
    }
    const src = b.origin ? aMap.get(b.origin) : undefined;
    if (b.timing) out.push(...timed(b, src, elapsed ?? p * b.timing.duration));
    else if (src && src.tag === b.tag) tween(out, { ...src, key: b.key }, b, p);
    else push(out, effect(b, b.enter ?? 'fade', b.delay ? Math.max(0, Math.min(1, (p - b.delay) / (1 - b.delay))) : p));
  }
  return { view, nodes: out };
}

const MOTION: Record<Direction, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

/**
 * Keynote-style transitions of the whole picture: the next picture is revealed
 * by a moving edge (wipe) or a growing shape (iris), or slides in over the
 * previous one (slide) or pushes it out (push). Each picture is clipped to its
 * part of the screen, so nothing shows through the other's empty areas.
 */
function reveal(A: Frame, B: Frame, p: number, kind: TransitionKind, style: TransitionStyle): Frame {
  const V = B.view;
  const q = Math.max(0, Math.min(1, p));
  const [ux, uy] = MOTION[style.direction ?? (kind === 'wipe' ? 'right' : 'left')];
  // B covers the fraction q of the screen on the side it comes from (opposite to the motion), A the rest
  const band = (f: number, side: 1 | -1) => {
    // side -1: anchored where the motion comes from, 1: where it goes
    const w = ux ? V.w * f : V.w, h = uy ? V.h * f : V.h;
    const x = ux === side ? V.x + V.w - w : V.x, y = uy === side ? V.y + V.h - h : V.y;
    return boxPath(x, y, w, h);
  };
  let clipA: string, clipB: string;
  let offA = [0, 0], offB = [0, 0];
  if (kind === 'iris') {
    clipB = irisPath(style.shape ?? 'circle', V, q);
    clipA = `${boxPath(V.x, V.y, V.w, V.h)} ${clipB}`;
  } else {
    clipB = band(q, -1);
    clipA = band(1 - q, 1);
    if (kind !== 'wipe') offB = [-ux * (1 - p) * V.w, -uy * (1 - p) * V.h];
    if (kind === 'push') offA = [ux * p * V.w, uy * p * V.h];
  }
  // A is drawn in B's view: map its camera onto B's, then shift it
  const s = V.w / A.view.w;
  const a = A.nodes.filter((n) => !n.transient).map((n) => shift(n, V.x - A.view.x * s + offA[0], V.y - A.view.y * s + offA[1], s));
  const b = B.nodes.filter((n) => !n.transient).map((n) => shift(n, offB[0], offB[1], 1));
  return {
    view: V,
    nodes: [...a, ...b],
    clips: [
      { from: 0, to: a.length, d: clipA },
      { from: a.length, to: a.length + b.length, d: clipB },
    ],
  };
}

/**
 * The camera flies from `big`'s view into `target` (a rect of `big`), while
 * `small` (a whole slide) sits exactly where the target is, growing with it
 * until it fills the screen at q = 1. `big` fades out on the way in; the
 * detail slide is always drawn over the overview.
 */
function zoom(big: Frame, small: Frame, q: number, target: Frame['view'] | undefined, out: Frame['view']): Frame {
  const V = big.view;
  const aspect = V.h / V.w;
  // the target, widened to the screen's shape (and a little margin); without one, the middle quarter
  let R = target && target.w > 0 && target.h > 0 ? target : { x: V.x + V.w * 0.375, y: V.y + V.h * 0.375, w: V.w / 4, h: V.h / 4 };
  const w = Math.max(R.w, R.h / aspect) * 1.1;
  R = { x: R.x + R.w / 2 - w / 2, y: R.y + R.h / 2 - (w * aspect) / 2, w, h: w * aspect };
  // camera: the center moves linearly, the width shrinks geometrically (a steady zoom)
  const cw = V.w * Math.pow(R.w / V.w, q);
  const f = V.w === R.w ? q : (V.w - cw) / (V.w - R.w);
  const C = { x: V.x + (R.x - V.x) * f, y: V.y + (R.y - V.y) * f, w: cw, h: cw * aspect };
  const s = out.w / C.w, tx = out.x - C.x * s, ty = out.y - C.y * s;
  // where the target is on screen now: the next slide fills it
  const ro = { x: R.x * s + tx, y: R.y * s + ty, w: R.w * s };
  const s2 = ro.w / small.view.w;
  const bigOp = 1 - Math.max(0, Math.min(1, (q - 0.45) / 0.55));
  const smallOp = Math.max(0, Math.min(1, q / 0.55));
  const a = big.nodes.filter((n) => !n.transient).map((n) => effect(shift(n, tx, ty, s), 'fade', bigOp)).filter((n): n is RNode => !!n);
  const b = small.nodes.filter((n) => !n.transient).map((n) => effect(shift(n, ro.x - small.view.x * s2, ro.y - small.view.y * s2, s2), 'fade', smallOp)).filter((n): n is RNode => !!n);
  return { view: out, nodes: [...a, ...b] };
}

const boxPath = (x: number, y: number, w: number, h: number) => `M${x} ${y}h${w}v${h}h${-w}Z`;

/** The iris opening at progress q: from a point to a shape that covers the whole view. */
function irisPath(shape: IrisShape, V: Frame['view'], q: number): string {
  const { x: cx, y: cy } = center(V);
  const half = Math.hypot(V.w, V.h) / 2;
  switch (shape) {
    case 'square': {
      const r = (q * Math.max(V.w, V.h)) / 2;
      return boxPath(cx - r, cy - r, 2 * r, 2 * r);
    }
    case 'diamond': {
      const r = (q * (V.w + V.h)) / 2;
      return `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`;
    }
    case 'star': {
      // the inner corners reach the screen corners at the end
      const ri = q * half * 1.05, ro = ri * 2.2;
      const pts = Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 ? ri : ro, a = -Math.PI / 2 + (i * Math.PI) / 5;
        return `${+(cx + r * Math.cos(a)).toFixed(2)} ${+(cy + r * Math.sin(a)).toFixed(2)}`;
      });
      return `M${pts.join('L')}Z`;
    }
    default: {
      const r = q * half;
      return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
    }
  }
}

/** Move (and scale) a node in the picture without touching its own coordinates. */
function shift(n: RNode, dx: number, dy: number, s: number): RNode {
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01 && Math.abs(s - 1) < 1e-6) return n;
  const t = Math.abs(s - 1) < 1e-6 ? `translate(${dx} ${dy})` : `translate(${dx} ${dy}) scale(${s})`;
  return { ...n, attrs: { ...n.attrs, transform: n.attrs.transform ? `${t} ${n.attrs.transform}` : t } };
}

/** Enter and optionally leave on a local millisecond clock, independent of step easing. */
function timed(b: RNode, src: RNode | undefined, elapsed: number): RNode[] {
  const t = b.timing!;
  const progress = (start: number, end: number) => end <= start ? (elapsed >= end ? 1 : 0) : Math.max(0, Math.min(1, (elapsed - start) / (end - start)));
  const q = (easings[t.easing] ?? easings.linear)(progress(t.start, t.end));
  const out: RNode[] = [];
  if (src && src.tag === b.tag) tween(out, { ...src, key: b.key, text: b.text }, b, q);
  else push(out, effect(b, b.enter ?? 'fade', q));
  if (t.leave === undefined) return out;
  const k = 1 - (easings[t.exitEasing ?? 'linear'] ?? easings.linear)(progress(t.leave, t.gone ?? t.duration));
  return out.map((n) => ({ ...n, attrs: { ...n.attrs, opacity: Number(n.attrs.opacity ?? 1) * k } }));
}

/** Legacy fraction-based transient phases, driven by the enclosing transition. */
function staged(b: RNode, src: RNode | undefined, p: number): RNode[] {
  const out: RNode[] = [];
  const leave = b.leave ?? 1;
  if (src && src.tag === b.tag) tween(out, { ...src, key: b.key, text: b.text }, b, Math.min(1, p / (b.arrive ?? 1)));
  else {
    const d = b.delay ?? 0;
    push(out, effect(b, b.enter ?? 'fade', Math.max(0, Math.min(1, (p - d) / Math.max(0.01, leave - d)))));
  }
  if (p <= leave) return out;
  const k = Math.max(0, 1 - (p - leave) / Math.max(0.01, (1 - leave) * 0.6));
  return out.map((n) => ({ ...n, attrs: { ...n.attrs, opacity: Number(n.attrs.opacity ?? 1) * k } }));
}

function push(out: RNode[], n: RNode | null) {
  if (n) out.push(n);
}

function tween(out: RNode[], a: RNode, b: RNode, p: number) {
  if (a.tag !== b.tag) {
    push(out, effect(a, 'fade', 1 - p));
    push(out, effect(b, 'fade', p));
    return;
  }
  const attrs: Record<string, string | number> = {};
  for (const k of new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)])) {
    const av = a.attrs[k] ?? (k === 'opacity' ? 1 : undefined);
    const bv = b.attrs[k] ?? (k === 'opacity' ? 1 : undefined);
    attrs[k] = mix(k, av, bv, p);
  }
  if (a.tag === 'text' && a.text !== b.text) {
    // crossfade text contents at the interpolated position
    const op = Number(attrs.opacity ?? 1);
    // old text leaves during the first half, new text arrives during the second
    out.push({ ...b, key: b.key + '~old', text: a.text, attrs: { ...attrs, opacity: op * Math.max(0, 1 - p * 2) } });
    out.push({ ...b, attrs: { ...attrs, opacity: op * Math.max(0, p * 2 - 1) } });
    return;
  }
  const node = { ...b, attrs };
  out.push(b.action && b.action.id !== a.action?.id ? emphasize(node, b.action, p) : node);
}

/** Keynote-style "action" animations, played over the transition (start and end at rest). */
function emphasize(n: RNode, act: NonNullable<RNode['action']>, p: number): RNode {
  const { cx, cy } = act;
  const s = Math.sin(p * Math.PI);
  let t = '';
  switch (act.name) {
    case 'bounce':
      t = `translate(0 ${-Math.abs(Math.sin(p * Math.PI * 2)) * 40 * (1 - p * 0.5)})`;
      break;
    case 'jump':
      t = `translate(0 ${-s * 70})`;
      break;
    case 'shake':
      t = `translate(${Math.sin(p * Math.PI * 8) * 16 * (1 - p)} 0)`;
      break;
    case 'pulse':
      t = `translate(${cx} ${cy}) scale(${1 + s * 0.25}) translate(${-cx} ${-cy})`;
      break;
    case 'spin':
      t = `rotate(${p * 360} ${cx} ${cy})`;
      break;
    case 'wiggle':
      t = `rotate(${Math.sin(p * Math.PI * 6) * 14 * (1 - p)} ${cx} ${cy})`;
      break;
    case 'tada': {
      const sc = 1 + s * 0.18;
      t = `translate(${cx} ${cy}) scale(${sc}) rotate(${Math.sin(p * Math.PI * 8) * 8 * s}) translate(${-cx} ${-cy})`;
      break;
    }
  }
  if (!t) return n;
  return { ...n, attrs: { ...n.attrs, transform: n.attrs.transform ? `${t} ${n.attrs.transform}` : t } };
}

function mix(k: string, a: string | number | undefined, b: string | number | undefined, p: number): string | number {
  if (a === undefined) return b!;
  if (b === undefined) return a;
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, p);
  const as = String(a), bs = String(b);
  if (as === bs) return a;
  if (k === 'd') return lerpPath(as, bs, p) ?? (p < 0.5 ? a : b);
  if (COLOR_ATTRS.has(k)) return lerpColor(as, bs, p) ?? (p < 0.5 ? a : b);
  if (!isNaN(+as) && !isNaN(+bs)) return lerp(+as, +bs, p);
  // strings with the same shape ("translate(1 2) rotate(30)", "6 5", point lists): lerp the numbers
  const xa = as.match(NUM) ?? [], xb = bs.match(NUM) ?? [];
  if (xa.length && xa.length === xb.length && as.replace(NUM, '#') === bs.replace(NUM, '#')) {
    let i = 0;
    return as.replace(NUM, () => String(+lerp(+xa[i], +xb[i++], p).toFixed(3)));
  }
  return p < 0.5 ? a : b;
}

/** Apply an enter/exit effect; q is visibility from 0 (gone) to 1 (fully shown). */
export function effect(n: RNode, name: string, q: number): RNode | null {
  if (q >= 1 && name !== 'ripple' && name !== 'flash' && name !== 'burst' && name !== 'float' && name !== 'pour' && name !== 'swell') return n;
  const op = Number(n.attrs.opacity ?? 1);
  const attrs = { ...n.attrs };
  // pivot in the parent's coordinates (the node may carry its own transform)
  const pivot = () => {
    const c = center(nodeBox(n));
    return transformPoint(n.attrs.transform as string | undefined, c.x, c.y);
  };
  const scaleAbout = (s: number) => {
    const c = pivot();
    const t = `translate(${c.x} ${c.y}) scale(${s}) translate(${-c.x} ${-c.y})`;
    attrs.transform = attrs.transform ? `${t} ${attrs.transform}` : t;
  };
  const slide = (dx: number, dy: number) => {
    const t = `translate(${dx * (1 - q)} ${dy * (1 - q)})`;
    attrs.transform = attrs.transform ? `${t} ${attrs.transform}` : t;
    attrs.opacity = op * q;
  };
  switch (name) {
    case 'none':
      return q >= 0.5 ? n : null;
    case 'pop':
      attrs.opacity = op * Math.min(1, q * 1.5);
      scaleAbout(0.3 + 0.7 * q + Math.sin(q * Math.PI) * 0.12);
      break;
    case 'slide-up':
      slide(0, 26);
      break;
    case 'slide-down':
      slide(0, -26);
      break;
    case 'slide-left':
      slide(26, 0);
      break;
    case 'slide-right':
      slide(-26, 0);
      break;
    case 'pour': {
      // a particle rides `track` into a target: it shrinks as it goes and fades on arrival
      if (!n.track) {
        attrs.opacity = op * q;
        break;
      }
      const at = pointAlong(n.track, q), end = pointAlong(n.track, 1);
      const s = 1 - 0.8 * Math.pow(q, 1.6);
      const t = `translate(${at.x} ${at.y}) scale(${s}) translate(${-end.x} ${-end.y})`;
      attrs.transform = attrs.transform ? `${t} ${attrs.transform}` : t;
      attrs.opacity = op * Math.min(1, q * 8) * (q > 0.82 ? Math.max(0, (1 - q) / 0.18) : 1);
      break;
    }
    case 'draw': {
      if (n.track) {
        // arrowheads: ride the tip of the line being drawn, turning with it
        const at = pointAlong(n.track, q), end = pointAlong(n.track, 1);
        const t = `translate(${at.x - end.x} ${at.y - end.y}) rotate(${at.angle - end.angle} ${end.x} ${end.y})`;
        attrs.transform = attrs.transform ? `${t} ${attrs.transform}` : t;
        attrs.opacity = op * Math.min(1, q * 6);
        break;
      }
      if (n.tag !== 'path' && n.tag !== 'line') {
        attrs.opacity = op * q;
        break;
      }
      const len = n.tag === 'line'
        ? Math.hypot(Number(attrs.x2) - Number(attrs.x1), Number(attrs.y2) - Number(attrs.y1))
        : pathLength(String(attrs.d));
      attrs['stroke-dasharray'] = `${len} ${len}`;
      attrs['stroke-dashoffset'] = len * (1 - q);
      if (attrs.fill && attrs.fill !== 'none') attrs['fill-opacity'] = q;
      break;
    }
    case 'grow':
      // bars: rise from their bottom edge
      if (n.tag === 'rect' && !n.attrs.transform) {
        const y = Number(attrs.y), hgt = Number(attrs.height);
        attrs.y = y + hgt * (1 - q);
        attrs.height = hgt * q;
        attrs.opacity = op * Math.min(1, q * 3);
      } else attrs.opacity = op * q;
      break;
    case 'swell':
      // a ring that grows out of its shape's outline and fades
      attrs.opacity = op * (1 - q);
      scaleAbout(1 + q * 0.35);
      break;
    case 'ripple':
      attrs.opacity = op * (1 - q);
      scaleAbout(0.2 + q * 1.3);
      break;
    case 'flash':
      attrs.opacity = op * Math.sin(q * Math.PI);
      break;
    case 'burst':
    case 'float': {
      // particles: travel along `fly`, shrink and fade out (burst falls a little)
      const [dx, dy] = n.fly ?? [0, -80];
      const e = 1 - Math.pow(1 - q, 3);
      const fall = name === 'burst' ? q * q * 60 : 0;
      const c = pivot();
      const sc = name === 'burst' ? 1 - q * 0.5 : 0.7 + Math.sin(q * Math.PI) * 0.4;
      const tr = `translate(${dx * e} ${dy * e + fall}) translate(${c.x} ${c.y}) scale(${sc}) translate(${-c.x} ${-c.y})`;
      attrs.transform = attrs.transform ? `${tr} ${attrs.transform}` : tr;
      attrs.opacity = op * (q < 0.15 ? q / 0.15 : 1 - Math.pow((q - 0.15) / 0.85, 2));
      break;
    }
    case 'fade':
    default:
      attrs.opacity = op * q;
  }
  if (Number(attrs.opacity ?? 1) <= 0.001) return null;
  return { ...n, attrs };
}
