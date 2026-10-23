// What happens when, for editor timelines: steps and their transitions, and for every
// element the spans it is on stage plus the moments it changes. Recorded while compiling;
// it describes the movie, it doesn't drive it.
import type { Pos, Seg, Stmt } from '../dsl/ast.ts';
import type { TransitionKind } from './animate.ts';
import { EMPHASIS } from './scene.ts';
import { evaluate, str } from './values.ts';

export interface TimelineTransition {
  /** ms; start === end for cuts */
  start: number;
  end: number;
  kind: TransitionKind;
  ease: string;
  /** line of the sub-step (`then`) or of the step itself */
  line: number;
}

export interface TimelineStep {
  kind: 'frame' | 'step' | 'say' | 'wait';
  name: string;
  start: number;
  end: number;
  line: number;
  /** one per sub-step; empty for `say`/`wait` */
  transitions: TimelineTransition[];
}

export interface ElementSpan {
  /** when it starts entering */
  start: number;
  /** when it is gone (end of its exit transition, or the end of the movie) */
  end: number;
  /** length of the enter transition (ms) */
  enter: number;
  /** length of the exit transition (ms); 0 if it stays until the end */
  exit: number;
}

export interface ElementMark {
  /** start of the transition that animates the change */
  time: number;
  /** length of that transition (ms) */
  duration: number;
  /** 'effect': an emphasis (bounce, pulse...); 'method': another widget method; 'set': a property change */
  kind: 'effect' | 'method' | 'set';
  label: string;
  line: number;
}

export interface TimelineElement {
  name: string;
  type: string;
  /** line of the first declaration */
  line: number;
  spans: ElementSpan[];
  marks: ElementMark[];
}

export interface Timeline {
  steps: TimelineStep[];
  elements: TimelineElement[];
  /** camera moves (focus, reset, zoom/center changes) */
  camera: ElementMark[];
}

const segText = (target: Seg[]) => target.map((s) => ('name' in s ? s.name : '[…]')).join('.').replace(/\.\[/g, '[');

/** Builds a Timeline while compile() walks the program. */
export class TimelineRecorder {
  readonly timeline: Timeline = { steps: [], elements: [], camera: [] };
  private open = new Map<string, { el: TimelineElement; span: ElementSpan }>();
  private byName = new Map<string, TimelineElement[]>();

  step(kind: TimelineStep['kind'], name: string, start: number, pos: Pos): TimelineStep {
    const s: TimelineStep = { kind, name, start, end: start, line: pos.line, transitions: [] };
    this.timeline.steps.push(s);
    return s;
  }

  /**
   * One sub-step: its statements, the transition that animates them, and the names
   * on stage once it is done (to catch widgets that disappear as a side effect).
   */
  group(stmts: Stmt[], time: number, duration: number, alive: { name: string; type: string }[]) {
    const mark = (name: string, kind: ElementMark['kind'], label: string, pos: Pos) => {
      const m: ElementMark = { time, duration, kind, label, line: pos.line };
      if (name === 'camera') this.timeline.camera.push(m);
      else this.open.get(name)?.el.marks.push(m);
    };
    for (const s of stmts) {
      switch (s.t) {
        case 'decl':
        case 'connect': {
          const name = declName(s);
          if (name && this.open.has(name)) mark(name, 'set', 'redeclared', s.pos);
          break;
        }
        case 'remove':
          for (const n of s.names) this.close(n, time, duration);
          break;
        case 'assign':
          mark(rootName(s.target), 'set', `${segText(s.target)} =`, s.pos);
          break;
        case 'merge':
          mark(rootName(s.target), 'set', `${segText(s.target)} { ${s.props.map(([k]) => k).join(', ')} }`, s.pos);
          break;
        case 'call':
          mark(rootName(s.target), EMPHASIS.includes(s.method) ? 'effect' : 'method', `${s.method}()`, s.pos);
          break;
      }
    }
    const now = new Set(alive.map((w) => w.name));
    for (const name of [...this.open.keys()]) if (!now.has(name)) this.close(name, time, duration);
    for (const w of alive) {
      if (this.open.has(w.name)) continue;
      const line = declLine(stmts, w.name);
      const el = this.element(w.name, w.type, line);
      const span: ElementSpan = { start: time, end: Infinity, enter: duration, exit: 0 };
      el.spans.push(span);
      this.open.set(w.name, { el, span });
    }
  }

  /** Closes the open spans and returns the timeline. */
  finish(end: number): Timeline {
    for (const { span } of this.open.values()) span.end = end;
    this.open.clear();
    return this.timeline;
  }

  private element(name: string, type: string, line: number): TimelineElement {
    // a name reused for a different widget type gets its own row
    const rows = this.byName.get(name) ?? [];
    let el = rows.find((e) => e.type === type);
    if (!el) {
      el = { name, type, line, spans: [], marks: [] };
      rows.push(el);
      this.byName.set(name, rows);
      this.timeline.elements.push(el);
    }
    return el;
  }

  private close(name: string, time: number, duration: number) {
    const o = this.open.get(name);
    if (!o) return;
    o.span.end = time + duration;
    o.span.exit = duration;
    this.open.delete(name);
  }
}

const rootName = (target: Seg[]) => {
  const first = target[0];
  return first && 'name' in first ? first.name : '';
};

/** The widget a declaration creates; unnamed arrows are named after their endpoints, like SceneBuilder does. */
function declName(s: Extract<Stmt, { t: 'decl' | 'connect' }>): string | null {
  if (s.t === 'decl' || s.name) return s.name ?? null;
  try {
    return `${str(evaluate(s.from))}->${str(evaluate(s.to))}`;
  } catch {
    return null;
  }
}

function declLine(stmts: Stmt[], name: string): number {
  const s = stmts.find((s) => (s.t === 'decl' || s.t === 'connect') && declName(s) === name);
  return s?.pos.line ?? 0;
}
