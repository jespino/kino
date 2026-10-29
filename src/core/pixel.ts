// 8-bit look for themes with `pixel` > 0 (the `pixel` theme, `pixel` = the size
// of one "pixel" in px): a node is serialized as if drawn on a low-res screen.
//   - rectangles: square corners, snapped to the pixel grid (so they move in steps)
//   - circles and ellipses: stepped outlines, a row of pixels at a time
//   - no anti-aliasing on shapes (`shape-rendering: crispEdges`), square line ends
//   - opaque shapes and big lettering: a hard drop shadow one pixel down-right
//   - glows: a crisp colored rim instead of a blur; blurred halos are dropped
// The look only changes how nodes are drawn, never the layout.
import { fmt } from './geometry.ts';
import { bigEnough, opaqueFill, shadowOf } from './comic.ts';
import { GLOW_FILTER, HALO_FILTER } from './svg.ts';
import type { Theme } from './theme.ts';
import type { RNode } from './widget.ts';

const N = (v: string | number | undefined) => Number(v ?? 0);

/** the outline of an ellipse as rows of `p`-px pixels */
function steppedEllipse(cx: number, cy: number, rx: number, ry: number, p: number): string {
  const rows = Math.max(2, Math.round((ry * 2) / p));
  const top = cy - (rows * p) / 2;
  const half = Array.from({ length: rows }, (_, i) => {
    const dy = (top + (i + 0.5) * p - cy) / ry;
    return Math.max(p / 2, Math.round((rx * Math.sqrt(Math.max(0, 1 - dy * dy))) / p) * p);
  });
  let d = `M${fmt(cx - half[0])} ${fmt(top)}`;
  half.forEach((w, i) => (d += `H${fmt(cx + w)}V${fmt(top + (i + 1) * p)}`));
  for (let i = rows - 1; i >= 0; i--) d += `H${fmt(cx - half[i])}V${fmt(top + i * p)}`;
  return d + 'Z';
}

/** The node drawn in pixels: zero or more nodes to serialize in its place. */
export function pixelNode(n: RNode, theme: Theme): RNode[] {
  const p = +theme.pixel || 0;
  if (p <= 0) return [n];
  const a = n.attrs;
  const ink = theme.ink ?? '#000000';
  const snap = (v: number) => Math.round(v / p) * p;

  if (a.filter === HALO_FILTER) return [];
  if (a.filter === GLOW_FILTER) {
    if (a.stroke === undefined || a.stroke === 'none') return [];
    const { filter: _, ...rest } = a;
    return pixelNode({ ...n, attrs: { ...rest, fill: 'none', 'stroke-width': Math.max(N(a['stroke-width']), p) } }, theme);
  }

  if (n.tag === 'text') {
    // arcade lettering: big text casts a hard shadow
    const size = N(a['font-size'] || 16);
    return size >= 36 && a.fill ? [shadowOf(n, Math.max(p, Math.round(size / 16)), ink, a), n] : [n];
  }
  if (n.tag === 'image') return [n];

  const crisp: RNode['attrs'] = { 'shape-rendering': 'crispEdges', 'stroke-linejoin': 'miter', 'stroke-linecap': 'square' };
  let out: RNode;
  if (n.tag === 'rect') {
    const { rx: _rx, ry: _ry, ...rest } = a;
    const x = snap(N(a.x)), y = snap(N(a.y));
    const w = Math.max(p, snap(N(a.x) + N(a.width)) - x), h = Math.max(p, snap(N(a.y) + N(a.height)) - y);
    out = { ...n, attrs: { ...rest, ...crisp, x, y, width: w, height: h } };
  } else if (n.tag === 'circle' || n.tag === 'ellipse') {
    const rx = N(n.tag === 'circle' ? a.r : a.rx), ry = N(n.tag === 'circle' ? a.r : a.ry);
    if (rx <= 0 || ry <= 0) return [n];
    const { cx, cy, r: _r, rx: _rx, ry: _ry, ...rest } = a;
    out = { ...n, tag: 'path', attrs: { ...rest, ...crisp, d: steppedEllipse(snap(N(cx)), snap(N(cy)), rx, ry, p) } };
  } else {
    out = { ...n, attrs: { ...a, ...crisp } };
  }
  if (n.tag !== 'line' && opaqueFill(a) && bigEnough(n)) return [shadowOf(out, p, ink, { ...out.attrs, 'fill-opacity': 1 }), out];
  return [out];
}
