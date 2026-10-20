import { GLOW_FILTER } from '../core/svg.ts';
import { h, type RNode } from '../core/widget.ts';

/** Soft blurred ring around a circle; animate `strength` 0..1. */
export function glowCircle(key: string, cx: number, cy: number, r: number, color: string, strength: number): RNode {
  return h.circle(key, cx, cy, r, { fill: 'none', stroke: color, 'stroke-width': 4, filter: GLOW_FILTER, opacity: strength });
}

/** Rounded rectangle as a path with a fixed command structure (so it interpolates, and can be a hole). */
export function roundRectPath(x: number, y: number, w: number, hh: number, r: number): string {
  r = Math.max(0, Math.min(r, w / 2, hh / 2));
  return (
    `M${x + r} ${y} L${x + w - r} ${y} Q${x + w} ${y} ${x + w} ${y + r} L${x + w} ${y + hh - r} ` +
    `Q${x + w} ${y + hh} ${x + w - r} ${y + hh} L${x + r} ${y + hh} Q${x} ${y + hh} ${x} ${y + hh - r} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} Z`
  );
}

/**
 * Curly brace along a span. (x0,y0)→(x1,y1) is the edge it hugs; `depth` points
 * away from it (positive = to the right of the direction of travel). Returns the
 * path and the tip point (where a label goes).
 */
export function bracePath(x0: number, y0: number, x1: number, y1: number, depth: number) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
  const nx = -uy, ny = ux; // normal
  const P = (u: number, v: number) => `${x0 + ux * u + nx * v} ${y0 + uy * u + ny * v}`;
  const d = depth, half = len / 2, q = Math.min(Math.abs(d), len / 4) * Math.sign(d || 1);
  const path =
    `M${P(0, 0)} Q${P(0, d / 2)} ${P(Math.abs(q), d / 2)} L${P(half - Math.abs(q), d / 2)} Q${P(half, d / 2)} ${P(half, d)} ` +
    `Q${P(half, d / 2)} ${P(half + Math.abs(q), d / 2)} L${P(len - Math.abs(q), d / 2)} Q${P(len, d / 2)} ${P(len, 0)}`;
  return { path, tip: { x: x0 + ux * half + nx * d, y: y0 + uy * half + ny * d }, normal: { x: nx * Math.sign(d || 1), y: ny * Math.sign(d || 1) } };
}
