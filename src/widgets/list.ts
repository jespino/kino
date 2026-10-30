import { defineWidget, h, type Props, type RNode } from '../core/widget.ts';
import { rect } from '../core/geometry.ts';
import { fillTint } from '../core/color.ts';
import { list, str, type Value } from '../core/values.ts';
import { index, indexes, spread } from './util.ts';
import { richMeasure, richText } from '../core/rich.ts';

interface Item {
  id: string;
  v: Value;
  hl?: string | null;
  done?: boolean;
}

/** Bullet / numbered / checklist. Items keep identity, so inserts push the rest down smoothly. */
export const listWidget = defineWidget({
  type: 'list',
  description:
    'Bullet list. Props: items, bullet (dot|number|check|none), size, gap, color. ' +
    'Methods: push, insert(i,v), remove(i), set(i,v), highlight(i, color), unhighlight(i?), check(i), uncheck(i), clear. Anchors: l[i]',
  defaults: { items: [], bullet: 'dot', size: 26, gap: 0.6, color: 'fg' } as Props,
  init(p, ctx) {
    p.items = list(p.items).map((v, i) => ({ id: `${ctx.name}#${i}`, v }));
  },
  assign(p, path, value, ctx) {
    if (typeof path[0] === 'number' && path.length === 1) {
      p.items[index(ctx, path[0], p.items.length)].v = value;
      return true;
    }
    if (path[0] === 'items') {
      p.items = list(value).map((v, i) => ({ ...(p.items[i] ?? { id: ctx.newId() }), v }));
      return true;
    }
    return false;
  },
  methods: {
    push: (p, args, ctx) => p.items.push(...spread(args).map((v) => ({ id: ctx.newId(), v }))),
    insert(p, [i, v], ctx) {
      p.items.splice(index(ctx, i, p.items.length, true), 0, { id: ctx.newId(), v: v ?? '' });
    },
    remove(p, [i], ctx) {
      p.items.splice(index(ctx, i, p.items.length), 1);
    },
    set(p, [i, v], ctx) {
      p.items[index(ctx, i, p.items.length)].v = v ?? '';
    },
    highlight(p, [i, color], ctx) {
      for (const k of indexes(ctx, i, p.items.length)) p.items[k].hl = str(color ?? 'highlight');
    },
    unhighlight(p, [i], ctx) {
      for (const k of indexes(ctx, i, p.items.length)) p.items[k].hl = null;
    },
    check(p, [i], ctx) {
      for (const k of indexes(ctx, i, p.items.length)) p.items[k].done = true;
    },
    uncheck(p, [i], ctx) {
      for (const k of indexes(ctx, i, p.items.length)) p.items[k].done = false;
    },
    clear: (p) => void (p.items = []),
  },
  render(p, rc) {
    const s = p.size;
    const lh = s * (1 + p.gap);
    const indent = p.bullet === 'none' ? 0 : p.bullet === 'number' ? s * 1.6 : s * 1.3;
    const nodes: RNode[] = [];
    (p.items as Item[]).forEach((it, i) => {
      const y = i * lh;
      const base = y + s * 0.85;
      const color = it.hl ? rc.color(it.hl, 'highlight') : rc.color(p.color, 'fg');
      const tw = richMeasure(rc, str(it.v), { size: s });
      nodes.push(
        h.rect(`bg:${it.id}`, indent - s * 0.3, y - s * 0.15, tw + s * 0.6, s * 1.3, { rx: 6, fill: fillTint(rc.theme, color, it.hl ? 0.14 : 0) }),
      );
      if (p.bullet === 'dot') nodes.push(h.circle(`b:${it.id}`, s * 0.35, y + s * 0.55, s * 0.16, { fill: rc.theme.accent }));
      if (p.bullet === 'number')
        nodes.push(h.text(`b:${it.id}`, 0, base, `${i + 1}.`, { 'font-size': s, 'font-family': rc.theme.fontSans, 'font-weight': 700, fill: rc.theme.accent }));
      if (p.bullet === 'check') {
        nodes.push(h.rect(`b:${it.id}`, 0, y + s * 0.12, s * 0.85, s * 0.85, { rx: 4, fill: it.done ? rc.theme.good : 'none', stroke: it.done ? rc.theme.good : rc.theme.border, 'stroke-width': 2 }));
        if (it.done)
          nodes.push(h.path(`tick:${it.id}`, `M${s * 0.18} ${y + s * 0.55} L${s * 0.36} ${y + s * 0.75} L${s * 0.68} ${y + s * 0.33}`, { stroke: rc.theme.bg, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }, { enter: 'draw' }));
      }
      nodes.push(
        ...richText(rc, `t:${it.id}`, indent, base, str(it.v), {
          'font-size': s, 'font-family': rc.theme.fontSans, fill: color, opacity: it.done ? 0.55 : 1,
        }, { size: s }, { enter: 'slide-left' }),
      );
    });
    return nodes;
  },
  anchor(p, path, rc) {
    if (typeof path[0] !== 'number') return undefined;
    const s = p.size;
    const it = p.items[path[0]];
    return rect(0, path[0] * s * (1 + p.gap), richMeasure(rc, str(it?.v), { size: s }) + s * 1.6, s * 1.2);
  },
});
