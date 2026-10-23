import { useEffect, useRef } from 'react';
import { play, seek } from '../engine.ts';
import { useStore } from '../store.ts';

/** Starts presenting from the playhead: `fullscreen` takes over the screen, `window` fills the app window. */
export function present(how: 'fullscreen' | 'window') {
  if (!useStore.getState().movie) return;
  play(false);
  useStore.setState({ presenting: how });
}

/**
 * Presentation (slides) mode: each click / space plays exactly one transition
 * (a step or a `then` sub-step) and then waits. Holds, waits and narration
 * pauses are skipped, and narration isn't played.
 */
export function Slides() {
  const mode = useStore((s) => s.presenting);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const counter = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mode) return;
    const el = root.current!;
    const movie = () => useStore.getState().movie!;
    let beat = movie().beatAt(useStore.getState().time);
    /** start time (performance.now) of the transition into beat+1, while it plays */
    let animStart: number | null = null;
    let counterTimer = 0;
    let current: 'fullscreen' | 'window' = mode;
    let stopped = false;

    const draw = () => {
      const m = movie();
      const elapsed = animStart === null ? 0 : performance.now() - animStart;
      stage.current!.innerHTML = m.slideSvgAt(Math.min(beat, m.beats.length), elapsed);
      counter.current!.textContent = `${beat} / ${m.beats.length}`;
    };
    const flash = () => {
      counter.current!.classList.add('show');
      clearTimeout(counterTimer);
      counterTimer = window.setTimeout(() => counter.current?.classList.remove('show'), 1200);
    };
    const finishBeat = () => {
      animStart = null;
      beat = Math.min(beat + 1, movie().beats.length);
      draw();
    };
    const tick = () => {
      if (stopped || animStart === null) return;
      const b = movie().beats[beat];
      if (!b || performance.now() - animStart >= b.end - b.start) return finishBeat();
      draw();
      requestAnimationFrame(tick);
    };
    const advance = () => {
      // a click during a transition completes it
      if (animStart !== null) return finishBeat();
      if (beat >= movie().beats.length) return flash();
      const b = movie().beats[beat];
      if (b.end <= b.start) return finishBeat(); // cut
      animStart = performance.now();
      requestAnimationFrame(tick);
    };
    const goTo = (n: number) => {
      animStart = null;
      beat = Math.max(0, Math.min(n, movie().beats.length));
      draw();
      flash();
    };
    /** beat count at the end of the next/previous step (`then` sub-steps are skipped over) */
    const chapterBeat = (dir: 1 | -1) => {
      const beats = movie().beats;
      const ends = [0];
      for (let k = 1; k <= beats.length; k++) if (k === beats.length || beats[k].chapter !== beats[k - 1].chapter) ends.push(k);
      return dir > 0 ? (ends.find((k) => k > beat) ?? beats.length) : (ends.filter((k) => k < beat).pop() ?? 0);
    };
    const setMode = async (how: 'fullscreen' | 'window') => {
      current = how;
      if (how === 'fullscreen' && !document.fullscreenElement) {
        try {
          await el.requestFullscreen();
        } catch {
          current = 'window'; // fullscreen refused: stay in the window
        }
      } else if (how === 'window' && document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
      el.focus();
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      const m = movie();
      // leave the studio on the slide we were showing
      useStore.setState({ presenting: null });
      seek(beat > 0 ? m.beats[Math.min(beat, m.beats.length) - 1].end : 0);
    };

    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if ([' ', 'ArrowRight', 'ArrowDown', 'PageDown', 'Enter', 'n'].includes(k)) advance();
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) goTo(animStart !== null ? beat : beat - 1);
      else if (k === 'Home') goTo(0);
      else if (k === 'End') goTo(movie().beats.length);
      else if (k === ']') goTo(chapterBeat(1));
      else if (k === '[') goTo(chapterBeat(-1));
      else if (k === 'Escape') stop();
      else if (k === 'f') setMode(current === 'fullscreen' ? 'window' : 'fullscreen');
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      goTo(beat - 1);
    };
    // leaving fullscreen (Esc) ends a fullscreen presentation; switching with `f` doesn't
    const onFullscreen = () => !document.fullscreenElement && current === 'fullscreen' && stop();

    el.addEventListener('click', advance);
    el.addEventListener('contextmenu', onContext);
    el.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    // the script may change while presenting (the agent keeps working)
    const unsub = useStore.subscribe((s, prev) => {
      if (s.movie && s.movie !== prev.movie) {
        beat = Math.min(beat, s.movie.beats.length);
        draw();
      }
    });
    draw();
    flash();
    setMode(mode);
    return () => {
      stopped = true;
      el.removeEventListener('click', advance);
      el.removeEventListener('contextmenu', onContext);
      el.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      unsub();
      clearTimeout(counterTimer);
    };
  }, [mode]);

  if (!mode) return null;
  return (
    <div className="slides" ref={root} tabIndex={-1}>
      <div className="slide-stage" ref={stage} />
      <div className="slide-counter" ref={counter} />
    </div>
  );
}
