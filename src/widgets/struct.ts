import { captionAttrs, defineWidget, glowRect, h, midBaseline, type Props, type RenderCtx, type RNode } from '../core/widget.ts';
import { rect, type Rect } from '../core/geometry.ts';
import { fillTint } from '../core/color.ts';
import { isObj, list, str, type Value } from '../core/values.ts';

interface Field {
  name: string;
  v: Value;
  hl?: string | null;
}

const isZero = (v: Value) => v === null || v === '' || v === 0 || v === '0';

function layout(p: Props, rc: RenderCtx) {
  const fields = p.fields as Field[];
  const s = p.size;
  const pad = s * 0.55;
  const gap = p.gap ?? s * 0.32;
  const cellH = s * 1.9;
  const nameSize = s * 0.78;
  const titleH = p.title ? s * 1.5 : 0;
  const columns = Math.max(1, p.columns || (p.direction === 'horizontal' ? fields.length : 1));
  const spanOf = (f: Field) => Math.max(1, Math.min(columns, +(p.span?.[f.name] ?? 1)));
  const content = (f: Field) =>
    rc.measure(f.name, nameSize, true, 700) +
    (p.notes?.[f.name] ? rc.measure(str(p.notes[f.name]), s * 0.55, true) + s * 0.35 : 0) +
    s * 0.9 +
    rc.measure(str(f.v), s, true);
  const cellW = p.cellWidth || Math.max(s * 4.5, ...fields.filter((f) => spanOf(f) === 1).map((f) => content(f) + pad * 2));
  // row-major placement with wrapping for spanning cells
  const cells = new Map<string, Rect>();
  let row = 0, col = 0;
  for (const f of fields) {
    const span = spanOf(f);
    if (col + span > columns) {
      row++;
      col = 0;
    }
    cells.set(f.name, rect(col * (cellW + gap), titleH + row * (cellH + gap), span * cellW + (span - 1) * gap, cellH));
    col += span;
    if (col >= columns) {
      row++;
      col = 0;
    }
  }
  return { s, pad, nameSize, titleH, cells };
}

/**
 * Named fields as rounded cells: a slice header {ptr, len, cap}, a register file,
 * an object. `s.len = 3` updates a field.
 */
export const struct = defineWidget({
  type: 'struct',
  description:
    'Record with named fields. Props: title, fields ({name: value} or [names]), columns (grid), direction (vertical|horizontal), size, ' +
    'colors ({field: color} for names), notes ({field: "fp"}), span ({field: columns}), dimZero, cellWidth. ' +
    'Assign fields with `s.field = v`. Methods: highlight(field, color), unhighlight(field?), addField(name, v), removeField(name). Anchors: s.field',
  defaults: { title: '', fields: [], direction: 'vertical', columns: 0, size: 22, dimZero: true, cellWidth: 0, colors: {}, notes: {}, span: {}, gap: null } as Props,
  init(p) {
    p.fields = normalize(p.fields);
  },
  assign(p, path, value) {
    if (path[0] === 'fields') {
      p.fields = normalize(value);
      return true;
    }
    const f = (p.fields as Field[]).find((f) => f.name === path[0]);
    if (f && path.length === 1) {
      f.v = value;
      return true;
    }
    return false;
  },
  methods: {
    highlight(p, [name, color]) {
      for (const f of p.fields as Field[]) if (name === undefined || f.name === str(name)) f.hl = str(color ?? 'highlight');
    },
    unhighlight(p, [name]) {
      for (const f of p.fields as Field[]) if (name === undefined || f.name === str(name)) f.hl = null;
    },
    addField(p, [name, v]) {
      (p.fields as Field[]).push({ name: str(name), v: v ?? null });
    },
    removeField(p, [name]) {
      p.fields = (p.fields as Field[]).filter((f) => f.name !== str(name));
    },
  },
  render(p, rc) {
    const L = layout(p, rc);
    const s = L.s;
    const nodes: RNode[] = [];
    if (p.title) nodes.push(h.text('title', 0, s * 0.75, str(p.title).toUpperCase(), captionAttrs(rc, s * 0.6)));
    for (const f of p.fields as Field[]) {
      const c = L.cells.get(f.name)!;
      const hl = f.hl ? rc.color(f.hl, 'highlight') : null;
      const nameColor = rc.color(p.colors?.[f.name], 'accent');
      nodes.push(
        glowRect(`g:${f.name}`, c.x, c.y, c.w, c.h, 8, hl ?? rc.theme.glow, hl ? 0.9 : 0),
        h.rect(`b:${f.name}`, c.x, c.y, c.w, c.h, { rx: 8, fill: hl ? fillTint(rc.theme, hl, 0.16) : rc.theme.surface, stroke: hl ?? rc.theme.border, 'stroke-width': 1.5 }),
        h.text(`n:${f.name}`, c.x + L.pad, midBaseline(c.y, c.h, L.nameSize), f.name, {
          'font-size': L.nameSize, 'font-family': rc.theme.fontMono, 'font-weight': 700, fill: nameColor,
        }),
      );
      const note = p.notes?.[f.name];
      if (note)
        nodes.push(
          h.text(`note:${f.name}`, c.x + L.pad + rc.measure(f.name, L.nameSize, true, 700) + s * 0.35, midBaseline(c.y, c.h, L.nameSize), str(note), {
            'font-size': s * 0.55, 'font-family': rc.theme.fontMono, fill: rc.theme.muted,
          }),
        );
      const dim = p.dimZero && isZero(f.v) && !hl;
      nodes.push(
        h.text(`v:${f.name}`, c.x + c.w - L.pad, midBaseline(c.y, c.h, s), str(f.v), {
          'font-size': s, 'font-family': rc.theme.fontMono, 'font-weight': dim ? 400 : 700, 'text-anchor': 'end', fill: dim ? rc.theme.muted : rc.theme.fg,
        }),
      );
    }
    return nodes;
  },
  anchor(p, path, rc): Rect | undefined {
    if (path.length !== 1) return undefined;
    return layout(p, rc).cells.get(String(path[0]));
  },
});

function normalize(v: Value): Field[] {
  if (isObj(v)) return Object.entries(v).map(([name, val]) => ({ name, v: val }));
  return list(v).map((n) => ({ name: str(n), v: null }));
}

