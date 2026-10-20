import { centeredText, defineWidget, h, midBaseline, type RNode } from '../core/widget.ts';
import { rect } from '../core/geometry.ts';
import { fillTint } from '../core/color.ts';
import { isRef, num, str, type Value } from '../core/values.ts';

function hub(p: Record<string, any>, measure: (t: string, s: number) => number) {
  const s = num(p.size);
  const H = num(p.height) || s * 3;
  const W = num(p.width) || Math.max(H * 1.6, measure(str(p.label), s) + s * 2.4);
  return { W, H };
}

/**
 * Many into one: `z: merge at (1180, 470) { label: "zstd", origin: center }`.
 * `z.from(a, b.part, ...)` draws a ribbon from each source into the hub;
 * `z.flow()` sends a pulse down every ribbon, one after another, and the hub
 * ripples as they arrive. Show the result in a following `then`, e.g.
 * `z.out -> result`. Anchors: `z.in`, `z.out`.
 */
export const merge = defineWidget({
  type: 'merge',
  description:
    'Aggregation of many things into one: a hub with ribbons converging from sources. Props: label, width, height, color, size, spread (0..1, how much of the hub side the ribbons land on). ' +
    'Methods: from(sources...) — ribbons from widgets/parts; flow() — pulses travel every ribbon into the hub. Anchors: z.in, z.out',
  defaults: { label: '', width: 0, height: 0, color: 'accent', size: 34, spread: 0.55, sources: [], flows: 0 } as Record<string, any>,
  methods: {
    from(p, args, ctx) {
      const sources = args.flatMap((a) => (Array.isArray(a) ? a : [a]));
      if (!sources.length) ctx.error('from needs at least one widget or part, e.g. z.from(cols.a, cols.b)');
      for (const s of sources) if (!isRef(s)) ctx.error(`from: '${str(s)}' is not a widget or a part`);
      p.sources = [...p.sources, ...sources];
    },
    flow(p, _args, ctx) {
      if (!p.sources.length) ctx.error('flow: nothing flows in yet; connect sources first with z.from(...)');
      p.flows += 1;
    },
  },
  render(p, rc) {
    const { W, H } = hub(p, (t, s) => rc.measure(t, s, false, 700));
    const color = rc.color(p.color, 'accent');
    const nodes: RNode[] = [
      h.rect('hub', 0, 0, W, H, { rx: H / 2, fill: fillTint(rc.theme, color, 0.14), stroke: color, 'stroke-width': 2.5 }),
    ];
    if (p.label) nodes.push(h.text('label', W / 2, midBaseline(0, H, p.size), str(p.label), centeredText(rc, p.size, false, color, 700)));
    if (p.flows > 0)
      // a ring that swells as the pulses arrive (only during the flow step)
      nodes.push(h.rect(`ripple${p.flows}`, 0, 0, W, H, { rx: H / 2, fill: 'none', stroke: color, 'stroke-width': 3 }, { transient: true, enter: 'swell', delay: 0.5 }));
    return nodes;
  },
  anchor(p, path, rc) {
    const { W, H } = hub(p, (t, s) => rc.measure(t, s, false, 700));
    if (path[0] === 'in') return rect(0, H / 2 - 1, 2, 2);
    if (path[0] === 'out') return rect(W - 2, H / 2 - 1, 2, 2);
    return undefined;
  },
  placed(p, rc, self) {
    const color = rc.color(p.color, 'accent');
    const b = self.bbox;
    const sources = p.sources as Value[];
    const n = sources.length;
    const nodes: RNode[] = [];
    // ribbons land spread over the hub's left side, in the sources' vertical order
    const order = sources.map((s, k) => ({ k, r: rc.anchor(s) })).sort((a, z) => a.r.y - z.r.y);
    order.forEach(({ k, r }, rank) => {
      const sx = r.x + r.w, sy = r.y + r.h / 2;
      // land on the pill's rounded left edge
      const R = b.h / 2, off = n > 1 ? (rank / (n - 1) - 0.5) * b.h * num(p.spread) : 0;
      const ex = b.x + R - Math.sqrt(Math.max(0, R * R - off * off)), ey = b.y + R + off;
      const dx = Math.max(40, (ex - sx) * 0.55);
      const d = `M${sx} ${sy} C${sx + dx} ${sy} ${ex - dx} ${ey} ${ex} ${ey}`;
      nodes.push(
        h.path(`ribbon${k}`, d, { fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round', opacity: 0.45 }, {
          enter: 'draw', delay: n > 1 ? (rank / (n - 1)) * 0.35 : 0, decor: true,
        }),
        h.circle(`dot${k}`, sx, sy, 5, { fill: color }, { enter: 'pop', decor: true }),
      );
      if (p.flows > 0)
        nodes.push(
          h.circle(`pulse${p.flows}:${k}`, ex, ey, 8, { fill: color }, {
            transient: true, enter: 'pour', track: d, delay: n > 1 ? (rank / (n - 1)) * 0.5 : 0, decor: true,
          }),
        );
    });
    return nodes;
  },
});
