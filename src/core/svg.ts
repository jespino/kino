import { fmt } from './geometry.ts';
import type { Frame } from './render.ts';
import type { Theme } from './theme.ts';
import { sketchNode } from './sketch.ts';
import { comicNode } from './comic.ts';
import { pixelNode } from './pixel.ts';
import { paperNode } from './papercut.ts';
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
  const dots = +theme.halftone || 0;
  // drafting grid printed on the paper: it pans and zooms with the camera
  const grid = +theme.grid || 0, major = Math.max(1, Math.round(+theme.gridMajor || 1)), gridOp = +theme.gridOpacity || 0;
  // screen-fixed decorations keep their size when the camera zooms
  const px = v.w / width;
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
    // halftone (Ben-Day) dots, strongest towards the edges of the picture
    dots > 0
      ? `<pattern id="kdots" width="${fmt(16 * px)}" height="${fmt(16 * px)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">` +
        `<circle cx="${fmt(8 * px)}" cy="${fmt(8 * px)}" r="${fmt(3.2 * px)}" fill="${esc(theme.halftoneColor || theme.accent)}"/></pattern>` +
        `<radialGradient id="kdotsfade" cx="0.5" cy="0.5" r="0.72"><stop offset="0.35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity="1"/></radialGradient>` +
        `<mask id="kdotsmask"><rect ${bg} fill="url(#kdotsfade)"/></mask>`
      : '',
    // paper thickness: a tight contact shadow plus a soft one further out
    +theme.paperCut > 0
      ? `<filter id="kcut" x="-20%" y="-20%" width="140%" height="170%">` +
        `<feGaussianBlur in="SourceAlpha" stdDeviation="0.8" result="near"/><feOffset in="near" dx="0.4" dy="1.6" result="near"/>` +
        `<feComponentTransfer in="near" result="near"><feFuncA type="linear" slope="${fmt(+theme.paperCut * 1.4)}"/></feComponentTransfer>` +
        `<feGaussianBlur in="SourceAlpha" stdDeviation="5" result="far"/><feOffset in="far" dx="1.5" dy="6" result="far"/>` +
        `<feComponentTransfer in="far" result="far"><feFuncA type="linear" slope="${fmt(+theme.paperCut)}"/></feComponentTransfer>` +
        `<feMerge><feMergeNode in="far"/><feMergeNode in="near"/></feMerge></filter>`
      : '',
    +theme.board > 0
      ? `<linearGradient id="kboard" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.16"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.2"/></linearGradient>`
      : '',
    grid > 0 && gridOp > 0 ? gridPattern(grid, major, theme.gridColor || theme.fg, gridOp) : '',
    grain > 0
      ? `<pattern id="kgrain" width="${GRAIN_SIZE}" height="${GRAIN_SIZE}" patternUnits="userSpaceOnUse"><image width="${GRAIN_SIZE}" height="${GRAIN_SIZE}" href="${GRAIN_PNG}"/></pattern>`
      : '',
    ...(frame.clips ?? []).map((c, i) => `<clipPath id="kclip${i}"><path d="${c.d}" clip-rule="evenodd"/></clipPath>`),
    `</defs>`,
    `<rect ${bg} fill="${esc(background)}"/>`,
  ];
  if (glowA > 0) parts.push(`<rect ${bg} fill="url(#kbgA)"/>`);
  if (glowB > 0) parts.push(`<rect ${bg} fill="url(#kbgB)"/>`);
  if (dots > 0) parts.push(`<rect ${bg} fill="url(#kdots)" mask="url(#kdotsmask)" opacity="${dots}"/>`);
  if (grid > 0 && gridOp > 0) parts.push(`<rect ${bg} fill="url(#kgrid)"/>`);
  // slide-template chrome, fixed to the screen (it ignores the camera)
  const edge = (+theme.edgeWidth || 0) * v.w;
  if (edge > 0 && theme.edgeLeft) parts.push(`<rect x="${fmt(v.x - 1)}" y="${fmt(v.y - 1)}" width="${fmt(edge + 1)}" height="${fmt(v.h + 2)}" fill="url(#kedgeL)"/>`);
  if (edge > 0 && theme.edgeRight) parts.push(`<rect x="${fmt(v.x + v.w - edge)}" y="${fmt(v.y - 1)}" width="${fmt(edge + 1)}" height="${fmt(v.h + 2)}" fill="url(#kedgeR)"/>`);
  const clips = frame.clips ?? [];
  frame.nodes.forEach((node, i) => {
    // whole-picture transitions: each picture is drawn clipped to its part of the screen
    clips.forEach((c) => c.to === i && c.to > c.from && parts.push('</g>'));
    clips.forEach((c, k) => c.from === i && c.to > c.from && parts.push(`<g clip-path="url(#kclip${k})">`));
    if (Number(node.attrs.opacity ?? 1) <= 0.001) return;
    // hand-drawn themes redraw shapes as pencil strokes and watercolor washes, comic ones ink them,
    // pixel ones put them on a low-res grid, paper-cut ones lay them on the page as paper
    for (const n of sketchNode(node, theme).flatMap((s) => comicNode(s, theme)).flatMap((s) => pixelNode(s, theme)).flatMap((s) => paperNode(s, theme))) {
      let attrs = '';
      for (const [k, val] of Object.entries(n.attrs)) {
        attrs += ` ${k}="${typeof val === 'number' ? fmt(val) : esc(val)}"`;
      }
      parts.push(n.tag === 'text' ? `<text${attrs}>${esc(n.text ?? '')}</text>` : `<${n.tag}${attrs}/>`);
    }
  });
  clips.forEach((c) => c.to === frame.nodes.length && c.to > c.from && parts.push('</g>'));
  // comic panel: a paper gutter around an inked frame, cropping whatever reaches the edges
  const border = (+theme.frameBorder || 0) * px;
  if (border > 0) {
    const g = 14 * px, o = `M${fmt(v.x - 1)} ${fmt(v.y - 1)}h${fmt(v.w + 2)}v${fmt(v.h + 2)}h${fmt(-v.w - 2)}Z`;
    const i = `M${fmt(v.x + g)} ${fmt(v.y + g)}v${fmt(v.h - 2 * g)}h${fmt(v.w - 2 * g)}v${fmt(-v.h + 2 * g)}Z`;
    parts.push(
      `<path d="${o} ${i}" fill="${esc(background)}" fill-rule="evenodd"/>`,
      `<rect x="${fmt(v.x + g)}" y="${fmt(v.y + g)}" width="${fmt(v.w - 2 * g)}" height="${fmt(v.h - 2 * g)}" fill="none" stroke="${esc(theme.ink ?? theme.fg)}" stroke-width="${fmt(border)}"/>`,
    );
  }
  // whiteboard: the board's frame, lit from above, with a shadow cast on the board
  const board = (+theme.board || 0) * px;
  if (board > 0) {
    const o = `M${fmt(v.x - 1)} ${fmt(v.y - 1)}h${fmt(v.w + 2)}v${fmt(v.h + 2)}h${fmt(-v.w - 2)}Z`;
    const i = `M${fmt(v.x + board)} ${fmt(v.y + board)}v${fmt(v.h - 2 * board)}h${fmt(v.w - 2 * board)}v${fmt(-v.h + 2 * board)}Z`;
    const inner = `x="${fmt(v.x + board)}" y="${fmt(v.y + board)}" width="${fmt(v.w - 2 * board)}" height="${fmt(v.h - 2 * board)}" fill="none"`;
    parts.push(
      `<rect ${inner} stroke="#000" stroke-opacity="0.12" stroke-width="${fmt(board * 0.6)}" transform="translate(0 ${fmt(board * 0.12)})"/>`,
      `<path d="${o} ${i}" fill="${esc(theme.boardColor)}" fill-rule="evenodd"/>`,
      `<path d="${o} ${i}" fill="url(#kboard)" fill-rule="evenodd"/>`,
      `<rect ${inner} stroke="#000" stroke-opacity="0.35" stroke-width="${fmt(1.5 * px)}"/>`,
    );
  }
  // footer: dark on the page, light while a title backdrop covers it
  if (theme.footerLeft || theme.footerCenter || theme.footerRight) {
    const backdrop = Math.max(0, ...frame.nodes.filter((n) => n.attrs.fill === BACKDROP_GRADIENT).map((n) => Number(n.attrs.opacity ?? 1)));
    const s = v.h / 1080, y = v.y + v.h - 48 * s, size = 22 * s;
    const mx = v.w * 0.09;
    const font = esc(theme.fontSans);
    const row = (fill: string, opacity: number) => {
      if (opacity <= 0.001) return;
      const t = (x: number, anchor: string, text: string, weight: number) =>
        text ? `<text x="${fmt(x)}" y="${fmt(y)}" font-size="${fmt(weight > 600 ? size * 1.05 : size)}" font-family="${font}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}" opacity="${fmt(opacity)}">${esc(text)}</text>` : '';
      parts.push(
        t(v.x + mx, 'start', theme.footerLeft, 900),
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

/** A tile of `major`×`major` grid cells of `size` px: faint minor lines, a stronger one every `major` cells. */
function gridPattern(size: number, major: number, color: string, opacity: number): string {
  const tile = size * major;
  let minor = '';
  for (let i = 1; i < major; i++) minor += `M${fmt(i * size)} 0V${fmt(tile)}M0 ${fmt(i * size)}H${fmt(tile)}`;
  const c = esc(color);
  return (
    `<pattern id="kgrid" width="${fmt(tile)}" height="${fmt(tile)}" patternUnits="userSpaceOnUse">` +
    (minor ? `<path d="${minor}" fill="none" stroke="${c}" stroke-width="0.6" opacity="${fmt(opacity * 0.45)}"/>` : '') +
    `<path d="M0 0V${fmt(tile)}M0 0H${fmt(tile)}" fill="none" stroke="${c}" stroke-width="1.2" opacity="${fmt(opacity)}"/>` +
    `</pattern>`
  );
}
