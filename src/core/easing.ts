export type Ease = (t: number) => number;

const backC = 1.70158;

export const easings: Record<string, Ease> = {
  linear: (t) => t,
  'ease-in': (t) => t * t * t,
  'ease-out': (t) => 1 - Math.pow(1 - t, 3),
  'ease-in-out': (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  ease: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  'back-out': (t) => 1 + (backC + 1) * Math.pow(t - 1, 3) + backC * Math.pow(t - 1, 2),
  'back-in-out': (t) => {
    const c2 = backC * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
  },
  spring: (t) => (t >= 1 ? 1 : 1 - Math.exp(-6 * t) * Math.cos(t * 9)),
  bounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
  step: (t) => (t < 1 ? 0 : 1),
  // quarter and half sine waves: keyframes at the peaks and zeros of a sine follow it exactly
  'sine-in': (t) => 1 - Math.cos((t * Math.PI) / 2),
  'sine-out': (t) => Math.sin((t * Math.PI) / 2),
  'sine-in-out': (t) => (1 - Math.cos(t * Math.PI)) / 2,
};

const BEZIER = /^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/;
const bezierCache = new Map<string, Ease>();

/**
 * An easing by name: one of `easings`, or `cubic-bezier(x1, y1, x2, y2)` like
 * CSS (and Lottie's keyframe tangents). Undefined for anything else.
 */
export function easing(name: string): Ease | undefined {
  if (Object.hasOwn(easings, name)) return easings[name];
  let e = bezierCache.get(name);
  if (e) return e;
  const m = BEZIER.exec(name.trim());
  if (!m) return undefined;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  if ([x1, y1, x2, y2].some((v) => !Number.isFinite(v)) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return undefined;
  e = cubicBezier(x1, y1, x2, y2);
  bezierCache.set(name, e);
  return e;
}

/** CSS cubic-bezier timing function: solve x(s) = t, return y(s). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s: number) => ((ax * s + bx) * s + cx) * s;
  const Y = (s: number) => ((ay * s + by) * s + cy) * s;
  const dX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = X(s) - t, d = dX(s);
      if (Math.abs(err) < 1e-7) return Y(s);
      if (Math.abs(d) < 1e-6) break;
      s -= err / d;
    }
    // Newton didn't settle: bisect
    let lo = 0, hi = 1;
    s = t;
    for (let i = 0; i < 40; i++) {
      const x = X(s);
      if (Math.abs(x - t) < 1e-7) break;
      if (x < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return Y(s);
  };
}
