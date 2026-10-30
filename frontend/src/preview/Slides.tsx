import { useEffect, useRef } from 'react';
import { Deck, type DeckCommand } from '../../present.ts';
import { api, broadcast, EVENT_PRESENT_CMD, EVENT_PRESENT_SHOW, on } from '../api.ts';
import { play, seek } from '../engine.ts';
import { useStore } from '../store.ts';

/** Starts presenting from the playhead: `fullscreen` takes over the screen, `window` fills the app window. */
export function present(how: 'fullscreen' | 'window') {
  if (!useStore.getState().movie) return;
  play(false);
  useStore.setState({ presenting: how });
}

/** Opens the speaker view: a native window in the app, a browser window otherwise. */
export async function openSpeakerView() {
  const native = await api.openSpeakerWindow().catch(() => false);
  if (!native) window.open('/#speaker', 'kino-speaker', 'width=1100,height=720');
}

/**
 * Presentation (slides) mode: each click / space plays exactly one transition
 * (a step or a `then` sub-step) and then waits. Holds, waits and narration
 * pauses are skipped, and narration isn't played. Links jump to their slide;
 * `s` opens the speaker view, which follows along.
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
    let counterTimer = 0;
    let current: 'fullscreen' | 'window' = mode;
    let stopped = false;

    const flash = () => {
      counter.current!.classList.add('show');
      clearTimeout(counterTimer);
      counterTimer = window.setTimeout(() => counter.current?.classList.remove('show'), 1200);
    };
    const deck: Deck = new Deck(movie, {
      draw: (svg) => {
        stage.current!.innerHTML = svg;
        counter.current!.textContent = deck.counter();
      },
      moved: () => {
        flash();
        broadcast(EVENT_PRESENT_SHOW, deck.speaker()).catch(() => {});
      },
    }, window, movie().beatAt(useStore.getState().time));

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
      deck.stop();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      const m = movie();
      broadcast(EVENT_PRESENT_SHOW, null).catch(() => {});
      // leave the studio on the slide we were showing
      useStore.setState({ presenting: null });
      seek(deck.beat > 0 ? m.beats[Math.min(deck.beat, m.beats.length) - 1].end : 0);
    };

    const onKey = (e: KeyboardEvent) => {
      if (deck.key(e)) {
        /* navigation */
      } else if (e.key === 'Escape') stop();
      else if (e.key === 'f') setMode(current === 'fullscreen' ? 'window' : 'fullscreen');
      else if (e.key === 's') openSpeakerView();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onClick = (e: MouseEvent) => deck.click(e);
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      deck.back();
    };
    // leaving fullscreen (Esc) ends a fullscreen presentation; switching with `f` doesn't
    const onFullscreen = () => !document.fullscreenElement && current === 'fullscreen' && stop();
    // the speaker view drives the deck too, and asks for the state when it opens
    const offCmd = on<DeckCommand | 'hello'>(EVENT_PRESENT_CMD, (c) => {
      if (c === 'hello') broadcast(EVENT_PRESENT_SHOW, deck.speaker()).catch(() => {});
      else deck.command(c);
    });

    el.addEventListener('click', onClick);
    el.addEventListener('contextmenu', onContext);
    el.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    // the script may change while presenting (the agent keeps working)
    const unsub = useStore.subscribe((s, prev) => {
      if (s.movie && s.movie !== prev.movie) deck.refresh();
    });
    deck.goTo(deck.beat);
    setMode(mode);
    return () => {
      stopped = true;
      deck.stop();
      el.removeEventListener('click', onClick);
      el.removeEventListener('contextmenu', onContext);
      el.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      offCmd();
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
