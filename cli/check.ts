// Validate a .kino file and summarize it; optionally render a contact sheet.
//   npm run check -- examples/go-slices.kino
//   npm run check -- my.kino --sheet out/my-sheet.png      (one frame per step, end of each step)
//   npm run check -- my.kino --widgets my-widgets.ts
//   npm run check -- my.kino --theme sketch --sheet out/sheet.png
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { collectNarration, compile, extractEmojis, KinoError, type WidgetDef } from '../src/index.ts';
import { twemoji } from '../src/node/emoji.ts';
import { loadImages } from '../src/node/images.ts';
import { cachedClip } from '../src/node/tts.ts';

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const file = args.find((a, i) => !a.startsWith('-') && !['--sheet', '--widgets', '--theme'].includes(args[i - 1] ?? ''));
if (!file) {
  console.error('usage: check <file.kino> [--sheet out.png] [--widgets widgets.ts] [--theme name]');
  process.exit(2);
}
const src = readFileSync(file, 'utf8');
let widgets: WidgetDef<any>[] = [];
if (opt('--widgets')) {
  const mod = await import(pathToFileURL(resolve(opt('--widgets')!)).href);
  widgets = Object.values(mod).filter((v: any) => v && typeof v === 'object' && 'type' in v && 'render' in v) as WidgetDef<any>[];
}

const { assets: images, missing: missingImages } = await loadImages(src, dirname(resolve(file)));

let movie;
try {
  const reqs = collectNarration(src);
  const cached = new Map(reqs.map((r) => [r.id, cachedClip(r)]));
  movie = compile(src, { theme: opt('--theme'), images: (s) => images[s], widgets, emoji: twemoji, narration: (r) => cached.get(r.id) && { duration: cached.get(r.id)!.duration } });
} catch (e) {
  console.error(`✗ ${file}:${e instanceof KinoError ? e.message : e instanceof Error ? e.stack : e}`);
  process.exit(1);
}

const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
console.log(`✓ ${file}: ${movie.video.width}x${movie.video.height} @ ${movie.video.fps}fps, ${s(movie.duration)}, ${movie.chapters.length} steps`);
movie.chapters.forEach((c, i) => {
  const end = movie.chapters[i + 1]?.time ?? movie.duration;
  console.log(`  ${s(c.time).padStart(6)}  ${c.name}  (line ${c.line}, ${s(end - c.time)})`);
});
if (movie.narration.length) {
  const ready = movie.narration.filter((c) => c.ready).length;
  console.log(`  narration: ${movie.narration.length} lines, ${ready} cached${ready < movie.narration.length ? ' (others use estimated durations until generated)' : ''}`);
}
const missing = extractEmojis(src).filter((e) => !twemoji(e));
if (missing.length) console.log(`  ⚠ no artwork for: ${missing.join(' ')} (drawn as text)`);
for (const m of missingImages) console.log(`  ⚠ image "${m.src}": ${m.reason} (drawn as a placeholder)`);

const sheet = opt('--sheet');
if (sheet) {
  const fontDir = fileURLToPath(new URL('../assets/fonts/', import.meta.url));
  const fontFiles = readdirSync(fontDir).filter((f) => /\.(ttf|otf)$/.test(f)).map((f) => join(fontDir, f));
  const tmp = mkdtempSync(join(tmpdir(), 'kino-sheet-'));
  // the settled picture at the end of every step
  movie.chapters.forEach((c, i) => {
    const t = Math.max(c.time, (movie.chapters[i + 1]?.time ?? movie.duration) - 1);
    const png = new Resvg(movie.svgAt(t), {
      fitTo: { mode: 'width', value: 640 },
      font: { fontFiles, loadSystemFonts: true, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter', monospaceFamily: 'JetBrains Mono' },
    }).render().asPng();
    writeFileSync(join(tmp, `${String(i).padStart(3, '0')}.png`), png);
  });
  const cols = Math.min(3, movie.chapters.length);
  const rows = Math.ceil(movie.chapters.length / cols);
  mkdirSync(dirname(resolve(sheet)), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', join(tmp, '%03d.png'), '-vf', `tile=${cols}x${rows}:padding=6:color=0x333333`, '-frames:v', '1', sheet]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`  sheet: ${sheet} (end of each step, left→right, top→bottom)`);
}
