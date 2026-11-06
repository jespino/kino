import { pathLength, pointAlong } from './geometry.ts';
import { num, type Value } from './values.ts';
import type { RNode } from './widget.ts';

/**
 * Trim paths, after Lottie: a stroke shows only the stretch from `start` to
 * `end` (fractions of its length), shifted along it by `offset` and wrapping
 * around. Nodes carry it as a `trim` attribute ("start end offset"), which
 * tweens like any number; frameToSVG turns it into a dash pattern before the
 * themes draw. Arrow heads (nodes with a `track`) ride the visible end.
 */

export const NO_TRIM = '0 1 0';

/** `trim: 0.5`, `[0.2, 0.8]` or `[0, 0.3, 0.5]` → "start end offset". */
export function trimAttr(v: Value): string {
  const xs = (Array.isArray(v) ? v : [0, v]).map((x) => num(x, `'trim' takes an end, [start, end] or [start, end, offset] (fractions of the length)`));
  if (xs.length < 2 || xs.length > 3) throw new Error(`'trim' takes an end, [start, end] or [start, end, offset] (fractions of the length)`);
  const [s, e, o = 0] = xs;
  return `${s} ${e} ${o}`;
}

/** Strokes that can be trimmed: lines and unfilled paths. */
export function trimmable(n: RNode): boolean {
  if (n.track) return true;
  if (n.tag === 'line') return true;
  return n.tag === 'path' && (n.attrs.fill === undefined || n.attrs.fill === 'none') && n.attrs.stroke !== undefined && n.attrs.stroke !== 'none';
}

const parse = (t: string | number) => {
  const [s = 0, e = 1, o = 0] = String(t).trim().split(/\s+/).map(Number);
  const lo = Math.max(0, Math.min(1, Math.min(s, e))), hi = Math.max(0, Math.min(1, Math.max(s, e)));
  return { s: lo, e: hi, o: Number.isFinite(o) ? o : 0 };
};

/** The node as plain SVG: its `trim` turned into dashes (or a head moved along its track). Null if nothing shows. */
export function applyTrim(n: RNode): RNode | null {
  const t = n.attrs.trim;
  if (t === undefined) return n;
  const { trim: _, ...attrs } = n.attrs;
  const { s, e, o } = parse(t);
  const full = s <= 0 && e >= 1 && o % 1 === 0;
  if (full) return { ...n, attrs };
  if (e - s < 1e-4) return null;
  if (n.track) {
    // arrow heads: at the visible end, turned like the line there
    const f = e + o - Math.floor(e + o) || (e + o > 0 ? 1 : 0);
    const at = pointAlong(n.track, f), end = pointAlong(n.track, 1);
    const tr = `translate(${at.x - end.x} ${at.y - end.y}) rotate(${at.angle - end.angle} ${end.x} ${end.y})`;
    return { ...n, attrs: { ...attrs, transform: attrs.transform ? `${tr} ${attrs.transform}` : tr } };
  }
  const L = n.tag === 'line'
    ? Math.hypot(Number(attrs.x2) - Number(attrs.x1), Number(attrs.y2) - Number(attrs.y1))
    : pathLength(String(attrs.d));
  if (!(L > 0)) return { ...n, attrs };
  let a = s + o, b = e + o;
  const shift = Math.floor(a);
  a -= shift;
  b -= shift;
  const f = (x: number) => +(x * L).toFixed(3);
  if (b <= 1) {
    attrs['stroke-dasharray'] = `${f(b - a)} ${f(2)}`;
    attrs['stroke-dashoffset'] = f(-a);
  } else {
    // wraps past the end: one dash at the start, one up to the end
    attrs['stroke-dasharray'] = `${f(b - 1)} ${f(a - (b - 1))} ${f(1 - a)} ${f(1)}`;
    attrs['stroke-dashoffset'] = 0;
  }
  return { ...n, attrs };
}
