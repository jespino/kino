// Hand-drawn look for themes with `roughness` > 0 (the `sketch` theme): a node is
// serialized as pencil strokes and, with `watercolor`, its fill as layered washes.
//   - outlines: thin graphite lines, each side drawn on its own and twice, with
//     the ends overshooting the corners (like rough.js)
//   - fills: an irregular wash with darker, pooled edges plus a smaller, lighter
//     inner wash, so the pigment is uneven
//   - glows become a soft watercolor halo; blurred halos (text) are dropped
// With `marker` > 0 (the `whiteboard` theme) it's a doodle on a whiteboard instead:
// outlines drawn once with a thin black pen, that many px wide; colored fills
// laid flat with a felt marker, a little off the outline; big colored lettering
// outlined in black; glows become a dashed doodle loop around the shape.
// Everything random is seeded by the node's key, so a shape keeps its look while
// it moves or resizes instead of flickering from frame to frame.
import { fmt } from './geometry.ts';
import { parseColor } from './color.ts';
import { GLOW_FILTER, HALO_FILTER } from './svg.ts';
import type { Theme } from './theme.ts';
import type { RNode } from './widget.ts';

/** small deterministic PRNG (mulberry32) */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h;
}

export type Pt = [number, number];
type Rand = () => number;
const P = (p: Pt) => `${fmt(p[0])} ${fmt(p[1])}`;
const N = (v: string | number | undefined) => Number(v ?? 0);
/** uniform in [-a, a] */
const jit = (r: Rand, a: number) => (r() - 0.5) * 2 * a;

// ---- pencil ----

/** One pencil line from a to b, slightly bowed, its ends overshooting by up to `over` px. */
function pencilLine(a: Pt, b: Pt, amp: number, over: number, r: Rand): string {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const o1 = over * r(), o2 = over * r();
  const s: Pt = [a[0] - ux * o1 + jit(r, amp * 0.4), a[1] - uy * o1 + jit(r, amp * 0.4)];
  const e: Pt = [b[0] + ux * o2 + jit(r, amp * 0.4), b[1] + uy * o2 + jit(r, amp * 0.4)];
  const bow = jit(r, Math.min(amp, len / 50));
  const m: Pt = [(s[0] + e[0]) / 2 - uy * bow, (s[1] + e[1]) / 2 + ux * bow];
  return `M${P(s)} Q${P(m)} ${P(e)}`;
}

/** A rectangle drawn side by side, `passes` times. */
function pencilRect(x: number, y: number, w: number, h: number, amp: number, r: Rand, passes: number): string {
  const c: Pt[] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const over = Math.min(4, Math.min(w, h) * 0.08);
  let d = '';
  for (let pass = 0; pass < passes; pass++) for (let i = 0; i < 4; i++) d += pencilLine(c[i], c[(i + 1) % 4], amp, over, r) + ' ';
  return d.trim();
}

/** A rounded shape (pills, circles) as one wobbly loop, `passes` times, slightly overlapping its start. */
function pencilLoop(pts: Pt[], r: Rand, amp: number, passes: number): string {
  let d = '';
  for (let pass = 0; pass < passes; pass++) {
    const q = pts.map(([x, y]) => [x + jit(r, amp * 0.5), y + jit(r, amp * 0.5)] as Pt);
    d += smooth([...q, q[0], q[1]], false) + ' ';
  }
  return d.trim();
}

// ---- outlines as point lists ----

/** points around a (rounded) rect, roughly every `step` px */
export function rectPoints(x: number, y: number, w: number, h: number, rx: number, step: number): Pt[] {
  const c = Math.max(0, Math.min(rx, w / 2, h / 2));
  const pts: Pt[] = [];
  const line = (ax: number, ay: number, bx: number, by: number) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let i = 0; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
  };
  const arc = (cx: number, cy: number, from: number) => {
    if (c < 2) return;
    for (const t of [0.25, 0.5, 0.75]) pts.push([cx + Math.cos(from + (t * Math.PI) / 2) * c, cy + Math.sin(from + (t * Math.PI) / 2) * c]);
  };
  line(x + c, y, x + w - c, y);
  arc(x + w - c, y + c, -Math.PI / 2);
  line(x + w, y + c, x + w, y + h - c);
  arc(x + w - c, y + h - c, 0);
  line(x + w - c, y + h, x + c, y + h);
  arc(x + c, y + h - c, Math.PI / 2);
  line(x, y + h - c, x, y + c);
  arc(x + c, y + c, Math.PI);
  return pts;
}

export function ellipsePoints(cx: number, cy: number, rx: number, ry: number): Pt[] {
  const n = Math.max(8, Math.min(28, Math.round((Math.PI * (rx + ry)) / 18)));
  return Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry] as Pt);
}

/** Catmull-Rom through the points (closed: a loop), as cubic Béziers */
function smooth(pts: Pt[], closed = true): string {
  const n = pts.length;
  const at = (i: number) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  let d = `M${P(pts[0])}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    d += ` C${P([p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6])} ${P([p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6])} ${P(p2)}`;
  }
  return closed ? d + 'Z' : d;
}

/** irregular closed blob following the outline: the edge of a watercolor wash */
function blob(pts: Pt[], amp: number, r: Rand): string {
  return smooth(pts.map(([x, y]) => [x + jit(r, amp), y + jit(r, amp)] as Pt));
}

// ---- colors ----

function rgba(c: string): [number, number, number, number] | null {
  return parseColor(c);
}
const css = (c: [number, number, number], a = 1) => `rgba(${c.map(Math.round).join(',')},${+a.toFixed(3)})`;
/** pencil color for an outline: mostly graphite, a little of the original hue */
function graphite(stroke: string, ink: string): string {
  const s = rgba(stroke), k = rgba(ink);
  if (!s || !k) return stroke;
  return css([0, 1, 2].map((i) => k[i] * 0.6 + s[i] * 0.4) as [number, number, number], s[3]);
}
const luminance = (c: [number, number, number, number]) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

// ---- nodes ----

type Shape = { outline: Pt[]; pencil: string; bbox: [number, number, number, number] };

function shapeOf(n: RNode, amp: number, r: Rand, passes = 2): Shape | null {
  const a = n.attrs;
  if (n.tag === 'rect') {
    const x = N(a.x), y = N(a.y), w = N(a.width), h = N(a.height);
    if (w <= 0 || h <= 0) return null;
    const rx = N(a.rx ?? a.ry);
    // pills and big radii keep their roundness; ordinary corners become sharp pencil corners
    const round = rx >= Math.min(w, h) * 0.3;
    const outline = rectPoints(x, y, w, h, round ? rx : Math.min(rx, 3), 26);
    return { outline, pencil: round ? pencilLoop(outline, r, amp, passes) : pencilRect(x, y, w, h, amp, r, passes), bbox: [x, y, w, h] };
  }
  if (n.tag === 'circle' || n.tag === 'ellipse') {
    const rx = N(n.tag === 'circle' ? a.r : a.rx), ry = N(n.tag === 'circle' ? a.r : a.ry);
    if (rx <= 0 || ry <= 0) return null;
    const outline = ellipsePoints(N(a.cx), N(a.cy), rx, ry);
    return { outline, pencil: pencilLoop(outline, r, Math.min(amp, rx * 0.15), passes), bbox: [N(a.cx) - rx, N(a.cy) - ry, rx * 2, ry * 2] };
  }
  if (n.tag === 'path') {
    // closed straight-edged shapes (custom polygons): each edge in pencil
    const d = String(a.d ?? '');
    if (!/^\s*M[\d\s.,eE+-]*(L[\d\s.,eE+-]*)+Z\s*$/.test(d)) return null;
    const nums = (d.match(/-?[\d.]+(?:e[+-]?\d+)?/gi) ?? []).map(Number);
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const bbox: [number, number, number, number] = [Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    // small ones (arrow heads) stay crisp
    if (pts.length < 3 || Math.min(bbox[2], bbox[3]) < 30) return null;
    const outline: Pt[] = [];
    let pencil = '';
    pts.forEach((q, i) => {
      const nx = pts[(i + 1) % pts.length];
      const steps = Math.max(1, Math.round(Math.hypot(nx[0] - q[0], nx[1] - q[1]) / 26));
      for (let s = 0; s < steps; s++) outline.push([q[0] + ((nx[0] - q[0]) * s) / steps, q[1] + ((nx[1] - q[1]) * s) / steps]);
    });
    const over = Math.min(4, Math.min(bbox[2], bbox[3]) * 0.08);
    for (let pass = 0; pass < passes; pass++) pts.forEach((q, i) => (pencil += pencilLine(q, pts[(i + 1) % pts.length], amp, over, r) + ' '));
    return { outline, pencil: pencil.trim(), bbox };
  }
  return null;
}

const GEOMETRY = ['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'd'];
/** attributes every generated part keeps (fades, emphasis transforms, ...) */
function shared(a: RNode['attrs']) {
  const keep: RNode['attrs'] = {};
  for (const k of ['opacity', 'transform', 'transform-origin']) if (a[k] !== undefined) keep[k] = a[k];
  return keep;
}

/** The node redrawn by hand: zero or more nodes to serialize in its place. */
export function sketchNode(n: RNode, theme: Theme): RNode[] {
  const amp = +theme.roughness || 0;
  if (amp <= 0) return [n];
  const a = n.attrs;
  const r = rng(hash(n.key));
  const base = shared(a);
  const part = (suffix: string, tag: RNode['tag'], attrs: RNode['attrs']): RNode => ({ ...n, key: n.key + suffix, tag, attrs: { ...base, ...attrs } });
  const watercolor = +theme.watercolor > 0;
  const marker = +theme.marker || 0;
  /** marker stroke width for an outline `sw` px wide: thin rules stay thinner */
  const markerWidth = (sw: number) => +(marker * Math.min(1.3, Math.max(0.6, sw / 2))).toFixed(2);

  // glows and halos: no blurred light on paper; a whiteboard pen has no glow at all
  if (a.filter === HALO_FILTER) return [];
  if (a.filter === GLOW_FILTER && marker > 0) {
    // a dashed loop doodled around the shape in the glow's color
    const s = shapeOf(n, amp, r, 1);
    const c = rgba(String(a.stroke ?? a.fill ?? ''));
    if (!s || !c) return [];
    const [x, y, w, h] = s.bbox, pad = 9;
    const loop = n.tag === 'circle' || n.tag === 'ellipse' ? ellipsePoints(x + w / 2, y + h / 2, w / 2 + pad, h / 2 + pad) : rectPoints(x - pad, y - pad, w + pad * 2, h + pad * 2, 14, 26);
    return [part(':doodle', 'path', { d: pencilLoop(loop, r, amp, 1), fill: 'none', stroke: css([c[0], c[1], c[2]]), 'stroke-width': markerWidth(2), 'stroke-dasharray': '9 8', 'stroke-linecap': 'round' })];
  }
  if (a.filter === GLOW_FILTER) {
    const s = shapeOf(n, amp, r);
    const c = rgba(String(a.stroke ?? a.fill ?? ''));
    if (!s || !c) return [];
    const [x, y, w, h] = s.bbox, pad = 7;
    // round shapes get a round halo
    const halo = n.tag === 'circle' || n.tag === 'ellipse' ? ellipsePoints(x + w / 2, y + h / 2, w / 2 + pad, h / 2 + pad) : rectPoints(x - pad, y - pad, w + pad * 2, h + pad * 2, 12, 22);
    return [part(':halo', 'path', { d: blob(halo, 2.5, r), fill: css([c[0], c[1], c[2]], 0.22), stroke: 'none' })];
  }

  if (n.tag === 'text') {
    // whiteboard: big colored lettering filled in and outlined with the black pen
    if (marker > 0 && a.fill && a.stroke === undefined && N(a['font-size'] || 16) >= 40) {
      const fill = String(a.fill), c = fill.startsWith('url(') ? null : rgba(fill);
      if (!c || Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) > 60) {
        const w = 0.075 * N(a['font-size']);
        return [{ ...n, attrs: { ...a, stroke: theme.ink ?? theme.fg, 'stroke-width': +w.toFixed(2), 'stroke-linejoin': 'round', 'paint-order': 'stroke' } }];
      }
    }
    // one-weight handwriting fonts: fake the bold with an outline in the text color
    if (+theme.fauxBold > 0 && N(a['font-weight']) >= 750 && a.fill && a.stroke === undefined) {
      const size = N(a['font-size'] || 16);
      // full weight for headlines; small captions only get a touch
      const w = 0.045 * size * Math.min(1, size / 40 + 0.35) * +theme.fauxBold;
      return [{ ...n, attrs: { ...a, stroke: a.fill, 'stroke-width': +w.toFixed(2), 'stroke-linejoin': 'round', 'paint-order': 'stroke' } }];
    }
    return [n];
  }

  if (n.tag === 'line') {
    const line = () => pencilLine([N(a.x1), N(a.y1)], [N(a.x2), N(a.y2)], amp, 0, r);
    const d = marker > 0 ? line() : line() + ' ' + line();
    const rest = Object.fromEntries(Object.entries(a).filter(([k]) => !GEOMETRY.includes(k)));
    const sw = N(a['stroke-width']) || 1.5;
    return [part('', 'path', { ...rest, d, fill: 'none', 'stroke-width': marker > 0 ? markerWidth(sw) : Math.min(sw, 2.2), 'stroke-linecap': 'round' })];
  }

  const s = shapeOf(n, amp, r, marker > 0 ? 1 : 2);
  if (!s) return [n];
  const rest = Object.fromEntries(Object.entries(a).filter(([k]) => !GEOMETRY.includes(k) && k !== 'fill' && k !== 'stroke' && k !== 'stroke-width' && k !== 'fill-opacity'));
  const out: RNode[] = [];
  /** colored in: the color is in the fill, so the outline is the black pen */
  let inked = false;

  const fill = a.fill === undefined ? '#000' : String(a.fill);
  const fc = fill === 'none' ? null : rgba(fill);
  const fo = a['fill-opacity'] === undefined ? 1 : N(a['fill-opacity']);
  if (fc && fc[3] * fo > 0.003) {
    const alpha = fc[3] * fo;
    const rgb: [number, number, number] = [fc[0], fc[1], fc[2]];
    if (marker > 0 && luminance(fc) < 0.93) {
      const [x, y, w, h] = s.bbox;
      if (alpha < 0.9 && h <= 44 && w > h * 2.5) {
        // a highlighter stroke along short, wide tints (a highlighted line of code)
        const d = pencilLine([x + h * 0.42, y + h / 2], [x + w - h * 0.42, y + h / 2], Math.min(amp, 1.5), 0, r);
        out.push(part(':highlighter', 'path', { ...rest, d, fill: 'none', stroke: css(rgb), 'stroke-width': +(h * 0.82).toFixed(2), 'stroke-opacity': Math.min(0.45, 0.2 + alpha), 'stroke-linecap': 'round' }));
      } else {
        // colored in with a felt marker: flat and bright (tints a lighter shade of the
        // color), a little off the outline as when filling a doodle in by hand
        const paper = rgba(theme.bg) ?? [255, 255, 255, 1];
        const k = alpha >= 0.9 ? 1 : Math.min(1, 0.3 + alpha * 1.4);
        const color = css([0, 1, 2].map((i) => rgb[i] * k + paper[i] * (1 - k)) as [number, number, number]);
        const off = Math.min(4, Math.min(w, h) * 0.07), t = r() * Math.PI * 2;
        const dx = Math.cos(t) * off, dy = Math.sin(t) * off;
        const d = blob(s.outline.map(([px, py]) => [px + dx, py + dy] as Pt), Math.min(1.2, Math.min(w, h) * 0.04), r);
        out.push(part(':fill', 'path', { ...rest, d, fill: color, stroke: 'none' }));
        inked = true;
      }
    } else if (watercolor && luminance(fc) < 0.93) {
      // pigment: an irregular wash whose edge pools darker, and a lighter patch
      // inside where the paint dried thinner
      const [x, y, w, h] = s.bbox;
      // tints get a light wash; solid fills (buttons, badges) stay strong enough for white text
      const body = alpha >= 0.9 ? 0.88 : 0.46 * Math.min(1, alpha * 1.6);
      out.push(part(':wash', 'path', { ...rest, d: blob(s.outline, Math.min(2.2, Math.min(w, h) * 0.06), r), fill: css(rgb, body), stroke: css(rgb, Math.min(1, body * 1.1)), 'stroke-width': 2.4 }));
      const ix = x + w * (0.05 + r() * 0.25), iy = y + h * (0.08 + r() * 0.2);
      const inner = rectPoints(ix, iy, w * (0.5 + r() * 0.3), h * (0.55 + r() * 0.25), Math.min(w, h) * 0.45, 18);
      const paper = rgba(theme.bg) ?? [255, 255, 255, 1];
      out.push(part(':bloom', 'path', { ...rest, d: blob(inner, Math.min(5, Math.min(w, h) * 0.12), r), fill: css([paper[0], paper[1], paper[2]], 0.16), stroke: 'none' }));
    } else {
      // paper-colored (or flat) fill: keeps covering what is behind it
      out.push(part(':fill', 'path', { ...rest, d: smooth(s.outline), fill, 'fill-opacity': fo, stroke: 'none' }));
    }
  }

  const stroke = a.stroke === undefined ? 'none' : String(a.stroke);
  if (stroke !== 'none' && N(a['stroke-width'] ?? 1) > 0 && marker > 0) {
    out.push(part(':marker', 'path', { ...rest, d: s.pencil, fill: 'none', stroke: inked ? (theme.ink ?? theme.fg) : stroke, 'stroke-width': markerWidth(N(a['stroke-width'] ?? 1)), 'stroke-opacity': 0.95, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  } else if (stroke !== 'none' && N(a['stroke-width'] ?? 1) > 0) {
    const sw = Math.min(N(a['stroke-width'] ?? 1), 2.4) * 0.7;
    out.push(part(':pencil', 'path', { ...rest, d: s.pencil, fill: 'none', stroke: graphite(stroke, theme.ink ?? theme.fg), 'stroke-width': +sw.toFixed(2), 'stroke-opacity': 0.85, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }
  return out;
}
