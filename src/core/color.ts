// Minimal color parsing + interpolation for fills and strokes.

type RGBA = [number, number, number, number];

const NAMED: Record<string, RGBA> = {
  black: [0, 0, 0, 1], white: [255, 255, 255, 1], red: [255, 0, 0, 1], green: [0, 128, 0, 1],
  blue: [0, 0, 255, 1], yellow: [255, 255, 0, 1], orange: [255, 165, 0, 1], gray: [128, 128, 128, 1],
  grey: [128, 128, 128, 1], purple: [128, 0, 128, 1], transparent: [0, 0, 0, 0], none: [0, 0, 0, 0],
};

export function parseColor(s: string): RGBA | null {
  s = s.trim().toLowerCase();
  if (NAMED[s]) return [...NAMED[s]] as RGBA;
  let m = /^#([0-9a-f]{3,8})$/.exec(s);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(parseFloat);
    return [p[0], p[1], p[2], p[3] ?? 1];
  }
  return null;
}

export function lerpColor(a: string, b: string, t: number): string | null {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  // Fading from/to transparent keeps the hue of the visible side.
  if (ca[3] === 0) ca.splice(0, 3, cb[0], cb[1], cb[2]);
  if (cb[3] === 0) cb.splice(0, 3, ca[0], ca[1], ca[2]);
  const c = ca.map((v, i) => v + (cb[i] - v) * t);
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${+c[3].toFixed(3)})`;
}

export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  if (!c) return color;
  return `rgba(${c[0]},${c[1]},${c[2]},${+(c[3] * alpha).toFixed(3)})`;
}

/** Highlight fill: `color` at `alpha`, scaled by the theme's `tint` (paper themes want stronger pastels). */
export function fillTint(theme: Record<string, string>, color: string, alpha: number): string {
  return withAlpha(color, Math.min(1, alpha * (+theme.tint || 1)));
}
