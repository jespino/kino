// Presenting slides, shared by the studio's Present mode and exported HTML
// files: the Deck plays one transition per click and follows links, and the
// SpeakerView shows the current and next slide, notes and a timer.
import type { Movie } from '../src/index.ts';

/** What the speaker view shows; the studio sends it to the speaker window as an event. */
export interface SpeakerState {
  current: string;
  /** the next slide (SVG), or null at the end */
  next: string | null;
  title: string;
  notes: string[];
  /** narration of the step, shown under the notes */
  spoken: string[];
  /** "3 / 12" */
  counter: string;
}

/** Commands the speaker view sends back. */
export type DeckCommand = 'next' | 'prev' | 'first' | 'last' | 'next-step' | 'prev-step';

export interface DeckHooks {
  /** draw this picture */
  draw(svg: string): void;
  /** the slide number changed (shown with the counter) */
  moved?(): void;
}

/**
 * Presentation state: `beat` transitions are done; while one plays, `anim`
 * says from where to where (a step, or a jump to a linked slide).
 */
export class Deck {
  beat: number;
  private anim: { start: number; from: number; to: number; jump: boolean } | null = null;
  private raf = 0;
  private stopped = false;

  constructor(
    private movie: () => Movie,
    private hooks: DeckHooks,
    private win: Window = window,
    start?: number,
  ) {
    this.beat = Math.max(this.first, Math.min(start ?? this.first, this.movie().beats.length));
  }

  /** beats already applied at time 0 (an opening frame that appears instantly) show the same picture as none */
  get first() {
    return this.movie().beatAt(0);
  }

  get total() {
    return this.movie().beats.length;
  }

  counter() {
    return `${this.beat - this.first} / ${this.total - this.first}`;
  }

  draw() {
    const m = this.movie();
    const a = this.anim;
    const elapsed = a ? performance.now() - a.start : 0;
    this.hooks.draw(a?.jump ? m.jumpSvgAt(a.from, a.to, elapsed) : m.slideSvgAt(Math.min(this.beat, m.beats.length), elapsed));
  }

  /** Play the next transition; a click during one completes it first. */
  advance() {
    if (this.anim) this.finish();
    if (this.beat >= this.total) return this.hooks.moved?.();
    const b = this.movie().beats[this.beat];
    if (b.end <= b.start) {
      this.beat++;
      return this.settled();
    }
    this.play({ start: performance.now(), from: this.beat, to: this.beat + 1, jump: false });
  }

  back() {
    // during a transition: stay where it started
    this.goTo(this.anim ? this.beat : this.beat - 1);
  }

  /** Show slide n at once. */
  goTo(n: number) {
    this.anim = null;
    this.beat = Math.max(this.first, Math.min(n, this.total));
    this.settled();
  }

  /** Fly to slide n with the transition written for it (a link). */
  jumpTo(n: number) {
    if (this.anim) this.finish();
    n = Math.max(this.first, Math.min(n, this.total));
    if (n === this.beat) return;
    this.play({ start: performance.now(), from: this.beat, to: n, jump: true });
  }

  /** A link: a frame or step name, or a URL. */
  follow(link: string) {
    if (/^(https?:|mailto:)/.test(link)) {
      this.win.open(link, '_blank', 'noopener');
      return;
    }
    const n = this.movie().beatOf(link);
    if (n !== undefined) this.jumpTo(n);
  }

  /** A click on the slide: follow a link if it hit one, otherwise go on. */
  click(e: MouseEvent) {
    const link = (e.target as Element | null)?.closest?.('[data-link]')?.getAttribute('data-link');
    if (link) this.follow(link);
    else this.advance();
  }

  /** slide count at the end of the next/previous step (`then` sub-steps are skipped over) */
  chapterBeat(dir: 1 | -1) {
    const beats = this.movie().beats;
    const ends = [0];
    for (let k = 1; k <= beats.length; k++) if (k === beats.length || beats[k].chapter !== beats[k - 1].chapter) ends.push(k);
    return dir > 0 ? (ends.find((k) => k > this.beat) ?? beats.length) : (ends.filter((k) => k < this.beat).pop() ?? 0);
  }

  command(c: DeckCommand) {
    if (c === 'next') this.advance();
    else if (c === 'prev') this.back();
    else if (c === 'first') this.goTo(this.first);
    else if (c === 'last') this.goTo(this.total);
    else if (c === 'next-step') this.goTo(this.chapterBeat(1));
    else if (c === 'prev-step') this.goTo(this.chapterBeat(-1));
  }

  /** The navigation keys (shared by every presenting view). Returns false for other keys. */
  key(e: KeyboardEvent): boolean {
    const c = keyCommand(e.key);
    if (!c) return false;
    this.command(c);
    return true;
  }

  /** What the speaker view shows now. */
  speaker(): SpeakerState {
    const m = this.movie();
    const shown = Math.max(0, Math.min(this.beat, m.beats.length) - 1);
    const chapter = m.beats[shown]?.chapter ?? 0;
    const step = m.beats.filter((b) => b.chapter === chapter);
    return {
      current: m.slideSvgAt(this.beat),
      next: this.beat < m.beats.length ? m.slideSvgAt(this.beat + 1) : null,
      title: m.chapters[chapter]?.name ?? '',
      notes: step.flatMap((b) => b.notes),
      spoken: step.flatMap((b) => b.spoken),
      counter: this.counter(),
    };
  }

  /** Clamp after the script changed (the agent keeps working while presenting). */
  refresh() {
    this.beat = Math.max(this.first, Math.min(this.beat, this.total));
    if (this.anim) this.anim = null;
    this.settled();
  }

  stop() {
    this.stopped = true;
    this.win.cancelAnimationFrame(this.raf);
  }

  private play(a: NonNullable<Deck['anim']>) {
    this.anim = a;
    this.win.cancelAnimationFrame(this.raf);
    this.raf = this.win.requestAnimationFrame(this.tick);
  }

  private tick = () => {
    const a = this.anim;
    if (this.stopped || !a) return;
    const m = this.movie();
    const d = a.jump ? m.jumpDuration(a.from, a.to) : (m.beats[a.from]?.end ?? 0) - (m.beats[a.from]?.start ?? 0);
    if (performance.now() - a.start >= d) return this.finish();
    this.draw();
    this.raf = this.win.requestAnimationFrame(this.tick);
  };

  private finish() {
    const a = this.anim;
    if (!a) return;
    this.anim = null;
    this.beat = Math.min(a.to, this.total);
    this.settled();
  }

  private settled() {
    this.draw();
    this.hooks.moved?.();
  }
}

export function keyCommand(k: string): DeckCommand | null {
  if ([' ', 'ArrowRight', 'ArrowDown', 'PageDown', 'Enter', 'n'].includes(k)) return 'next';
  if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) return 'prev';
  if (k === 'Home') return 'first';
  if (k === 'End') return 'last';
  if (k === ']') return 'next-step';
  if (k === '[') return 'prev-step';
  return null;
}

const SPEAKER_CSS = `
.ks{position:fixed;inset:0;display:grid;grid-template-columns:3fr 2fr;grid-template-rows:auto 1fr;gap:16px;padding:16px;box-sizing:border-box;background:#111317;color:#e6e6e6;font:15px system-ui,sans-serif}
.ks-bar{grid-column:1/3;display:flex;align-items:baseline;gap:18px}
.ks-timer{font:600 32px ui-monospace,monospace;cursor:pointer}
.ks-clock{color:#9a9ca3;font:16px ui-monospace,monospace}
.ks-title{flex:1;font-weight:600;font-size:18px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ks-counter{color:#9a9ca3}
.ks-now,.ks-side{display:flex;flex-direction:column;gap:8px;min-height:0}
.ks-label{color:#9a9ca3;font-size:12px;text-transform:uppercase;letter-spacing:.08em}
.ks-slide{line-height:0;border:1px solid #3a3c42;background:#000}
.ks-slide svg{width:100%;height:auto;display:block}
.ks-next{opacity:.85}
.ks-notes{flex:1;overflow:auto;font-size:20px;line-height:1.45}
.ks-notes p{margin:0 0 10px}
.ks-notes .spoken{color:#9a9ca3;font-style:italic;font-size:16px}
.ks-end{padding:30px;text-align:center;color:#9a9ca3}
`;

/** The speaker view: current and next slide, notes, a timer (click it to restart) and the clock. */
export class SpeakerView {
  private els: Record<'timer' | 'clock' | 'title' | 'counter' | 'current' | 'next' | 'notes', HTMLElement>;
  private started = Date.now();

  constructor(root: HTMLElement, onCommand: (c: DeckCommand) => void) {
    const doc = root.ownerDocument;
    const win = doc.defaultView!;
    const style = doc.createElement('style');
    style.textContent = SPEAKER_CSS;
    doc.head.append(style);
    doc.title = 'Speaker view';
    root.innerHTML =
      '<div class="ks"><div class="ks-bar"><span class="ks-timer" title="Click to restart"></span><span class="ks-clock"></span>' +
      '<span class="ks-title"></span><span class="ks-counter"></span></div>' +
      '<div class="ks-now"><div class="ks-label">Now</div><div class="ks-slide ks-current"></div></div>' +
      '<div class="ks-side"><div class="ks-label">Next</div><div class="ks-slide ks-next"></div><div class="ks-label">Notes</div><div class="ks-notes"></div></div></div>';
    const q = (c: string) => root.querySelector<HTMLElement>(`.ks-${c}`)!;
    this.els = { timer: q('timer'), clock: q('clock'), title: q('title'), counter: q('counter'), current: q('current'), next: q('next'), notes: q('notes') };
    this.els.timer.onclick = () => {
      this.started = Date.now();
      this.tick();
    };
    q('current').onclick = () => onCommand('next');
    win.addEventListener('keydown', (e) => {
      const c = keyCommand(e.key);
      if (!c || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault();
      onCommand(c);
    });
    win.setInterval(() => this.tick(), 500);
    this.tick();
  }

  show(s: SpeakerState | null) {
    const e = this.els;
    if (!s) {
      e.current.innerHTML = '<div class="ks-end">Waiting for the presentation to start…</div>';
      e.next.innerHTML = e.notes.innerHTML = e.title.textContent = e.counter.textContent = '';
      return;
    }
    e.current.innerHTML = s.current;
    e.next.innerHTML = s.next ?? '<div class="ks-end">End of the presentation</div>';
    e.title.textContent = s.title;
    e.counter.textContent = s.counter;
    const doc = e.notes.ownerDocument;
    e.notes.replaceChildren(
      ...s.notes.map((t) => Object.assign(doc.createElement('p'), { textContent: t })),
      ...s.spoken.map((t) => Object.assign(doc.createElement('p'), { textContent: `“${t}”`, className: 'spoken' })),
    );
  }

  private tick() {
    const s = Math.floor((Date.now() - this.started) / 1000);
    this.els.timer.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.els.clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
