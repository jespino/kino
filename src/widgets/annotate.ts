import { defineWidget, glowRect, h, type RNode } from '../core/widget.ts';
import { center, clipToRect, rect, union, type Rect } from '../core/geometry.ts';
import { HALO_FILTER } from '../core/svg.ts';
import { isRef, str, type Value } from '../core/values.ts';
import { bracePath, roundRectPath } from './shapes.ts';
import { richMeasure, richText } from '../core/rich.ts';

/**
 * A note attached to something: rounded bubble + leader line + dot on the target.
 *   note: callout { target: mem.x, text: "little-endian:\nlowest byte first", side: below }
 */
export const callout = defineWidget({
  type: 'callout',
  overlay: true,
  description: 'Note attached to a target. Props: target, text ("\\n" for lines), side (auto|left|right|above|below), distance (70), color, size, mono',
  defaults: { target: null, text: '', side: 'auto', distance: 70, color: 'accent', size: 22, mono: false, enter: 'pop' },
  render(p, rc) {
    const t = rc.anchor(p.target);
    const c = center(t);
    const color = rc.color(p.color, 'accent');
    const lines = str(p.text).split('\n');
    const s = p.size;
    const pad = s * 0.75;
    const font = { size: s, mono: p.mono, weight: 500 };
    const tw = Math.max(...lines.map((l) => richMeasure(rc, l, font)));
    const W = tw + pad * 2, H = lines.length * s * 1.35 + pad * 1.2;
    let side = p.side;
    if (side === 'auto') side = c.x > rc.video.width * 0.6 ? 'left' : 'right';
    const d = p.distance;
    let [bx, by] =
      side === 'left' ? [t.x - d - W, c.y - H / 2]
      : side === 'above' ? [c.x - W / 2, t.y - d - H]
      : side === 'below' ? [c.x - W / 2, t.y + t.h + d]
      : [t.x + t.w + d, c.y - H / 2];
    // keep the bubble inside the frame
    const m = 24;
    bx = Math.max(m, Math.min(bx, rc.video.width - m - W));
    by = Math.max(m, Math.min(by, rc.video.height - m - H));
    const bubble = { x: bx, y: by, w: W, h: H };
    const from = clipToRect(bubble, c.x, c.y, 0);
    const to = clipToRect(t, center(bubble).x, center(bubble).y, 6);
    const nodes: RNode[] = [
      h.path('line', `M${from.x} ${from.y} L${to.x} ${to.y}`, { stroke: color, 'stroke-width': 2, fill: 'none', 'stroke-dasharray': '5 5' }, { enter: 'draw' }),
      h.circle('dot', to.x, to.y, 5, { fill: color }),
      glowRect('glow', bx, by, W, H, 12, color, 0.5),
      h.rect('bubble', bx, by, W, H, { rx: 12, fill: rc.theme.panel, stroke: color, 'stroke-width': 1.8 }),
    ];
    lines.forEach((l, i) =>
      nodes.push(
        ...richText(rc, `t${i}`, bx + pad, by + pad * 0.6 + s * (0.95 + i * 1.35), l, {
          'font-size': s, 'font-family': p.mono ? rc.theme.fontMono : rc.theme.fontSans, 'font-weight': 500, fill: rc.theme.fg,
        }, font),
      ),
    );
    return nodes;
  },
});

/**
 * Curly brace spanning one or more things, with a label at its tip.
 *   b: brace { from: mem[0], to: mem[3], side: below, label: "float x (4 bytes)" }
 */
export const brace = defineWidget({
  type: 'brace',
  overlay: true,
  description: 'Curly brace spanning targets. Props: from, to (optional), side (below|above|left|right), label, color, depth (18), gap (10), size',
  defaults: { from: null, to: null, side: 'below', label: '', color: 'warn', depth: 18, gap: 10, size: 20, enter: 'draw' },
  render(p, rc) {
    const targets: Value[] = [p.from, ...(p.to === null ? [] : [p.to])];
    const r = clearLabels(union(targets.map((t) => rc.anchor(t))), targets, p.side, rc.anchor);
    const g = p.gap, d = p.depth;
    // travel along the hugged edge so that the normal (-uy, ux) points away from the target
    const [x0, y0, x1, y1] =
      p.side === 'above' ? [r.x + r.w, r.y - g, r.x, r.y - g]
      : p.side === 'left' ? [r.x - g, r.y, r.x - g, r.y + r.h]
      : p.side === 'right' ? [r.x + r.w + g, r.y + r.h, r.x + r.w + g, r.y]
      : [r.x, r.y + r.h + g, r.x + r.w, r.y + r.h + g];
    const { path, tip, normal } = bracePath(x0, y0, x1, y1, d);
    const color = rc.color(p.color, 'warn');
    const nodes: RNode[] = [h.path('brace', path, { stroke: color, 'stroke-width': 2.5, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })];
    if (p.label) {
      const s = p.size;
      const lx = tip.x + normal.x * s * 0.8, ly = tip.y + normal.y * s * 0.8;
      const anchor = normal.x > 0.5 ? 'start' : normal.x < -0.5 ? 'end' : 'middle';
      const baseline = normal.y > 0.5 ? ly + s * 0.7 : normal.y < -0.5 ? ly : ly + s * 0.35;
      nodes.push(h.text('label', lx, baseline, str(p.label), { 'font-size': s, 'font-family': rc.theme.fontSans, 'font-weight': 600, 'text-anchor': anchor, fill: color }, { enter: 'fade' }));
    }
    return nodes;
  },
});

/**
 * Dims everything except a target, with a glowing ring around it; retarget to move the hole.
 *   spot: spotlight { target: regs.x0 }     spot.target = asm[1]     remove spot
 */
export const spotlight = defineWidget({
  type: 'spotlight',
  overlay: true,
  description: 'Dims everything but a target. Props: target, padding (14), dim (0.7), radius (12), color (glow ring). Retarget by assigning target',
  defaults: { target: null, padding: 14, dim: 0.7, radius: 12, color: 'glow', z: 50 },
  render(p, rc) {
    const t = rc.anchor(p.target);
    const pad = p.padding;
    const x = t.x - pad, y = t.y - pad, w = t.w + pad * 2, hh = t.h + pad * 2;
    const big = 20000; // far beyond any camera view
    const hole = roundRectPath(x, y, w, hh, p.radius);
    const color = rc.color(p.color, 'glow');
    return [
      h.path('shade', `M${-big} ${-big} L${big} ${-big} L${big} ${big} L${-big} ${big} Z ${hole}`, { fill: rc.theme.shade || '#000000', 'fill-rule': 'evenodd', opacity: p.dim }),
      h.path('halo', hole, { fill: 'none', stroke: color, 'stroke-width': 6, filter: HALO_FILTER, opacity: 0.8 }),
      h.path('ring', hole, { fill: 'none', stroke: color, 'stroke-width': 2 }),
    ];
  },
});

/**
 * Braces on parts of a widget (`a[1]` .. `a[5]`) also clear the thin strip of
 * labels the widget draws next to them, like an array's index row, instead of
 * cutting through it. Only strips thinner than the parts themselves count, so a
 * brace under one struct row doesn't jump past the rows below it.
 */
function clearLabels(r: Rect, targets: Value[], side: string, anchor: (v: Value) => Rect): Rect {
  const owners = [...new Set(targets.filter((t) => isRef(t) && t.$ref.length > 1).map((t) => String((t as { $ref: unknown[] }).$ref[0])))];
  if (owners.length !== 1) return r;
  const b = anchor({ $ref: [owners[0]], text: owners[0] } as Value);
  const limit = (side === 'left' || side === 'right' ? r.w : r.h) * 0.8;
  switch (side) {
    case 'above': {
      const extra = r.y - b.y;
      return extra > 0 && extra <= limit ? rect(r.x, b.y, r.w, r.h + extra) : r;
    }
    case 'left': {
      const extra = r.x - b.x;
      return extra > 0 && extra <= limit ? rect(b.x, r.y, r.w + extra, r.h) : r;
    }
    case 'right': {
      const extra = b.x + b.w - (r.x + r.w);
      return extra > 0 && extra <= limit ? rect(r.x, r.y, r.w + extra, r.h) : r;
    }
    default: {
      const extra = b.y + b.h - (r.y + r.h);
      return extra > 0 && extra <= limit ? rect(r.x, r.y, r.w, r.h + extra) : r;
    }
  }
}
