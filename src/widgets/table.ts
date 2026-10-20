import { captionAttrs, captionFont, defineWidget, h, midBaseline, type Props, type RenderCtx, type RNode } from '../core/widget.ts';
import { rect } from '../core/geometry.ts';
import { withAlpha, fillTint } from '../core/color.ts';
import { isRef, list, str, type Value } from '../core/values.ts';
import { index, spread } from './util.ts';

interface Row {
  id: string;
  cells: Value[];
  hl?: string | null;
}

function layout(p: Props, rc: RenderCtx) {
  const s = p.size;
  const pad = s * 0.8;
  const cols = list(p.columns).map(str);
  const rows = p.rows as Row[];
  const colW = cols.map((c, i) => Math.max(rc.measure(c.toUpperCase(), s * 0.7, false, 800, s * 0.084, captionFont(rc)), ...rows.map((r) => rc.measure(str(r.cells[i]), s, p.mono))) + pad * 2);
  const xs = colW.map((_, i) => colW.slice(0, i).reduce((a, b) => a + b, 0));
  const rowH = s * 2.1;
  const W = colW.reduce((a, b) => a + b, 0);
  return { s, pad, cols, rows, colW, xs, rowH, W, H: rowH * (rows.length + 1) };
}

/** Table with header; rows keep identity so sorting/inserting animates rows moving. */
export const table = defineWidget({
  type: 'table',
  description:
    'Table. Props: columns, rows ([[...]]), size, mono. Methods: addRow(...), insertRow(i, ...), removeRow(i), setRow(i, [...]), ' +
    'set(r, c, v), highlightRow(i, color), unhighlight(i?), sortBy(col, "desc"?), clear(). Assign t[r][c] = v. Anchors: t[r], t[r][c]',
  defaults: { columns: [], rows: [], size: 20, mono: false } as Props,
  init(p, ctx) {
    p.rows = list(p.rows).map((r, i) => ({ id: `${ctx.name}#${i}`, cells: list(r) }));
  },
  assign(p, path, value, ctx) {
    const rows = p.rows as Row[];
    if (typeof path[0] === 'number') {
      const r = rows[index(ctx, path[0], rows.length)];
      if (path.length === 1) r.cells = list(value);
      else r.cells[columnIndex(p, path[1], ctx)] = value;
      return true;
    }
    if (path[0] === 'rows') {
      p.rows = list(value).map((r, i) => ({ id: rows[i]?.id ?? ctx.newId(), cells: list(r) }));
      return true;
    }
    return false;
  },
  methods: {
    addRow(p, args, ctx) {
      p.rows.push({ id: ctx.newId(), cells: spread(args) });
    },
    insertRow(p, [i, ...rest], ctx) {
      p.rows.splice(index(ctx, i, p.rows.length, true), 0, { id: ctx.newId(), cells: spread(rest) });
    },
    removeRow(p, [i], ctx) {
      p.rows.splice(index(ctx, i, p.rows.length), 1);
    },
    setRow(p, [i, ...rest], ctx) {
      p.rows[index(ctx, i, p.rows.length)].cells = spread(rest);
    },
    set(p, [r, c, v], ctx) {
      p.rows[index(ctx, r, p.rows.length)].cells[columnIndex(p, c!, ctx)] = v ?? null;
    },
    highlightRow(p, [i, color], ctx) {
      p.rows[index(ctx, i, p.rows.length)].hl = str(color ?? 'highlight');
    },
    unhighlight(p, [i], ctx) {
      if (i === undefined) for (const r of p.rows) r.hl = null;
      else p.rows[index(ctx, i, p.rows.length)].hl = null;
    },
    sortBy(p, [col, order], ctx) {
      const c = columnIndex(p, col!, ctx);
      const cmp = (a: Row, b: Row) => {
        const x = a.cells[c], y = b.cells[c];
        return typeof x === 'number' && typeof y === 'number' ? x - y : str(x).localeCompare(str(y));
      };
      (p.rows as Row[]).sort((a, b) => (order === 'desc' ? -cmp(a, b) : cmp(a, b)));
    },
    clear: (p) => void (p.rows = []),
  },
  render(p, rc) {
    const L = layout(p, rc);
    const nodes: RNode[] = [];
    nodes.push(h.rect('frame', 0, 0, L.W, L.H, { rx: 12, fill: rc.theme.panel, stroke: rc.theme.panelBorder, 'stroke-width': 1.5 }));
    nodes.push(h.rect('head', 1, 1, L.W - 2, L.rowH - 1, { rx: 11, fill: rc.theme.panelHeader }));
    L.cols.forEach((c, i) =>
      nodes.push(h.text(`h:${i}`, L.xs[i] + L.pad, midBaseline(0, L.rowH, L.s * 0.7), c.toUpperCase(), captionAttrs(rc, L.s * 0.7))),
    );
    L.rows.forEach((r, ri) => {
      const y = (ri + 1) * L.rowH;
      nodes.push(h.line(`sep:${r.id}`, 1, y, L.W - 1, y, { stroke: rc.theme.border, 'stroke-width': 1 }));
      nodes.push(h.rect(`rb:${r.id}`, 1, y + 1, L.W - 2, L.rowH - 2, { fill: r.hl ? fillTint(rc.theme, rc.color(r.hl, 'highlight'), 0.28) : withAlpha(rc.theme.surface, 0) }));
      L.cols.forEach((_, ci) =>
        nodes.push(
          h.text(`c:${r.id}:${ci}`, L.xs[ci] + L.pad, midBaseline(y, L.rowH, L.s), str(r.cells[ci]), {
            'font-size': L.s, 'font-family': p.mono ? rc.theme.fontMono : rc.theme.fontSans, fill: rc.theme.fg,
          }),
        ),
      );
    });
    return nodes;
  },
  anchor(p, path, rc) {
    if (typeof path[0] !== 'number') return undefined;
    const L = layout(p, rc);
    const y = (path[0] + 1) * L.rowH;
    if (path.length === 1) return rect(0, y, L.W, L.rowH);
    const c = typeof path[1] === 'number' ? path[1] : L.cols.indexOf(String(path[1]));
    return rect(L.xs[c], y, L.colW[c], L.rowH);
  },
});

function columnIndex(p: Props, c: Value | string | number, ctx: { error(m: string): never }): number {
  if (typeof c === 'number') return c;
  const name = isRef(c) ? String(c.$ref[0]) : str(c as Value);
  const i = list(p.columns).map(str).indexOf(name);
  if (i < 0) ctx.error(`unknown column '${name}'`);
  return i;
}
