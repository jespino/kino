import { fmt } from './geometry.ts';
import type { Frame } from './render.ts';
import type { Theme } from './theme.ts';
import { sketchNode } from './sketch.ts';
import { GRAIN_PNG, GRAIN_SIZE } from './grain.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** id of the blur filter widgets use for glows: `filter: GLOW_FILTER` */
export const GLOW_FILTER = 'url(#kglow)';
/** a wider, softer blur for halos behind big text */
export const HALO_FILTER = 'url(#kglowwide)';
/** fg → accent gradient fill for headlines */
export const TITLE_GRADIENT = 'url(#ktitle)';
/** full-bleed gradient behind title cards (themes with `titleBackdrop`), in canvas coordinates */
export const BACKDROP_GRADIENT = 'url(#kbackdrop)';
/** soft drop shadow under cards (themes with `panelShadow`) */
export const SHADOW_FILTER = 'url(#kshadow)';

/** "#a, #b 30%, #c" → gradient stops; colors without a position are spaced evenly */
const stops = (spec: string) => {
  const cs = spec.split(',').map((c) => c.trim()).filter(Boolean);
  return cs
    .map((c, i) => {
      const [color, at] = c.split(/\s+/);
      const offset = at?.endsWith('%') ? parseFloat(at) / 100 : cs.length > 1 ? i / (cs.length - 1) : 0;
      return `<stop offset="${+offset.toFixed(3)}" stop-color="${color}"/>`;
    })
    .join('');
};

/** Serialize a frame as a standalone SVG document. `extraDefs` is inserted verbatim (e.g. embedded fonts). */
export function frameToSVG(frame: Frame, width: number, height: number, background: string, theme: Theme, extraDefs = ''): string {
  const v = frame.view;
  const bg = `x="${fmt(v.x - 1)}" y="${fmt(v.y - 1)}" width="${fmt(v.w + 2)}" height="${fmt(v.h + 2)}"`;
  const glowA = +theme.bgGlowAOpacity, glowB = +theme.bgGlowBOpacity, vig = +theme.vignette, grain = +theme.paperGrain || 0;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${fmt(v.x)} ${fmt(v.y)} ${fmt(v.w)} ${fmt(v.h)}">`,
    `<defs>${extraDefs}`,
    `<radialGradient id="kbgA" cx="0.18" cy="0.12" r="0.75"><stop offset="0" stop-color="${theme.bgGlowA}" stop-opacity="${glowA}"/><stop offset="1" stop-color="${theme.bgGlowA}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="kbgB" cx="0.82" cy="0.9" r="0.6"><stop offset="0" stop-color="${theme.bgGlowB}" stop-opacity="${glowB}"/><stop offset="1" stop-color="${theme.bgGlowB}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="kvig" cx="0.5" cy="0.5" r="0.75"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${vig}"/></radialGradient>`,
    `<filter id="kglow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="7"/></filter>`,
    `<filter id="kglowwide" x="-30%" y="-60%" width="160%" height="220%"><feGaussianBlur stdDeviation="22"/></filter>`,
    `<linearGradient id="ktitle" x1="0" y1="0" x2="1" y2="1"><stop offset="0.25" stop-color="${theme.titleFrom ?? theme.fg}"/><stop offset="1" stop-color="${theme.titleTo ?? theme.accent}"/></linearGradient>`,
    // `brand` color token: a gradient across each shape (rings, bars, outlines)
    theme.brandGradient ? `<linearGradient id="kbrand" x1="0" y1="0" x2="1" y2="0.35">${stops(theme.brandGradient)}</linearGradient>` : '',
    theme.titleBackdrop
      ? `<linearGradient id="kbackdrop" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${width}" y2="${height}">${stops(theme.titleBackdrop)}</linearGradient>`
      : '',
    theme.edgeLeft ? `<linearGradient id="kedgeL" x1="0" y1="0" x2="0" y2="1">${stops(theme.edgeLeft)}</linearGradient>` : '',
    theme.edgeRight ? `<linearGradient id="kedgeR" x1="0" y1="0" x2="0" y2="1">${stops(theme.edgeRight)}</linearGradient>` : '',
    +theme.panelShadow > 0
      ? `<filter id="kshadow" x="-20%" y="-30%" width="140%" height="170%"><feGaussianBlur stdDeviation="14"/><feOffset dy="8"/>` +
        `<feComponentTransfer><feFuncA type="linear" slope="${theme.panelShadow}"/></feComponentTransfer></filter>`
      : '',
    grain > 0
      ? `<pattern id="kgrain" width="${GRAIN_SIZE}" height="${GRAIN_SIZE}" patternUnits="userSpaceOnUse"><image width="${GRAIN_SIZE}" height="${GRAIN_SIZE}" href="${GRAIN_PNG}"/></pattern>`
      : '',
    `</defs>`,
    `<rect ${bg} fill="${esc(background)}"/>`,
  ];
  if (glowA > 0) parts.push(`<rect ${bg} fill="url(#kbgA)"/>`);
  if (glowB > 0) parts.push(`<rect ${bg} fill="url(#kbgB)"/>`);
  // slide-template chrome, fixed to the screen (it ignores the camera)
  const edge = (+theme.edgeWidth || 0) * v.w;
  if (edge > 0 && theme.edgeLeft) parts.push(`<rect x="${fmt(v.x - 1)}" y="${fmt(v.y - 1)}" width="${fmt(edge + 1)}" height="${fmt(v.h + 2)}" fill="url(#kedgeL)"/>`);
  if (edge > 0 && theme.edgeRight) parts.push(`<rect x="${fmt(v.x + v.w - edge)}" y="${fmt(v.y - 1)}" width="${fmt(edge + 1)}" height="${fmt(v.h + 2)}" fill="url(#kedgeR)"/>`);
  for (const node of frame.nodes) {
    if (Number(node.attrs.opacity ?? 1) <= 0.001) continue;
    // hand-drawn themes redraw shapes as pencil strokes and watercolor washes
    for (const n of sketchNode(node, theme)) {
      let attrs = '';
      for (const [k, val] of Object.entries(n.attrs)) {
        attrs += ` ${k}="${typeof val === 'number' ? fmt(val) : esc(val)}"`;
      }
      parts.push(n.tag === 'text' ? `<text${attrs}>${esc(n.text ?? '')}</text>` : `<${n.tag}${attrs}/>`);
    }
  }
  // footer: dark on the page, light while a title backdrop covers it
  if (theme.footerLeft || theme.footerCenter || theme.footerRight) {
    const backdrop = Math.max(0, ...frame.nodes.filter((n) => n.attrs.fill === BACKDROP_GRADIENT).map((n) => Number(n.attrs.opacity ?? 1)));
    const s = v.h / 1080, y = v.y + v.h - 48 * s, size = 22 * s;
    const mx = v.x + v.w * 0.09;
    const font = esc(theme.fontSans);
    const row = (fill: string, opacity: number) => {
      if (opacity <= 0.001) return;
      const t = (x: number, anchor: string, text: string, weight: number) =>
        text ? `<text x="${fmt(x)}" y="${fmt(y)}" font-size="${fmt(weight > 600 ? size * 1.05 : size)}" font-family="${font}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}" opacity="${fmt(opacity)}">${esc(text)}</text>` : '';
      parts.push(
        t(mx, 'start', theme.footerLeft, 900),
        t(v.x + v.w / 2, 'middle', theme.footerCenter, 300),
        t(v.x + v.w - mx, 'end', theme.footerRight, 300),
      );
    };
    row(theme.footerColor || theme.muted, 1 - backdrop);
    row(theme.footerOnBackdrop || '#ffffff', backdrop);
  }
  // paper grain over everything, so it shows through the washes like real paper
  if (grain > 0) parts.push(`<rect ${bg} fill="url(#kgrain)" opacity="${grain}"/>`);
  if (vig > 0) parts.push(`<rect ${bg} fill="url(#kvig)"/>`);
  parts.push('</svg>');
  return parts.join('');
}
