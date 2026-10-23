import { captionAttrs, defineWidget, glowRect, h, midBaseline, type Props, type RenderCtx, type RNode, type WidgetCtx } from '../core/widget.ts';
import { rect, type Rect } from '../core/geometry.ts';
import { isObj, list, num, str, type Value } from '../core/values.ts';
import { fillTint } from '../core/color.ts';
import { index, indexes, spread } from './util.ts';

interface Item {
  id: string;
  v: Value;
  hl?: string | null;
  /** id of the item this one was copied from (it flies out of it) */
  from?: string;
}

interface Range {
  from: number;
  to: number;
  label: string;
  color: string;
}

const newItem = (ctx: WidgetCtx, v: Value, from?: string): Item => ({ id: ctx.newId(), v, from });

function geometry(p: Props) {
  const vertical = p.direction === 'vertical';
  const labelH = p.label ? p.size * 1.5 : 0;
  const cell = (i: number): Rect =>
    vertical ? rect(0, labelH + i * (p.cell + p.gap), p.cell * p.width, p.cell) : rect(i * (p.cell * p.width + p.gap), labelH, p.cell * p.width, p.cell);
  const slots = Math.max(p.capacity ?? 0, (p.items as Item[]).length);
  return { vertical, labelH, cell, slots };
}

/**
 * A row (or column) of cells. Items keep identity: swap/insert/remove/move
 * animate values sliding around, and copyFrom/moveFrom make them fly between arrays.
 * `capacity` draws extra empty slots (think Go slice cap vs len).
 */
export const array = defineWidget({
  type: 'array',
  description:
    'Cells with values. Props: values, capacity, cell, width, gap, indices, label, direction (horizontal|vertical), size. ' +
    'Methods: push, pop, shift, unshift, insert(i,v), remove(i), set(i,v), swap(i,j), move(from,to), clear, reverse, sort, ' +
    'highlight(i|[i..], color), unhighlight(i?), range(name, from, to, color?), unrange(name), copyFrom(other, at?), moveFrom(other, count?), ' +
    'broadcast(other, i), gather(other, [indices])',
  defaults: { values: [], capacity: null, cell: 64, width: 1, gap: 6, indices: true, label: '', direction: 'horizontal', size: 24, items: [], ranges: {} } as Props,
  init(p, ctx) {
    p.items = list(p.values).map((v, i) => ({ id: `${ctx.name}#${i}`, v }));
    if (isObj(p.ranges)) {
      for (const [k, r] of Object.entries(p.ranges as Props)) p.ranges[k] = { label: k, color: 'warn', ...r };
    }
    delete p.values;
  },
  assign(p, path, value, ctx) {
    const items = p.items as Item[];
    if (path.length === 1 && typeof path[0] === 'number') {
      const i = index(ctx, path[0], p.capacity ?? items.length + 1, true);
      while (items.length <= i) items.push(newItem(ctx, null));
      items[i].v = value;
      return true;
    }
    if (path[0] === 'values') {
      p.items = list(value).map((v, i) => (items[i] ? { ...items[i], v } : newItem(ctx, v)));
      return true;
    }
    return false;
  },
  methods: {
    push: (p, args, ctx) => (p.items as Item[]).push(...spread(args).map((v) => newItem(ctx, v))),
    append: (p, args, ctx) => (p.items as Item[]).push(...spread(args).map((v) => newItem(ctx, v))),
    pop: (p) => void (p.items as Item[]).pop(),
    shift: (p) => void (p.items as Item[]).shift(),
    unshift: (p, args, ctx) => (p.items as Item[]).unshift(...spread(args).map((v) => newItem(ctx, v))),
    insert(p, [i, v], ctx) {
      (p.items as Item[]).splice(index(ctx, i, p.items.length, true), 0, newItem(ctx, v ?? null));
    },
    remove(p, [i], ctx) {
      p.items.splice(index(ctx, i, p.items.length), 1);
    },
    set(p, [i, v], ctx) {
      const items = p.items as Item[];
      const k = index(ctx, i, p.capacity ?? items.length + 1, true);
      while (items.length <= k) items.push(newItem(ctx, null));
      items[k].v = v ?? null;
    },
    swap(p, [i, j], ctx) {
      const items = p.items as Item[];
      const a = index(ctx, i, items.length);
      const b = index(ctx, j, items.length);
      [items[a], items[b]] = [items[b], items[a]];
    },
    move(p, [from, to], ctx) {
      const items = p.items as Item[];
      const [it] = items.splice(index(ctx, from, items.length), 1);
      items.splice(index(ctx, to, items.length, true), 0, it);
    },
    clear: (p) => void (p.items = []),
    reverse: (p) => void (p.items as Item[]).reverse(),
    sort(p, [order]) {
      const cmp = (a: Item, b: Item) =>
        typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : str(a.v).localeCompare(str(b.v));
      (p.items as Item[]).sort((a, b) => (order === 'desc' ? -cmp(a, b) : cmp(a, b)));
    },
    highlight(p, [i, color], ctx) {
      for (const k of indexes(ctx, i, p.items.length)) p.items[k].hl = str(color ?? 'highlight');
    },
    unhighlight(p, [i], ctx) {
      for (const k of indexes(ctx, i, p.items.length)) p.items[k].hl = null;
    },
    range(p, [name, from, to, color, label]) {
      p.ranges[str(name)] = { from: num(from), to: num(to), color: str(color ?? 'warn'), label: label === undefined ? str(name) : str(label) };
    },
    unrange(p, [name]) {
      delete p.ranges[str(name)];
    },
    /** copy values of another array; the copies fly out of the originals */
    copyFrom(p, [other, at], ctx) {
      const src = ctx.props(refName(other, ctx)).items as Item[];
      const start = at === undefined ? 0 : num(at);
      const items = p.items as Item[];
      src.forEach((s, k) => {
        const it = newItem(ctx, s.v, s.id);
        if (start + k < items.length) items[start + k] = it;
        else items.push(it);
      });
    },
    /** fill every slot with copies of other[i]; they all fly out of that one cell (SIMD broadcast) */
    broadcast(p, [other, i], ctx) {
      const src = ctx.props(refName(other, ctx)).items as Item[];
      const s = src[index(ctx, i ?? 0, src.length)];
      const n = Math.max(p.capacity ?? 0, (p.items as Item[]).length, 1);
      p.items = Array.from({ length: n }, () => newItem(ctx, s.v, s.id));
    },
    /** lane k = copy of other[indices[k]] (`_` keeps lane k): permutes, blends, gathers */
    gather(p, [other, idx], ctx) {
      const src = ctx.props(refName(other, ctx)).items as Item[];
      const items = p.items as Item[];
      list(idx ?? null).forEach((k, lane) => {
        if (k === null) return;
        const s = src[index(ctx, k, src.length)];
        while (items.length <= lane) items.push(newItem(ctx, null));
        items[lane] = newItem(ctx, s.v, s.id);
      });
    },
    /** take all items out of another array (same identities, so they move) */
    moveFrom(p, [other, count], ctx) {
      // all items, or the first `count` (they keep their identity, so they fly over)
      const srcProps = ctx.props(refName(other, ctx));
      const n = count === undefined ? srcProps.items.length : Math.max(0, num(count));
      (p.items as Item[]).push(...(srcProps.items as Item[]).slice(0, n));
      srcProps.items = (srcProps.items as Item[]).slice(n);
    },
  },
  render(p, rc) {
    const { vertical, cell, slots } = geometry(p);
    const items = p.items as Item[];
    const nodes: RNode[] = [];
    if (p.label) nodes.push(h.text('label', 0, p.size * 0.75, str(p.label).toUpperCase(), captionAttrs(rc, p.size * 0.55)));
    for (let i = 0; i < slots; i++) {
      const r = cell(i);
      const used = i < items.length;
      nodes.push(
        h.rect(`slot${i}`, r.x, r.y, r.w, r.h, {
          rx: 8,
          fill: rc.theme.surface2,
          stroke: rc.theme.border,
          'stroke-width': 1.5,
          'stroke-dasharray': used ? '1 0' : '5 5',
          opacity: used ? 1 : 0.7,
        }),
      );
      if (p.indices) {
        const at = vertical
          ? h.text(`idx${i}`, r.x - 10, midBaseline(r.y, r.h, p.size * 0.55), String(i), idxAttrs(rc, p.size, 'end'))
          : h.text(`idx${i}`, r.x + r.w / 2, r.y + r.h + p.size * 0.85, String(i), idxAttrs(rc, p.size, 'middle'));
        nodes.push(at);
      }
    }
    items.forEach((it, i) => {
      const r = cell(i);
      const hl = it.hl ? rc.color(it.hl, 'highlight') : null;
      const isNull = it.v === null || it.v === '';
      const from = (k: string) => ({ origin: it.from && `${k}${it.from}`, enter: 'pop' });
      nodes.push(
        glowRect(`@iglow:${it.id}`, r.x, r.y, r.w, r.h, 8, hl ?? rc.theme.glow, hl ? 0.9 : 0),
        h.rect(`@ibg:${it.id}`, r.x, r.y, r.w, r.h, {
          rx: 8, fill: hl ? fillTint(rc.theme, hl, 0.18) : rc.theme.surface, stroke: hl ?? rc.theme.border, 'stroke-width': 1.5, opacity: isNull && !hl ? 0 : 1,
        }, from('@ibg:')),
        h.text(`@item:${it.id}`, r.x + r.w / 2, midBaseline(r.y, r.h, p.size), str(it.v), {
          'font-size': p.size, 'font-family': rc.theme.fontMono, 'font-weight': 700, 'text-anchor': 'middle', fill: rc.theme.fg,
        }, from('@item:')),
      );
    });
    for (const [name, r] of Object.entries(p.ranges as Record<string, Range>)) nodes.push(...rangeNodes(rc, p, name, r));
    return nodes;
  },
  anchor(p, path) {
    const { cell, slots } = geometry(p);
    if (path.length === 1 && typeof path[0] === 'number') {
      const i = path[0] < 0 ? path[0] + p.items.length : path[0];
      return cell(Math.min(Math.max(i, 0), Math.max(slots, i)));
    }
    if (path.length === 1 && p.ranges[path[0]]) {
      const r = p.ranges[path[0]] as Range;
      const a = cell(r.from);
      const b = cell(Math.max(r.from, r.to - 1));
      return rect(a.x, a.y, b.x + b.w - a.x, b.y + b.h - a.y);
    }
    return undefined;
  },
});

function idxAttrs(rc: RenderCtx, size: number, anchor: string) {
  return { 'font-size': size * 0.55, 'font-family': rc.theme.fontMono, 'text-anchor': anchor, fill: rc.theme.muted };
}

/** Stack ranges only when they overlap: each one takes the first lane free over its cells. */
function rangeLanes(ranges: Record<string, Range>): Map<string, number> {
  const lanes: Range[][] = [];
  const out = new Map<string, number>();
  for (const [name, r] of Object.entries(ranges)) {
    const lo = r.from;
    const hi = Math.max(r.from + 1, r.to);
    let k = lanes.findIndex((lane) => lane.every((o) => hi <= o.from || lo >= Math.max(o.from + 1, o.to)));
    if (k < 0) k = lanes.push([]) - 1;
    lanes[k].push(r);
    out.set(name, k);
  }
  return out;
}

/** Bracket under (or beside) cells [from, to) with a label: shows slices/windows over the array. */
function rangeNodes(rc: RenderCtx, p: Props, name: string, r: Range): RNode[] {
  const { vertical, cell } = geometry(p);
  const a = cell(r.from);
  const b = cell(Math.max(r.from, r.to - 1));
  const color = rc.color(r.color, 'warn');
  const empty = r.to <= r.from;
  const lw = { stroke: color, 'stroke-width': 2.5, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
  const ts = p.size * 0.7;
  const order = rangeLanes(p.ranges as Record<string, Range>).get(name) ?? 0;
  if (vertical) {
    const x = a.x + a.w + 14 + order * 36;
    const y0 = a.y + 4;
    const y1 = empty ? y0 : b.y + b.h - 4;
    return [
      h.path(`range:${name}`, `M${x - 8} ${y0} L${x} ${y0} L${x} ${y1} L${x - 8} ${y1}`, lw),
      h.text(`rlabel:${name}`, x + 8, (y0 + y1) / 2 + ts * 0.35, r.label, { 'font-size': ts, 'font-family': rc.theme.fontMono, fill: color }),
    ];
  }
  const y = a.y + a.h + (p.indices ? p.size * 1.55 : 14) + order * p.size * 1.7;
  const x0 = a.x + 4;
  const x1 = empty ? x0 : b.x + b.w - 4;
  return [
    h.path(`range:${name}`, `M${x0} ${y - 8} L${x0} ${y} L${x1} ${y} L${x1} ${y - 8}`, lw),
    h.text(`rlabel:${name}`, (x0 + x1) / 2, y + ts * 1.25, r.label, { 'font-size': ts, 'font-family': rc.theme.fontMono, 'text-anchor': 'middle', fill: color }),
  ];
}

export function refName(v: Value | undefined, ctx: WidgetCtx): string {
  if (typeof v === 'object' && v !== null && '$ref' in v) return String((v as any).$ref[0]);
  if (typeof v === 'string') return v;
  ctx.error('expected a widget name');
}
