import type { Rect } from './geometry.ts';
import type { Theme } from './theme.ts';
import type { Value } from './values.ts';
import type { ImageAsset } from './image.ts';
import { GLOW_FILTER } from './svg.ts';

/**
 * A rendered primitive. Widgets return a flat list of these in local
 * coordinates; the engine positions them, then animates between two frames by
 * matching nodes with the same `key` ("magic move"): attributes are tweened,
 * new keys play their enter effect, missing keys play their exit effect.
 */
export interface RNode {
  /** Unique within the widget. Keys starting with '@' are global, so a node can fly between widgets. */
  key: string;
  tag: 'rect' | 'text' | 'line' | 'path' | 'circle' | 'ellipse' | 'polygon' | 'image';
  attrs: Record<string, string | number>;
  /** text content for 'text' nodes */
  text?: string;
  /** enter/exit effect names: fade (default), pop, draw, slide-up, slide-down, slide-left, slide-right, none */
  enter?: string;
  exit?: string;
  /** when this node appears, animate it from the node with this (global) key in the previous frame */
  origin?: string;
  /** only visible during the transition that creates it (click ripples, flashes); uses its enter effect */
  transient?: boolean;
  /** stagger: when appearing, wait this fraction (0..1) of the transition before playing the enter effect */
  delay?: number;
  /** emphasis played while transitioning into a frame whose action id differs (bounce, shake, ...); set by the engine */
  action?: { name: string; id: string; cx: number; cy: number };
  /** decoration that doesn't count for layout (positions, anchors): full-bleed backdrops */
  decor?: boolean;
  /** `draw` effect on a non-path node (arrowheads): ride along this path (global coordinates), arriving at its end */
  track?: string;
  /** travel vector for the `burst` / `float` enter effects */
  fly?: [number, number];
}

export type Props = Record<string, any>;
export type Path = (string | number)[];

/** Context available while executing DSL statements. */
export interface WidgetCtx {
  /** this widget's name */
  name: string;
  /** fresh id, unique for the whole video; use it for keys of items that must keep identity */
  newId(): string;
  /** props of another widget (for things like `b.copyFrom(a)`) */
  props(name: string): Props;
  /** throw a DSL error attached to the current statement */
  error(msg: string): never;
}

/** Context available while rendering. */
export interface RenderCtx {
  name: string;
  theme: Theme;
  video: { width: number; height: number };
  /** resolve a theme token or CSS color */
  color(v: unknown, fallback: string): string;
  /** text width in px; `fontFamily` (default: the theme's sans or mono font) picks the metrics */
  measure(text: string, size: number, mono?: boolean, weight?: number, letterSpacing?: number, fontFamily?: string): number;
  /** global rect of a referenced widget/part (`data[0]`, `s.len`) or of a point */
  anchor(target: Value): Rect;
  /** data: URI with the artwork of an emoji, if the host provides one */
  emoji(emoji: string): string | undefined;
  /** a loaded image (data: URI + natural size) for a `src` as written in the script, if the host provides it */
  image(src: string): ImageAsset | undefined;
}

export interface WidgetDef<P extends Props = Props> {
  type: string;
  description?: string;
  /** overlay widgets (arrows, pointers, cursors) are drawn in global coordinates from references and ignore `at` */
  overlay?: boolean;
  defaults: P;
  /** normalize props after declaration (e.g. turn `values` into items with stable ids) */
  init?(props: P, ctx: WidgetCtx): void;
  /** handle `w.<path> = value`; return true if handled, otherwise the prop is set directly */
  assign?(props: P, path: Path, value: Value, ctx: WidgetCtx): boolean;
  methods?: Record<string, (props: P, args: Value[], ctx: WidgetCtx) => void>;
  /** produce primitives in local coordinates (overlay widgets: global coordinates) */
  render(props: P, rc: RenderCtx): RNode[];
  /** local rect of a sub-part, e.g. path [2] for `arr[2]`; return undefined if unknown */
  anchor?(props: P, path: Path, rc: RenderCtx): Rect | undefined;
  /**
   * Called once the widget is placed: extra nodes in global coordinates that don't
   * count for layout (e.g. particles flying in from other widgets). `self` is the
   * placed bounding box and `dx`/`dy` the offset from local to global coordinates.
   */
  placed?(props: P, rc: RenderCtx, self: { bbox: Rect; dx: number; dy: number }): RNode[];
}

export function defineWidget<P extends Props>(def: WidgetDef<P>): WidgetDef<P> {
  return def;
}

// ---- node builders, to keep widget code compact ----

type A = Record<string, string | number | undefined>;
const clean = (a: A) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) as Record<string, string | number>;

export const h = {
  rect: (key: string, x: number, y: number, w: number, hgt: number, attrs: A = {}, extra: Partial<RNode> = {}): RNode => ({
    key, tag: 'rect', attrs: clean({ x, y, width: Math.max(0, w), height: Math.max(0, hgt), ...attrs }), ...extra,
  }),
  text: (key: string, x: number, y: number, text: string, attrs: A = {}, extra: Partial<RNode> = {}): RNode => ({
    key, tag: 'text', attrs: clean({ x, y, ...attrs }), text, ...extra,
  }),
  line: (key: string, x1: number, y1: number, x2: number, y2: number, attrs: A = {}, extra: Partial<RNode> = {}): RNode => ({
    key, tag: 'line', attrs: clean({ x1, y1, x2, y2, ...attrs }), ...extra,
  }),
  path: (key: string, d: string, attrs: A = {}, extra: Partial<RNode> = {}): RNode => ({
    key, tag: 'path', attrs: clean({ d, ...attrs }), ...extra,
  }),
  image: (key: string, x: number, y: number, w: number, hgt: number, href: string, attrs: A = {}, extra: Partial<RNode> = {}): RNode => ({
    key, tag: 'image', attrs: clean({ x, y, width: w, height: hgt, href, ...attrs }), ...extra,
  }),
  circle: (key: string, cx: number, cy: number, r: number, attrs: A = {}, extra: Partial<RNode> = {}): RNode => ({
    key, tag: 'circle', attrs: clean({ cx, cy, r, ...attrs }), ...extra,
  }),
};

/** Text attributes for a centered label inside a box. */
export function centeredText(rc: RenderCtx, size: number, mono: boolean, color: string, weight = 400): A {
  return {
    'font-size': size,
    'font-family': mono ? rc.theme.fontMono : rc.theme.fontSans,
    'font-weight': weight,
    'text-anchor': 'middle',
    fill: color,
  };
}

/** Baseline y that vertically centers text of `size` in a box starting at y with height hgt. */
export const midBaseline = (y: number, hgt: number, size: number) => y + hgt / 2 + size * 0.35;

/** A soft blurred outline; animate `strength` 0..1 to fade the glow in and out. */
export function glowRect(key: string, x: number, y: number, w: number, hgt: number, rx: number, color: string, strength: number): RNode {
  return h.rect(key, x, y, w, hgt, { rx, fill: 'none', stroke: color, 'stroke-width': 4, filter: GLOW_FILTER, opacity: strength });
}

/** Font of captions, tabs and eyebrows: the theme's `fontCaption`, or its sans font. */
export const captionFont = (rc: RenderCtx) => rc.theme.fontCaption || rc.theme.fontSans;

/** Font of code blocks: the theme's `fontCode`, or its mono font. */
export const codeFont = (rc: RenderCtx) => rc.theme.fontCode || rc.theme.fontMono;

/** Uppercase, letter-spaced caption text (panel titles, labels of arrays...). */
export function captionAttrs(rc: RenderCtx, size: number, color?: unknown): A {
  return {
    'font-size': size,
    'font-family': captionFont(rc),
    'font-weight': 800,
    'letter-spacing': +(size * 0.12).toFixed(2),
    fill: rc.color(color, 'caption'),
  };
}
