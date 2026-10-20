import { defineWidget, glowRect, h, midBaseline, type Props, type RNode } from '../core/widget.ts';
import { rect } from '../core/geometry.ts';
import { list, num, str, type Value } from '../core/values.ts';
import { fillTint } from '../core/color.ts';

function geo(p: Props) {
  const off = p.labels ? p.cell * 0.6 : 0;
  return {
    off,
    cell: (r: number, c: number) => rect(off + c * (p.cell + p.gap), off + r * (p.cell + p.gap), p.cell, p.cell),
  };
}

const dims = (p: Props) => ({ rows: (p.values as Value[][]).length, cols: Math.max(0, ...(p.values as Value[][]).map((r) => r.length)) });

/** 2D grid of values: matrices, DP tables, game boards. `m[1][2] = 5` sets a cell. */
export const matrix = defineWidget({
  type: 'matrix',
  description:
    'Grid of values. Props: values ([[...],[...]]), rows/cols (empty grid), cell, labels (show indexes), size. ' +
    'Methods: set(r,c,v), fill(v), highlight(r,c,color), highlightRow(r,color), highlightCol(c,color), unhighlight(). Anchors: m[r][c], m[r]',
  defaults: { values: [], rows: 0, cols: 0, cell: 56, gap: 6, labels: false, size: 22, hl: {} } as Props,
  init(p) {
    let values = list(p.values).map((r) => list(r));
    if (!values.length && p.rows) values = Array.from({ length: p.rows }, () => Array.from({ length: p.cols || p.rows }, () => null));
    p.values = values;
  },
  assign(p, path, value, ctx) {
    if (path.length === 2 && typeof path[0] === 'number' && typeof path[1] === 'number') {
      const { rows, cols } = dims(p);
      if (path[0] >= rows || path[1] >= cols) ctx.error(`cell [${path[0]}][${path[1]}] is outside the ${rows}x${cols} matrix`);
      p.values[path[0]][path[1]] = value;
      return true;
    }
    if (path[0] === 'values') {
      p.values = list(value).map((r) => list(r));
      return true;
    }
    return false;
  },
  methods: {
    set(p, [r, c, v]) {
      p.values[num(r)][num(c)] = v ?? null;
    },
    fill(p, [v]) {
      p.values = (p.values as Value[][]).map((row) => row.map(() => v ?? null));
    },
    highlight(p, [r, c, color]) {
      p.hl[`${num(r)},${num(c)}`] = str(color ?? 'highlight');
    },
    highlightRow(p, [r, color]) {
      const { cols } = dims(p);
      for (let c = 0; c < cols; c++) p.hl[`${num(r)},${c}`] = str(color ?? 'highlight');
    },
    highlightCol(p, [c, color]) {
      const { rows } = dims(p);
      for (let r = 0; r < rows; r++) p.hl[`${r},${num(c)}`] = str(color ?? 'highlight');
    },
    unhighlight(p, [r, c]) {
      if (r === undefined) p.hl = {};
      else delete p.hl[`${num(r)},${num(c)}`];
    },
  },
  render(p, rc) {
    const { cell } = geo(p);
    const { rows, cols } = dims(p);
    const nodes: RNode[] = [];
    const ls = p.size * 0.6;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const b = cell(r, c);
        const hl = p.hl[`${r},${c}`] ? rc.color(p.hl[`${r},${c}`], 'highlight') : null;
        nodes.push(
          glowRect(`g:${r}:${c}`, b.x, b.y, b.w, b.h, 8, hl ?? rc.theme.glow, hl ? 0.9 : 0),
          h.rect(`c:${r}:${c}`, b.x, b.y, b.w, b.h, { rx: 8, fill: hl ? fillTint(rc.theme, hl, 0.18) : rc.theme.surface, stroke: hl ?? rc.theme.border, 'stroke-width': 1.5 }),
          h.text(`v:${r}:${c}`, b.x + b.w / 2, midBaseline(b.y, b.h, p.size), str(p.values[r][c]), {
            'font-size': p.size, 'font-family': rc.theme.fontMono, 'font-weight': 700, 'text-anchor': 'middle', fill: rc.theme.fg,
          }),
        );
      }
    }
    if (p.labels) {
      const lab = { 'font-size': ls, 'font-family': rc.theme.fontMono, 'text-anchor': 'middle', fill: rc.theme.muted };
      for (let c = 0; c < cols; c++) {
        const b = cell(0, c);
        nodes.push(h.text(`cl:${c}`, b.x + b.w / 2, b.y - ls * 0.6, String(c), lab));
      }
      for (let r = 0; r < rows; r++) {
        const b = cell(r, 0);
        nodes.push(h.text(`rl:${r}`, b.x - ls * 0.9, midBaseline(b.y, b.h, ls), String(r), lab));
      }
    }
    return nodes;
  },
  anchor(p, path) {
    const { cell } = geo(p);
    const { cols } = dims(p);
    if (path.length === 2) return cell(+path[0], +path[1]);
    if (path.length === 1 && typeof path[0] === 'number') {
      const a = cell(path[0], 0);
      return rect(a.x, a.y, a.w * cols + p.gap * (cols - 1), a.h);
    }
    return undefined;
  },
});
