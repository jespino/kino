import { defineWidget, h, type Props, type RenderCtx, type RNode } from '../core/widget.ts';
import { rect, type Rect } from '../core/geometry.ts';
import { fillTint } from '../core/color.ts';
import { isObj, list, num, str, type Value } from '../core/values.ts';
import { index, indexes } from './util.ts';

interface Item {
  id: string;
  label: string;
  v: number;
  hl?: string | null;
}

/** colors of pie slices (and bars with `colors: auto`), as theme tokens */
const PALETTE = ['accent', 'accent2', 'good', 'warn', 'info', 'bad'];
/** points sampled along each pie slice's arc, so slices always tween (the path keeps its shape) */
const ARC_STEPS = 24;

const fmtValue = (v: number, unit: string) => `${Number.isInteger(v) ? v : +v.toFixed(1)}${unit}`;

/** A round axis maximum above the data: 1, 2, 2.5, 5 × 10ⁿ. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const e = Math.pow(10, Math.floor(Math.log10(v)));
  return ([1, 2, 2.5, 5, 10].find((m) => m * e >= v) ?? 10) * e;
}

/** `values` (+ `labels`) or `data: { Mon: 3, Tue: 7 }` → items with stable ids */
function items(p: Props, values: Value, labels: Value, idOf: (i: number) => string): Item[] {
  if (isObj(values)) {
    return Object.entries(values).map(([k, v], i) => ({ id: idOf(i), label: k, v: num(v) }));
  }
  const ls = labels === null || labels === undefined ? [] : list(labels).map(str);
  return list(values).map((v, i) => ({ id: idOf(i), label: ls[i] ?? '', v: num(v) }));
}

/**
 * Bar, line and pie charts. Items keep identity: changing values grows and
 * shrinks bars, moves points and turns slices instead of redrawing.
 */
export const chart = defineWidget({
  type: 'chart',
  description:
    'Chart. Props: type (bar|line|pie), values + labels or data ({Mon: 3}), max (auto), width, height, color, colors (list or auto), unit, ' +
    'valueLabels (true), grid (true), hole (pie: 0..0.9, a donut), size. Methods: set(i,v), push(label, v), remove(i), highlight(i, color), unhighlight(i?). Anchors: c[i]',
  defaults: { type: 'bar', values: [], labels: null, data: null, max: null, width: 560, height: 300, color: 'accent', colors: null, unit: '', valueLabels: true, grid: true, hole: 0, size: 18, enter: 'fade' } as Props,
  init(p, ctx) {
    p.items = items(p, p.data ?? p.values, p.labels, (i) => `${ctx.name}#${i}`);
  },
  assign(p, path, value, ctx) {
    if (typeof path[0] === 'number' && path.length === 1) {
      p.items[index(ctx, path[0], p.items.length)].v = num(value);
      return true;
    }
    if (path[0] === 'values' || path[0] === 'data') {
      // keep ids by position (values) or by label (data), so bars grow instead of reappearing
      const next = items(p, value, path[0] === 'values' ? p.items.map((it: Item) => it.label) : null, () => '');
      p.items = next.map((it, i) => {
        const prev = path[0] === 'data' ? p.items.find((o: Item) => o.label === it.label) : p.items[i];
        return { ...it, id: prev?.id ?? ctx.newId(), hl: prev?.hl };
      });
      return true;
    }
    if (path[0] === 'labels') {
      list(value).forEach((l, i) => p.items[i] && (p.items[i].label = str(l)));
      return true;
    }
    return false;
  },
  methods: {
    set(p, [i, v], ctx) {
      p.items[index(ctx, i, p.items.length)].v = num(v);
    },
    push(p, [label, v], ctx) {
      if (v === undefined) p.items.push({ id: ctx.newId(), label: '', v: num(label) });
      else p.items.push({ id: ctx.newId(), label: str(label), v: num(v) });
    },
    remove(p, [i], ctx) {
      p.items.splice(index(ctx, i, p.items.length), 1);
    },
    highlight(p, [i, color], ctx) {
      for (const k of indexes(ctx, i, p.items.length)) p.items[k].hl = str(color ?? 'highlight');
    },
    unhighlight(p, [i], ctx) {
      for (const k of indexes(ctx, i, p.items.length)) p.items[k].hl = null;
    },
  },
  render(p, rc) {
    if (p.type === 'pie') return pie(p, rc);
    return xy(p, rc).nodes;
  },
  anchor(p, path, rc) {
    if (typeof path[0] !== 'number') return undefined;
    const it = p.items[path[0]];
    if (!it) return undefined;
    if (p.type === 'pie') return pieParts(p, rc).find((s) => s.it === it)?.box;
    return xy(p, rc).boxes.get(it.id);
  },
});

function colorOf(p: Props, rc: RenderCtx, it: Item, i: number): string {
  if (it.hl) return rc.color(it.hl, 'highlight');
  const cs = p.colors === null || p.colors === undefined ? (p.type === 'pie' ? PALETTE : null) : str(p.colors) === 'auto' ? PALETTE : list(p.colors).map(str);
  if (cs) return rc.color(cs[i % cs.length], 'accent');
  return rc.color(p.color, 'accent');
}

/** bar and line charts: a value axis with gridlines, categories along the bottom */
function xy(p: Props, rc: RenderCtx): { nodes: RNode[]; boxes: Map<string, Rect> } {
  const its = p.items as Item[];
  const s = p.size, W = p.width, H = p.height, unit = str(p.unit);
  const max = p.max === null || p.max === undefined ? niceMax(Math.max(0, ...its.map((it) => it.v))) : num(p.max);
  const left = p.grid ? rc.measure(fmtValue(max, unit), s * 0.8) + s * 0.8 : 0;
  const top = p.valueLabels ? s * 1.4 : s * 0.5;
  const plotW = W - left, plotH = H - top - s * 1.8;
  const y = (v: number) => top + plotH * (1 - Math.max(0, Math.min(v, max)) / max);
  const nodes: RNode[] = [];
  const boxes = new Map<string, Rect>();
  if (p.grid) {
    for (let k = 0; k <= 4; k++) {
      const gy = top + (plotH * k) / 4;
      nodes.push(h.line(`grid${k}`, left, gy, W, gy, { stroke: rc.theme.border, 'stroke-width': 1, opacity: k === 4 ? 0 : 0.6 }));
      nodes.push(h.text(`tick${k}`, left - s * 0.5, gy + s * 0.28, fmtValue((max * (4 - k)) / 4, unit), { 'font-size': s * 0.8, 'font-family': rc.theme.fontSans, 'text-anchor': 'end', fill: rc.theme.muted }));
    }
  }
  nodes.push(h.line('axis', left, top + plotH, W, top + plotH, { stroke: rc.theme.muted, 'stroke-width': 2 }));
  const slot = plotW / Math.max(1, its.length);
  const cx = (i: number) => left + slot * (i + 0.5);
  if (p.type === 'line' && its.length) {
    const d = its.map((it, i) => `${i ? 'L' : 'M'}${cx(i)} ${y(it.v)}`).join(' ');
    nodes.push(h.path('line', d, { stroke: rc.color(p.color, 'accent'), 'stroke-width': 3, fill: 'none', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, { enter: 'draw' }));
  }
  its.forEach((it, i) => {
    const color = colorOf(p, rc, it, i);
    const vy = y(it.v);
    if (p.type === 'line') {
      nodes.push(h.circle(`pt:${it.id}`, cx(i), vy, s * 0.35, { fill: color, stroke: rc.theme.bg, 'stroke-width': 2 }, { enter: 'pop' }));
      boxes.set(it.id, rect(cx(i) - s * 0.35, vy - s * 0.35, s * 0.7, s * 0.7));
    } else {
      const bw = Math.min(slot * 0.62, s * 5);
      const bh = top + plotH - vy;
      nodes.push(h.rect(`bar:${it.id}`, cx(i) - bw / 2, vy, bw, bh, { rx: Math.min(6, bw / 4), fill: fillTint(rc.theme, color, 0.85), stroke: color, 'stroke-width': 1.5 }, { enter: 'grow' }));
      boxes.set(it.id, rect(cx(i) - bw / 2, vy, bw, bh));
    }
    if (p.valueLabels)
      nodes.push(h.text(`val:${it.id}`, cx(i), vy - s * 0.55, fmtValue(it.v, unit), { 'font-size': s * 0.9, 'font-family': rc.theme.fontSans, 'font-weight': 700, 'text-anchor': 'middle', fill: it.hl ? color : rc.theme.fg }));
    if (it.label)
      nodes.push(h.text(`lab:${it.id}`, cx(i), top + plotH + s * 1.3, it.label, { 'font-size': s, 'font-family': rc.theme.fontSans, 'text-anchor': 'middle', fill: it.hl ? color : rc.theme.muted }));
  });
  return { nodes, boxes };
}

function pieParts(p: Props, rc: RenderCtx) {
  const its = p.items as Item[];
  const R = Math.min(p.width, p.height) / 2;
  const c = { x: R, y: R };
  const total = its.reduce((t, it) => t + Math.max(0, it.v), 0) || 1;
  let a = -Math.PI / 2;
  return its.map((it, i) => {
    const sweep = (Math.max(0, it.v) / total) * Math.PI * 2;
    const a0 = a, a1 = a + sweep;
    a = a1;
    const mid = (a0 + a1) / 2;
    return { it, i, a0, a1, mid, c, R, color: colorOf(p, rc, it, i), box: rect(c.x + Math.cos(mid) * R * 0.6 - 10, c.y + Math.sin(mid) * R * 0.6 - 10, 20, 20) };
  });
}

function pie(p: Props, rc: RenderCtx): RNode[] {
  const s = p.size;
  const hole = Math.max(0, Math.min(0.9, num(p.hole)));
  const nodes: RNode[] = [];
  for (const sl of pieParts(p, rc)) {
    const { c, R, a0, a1 } = sl;
    const pt = (r: number, a: number) => `${+(c.x + Math.cos(a) * r).toFixed(2)} ${+(c.y + Math.sin(a) * r).toFixed(2)}`;
    const outer = Array.from({ length: ARC_STEPS + 1 }, (_, k) => pt(R, a0 + ((a1 - a0) * k) / ARC_STEPS));
    const inner = hole ? Array.from({ length: ARC_STEPS + 1 }, (_, k) => pt(R * hole, a1 - ((a1 - a0) * k) / ARC_STEPS)) : [pt(0, 0)];
    nodes.push(h.path(`slice:${sl.it.id}`, `M${outer.join('L')}L${inner.join('L')}Z`, { fill: fillTint(rc.theme, sl.color, 0.85), stroke: rc.theme.bg, 'stroke-width': 2 }, { enter: 'pop' }));
    const share = Math.round(((a1 - a0) / (Math.PI * 2)) * 100);
    if (a1 - a0 < 0.05) continue;
    const right = Math.cos(sl.mid) >= 0;
    const lx = c.x + Math.cos(sl.mid) * (R + s * 0.8), ly = c.y + Math.sin(sl.mid) * (R + s * 0.8) + s * 0.35;
    const text = sl.it.label ? `${sl.it.label}${p.valueLabels ? ` ${share}%` : ''}` : p.valueLabels ? `${share}%` : '';
    if (text) nodes.push(h.text(`lab:${sl.it.id}`, lx, ly, text, { 'font-size': s, 'font-family': rc.theme.fontSans, 'text-anchor': right ? 'start' : 'end', fill: sl.it.hl ? sl.color : rc.theme.fg }));
  }
  return nodes;
}
