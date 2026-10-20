import { defineWidget, h, type RNode } from '../core/widget.ts';
import { center, clipToRect } from '../core/geometry.ts';
import { GLOW_FILTER } from '../core/svg.ts';
import { str, type Value } from '../core/values.ts';

/** Arrow between two anchors: `p: arrow { from: s.ptr, to: data[0] }` or the `s.ptr -> data[0]` sugar. */
export const arrow = defineWidget({
  type: 'arrow',
  overlay: true,
  description: 'Arrow between widgets/parts/points. Props: from, to, label, curve (-1..1), color, width, dashed, glow, head (end|both|none), size',
  defaults: { from: null, to: null, label: '', curve: 0, color: 'accent', width: 2.5, dashed: false, head: 'end', size: 18, glow: true, enter: 'draw' },
  render(p, rc) {
    const ra = rc.anchor(p.from);
    const rb = rc.anchor(p.to);
    const ca = center(ra);
    const cb = center(rb);
    const dist = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
    // control point offset perpendicular to the line
    const mx = (ca.x + cb.x) / 2 - ((cb.y - ca.y) / dist) * p.curve * dist * 0.5;
    const my = (ca.y + cb.y) / 2 + ((cb.x - ca.x) / dist) * p.curve * dist * 0.5;
    const a = clipToRect(ra, mx, my, 2);
    const b = clipToRect(rb, mx, my, 4);
    const color = rc.color(p.color, 'accent');
    const head = 13;
    const nodes: RNode[] = [];
    // shorten the line under arrow heads
    const shorten = (pt: { x: number; y: number }, from: { x: number; y: number }) => {
      const d = Math.hypot(pt.x - from.x, pt.y - from.y) || 1;
      return { x: pt.x - ((pt.x - from.x) / d) * head * 0.8, y: pt.y - ((pt.y - from.y) / d) * head * 0.8 };
    };
    const cx = p.curve ? mx : (a.x + b.x) / 2;
    const cy = p.curve ? my : (a.y + b.y) / 2;
    const end = p.head !== 'none' ? shorten(b, { x: cx, y: cy }) : b;
    const start = p.head === 'both' ? shorten(a, { x: cx, y: cy }) : a;
    const line = `M${start.x} ${start.y} Q${cx} ${cy} ${end.x} ${end.y}`;
    if (p.glow)
      nodes.push(
        h.path('glow', line, {
          fill: 'none', stroke: color, 'stroke-width': p.width * 2.5, 'stroke-linecap': 'round', filter: GLOW_FILTER, opacity: 0.7,
        }, { enter: p.enter }),
      );
    nodes.push(
      h.path('line', line, {
        fill: 'none', stroke: color, 'stroke-width': p.width, 'stroke-linecap': 'round', 'stroke-dasharray': p.dashed ? '9 7' : undefined,
      }, { enter: p.enter }),
    );
    // the head rides the tip of the line while it draws; the tail is there from the start
    const tri = (tip: { x: number; y: number }, from: { x: number; y: number }, key: string, track?: string) => {
      const d = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
      const ux = (tip.x - from.x) / d, uy = (tip.y - from.y) / d;
      const bx = tip.x - ux * head, by = tip.y - uy * head;
      nodes.push(
        h.path(key, `M${tip.x} ${tip.y} L${bx - uy * head * 0.5} ${by + ux * head * 0.5} L${bx + uy * head * 0.5} ${by - ux * head * 0.5} Z`, { fill: color }, track && p.enter === 'draw' ? { enter: 'draw', track } : { enter: 'fade' }),
      );
    };
    if (p.head !== 'none') tri(b, { x: cx, y: cy }, 'head', line);
    if (p.head === 'both') tri(a, { x: cx, y: cy }, 'tail');
    if (p.label) {
      const lx = 0.25 * a.x + 0.5 * cx + 0.25 * b.x;
      const ly = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
      nodes.push(h.text('label', lx, ly - 10, str(p.label), { 'font-size': p.size, 'font-family': rc.theme.fontSans, 'text-anchor': 'middle', fill: color }));
    }
    return nodes;
  },
});

/** Small labeled marker pointing at a widget part: index variables (i, j, lo, hi), "head", "top"... */
export const pointer = defineWidget({
  type: 'pointer',
  overlay: true,
  description: 'Labeled marker pointing at a target. Props: target, label, side (below|above|left|right), color, size, distance',
  defaults: { target: null, label: '', side: 'below', color: 'warn', size: 20, distance: 6, enter: 'pop' },
  render(p, rc) {
    const r = rc.anchor(p.target);
    const color = rc.color(p.color, 'warn');
    const t = p.size * 0.6;
    const d = p.distance;
    let tip: { x: number; y: number };
    let dir: { x: number; y: number };
    if (p.side === 'above') { tip = { x: r.x + r.w / 2, y: r.y - d }; dir = { x: 0, y: -1 }; }
    else if (p.side === 'left') { tip = { x: r.x - d, y: r.y + r.h / 2 }; dir = { x: -1, y: 0 }; }
    else if (p.side === 'right') { tip = { x: r.x + r.w + d, y: r.y + r.h / 2 }; dir = { x: 1, y: 0 }; }
    else { tip = { x: r.x + r.w / 2, y: r.y + r.h + d }; dir = { x: 0, y: 1 }; }
    const bx = tip.x + dir.x * t * 1.3, by = tip.y + dir.y * t * 1.3;
    const lx = tip.x + dir.x * (t * 1.6 + p.size * 0.2);
    const ly = tip.y + dir.y * (t * 1.6 + p.size * 0.2);
    const anchor = dir.x > 0 ? 'start' : dir.x < 0 ? 'end' : 'middle';
    const baseline = dir.y > 0 ? ly + p.size * 0.8 : dir.y < 0 ? ly - p.size * 0.15 : ly + p.size * 0.35;
    return [
      h.path('tri', `M${tip.x} ${tip.y} L${bx - dir.y * t} ${by + dir.x * t} L${bx + dir.y * t} ${by - dir.x * t} Z`, { fill: color }, { enter: p.enter }),
      h.text('label', lx, baseline, str(p.label), { 'font-size': p.size, 'font-family': rc.theme.fontMono, 'font-weight': 700, 'text-anchor': anchor, fill: color }, { enter: p.enter }),
    ];
  },
});

/** Mouse cursor for UI walkthroughs: `cur.at = okButton`, `cur.click()`. */
export const cursor = defineWidget({
  type: 'cursor',
  overlay: true,
  description: 'Mouse pointer. Props: at (point or widget), color, scale. Methods: moveTo(target), click(target?)',
  defaults: { at: { $pt: [0, 0] } as Value, color: '#ffffff', scale: 1, clicks: 0, z: 100, enter: 'fade' },
  methods: {
    moveTo(p, [target]) {
      p.at = target ?? p.at;
    },
    click(p, [target]) {
      if (target !== undefined) p.at = target;
      p.clicks++;
    },
  },
  render(p, rc) {
    const c = center(rc.anchor(p.at));
    const s = p.scale * 1.4;
    const pts = [
      [0, 0], [0, 17], [4.2, 13.2], [7, 19.5], [9.8, 18.3], [7.1, 12.2], [12.5, 12.2],
    ].map(([x, y]) => `${c.x + x * s} ${c.y + y * s}`);
    const nodes: RNode[] = [];
    if (p.clicks > 0)
      nodes.push(h.circle(`ripple${p.clicks}`, c.x, c.y, 26, { fill: 'none', stroke: rc.theme.accent, 'stroke-width': 3 }, { transient: true, enter: 'ripple' }));
    nodes.push(
      h.path('shape', `M${pts[0]} L${pts.slice(1).join(' L')} Z`, {
        fill: rc.color(p.color, 'fg'), stroke: '#000000', 'stroke-width': 1.4, 'stroke-linejoin': 'round',
      }),
    );
    return nodes;
  },
});
