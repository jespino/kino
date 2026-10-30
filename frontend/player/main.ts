// The presentation inside an exported HTML file: the engine plus the script
// and its assets (embedded by exportHtml), compiled on load and shown as
// slides, like the studio's Present mode: each click or space plays one
// transition and then waits. Bundled into a single IIFE by the
// `virtual:kino-player` Vite plugin (vite.config.ts).
import { compile, type ImageAsset, type Movie, type NarrationAudio, type ProjectVoice } from '../../src/index.ts';
import { customWidgets } from '../widgets.ts';
import { Deck, SpeakerView } from '../present.ts';

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
.kp-stage svg *{pointer-events:none}
.kp-stage svg [data-link]{pointer-events:auto;cursor:pointer}
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

  // speaker view: a popup this window draws into (no second copy of the deck)
  let speaker: { win: Window; view: SpeakerView } | null = null;
  const openSpeaker = () => {
    if (speaker && !speaker.win.closed) return speaker.win.focus();
    const win = window.open('', 'kino-speaker', 'width=1100,height=720');
    if (!win) return;
    win.document.body.innerHTML = '';
    // the slides need the embedded fonts there too
    for (const st of document.head.querySelectorAll('style')) if (st.textContent?.includes('@font-face')) win.document.head.append(win.document.importNode(st, true));
    const view = new SpeakerView(win.document.body, (c) => deck.command(c));
    speaker = { win, view };
    view.show(deck.speaker());
  };

  const deck: Deck = new Deck(() => movie, {
    draw: (svg) => {
      stage.innerHTML = svg;
      counter.textContent = deck.counter();
    },
    moved: () => {
      counter.classList.add('show');
      clearTimeout(counterTimer);
      counterTimer = window.setTimeout(() => counter.classList.remove('show'), 1200);
      if (speaker && !speaker.win.closed) speaker.view.show(deck.speaker());
    },
  });
  let counterTimer = 0;
  const toggleFullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen()).catch(() => {});

  root.onclick = (e) => deck.click(e);
  root.oncontextmenu = (e) => {
    e.preventDefault();
    deck.back();
  };
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (deck.key(e)) {
      /* navigation */
    } else if (e.key === 'f') toggleFullscreen();
    else if (e.key === 's') openSpeaker();
    else return;
    e.preventDefault();
  });

  fit();
  // deep link: #slide=3 opens on slide 3 (as the counter numbers them)
  deck.goTo(deck.first + (+(new URLSearchParams(location.hash.slice(1)).get('slide') ?? 0) || 0));
  root.focus();
}

start();
