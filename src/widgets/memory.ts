import { captionAttrs, defineWidget, glowRect, h, midBaseline, type Props, type RNode, type WidgetCtx } from '../core/widget.ts';
import { rect, union, type Rect } from '../core/geometry.ts';
import { fillTint } from '../core/color.ts';
import { isRef, list, num, str, type Value } from '../core/values.ts';

interface Region {
  from: number;
  len: number;
  color: string;
  label: string;
}

const hex2 = (b: number) => b.toString(16).toUpperCase().padStart(2, '0');

function geo(p: Props) {
  const cols = p.columns;
  const labelH = p.fontSize * 1.15; // room above each row for region labels
  const addrW = p.addresses ? p.fontSize * 0.62 * (2 + p.addrDigits) + p.fontSize : 0;
  const cell = (i: number): Rect => {
    const r = Math.floor(i / cols), c = i % cols;
    return rect(addrW + c * (p.cell + p.gap), (p.label ? p.fontSize * 1.5 : 0) + labelH + r * (p.cell + labelH), p.cell, p.cell * 0.82);
  };
  return { cols, labelH, addrW, cell, rows: Math.ceil(p.bytes.length / cols) };
}

/** Bytes of `value` encoded as `type` (u8..u64, i8..i64, f32, f64, str, bytes). */
function encode(value: Value, type: string, little: boolean, ctx: WidgetCtx): number[] {
  if (type === 'str' || type === 'ascii' || type === 'utf8') return [...new TextEncoder().encode(str(value))];
  if (type === 'bytes') return list(value).map((b) => num(b) & 0xff);
  const sizes: Record<string, number> = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, f32: 4, f64: 8 };
  const n = sizes[type];
  if (!n) ctx.error(`unknown type '${type}' (u8 u16 u32 u64 i8 i16 i32 i64 f32 f64 str bytes)`);
  const dv = new DataView(new ArrayBuffer(n));
  const v = num(value, `write(${type}) needs a number`);
  switch (type) {
    case 'u8': dv.setUint8(0, v); break;
    case 'i8': dv.setInt8(0, v); break;
    case 'u16': dv.setUint16(0, v, little); break;
    case 'i16': dv.setInt16(0, v, little); break;
    case 'u32': dv.setUint32(0, v >>> 0, little); break;
    case 'i32': dv.setInt32(0, v, little); break;
    case 'u64': dv.setBigUint64(0, BigInt(Math.trunc(v)), little); break;
    case 'i64': dv.setBigInt64(0, BigInt(Math.trunc(v)), little); break;
    case 'f32': dv.setFloat32(0, v, little); break;
    case 'f64': dv.setFloat64(0, v, little); break;
  }
  return [...new Uint8Array(dv.buffer)];
}

const regionName = (v: Value | undefined) => (isRef(v) ? v.text : str(v ?? null));

/**
 * Hex view of memory: an address column and byte cells, typed writes with
 * endianness, named regions (fields, padding, cache lines) and highlights.
 *   mem: memory at (100, 200) { size: 32, base: 0x1000, columns: 8 }
 *   mem.write(0, 3.14, f32)        mem.region(x, 0, 4, accent, "float x")
 */
export const memory = defineWidget({
  type: 'memory',
  description:
    'Hex dump. Props: size (bytes) or bytes ([...]), base (address of byte 0), columns (8), cell, fontSize, endian (little|big), ascii, addresses, label. ' +
    'Methods: write(offset, value, type?, endian?) (types u8 u16 u32 u64 i8..i64 f32 f64 str bytes), set(offset, byte), fill(byte, from?, len?), ' +
    'copy(src, dst, len), region(name, from, len, color?, label?), unregion(name), highlight(from, len?, color?), unhighlight(). Anchors: m[offset], m.<region>',
  defaults: { size: 16, bytes: null, base: 0, columns: 8, cell: 52, gap: 6, fontSize: 20, endian: 'little', ascii: false, addresses: true, label: '', regions: {}, hl: {}, recent: [], flash: 0 } as Props,
  init(p) {
    p.bytes = p.bytes === null ? new Array(num(p.size)).fill(0) : list(p.bytes).map((b) => (typeof b === 'string' ? parseInt(b, 16) : num(b)) & 0xff);
    const last = num(p.base) + p.bytes.length - 1;
    p.addrDigits = Math.max(4, last.toString(16).length);
    for (const [k, r] of Object.entries(p.regions as Record<string, any>)) p.regions[k] = { color: 'accent', label: k, ...r };
  },
  methods: {
    write(p, [offset, value, type, endian], ctx) {
      const at = num(offset);
      const bytes = encode(value ?? 0, type === undefined ? 'u8' : regionName(type), regionName(endian ?? p.endian) !== 'big', ctx);
      if (at < 0 || at + bytes.length > p.bytes.length) ctx.error(`write of ${bytes.length} bytes at ${at} is outside the ${p.bytes.length}-byte memory`);
      bytes.forEach((b, k) => (p.bytes[at + k] = b));
      p.recent = bytes.map((_, k) => at + k);
      p.flash++;
    },
    set(p, [offset, byte]) {
      p.bytes[num(offset)] = num(byte) & 0xff;
      p.recent = [num(offset)];
      p.flash++;
    },
    fill(p, [byte, from, len]) {
      const a = from === undefined ? 0 : num(from);
      const n = len === undefined ? p.bytes.length - a : num(len);
      for (let i = a; i < a + n; i++) p.bytes[i] = num(byte ?? 0) & 0xff;
      p.recent = [];
    },
    copy(p, [src, dst, len]) {
      const s = num(src), d = num(dst), n = num(len);
      const chunk = p.bytes.slice(s, s + n);
      chunk.forEach((b: number, k: number) => (p.bytes[d + k] = b));
      p.recent = chunk.map((_: number, k: number) => d + k);
      p.flash++;
    },
    region(p, [name, from, len, color, label]) {
      const n = regionName(name);
      p.regions[n] = { from: num(from), len: num(len), color: str(color ?? 'accent'), label: label === undefined ? n : str(label) };
    },
    unregion(p, [name]) {
      if (name === undefined) p.regions = {};
      else delete p.regions[regionName(name)];
    },
    highlight(p, [from, len, color]) {
      for (let i = num(from); i < num(from) + (len === undefined ? 1 : num(len)); i++) p.hl[i] = str(color ?? 'highlight');
    },
    unhighlight(p) {
      p.hl = {};
      p.recent = [];
    },
  },
  render(p, rc) {
    const G = geo(p);
    const s = p.fontSize;
    const nodes: RNode[] = [];
    if (p.label) nodes.push(h.text('label', 0, s * 0.8, str(p.label).toUpperCase(), captionAttrs(rc, s * 0.6)));
    // region tints behind the cells, one segment per row
    for (const [name, r] of Object.entries(p.regions as Record<string, Region>)) {
      const color = rc.color(r.color, 'accent');
      let seg = 0;
      for (let i = r.from; i < r.from + r.len; ) {
        const rowEnd = Math.min(r.from + r.len, (Math.floor(i / G.cols) + 1) * G.cols);
        const a = G.cell(i), b = G.cell(rowEnd - 1);
        nodes.push(h.rect(`rg:${name}:${seg}`, a.x - 3, a.y - 3, b.x + b.w - a.x + 6, a.h + 6, { rx: 9, fill: fillTint(rc.theme, color, 0.16), stroke: color, 'stroke-width': 1.5 }));
        if (seg === 0) nodes.push(h.text(`rl:${name}`, a.x, a.y - s * 0.4, r.label, { ...captionAttrs(rc, s * 0.55, r.color), 'font-family': rc.theme.fontMono }));
        seg++;
        i = rowEnd;
      }
    }
    for (let r = 0; r < G.rows && p.addresses; r++) {
      const c = G.cell(r * G.cols);
      const addr = '0x' + (num(p.base) + r * G.cols).toString(16).toUpperCase().padStart(p.addrDigits, '0');
      nodes.push(h.text(`a${r}`, 0, midBaseline(c.y, c.h, s * 0.8), addr, { 'font-size': s * 0.8, 'font-family': rc.theme.fontMono, fill: rc.theme.muted }));
    }
    const recent = new Set<number>(p.recent);
    (p.bytes as number[]).forEach((b, i) => {
      const c = G.cell(i);
      const hl = p.hl[i] ? rc.color(p.hl[i], 'highlight') : null;
      nodes.push(
        glowRect(`g${i}`, c.x, c.y, c.w, c.h, 7, hl ?? rc.theme.glow, hl ? 0.85 : 0),
        h.rect(`c${i}`, c.x, c.y, c.w, c.h, { rx: 7, fill: hl ? fillTint(rc.theme, hl, 0.16) : rc.theme.surface, stroke: hl ?? rc.theme.border, 'stroke-width': 1.5 }),
        h.text(`v${i}`, c.x + c.w / 2, midBaseline(c.y, c.h, s), hex2(b), {
          'font-size': s, 'font-family': rc.theme.fontMono, 'font-weight': b ? 700 : 400, 'text-anchor': 'middle', fill: b || hl ? rc.theme.fg : rc.theme.muted,
        }),
      );
      // bytes written in this step flash once
      if (recent.has(i)) nodes.push(h.rect(`fl${p.flash}:${i}`, c.x, c.y, c.w, c.h, { rx: 7, fill: rc.theme.accent, opacity: 0.55 }, { transient: true, enter: 'flash' }));
    });
    if (p.ascii) {
      for (let r = 0; r < G.rows; r++) {
        const last = G.cell(Math.min(p.bytes.length, (r + 1) * G.cols) - 1);
        const text = (p.bytes as number[]).slice(r * G.cols, (r + 1) * G.cols).map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('');
        nodes.push(h.text(`asc${r}`, G.addrW + G.cols * (p.cell + p.gap) + s, midBaseline(last.y, last.h, s * 0.9), text, { 'font-size': s * 0.9, 'font-family': rc.theme.fontMono, fill: rc.theme.muted, 'xml:space': 'preserve' }));
      }
    }
    return nodes;
  },
  anchor(p, path) {
    const G = geo(p);
    if (path.length !== 1) return undefined;
    if (typeof path[0] === 'number') return G.cell(path[0]);
    const r = p.regions[path[0]] as Region | undefined;
    if (!r) return undefined;
    const cells = [];
    for (let i = r.from; i < r.from + r.len; i++) cells.push(G.cell(i));
    return union(cells);
  },
});
