// Text measurement without a DOM, from advance widths of the bundled fonts
// (Inter, JetBrains Mono, Kino Hand, Fantasque Sans Mono, Lato, Bangers, Comic Neue,
// Press Start 2P, VT323, Fredoka; see cli/gen-metrics.ts).
// Layout is therefore exact and identical in the browser and in the Node renderer.
import { CHARS, WIDTHS } from './metrics.ts';

const INDEX = new Map([...CHARS].map((c, i) => [c, i]));
const SANS = 'Inter', MONO = 'JetBrains Mono';

const WEIGHTS = new Map<string, number[]>();
for (const key of Object.keys(WIDTHS)) {
  const [family, w] = key.split('|');
  WEIGHTS.set(family, [...(WEIGHTS.get(family) ?? []), +w].sort((a, b) => a - b));
}

/** CSS font matching: the weight the browser (and resvg) picks among the available ones. */
function pickWeight(available: number[], want: number): number {
  const up = available.filter((w) => w >= want), down = available.filter((w) => w <= want).reverse();
  if (want > 500) return up[0] ?? down[0];
  if (want < 400) return down[0] ?? up[0];
  return available.find((w) => w >= want && w <= 500) ?? down[0] ?? up[0];
}

function table(family: string, weight: number): number[] | undefined {
  const ws = WEIGHTS.get(family);
  return ws && WIDTHS[`${family}|${pickWeight(ws, weight)}`];
}

/** first family of a CSS font-family list that has metrics */
export function metricsFamily(fontFamily: string | undefined, mono: boolean): string {
  for (const f of (fontFamily ?? '').split(',')) {
    const name = f.trim().replace(/^['"]|['"]$/g, '');
    if (WEIGHTS.has(name)) return name;
  }
  return mono ? MONO : SANS;
}

/**
 * Width of `text` in px. `fontFamily` (a CSS list, e.g. the theme's fontSans)
 * picks the metrics; without it Inter / JetBrains Mono are assumed.
 */
export function measure(text: string, size: number, mono = false, weight = 400, letterSpacing = 0, fontFamily?: string): number {
  const t = table(metricsFamily(fontFamily, mono), weight)!;
  const fallback = table(mono ? MONO : SANS, weight)!;
  let w = 0;
  let n = 0;
  for (const c of text) {
    const i = INDEX.get(c);
    // unknown glyphs (CJK, emoji...): monospace cell or a wide-ish default
    const em = i === undefined ? -1 : t[i] >= 0 ? t[i] : fallback[i];
    w += em >= 0 ? em : mono ? 0.6 : c.codePointAt(0)! > 0x2e80 ? 1 : 0.6;
    n++;
  }
  return w * size + n * letterSpacing;
}
