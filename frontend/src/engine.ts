// Compiling, saving and playing the open script. React components read the
// results from the store; everything here runs outside React.
import { collectNarration, compile, KinoError, type Movie, type NarrationRequest, type ProjectVoice } from '../kino.ts';
import { exportMp4, exportPdf } from '../export.ts';
import { customWidgets } from '../widgets.ts';
import { Narration } from '../narration.ts';
import { preloadEmoji, studioEmoji } from '../emoji.ts';
import { inlineImages, preloadImages, studioImages } from '../images.ts';
import { api, errorText, isWails, type Status } from './api.ts';
import { useStore } from './store.ts';

export const narration = new Narration();
const st = useStore.getState;

// ---- compile ---------------------------------------------------------------

/** The project's voice settings (kino.json) and Kino's default provider. */
export function projectVoice(): ProjectVoice {
  const tts = st().project?.settings?.tts ?? {};
  return { settings: { ...tts.voice, provider: tts.provider }, defaultProvider: st().settings?.settings.tts.provider };
}

let statusTimer = 0;

/** Compile the current source; on errors the last good movie keeps playing. */
export function rebuild() {
  const { source, theme } = st();
  let reqs: NarrationRequest[] = [];
  try {
    reqs = collectNarration(source, projectVoice());
  } catch {
    /* reported by compile below */
  }
  // learn which clips are cached, so timings use real durations
  narration.check(reqs).then((learned) => learned && rebuild());
  preloadEmoji(source).then((arrived) => arrived && rebuild());
  preloadImages(source).then((arrived) => arrived && rebuild());
  try {
    const movie = compile(source, { theme: theme || undefined, voice: projectVoice(), widgets: customWidgets, narration: narration.lookup, emoji: studioEmoji, images: studioImages });
    useStore.setState((s) => ({ movie, error: null, time: Math.min(s.time, movie.duration) }));
    if (st().playing) resync();
  } catch (e) {
    if (!(e instanceof KinoError)) console.error(e);
    const message = errorText(e).replace(/^\d+:\d+: /, '');
    useStore.setState({ error: e instanceof KinoError && e.pos ? { message, line: e.pos.line, col: e.pos.col } : { message } });
  }
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => reportStatus(source), 300);
}

/** .kino/status.json, for the agent in the terminal panel */
function reportStatus(source: string) {
  const { project, movie, error } = st();
  if (!project || st().source !== source) return;
  const status: Status = error
    ? { ok: false, error: { line: error.line ?? 0, col: error.col ?? 0, message: error.message }, duration: 0 }
    : {
        ok: true,
        duration: movie?.duration ?? 0,
        steps: movie?.timeline.steps.map(({ kind, name, start, end, line }) => ({ kind, name, start, end, line })),
        narration: movie ? { clips: new Set(movie.narration.map((c) => c.request.id)).size, missing: new Set(movie.narration.filter((c) => !c.ready).map((c) => c.request.id)).size } : undefined,
      };
  api.reportStatus(source, status).catch(() => {});
}

let saveTimer = 0;
let rebuildTimer = 0;

/** The editor changed the script: recompile soon, save to disk a bit later. */
export function editSource(text: string) {
  st().setSource(text);
  window.clearTimeout(rebuildTimer);
  rebuildTimer = window.setTimeout(rebuild, 200);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    api.saveSource(text).catch((e) => st().showToast(`Could not save: ${errorText(e)}`));
  }, 400);
}

/** The script was replaced from outside the editor (disk change, another project). */
export function replaceSource(text: string) {
  window.clearTimeout(saveTimer);
  st().setSource(text, true);
  rebuild();
}

// ---- playback --------------------------------------------------------------

// playback clock: timeline time `baseTime` at audio-context time `baseCtx`
let baseTime = 0;
let baseCtx = 0;

export async function play(on = !st().playing) {
  const s = st();
  if (!on) {
    narration.stop();
    useStore.setState({ playing: false });
    return;
  }
  if (!s.movie || s.preparing) return;
  narration.audio().resume(); // inside the user gesture
  useStore.setState({ preparing: true });
  try {
    await prepareAudio();
  } finally {
    useStore.setState({ preparing: false });
  }
  const movie = st().movie;
  if (!movie) return;
  if (st().time >= movie.duration) useStore.setState({ time: 0 });
  useStore.setState({ playing: true });
  resync();
  requestAnimationFrame(tick);
}

/** restart the clock and the audio at the current time (after seek, speed change, recompile) */
export function resync() {
  const { movie, time, speed } = st();
  if (!movie) return;
  baseTime = time;
  baseCtx = narration.audio().currentTime;
  narration.start(movie, time, speed);
}

function tick() {
  const { playing, movie, speed } = st();
  if (!playing || !movie) return;
  let time = baseTime + (narration.audio().currentTime - baseCtx) * 1000 * speed;
  if (time >= movie.duration) {
    time = movie.duration;
    useStore.setState({ time });
    play(false);
    return;
  }
  useStore.setState({ time });
  requestAnimationFrame(tick);
}

export function seek(t: number) {
  const movie = st().movie;
  useStore.setState({ time: Math.max(0, Math.min(t, movie?.duration ?? 0)) });
  if (st().playing) resync();
}

export function currentChapter(movie: Movie, time: number): number {
  let idx = 0;
  movie.chapters.forEach((c, i) => {
    if (c.time <= time + 1) idx = i;
  });
  return idx;
}

/** previous/next step ("previous" goes to the start of the current step if we're past it) */
export function jump(dir: 1 | -1) {
  const { movie, time } = st();
  if (!movie) return;
  const idx = currentChapter(movie, time);
  const chapters = movie.chapters;
  const target = dir < 0 ? (time - chapters[idx].time > 300 ? idx : idx - 1) : idx + 1;
  if (target < 0) return seek(0);
  if (target >= chapters.length) return seek(movie.duration);
  seek(chapters[target].time);
}

/** Generate missing narration (with progress), recompile with real durations, decode audio. */
async function prepareAudio(): Promise<boolean> {
  const movie = st().movie;
  if (!movie) return false;
  const missing = [...new Map(movie.narration.filter((c) => !c.ready).map((c) => [c.request.id, c.request])).values()];
  if (missing.length) {
    try {
      await narration.generate(missing, (i, n, r) => {
        st().setProgress(`Generating narration ${i + 1}/${n}: “${r.text.slice(0, 60)}${r.text.length > 60 ? '…' : ''}”`);
      });
      st().setProgress(null);
    } catch (e) {
      st().setProgress(`Narration unavailable: ${errorText(e)}`);
      return false;
    } finally {
      rebuild();
    }
  }
  await narration.load(st().movie!);
  return true;
}

// ---- export ----------------------------------------------------------------

/** The movie with pictures embedded as data: URIs (the preview uses blob: URLs, which exported files can't load). */
function selfContained(): Movie {
  const { source, theme } = st();
  return compile(source, { theme: theme || undefined, voice: projectVoice(), widgets: customWidgets, narration: narration.lookup, emoji: studioEmoji, images: inlineImages });
}

/** Save through a native dialog in the desktop app (its webview ignores <a download>), else as a browser download. */
async function saveFile(blob: Blob, name: string): Promise<boolean> {
  if (isWails || (await api.hasNativeDialogs().catch(() => false))) {
    const res = await fetch(`/__kino/save?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
    return out.saved;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return true;
}

const baseName = () => (st().project?.path.split(/[\\/]/).pop() ?? 'kino').replace(/\.kino$/, '');

export async function exportFrame() {
  const { movie, time } = st();
  if (!movie) return;
  try {
    await saveFile(new Blob([selfContained().svgAt(time)], { type: 'image/svg+xml' }), `${baseName()}-${(time / 1000).toFixed(1)}s.svg`);
  } catch (e) {
    st().showToast(`Could not save the frame: ${errorText(e)}`);
  }
}

/** The slides as a PDF: a page per step and sub-step. */
export async function exportSlides() {
  if (!st().movie) return;
  play(false);
  try {
    const scale = st().settings?.settings.export.pdfScale || 2;
    const blob = await exportPdf(selfContained(), baseName(), (done, total) => st().setProgress(done < total ? `Rendering page ${done + 1}/${total}…` : 'Saving…'), scale);
    const saved = await saveFile(blob, `${baseName()}.pdf`);
    st().setProgress(null);
    if (saved) st().showToast('PDF exported.');
  } catch (e) {
    st().setProgress(null);
    st().showToast(`PDF export failed: ${errorText(e)}`);
  }
}

export async function exportVideo() {
  if (!st().movie) return;
  play(false);
  try {
    const withVoice = await prepareAudio();
    const movie = st().movie!;
    st().setProgress('Mixing narration…');
    const audio = withVoice ? await narration.mix(movie) : null;
    const bitrate = (st().settings?.settings.export.videoBitrate || 8) * 1_000_000;
    const blob = await exportMp4(selfContained(), (done, total) => st().setProgress(`Rendering frame ${done}/${total}…`), audio, bitrate);
    st().setProgress('Saving…');
    const saved = await saveFile(blob, `${baseName()}.mp4`);
    st().setProgress(null);
    if (saved) st().showToast(withVoice || !movie.narration.length ? 'Video exported.' : 'Video exported without narration (TTS unavailable).');
  } catch (e) {
    st().setProgress(null);
    st().showToast(`Export failed: ${errorText(e)}`);
  }
}
