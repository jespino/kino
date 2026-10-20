// Example custom widget: a circular gauge.
//   npm run render -- examples/custom-widget.kino --widgets examples/widgets/gauge.ts
//
// A widget is: default props + optional methods + a render function that returns
// keyed SVG primitives in local coordinates. The engine takes care of
// positioning, and of animating between states by matching keys.
import { defineWidget, h, values } from '../../src/index.ts';

export const gauge = defineWidget({
  type: 'gauge',
  description: 'Circular gauge. Props: value (0-100), label, r, color, size. Methods: add(n)',
  defaults: { value: 0, label: '', r: 70, color: 'accent', size: 30 },
  methods: {
    add(p, [n]) {
      p.value = Math.max(0, Math.min(100, p.value + values.num(n)));
    },
  },
  render(p, rc) {
    const c = p.r + 10;
    const len = 2 * Math.PI * p.r;
    const pct = Math.max(0, Math.min(100, values.num(p.value))) / 100;
    const color = p.value >= 80 ? rc.theme.bad : rc.color(p.color, 'accent');
    return [
      h.circle('track', c, c, p.r, { fill: 'none', stroke: rc.theme.surface, 'stroke-width': 14 }),
      // the arc is a dashed circle: tweening `stroke-dasharray` animates the fill
      h.circle('arc', c, c, p.r, {
        fill: 'none', stroke: color, 'stroke-width': 14, 'stroke-linecap': 'round',
        'stroke-dasharray': `${len * pct} ${len}`, transform: `rotate(-90 ${c} ${c})`,
      }),
      h.text('value', c, c + p.size * 0.35, `${Math.round(pct * 100)}%`, {
        'font-size': p.size, 'font-weight': 700, 'font-family': rc.theme.fontSans, 'text-anchor': 'middle', fill: rc.theme.fg,
      }),
      h.text('label', c, c * 2 + p.size * 0.9, values.str(p.label), {
        'font-size': p.size * 0.6, 'font-family': rc.theme.fontSans, 'text-anchor': 'middle', fill: rc.theme.muted,
      }),
    ];
  },
});
