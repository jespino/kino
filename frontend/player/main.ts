// The presentation inside an exported HTML file: the engine plus the script
// and its assets (embedded by exportHtml), compiled on load and shown as
// slides, like the studio's Present mode: each click or space plays one
// transition and then waits. Bundled into a single IIFE by the
// `virtual:kino-player` Vite plugin (vite.config.ts).
import { compile, type ImageAsset, type Movie, type NarrationAudio, type ProjectVoice } from '../../src/index.ts';
import { customWidgets } from '../widgets.ts';

/** What exportHtml embeds as JSON next to the player. */
export interface PlayerData {
  title: string;
  source: string;
  theme?: string;
  voice?: ProjectVoice;
  /** narration clip durations by request id, so timings match the studio */
  narration: Record<string, number>;
  emoji: Record<string, string>;
  images: Record<string, ImageAsset>;
}

const CSS = `
html,body{margin:0;height:100%;background:#000;overflow:hidden}
.kp{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;outline:none;cursor:pointer}
.kp-stage{line-height:0}
.kp-stage svg{display:block;width:100%;height:100%}
.kp-counter{position:fixed;right:16px;bottom:16px;padding:3px 10px;border-radius:12px;background:#000a;color:#fff;font:13px system-ui,sans-serif;opacity:0;transition:opacity .3s;pointer-events:none}
.kp-counter.show{opacity:1}
.kp-error{margin:20px;color:#ff8a8a;font:14px system-ui,sans-serif;white-space:pre-wrap}
`;

function el(cls: string, parent: HTMLElement, text = ''): HTMLDivElement {
  const e = document.createElement('div');
  e.className = cls;
  e.textContent = text;
  parent.append(e);
  return e;
}

function start() {
  const data = JSON.parse(document.getElementById('kino-data')!.textContent!) as PlayerData;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);

  let movie: Movie;
  try {
    movie = compile(data.source, {
      theme: data.theme,
      voice: data.voice,
      widgets: customWidgets,
      narration: (r): NarrationAudio | undefined => (r.id in data.narration ? { duration: data.narration[r.id] } : undefined),
      emoji: (e) => data.emoji[e],
      images: (src) => data.images[src],
    });
  } catch (e) {
    el('kp-error', document.body, `Could not load the presentation: ${e instanceof Error ? e.message : e}`);
    return;
  }
  const { width, height } = movie.video;

  const root = el('kp', document.body);
  root.tabIndex = -1;
  const stage = el('kp-stage', root);
  const counter = el('kp-counter', root);

  // fit the slides into the window, keeping their aspect ratio
  const fit = () => {
    const s = Math.min(root.clientWidth / width, root.clientHeight / height);
    stage.style.width = `${width * s}px`;
    stage.style.height = `${height * s}px`;
  };
  new ResizeObserver(fit).observe(root);

  // beats already applied at time 0 (an opening frame that appears instantly)
  // show the same picture as no beats: start after them, so the first click moves on
  const first = movie.beatAt(0);
  let beat = first;
  /** performance.now() when the transition into beat+1 started, while it plays */
  let animStart: number | null = null;
  /** the pending animation frame of the running transition */
  let raf = 0;
  let counterTimer = 0;

  const draw = () => {
    const elapsed = animStart === null ? 0 : performance.now() - animStart;
    stage.innerHTML = movie.slideSvgAt(Math.min(beat, movie.beats.length), elapsed);
    counter.textContent = `${beat - first} / ${movie.beats.length - first}`;
  };
  const flash = () => {
    counter.classList.add('show');
    clearTimeout(counterTimer);
    counterTimer = window.setTimeout(() => counter.classList.remove('show'), 1200);
  };
  const finishBeat = () => {
    animStart = null;
    beat = Math.min(beat + 1, movie.beats.length);
    draw();
  };
  const tick = () => {
    if (animStart === null) return;
    const b = movie.beats[beat];
    if (!b || performance.now() - animStart >= b.end - b.start) return finishBeat();
    draw();
    raf = requestAnimationFrame(tick);
  };
  const advance = () => {
    // a click during a transition completes it and starts the next one
    if (animStart !== null) finishBeat();
    if (beat >= movie.beats.length) return flash();
    const b = movie.beats[beat];
    if (b.end <= b.start) return finishBeat(); // cut
    animStart = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  };
  const goTo = (n: number) => {
    animStart = null;
    beat = Math.max(first, Math.min(n, movie.beats.length));
    draw();
    flash();
  };
  /** beat count at the end of the next/previous step (`then` sub-steps are skipped over) */
  const chapterBeat = (dir: 1 | -1) => {
    const beats = movie.beats;
    const ends = [0];
    for (let k = 1; k <= beats.length; k++) if (k === beats.length || beats[k].chapter !== beats[k - 1].chapter) ends.push(k);
    return dir > 0 ? (ends.find((k) => k > beat) ?? beats.length) : (ends.filter((k) => k < beat).pop() ?? 0);
  };
  const toggleFullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen()).catch(() => {});

  root.onclick = advance;
  root.oncontextmenu = (e) => {
    e.preventDefault();
    goTo(beat - 1);
  };
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if ([' ', 'ArrowRight', 'ArrowDown', 'PageDown', 'Enter', 'n'].includes(k)) advance();
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) goTo(animStart !== null ? beat : beat - 1);
    else if (k === 'Home') goTo(first);
    else if (k === 'End') goTo(movie.beats.length);
    else if (k === ']') goTo(chapterBeat(1));
    else if (k === '[') goTo(chapterBeat(-1));
    else if (k === 'f') toggleFullscreen();
    else return;
    e.preventDefault();
  });

  fit();
  // deep link: #slide=3 opens on slide 3 (as the counter numbers them)
  goTo(first + (+(new URLSearchParams(location.hash.slice(1)).get('slide') ?? 0) || 0));
  root.focus();
}

start();
