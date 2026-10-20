import { defineWidget, h, type RenderCtx, type RNode } from '../core/widget.ts';
import { bool, num, str } from '../core/values.ts';
import { HALO_FILTER } from '../core/svg.ts';

/** One emoji glyph as artwork (Twemoji) or, without artwork, as text. */
function glyph(rc: RenderCtx, key: string, e: string, x: number, y: number, size: number, extra: Partial<RNode> = {}, attrs: Record<string, string | number> = {}): RNode {
  const uri = rc.emoji(e);
  if (uri) return h.image(key, x, y, size, size, uri, attrs, extra);
  return h.text(key, x + size / 2, y + size * 0.86, e, { 'font-size': size * 0.92, 'text-anchor': 'middle', ...attrs }, extra);
}

/**
 * Emoji: `e: emoji at (200, 200) { char: "🚀", size: 140 }`.
 * Change `char` (it pops), `count` (copies pop in/out), `rotate`, `flip`;
 * `burst()` throws copies out, `float()` sends one up like a reaction.
 * Like every widget it also has bounce(), shake(), pulse(), spin(), wiggle(), tada(), jump().
 */
export const emoji = defineWidget({
  type: 'emoji',
  description:
    'Emoji artwork. Props: char, size (96), count (repeat), gap, rotate (deg), flip, label, glow. ' +
    'Methods: set(char), burst(n?, char?), float(char?), add(n?), remove(n?). Also bounce/shake/pulse/spin/wiggle/tada/jump',
  defaults: { char: '😀', size: 96, count: 1, gap: 0.18, rotate: 0, flip: false, label: '', labelSize: 0, glow: false, enter: 'pop', exit: 'pop', bursts: [], floats: [] } as Record<string, any>,
  methods: {
    set(p, [c]) {
      p.char = str(c);
    },
    add(p, [n]) {
      p.count += n === undefined ? 1 : num(n);
    },
    remove(p, [n]) {
      p.count = Math.max(0, p.count - (n === undefined ? 1 : num(n)));
    },
    burst(p, [n, c]) {
      p.bursts = [...p.bursts, { n: n === undefined ? 10 : num(n), char: c === undefined ? null : str(c) }];
    },
    float(p, [c]) {
      p.floats = [...p.floats, { char: c === undefined ? null : str(c) }];
    },
  },
  render(p, rc) {
    const s = p.size;
    const n = Math.max(0, Math.round(p.count));
    const step = s * (1 + p.gap);
    const ch = str(p.char);
    const nodes: RNode[] = [];
    const sx = bool(p.flip) ? -1 : 1;
    for (let k = 0; k < n; k++) {
      const x = k * step;
      const cx = x + s / 2, cy = s / 2;
      // one transform skeleton so rotate/flip interpolate smoothly (flip animates through scaleX 0)
      const transform = `rotate(${p.rotate} ${cx} ${cy}) translate(${cx} ${cy}) scale(${sx} 1) translate(${-cx} ${-cy})`;
      if (bool(p.glow))
        nodes.push(h.circle(`glow${k}`, cx, cy, s * 0.42, { fill: rc.color(p.glow === true ? 'glow' : p.glow, 'glow'), opacity: 0.45, filter: HALO_FILTER }));
      nodes.push(glyph(rc, `e${k}:${ch}`, ch, x, 0, s, { delay: n > 1 ? Math.min(0.6, k * 0.08) : 0 }, { transform }));
    }
    const W = Math.max(s, n * step - s * p.gap);
    if (p.label) {
      const ls = p.labelSize || Math.max(16, s * 0.24);
      nodes.push(h.text('label', W / 2, s + ls * 1.4, str(p.label), { 'font-size': ls, 'font-family': rc.theme.fontSans, 'font-weight': 600, 'text-anchor': 'middle', fill: rc.theme.muted }, { enter: 'fade' }));
    }
    // particles: transient, only visible during the step that created them
    p.bursts.forEach((b: { n: number; char: string | null }, i: number) => {
      const c = b.char ?? ch;
      for (let k = 0; k < b.n; k++) {
        const a = (k / b.n) * Math.PI * 2 + i;
        const dist = s * (1.3 + ((k * 7) % 5) * 0.18);
        nodes.push(glyph(rc, `burst${i}:${k}`, c, W / 2 - s * 0.2, s / 2 - s * 0.2, s * 0.4, { transient: true, enter: 'burst', fly: [Math.cos(a) * dist, Math.sin(a) * dist - s * 0.4] }));
      }
    });
    p.floats.forEach((f: { char: string | null }, i: number) => {
      nodes.push(glyph(rc, `float${i}`, f.char ?? ch, W / 2 + s * 0.15, -s * 0.1, s * 0.45, { transient: true, enter: 'float', fly: [s * 0.25, -s * 1.4] }));
    });
    return nodes;
  },
});
