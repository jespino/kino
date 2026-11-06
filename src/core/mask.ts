import { fmt, transformPoint, type Rect } from './geometry.ts';
import { isCall, isRef, num, str, type Value } from './values.ts';

/**
 * Masks, after Lottie's layer masks and track mattes: a widget shows only
 * inside a shape (`clip`), or only outside it (`clipInvert`, Lottie's subtract
 * mode). Nodes carry the shape as a `clip` attribute: a path in the node's own
 * coordinates (before its transform), so effects and emphasis that move or
 * scale the node take its clip along. The shapes use only M/L/C/Z, so they map
 * exactly through transforms and tween between steps when their kind stays.
 */

type Pt = { x: number; y: number };

/** Bezier handle length for a quarter circle. */
const K = 0.5523;

/** A (rounded) rectangle, always with the same commands, so rects tween into each other. */
export function roundedRectPath(x: number, y: number, w: number, h: number, r = 0): string {
  w = Math.max(0, w);
  h = Math.max(0, h);
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  const k = r * (1 - K);
  const P = (...v: number[]) => v.map(fmt).join(' ');
  return (
    `M${P(x + r, y)} L${P(x + w - r, y)} C${P(x + w - k, y, x + w, y + k, x + w, y + r)} ` +
    `L${P(x + w, y + h - r)} C${P(x + w, y + h - k, x + w - k, y + h, x + w - r, y + h)} ` +
    `L${P(x + r, y + h)} C${P(x + k, y + h, x, y + h - k, x, y + h - r)} ` +
    `L${P(x, y + r)} C${P(x, y + k, x + k, y, x + r, y)} Z`
  );
}

export function circlePath(cx: number, cy: number, r: number): string {
  r = Math.max(0, r);
  const k = r * K;
  const P = (...v: number[]) => v.map(fmt).join(' ');
  return (
    `M${P(cx + r, cy)} C${P(cx + r, cy + k, cx + k, cy + r, cx, cy + r)} C${P(cx - k, cy + r, cx - r, cy + k, cx - r, cy)} ` +
    `C${P(cx - r, cy - k, cx - k, cy - r, cx, cy - r)} C${P(cx + k, cy - r, cx + r, cy - k, cx + r, cy)} Z`
  );
}

const BIG = 1e5;
const EVERYTHING = `M${-BIG} ${-BIG} L${BIG} ${-BIG} L${BIG} ${BIG} L${-BIG} ${BIG} Z`;

const USAGE = `'clip' takes a widget or part (clip: window), inset(top, right, bottom, left) or circle(size), as fractions of the widget's box`;

/**
 * The clip shape on the canvas for a widget whose box is `box`:
 * - a widget or part: its box (`clip: viewport`), a track matte that follows it
 * - `inset(t, r, b, l)`: the widget's box cut in from each side by a fraction of its size (1 to 4 values, like CSS)
 * - `circle(f)`: a circle at the widget's center, `f` = 1 just covers the box
 * `radius` rounds rectangles; `invert` keeps what's outside instead.
 */
export function clipShape(v: Value, box: Rect, anchor: (v: Value) => Rect, radius = 0, invert = false): string {
  let d: string;
  if (isRef(v) || isCall(v) && !['inset', 'circle'].includes(v.$call)) {
    const r = anchor(v);
    d = roundedRectPath(r.x, r.y, r.w, r.h, radius);
  } else if (isCall(v) && v.$call === 'inset') {
    const a = v.args.map((x) => num(x, USAGE));
    if (a.length < 1 || a.length > 4) throw new Error(USAGE);
    const [t, r = t, b = t, l = r] = a;
    d = roundedRectPath(box.x + l * box.w, box.y + t * box.h, box.w * (1 - l - r), box.h * (1 - t - b), radius);
  } else if (isCall(v) && v.$call === 'circle') {
    if (v.args.length !== 1) throw new Error(USAGE);
    d = circlePath(box.x + box.w / 2, box.y + box.h / 2, (num(v.args[0], USAGE) * Math.hypot(box.w, box.h)) / 2);
  } else throw new Error(`${USAGE}, got ${str(v)}`);
  return invert ? `${EVERYTHING} ${d}` : d;
}

/** The affine matrix [a b c d e f] of an SVG transform list. */
function matrixOf(t: string): number[] {
  const o = transformPoint(t, 0, 0), x = transformPoint(t, 1, 0), y = transformPoint(t, 0, 1);
  return [x.x - o.x, x.y - o.y, y.x - o.x, y.y - o.y, o.x, o.y];
}

/** Map an M/L/C/Z path from the canvas into a node's own coordinates (through the inverse of its transform). */
export function intoNode(d: string, transform: string | number | undefined): string {
  if (typeof transform !== 'string' || !transform.trim()) return d;
  const [a, b, c, dd, e, f] = matrixOf(transform);
  const det = a * dd - b * c;
  if (Math.abs(det) < 1e-12) return d;
  const inv = (p: Pt): Pt => {
    const x = p.x - e, y = p.y - f;
    return { x: (dd * x - c * y) / det, y: (-b * x + a * y) / det };
  };
  return d.replace(/([MLC])([^MLCZ]*)/g, (_, cmd: string, args: string) => {
    const n = args.trim().split(/[\s,]+/).filter(Boolean).map(Number);
    const out: string[] = [];
    for (let i = 0; i + 1 < n.length; i += 2) {
      const q = inv({ x: n[i], y: n[i + 1] });
      out.push(`${fmt(q.x)} ${fmt(q.y)}`);
    }
    return `${cmd}${out.join(' ')} `;
  }).trim();
}
