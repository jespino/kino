import { KinoError, type Expr, type Item, type Pos, type Stmt } from '../dsl/ast.ts';
import { parse } from '../dsl/parser.ts';
import { WidgetRegistry } from '../widgets/index.ts';
import { interpolate, still, type TransitionKind } from './animate.ts';
import { easings, type Ease } from './easing.ts';
import { Renderer, type Frame } from './render.ts';
import { emptyState, SceneBuilder, type SceneState } from './scene.ts';
import { frameToSVG } from './svg.ts';
import { DEFAULT_THEME, themes, type Theme } from './theme.ts';
import { evaluate, isObj, isPoint, isRef, num, str, type Value } from './values.ts';
import type { WidgetDef } from './widget.ts';
import type { EmojiProvider } from './emoji.ts';
import type { ImageProvider } from './image.ts';
import { applyVoice, estimateDuration, narrationRequest, sayVoice, videoVoice, type NarrationLookup, type NarrationRequest } from './narration.ts';

export interface VideoConfig {
  width: number;
  height: number;
  fps: number;
  background: string;
  theme: Theme;
  /** default transition duration (ms) */
  transition: number;
  /** default pause after each step (ms) */
  hold: number;
  /** pause after a step's narration ends (ms) */
  narrationHold: number;
  easing: string;
}

/** A narration clip placed on the timeline. */
export interface NarrationClip {
  request: NarrationRequest;
  /** ms */
  start: number;
  duration: number;
  /** false while the audio isn't generated yet (duration is an estimate) */
  ready: boolean;
  url?: string;
  line: number;
}

interface Segment {
  start: number;
  end: number;
  from: Frame;
  to: Frame;
  ease: Ease;
  kind: TransitionKind;
  hold: boolean;
}

export interface Chapter {
  name: string;
  time: number;
  line: number;
}

/**
 * One transition of the presentation (slides) mode: a frame, a step, or a
 * `then` sub-step. Holds, waits and narration pauses are not beats.
 */
export interface Beat {
  /** ms on the timeline; start === end for `cut` transitions */
  start: number;
  end: number;
  /** the scene once the transition is done */
  frame: Frame;
  /** chapter (step) this beat belongs to */
  chapter: number;
}

export interface CompileOptions {
  widgets?: WidgetDef<any>[];
  /** real durations/urls of generated narration; missing clips use an estimated duration */
  narration?: NarrationLookup;
  /** emoji artwork (SVG markup) for the emoji widget; without it emoji are drawn as text */
  emoji?: EmojiProvider;
  /** pictures for the image widget, preloaded by the host; missing ones render as placeholders */
  images?: ImageProvider;
  /** theme name that replaces the script's `video { theme }` (neon, dark, light, sketch) */
  theme?: string;
}

export class Movie {
  constructor(
    public readonly video: VideoConfig,
    private segments: Segment[],
    public readonly chapters: Chapter[],
    public readonly duration: number,
    public readonly narration: NarrationClip[] = [],
    public readonly beats: Beat[] = [],
  ) {}

  /**
   * Presentation mode: the frame shown at `beat` (number of transitions applied)
   * plus `elapsed` ms into the next transition.
   */
  slideFrameAt(beat: number, elapsed = 0): Frame {
    const next = this.beats[beat];
    if (next && elapsed > 0 && next.end > next.start) return this.frameAt(Math.min(next.end, next.start + elapsed) - 0.001);
    if (beat > 0) return still(this.beats[Math.min(beat, this.beats.length) - 1].frame);
    return this.frameAt(0);
  }

  slideSvgAt(beat: number, elapsed = 0, extraDefs = ''): string {
    return frameToSVG(this.slideFrameAt(beat, elapsed), this.video.width, this.video.height, this.video.background, this.video.theme, extraDefs);
  }

  /** number of beats completed at timeline time t */
  beatAt(t: number): number {
    let n = 0;
    while (n < this.beats.length && this.beats[n].end <= t + 1) n++;
    return n;
  }

  /** narration clip being spoken at time t, if any */
  narrationAt(t: number): NarrationClip | undefined {
    return this.narration.find((c) => t >= c.start && t < c.start + c.duration);
  }

  get frameCount(): number {
    return Math.max(1, Math.ceil((this.duration / 1000) * this.video.fps));
  }

  /** Frame at time t (ms). */
  frameAt(t: number): Frame {
    const segs = this.segments;
    if (!segs.length) return { nodes: [], view: { x: 0, y: 0, w: this.video.width, h: this.video.height } };
    if (t >= this.duration) return still(segs[segs.length - 1].to);
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].end <= t) lo = mid + 1;
      else hi = mid;
    }
    const s = segs[lo];
    if (s.hold) return still(s.to);
    const p = Math.min(1, Math.max(0, (t - s.start) / (s.end - s.start)));
    return interpolate(s.from, s.to, s.ease(p), s.kind);
  }

  /** `extraDefs` is inserted into <defs> verbatim (the browser exporter embeds fonts this way). */
  svgAt(t: number, extraDefs = ''): string {
    return frameToSVG(this.frameAt(t), this.video.width, this.video.height, this.video.background, this.video.theme, extraDefs);
  }
}

export function compile(src: string, opts: CompileOptions = {}): Movie {
  const program = parse(src);
  const registry = new WidgetRegistry();
  opts.widgets?.forEach((w) => registry.register(w));

  const video = videoConfig(program.items.filter((i): i is Extract<Item, { t: 'video' }> => i.t === 'video'), opts.theme);
  const builder = new SceneBuilder(registry);
  const renderer = new Renderer(registry, video, video.theme, opts.emoji, opts.images);
  const build = (s: SceneState, pos: Pos) => {
    try {
      return renderer.build(s);
    } catch (e) {
      if (e instanceof KinoError && e.pos) throw e;
      throw new KinoError(e instanceof Error ? e.message : String(e), pos);
    }
  };

  const segments: Segment[] = [];
  const chapters: Chapter[] = [];
  const beats: Beat[] = [];
  let state = emptyState();
  let current = build(state, { line: 1, col: 1 });
  let t = 0;
  let stepNo = 0;
  let voice = videoVoice(program);
  const narration: NarrationClip[] = [];
  /** place a clip at the current time; returns its end time */
  const say = (s: { text: string; opts: Expr[]; pos: Pos }): number => {
    let request: NarrationRequest;
    try {
      request = narrationRequest(s.text, sayVoice(voice, s.opts));
    } catch (e) {
      throw e instanceof KinoError && e.pos ? e : new KinoError(e instanceof Error ? e.message : String(e), s.pos);
    }
    const audio = opts.narration?.(request);
    const duration = audio?.duration ?? estimateDuration(s.text);
    narration.push({ request, start: t, duration, ready: !!audio, url: audio?.url, line: s.pos.line });
    return t + duration;
  };

  const hold = (ms: number) => {
    if (ms <= 0) return;
    segments.push({ start: t, end: t + ms, from: current, to: current, ease: easings.linear, kind: 'morph', hold: true });
    t += ms;
  };

  for (const item of program.items) {
    if (item.t === 'video') continue;
    if (item.t === 'wait') {
      hold(item.ms);
      continue;
    }
    if (item.t === 'voice') {
      voice = applyVoice(voice, Object.fromEntries(item.props.map(([k, e]) => [k, evalWith(e, e.pos)])), item.pos);
      continue;
    }
    if (item.t === 'say') {
      chapters.push({ name: `“${item.text.length > 32 ? item.text.slice(0, 30) + '…' : item.text}”`, time: t, line: item.pos.line });
      const end = say(item);
      hold(end - t + video.narrationHold);
      continue;
    }
    stepNo++;
    const isFirst = segments.length === 0 && t === 0;
    const o = stepOptions(item.opts, video, item.t === 'frame' && isFirst);
    chapters.push({ name: item.name ?? `${item.t} ${stepNo}`, time: t, line: item.pos.line });

    // `then` splits a step into sequential sub-steps
    const groups: Stmt[][] = [[]];
    for (const s of item.body) {
      if (s.t === 'then') groups.push([]);
      else groups[groups.length - 1].push(s);
    }
    if (item.t === 'frame' && groups.length > 1) throw new KinoError(`'then' is only allowed inside steps`, item.pos);

    let next: SceneState = item.t === 'frame' ? emptyState() : structuredClone(state);
    let spokenUntil = -1;
    for (const g of groups) {
      // narration starts together with its (sub)step
      for (const s of g) if (s.t === 'say') spokenUntil = Math.max(spokenUntil, say(s));
      builder.apply(next, g.filter((s) => s.t !== 'say'));
      const snapshot = structuredClone(next);
      const target = build(snapshot, item.pos);
      beats.push({ start: t, end: t + Math.max(0, o.duration), frame: target, chapter: chapters.length - 1 });
      if (o.duration > 0) {
        segments.push({ start: t, end: t + o.duration, from: current, to: target, ease: o.ease, kind: o.kind, hold: false });
        t += o.duration;
      }
      current = target;
      state = snapshot;
      next = structuredClone(snapshot);
    }
    if (spokenUntil >= 0) {
      // wait for the voice to finish, then a short pause (or the explicit `hold:`)
      if (spokenUntil > t) hold(spokenUntil - t);
      hold(o.holdSet ? o.hold : video.narrationHold);
    } else hold(o.hold);
  }
  if (t === 0) hold(1000);
  return new Movie(video, segments, chapters, t, narration, beats);
}

function videoConfig(items: Extract<Item, { t: 'video' }>[], themeOverride?: string): VideoConfig {
  const props: Record<string, Value> = {};
  for (const it of items) for (const [k, v] of it.props) props[k] = evalWith(v, it.pos);
  if (themeOverride) {
    if (!themes[themeOverride]) fail(`unknown theme '${themeOverride}' (${Object.keys(themes).join(', ')})`);
    // keep the script's token overrides, on top of the chosen base theme
    props.theme = isObj(props.theme) ? { ...props.theme, base: themeOverride } : themeOverride;
    // a background picked for another theme rarely fits
    delete props.background;
  }
  let theme = themes[DEFAULT_THEME];
  const th = props.theme;
  if (typeof th === 'string' || isRef(th)) {
    theme = themes[str(th)] ?? fail(`unknown theme '${str(th)}' (${Object.keys(themes).join(', ')})`);
  } else if (isObj(th)) {
    theme = { ...(themes[str(th.base ?? DEFAULT_THEME)] ?? themes[DEFAULT_THEME]), ...Object.fromEntries(Object.entries(th).map(([k, v]) => [k, str(v)])) };
  }
  let width = 1280, height = 720;
  if (isPoint(props.size)) [width, height] = props.size.$pt;
  if (props.width !== undefined) width = num(props.width);
  if (props.height !== undefined) height = num(props.height);
  return {
    width,
    height,
    fps: props.fps === undefined ? 30 : num(props.fps),
    theme,
    background: props.background === undefined ? theme.bg : theme[str(props.background)] ?? str(props.background),
    transition: props.transition === undefined ? 700 : num(props.transition),
    hold: props.hold === undefined ? 900 : num(props.hold),
    narrationHold: props.narrationHold === undefined ? 400 : num(props.narrationHold),
    easing: props.easing === undefined ? 'ease-in-out' : str(props.easing),
  };
}

function stepOptions(opts: Expr[], video: VideoConfig, firstFrame: boolean) {
  let duration = firstFrame ? 0 : video.transition;
  let ease = easings[video.easing] ?? easings['ease-in-out'];
  let kind: TransitionKind = 'morph';
  let hold = video.hold;
  let holdSet = false;
  for (const e of opts) {
    const v = evalWith(e, e.pos);
    const word = typeof v === 'string' || isRef(v) ? str(v) : null;
    if (e.t === 'dur' || typeof v === 'number') duration = num(v);
    else if (word && easings[word]) ease = easings[word];
    else if (word === 'morph' || word === 'fade' || word === 'cut') {
      kind = word;
      if (word === 'cut') duration = 0;
      else if (firstFrame && duration === 0) duration = video.transition;
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'hold') {
          hold = num(x);
          holdSet = true;
        }
        else if (k === 'duration') duration = num(x);
        else if (k === 'ease' || k === 'easing') ease = easings[str(x)] ?? fail(`unknown easing '${str(x)}'`, e.pos);
        else fail(`unknown step option '${k}' (hold, duration, ease)`, e.pos);
      }
    } else fail(`unknown step option '${str(v)}'. Use a duration, an easing (${Object.keys(easings).join(', ')}), morph|fade|cut, or hold: <dur>`, e.pos);
  }
  return { duration, ease, kind, hold, holdSet };
}

function evalWith(e: Expr, pos: Pos): Value {
  try {
    return evaluate(e);
  } catch (err) {
    throw new KinoError(err instanceof Error ? err.message : String(err), pos);
  }
}

function fail(msg: string, pos?: Pos): never {
  throw new KinoError(msg, pos);
}
