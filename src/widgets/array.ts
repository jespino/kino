import { captionAttrs, defineWidget, glowRect, h, midBaseline, type Props, type RenderCtx, type RNode, type WidgetCtx } from '../core/widget.ts';
import { center, clipToRect, rect, type Rect } from '../core/geometry.ts';
import { isObj, list, num, str, type Value } from '../core/values.ts';
import { easings } from '../core/easing.ts';
import { fillTint } from '../core/color.ts';
import { index, indexes, spread } from './util.ts';

interface Item {
  id: string;
  v: Value;
  hl?: string | null;
  /** id of the item this one was copied from (it flies out of it) */
  from?: string;
  /** made by combine(): the items that flew in (ids and values) and the operator signs drawn between them */
  inputs?: { from: string; v: Value; source: Value }[];
  signs?: string[];
  combine?: CombineOptions;
}

interface CombineOptions {
  style: string;
  label: string;
  fly: number;
  hold: number;
  merge: number;
  flyEasing: string;
  mergeEasing: string;
  operator: string;
  result: string;
}
const COMBINE_DEFAULTS: CombineOptions = {
  style: 'expression', label: '',
  fly: 600, hold: 700, merge: 400,
  flyEasing: 'ease-in-out', mergeEasing: 'ease-in-out', operator: 'fade', result: 'pop',
};
const COMBINE_EFFECTS = ['fade', 'pop', 'none', 'slide-up', 'slide-down', 'slide-left', 'slide-right'];
function combineOptions(v: Value | undefined, ctx: WidgetCtx): CombineOptions {
  const options = { ...COMBINE_DEFAULTS };
  if (v === undefined) return options;
  if (!isObj(v)) ctx.error('combine: expected an options object');
  for (const [key, value] of Object.entries(v)) {
    if (!Object.hasOwn(COMBINE_DEFAULTS, key)) ctx.error(`combine: unknown option '${key}'; use ${Object.keys(COMBINE_DEFAULTS).join(', ')}`);
    if (key === 'fly' || key === 'hold' || key === 'merge') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) ctx.error(`combine: ${key} must be a non-negative duration, e.g. 600ms`);
      options[key] = value;
    } else if (key === 'flyEasing' || key === 'mergeEasing') {
      const name = str(value);
      if (!Object.hasOwn(easings, name)) ctx.error(`combine: unknown easing '${name}'`);
      options[key] = name;
    } else if (key === 'style') {
      const name = str(value);
      if (!['expression', 'arrows'].includes(name)) ctx.error('combine: style must be expression or arrows');
      options.style = name;
    } else if (key === 'label') {
      options.label = str(value);
    } else if (key === 'operator' || key === 'result') {
      const name = str(value);
      if (!COMBINE_EFFECTS.includes(name)) ctx.error(`combine: ${key} must be one of ${COMBINE_EFFECTS.join(', ')}`);
      options[key] = name;
    }
  }
  if (!Number.isFinite(options.fly + options.hold + options.merge) || options.fly + options.hold + options.merge <= 0) ctx.error('combine: total duration must be greater than zero');
  return options;
}

/** combine() operators: how many inputs, the signs drawn between them, and the result */
interface Op {
  arity: number;
  signs: string[];
  fn: (x: Value[], n: (i: number) => number) => Value;
}
const fmt = (x: number) => (Number.isInteger(x) ? x : Number(x.toPrecision(10)));
const tf = (b: boolean) => (b ? 'T' : 'F');
const truthy = (v: Value) => v === true || v === 'T' || v === 'true' || (typeof v === 'number' && v !== 0);
const OPS: Record<string, Op> = {
  '+': { arity: 2, signs: ['+'], fn: (_, n) => fmt(n(0) + n(1)) },
  '-': { arity: 2, signs: ['−'], fn: (_, n) => fmt(n(0) - n(1)) },
  '*': { arity: 2, signs: ['×'], fn: (_, n) => fmt(n(0) * n(1)) },
  '/': { arity: 2, signs: ['÷'], fn: (_, n) => fmt(n(0) / n(1)) },
  min: { arity: 2, signs: ['min'], fn: (_, n) => Math.min(n(0), n(1)) },
  max: { arity: 2, signs: ['max'], fn: (_, n) => Math.max(n(0), n(1)) },
  and: { arity: 2, signs: ['&'], fn: (_, n) => n(0) & n(1) },
  or: { arity: 2, signs: ['|'], fn: (_, n) => n(0) | n(1) },
  xor: { arity: 2, signs: ['^'], fn: (_, n) => n(0) ^ n(1) },
  andnot: { arity: 2, signs: ['&^'], fn: (_, n) => n(0) & ~n(1) },
  '<': { arity: 2, signs: ['<'], fn: (_, n) => tf(n(0) < n(1)) },
  '>': { arity: 2, signs: ['>'], fn: (_, n) => tf(n(0) > n(1)) },
  '<=': { arity: 2, signs: ['≤'], fn: (_, n) => tf(n(0) <= n(1)) },
  '>=': { arity: 2, signs: ['≥'], fn: (_, n) => tf(n(0) >= n(1)) },
  '==': { arity: 2, signs: ['='], fn: (x) => tf(str(x[0]) === str(x[1])) },
  '!=': { arity: 2, signs: ['≠'], fn: (x) => tf(str(x[0]) !== str(x[1])) },
  fma: { arity: 3, signs: ['×', '+'], fn: (_, n) => fmt(n(0) * n(1) + n(2)) },
  ifelse: { arity: 3, signs: ['?', ':'], fn: (x) => (truthy(x[0]) ? x[1] : x[2]) },
};

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
    'broadcast(other, i), gather(other, [indices]), combine(op, a, b, ..., lanes?, options?) — lane k = a[k] op b[k]; the inputs fly in and merge; options style: arrows draws a boxed operation (op: + - * / min max and or xor andnot < > <= >= == != fma ifelse)',
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
    /**
     * lane k = op(a[k], b[k], ...): copies of the inputs fly into lane k, the
     * operator appears between them, and they merge into the result. Pass the
     * lanes (`[0]`, `[2, 3]`) to do some of them; all by default (the SIMD picture).
     */
    combine(p, [op, ...rest], ctx) {
      const name = str(op ?? '');
      const spec = OPS[name];
      if (!spec) ctx.error(`combine: unknown operator '${name}'; use one of ${Object.keys(OPS).join(' ')}, e.g. out.combine("+", a, b)`);
      const options = combineOptions(isObj(rest.at(-1)) ? rest.pop() : undefined, ctx);
      if (rest.length < spec.arity || rest.length > spec.arity + 1)
        ctx.error(`combine: '${name}' takes ${spec.arity} arrays and optionally the lanes, e.g. out.combine("${name}", ${['a', 'b', 'c'].slice(0, spec.arity).join(', ')}, [0])`);
      const srcs = rest.slice(0, spec.arity).map((s) => ctx.props(refName(s, ctx)).items as Item[]);
      const items = p.items as Item[];
      const len = Math.min(...srcs.map((s) => s.length));
      for (const k of indexes(ctx, rest[spec.arity], len)) {
        const ins = srcs.map((s) => s[k]);
        const n = (i: number) => {
          const v = ins[i].v;
          if (typeof v === 'number') return v;
          if (v === 'T' || v === 'F' || typeof v === 'boolean') return truthy(v) ? 1 : 0;
          const x = Number(v);
          if (v === null || v === '' || Number.isNaN(x)) ctx.error(`combine: lane ${k} input ${i + 1} is '${str(v)}', not a number`);
          return x;
        };
        while (items.length <= k) items.push(newItem(ctx, null));
        items[k] = { id: ctx.newId(), v: spec.fn(ins.map((it) => it.v), n), inputs: ins.map((it, j) => ({ from: it.id, v: it.v, source: { $ref: [refName(rest[j], ctx), k], text: `${refName(rest[j], ctx)}[${k}]` } })), signs: spec.signs, combine: options };
      }
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
        }, { ...from('@item:'), ...(it.combine ? { enter: it.combine.result, timing: combineTiming(it.combine, 'result') } : {}) }),
      );
      if (it.inputs && it.combine?.style !== 'arrows') nodes.push(...combineNodes(rc, p, it, r));
    });
    for (const [name, r] of Object.entries(p.ranges as Record<string, Range>)) nodes.push(...rangeNodes(rc, p, name, r));
    return nodes;
  },
  placed(p, rc, self) {
    const { cell } = geometry(p);
    return (p.items as Item[]).flatMap((it, i) => {
      if (!it.inputs || it.combine?.style !== 'arrows') return [];
      const r = cell(i);
      return combineArrows(rc, p, it, rect(r.x + self.dx, r.y + self.dy, r.w, r.h));
    });
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

function combineTiming(o: CombineOptions, role: 'input' | 'operator' | 'result'): NonNullable<RNode['timing']> {
  const duration = o.fly + o.hold + o.merge;
  const mergeStart = o.fly + o.hold;
  return role === 'result'
    ? { duration, start: mergeStart, end: duration, easing: o.mergeEasing }
    : { duration, start: role === 'operator' ? o.fly / 2 : 0, end: o.fly, leave: mergeStart, gone: duration, easing: o.flyEasing, exitEasing: o.mergeEasing };
}

/**
 * The moment a combined lane is made: its inputs fly in and line up as an
 * expression ("1 + 10") inside the cell, then dissolve into the result.
 * All transient, so they only exist during the step that calls combine().
 */
function combineNodes(rc: RenderCtx, p: Props, it: Item, r: Rect): RNode[] {
  const ins = it.inputs!;
  const tokens = ins.flatMap((x, j) => (j === 0 ? [str(x.v)] : [it.signs![j - 1] ?? '', str(x.v)]));
  const gap = (fs: number) => fs * 0.3;
  const widths = (fs: number) => tokens.map((t) => rc.measure(t, fs, true, 700));
  const total = (fs: number) => widths(fs).reduce((a, b) => a + b, 0) + gap(fs) * (tokens.length - 1);
  const fs = p.size * Math.min(1, (r.w * 0.92) / Math.max(1, total(p.size)));
  const w = widths(fs);
  const y = midBaseline(r.y, r.h, fs);
  const sign = rc.color('warn', 'warn');
  let x = r.x + r.w / 2 - total(fs) / 2;
  return tokens.map((t, i) => {
    const cx = x + w[i] / 2;
    x += w[i] + gap(fs);
    const attrs = { 'font-size': fs, 'font-family': rc.theme.fontMono, 'font-weight': 700, 'text-anchor': 'middle', fill: i % 2 ? sign : rc.theme.fg };
    return i % 2
      ? h.text(`cmb:${it.id}:op${i}`, cx, y, t, attrs, { transient: true, enter: it.combine!.operator, timing: combineTiming(it.combine!, 'operator') })
      : h.text(`cmb:${it.id}:in${i}`, cx, y, t, attrs, { transient: true, origin: `@item:${ins[i / 2].from}`, timing: combineTiming(it.combine!, 'input') });
  });
}

/** Stationary operands feed a boxed operation, then an arrow reveals the result.
 * Kept out of layout so the temporary connectors never move the arrays. */
function combineArrows(rc: RenderCtx, p: Props, it: Item, dest: Rect): RNode[] {
  const o = it.combine!;
  let sources: Rect[];
  try {
    sources = it.inputs!.map(input => rc.anchor(input.source));
  } catch (error) {
    // Item metadata survives subsequent steps, including removal of its inputs.
    if (error instanceof Error && error.message.includes('unknown widget')) return [];
    throw error;
  }
  const target = center(dest);
  const nearest = sources.reduce((a, b) => Math.hypot(center(a).x - target.x, center(a).y - target.y) < Math.hypot(center(b).x - target.x, center(b).y - target.y) ? a : b);
  const c = center(nearest);
  const vertical = Math.abs(target.y - c.y) >= Math.abs(target.x - c.x);
  const edge = clipToRect(nearest, target.x, target.y);
  const end = clipToRect(dest, c.x, c.y);
  const label = o.label || it.signs!.join(' ');
  const fs = p.size;
  const height = Math.max(32, fs * 1.6);
  const width = Math.max(height, rc.measure(label, fs, true, 700) + fs);
  const hub = rect((edge.x + end.x - width) / 2, (edge.y + end.y - height) / 2, width, height);
  const hc = center(hub);
  const nodes: RNode[] = [];
  const addArrow = (key: string, points: { x: number; y: number }[], color: string, output = false) => {
    const tip = points.at(-1)!;
    const prev = points.at(-2)!;
    const length = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
    const ux = (tip.x - prev.x) / length, uy = (tip.y - prev.y) / length;
    const head = 8;
    const d = points.map((pt, j) => `${j ? 'L' : 'M'}${pt.x} ${pt.y}`).join(' ');
    const timing = output
      ? { ...combineTiming(o, 'input'), start: o.fly * 0.65 }
      : combineTiming(o, 'input');
    const extra = { transient: true, decor: true, enter: 'draw', timing };
    nodes.push(
      h.path(`cmb:${it.id}:${key}`, d, { fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, extra),
      h.path(`cmb:${it.id}:${key}:head`, `M${tip.x} ${tip.y} L${tip.x - ux * head - uy * head / 2} ${tip.y - uy * head + ux * head / 2} L${tip.x - ux * head + uy * head / 2} ${tip.y - uy * head - ux * head / 2} Z`, { fill: color }, { ...extra, track: d }),
    );
  };
  sources.forEach((src, j) => {
    const sc = center(src);
    // Earlier rows/columns route through the lane gutter, around nearer inputs.
    const blocked = sources.some((other, k) => k !== j && (vertical
      ? (other.y - sc.y) * (hc.y - other.y) > 0 && Math.abs(center(other).x - sc.x) < (src.w + other.w) / 2
      : (other.x - sc.x) * (hc.x - other.x) > 0 && Math.abs(center(other).y - sc.y) < (src.h + other.h) / 2));
    let points: { x: number; y: number }[];
    if (blocked && vertical) {
      const gutter = Math.max(...sources.map(r => r.x + r.w)) + 10;
      points = [{ x: src.x + src.w + 3, y: sc.y }, { x: gutter, y: sc.y }, { x: gutter, y: hc.y }, { x: hub.x + hub.w + 3, y: hc.y }];
    } else if (blocked) {
      const gutter = Math.max(...sources.map(r => r.y + r.h)) + 10;
      points = [{ x: sc.x, y: src.y + src.h + 3 }, { x: sc.x, y: gutter }, { x: hc.x, y: gutter }, { x: hc.x, y: hub.y + hub.h + 3 }];
    } else {
      points = [clipToRect(src, hc.x, hc.y, 3), clipToRect(hub, sc.x, sc.y, 3)];
    }
    addArrow(`in${j}`, points, rc.color(['accent', 'accent2', 'pink'][j] ?? 'accent', 'accent'));
  });
  addArrow('out', [clipToRect(hub, target.x, target.y, 3), clipToRect(dest, hc.x, hc.y, 4)], rc.color('good', 'good'), true);
  const extra = { transient: true, decor: true, enter: o.operator, timing: combineTiming(o, 'operator') };
  nodes.push(
    h.rect(`cmb:${it.id}:bubble`, hub.x, hub.y, hub.w, hub.h, { rx: 10, fill: rc.theme.surface, stroke: rc.color('warn', 'warn'), 'stroke-width': 2 }, extra),
    h.text(`cmb:${it.id}:label`, hc.x, midBaseline(hub.y, hub.h, fs), label, { 'font-size': fs, 'font-family': rc.theme.fontMono, 'font-weight': 700, 'text-anchor': 'middle', fill: rc.color('warn', 'warn') }, extra),
  );
  return nodes;
}

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
