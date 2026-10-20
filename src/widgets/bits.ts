import { captionAttrs, defineWidget, glowRect, h, midBaseline, type Props, type RNode, type WidgetCtx } from '../core/widget.ts';
import { rect, union, type Rect } from '../core/geometry.ts';
import { fillTint } from '../core/color.ts';
import { isRef, num, str, type Value } from '../core/values.ts';

interface Bit {
  id: string;
  b: 0 | 1;
}
interface Group {
  hi: number;
  lo: number;
  color: string;
  label: string;
}

const word = (v: Value | undefined) => (isRef(v) ? v.text : str(v ?? null));

function toBig(v: Value, width: number): bigint {
  if (typeof v === 'string' && /^[01_\s]+$/.test(v)) return BigInt('0b' + (v.replace(/[_\s]/g, '') || '0'));
  if (typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v)) return BigInt(v);
  return BigInt.asUintN(width, BigInt(Math.trunc(num(v, 'bits value must be a number or a 0/1 string'))));
}

const value = (items: Bit[]) => items.reduce((acc, it) => (acc << 1n) | BigInt(it.b), 0n);

/** set every bit from `v`, keeping identities; remember which bits flipped */
function assign(p: Props, v: bigint) {
  const items = p.items as Bit[];
  const n = items.length;
  p.changed = [];
  p.flash++;
  items.forEach((it, k) => {
    const b = Number((v >> BigInt(n - 1 - k)) & 1n) as 0 | 1;
    if (b !== it.b) p.changed.push(it.id);
    it.b = b;
  });
}

function floatBits(f: number, width: number): bigint {
  const dv = new DataView(new ArrayBuffer(8));
  if (width === 64) {
    dv.setFloat64(0, f);
    return dv.getBigUint64(0);
  }
  dv.setFloat32(0, f);
  return BigInt(dv.getUint32(0));
}

function format(p: Props): string {
  const v = value(p.items);
  const w = (p.items as Bit[]).length;
  switch (p.format) {
    case 'hex': return '0x' + v.toString(16).toUpperCase().padStart(Math.ceil(w / 4), '0');
    case 'signed': return BigInt.asIntN(w, v).toString();
    case 'float': {
      const dv = new DataView(new ArrayBuffer(8));
      if (w === 64) {
        dv.setBigUint64(0, v);
        return String(+dv.getFloat64(0).toPrecision(15));
      }
      dv.setUint32(0, Number(v & 0xffffffffn));
      return String(+dv.getFloat32(0).toPrecision(8));
    }
    case 'none': return '';
    default: return v.toString();
  }
}

function geo(p: Props) {
  const w = (p.items as Bit[]).length;
  const top = (p.label ? p.fontSize * 1.5 : 0) + p.fontSize * 1.9; // room for group brackets
  const nibbleGap = p.nibbles ? p.cell * 0.25 : 0;
  // slot k (0 = most significant)
  const slot = (k: number): Rect => rect(k * (p.cell + p.gap) + Math.floor(k / 4) * nibbleGap, top, p.cell, p.cell * 1.15);
  const bit = (i: number) => slot(w - 1 - i); // bit index (0 = LSB) -> cell
  return { w, top, slot, bit };
}

/**
 * Bits of an integer (or float): shifts slide bits, logic ops flip them in place,
 * groups label fields (sign/exponent/mantissa, flags...).
 *   f: bits at (100, 300) { width: 32, format: float }    f.setFloat(3.14)
 */
export const bits = defineWidget({
  type: 'bits',
  description:
    'Bit field. Props: value (number, "0101" string), width (8), format (dec|hex|signed|float|none), cell, fontSize, nibbles, indices, groups, label. ' +
    'Methods: set(v), setFloat(f), shl(n), shr(n), sar(n), rol(n), ror(n), and(m), or(m), xor(m), not(), setBit(i), clearBit(i), flip(i), ' +
    'group(name, hi, lo, color?, label?), ungroup(name?), highlight(hi, lo?, color?), unhighlight(). Bit 0 is the LSB. Anchors: b[i], b.<group>',
  defaults: { value: 0, width: 8, format: 'dec', cell: 40, gap: 4, fontSize: 22, nibbles: true, indices: true, groups: {}, label: '', hl: {}, changed: [], flash: 0 } as Props,
  init(p, ctx) {
    const w = num(p.width);
    const v = toBig(p.value ?? 0, w);
    p.items = Array.from({ length: w }, (_, k) => ({ id: `${ctx.name}#${k}`, b: Number((v >> BigInt(w - 1 - k)) & 1n) }));
    for (const [k, g] of Object.entries(p.groups as Record<string, any>)) p.groups[k] = { color: 'accent', label: k, ...g };
    delete p.value;
  },
  assign(p, path, v) {
    if (path[0] === 'value') {
      assign(p, toBig(v, p.items.length));
      return true;
    }
    if (typeof path[0] === 'number' && path.length === 1) {
      const items = p.items as Bit[];
      const it = items[items.length - 1 - path[0]];
      p.changed = it.b !== (num(v) ? 1 : 0) ? [it.id] : [];
      p.flash++;
      it.b = num(v) ? 1 : 0;
      return true;
    }
    return false;
  },
  methods: {
    set(p, [v]) {
      assign(p, toBig(v ?? 0, p.items.length));
    },
    setFloat(p, [f]) {
      assign(p, floatBits(num(f), p.items.length));
    },
    shl(p, [n], ctx) {
      const k = n === undefined ? 1 : num(n);
      const items = p.items as Bit[];
      items.splice(0, k);
      const fresh = Array.from({ length: k }, () => ({ id: ctx.newId(), b: 0 as const }));
      items.push(...fresh);
      p.changed = fresh.map((b) => b.id);
      p.flash++;
    },
    shr(p, [n], ctx) {
      shiftRight(p, n === undefined ? 1 : num(n), ctx, false);
    },
    sar(p, [n], ctx) {
      shiftRight(p, n === undefined ? 1 : num(n), ctx, true);
    },
    rol(p, [n]) {
      const items = p.items as Bit[];
      items.push(...items.splice(0, n === undefined ? 1 : num(n)));
      p.changed = [];
    },
    ror(p, [n]) {
      const items = p.items as Bit[];
      items.unshift(...items.splice(items.length - (n === undefined ? 1 : num(n))));
      p.changed = [];
    },
    and(p, [m]) {
      assign(p, value(p.items) & toBig(m ?? 0, p.items.length));
    },
    or(p, [m]) {
      assign(p, value(p.items) | toBig(m ?? 0, p.items.length));
    },
    xor(p, [m]) {
      assign(p, value(p.items) ^ toBig(m ?? 0, p.items.length));
    },
    not(p) {
      assign(p, BigInt.asUintN(p.items.length, ~value(p.items)));
    },
    setBit(p, [i]) {
      assign(p, value(p.items) | (1n << BigInt(num(i))));
    },
    clearBit(p, [i]) {
      assign(p, value(p.items) & ~(1n << BigInt(num(i))));
    },
    flip(p, [i]) {
      assign(p, value(p.items) ^ (1n << BigInt(num(i))));
    },
    group(p, [name, hi, lo, color, label]) {
      const n = word(name);
      p.groups[n] = { hi: num(hi), lo: lo === undefined ? num(hi) : num(lo), color: word(color ?? 'accent'), label: label === undefined ? n : str(label) };
    },
    ungroup(p, [name]) {
      if (name === undefined) p.groups = {};
      else delete p.groups[word(name)];
    },
    highlight(p, [hi, lo, color]) {
      const a = num(hi), b = lo === undefined ? a : num(lo);
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) p.hl[i] = word(color ?? 'highlight');
    },
    unhighlight(p) {
      p.hl = {};
      p.changed = [];
    },
  },
  render(p, rc) {
    const G = geo(p);
    const s = p.fontSize;
    const items = p.items as Bit[];
    const changed = new Set<string>(p.changed);
    const nodes: RNode[] = [];
    if (p.label) nodes.push(h.text('label', 0, s * 0.8, str(p.label).toUpperCase(), captionAttrs(rc, s * 0.6)));
    // group colors per bit index
    const groupOf = new Map<number, string>();
    for (const g of Object.values(p.groups as Record<string, Group>)) for (let i = g.lo; i <= g.hi; i++) groupOf.set(i, rc.color(g.color, 'accent'));
    for (let k = 0; k < G.w; k++) {
      const c = G.slot(k);
      nodes.push(h.rect(`s${k}`, c.x, c.y, c.w, c.h, { rx: 6, fill: rc.theme.surface2, stroke: rc.theme.border, 'stroke-width': 1.5 }));
      if (p.indices)
        nodes.push(h.text(`i${k}`, c.x + c.w / 2, c.y + c.h + s * 0.8, String(G.w - 1 - k), { 'font-size': s * 0.5, 'font-family': rc.theme.fontMono, 'text-anchor': 'middle', fill: rc.theme.muted }));
    }
    items.forEach((it, k) => {
      const c = G.slot(k);
      const idx = G.w - 1 - k;
      const hl = p.hl[idx] ? rc.color(p.hl[idx], 'highlight') : null;
      const tint = hl ?? groupOf.get(idx) ?? rc.theme.accent;
      nodes.push(
        glowRect(`g:${it.id}`, c.x, c.y, c.w, c.h, 6, hl ?? rc.theme.glow, hl ? 0.85 : 0),
        h.rect(`b:${it.id}`, c.x, c.y, c.w, c.h, {
          rx: 6, fill: it.b ? fillTint(rc.theme, tint, 0.3) : rc.theme.surface, stroke: hl ?? groupOf.get(idx) ?? rc.theme.border, 'stroke-width': hl ? 2 : 1.5,
        }, { enter: 'pop' }),
        h.text(`t:${it.id}`, c.x + c.w / 2, midBaseline(c.y, c.h, s), String(it.b), {
          'font-size': s, 'font-family': rc.theme.fontMono, 'font-weight': it.b ? 700 : 400, 'text-anchor': 'middle', fill: it.b ? rc.theme.fg : rc.theme.muted,
        }, { enter: 'pop' }),
      );
      // bits that changed in this step flash once
      if (changed.has(it.id)) nodes.push(h.rect(`fl${p.flash}:${it.id}`, c.x, c.y, c.w, c.h, { rx: 6, fill: rc.theme.accent, opacity: 0.55 }, { transient: true, enter: 'flash' }));
    });
    // group brackets above
    for (const [name, g] of Object.entries(p.groups as Record<string, Group>)) {
      const a = G.bit(g.hi), b = G.bit(g.lo);
      const color = rc.color(g.color, 'accent');
      const y = a.y - s * 0.45;
      nodes.push(
        h.path(`gb:${name}`, `M${a.x + 2} ${y + 7} L${a.x + 2} ${y} L${b.x + b.w - 2} ${y} L${b.x + b.w - 2} ${y + 7}`, { stroke: color, 'stroke-width': 2, fill: 'none', 'stroke-linejoin': 'round' }),
        h.text(`gl:${name}`, (a.x + b.x + b.w) / 2, y - s * 0.35, g.label, { ...captionAttrs(rc, s * 0.55, g.color), 'text-anchor': 'middle' }),
      );
    }
    const text = format(p);
    if (text) {
      const last = G.slot(G.w - 1);
      nodes.push(h.text('val', last.x + last.w + s * 0.9, midBaseline(last.y, last.h, s * 1.1), `= ${text}`, { 'font-size': s * 1.1, 'font-family': rc.theme.fontMono, 'font-weight': 700, fill: rc.theme.accent }));
    }
    return nodes;
  },
  anchor(p, path) {
    const G = geo(p);
    if (path.length !== 1) return undefined;
    if (typeof path[0] === 'number') return G.bit(path[0]);
    const g = p.groups[path[0]] as Group | undefined;
    return g ? union([G.bit(g.hi), G.bit(g.lo)]) : undefined;
  },
});

function shiftRight(p: Props, k: number, ctx: WidgetCtx, arithmetic: boolean) {
  const items = p.items as Bit[];
  const sign = items[0]?.b ?? 0;
  items.splice(items.length - k, k);
  const fresh = Array.from({ length: k }, () => ({ id: ctx.newId(), b: (arithmetic ? sign : 0) as 0 | 1 }));
  items.unshift(...fresh);
  p.changed = fresh.map((b) => b.id);
  p.flash++;
}
