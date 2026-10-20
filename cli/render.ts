// Render a .kino file to video (or single frames) without a browser:
//   npm run render -- examples/go-slices.kino -o out/go-slices.mp4
//   npm run render -- examples/go-slices.kino --png out/frame.png --at 3.5s
//   npm run render -- my.kino --widgets ./my-widgets.ts      (custom widgets)
//   npm run render -- my.kino --theme sketch                  (override the script's theme)
// Frames are rasterized with resvg in parallel worker threads and piped to ffmpeg.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, basename, extname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Resvg } from '@resvg/resvg-js';
import { collectNarration, compile, KinoError, type Movie, type NarrationRequest, type WidgetDef } from '../src/index.ts';
import { twemoji } from '../src/node/emoji.ts';
import { loadImages } from '../src/node/images.ts';
import type { ImageAsset } from '../src/index.ts';
import { cachedClip, ensureAll, type CachedClip, type TtsConfig } from '../src/node/tts.ts';

interface Job {
  source: string;
  widgets?: string;
  theme?: string;
  /** preloaded pictures by src (workers can't share the main thread's) */
  images: Record<string, ImageAsset>;
  width: number;
  /** narration durations (ms) by clip id, so workers compute the same timeline */
  durations: Record<string, number>;
}

async function loadWidgets(path?: string): Promise<WidgetDef<any>[]> {
  if (!path) return [];
  const mod = await import(pathToFileURL(resolve(path)).href);
  return Object.values(mod).filter((v): v is WidgetDef<any> => typeof v === 'object' && v !== null && 'type' in v && 'render' in v);
}

const FONT_DIR = fileURLToPath(new URL('../assets/fonts/', import.meta.url));
const FONT_FILES = readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/.test(f)).map((f) => join(FONT_DIR, f));

function raster(svg: string, width: number) {
  return new Resvg(svg, {
    fitTo: { mode: 'width', value: width },
    font: { fontFiles: FONT_FILES, loadSystemFonts: true, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter', monospaceFamily: 'JetBrains Mono' },
  }).render();
}

if (!isMainThread) {
  // worker: compile once, then rasterize requested frames
  const job = workerData as Job;
  const movie = compile(job.source, {
    theme: job.theme,
    images: (src) => job.images[src],
    widgets: await loadWidgets(job.widgets),
    emoji: twemoji,
    narration: (r) => (job.durations[r.id] === undefined ? undefined : { duration: job.durations[r.id] }),
  });
  parentPort!.on('message', ({ frame, t }: { frame: number; t: number }) => {
    const px = raster(movie.svgAt(t), job.width).pixels;
    const buf = px.buffer.slice(px.byteOffset, px.byteOffset + px.byteLength);
    parentPort!.postMessage({ frame, buf }, [buf as ArrayBuffer]);
  });
  parentPort!.postMessage({ ready: true });
} else {
  await main();
}

async function main() {
  const args = process.argv.slice(2);
  const flags = ['-o', '--fps', '--png', '--svg', '--at', '--scale', '--widgets', '--jobs', '--tts', '--theme'];
  const input = args.find((a, i) => !a.startsWith('-') && !flags.includes(args[i - 1] ?? ''));
  if (!input) {
    console.error(`usage: render <file.kino> [-o out.mp4|out.webm|out.gif] [--fps N] [--scale S] [--jobs N] [--widgets widgets.ts] [--theme sketch]
                     [--no-audio] [--tts http://127.0.0.1:8808]
       render <file.kino> --png out.png --at <2.5s | 1200ms>
       render <file.kino> --svg out.svg --at <time>`);
    process.exit(2);
  }
  const opt = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const parseTime = (s: string) => (s.endsWith('ms') ? parseFloat(s) : s.endsWith('s') ? parseFloat(s) * 1000 : parseFloat(s));

  const source = readFileSync(input, 'utf8');
  const widgets = opt('--widgets');
  const theme = opt('--theme');
  const { assets: images, missing: missingImages } = await loadImages(source, dirname(resolve(input)));
  for (const m of missingImages) console.error(`image "${m.src}": ${m.reason} (drawn as a placeholder)`);
  const stills = args.includes('--png') || args.includes('--svg');
  const withAudio = !args.includes('--no-audio') && !stills;
  const tts: TtsConfig = { server: opt('--tts') };

  // narration: generate missing clips (cached in .kino-cache/tts), or reuse what's cached
  const clips = new Map<string, CachedClip>();
  let reqs: NarrationRequest[] = [];
  try {
    reqs = collectNarration(source);
  } catch {} // syntax errors are reported by compile() below
  if (withAudio && reqs.length) {
    try {
      for (const [id, c] of await ensureAll(reqs, tts, (done, total, r) => {
        if (done < total) process.stdout.write(`\rnarration ${done + 1}/${total}: ${r.text.slice(0, 50).padEnd(50)}`);
      }))
        clips.set(id, c);
      if (reqs.some((r) => clips.has(r.id))) console.log(`\nnarration: ${clips.size} clip(s) ready`);
    } catch (e) {
      console.error(`\n${e instanceof Error ? e.message : e}\nrendering without narration audio (use --no-audio to silence this)`);
    }
  } else {
    for (const r of reqs) {
      const c = cachedClip(r, tts);
      if (c) clips.set(r.id, c);
    }
  }
  const durations = Object.fromEntries([...clips.values()].map((c) => [c.id, c.duration]));

  let movie: Movie;
  try {
    movie = compile(source, { theme, images: (src) => images[src], widgets: await loadWidgets(widgets), emoji: twemoji, narration: (r) => clips.get(r.id) && { duration: clips.get(r.id)!.duration, url: clips.get(r.id)!.file } });
  } catch (e) {
    if (e instanceof KinoError) {
      console.error(`${input}:${e.message}`);
      process.exit(1);
    }
    throw e;
  }

  const scale = parseFloat(opt('--scale') ?? '1');
  const fps = parseFloat(opt('--fps') ?? String(movie.video.fps));
  const W = Math.round(movie.video.width * scale) & ~1;
  const H = Math.round(movie.video.height * scale) & ~1;

  const svgOut = opt('--svg');
  const pngOut = opt('--png');
  if (svgOut || pngOut) {
    const t = parseTime(opt('--at') ?? '0');
    const svg = movie.svgAt(t);
    const out = (svgOut ?? pngOut)!;
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, svgOut ? svg : raster(svg, W).asPng());
    console.log(`wrote ${out} (t=${t}ms of ${movie.duration}ms)`);
    return;
  }

  const out = opt('-o') ?? `out/${basename(input, extname(input))}.mp4`;
  mkdirSync(dirname(out), { recursive: true });
  const total = Math.max(1, Math.ceil((movie.duration / 1000) * fps));
  const ext = extname(out);
  const codec =
    ext === '.webm' ? ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '30']
    : ext === '.gif' ? ['-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse']
    : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart'];
  // narration track: each clip delayed to its start time, then mixed
  const voiced = withAudio && ext !== '.gif' ? movie.narration.filter((c) => c.ready && c.url) : [];
  const audioArgs: string[] = [];
  if (voiced.length) {
    voiced.forEach((c) => audioArgs.push('-i', c.url!));
    const chains = voiced.map((c, i) => `[${i + 1}:a]aresample=48000,adelay=${Math.round(c.start)}:all=1[a${i}]`);
    const mix = `${voiced.map((_, i) => `[a${i}]`).join('')}amix=inputs=${voiced.length}:normalize=0:dropout_transition=0,apad[aout]`;
    audioArgs.push('-filter_complex', [...chains, mix].join(';'), '-map', '0:v', '-map', '[aout]');
    audioArgs.push(...(ext === '.webm' ? ['-c:a', 'libopus', '-b:a', '128k'] : ['-c:a', 'aac', '-b:a', '192k']));
    audioArgs.push('-t', (movie.duration / 1000).toFixed(3));
  }
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-', ...audioArgs, ...codec, out], {
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  const ffDone = new Promise<number>((res) => ff.on('close', (code) => res(code ?? 1)));

  const t0 = Date.now();
  const jobs = Math.max(1, Math.min(parseInt(opt('--jobs') ?? '') || availableParallelism() - 1, total));
  const pending = new Map<number, Buffer>();
  let nextToWrite = 0;
  let nextToSend = 0;

  await new Promise<void>((done, fail) => {
    const workers: Worker[] = [];
    const send = (w: Worker) => {
      if (nextToSend >= total) return;
      const frame = nextToSend++;
      w.postMessage({ frame, t: (frame / fps) * 1000 });
    };
    const flush = async () => {
      while (pending.has(nextToWrite)) {
        const buf = pending.get(nextToWrite)!;
        pending.delete(nextToWrite);
        nextToWrite++;
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      }
    };
    let flushing = Promise.resolve();
    for (let i = 0; i < jobs; i++) {
      const w = new Worker(new URL(import.meta.url), { workerData: { source, widgets, theme, images, width: W, durations } satisfies Job });
      workers.push(w);
      w.on('error', fail);
      w.on('message', (msg: { ready?: boolean; frame?: number; buf?: ArrayBuffer }) => {
        if (msg.ready) {
          // keep a couple of frames in flight per worker
          send(w);
          send(w);
          return;
        }
        pending.set(msg.frame!, Buffer.from(msg.buf!));
        flushing = flushing.then(async () => {
          const before = nextToWrite;
          await flush();
          if (nextToWrite !== before && (Math.floor(nextToWrite / 30) !== Math.floor(before / 30) || nextToWrite === total))
            process.stdout.write(`\rframe ${nextToWrite}/${total}`);
          if (nextToWrite === total) {
            workers.forEach((x) => x.terminate());
            done();
          }
        });
        // backpressure: don't race too far ahead of the writer
        if (nextToSend - nextToWrite < jobs * 4) send(w);
        else setTimeout(function retry() { nextToSend - nextToWrite < jobs * 4 ? send(w) : setTimeout(retry, 5); }, 5);
      });
    }
  });
  ff.stdin.end();
  const code = await ffDone;
  console.log(`\n${code === 0 ? 'wrote' : 'ffmpeg failed for'} ${out} (${(movie.duration / 1000).toFixed(1)}s video, ${total} frames, rendered in ${((Date.now() - t0) / 1000).toFixed(1)}s with ${jobs} workers${voiced.length ? `, ${voiced.length} narration clips` : ''})`);
  process.exit(code);
}
