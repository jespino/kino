import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { contactSheetSvg, sheetLayout, type Movie } from '../src/index.ts';
import { buildPdf, type PdfPage } from '../src/pdf.ts';
import { embeddedFontStyle } from './fonts.ts';
import type { PlayerData } from './player/main.ts';
import playerScript from 'virtual:kino-player';

/** `<style>` embedding every font the movie's theme uses (an SVG drawn into a canvas can't see page fonts). */
function themeFonts(movie: Movie): Promise<string> {
  const th = movie.video.theme;
  return embeddedFontStyle([th.fontSans, th.fontMono, th.fontCaption, th.fontTitle, th.fontCode].filter(Boolean));
}

/** Draw an SVG document onto the whole canvas. */
async function drawSvg(ctx: CanvasRenderingContext2D, svg: string) {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.src = url;
  try {
    await img.decode();
    ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A contact sheet: every page as a labeled tile (see contactSheetSvg), as a PNG.
 * `stale()` is checked between pages, so a newer compile can abandon it.
 */
export async function exportSheet(movie: Movie, stale: () => boolean = () => false): Promise<Blob | null> {
  const layout = sheetLayout(movie);
  const canvas = document.createElement('canvas');
  canvas.width = layout.tileWidth;
  canvas.height = Math.round((layout.tileWidth * movie.video.height) / movie.video.width);
  const ctx = canvas.getContext('2d')!;
  const fonts = await themeFonts(movie);
  const tiles: string[] = [];
  for (const p of layout.pages) {
    if (stale()) return null;
    await drawSvg(ctx, movie.pageSvg(p, fonts));
    tiles.push(canvas.toDataURL('image/jpeg', 0.85));
  }
  const sheet = contactSheetSvg(movie, layout, tiles);
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  await drawSvg(ctx, sheet.svg);
  return new Promise((ok) => canvas.toBlob(ok, 'image/png'));
}

/**
 * The slides as a PDF: a page per step and `then` sub-step (what Present mode
 * stops on), rendered at `scale`× the video size. Pages are JPEGs, so
 * paper-textured themes stay small.
 */
export async function exportPdf(movie: Movie, title: string, onProgress: (done: number, total: number) => void, scale = 2): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(movie.video.width * scale);
  canvas.height = Math.round(movie.video.height * scale);
  const ctx = canvas.getContext('2d')!;
  const fonts = await themeFonts(movie);
  const pages = movie.pages();
  const out: PdfPage[] = [];
  for (const [i, p] of pages.entries()) {
    onProgress(i, pages.length);
    await drawSvg(ctx, movie.pageSvg(p, fonts));
    const jpeg = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.92));
    if (!jpeg) throw new Error('could not encode the page');
    out.push({ image: new Uint8Array(await jpeg.arrayBuffer()), type: 'jpeg' });
  }
  onProgress(pages.length, pages.length);
  const pdf = await buildPdf(out, { title, width: movie.video.width, height: movie.video.height });
  return new Blob([pdf as BlobPart], { type: 'application/pdf' });
}

/** Render every frame deterministically and encode to MP4 with WebCodecs (+ the mixed narration, if any). */
export async function exportMp4(movie: Movie, onProgress: (done: number, total: number) => void, audio: AudioBuffer | null = null, bitrate = 8_000_000): Promise<Blob> {
  if (typeof VideoEncoder === 'undefined') throw new Error('WebCodecs is not available in this browser');
  const { width, height, fps } = movie.video;
  const w = width & ~1;
  const h = height & ~1;

  let codec = 'avc1.640028';
  const support = await VideoEncoder.isConfigSupported({ codec, width: w, height: h });
  if (!support.supported) codec = 'avc1.42001f';

  if (audio && (typeof AudioEncoder === 'undefined' || !(await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: audio.sampleRate, numberOfChannels: 2 })).supported)) {
    console.warn('Opus encoding not supported here; exporting without narration');
    audio = null;
  }
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: w, height: h },
    audio: audio ? { codec: 'opus', numberOfChannels: 2, sampleRate: audio.sampleRate } : undefined,
    fastStart: 'in-memory',
  });
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  encoder.configure({ codec, width: w, height: h, bitrate, framerate: fps });

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const total = Math.ceil((movie.duration / 1000) * fps);
  const fonts = await themeFonts(movie);

  for (let i = 0; i < total; i++) {
    if (failure) throw failure;
    await drawSvg(ctx, movie.svgAt((i / fps) * 1000, fonts));
    const frame = new VideoFrame(canvas, { timestamp: (i * 1e6) / fps, duration: 1e6 / fps });
    encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    // keep the encoder queue bounded
    while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
    if (i % 10 === 0) onProgress(i, total);
  }
  await encoder.flush();
  if (failure) throw failure;
  if (audio) await encodeAudio(audio, muxer);
  muxer.finalize();
  onProgress(total, total);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

async function encodeAudio(buf: AudioBuffer, muxer: Muxer<ArrayBufferTarget>) {
  let failure: unknown = null;
  const enc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (failure = e) });
  enc.configure({ codec: 'opus', sampleRate: buf.sampleRate, numberOfChannels: 2, bitrate: 128_000 });
  const left = buf.getChannelData(0);
  const right = buf.numberOfChannels > 1 ? buf.getChannelData(1) : left;
  const CHUNK = 4800; // 100ms at 48kHz
  for (let i = 0; i < buf.length; i += CHUNK) {
    const n = Math.min(CHUNK, buf.length - i);
    const planes = new Float32Array(n * 2);
    planes.set(left.subarray(i, i + n), 0);
    planes.set(right.subarray(i, i + n), n);
    const data = new AudioData({ format: 'f32-planar', sampleRate: buf.sampleRate, numberOfFrames: n, numberOfChannels: 2, timestamp: (i / buf.sampleRate) * 1e6, data: planes });
    enc.encode(data);
    data.close();
  }
  await enc.flush();
  if (failure) throw failure;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The slides as a single self-contained HTML file, presented like Present
 * mode: the engine and a small player, the script, the theme's fonts,
 * pictures and emoji, all inline.
 */
export async function exportHtml(movie: Movie, data: PlayerData): Promise<Blob> {
  // `<` escaped so the JSON can't close its <script> (or open a comment)
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="kino">
<title>${escapeHtml(data.title)}</title>
${await themeFonts(movie)}
<script type="application/json" id="kino-data">${json}</script>
</head>
<body>
<script>${playerScript.replace(/<\/script/gi, '<\\/script')}</script>
</body>
</html>
`;
  return new Blob([html], { type: 'text/html' });
}
