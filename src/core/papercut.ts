// Paper-craft look for themes with `paperCut` > 0 (the `paper-cut` theme,
// `paperCut` = how dark the shadows are): a node is serialized as a piece of
// colored paper laid on the page.
//   - filled shapes: no outline, and an opaque fill (a see-through tint becomes
//     the color it shows over the paper), so they read as cut-out layers
//   - their edges are cut by hand: short straight snips that wander a little off
//     the exact shape, the same every frame (seeded by the node's key)
//   - each piece shows the paper's fibres (the grain pattern laid over it)
//   - outlines and lines: thick paper strips with rounded ends
//   - every layer casts a shadow: a tight one where it touches the page and a
//     soft one further out, as paper has some thickness; big lettering too
//   - glows: a slightly bigger piece of colored paper behind the shape (a mat),
//     or a colored strip for lines; blurred halos are dropped
// The look only changes how nodes are drawn, never the layout.
import { fmt } from './geometry.ts';
import { parseColor } from './color.ts';
import { bigEnough } from './comic.ts';
import { ellipsePoints, hash, rectPoints, rng, type Pt } from './sketch.ts';
import { GLOW_FILTER, HALO_FILTER } from './svg.ts';
import type { Theme } from './theme.ts';
import type { RNode } from './widget.ts';

/** soft shadow under paper layers (themes with `paperCut`) */
export const CUT_FILTER = 'url(#kcut)';

const N = (v: string | number | undefined) => Number(v ?? 0);

/** `fill` at `opacity` over the paper color, as one opaque color (null: not a plain color) */
function overPaper(fill: string, opacity: number, paper: string): string | null {
  const c = parseColor(fill), bg = parseColor(paper);
  if (!c || !bg) return null;
  const a = c[3] * opacity;
  return `rgb(${[0, 1, 2].map((i) => Math.round(c[i] * a + bg[i] * (1 - a))).join(',')})`;
}

/** the paper fibres laid over each piece (the grain pattern, see svg.ts) */
const FIBRE = 'url(#kgrain)';

/** A filled rect or ellipse as a hand-cut outline: straight snips around it, each corner off by up to `amp` px. */
function cutPath(n: RNode): string | null {
  const a = n.attrs;
  let pts: Pt[];
  if (n.tag === 'rect') {
    const w = N(a.width), h = N(a.height);
    if (w < 10 || h < 10) return null;
    pts = rectPoints(N(a.x), N(a.y), w, h, Math.min(N(a.rx ?? a.ry), w / 2, h / 2), 18);
  } else if (n.tag === 'circle' || n.tag === 'ellipse') {
    const rx = N(n.tag === 'circle' ? a.r : a.rx), ry = N(n.tag === 'circle' ? a.r : a.ry);
    if (rx < 5 || ry < 5) return null;
    pts = ellipsePoints(N(a.cx), N(a.cy), rx, ry);
  } else return null;
  const r = rng(hash(n.key));
  const amp = 0.9;
  return 'M' + pts.map(([x, y]) => `${fmt(x + (r() - 0.5) * 2 * amp)} ${fmt(y + (r() - 0.5) * 2 * amp)}`).join(' L') + 'Z';
}

const GEOMETRY = ['x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r'];

/** the node's silhouette, blurred and offset by CUT_FILTER */
function shadow(n: RNode, attrs: RNode['attrs']): RNode {
  const hasFill = attrs.fill !== undefined && attrs.fill !== 'none';
  const hasStroke = attrs.stroke !== undefined && attrs.stroke !== 'none';
  return {
    ...n,
    key: n.key + ':cut',
    attrs: { ...attrs, fill: hasFill ? '#000000' : 'none', 'fill-opacity': 1, stroke: hasStroke ? '#000000' : 'none', 'stroke-opacity': 1, filter: CUT_FILTER },
  };
}

/** The node cut from paper: zero or more nodes to serialize in its place. */
export function paperNode(n: RNode, theme: Theme): RNode[] {
  if (!(+theme.paperCut > 0)) return [n];
  const a = n.attrs;

  if (a.filter === HALO_FILTER) return [];
  if (a.filter === GLOW_FILTER) {
    if (a.stroke === undefined || a.stroke === 'none') return [];
    const { filter: _, ...rest } = a;
    // glows are drawn behind their shape: a mat of the glow's color peeking out around it
    const pad = 5;
    if (n.tag === 'rect')
      return paperNode({ ...n, attrs: { ...rest, x: N(a.x) - pad, y: N(a.y) - pad, width: N(a.width) + pad * 2, height: N(a.height) + pad * 2, rx: N(a.rx) + pad, fill: a.stroke, stroke: 'none' } }, theme);
    if (n.tag === 'circle') return paperNode({ ...n, attrs: { ...rest, r: N(a.r) + pad, fill: a.stroke, stroke: 'none' } }, theme);
    return paperNode({ ...n, attrs: { ...rest, fill: 'none', 'stroke-width': Math.max(N(a['stroke-width']), 5) } }, theme);
  }
  // shapes that already have an effect (card shadows) are drawn as they are
  if (a.filter !== undefined) return [n];

  if (n.tag === 'text') return N(a['font-size'] || 16) >= 40 ? [shadow(n, a), n] : [n];
  if (n.tag === 'image') return [n];

  const fill = a.fill === undefined ? (n.tag === 'line' ? 'none' : '#000') : String(a.fill);
  const fo = a['fill-opacity'] === undefined ? 1 : N(a['fill-opacity']);
  const stroke = a.stroke === undefined ? 'none' : String(a.stroke);
  const sw = N(a['stroke-width'] ?? 1);
  const filled = fill !== 'none' && fill !== 'transparent' && (parseColor(fill)?.[3] ?? 1) * fo > 0.04;

  if (filled) {
    // a cut-out: no outline, solid paper of the color the tint shows, with hand-cut edges and fibres
    const solid = fill.startsWith('url(') ? null : overPaper(fill, fo, theme.bg);
    let piece: RNode = { ...n, attrs: { ...a, fill: solid ?? fill, 'fill-opacity': solid ? 1 : fo, stroke: 'none' } };
    const d = cutPath(n);
    if (d) {
      const rest = Object.fromEntries(Object.entries(piece.attrs).filter(([k]) => !GEOMETRY.includes(k)));
      piece = { ...n, tag: 'path', attrs: { ...rest, d } };
    }
    const out = bigEnough(n) ? [shadow(piece, piece.attrs), piece] : [piece];
    if (d && +theme.paperGrain > 0) out.push({ ...piece, key: n.key + ':fibre', attrs: { ...piece.attrs, fill: FIBRE, 'fill-opacity': 1, opacity: N(piece.attrs.opacity ?? 1) * 0.55 } });
    return out;
  }
  if (stroke === 'none' || sw <= 0) return [n];
  // an outline or a line: a strip of paper
  const attrs: RNode['attrs'] = { ...a, 'stroke-width': Math.max(sw, 3), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  return [shadow(n, attrs), { ...n, attrs }];
}
