import { fmt } from './geometry.ts';
import type { Movie, Page } from './movie.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface SheetLayout {
  /** the pages, in order: every frame, step and `then` sub-step */
  pages: Page[];
  /** width of each picture on the sheet (px) */
  tileWidth: number;
  columns: number;
}

/** What goes on a contact sheet and how big: rasterize each page at `tileWidth`, then call contactSheetSvg(). */
export function sheetLayout(movie: Movie, opts: { tileWidth?: number; columns?: number } = {}): SheetLayout {
  const pages = movie.pages();
  return { pages, tileWidth: opts.tileWidth ?? 480, columns: Math.max(1, Math.min(opts.columns ?? 4, pages.length)) };
}

/**
 * A contact sheet: every page of the deck as a labeled tile ("3 grow line 70"),
 * so a person or an agent can review the whole deck in one picture. `tiles` are
 * image URLs (data: URIs) of the pages, in the order of `layout.pages`.
 */
export function contactSheetSvg(movie: Movie, layout: SheetLayout, tiles: string[]): { svg: string; width: number; height: number } {
  const { pages, tileWidth: tw, columns } = layout;
  const th = Math.round((tw * movie.video.height) / movie.video.width);
  const gap = 14, label = 26, margin = 16;
  const rows = Math.ceil(pages.length / columns);
  const width = margin * 2 + columns * tw + (columns - 1) * gap;
  const height = margin * 2 + rows * (label + th) + (rows - 1) * gap;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="#1f2023"/>`,
  ];
  pages.forEach((p, i) => {
    const x = margin + (i % columns) * (tw + gap), y = margin + Math.floor(i / columns) * (label + th + gap);
    const title = p.title.length > 40 ? p.title.slice(0, 39) + '…' : p.title;
    parts.push(
      `<text x="${x}" y="${y + 17}" font-family="Inter, sans-serif" font-size="14" fill="#e6e6e6"><tspan font-weight="700">${i + 1}</tspan><tspan dx="8">${esc(title)}</tspan>` +
        `<tspan dx="8" fill="#9a9ca3">line ${p.line}</tspan></text>`,
      `<image x="${x}" y="${y + label}" width="${tw}" height="${th}" preserveAspectRatio="none" href="${tiles[i] ?? ''}"/>`,
      `<rect x="${fmt(x - 0.5)}" y="${fmt(y + label - 0.5)}" width="${tw + 1}" height="${th + 1}" fill="none" stroke="#3a3c42"/>`,
    );
  });
  parts.push('</svg>');
  return { svg: parts.join(''), width, height };
}
