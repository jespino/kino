import { captionAttrs, captionFont, defineWidget, h, type RenderCtx, type RNode } from '../core/widget.ts';
import { bool, str } from '../core/values.ts';
import { BACKDROP_GRADIENT, HALO_FILTER, TITLE_GRADIENT } from '../core/svg.ts';

/**
 * Title card: eyebrow caption, big gradient headline with a soft halo, an accent
 * bar and a subtitle. The parts come in one after another.
 *   t: title at center() { eyebrow: "Go internals", text: "How slices work", subtitle: "..." }
 * Themes with `titleStyle: bar` draw it like a slide-template cover
 * instead: a vertical bar, a heavy headline, the eyebrow as a light second line
 * and the subtitle below, left-aligned, over the theme's `titleBackdrop`.
 */
export const title = defineWidget({
  type: 'title',
  description: 'Title card. Props: text (headline, "\\n" for lines), eyebrow, subtitle, size (84), align (center|start), color (accent), gradient (true), halo (true), backdrop (true: the theme\'s titleBackdrop, if any)',
  defaults: { text: '', eyebrow: '', subtitle: '', size: 84, align: 'center', color: 'accent', gradient: true, halo: true, backdrop: true, origin: 'center' },
  render(p, rc) {
    if (rc.theme.titleStyle === 'bar') return barTitle(p, rc);
    const s = p.size;
    const accent = rc.color(p.color, 'accent');
    const centered = p.align !== 'start';
    const anchor = centered ? 'middle' : 'start';
    const lines = str(p.text).split('\n');
    const ls = -s * 0.02; // tight headline tracking
    const widths = lines.map((l) => rc.measure(l, s, false, 800, ls));
    const eyebrow = str(p.eyebrow).toUpperCase();
    const capSize = Math.max(14, s * 0.21);
    const cap = captionAttrs(rc, capSize, p.color);
    const eyeW = eyebrow ? rc.measure(eyebrow, capSize, false, 800, +cap['letter-spacing']!, captionFont(rc)) : 0;
    const subSize = s * 0.32;
    const subW = rc.measure(str(p.subtitle), subSize);
    const W = Math.max(...widths, eyeW + (centered ? 140 : 0), subW);
    const x = centered ? W / 2 : 0;
    const nodes: RNode[] = [];
    let y = 0;

    if (eyebrow) {
      y += capSize;
      nodes.push(h.text('eyebrow', centered ? x : 0, y, eyebrow, { ...cap, 'text-anchor': anchor }, { enter: 'slide-up' }));
      if (centered) {
        // short rules on both sides of the eyebrow
        const half = eyeW / 2 + 18;
        nodes.push(
          h.line('eyeL', x - half - 52, y - capSize * 0.35, x - half, y - capSize * 0.35, { stroke: accent, 'stroke-width': 2, opacity: 0.7 }, { enter: 'draw', delay: 0.1 }),
          h.line('eyeR', x + half + 52, y - capSize * 0.35, x + half, y - capSize * 0.35, { stroke: accent, 'stroke-width': 2, opacity: 0.7 }, { enter: 'draw', delay: 0.1 }),
        );
      }
      y += s * 0.42;
    }

    lines.forEach((l, i) => {
      y += s * (i ? 1.05 : 0.92);
      const attrs = { 'font-size': s, 'font-family': rc.theme.fontSans, 'font-weight': 800, 'letter-spacing': ls, 'text-anchor': anchor };
      if (bool(p.halo))
        nodes.push(h.text(`halo${i}`, x, y, l, { ...attrs, fill: accent, opacity: 0.38, filter: HALO_FILTER }, { enter: 'fade', delay: 0.3 }));
      nodes.push(h.text(`h${i}`, x, y, l, { ...attrs, fill: bool(p.gradient) ? TITLE_GRADIENT : rc.theme.fg }, { enter: 'slide-up', delay: 0.12 + i * 0.08 }));
    });

    y += s * 0.42;
    const barW = Math.max(80, s * 1.3);
    const bx = centered ? x - barW / 2 : 0;
    nodes.push(
      h.path('barglow', `M${bx} ${y} L${bx + barW} ${y}`, { stroke: accent, 'stroke-width': 8, 'stroke-linecap': 'round', filter: HALO_FILTER, opacity: 0.8, fill: 'none' }, { enter: 'draw', delay: 0.35 }),
      h.path('bar', `M${bx} ${y} L${bx + barW} ${y}`, { stroke: accent, 'stroke-width': 5, 'stroke-linecap': 'round', fill: 'none' }, { enter: 'draw', delay: 0.35 }),
    );

    if (p.subtitle) {
      y += s * 0.3 + subSize;
      nodes.push(
        h.text('subtitle', x, y, str(p.subtitle), { 'font-size': subSize, 'font-family': rc.theme.fontSans, 'text-anchor': anchor, fill: rc.theme.muted }, { enter: 'slide-up', delay: 0.45 }),
      );
    }
    return nodes;
  },
});

/** Slide-template cover: | Heavy headline / Light second line / name line, left-aligned. */
function barTitle(p: Record<string, any>, rc: RenderCtx): RNode[] {
  const s = p.size;
  const backdrop = !!rc.theme.titleBackdrop && bool(p.backdrop ?? true);
  const fg = backdrop ? rc.theme.titleOnBackdrop || '#ffffff' : rc.theme.fg;
  const font = rc.theme.fontSans;
  const nodes: RNode[] = [];
  // the card spans most of the canvas, so `at center()` puts the text at the left margin
  const W = rc.video.width * 0.72;
  const tx = s * 0.85;
  const lines = str(p.text).split('\n');
  const second = str(p.eyebrow);
  let y = 0;
  lines.forEach((l, i) => {
    y += s * (i ? 1.08 : 0.95);
    nodes.push(h.text(`h${i}`, tx, y, l, { 'font-size': s, 'font-family': font, 'font-weight': 800, 'letter-spacing': -s * 0.01, fill: fg }, { enter: 'slide-up', delay: 0.1 + i * 0.08 }));
  });
  if (second) {
    y += s * 1.12;
    nodes.push(h.text('second', tx, y, second, { 'font-size': s, 'font-family': font, 'font-weight': 300, fill: fg }, { enter: 'slide-up', delay: 0.25 }));
  }
  if (p.subtitle) {
    const sub = s * 0.42;
    y += s * 0.45 + sub * 1.2;
    nodes.push(h.text('subtitle', tx, y, str(p.subtitle), { 'font-size': sub, 'font-family': font, fill: fg, opacity: backdrop ? 0.95 : 0.75 }, { enter: 'slide-up', delay: 0.4 }));
  }
  const H = y + s * 0.35;
  nodes.unshift(
    h.rect('space', 0, 0, W, H, { fill: 'none' }),
    h.path('bar', `M${s * 0.06} ${-s * 0.1} L${s * 0.06} ${H}`, { stroke: fg, 'stroke-width': Math.max(6, s * 0.09), 'stroke-linecap': 'round', fill: 'none', opacity: 0.92 }, { enter: 'draw' }),
  );
  if (backdrop)
    nodes.unshift(h.rect('backdrop', -6000, -6000, 12000, 12000, { fill: BACKDROP_GRADIENT }, { decor: true, enter: 'fade', exit: 'fade' }));
  return nodes;
}
