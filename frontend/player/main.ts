// The player inside an exported HTML file: the engine plus the script and its
// assets (embedded by exportHtml), compiled on load and drawn frame by frame,
// the same way the studio preview does it. Bundled into a single IIFE by the
// `virtual:kino-player` Vite plugin (vite.config.ts).
import { compile, spokenText, type ImageAsset, type Movie, type NarrationAudio, type ProjectVoice } from '../../src/index.ts';
import { customWidgets } from '../widgets.ts';

/** What exportHtml embeds as JSON next to the player. */
export interface PlayerData {
  title: string;
  source: string;
  theme?: string;
  voice?: ProjectVoice;
  /** narration clip durations by request id, so timings match the audio */
  narration: Record<string, number>;
  emoji: Record<string, string>;
  images: Record<string, ImageAsset>;
  /** the mixed narration track (data: URI), if any */
  audio?: string;
}

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#0b0d12;color:#e7e9ee;font:14px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;overflow:hidden}
.kp{position:fixed;inset:0;display:flex;flex-direction:column;outline:none}
.kp-view{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative;cursor:pointer}
.kp-stage{line-height:0;box-shadow:0 8px 40px #0008}
.kp-stage svg{display:block;width:100%;height:100%}
.kp-sub{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);max-width:min(90%,900px);padding:6px 14px;border-radius:6px;background:#000b;color:#fff;font-size:clamp(14px,2.2vw,22px);text-align:center;pointer-events:none}
.kp-sub:empty{display:none}
.kp-counter{position:absolute;right:16px;bottom:16px;padding:3px 10px;border-radius:12px;background:#000a;color:#fff;font-size:13px;opacity:0;transition:opacity .3s;pointer-events:none}
.kp-counter.show{opacity:1}
.kp-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;background:#14171f;border-top:1px solid #262b36;transition:opacity .3s}
.kp.idle .kp-bar{opacity:0}
.kp.idle{cursor:none}
.kp button{font:inherit;color:inherit;background:#1e2230;border:1px solid #2e3445;border-radius:6px;padding:4px 10px;cursor:pointer;min-width:34px}
.kp button:hover{border-color:#5fb8ff}
.kp button.on{background:#5fb8ff;color:#08131f;border-color:#5fb8ff}
.kp-time{font-variant-numeric:tabular-nums;color:#9aa3b5;white-space:nowrap;font-size:13px}
.kp-track{flex:1;position:relative;height:22px;display:flex;align-items:center;min-width:60px}
.kp-track input{width:100%;margin:0;accent-color:#5fb8ff;cursor:pointer}
.kp-tick{position:absolute;top:2px;width:2px;height:5px;background:#5c667c;pointer-events:none}
.kp-chapter{color:#c8cedb;max-width:28ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}
.kp-error{margin:auto;padding:20px;color:#ff8a8a;white-space:pre-wrap}
@media (max-width:640px){.kp-chapter,.kp-time{display:none}}
`;

const fmt = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
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
    el('div', 'kp-error', document.body, `Could not load the animation: ${e instanceof Error ? e.message : e}`);
    return;
  }
  const { width, height } = movie.video;

  const root = el('div', 'kp', document.body);
  root.tabIndex = -1;
  const view = el('div', 'kp-view', root);
  const stage = el('div', 'kp-stage', view);
  const sub = el('div', 'kp-sub', view);
  const counter = el('div', 'kp-counter', view);
  const bar = el('div', 'kp-bar', root);
  const prevBtn = el('button', '', bar, '⏮');
  const playBtn = el('button', '', bar, '▶');
  const nextBtn = el('button', '', bar, '⏭');
  const timeLabel = el('span', 'kp-time', bar);
  const track = el('div', 'kp-track', bar);
  const scrub = el('input', '', track);
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = String(movie.duration);
  scrub.step = 'any';
  for (const c of movie.chapters.slice(1)) el('span', 'kp-tick', track).style.left = `${(c.time / movie.duration) * 100}%`;
  const chapterLabel = el('span', 'kp-chapter', bar);
  const ccBtn = el('button', 'on', bar, 'CC');
  const slidesBtn = el('button', '', bar, 'Slides');
  const fullBtn = el('button', '', bar, '⛶');
  prevBtn.title = 'Previous step (←)';
  playBtn.title = 'Play/pause (space)';
  nextBtn.title = 'Next step (→)';
  ccBtn.title = 'Subtitles (c)';
  slidesBtn.title = 'Slides: each click or space plays one transition (s)';
  fullBtn.title = 'Fullscreen (f)';
  if (!movie.narration.length) ccBtn.style.display = 'none';

  const audio = data.audio ? new Audio(data.audio) : null;
  if (audio) audio.preload = 'auto';

  // ---- layout: fit the video into the view, keeping its aspect ratio
  const fit = () => {
    const s = Math.min(view.clientWidth / width, view.clientHeight / height);
    stage.style.width = `${width * s}px`;
    stage.style.height = `${height * s}px`;
  };
  new ResizeObserver(fit).observe(view);

  // ---- video mode ----------------------------------------------------------
  let time = 0;
  let playing = false;
  let subtitles = true;
  // clock without audio: timeline time `baseTime` at performance.now() `baseNow`
  let baseTime = 0;
  let baseNow = 0;

  const chapterAt = (t: number) => {
    let idx = 0;
    movie.chapters.forEach((c, i) => c.time <= t + 1 && (idx = i));
    return idx;
  };

  const drawVideo = () => {
    stage.innerHTML = movie.svgAt(time);
    const clip = subtitles ? movie.narrationAt(time) : undefined;
    sub.textContent = clip ? spokenText(clip.request.text) : '';
    scrub.value = String(time);
    timeLabel.textContent = `${fmt(time)} / ${fmt(movie.duration)}`;
    chapterLabel.textContent = movie.chapters[chapterAt(time)]?.name ?? '';
    playBtn.textContent = playing ? '⏸' : '▶';
  };

  const tick = () => {
    if (!playing) return;
    time = audio && !audio.ended && audio.duration ? audio.currentTime * 1000 : baseTime + performance.now() - baseNow;
    if (time >= movie.duration) {
      time = movie.duration;
      setPlaying(false);
      return;
    }
    drawVideo();
    requestAnimationFrame(tick);
  };

  function setPlaying(on: boolean) {
    if (on && time >= movie.duration) time = 0;
    playing = on;
    baseTime = time;
    baseNow = performance.now();
    if (audio) {
      if (on && time < audio.duration * 1000) {
        audio.currentTime = time / 1000;
        audio.play().catch(() => {});
      } else audio.pause();
    }
    drawVideo();
    if (on) requestAnimationFrame(tick);
  }

  const seek = (t: number) => {
    time = Math.max(0, Math.min(t, movie.duration));
    if (playing) setPlaying(true);
    else drawVideo();
  };

  /** previous/next step ("previous" goes to the start of the current step if we're past it) */
  const jump = (dir: 1 | -1) => {
    const idx = chapterAt(time);
    const target = dir < 0 ? (time - movie.chapters[idx].time > 300 ? idx : idx - 1) : idx + 1;
    if (target < 0) return seek(0);
    if (target >= movie.chapters.length) return seek(movie.duration);
    seek(movie.chapters[target].time);
  };

  // ---- slides mode: each advance plays one transition, then waits -------------
  let slides = false;
  let beat = 0;
  /** performance.now() when the transition into beat+1 started, while it plays */
  let animStart: number | null = null;
  let counterTimer = 0;

  const drawSlide = () => {
    const elapsed = animStart === null ? 0 : performance.now() - animStart;
    stage.innerHTML = movie.slideSvgAt(Math.min(beat, movie.beats.length), elapsed);
    sub.textContent = '';
    counter.textContent = `${beat} / ${movie.beats.length}`;
    chapterLabel.textContent = movie.chapters[movie.beats[Math.max(0, beat - 1)]?.chapter ?? 0]?.name ?? '';
  };
  const flash = () => {
    counter.classList.add('show');
    clearTimeout(counterTimer);
    counterTimer = window.setTimeout(() => counter.classList.remove('show'), 1200);
  };
  const finishBeat = () => {
    animStart = null;
    beat = Math.min(beat + 1, movie.beats.length);
    drawSlide();
  };
  const slideTick = () => {
    if (!slides || animStart === null) return;
    const b = movie.beats[beat];
    if (!b || performance.now() - animStart >= b.end - b.start) return finishBeat();
    drawSlide();
    requestAnimationFrame(slideTick);
  };
  const advance = () => {
    // a click during a transition completes it
    if (animStart !== null) return finishBeat();
    if (beat >= movie.beats.length) return flash();
    const b = movie.beats[beat];
    if (b.end <= b.start) return finishBeat(); // cut
    animStart = performance.now();
    requestAnimationFrame(slideTick);
  };
  const goTo = (n: number) => {
    animStart = null;
    beat = Math.max(0, Math.min(n, movie.beats.length));
    drawSlide();
    flash();
  };
  /** beat count at the end of the next/previous step (`then` sub-steps are skipped over) */
  const chapterBeat = (dir: 1 | -1) => {
    const beats = movie.beats;
    const ends = [0];
    for (let k = 1; k <= beats.length; k++) if (k === beats.length || beats[k].chapter !== beats[k - 1].chapter) ends.push(k);
    return dir > 0 ? (ends.find((k) => k > beat) ?? beats.length) : (ends.filter((k) => k < beat).pop() ?? 0);
  };

  const setSlides = (on: boolean) => {
    if (on === slides) return;
    slides = on;
    slidesBtn.classList.toggle('on', on);
    for (const e of [playBtn, timeLabel, track, ccBtn]) e.style.visibility = on ? 'hidden' : '';
    if (on) {
      setPlaying(false);
      beat = movie.beatAt(time);
      animStart = null;
      drawSlide();
      flash();
    } else {
      // continue the video from the slide we were showing
      time = beat > 0 ? movie.beats[Math.min(beat, movie.beats.length) - 1].end : 0;
      drawVideo();
    }
  };

  // ---- input ---------------------------------------------------------------
  const toggleFullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : root.requestFullscreen()).catch(() => {});
  const toggleSubtitles = () => {
    subtitles = !subtitles;
    ccBtn.classList.toggle('on', subtitles);
    if (!slides) drawVideo();
  };

  playBtn.onclick = () => setPlaying(!playing);
  prevBtn.onclick = () => (slides ? goTo(chapterBeat(-1)) : jump(-1));
  nextBtn.onclick = () => (slides ? goTo(chapterBeat(1)) : jump(1));
  ccBtn.onclick = toggleSubtitles;
  slidesBtn.onclick = () => setSlides(!slides);
  fullBtn.onclick = toggleFullscreen;
  scrub.oninput = () => seek(+scrub.value);
  view.onclick = () => (slides ? advance() : setPlaying(!playing));
  view.oncontextmenu = (e) => {
    if (!slides) return;
    e.preventDefault();
    goTo(beat - 1);
  };
  // keep the bar's buttons from swallowing the keyboard
  bar.addEventListener('click', () => root.focus());

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'f') toggleFullscreen();
    else if (k === 's') setSlides(!slides);
    else if (slides) {
      if ([' ', 'ArrowRight', 'ArrowDown', 'PageDown', 'Enter', 'n'].includes(k)) advance();
      else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) goTo(animStart !== null ? beat : beat - 1);
      else if (k === 'Home') goTo(0);
      else if (k === 'End') goTo(movie.beats.length);
      else if (k === ']') goTo(chapterBeat(1));
      else if (k === '[') goTo(chapterBeat(-1));
      else if (k === 'Escape') setSlides(false);
      else return;
    } else {
      if (k === ' ' || k === 'k') setPlaying(!playing);
      else if (k === 'ArrowRight') jump(1);
      else if (k === 'ArrowLeft') jump(-1);
      else if (k === 'Home') seek(0);
      else if (k === 'End') seek(movie.duration);
      else if (k === 'c') toggleSubtitles();
      else return;
    }
    e.preventDefault();
  });

  // hide the controls while playing and the mouse rests
  let idleTimer = 0;
  const wake = () => {
    root.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => (playing || slides) && !bar.matches(':hover') && root.classList.add('idle'), 2500);
  };
  root.addEventListener('mousemove', wake);
  window.addEventListener('keydown', wake);

  fit();
  // deep links: #t=12.5 starts at 12.5s, #slide=3 opens the slides on beat 3
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.has('slide')) {
    setSlides(true);
    goTo(+hash.get('slide')! || 0);
  } else {
    time = Math.max(0, Math.min(+(hash.get('t') ?? 0) * 1000 || 0, movie.duration));
    drawVideo();
  }
  root.focus();
}

start();
