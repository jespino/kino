import { captionFont, defineWidget, glowRect, h, midBaseline, type Props, type RenderCtx } from '../core/widget.ts';
import { rect } from '../core/geometry.ts';
import { list, num, str } from '../core/values.ts';

function layout(p: Props, rc: RenderCtx) {
  const s = p.size;
  const items = list(p.items).map((v) => str(v).toUpperCase());
  const ls = s * 0.12;
  const H = s * 2.5;
  const badge = p.numbers ? s * 1.25 : 0;
  const textW = Math.max(0, ...items.map((t) => rc.measure(t, s, false, 800, ls, captionFont(rc))));
  const W = textW + badge + (badge ? s * 0.55 : 0) + s * 2.6;
  const gap = s * 0.7;
  return { s, items, ls, H, W, gap, badge, pill: (i: number) => rect(i * (W + gap), 0, W, H) };
}

/** Chapter pills ("1 REGISTERS  2 THE STACK  3 THE CACHE"); the active one glows. */
export const tabs = defineWidget({
  type: 'tabs',
  description: 'Row of pill tabs. Props: items, active (0-based), numbers, size, color. Methods: select(i), next(), prev(). Anchors: t[i]',
  defaults: { items: [], active: 0, numbers: true, size: 18, color: 'accent' } as Props,
  methods: {
    select(p, [i]) {
      p.active = num(i);
    },
    next(p) {
      p.active = Math.min(p.active + 1, list(p.items).length - 1);
    },
    prev(p) {
      p.active = Math.max(p.active - 1, 0);
    },
  },
  render(p, rc) {
    const L = layout(p, rc);
    const accent = rc.color(p.color, 'accent');
    return L.items.flatMap((t, i) => {
      const r = L.pill(i);
      const on = i === p.active;
      const fg = on ? accent : rc.theme.muted;
      const x0 = r.x + (r.w - (L.badge + (L.badge ? L.s * 0.55 : 0) + rc.measure(t, L.s, false, 800, L.ls, captionFont(rc)))) / 2;
      const nodes = [
        glowRect(`glow${i}`, r.x, r.y, r.w, r.h, r.h / 2, accent, on ? 0.9 : 0),
        h.rect(`pill${i}`, r.x, r.y, r.w, r.h, { rx: r.h / 2, fill: on ? rc.theme.panel : rc.theme.surface2, stroke: on ? accent : rc.theme.border, 'stroke-width': on ? 2.5 : 1.5 }),
      ];
      if (L.badge)
        nodes.push(
          h.circle(`badge${i}`, x0 + L.badge / 2, r.y + r.h / 2, L.badge / 2, { fill: on ? accent : rc.theme.tabBadge ?? rc.theme.border }),
          h.text(`num${i}`, x0 + L.badge / 2, midBaseline(r.y, r.h, L.s * 0.75), String(i + 1), {
            'font-size': L.s * 0.75, 'font-family': captionFont(rc), 'font-weight': 800, 'text-anchor': 'middle', fill: on ? rc.theme.bg : rc.theme.muted,
          }),
        );
      nodes.push(
        h.text(`label${i}`, x0 + L.badge + (L.badge ? L.s * 0.55 : 0), midBaseline(r.y, r.h, L.s), t, {
          'font-size': L.s, 'font-family': captionFont(rc), 'font-weight': 800, 'letter-spacing': L.ls, fill: fg,
        }),
      );
      return nodes;
    });
  },
  anchor(p, path, rc) {
    if (typeof path[0] !== 'number') return undefined;
    return layout(p, rc).pill(path[0]);
  },
});
