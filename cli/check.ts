// Validate a .kino file and summarize it; optionally render a contact sheet.
//   npm run check -- examples/go-slices.kino
//   npm run check -- my.kino --sheet out/my-sheet.png      (every page: each step and sub-step, labeled with its line)
//   npm run check -- my.kino --widgets my-widgets.ts
//   npm run check -- my.kino --theme sketch --sheet out/sheet.png
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { collectNarration, compile, contactSheetSvg, extractEmojis, KinoError, sheetLayout, type WidgetDef } from '../src/index.ts';
import { twemoji } from '../src/node/emoji.ts';
import { loadImages } from '../src/node/images.ts';
import { cachedClip } from '../src/node/tts.ts';
import { projectVoice } from '../src/node/settings.ts';

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
  const voice = projectVoice(dirname(resolve(file)));
  const reqs = collectNarration(src, voice);
  const cached = new Map(reqs.map((r) => [r.id, cachedClip(r)]));
  movie = compile(src, { theme: opt('--theme'), voice, images: (s) => images[s], widgets, emoji: twemoji, narration: (r) => cached.get(r.id) && { duration: cached.get(r.id)!.duration } });
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
  const raster = (svg: string, width: number) =>
    new Resvg(svg, {
      fitTo: { mode: 'width', value: width },
      font: { fontFiles, loadSystemFonts: true, defaultFontFamily: 'Inter', sansSerifFamily: 'Inter', monospaceFamily: 'JetBrains Mono' },
    }).render().asPng();
  // every page (what Present mode stops on), each labeled with its step and line
  const layout = sheetLayout(movie);
  const tiles = layout.pages.map((p) => `data:image/png;base64,${Buffer.from(raster(movie.pageSvg(p), layout.tileWidth)).toString('base64')}`);
  const out = contactSheetSvg(movie, layout, tiles);
  mkdirSync(dirname(resolve(sheet)), { recursive: true });
  writeFileSync(sheet, raster(out.svg, out.width));
  console.log(`  sheet: ${sheet} (${layout.pages.length} pages: every step and sub-step, left→right, top→bottom)`);
}
