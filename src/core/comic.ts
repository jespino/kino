// Comic-book look for themes with `inkWidth` > 0 (the `comic` theme): a node is
// serialized as if inked by hand on newsprint.
//   - outlines: thick, round-jointed ink in the shape's stroke color
//   - opaque outlined shapes and big lettering: a solid offset shadow in ink
//   - big bold colored text: an ink outline around the letters
//   - glows: a crisp colored rim instead of a blur; blurred halos are dropped
// The look only changes how nodes are drawn, never the layout.
import { parseColor } from './color.ts';
import { GLOW_FILTER, HALO_FILTER } from './svg.ts';
import type { Theme } from './theme.ts';
import type { RNode } from './widget.ts';

const N = (v: string | number | undefined) => Number(v ?? 0);

/** Smallest shape (px) that casts a shadow: dots and thin bars stay flat. */
const MIN_SHADOW = 14;

export function opaqueFill(a: RNode['attrs']): boolean {
  const fill = a.fill === undefined ? '#000' : String(a.fill);
  if (fill === 'none' || fill === 'transparent') return false;
  const fo = a['fill-opacity'] === undefined ? 1 : N(a['fill-opacity']);
  if (fill.startsWith('url(')) return fo >= 0.85;
  const c = parseColor(fill);
  return !!c && c[3] * fo >= 0.85;
}

/** Whether the shape is big enough to cast a shadow (paths: assumed so). */
export function bigEnough(n: RNode): boolean {
  const a = n.attrs;
  if (n.tag === 'rect') return N(a.width) >= MIN_SHADOW && N(a.height) >= MIN_SHADOW;
  if (n.tag === 'circle') return N(a.r) * 2 >= MIN_SHADOW;
  if (n.tag === 'ellipse') return N(a.rx) * 2 >= MIN_SHADOW && N(a.ry) * 2 >= MIN_SHADOW;
  return n.tag === 'path' || n.tag === 'polygon';
}

/** The same node, `off` px down and right, painted solid in ink. */
export function shadowOf(n: RNode, off: number, ink: string, attrs: RNode['attrs']): RNode {
  const t = attrs.transform ? ` ${attrs.transform}` : '';
  // a translation commutes with the transform-origin shift, so prepending it is enough
  return { ...n, key: n.key + ':shadow', attrs: { ...attrs, fill: ink, stroke: ink, 'fill-opacity': 1, transform: `translate(${off} ${off})${t}` } };
}

/** The node inked: zero or more nodes to serialize in its place. */
export function comicNode(n: RNode, theme: Theme): RNode[] {
  const ink = +theme.inkWidth || 0;
  if (ink <= 0) return [n];
  const a = n.attrs;
  const off = +theme.inkShadow || 0;
  const inkColor = theme.ink ?? theme.fg;

  if (a.filter === HALO_FILTER) return [];
  if (a.filter === GLOW_FILTER) {
    // a glowing outline becomes a hard colored rim; a glowing fill would be a solid blob
    if (a.stroke === undefined || a.stroke === 'none') return [];
    const { filter: _, ...rest } = a;
    return [{ ...n, attrs: { ...rest, fill: 'none', 'stroke-width': Math.max(N(a['stroke-width']), ink * 2.2), 'stroke-linejoin': 'round' } }];
  }

  if (n.tag === 'text') {
    const size = N(a['font-size'] || 16);
    if (N(a['font-weight']) < 700 || size < 28 || !a.fill || a.stroke !== undefined) return [n];
    // black lettering stays plain; colored and gradient lettering gets the ink outline
    const c = parseColor(String(a.fill));
    if (c && (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255 < 0.3) return [n];
    const attrs = { ...a, stroke: inkColor, 'stroke-width': +Math.min(8, Math.max(1.5, size * 0.07)).toFixed(2), 'stroke-linejoin': 'round', 'paint-order': 'stroke' };
    return off > 0 && size >= 44 ? [shadowOf(n, off * 0.8, inkColor, attrs), { ...n, attrs }] : [{ ...n, attrs }];
  }

  if (n.tag === 'image') return [n];

  const stroke = a.stroke === undefined ? 'none' : String(a.stroke);
  const sw = N(a['stroke-width'] ?? 1);
  if (stroke === 'none' || sw <= 0) return [n];

  if (n.tag === 'line') return [{ ...n, attrs: { ...a, 'stroke-width': Math.max(sw, ink * 0.85), 'stroke-linecap': 'round' } }];

  const closed = n.tag !== 'path' || (a.fill !== undefined && a.fill !== 'none') || /z\s*$/i.test(String(a.d ?? ''));
  const attrs: RNode['attrs'] = { ...a, 'stroke-width': closed ? Math.max(sw, ink) : Math.max(sw, ink * 0.85), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
  if (closed && off > 0 && opaqueFill(a) && bigEnough(n)) {
    // cards drawn slightly see-through elsewhere are solid here, or their shadow would show through
    attrs['fill-opacity'] = 1;
    return [shadowOf(n, off, inkColor, attrs), { ...n, attrs }];
  }
  return [{ ...n, attrs }];
}
