import { defineWidget, glowRect, h, type RNode } from '../core/widget.ts';
import { bool, num, str } from '../core/values.ts';

const FIT: Record<string, string> = { contain: 'xMidYMid meet', cover: 'xMidYMid slice', fill: 'none' };

/**
 * A picture from a file or URL: `logo: image at (100, 100) { src: "images/logo.png", width: 400 }`.
 * Give `width`, `height` or both (the other side follows the image's aspect ratio);
 * with both, `fit` decides how it fills the box. `border` and `padding` frame it
 * like a photo. Assigning `src` crossfades to another picture.
 */
export const image = defineWidget({
  type: 'image',
  description:
    'Picture from a file (relative to the .kino file) or URL: PNG, JPEG, GIF, WebP, SVG. Props: src, width, height ' +
    '(one is enough), fit (contain|cover|fill), border (true or color), padding (mat around it), rotate (deg), label, glow',
  defaults: { src: '', width: 0, height: 0, fit: 'contain', border: false, padding: 0, rotate: 0, label: '', labelSize: 0, glow: false, enter: 'fade', exit: 'fade' } as Record<string, any>,
  methods: {
    set(p, [src]) {
      p.src = str(src);
    },
  },
  render(p, rc) {
    const src = str(p.src);
    const asset = src ? rc.image(src) : undefined;
    const ar = asset ? asset.width / asset.height : 16 / 10;
    let w = num(p.width), hgt = num(p.height);
    if (!w && !hgt) [w, hgt] = asset ? [asset.width, asset.height] : [320, 200];
    else if (!w) w = hgt * ar;
    else if (!hgt) hgt = w / ar;

    const pad = num(p.padding);
    const W = w + pad * 2, H = hgt + pad * 2;
    const cx = W / 2, cy = H / 2;
    const transform = `rotate(${num(p.rotate)} ${cx} ${cy})`;
    const nodes: RNode[] = [];
    const framed = bool(p.border) || pad > 0;
    if (bool(p.glow)) nodes.push(glowRect('glow', 0, 0, W, H, 6, rc.color(p.glow === true ? 'glow' : p.glow, 'glow'), 0.9));
    if (framed)
      nodes.push(
        h.rect('frame', 0, 0, W, H, {
          rx: 4, fill: pad > 0 ? rc.theme.surface : 'none',
          stroke: bool(p.border) ? rc.color(p.border === true ? 'border' : p.border, 'border') : 'none', 'stroke-width': 1.5, transform,
        }),
      );
    if (asset) {
      // the key includes the source, so a new picture crossfades with the old one
      nodes.push(h.image(`img:${src}`, pad, pad, w, hgt, asset.uri, { preserveAspectRatio: FIT[str(p.fit)] ?? FIT.contain, transform }));
    } else {
      // not loaded (yet), or missing: a placeholder that says what's expected
      nodes.push(
        h.rect('missing', pad, pad, w, hgt, { rx: 6, fill: rc.theme.surface2, stroke: rc.theme.muted, 'stroke-width': 1.5, 'stroke-dasharray': '6 6', transform }),
        h.text('missingText', cx, cy + 6, src ? `image: ${src}` : 'image (no src)', {
          'font-size': Math.max(12, Math.min(18, w / 18)), 'font-family': rc.theme.fontMono, 'text-anchor': 'middle', fill: rc.theme.muted, transform,
        }),
      );
    }
    if (p.label) {
      const ls = p.labelSize || Math.max(16, Math.min(26, W * 0.06));
      nodes.push(h.text('label', W / 2, H + ls * 1.5, str(p.label), { 'font-size': ls, 'font-family': rc.theme.fontSans, 'font-weight': 600, 'text-anchor': 'middle', fill: rc.theme.muted }, { enter: 'fade' }));
    }
    return nodes;
  },
});
