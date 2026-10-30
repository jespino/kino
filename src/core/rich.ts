import { h, type RenderCtx, type RNode } from './widget.ts';

/**
 * Inline styles inside text (labels, boxes, lists, callouts):
 * `**bold**`, `*italic*`, `` `code` `` and `{accent: colored}` (a theme color
 * or #hex). Text without them renders exactly as plain text.
 */
export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  color?: string;
}

const MARKUP = /\*\*(?=\S)(.+?)(?<=\S)\*\*|(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])|`([^`]+)`|\{(#[0-9a-fA-F]{3,8}|[a-zA-Z][\w-]*):\s?([^{}]+)\}/g;

/** The styled pieces of a text, or null when it has no markup. */
export function spans(text: string, rc: RenderCtx): Span[] | null {
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(MARKUP)) {
    // `{word: ...}` only counts for colors: theme tokens or #hex
    if (m[4] !== undefined && !m[4].startsWith('#') && rc.theme[m[4]] === undefined) continue;
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) out.push({ text: m[2], italic: true });
    else if (m[3] !== undefined) out.push({ text: m[3], code: true });
    else out.push({ text: m[5], color: m[4] });
    last = m.index! + m[0].length;
  }
  if (!out.length) return null;
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** Uppercase, keeping color names (`{accent: ...}`) as written. */
export const upper = (text: string) => text.split(/(\{[#\w-]+:)/).map((part, i) => (i % 2 ? part : part.toUpperCase())).join('');

/** The text as shown, without markup. */
export function plainText(text: string, rc: RenderCtx): string {
  return spans(text, rc)?.map((s) => s.text).join('') ?? text;
}

interface Font {
  size: number;
  mono?: boolean;
  weight?: number;
  spacing?: number;
  family?: string;
}

const codeFamily = (rc: RenderCtx) => rc.theme.fontCode || rc.theme.fontMono;

function spanWidth(rc: RenderCtx, s: Span, f: Font): number {
  if (s.code) return rc.measure(s.text, f.size * 0.9, true, 400, 0, codeFamily(rc)) + f.size * 0.5;
  return rc.measure(s.text, f.size, f.mono, s.bold ? Math.max(700, f.weight ?? 400) : f.weight, f.spacing, f.family);
}

/** Width of a line of (possibly styled) text. */
export function richMeasure(rc: RenderCtx, text: string, f: Font): number {
  const ss = spans(text, rc);
  if (!ss) return rc.measure(text, f.size, f.mono, f.weight, f.spacing, f.family);
  return ss.reduce((w, s) => w + spanWidth(rc, s, f), 0);
}

/**
 * A line of text at (x, y) (baseline; `text-anchor` in attrs). Plain text is
 * one node, as h.text() would make; styled text is one node per piece
 * (keys `key.0`, `key.1`, ...) laid out from measured widths.
 */
export function richText(rc: RenderCtx, key: string, x: number, y: number, text: string, attrs: Record<string, string | number | undefined>, f: Font, extra: Partial<RNode> = {}): RNode[] {
  const ss = spans(text, rc);
  if (!ss) return [h.text(key, x, y, text, attrs, extra)];
  const total = ss.reduce((w, s) => w + spanWidth(rc, s, f), 0);
  const anchor = attrs['text-anchor'];
  let cx = anchor === 'middle' ? x - total / 2 : anchor === 'end' ? x - total : x;
  const nodes: RNode[] = [];
  ss.forEach((s, i) => {
    const w = spanWidth(rc, s, f);
    // SVG drops leading and trailing spaces of a text element: skip over them instead
    const lead = s.text.length - s.text.trimStart().length;
    const body = s.text.trim();
    const at = cx + (lead && !s.code ? rc.measure(s.text.slice(0, lead), f.size, f.mono, f.weight, f.spacing, f.family) : 0);
    if (s.code) {
      nodes.push(h.rect(`${key}.${i}:bg`, cx + f.size * 0.08, y - f.size * 0.82, w - f.size * 0.16, f.size * 1.08, { rx: f.size * 0.18, fill: rc.theme.surface2 ?? rc.theme.surface, stroke: rc.theme.border, 'stroke-width': 1 }, extra));
      nodes.push(h.text(`${key}.${i}`, cx + f.size * 0.25, y - f.size * 0.03, body, { ...attrs, 'text-anchor': undefined, 'font-family': codeFamily(rc), 'font-size': f.size * 0.9, 'font-weight': 400, 'letter-spacing': undefined, fill: rc.theme.codeText ?? attrs.fill }, extra));
    } else if (body) {
      nodes.push(
        h.text(`${key}.${i}`, at, y, body, {
          ...attrs,
          'text-anchor': undefined,
          'font-weight': s.bold ? Math.max(700, Number(attrs['font-weight'] ?? 400)) : attrs['font-weight'],
          // the bundled fonts have no italics: slant the letters (the same in every renderer)
          transform: s.italic ? `translate(${+at.toFixed(2)} ${+y.toFixed(2)}) skewX(-12) translate(${-at.toFixed(2)} ${-y.toFixed(2)})` : undefined,
          fill: s.color ? rc.color(s.color, 'fg') : attrs.fill,
        }, extra),
      );
    }
    cx += w;
  });
  return nodes;
}
