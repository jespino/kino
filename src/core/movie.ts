import { KinoError, type Expr, type Item, type Pos, type Stmt } from '../dsl/ast.ts';
import { parse } from '../dsl/parser.ts';
import { WidgetRegistry } from '../widgets/index.ts';
import { DIRECTIONS, interpolate, IRIS_SHAPES, still, type Direction, type IrisShape, type TransitionKind, type TransitionStyle } from './animate.ts';
import { easings, type Ease } from './easing.ts';
import { padView, Renderer, type Frame, type Padding } from './render.ts';
import { emptyState, SceneBuilder, type SceneState } from './scene.ts';
import { frameToSVG } from './svg.ts';
import { DEFAULT_THEME, themes, type Theme } from './theme.ts';
import { evaluate, isObj, isPoint, isRef, num, str, type Value } from './values.ts';
import type { WidgetDef } from './widget.ts';
import type { EmojiProvider } from './emoji.ts';
import type { ImageProvider } from './image.ts';
import { TimelineRecorder, type Timeline } from './timeline.ts';
import { applyVoice, estimateDuration, spokenText, narrationRequest, sayVoice, videoVoice, type NarrationLookup, type NarrationRequest, type ProjectVoice } from './narration.ts';

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
  /** space kept clear around every slide: the picture is scaled down to fit inside it */
  padding: Padding;
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
  style?: TransitionStyle;
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
  /** line of the frame, step or `then` that starts it */
  line: number;
  /** how it animates (for jumps, which play it from another slide) */
  kind: TransitionKind;
  style?: TransitionStyle;
  ease: string;
  /** speaker notes (`note "..."`) of this frame, step or `then` sub-step */
  notes: string[];
  /** its narration (`say`), shown with the notes */
  spoken: string[];
}

/** A page of the printed version (PDF): the picture once a transition is done. */
export interface Page {
  /** transitions completed; draw the page with pageSvg() */
  beat: number;
  /**
   * ms into the transition that leads to `beat` (0: the finished state). Set for
   * transitions that only play effects (bursts, clicks, bounces): their finished
   * state is the previous page again, so the page shows them in full swing.
   */
  elapsed: number;
  /** name of the step it belongs to */
  title: string;
  /** line of the frame, step or `then` it shows */
  line: number;
  /** ms on the timeline */
  time: number;
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
  /** the project's voice settings (its kino.json) and Kino's default provider */
  voice?: ProjectVoice;
}

export class Movie {
  constructor(
    public readonly video: VideoConfig,
    private segments: Segment[],
    public readonly chapters: Chapter[],
    public readonly duration: number,
    public readonly narration: NarrationClip[] = [],
    public readonly beats: Beat[] = [],
    /** steps, transitions and element lifespans, for editor timelines */
    public readonly timeline: Timeline = { steps: [], elements: [], camera: [] },
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

  /**
   * A jump while presenting (a link, or a key that skips around): the picture
   * `elapsed` ms into the transition from slide `from` to slide `to`, played
   * the way the transition into `to` is written; going back out of a slide
   * that was zoomed into zooms out again. Done when elapsed >= jumpDuration().
   */
  jumpSvgAt(from: number, to: number, elapsed: number, extraDefs = ''): string {
    const j = this.jumpTransition(from, to);
    let frame = this.slideFrameAt(to);
    if (j && elapsed < j.duration) frame = interpolate(this.slideFrameAt(from), frame, (easings[j.ease] ?? easings['ease-in-out'])(Math.max(0, elapsed) / j.duration), j.kind, j.style);
    return frameToSVG(frame, this.video.width, this.video.height, this.video.background, this.video.theme, extraDefs);
  }

  jumpDuration(from: number, to: number): number {
    return this.jumpTransition(from, to)?.duration ?? 0;
  }

  private jumpTransition(from: number, to: number): { kind: TransitionKind; style?: TransitionStyle; ease: string; duration: number } | undefined {
    const span = (b: Beat) => (b.end > b.start ? b.end - b.start : this.video.transition);
    const left = this.beats[from - 1];
    if (to < from && left && (left.kind === 'zoom-in' || left.kind === 'zoom-out'))
      return { kind: left.kind === 'zoom-in' ? 'zoom-out' : 'zoom-in', style: left.style, ease: left.ease, duration: span(left) };
    const b = this.beats[to - 1];
    return b && { kind: b.kind === 'cut' ? 'morph' : b.kind, style: b.style, ease: b.ease, duration: span(b) };
  }

  /** The slide (number of beats applied) that shows a frame or step: the end of its first transition. */
  beatOf(name: string): number | undefined {
    const ch = this.chapters.findIndex((c) => c.name === name);
    const k = this.beats.findIndex((b) => b.chapter === ch);
    return ch < 0 || k < 0 ? undefined : k + 1;
  }

  /**
   * Pages for a printed version: the picture after every transition, so every
   * frame, step and `then` sub-step gets a page (what Present mode stops on).
   */
  pages(): Page[] {
    const out: Page[] = [];
    let previous = '';
    this.beats.forEach((b, i) => {
      const page: Page = { beat: i + 1, elapsed: 0, title: this.chapters[b.chapter]?.name ?? '', line: b.line, time: b.end };
      const svg = this.pageSvg(page);
      if (svg === previous && b.end > b.start) {
        // nothing stays changed: show the effect halfway instead of a repeat of the last page
        page.elapsed = (b.end - b.start) / 2;
        page.time = b.start + page.elapsed;
      }
      previous = svg;
      out.push(page);
    });
    return out.length ? out : [{ beat: 0, elapsed: 0, title: '', line: 1, time: 0 }];
  }

  /** The picture of a page (see pages()). */
  pageSvg(page: Page, extraDefs = ''): string {
    return page.elapsed > 0 ? this.slideSvgAt(page.beat - 1, page.elapsed, extraDefs) : this.slideSvgAt(page.beat, 0, extraDefs);
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
    if (!segs.length) return { nodes: [], view: padView({ x: 0, y: 0, w: this.video.width, h: this.video.height }, this.video) };
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
    return interpolate(s.from, s.to, s.ease(p), s.kind, s.style, Math.max(0, t - s.start));
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
  /** link targets used, with where they first appear */
  const links = new Map<string, Pos>();
  /** zoom targets (on the slide zoomed from, which a link may choose: anywhere in the deck will do) */
  const zoomTargets = new Map<string, Pos>();
  const widgetNames = new Set<string>();
  let state = emptyState();
  let current = build(state, { line: 1, col: 1 });
  let t = 0;
  let stepNo = 0;
  let voice = videoVoice(program, opts.voice);
  const rec = new TimelineRecorder();
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
      const step = rec.step('wait', `wait ${item.ms}ms`, t, item.pos);
      hold(item.ms);
      step.end = t;
      continue;
    }
    if (item.t === 'voice') {
      voice = applyVoice(voice, Object.fromEntries(item.props.map(([k, e]) => [k, evalWith(e, e.pos)])), item.pos);
      continue;
    }
    if (item.t === 'say') {
      chapters.push({ name: `“${item.text.length > 32 ? item.text.slice(0, 30) + '…' : item.text}”`, time: t, line: item.pos.line });
      const step = rec.step('say', chapters[chapters.length - 1].name, t, item.pos);
      const end = say(item);
      hold(end - t + video.narrationHold);
      step.end = t;
      continue;
    }
    stepNo++;
    const isFirst = segments.length === 0 && t === 0;
    const o = stepOptions(item.opts, video, item.t === 'frame' && isFirst);
    chapters.push({ name: item.name ?? `${item.t} ${stepNo}`, time: t, line: item.pos.line });
    const step = rec.step(item.t, chapters[chapters.length - 1].name, t, item.pos);

    // `then` splits a step into sequential sub-steps
    const groups: Stmt[][] = [[]];
    const groupLines = [item.pos.line];
    for (const s of item.body) {
      if (s.t === 'then') {
        groups.push([]);
        groupLines.push(s.pos.line);
      } else groups[groups.length - 1].push(s);
    }
    if (item.t === 'frame' && groups.length > 1) throw new KinoError(`'then' is only allowed inside steps`, item.pos);

    let next: SceneState = item.t === 'frame' ? emptyState() : structuredClone(state);
    let spokenUntil = -1;
    for (const [gi, g] of groups.entries()) {
      // narration starts together with its (sub)step
      for (const s of g) if (s.t === 'say') spokenUntil = Math.max(spokenUntil, say(s));
      builder.apply(next, g.filter((s) => s.t !== 'say' && s.t !== 'note'));
      const snapshot = structuredClone(next);
      const target = build(snapshot, item.pos);
      if (o.style.target && !zoomTargets.has(o.style.target)) zoomTargets.set(o.style.target, item.pos);
      Object.keys(target.boxes ?? {}).forEach((n) => widgetNames.add(n));
      for (const n of target.nodes) {
        const l = n.attrs['data-link'];
        if (typeof l === 'string' && !links.has(l)) links.set(l, item.pos);
      }
      // Timed effects only extend the transition that creates them, never later steps.
      const existing = new Set(current.nodes.map((n) => n.key));
      const d = o.kind === 'morph' && o.duration > 0
        ? Math.max(o.duration, ...target.nodes.filter((n) => !existing.has(n.key)).map((n) => n.timing?.duration ?? 0))
        : Math.max(0, o.duration);
      beats.push({
        start: t,
        end: t + d,
        frame: target,
        chapter: chapters.length - 1,
        line: groupLines[gi],
        kind: o.kind,
        style: o.style,
        ease: o.easeName,
        notes: g.flatMap((s) => (s.t === 'note' ? [s.text] : [])),
        spoken: g.flatMap((s) => (s.t === 'say' ? [spokenText(s.text)] : [])),
      });
      step.transitions.push({ start: t, end: t + d, kind: o.kind, ease: o.easeName, line: groupLines[gi] });
      rec.group(g, t, d, snapshot.widgets);
      if (d > 0) {
        segments.push({ start: t, end: t + d, from: current, to: target, ease: o.ease, kind: o.kind, style: o.style, hold: false });
        t += d;
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
    step.end = t;
  }
  if (t === 0) hold(1000);
  // links must lead somewhere: a frame or step name, or a URL
  for (const [l, pos] of links)
    if (!/^(https?:|mailto:)/.test(l) && !chapters.some((c) => c.name === l))
      fail(`link "${l}" doesn't match any frame or step name (${chapters.map((c) => `"${c.name}"`).join(', ')}) or URL`, pos);
  for (const [name, pos] of zoomTargets) if (!widgetNames.has(name)) fail(`zoom target '${name}' isn't a widget on any slide`, pos);
  return new Movie(video, segments, chapters, t, narration, beats, rec.finish(t));
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
    padding: props.padding === undefined ? themePadding(theme, width, height) : padding(props.padding, width, height),
  };
}

/** The theme's `padding` token: fractions of the frame, CSS-like. */
function themePadding(theme: Theme, width: number, height: number): Padding {
  const f = theme.padding ? theme.padding.split(',').map((x) => Number(x.trim())) : [];
  if (f.length > 4 || f.some((x) => !Number.isFinite(x))) throw new KinoError(`theme token 'padding' must be 1 to 4 fractions of the frame, got '${theme.padding}'`);
  const p = padding(f.length ? f : undefined, 1, 1);
  return { top: p.top * height, right: p.right * width, bottom: p.bottom * height, left: p.left * width };
}

/**
 * `padding: 40`, CSS-like lists (`[v, h]`, `[top, h, bottom]`, `[top, right,
 * bottom, left]`) or `{ top: 80, bottom: 60 }` (missing sides are 0).
 */
function padding(v: Value | undefined, width: number, height: number): Padding {
  const usage = `'padding' takes a number, a list like [top, right, bottom, left], or { top, right, bottom, left }`;
  let p: Padding;
  if (v === undefined || v === null) p = { top: 0, right: 0, bottom: 0, left: 0 };
  else if (typeof v === 'number') p = { top: v, right: v, bottom: v, left: v };
  else if (Array.isArray(v) && v.length >= 1 && v.length <= 4) {
    const [t, r = t, b = t, l = r] = v.map((x) => num(x, usage));
    p = { top: t, right: r, bottom: b, left: l };
  } else if (isObj(v)) {
    const unknown = Object.keys(v).find((k) => !['top', 'right', 'bottom', 'left'].includes(k));
    if (unknown) throw new KinoError(`unknown padding side '${unknown}' (top, right, bottom, left)`);
    const side = (k: string) => (v[k] === undefined ? 0 : num(v[k], usage));
    p = { top: side('top'), right: side('right'), bottom: side('bottom'), left: side('left') };
  } else throw new KinoError(usage);
  if (Object.values(p).some((x) => x < 0)) throw new KinoError(`'padding' can't be negative`);
  if (p.left + p.right >= width || p.top + p.bottom >= height) throw new KinoError(`'padding' leaves no room on the ${width}×${height} canvas`);
  return p;
}

const TRANSITIONS: TransitionKind[] = ['morph', 'fade', 'cut', 'wipe', 'iris', 'slide', 'push', 'zoom-in', 'zoom-out'];

function stepOptions(opts: Expr[], video: VideoConfig, firstFrame: boolean) {
  let duration = firstFrame ? 0 : video.transition;
  let easeName = easings[video.easing] ? video.easing : 'ease-in-out';
  let kind: TransitionKind = 'morph';
  let hold = video.hold;
  let holdSet = false;
  const style: TransitionStyle = {};
  for (const e of opts) {
    const v = evalWith(e, e.pos);
    const word = typeof v === 'string' || isRef(v) ? str(v) : null;
    if (e.t === 'dur' || typeof v === 'number') duration = num(v);
    else if (word && easings[word]) easeName = word;
    else if (word && (TRANSITIONS as string[]).includes(word)) {
      kind = word as TransitionKind;
      if (word === 'cut') duration = 0;
      else if (firstFrame && duration === 0) duration = video.transition;
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (k === 'hold') {
          hold = num(x);
          holdSet = true;
        }
        else if (k === 'duration') duration = num(x);
        else if (k === 'ease' || k === 'easing') easeName = easings[str(x)] ? str(x) : fail(`unknown easing '${str(x)}'`, e.pos);
        else if (k === 'direction')
          style.direction = (DIRECTIONS as string[]).includes(str(x)) ? (str(x) as Direction) : fail(`unknown direction '${str(x)}' (${DIRECTIONS.join(', ')})`, e.pos);
        else if (k === 'shape')
          style.shape = (IRIS_SHAPES as string[]).includes(str(x)) ? (str(x) as IrisShape) : fail(`unknown iris shape '${str(x)}' (${IRIS_SHAPES.join(', ')})`, e.pos);
        else if (k === 'target') style.target = str(x);
        else fail(`unknown step option '${k}' (hold, duration, ease, direction, shape, target)`, e.pos);
      }
    } else fail(`unknown step option '${str(v)}'. Use a duration, an easing (${Object.keys(easings).join(', ')}), a transition (${TRANSITIONS.join('|')}), or hold: <dur>`, e.pos);
  }
  if (style.direction && kind !== 'wipe' && kind !== 'slide' && kind !== 'push') fail(`'direction' is for wipe, slide and push transitions`, opts[0]?.pos);
  if (style.shape && kind !== 'iris') fail(`'shape' is for iris transitions`, opts[0]?.pos);
  if (style.target && kind !== 'zoom-in' && kind !== 'zoom-out') fail(`'target' is for zoom-in and zoom-out transitions`, opts[0]?.pos);
  return { duration, ease: easings[easeName], easeName, kind, style, hold, holdSet };
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
