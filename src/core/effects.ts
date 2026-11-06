import { KinoError, type Item, type Pos } from '../dsl/ast.ts';
import { parse } from '../dsl/parser.ts';
import { easing, type Ease } from './easing.ts';
import { evaluate, isCall, isRef, str } from './values.ts';

/**
 * Keyframed effects, after Lottie's transform tracks: each property (opacity,
 * position, scale, rotation) is its own track of keyframes, eased segment by
 * segment, and the whole effect runs over a progress of 0..1.
 *
 * - `effect` (enter/exit): progress is how visible the node is, 0 (gone) to 1
 *   (shown), so an exit plays the same keyframes backwards. 100% should be the
 *   node at rest.
 * - `action` (emphasis, `w.bounce()`): plays over the step that calls it and
 *   should start and end at rest.
 *
 * Scale and rotation pivot around the node's center (actions: the widget's),
 * like Lottie's anchor point.
 */

export const KEYFRAME_PROPS = ['opacity', 'x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate'] as const;
export type KeyframeProp = (typeof KEYFRAME_PROPS)[number];

const REST: Record<KeyframeProp, number> = { opacity: 1, x: 0, y: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0 };

export interface Keyframe {
  /** 0..1 */
  at: number;
  values: Partial<Record<KeyframeProp, number>>;
  /** easing of the segments leaving this keyframe (linear by default) */
  ease?: string;
}

interface Track {
  at: number[];
  v: number[];
  ease: Ease[];
}

export interface KeyframeEffect {
  name: string;
  kind: 'effect' | 'action';
  keys: Keyframe[];
  tracks: Partial<Record<KeyframeProp, Track>>;
  /** at 100% the node is untouched (lets finished enter effects skip the work) */
  restAtEnd: boolean;
  /** scales or rotates, so it needs a pivot */
  pivots: boolean;
}

/** Effects defined as keyframes, by kind; scripts add to and override the built-ins. */
export interface Effects {
  effects: Record<string, KeyframeEffect>;
  actions: Record<string, KeyframeEffect>;
}

/** Enter/exit effects that need more than a transform (paths, per-node data): drawn in code. */
export const CODE_EFFECTS = ['none', 'draw', 'grow', 'pour', 'burst', 'float'];
/** Methods every widget has, which an action can't take the name of. */
const RESERVED_ACTIONS = ['hide', 'show', 'moveTo'];

export function keyframeEffect(name: string, kind: 'effect' | 'action', keys: Keyframe[]): KeyframeEffect {
  const sorted = [...keys].sort((a, b) => a.at - b.at);
  const tracks: KeyframeEffect['tracks'] = {};
  for (const prop of KEYFRAME_PROPS) {
    const ks = sorted.filter((k) => k.values[prop] !== undefined);
    if (!ks.length) continue;
    tracks[prop] = { at: ks.map((k) => k.at), v: ks.map((k) => k.values[prop]!), ease: ks.map((k) => easing(k.ease ?? 'linear')!) };
  }
  const pivots = !!(tracks.scale || tracks.scaleX || tracks.scaleY || tracks.rotate);
  const fx: KeyframeEffect = { name, kind, keys: sorted, tracks, restAtEnd: false, pivots };
  const end = sample(fx, 1);
  fx.restAtEnd = KEYFRAME_PROPS.every((p) => (p === 'rotate' ? end.rotate % 360 === 0 : end[p] === REST[p]));
  return fx;
}

function trackAt(t: Track, q: number): number {
  const n = t.at.length;
  if (q <= t.at[0]) return t.v[0];
  if (q >= t.at[n - 1]) return t.v[n - 1];
  let i = 0;
  while (t.at[i + 1] < q) i++;
  const f = (q - t.at[i]) / (t.at[i + 1] - t.at[i]);
  return t.v[i] + (t.v[i + 1] - t.v[i]) * t.ease[i](f);
}

/** Every property's value at progress q. */
export function sample(fx: KeyframeEffect, q: number): Record<KeyframeProp, number> {
  const out = { ...REST };
  for (const p of KEYFRAME_PROPS) {
    const t = fx.tracks[p];
    if (t) out[p] = trackAt(t, q);
  }
  return out;
}

/**
 * The effect at progress q, as an opacity factor and a transform to put in
 * front of the node's own, pivoting scale and rotation around (cx, cy).
 */
export function applyKeyframes(fx: KeyframeEffect, q: number, cx: number, cy: number): { opacity: number; transform: string } {
  const v = sample(fx, q);
  const sx = v.scale * v.scaleX, sy = v.scale * v.scaleY;
  const parts: string[] = [];
  if (v.x !== 0 || v.y !== 0) parts.push(`translate(${v.x} ${v.y})`);
  if (v.rotate % 360 !== 0 || sx !== 1 || sy !== 1) {
    parts.push(`translate(${cx} ${cy})`);
    if (v.rotate % 360 !== 0) parts.push(`rotate(${v.rotate})`);
    if (sx !== 1 || sy !== 1) parts.push(sx === sy ? `scale(${sx})` : `scale(${sx} ${sy})`);
    parts.push(`translate(${-cx} ${-cy})`);
  }
  return { opacity: v.opacity, transform: parts.join(' ') };
}

/** A keyframe effect or action by name (own names only: `toString` is not an effect). */
export function lookup(table: Record<string, KeyframeEffect>, name: string): KeyframeEffect | undefined {
  return Object.hasOwn(table, name) ? table[name] : undefined;
}

type EffectItem = Extract<Item, { t: 'effect' }>;

/** Turn `effect` / `action` blocks into keyframe effects, checking them. */
export function defineEffects(items: EffectItem[], base: Effects = BUILTIN_EFFECTS): Effects {
  const out: Effects = { effects: { ...base.effects }, actions: { ...base.actions } };
  for (const it of items) {
    const fail = (msg: string, pos: Pos = it.pos): never => {
      throw new KinoError(msg, pos);
    };
    if (it.kind === 'effect' && CODE_EFFECTS.includes(it.name)) fail(`'${it.name}' is a built-in effect drawn in code and can't be redefined`);
    if (it.kind === 'action' && RESERVED_ACTIONS.includes(it.name)) fail(`'${it.name}' is a widget method and can't be an action name`);
    if (!it.keys.length) fail(`${it.kind} '${it.name}' needs keyframes, like 0% { opacity: 0 } 100% { opacity: 1 }`);
    const seen = new Set<number>();
    const keys: Keyframe[] = it.keys.map((k) => {
      if (k.at < 0 || k.at > 1) fail(`keyframes go from 0% to 100%, got ${+(k.at * 100).toFixed(3)}%`, k.pos);
      if (seen.has(k.at)) fail(`keyframe ${+(k.at * 100).toFixed(3)}% is defined twice`, k.pos);
      seen.add(k.at);
      const kf: Keyframe = { at: k.at, values: {} };
      for (const [name, e] of k.props) {
        const v = evaluate(e);
        if (name === 'ease' || name === 'easing') {
          const word = typeof v === 'string' || isRef(v) || isCall(v) ? str(v) : '';
          if (!easing(word)) fail(`unknown easing '${str(v)}' (a named easing or cubic-bezier(x1, y1, x2, y2))`, e.pos);
          kf.ease = word;
        } else if ((KEYFRAME_PROPS as readonly string[]).includes(name)) {
          if (typeof v !== 'number') fail(`'${name}' must be a number, got ${str(v)}`, e.pos);
          kf.values[name as KeyframeProp] = v as number;
        } else fail(`unknown keyframe property '${name}' (${KEYFRAME_PROPS.join(', ')}, ease)`, e.pos);
      }
      return kf;
    });
    (it.kind === 'effect' ? out.effects : out.actions)[it.name] = keyframeEffect(it.name, it.kind, keys);
  }
  return out;
}

/**
 * The built-in keyframe effects, in the same syntax scripts use. The sine
 * easings make keyframes at a wave's peaks and zeros follow it exactly; the
 * damped wobbles step their peaks down linearly.
 */
export const BUILTIN_SOURCE = `
effect fade { 0% { opacity: 0 } 100% { opacity: 1 } }
effect pop {
  0%      { opacity: 0, scale: 0.3, ease: cubic-bezier(0.333, 0.419, 0.667, 0.801) }
  66.667% { opacity: 1, scale: 0.8706, ease: cubic-bezier(0.333, 0.439, 0.667, 0.723) }
  100%    { scale: 1 }
}
effect slide-up    { 0% { opacity: 0, y: 26 }  100% { opacity: 1, y: 0 } }
effect slide-down  { 0% { opacity: 0, y: -26 } 100% { opacity: 1, y: 0 } }
effect slide-left  { 0% { opacity: 0, x: 26 }  100% { opacity: 1, x: 0 } }
effect slide-right { 0% { opacity: 0, x: -26 } 100% { opacity: 1, x: 0 } }
effect ripple { 0% { opacity: 1, scale: 0.2 } 100% { opacity: 0, scale: 1.5 } }
effect swell  { 0% { opacity: 1, scale: 1 }   100% { opacity: 0, scale: 1.35 } }
effect flash  { 0% { opacity: 0, ease: sine-out } 50% { opacity: 1, ease: sine-in } 100% { opacity: 0 } }

action pulse { 0% { scale: 1, ease: sine-out } 50% { scale: 1.25, ease: sine-in } 100% { scale: 1 } }
action jump  { 0% { y: 0, ease: sine-out } 50% { y: -70, ease: sine-in } 100% { y: 0 } }
action spin  { 0% { rotate: 0 } 100% { rotate: 360 } }
action bounce {
  0%  { y: 0, ease: sine-out }   25% { y: -35, ease: sine-in }
  50% { y: 0, ease: sine-out }   75% { y: -25, ease: sine-in }
  100% { y: 0 }
}
action shake {
  0%      { x: 0, ease: sine-out }
  6.25%   { x: 15, ease: sine-in-out }   18.75% { x: -13, ease: sine-in-out }
  31.25%  { x: 11, ease: sine-in-out }   43.75% { x: -9, ease: sine-in-out }
  56.25%  { x: 7, ease: sine-in-out }    68.75% { x: -5, ease: sine-in-out }
  81.25%  { x: 3, ease: sine-in-out }    93.75% { x: -1, ease: sine-in }
  100%    { x: 0 }
}
action wiggle {
  0%      { rotate: 0, ease: sine-out }
  8.333%  { rotate: 12.833, ease: sine-in-out }  25%     { rotate: -10.5, ease: sine-in-out }
  41.667% { rotate: 8.167, ease: sine-in-out }   58.333% { rotate: -5.833, ease: sine-in-out }
  75%     { rotate: 3.5, ease: sine-in-out }     91.667% { rotate: -1.167, ease: sine-in }
  100%    { rotate: 0 }
}
action tada {
  0%     { scale: 1, rotate: 0, ease: sine-out }
  6.25%  { scale: 1.0351, rotate: 1.561, ease: sine-in-out }   18.75% { scale: 1.1, rotate: -4.445, ease: sine-in-out }
  31.25% { scale: 1.1497, rotate: 6.652, ease: sine-in-out }   43.75% { scale: 1.1765, rotate: -7.846, ease: sine-in-out }
  56.25% { scale: 1.1765, rotate: 7.846, ease: sine-in-out }   68.75% { scale: 1.1497, rotate: -6.652, ease: sine-in-out }
  81.25% { scale: 1.1, rotate: 4.445, ease: sine-in-out }      93.75% { scale: 1.0351, rotate: -1.561, ease: sine-in }
  100%   { scale: 1, rotate: 0 }
}
`;

export const BUILTIN_EFFECTS: Effects = defineEffects(
  parse(BUILTIN_SOURCE).items.filter((i): i is EffectItem => i.t === 'effect'),
  { effects: {}, actions: {} },
);
