import { defineWidget, glowRect, h, midBaseline, type RenderCtx } from '../core/widget.ts';
import { rect } from '../core/geometry.ts';
import { bool, str } from '../core/values.ts';
import { withAlpha } from '../core/color.ts';

const fontOf = (rc: RenderCtx, font: string) => (font === 'mono' ? rc.theme.fontMono : rc.theme.fontSans);

/** Free text. Multi-line with "\n" or backtick strings. */
export const label = defineWidget({
  type: 'label',
  description: 'Text. Props: text, size, color, weight, font (sans|mono), align (start|middle|end), caps (uppercase), spacing (letter spacing)',
  defaults: { text: '', size: 28, color: 'fg', weight: 400, font: 'sans', align: 'start', lineHeight: 1.3, caps: false, spacing: 0 },
  render(p, rc) {
    const text = bool(p.caps) ? str(p.text).toUpperCase() : str(p.text);
    const lines = text.split('\n');
    const mono = p.font === 'mono';
    const widths = lines.map((l) => rc.measure(l, p.size, mono, p.weight, p.spacing));
    const W = Math.max(0, ...widths);
    const anchor = p.align === 'middle' || p.align === 'center' ? 'middle' : p.align === 'end' ? 'end' : 'start';
    const x = anchor === 'middle' ? W / 2 : anchor === 'end' ? W : 0;
    return lines.map((l, i) =>
      h.text(`l${i}`, x, p.size * 0.8 + i * p.size * p.lineHeight, l, {
        'font-size': p.size,
        'font-family': fontOf(rc, p.font),
        'font-weight': p.weight,
        'letter-spacing': p.spacing || undefined,
        'text-anchor': anchor,
        fill: rc.color(p.color, 'fg'),
      }),
    );
  },
});

/** Rectangle with optional centered text. */
export const box = defineWidget({
  type: 'box',
  description: 'Rectangle with text. Props: text, width, height, fill, stroke, color, radius, size, font, dashed',
  defaults: { text: '', width: 0, height: 0, fill: 'surface', stroke: 'border', color: 'fg', radius: 12, size: 22, font: 'sans', padding: 18, strokeWidth: 2, dashed: false },
  render(p, rc) {
    const lines = str(p.text).split('\n');
    const mono = p.font === 'mono';
    const tw = Math.max(0, ...lines.map((l) => rc.measure(l, p.size, mono)));
    const lh = p.size * 1.3;
    const W = p.width || tw + p.padding * 2;
    const H = p.height || lines.length * lh + p.padding * 1.4;
    const nodes = [
      h.rect('bg', 0, 0, W, H, {
        rx: p.radius,
        fill: rc.color(p.fill, 'surface'),
        stroke: rc.color(p.stroke, 'border'),
        'stroke-width': p.strokeWidth,
        'stroke-dasharray': p.dashed ? '8 6' : undefined,
      }),
    ];
    const y0 = H / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) =>
      nodes.push(
        h.text(`t${i}`, W / 2, y0 + i * lh + p.size * 0.35, l, {
          'font-size': p.size,
          'font-family': fontOf(rc, p.font),
          'text-anchor': 'middle',
          fill: rc.color(p.color, 'fg'),
        }),
      ),
    );
    return nodes;
  },
});

/** Circle with optional centered text; handy for graph/tree nodes. */
export const circle = defineWidget({
  type: 'circle',
  description: 'Circle with text. Props: text, r, fill, stroke, color, size',
  defaults: { text: '', r: 32, fill: 'surface', stroke: 'border', color: 'fg', size: 22, font: 'sans', strokeWidth: 2 },
  render(p, rc) {
    return [
      h.circle('bg', p.r, p.r, p.r, { fill: rc.color(p.fill, 'surface'), stroke: rc.color(p.stroke, 'border'), 'stroke-width': p.strokeWidth }),
      h.text('t', p.r, p.r + p.size * 0.35, str(p.text), {
        'font-size': p.size,
        'font-family': fontOf(rc, p.font),
        'text-anchor': 'middle',
        fill: rc.color(p.color, 'fg'),
      }),
    ];
  },
});

/** UI button. `b.click()` flashes it, `b.pressed = true` keeps it down. */
export const button = defineWidget({
  type: 'button',
  description: 'UI button. Props: text, variant (primary|secondary|danger), pressed, disabled, size, width. Methods: click(), press(), release()',
  defaults: { text: 'Button', variant: 'primary', pressed: false, disabled: false, size: 22, width: 0, clicks: 0 },
  methods: {
    click(p) {
      p.clicks++;
    },
    press(p) {
      p.pressed = true;
    },
    release(p) {
      p.pressed = false;
    },
  },
  render(p, rc) {
    const W = p.width || rc.measure(str(p.text), p.size, false, 600) + p.size * 2.2;
    const H = p.size * 2.3;
    const base = p.variant === 'secondary' ? rc.theme.surface : rc.color(p.variant === 'danger' ? 'bad' : p.variant === 'primary' ? 'accent' : p.variant, 'accent');
    const fg = p.variant === 'secondary' ? rc.theme.fg : rc.theme.buttonText;
    const down = bool(p.pressed) ? 3 : 0;
    const op = bool(p.disabled) ? 0.45 : 1;
    const nodes = [
      glowRect('glow', 0, down, W, H, 10, base, p.variant === 'secondary' || bool(p.disabled) ? 0 : 0.55),
      h.rect('shadow', 0, 4, W, H, { rx: 10, fill: withAlpha('#000000', 0.35), opacity: op }),
      h.rect('face', 0, down, W, H, { rx: 10, fill: base, stroke: p.variant === 'secondary' ? rc.theme.border : base, 'stroke-width': 1.5, opacity: op }),
      h.text('t', W / 2, down + midBaseline(0, H, p.size), str(p.text), {
        'font-size': p.size, 'font-family': rc.theme.fontSans, 'font-weight': 600, 'text-anchor': 'middle', fill: fg, opacity: op,
      }),
    ];
    if (p.clicks > 0)
      nodes.push(h.rect(`flash${p.clicks}`, 0, down, W, H, { rx: 10, fill: '#ffffff', opacity: 0.45 }, { transient: true, enter: 'flash' }));
    return nodes;
  },
  anchor(p, path, rc) {
    if (path.length) return undefined;
    const W = p.width || rc.measure(str(p.text), p.size, false, 600) + p.size * 2.2;
    return rect(0, 0, W, p.size * 2.3);
  },
});
