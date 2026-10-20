import { collectNarration, compile, KinoError, spokenText, themes, type Movie, type NarrationRequest } from '../src/index.ts';
import { exportMp4 } from './export.ts';
import { customWidgets } from './widgets.ts';
import { loadFonts } from './fonts.ts';
import { Narration } from './narration.ts';
import { preloadEmoji, studioEmoji } from './emoji.ts';
import { inlineImages, preloadImages, studioImages } from './images.ts';

const examples = import.meta.glob('../examples/*.kino', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const source = $<HTMLTextAreaElement>('source');
const errorBox = $<HTMLDivElement>('error');
const stage = $<HTMLDivElement>('stage');
const scrub = $<HTMLInputElement>('scrub');
const timeLabel = $<HTMLSpanElement>('time');
const playBtn = $<HTMLButtonElement>('play');
const chaptersEl = $<HTMLOListElement>('chapters');
const markers = $<HTMLDivElement>('markers');
const speedSel = $<HTMLSelectElement>('speed');
const exampleSel = $<HTMLSelectElement>('examples');
const progress = $<HTMLDivElement>('progress');
const subtitle = $<HTMLDivElement>('subtitle');
const voiceStatus = $<HTMLSpanElement>('voice-status');
const themeSel = $<HTMLSelectElement>('theme');

let movie: Movie | null = null;
let time = 0;
let playing = false;
let preparing = false;
// playback clock: timeline time `baseTime` at audio-context time `baseCtx`
let baseTime = 0;
let baseCtx = 0;
const narration = new Narration();

const STORAGE_KEY = 'kino:source';
const THEME_KEY = 'kino:theme';
// the example the editor was loaded from, and its text at that moment: if the
// editor still matches it, a newer version of the file on disk replaces it
const EXAMPLE_KEY = 'kino:example';
const PRISTINE_KEY = 'kino:pristine';

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

// ---- theme ----
themeSel.innerHTML += Object.keys(themes).map((t) => `<option value="${t}">Theme: ${t}</option>`).join('');
try {
  themeSel.value = localStorage.getItem(THEME_KEY) ?? '';
} catch {}
themeSel.onchange = () => {
  try {
    localStorage.setItem(THEME_KEY, themeSel.value);
  } catch {}
  rebuild();
};

// ---- examples ----
const names = Object.keys(examples).sort();
exampleSel.innerHTML = `<option value="">Examples…</option>` + names.map((n) => `<option value="${n}">${n.split('/').pop()}</option>`).join('');
exampleSel.onchange = () => {
  if (!exampleSel.value) return;
  source.value = examples[exampleSel.value];
  store.set(EXAMPLE_KEY, exampleSel.value);
  store.set(PRISTINE_KEY, source.value);
  exampleSel.value = '';
  time = 0;
  rebuild();
  play(true);
};

// ---- compile & render ----
function rebuild() {
  try {
    localStorage.setItem(STORAGE_KEY, source.value);
  } catch {}
  try {
    // learn which clips are cached already, so timings use real durations
    let reqs: NarrationRequest[] = [];
    try {
      reqs = collectNarration(source.value);
    } catch {}
    narration.check(reqs).then((learned) => learned && rebuild());
    preloadEmoji(source.value).then((arrived) => arrived && rebuild());
    preloadImages(source.value).then((arrived) => arrived && rebuild());
    movie = compile(source.value, { theme: themeSel.value || undefined, widgets: customWidgets, narration: narration.lookup, emoji: studioEmoji, images: studioImages });
    errorBox.hidden = true;
    renderChapters();
    time = Math.min(time, movie.duration);
    updateVoiceStatus();
    if (playing) resync();
    draw();
    if (presenting) {
      beat = Math.min(beat, movie.beats.length);
      drawSlide();
    }
  } catch (e) {
    errorBox.hidden = false;
    errorBox.textContent = e instanceof Error ? e.message : String(e);
    errorBox.dataset.line = e instanceof KinoError && e.pos ? String(e.pos.line) : '';
    if (!(e instanceof KinoError)) console.error(e);
  }
}

function draw() {
  if (!movie) return;
  stage.innerHTML = movie.svgAt(time);
  scrub.value = String(movie.duration ? (time / movie.duration) * 1000 : 0);
  timeLabel.textContent = `${(time / 1000).toFixed(1)} / ${(movie.duration / 1000).toFixed(1)}s`;
  const idx = currentChapter();
  [...chaptersEl.children].forEach((li, i) => li.classList.toggle('active', i === idx));
  const clip = movie.narrationAt(time);
  subtitle.textContent = clip ? spokenText(clip.request.text) : '';
  subtitle.classList.toggle('estimated', !!clip && !clip.ready);
}

function updateVoiceStatus() {
  if (!movie) return;
  const ids = new Set(movie.narration.map((c) => c.request.id));
  const ready = new Set(movie.narration.filter((c) => c.ready).map((c) => c.request.id));
  voiceStatus.hidden = ids.size === 0;
  voiceStatus.textContent = ready.size === ids.size ? `🔊 ${ids.size} clip${ids.size === 1 ? '' : 's'}` : `🔈 ${ready.size}/${ids.size} clips generated`;
  voiceStatus.title = ready.size === ids.size ? 'All narration is cached' : 'Missing clips are generated when you press play (timings are estimated until then)';
}

/** Generate missing narration (with progress), recompile with real durations, decode audio. */
async function prepareAudio(): Promise<boolean> {
  if (!movie) return false;
  const missing = [...new Map(movie.narration.filter((c) => !c.ready).map((c) => [c.request.id, c.request])).values()];
  if (missing.length) {
    progress.hidden = false;
    try {
      await narration.generate(missing, (i, n, r) => {
        progress.textContent = `Generating narration ${i + 1}/${n}: “${r.text.slice(0, 60)}${r.text.length > 60 ? '…' : ''}”`;
      });
      progress.hidden = true;
    } catch (e) {
      progress.textContent = `Narration unavailable: ${e instanceof Error ? e.message : e}`;
      return false;
    } finally {
      rebuild();
    }
  }
  await narration.load(movie!);
  return true;
}

function currentChapter(): number {
  if (!movie) return -1;
  let idx = 0;
  movie.chapters.forEach((c, i) => {
    if (c.time <= time + 1) idx = i;
  });
  return idx;
}

function renderChapters() {
  if (!movie) return;
  const m = movie;
  chaptersEl.innerHTML = '';
  markers.innerHTML = '';
  m.chapters.forEach((c) => {
    const li = document.createElement('li');
    li.textContent = c.name;
    li.title = `line ${c.line} · ${(c.time / 1000).toFixed(1)}s`;
    li.onclick = () => seek(c.time);
    chaptersEl.appendChild(li);
    const mk = document.createElement('span');
    mk.style.left = `${(c.time / (m.duration || 1)) * 100}%`;
    markers.appendChild(mk);
  });
}

// ---- playback ----
async function play(on = !playing) {
  if (!on) {
    playing = false;
    narration.stop();
    playBtn.textContent = '▶';
    return;
  }
  if (!movie || preparing) return;
  narration.audio().resume(); // inside the user gesture
  preparing = true;
  playBtn.textContent = '⏳';
  try {
    await prepareAudio();
  } finally {
    preparing = false;
  }
  if (!movie) return;
  if (time >= movie.duration) time = 0;
  playing = true;
  playBtn.textContent = '⏸';
  resync();
  requestAnimationFrame(tick);
}

/** restart the clock and the audio at the current time (after seek, speed change, recompile) */
function resync() {
  if (!movie) return;
  baseTime = time;
  baseCtx = narration.audio().currentTime;
  narration.start(movie, time, Number(speedSel.value));
}

function tick() {
  if (!playing || !movie) return;
  time = baseTime + (narration.audio().currentTime - baseCtx) * 1000 * Number(speedSel.value);
  if (time >= movie.duration) {
    time = movie.duration;
    play(false);
  }
  draw();
  if (playing) requestAnimationFrame(tick);
}

function seek(t: number) {
  time = Math.max(0, Math.min(t, movie?.duration ?? 0));
  if (playing) resync();
  draw();
}
speedSel.onchange = () => playing && resync();

function jump(dir: 1 | -1) {
  if (!movie) return;
  const idx = currentChapter();
  const chapters = movie.chapters;
  // "previous" goes to the start of the current step if we're past it
  const target = dir < 0 ? (time - chapters[idx].time > 300 ? idx : idx - 1) : idx + 1;
  if (target < 0) return seek(0);
  if (target >= chapters.length) return seek(movie.duration);
  seek(chapters[target].time);
}

playBtn.onclick = () => play();
$('prev').onclick = () => jump(-1);
$('next').onclick = () => jump(1);
scrub.oninput = () => {
  play(false);
  seek((Number(scrub.value) / 1000) * (movie?.duration ?? 0));
};

document.addEventListener('keydown', (e) => {
  if (e.target === source || presenting) return;
  if (e.key === ' ') {
    e.preventDefault();
    play();
  } else if (e.key === 'ArrowRight') jump(1);
  else if (e.key === 'ArrowLeft') jump(-1);
});

// ---- presentation (slides) mode ----
// Each click / space plays exactly one transition (a step or a `then` sub-step)
// and then waits. Holds, waits and narration pauses are skipped.
const slides = $<HTMLDivElement>('slides');
const slideStage = $<HTMLDivElement>('slide-stage');
const slideCounter = $<HTMLDivElement>('slide-counter');
let presenting = false;
let beat = 0;
/** start time (performance.now) of the transition into beat+1, while it plays */
let animStart: number | null = null;
let counterTimer = 0;

function drawSlide() {
  if (!movie) return;
  const elapsed = animStart === null ? 0 : performance.now() - animStart;
  slideStage.innerHTML = movie.slideSvgAt(beat, elapsed);
  slideCounter.textContent = `${beat} / ${movie.beats.length}`;
}

function slideTick() {
  if (!presenting || animStart === null || !movie) return;
  const b = movie.beats[beat];
  if (!b || performance.now() - animStart >= b.end - b.start) return finishBeat();
  drawSlide();
  requestAnimationFrame(slideTick);
}

function finishBeat() {
  animStart = null;
  beat = Math.min(beat + 1, movie?.beats.length ?? 0);
  drawSlide();
}

function advance() {
  if (!movie) return;
  // a click during a transition completes it
  if (animStart !== null) return finishBeat();
  if (beat >= movie.beats.length) return flashCounter();
  const b = movie.beats[beat];
  if (b.end <= b.start) return finishBeat(); // cut
  animStart = performance.now();
  requestAnimationFrame(slideTick);
}

function goToBeat(n: number) {
  if (!movie) return;
  animStart = null;
  beat = Math.max(0, Math.min(n, movie.beats.length));
  drawSlide();
  flashCounter();
}

/** beat count at the end of the next/previous step (`then` sub-steps are skipped over) */
function chapterBeat(dir: 1 | -1): number {
  if (!movie) return 0;
  const beats = movie.beats;
  const ends = [0];
  for (let k = 1; k <= beats.length; k++) if (k === beats.length || beats[k].chapter !== beats[k - 1].chapter) ends.push(k);
  return dir > 0 ? ends.find((k) => k > beat) ?? beats.length : ends.filter((k) => k < beat).pop() ?? 0;
}

function flashCounter() {
  slideCounter.classList.add('show');
  clearTimeout(counterTimer);
  counterTimer = window.setTimeout(() => slideCounter.classList.remove('show'), 1200);
}

/** `fullscreen` takes over the screen; `window` fills the browser window only */
let mode: 'fullscreen' | 'window' = 'fullscreen';

async function present(how: 'fullscreen' | 'window') {
  if (!movie) return;
  play(false);
  presenting = true;
  animStart = null;
  beat = movie.beatAt(time);
  slides.hidden = false;
  slides.focus();
  drawSlide();
  flashCounter();
  await setMode(how);
}

async function setMode(how: 'fullscreen' | 'window') {
  mode = how;
  if (how === 'fullscreen' && !document.fullscreenElement) {
    try {
      await slides.requestFullscreen();
    } catch {
      mode = 'window'; // fullscreen refused (e.g. not allowed here): stay in the window
    }
  } else if (how === 'window' && document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
  }
  slides.focus();
}

function stopPresenting() {
  if (!presenting) return;
  presenting = false;
  animStart = null;
  slides.hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  // leave the studio on the slide we were showing
  if (movie) seek(beat > 0 ? movie.beats[beat - 1].end : 0);
}

$('present').onclick = () => present('fullscreen');
$('present-window').onclick = () => present('window');
slides.onclick = advance;
slides.oncontextmenu = (e) => {
  e.preventDefault();
  goToBeat(beat - 1);
};
document.addEventListener('fullscreenchange', () => {
  // leaving fullscreen (Esc) ends a fullscreen presentation; switching with `f` doesn't
  if (!document.fullscreenElement && mode === 'fullscreen') stopPresenting();
});
slides.addEventListener('keydown', (e) => {
  if (!movie) return;
  const k = e.key;
  if ([' ', 'ArrowRight', 'ArrowDown', 'PageDown', 'Enter', 'n'].includes(k)) advance();
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(k)) goToBeat(animStart !== null ? beat : beat - 1);
  else if (k === 'Home') goToBeat(0);
  else if (k === 'End') goToBeat(movie.beats.length);
  else if (k === ']') goToBeat(chapterBeat(1));
  else if (k === '[') goToBeat(chapterBeat(-1));
  else if (k === 'Escape') stopPresenting();
  else if (k === 'f') setMode(mode === 'fullscreen' ? 'window' : 'fullscreen');
  else return;
  e.preventDefault();
});

// ---- editor ----
let timer = 0;
source.addEventListener('input', () => {
  clearTimeout(timer);
  timer = window.setTimeout(rebuild, 250);
});
source.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    source.setRangeText('  ', source.selectionStart, source.selectionEnd, 'end');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    // play from the step under the cursor
    rebuild();
    if (!movie) return;
    const line = source.value.slice(0, source.selectionStart).split('\n').length;
    const ch = [...movie.chapters].reverse().find((c) => c.line <= line);
    seek(ch ? ch.time : 0);
    play(true);
  }
});
errorBox.onclick = () => {
  const line = Number(errorBox.dataset.line);
  if (!line) return;
  const lines = source.value.split('\n');
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  source.focus();
  source.setSelectionRange(start, start + lines[line - 1].length);
};

// ---- export ----
/** The movie with pictures embedded as data: URIs (the preview uses blob: URLs, which exported files can't load). */
function selfContained(): Movie {
  return compile(source.value, { theme: themeSel.value || undefined, widgets: customWidgets, narration: narration.lookup, emoji: studioEmoji, images: inlineImages });
}

$('export-svg').onclick = () => {
  if (!movie) return;
  download(new Blob([selfContained().svgAt(time)], { type: 'image/svg+xml' }), `frame-${Math.round(time)}ms.svg`);
};
$<HTMLButtonElement>('export-mp4').onclick = async (ev) => {
  if (!movie) return;
  const btn = ev.currentTarget as HTMLButtonElement;
  btn.disabled = true;
  play(false);
  progress.hidden = false;
  try {
    const withVoice = await prepareAudio();
    progress.hidden = false;
    progress.textContent = 'Mixing narration…';
    const audio = withVoice ? await narration.mix(movie) : null;
    const blob = await exportMp4(selfContained(), (done, total) => (progress.textContent = `Rendering frame ${done}/${total}…`), audio);
    download(blob, 'kino.mp4');
    progress.textContent = withVoice || !movie.narration.length ? 'Done.' : 'Done (without narration: TTS unavailable).';
  } catch (e) {
    progress.textContent = `Export failed: ${e instanceof Error ? e.message : e}. Try the CLI: npm run render -- file.kino`;
  } finally {
    btn.disabled = false;
  }
};

function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- boot ----
const saved = store.get(STORAGE_KEY);
const fromExample = store.get(EXAMPLE_KEY);
const current = fromExample ? examples[fromExample] : undefined;
if (saved && current !== undefined && saved === store.get(PRISTINE_KEY) && saved !== current) {
  // unedited copy of an example that changed on disk: take the new version
  source.value = current;
  store.set(PRISTINE_KEY, current);
} else source.value = saved || examples['../examples/registers.kino'] || '';
rebuild();
// redraw once the bundled fonts are in (the first frame may use fallbacks)
loadFonts().then(draw, (e) => console.warn('could not load fonts', e));
