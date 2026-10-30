// Smoke tests: every example compiles and renders sane SVG at many points in time,
// plus a few targeted checks of DSL behaviour.
import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { collectNarration, compile, contactSheetSvg, DEFAULT_TTS_MODEL, extractImages, imageAsset, imageSize, KinoError, sheetLayout, themes } from '../src/index.ts';
import { gauge } from '../examples/widgets/gauge.ts';
import { twemoji } from '../src/node/emoji.ts';
import { Resvg } from '@resvg/resvg-js';
import { PDFDocument } from 'pdf-lib';
import { buildPdf } from '../src/pdf.ts';

let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : e}`);
  }
}
async function testAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : e}`);
  }
}

for (const f of readdirSync('examples').filter((f) => f.endsWith('.kino'))) {
  test(`example ${f}`, () => {
    const movie = compile(readFileSync(`examples/${f}`, 'utf8'), { widgets: [gauge], emoji: twemoji });
    assert.ok(movie.duration > 0);
    for (let t = 0; t <= movie.duration + 100; t += 1000 / 15) {
      const svg = movie.svgAt(t);
      // the message (a slow regex on big frames) is only built when the check fails
      if (/NaN|undefined|Infinity/.test(svg)) assert.fail(`bad value in SVG at t=${t}: ${/.{60}(NaN|undefined|Infinity).{20}/.exec(svg)?.[0]}`);
    }
  });
}

for (const theme of ['dark', 'light', 'sketch', 'comic', 'blueprint', 'whiteboard', 'pixel', 'paper-cut']) {
  test(`every example renders in the ${theme} theme`, () => {
    for (const f of readdirSync('examples').filter((f) => f.endsWith('.kino'))) {
      const movie = compile(readFileSync(`examples/${f}`, 'utf8'), { widgets: [gauge], emoji: twemoji, theme });
      for (let t = 0; t <= movie.duration; t += 1000) {
        const svg = movie.svgAt(t);
        assert.ok(!/NaN|undefined|Infinity/.test(svg), `${f}: bad value in SVG at t=${t}`);
      }
    }
  });
}

test('sketch theme: pencil outlines and watercolor washes that keep their shape while moving', () => {
  const src = 'video { theme: sketch }\nframe { a: array { values: [1, 2] } }\nstep { a.highlight(0, good); a.at = (300, 0) }';
  const m = compile(src);
  const svg = m.svgAt(m.duration);
  assert.doesNotMatch(svg, /<rect [^>]*rx=/);
  assert.match(svg, /font-family="Kino Hand/);
  assert.match(svg, /url\(#kgrain\)/);
  // highlighted cell: a wash in the highlight color, outlined in pencil
  assert.match(svg, /fill="rgba\(63,154,110,/);
  // a shape's wobble is seeded by its key: moving it only translates the path
  const first = (s: string) => /<path [^>]*d="M([-\d.]+) ([-\d.]+) Q([-\d.]+)/.exec(s)!;
  const [a, b] = [first(m.svgAt(0)), first(svg)];
  assert.ok(Math.abs(+b[3] - +b[1] - (+a[3] - +a[1])) < 0.01);
  // flat themes are untouched
  assert.match(compile('frame { a: array { values: [1] } }').svgAt(0), /<rect [^>]*rx=/);
});

test('slide-template chrome: side bars, footer, and a title backdrop that does not move the layout', () => {
  const theme = '{ base: light, fontSans: "Lato, Inter, sans-serif", edgeLeft: "#202040, #404080", edgeRight: "#804040, #c02020", edgeWidth: "0.042", footerLeft: "Kino", footerCenter: "Text to video", titleStyle: "bar", titleBackdrop: "#202040, #c02020" }';
  const src = `video { theme: ${theme} }\nframe { t: title at center() { text: "Hello", eyebrow: "world", subtitle: "me" } }\nframe (fade) { b: box at (100, 100) { text: x } }`;
  const m = compile(src);
  const cover = m.svgAt(0), page = m.svgAt(m.duration);
  assert.match(cover, /fill="url\(#kbackdrop\)"/);
  assert.match(cover, /font-family="Lato/);
  assert.match(page, /fill="url\(#kedgeL\)"/);
  assert.match(page, />Text to video</);
  assert.doesNotMatch(page, /url\(#kbackdrop\)"/);
  // the 12000px backdrop is decoration: the headline still starts near the left margin
  const x = +/<text x="([\d.]+)"[^>]*>Hello</.exec(cover)![1];
  assert.ok(x > 200 && x < 500, `headline at x=${x}`);
  // footer text can be overridden like any token
  assert.match(compile('video { theme: { base: light, footerRight: "kino.dev" } }\nframe {}').svgAt(0), />kino\.dev</);
});

test('blueprint theme: a drafting grid and a drawing border', () => {
  const m = compile('video { theme: blueprint }\nframe { a: box { text: x } }');
  const svg = m.svgAt(0);
  assert.match(svg, /<pattern id="kgrid" width="120" height="120" patternUnits="userSpaceOnUse">/);
  assert.match(svg, /<rect [^>]*fill="url\(#kgrid\)"\/>/);
  assert.match(svg, /fill="none" stroke="#eaf4ff" stroke-width="2"/, 'drawing border');
  // other themes have no grid
  assert.doesNotMatch(compile('frame {}').svgAt(0), /kgrid/);
});

test('whiteboard theme: a doodle in black pen, felt-marker fills, dashed highlights, a board frame', () => {
  const m = compile('video { theme: whiteboard }\nframe { a: box { text: x, color: bad } }\nframe { t: title at center() { text: "Hi" } }');
  const svg = m.svgAt(0);
  // one pass: four sides, one pencil line each, in the black pen
  const pen = /<path [^>]*d="(M[^"]+)"[^>]*stroke="([^"]+)" stroke-width="([\d.]+)"/.exec(svg)!;
  assert.equal(pen[1].split('M').length - 1, 4);
  assert.equal(pen[2], '#1c1d20');
  assert.match(svg, /<linearGradient id="kboard"/);
  // big colored lettering outlined in black
  assert.match(m.svgAt(m.duration), /<text [^>]*font-family="Kino Hand[^"]*"[^>]*stroke="#1c1d20"[^>]*paint-order="stroke"/);
  // colored fills laid flat; glows become a dashed loop
  const hl = compile('video { theme: whiteboard }\nframe { a: array { values: [1, 2] } }\nstep { a.highlight(0, good) }');
  const page = hl.svgAt(hl.duration);
  assert.match(page, /<path [^>]*d="M[^"]+Z" fill="rgba\([^"]+\)" stroke="none"/, 'flat fill');
  assert.match(page, /stroke-dasharray="9 8"/, 'dashed doodle');
  assert.doesNotMatch(page, /kglow\)/);
});

test('pixel theme: square corners on the pixel grid, stepped circles, crisp edges, hard shadows', () => {
  const m = compile('video { theme: pixel }\nframe { a: box at (101, 99) { text: x }\n c: circle at (400, 300) { r: 30, fill: accent } }');
  const svg = m.svgAt(0);
  assert.doesNotMatch(svg, /<rect [^>]*rx=/);
  const r = /<rect x="([\d.]+)" y="([\d.]+)"[^>]*shape-rendering="crispEdges"/.exec(svg)!;
  assert.deepEqual([+r[1] % 4, +r[2] % 4], [0, 0]);
  assert.match(svg, /<path [^>]*d="M[\d.]+ [\d.]+(H[\d.]+V[\d.]+)+/, 'stepped circle');
  assert.doesNotMatch(svg, /<circle /);
  assert.match(svg, /fill="#0b0c14"[^>]*transform="translate\(4 4\)/, 'hard shadow');
});

test('paper-cut theme: hand-cut paper pieces with fibres and shadows, no outlines', () => {
  const m = compile('video { theme: paper-cut }\nframe { a: box { text: x }\n t: title at center() { text: "Hi" } }');
  const svg = m.svgAt(m.duration);
  assert.match(svg, /<filter id="kcut"/);
  // the box: its shadow, then a solid sheet with straight-snipped edges and no outline, then its fibres
  assert.match(svg, /<path fill="#000000"[^>]*filter="url\(#kcut\)"\/><path fill="rgb\([^"]+\)" stroke="none"[^>]*d="M[\d.]+ [\d.]+ L[^"]+Z"\/><path fill="url\(#kgrain\)"/);
  assert.doesNotMatch(svg, /<rect [^>]*fill="rgb/);
  // the cut is the same every frame
  assert.equal(compile('video { theme: paper-cut }\nframe { a: box { text: x } }').svgAt(0), compile('video { theme: paper-cut }\nframe { a: box { text: x } }').svgAt(0));
  assert.match(svg, /font-family="Fredoka/);
});

test('comic theme: inked outlines, hard shadows, no blurs, halftone and a panel frame', () => {
  const src = 'frame { t: title at center() { text: "Pow", eyebrow: "intro" } }\nframe (fade) { b: box at (100, 100) { text: x, glow: true }\n l: label at (100, 300) { text: "plain", size: 40 } }';
  const m = compile(src, { theme: 'comic' });
  const cover = m.svgAt(m.chapters[1].time - 1), page = m.svgAt(m.duration);
  assert.match(cover, /<polygon [^>]*fill="#d7261e"/, 'title starburst');
  assert.match(cover, /font-family="Bangers[^"]*"[^>]*stroke="#141414"[^>]*paint-order="stroke"[^>]*>Pow</, 'inked headline');
  assert.doesNotMatch(page, /filter="url\(#kglow/, 'glows are hard rims, not blurs');
  // the box casts a solid ink shadow just before itself
  assert.match(page, /<rect [^>]*fill="#141414"[^>]*transform="translate\(6 6\)[^"]*"[^>]*\/><rect [^>]*stroke-width="3"/);
  assert.match(page, /fill="url\(#kdots\)" mask="url\(#kdotsmask\)"/);
  assert.match(page, /<path d="M[^"]+Z M[^"]+Z" fill="#fff4d6" fill-rule="evenodd"\/>/, 'paper gutter around the panel');
  // black lettering stays plain
  assert.match(page, /<text [^>]*>plain</);
  assert.doesNotMatch(page, /stroke="#141414"[^>]*>plain</);
});

test('merge: ribbons from each source, pulses only during flow()', () => {
  const m = compile('video { transition: 1000ms, hold: 500ms }\nframe { a: array at (0, 300) { values: [1, 2, 3] }\n z: merge at (800, 300) { label: zstd }\n z.from(a[0], a[1], a[2]) }\nstep { z.flow() }\nstep { z.label = done }');
  const ribbons = (svg: string) => (svg.match(/<path d="M[^"]* C[^"]*" fill="none"/g) ?? []).length;
  const pulses = (t: number) => (m.svgAt(t).match(/<circle [^>]*r="8"[^>]*transform="translate/g) ?? []).length;
  assert.equal(ribbons(m.svgAt(0)), 3);
  const flowStart = m.chapters[1].time, nextStart = m.chapters[2].time;
  assert.ok(pulses(flowStart + 600) >= 1);
  assert.equal(pulses(nextStart - 1), 0); // gone once the step settles
  compile('frame { z: merge { label: x }\n b: box at (800, 0) { text: out }\n z.out -> b }').svgAt(0);
  assert.throws(() => compile('frame { z: merge }\nstep { z.from(3) }'), /not a widget or a part/);
  assert.throws(() => compile('frame { z: merge }\nstep { z.flow() }'), /connect sources first/);
});

test('braces clear the index row under array cells, but not other rows of a widget', () => {
  const top = (src: string) => +/<path d="M[-\d.]+ ([-\d.]+)/.exec(compile(src).svgAt(10000))![1];
  // array with indices: the brace starts below the index labels (cell bottom 64 + label row)
  const withIdx = top('frame { a: array at (0, 0) { values: [1, 2, 3] }\n b: brace { from: a[0], to: a[2] } }');
  const noIdx = top('frame { a: array at (0, 0) { values: [1, 2, 3], indices: false }\n b: brace { from: a[0], to: a[2] } }');
  assert.ok(withIdx - noIdx > 15, `with indices ${withIdx}, without ${noIdx}`);
  // a struct row: the brace stays right under that row, not below the whole struct
  const row = top('frame { s: struct at (0, 0) { fields: { a: 1, b: 2, c: 3 } }\n b: brace { from: s.a, side: below } }');
  const last = top('frame { s: struct at (0, 0) { fields: { a: 1, b: 2, c: 3 } }\n b: brace { from: s.c, side: below } }');
  assert.ok(last - row > 40, `row a ${row}, row c ${last}`);
});

test('moveFrom(other, n) moves only the first n items, which keep their identity', () => {
  const m = compile('frame { a: array { values: [1, 2, 3, 4] }\n b: array at (0, 200) { capacity: 4 } }\nstep { b.moveFrom(a, 3) }');
  const svg = m.svgAt(m.duration);
  const texts = [...svg.matchAll(/<text [^>]*font-weight="700"[^>]*>(\d)</g)].map((x) => x[1]);
  assert.deepEqual(texts.sort(), ['1', '2', '3', '4']); // nothing duplicated or lost
  const ys = Object.fromEntries([...svg.matchAll(/<text x="[\d.]+" y="([\d.]+)"[^>]*font-weight="700"[^>]*>(\d)</g)].map((x) => [x[2], +x[1]]));
  assert.ok(ys['1'] > 150 && ys['3'] > 150 && ys['4'] < 150, JSON.stringify(ys));
});

test('compile theme option overrides the script and rejects unknown names', () => {
  assert.equal(compile('video { theme: neon }\nframe {}', { theme: 'light' }).video.theme.bg, '#fafaf7');
  assert.throws(() => compile('frame {}', { theme: 'nope' }), /unknown theme 'nope'/);
});

test('image sizes are read from PNG, JPEG, GIF, WebP and SVG headers', () => {
  const png = readFileSync('examples/images/columnar-overview.png');
  assert.deepEqual(imageSize(png, 'image/png'), { width: 1652, height: 866 });
  // JPEG: SOI, an APP0 segment, then SOF0 with height 300, width 400
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x01, 0x2c, 0x01, 0x90, 3, 0, 0, 0]);
  assert.deepEqual(imageSize(jpeg, 'image/jpeg'), { width: 400, height: 300 });
  const gif = Uint8Array.from([...Buffer.from('GIF89a'), 0x40, 0x01, 0xf0, 0x00]);
  assert.deepEqual(imageSize(gif, 'image/gif'), { width: 320, height: 240 });
  const webp = new Uint8Array(30);
  webp.set(Buffer.from('RIFF'), 0); webp.set(Buffer.from('WEBPVP8X'), 8); webp.set([0x7f, 0x02, 0x00, 0xdf, 0x01, 0x00], 24);
  assert.deepEqual(imageSize(webp, 'image/webp'), { width: 640, height: 480 });
  const svg = (s: string) => imageAsset(Buffer.from(s), 'x.svg');
  assert.equal(svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"/>')?.width, 200);
  assert.equal(svg('<svg xmlns="http://www.w3.org/2000/svg" width="30px" height="10" viewBox="0 0 3 1"/>')?.height, 10);
  assert.equal(imageAsset(Buffer.from('not an image'), 'notes.txt'), undefined);
});

test('image widget: aspect ratio, fit, placeholder, crossfade on src change', () => {
  assert.deepEqual(extractImages('a: image { src: "a.png" }\nstep { a.src = \'b.svg\' }'), ['a.png', 'b.svg']);
  const pic = imageAsset(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"/>'), 'p.svg')!;
  const images = (src: string) => (src === 'p.svg' ? pic : undefined);
  const m = compile('frame { p: image at (0, 0) { src: "p.svg", width: 300, fit: cover } }', { images });
  const img = /<image [^>]*>/.exec(m.svgAt(0))![0];
  assert.match(img, /width="300" height="150"/);
  assert.match(img, /preserveAspectRatio="xMidYMid slice"/);
  assert.match(img, /href="data:image\/svg\+xml;base64,/);
  // not loaded: a dashed placeholder that names the file
  const missing = compile('frame { p: image { src: "nope.png", height: 100 } }', { images }).svgAt(0);
  assert.match(missing, /image: nope\.png/);
  assert.doesNotMatch(missing, /<image /);
  // changing src swaps the picture (new key → crossfade)
  const swap = compile('frame { p: image { src: "p.svg", width: 100 } }\nstep { p.src = "nope.png" }', { images });
  assert.match(swap.svgAt(swap.duration), /image: nope\.png/);
});

test('arrow heads ride the tip of the line while it draws', () => {
  const m = compile('video { transition: 1000ms, hold: 0ms }\nframe { a: box at (0, 0) { text: a }\n b: box at (600, 0) { text: b } }\nstep { a -> b }');
  const head = (t: number) => {
    const svg = m.svgAt(t);
    const tag = /<path d="M[-\d.]+ [-\d.]+ L[^"]*Z"[^>]*>/.exec(svg)?.[0];
    assert.ok(tag, `no arrow head at t=${t}`);
    const x = +/d="M([-\d.]+)/.exec(tag)![1];
    const dx = /transform="translate\(([-\d.]+)/.exec(tag);
    return x + (dx ? +dx[1] : 0);
  };
  // halfway through, the head is well short of its final x, and it ends exactly at the target
  const mid = head(m.duration - 500), end = head(m.duration);
  assert.ok(end - mid > 150, `head at ${mid} halfway, ${end} at the end`);
});

const errorAt = (src: string) => {
  try {
    compile(src);
  } catch (e) {
    if (e instanceof KinoError) return e;
    throw e;
  }
  throw new Error('expected a compile error');
};

test('errors carry line numbers', () => {
  const e = errorAt('frame {\n  a: array\n}\nstep { a.explode() }');
  assert.equal(e.pos?.line, 4);
  assert.match(e.message, /no method 'explode'/);
  assert.equal(errorAt('frame { x: nope }').pos?.line, 1);
  assert.match(errorAt('frame { a: array }\nstep { a.remove(7) }').message, /out of range/);
});

test('then splits a step into sequential transitions', () => {
  const one = compile('video { transition: 500ms, hold: 0ms }\nframe { a: array }\nstep { a.push(1); a.push(2) }');
  const two = compile('video { transition: 500ms, hold: 0ms }\nframe { a: array }\nstep { a.push(1) then a.push(2) }');
  assert.equal(two.duration - one.duration, 500);
});

test('pages: one per step and sub-step', () => {
  const m = compile('frame "a" { x: box }\nstep "b" { x.text = 1 then x.text = 2 }\nwait 1s\nsay "hello"\nstep "c" (cut) { x.text = 3 }');
  assert.deepEqual(m.pages().map((p) => [p.beat, p.title]), [[1, 'a'], [2, 'b'], [3, 'b'], [4, 'c']]);
  // both sub-steps of "b": its first state and the one after `then`
  const [, b1, b2] = m.pages();
  assert.match(m.pageSvg(b1), />1</);
  assert.match(m.pageSvg(b2), />2</);
  // a step that only plays an effect would repeat the last page: it shows the effect halfway instead
  const fx = compile('video { transition: 800ms }\nframe { x: box { text: hi } }\nstep "boing" { x.bounce() }');
  const [still, boing] = fx.pages();
  assert.deepEqual([still.elapsed, boing.elapsed, boing.title], [0, 400, 'boing']);
  assert.notEqual(fx.pageSvg(boing), fx.pageSvg(still));
});

await testAsync('pdf: one page per picture, the size of the video', async () => {
  const m = compile('video { size: (640, 360) }\nframe { x: box { text: one } }\nstep { x.text = two }');
  const pages = m.pages().map((p) => ({ image: new Resvg(m.pageSvg(p)).render().asPng(), type: 'png' as const }));
  const bytes = await buildPdf(pages, { title: 'demo', width: 640, height: 360 });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getPageCount(), 2);
  assert.deepEqual(doc.getPage(1).getSize(), { width: 640, height: 360 });
  assert.equal(doc.getTitle(), 'demo');
});

test('slides: one beat per transition, holds and waits skipped', () => {
  const m = compile('video { transition: 500ms }\nframe { a: array }\nstep { a.push(1) then a.push(2) }\nwait 2s\nstep (cut) { a.push(3) }');
  assert.equal(m.beats.length, 4);
  assert.deepEqual(m.beats.map((b) => b.end - b.start), [0, 500, 500, 0]);
  assert.equal(m.beatAt(0), 1);
  assert.match(m.slideSvgAt(4), />3</);
  assert.doesNotMatch(m.slideSvgAt(3), />3</);
  assert.ok(!/NaN|undefined/.test(m.slideSvgAt(1, 250)));
});

test('timeline: steps, sub-step transitions, element spans and marks', () => {
  const src = `video { transition: 500ms, hold: 1000ms }
frame "intro" { a: array }
step "fill" (fade, back-out) {
  a.push(1)
then
  b: box { text: x }
  a.bounce()
  camera.focus(b, 2)
}
wait 2s
step "clean" (cut) {
  remove b
  camera.reset()
}`;
  const m = compile(src);
  const { steps, elements, camera } = m.timeline;
  assert.deepEqual(steps.map((s) => [s.kind, s.name, s.start, s.end]), [
    ['frame', 'intro', 0, 1000],
    ['step', 'fill', 1000, 3000],
    ['wait', 'wait 2000ms', 3000, 5000],
    ['step', 'clean', 5000, 6000],
  ]);
  assert.deepEqual(steps[1].transitions.map((t) => [t.start, t.end, t.kind, t.ease, t.line]), [
    [1000, 1500, 'fade', 'back-out', 3],
    [1500, 2000, 'fade', 'back-out', 5],
  ]);
  assert.equal(steps[3].transitions[0].end, 5000, 'cuts take no time');
  const [a, b] = elements;
  assert.deepEqual([a.name, a.type, a.line, a.spans], ['a', 'array', 2, [{ start: 0, end: 6000, enter: 0, exit: 0 }]]);
  assert.deepEqual(a.marks.map((x) => [x.time, x.kind, x.label, x.line]), [
    [1000, 'method', 'push()', 4],
    [1500, 'effect', 'bounce()', 7],
  ]);
  assert.deepEqual([b.name, b.line, b.spans], ['b', 6, [{ start: 1500, end: 5000, enter: 500, exit: 0 }]]);
  assert.deepEqual(camera.map((x) => [x.time, x.label]), [[1500, 'focus()'], [5000, 'reset()']]);
});

test('bare words work for string props and as references', () => {
  const m = compile('frame { l: label { text: hi, font: mono, color: warn }\n b: box at below(l, 10) { text: x } }');
  const svg = m.svgAt(0);
  assert.match(svg, /font-family="JetBrains Mono/);
  assert.match(svg, />hi</);
});

test('swap keeps item identity (values move, no crossfade)', () => {
  const m = compile('video { transition: 1000ms, hold: 0ms }\nframe { a: array { values: [1, 2] } }\nstep (linear) { a.swap(0, 1) }');
  const mid = m.svgAt(500);
  // both values are drawn exactly once mid-flight, at the same x (crossing)
  const xs = [...mid.matchAll(/<text x="([\d.]+)"[^>]*font-size="24"[^>]*>(1|2)<\/text>/g)].map((r) => +r[1]);
  assert.equal(xs.length, 2);
  assert.equal(xs[0], xs[1]);
});

test('relative positions', () => {
  const m = compile('frame { a: box at (100, 100) { width: 50, height: 20 }\n b: box at right-of(a, 10) { width: 10, height: 10 } }');
  assert.match(m.svgAt(0), /<rect x="160" y="100" width="10"/);
});

test('narration stretches steps and starts with its sub-step', () => {
  const src = `video { transition: 500ms, hold: 1000ms, narrationHold: 200ms }
frame { a: array }
step { a.push(1) then say "two"; a.push(2) }
say "standalone"
step (hold: 50ms) { say "short"; a.push(3) }`;
  const durs: Record<string, number> = { two: 3000, standalone: 1500, short: 100 };
  const m = compile(src, { narration: (r) => ({ duration: durs[r.text] }) });
  const [two, standalone, short] = m.narration;
  // frame (t=0, no transition) + hold 1000; step starts at 1000, "two" starts with the 2nd sub-step
  assert.equal(two.start, 1500);
  // ends when the voice ends (1500 + 3000) + narrationHold 200
  assert.equal(standalone.start, 4700);
  assert.equal(short.start, 4700 + 1500 + 200);
  // transition 500 > voice 100, then the explicit hold
  assert.equal(m.duration, short.start + 500 + 50);
  assert.ok(m.narration.every((c) => c.ready));
});

test('narration without audio uses estimates; voice changes the clip id', () => {
  const src = `video { voice: { speaker: Jasper } }
frame { say "hello there" }
voice { speaker: Luna, instruct: "excited" }
say "hello there"
say "hello there" (speaker: Jasper)`;
  const m = compile(src);
  assert.equal(m.narration.length, 3);
  assert.ok(m.narration.every((c) => !c.ready && c.duration > 0));
  const [a, b, c] = m.narration.map((x) => x.request);
  assert.notEqual(a.id, b.id);
  assert.equal(b.voice.instruct, 'excited');
  assert.notEqual(b.id, c.id); // same speaker as a, but instruct differs
  assert.equal(collectNarration(src).length, 3);
  assert.match(errorAt('frame { say "x" (pitch: 3) }').message, /unknown voice setting 'pitch'/);
});

test('tts providers: hosted voices get their own clip ids, typos are errors', () => {
  const m = compile(`frame { say "hi" }
say "hi" (provider: local)
say "hi" (provider: ElevenLabs, speaker: Rachel)`);
  const [a, b, c] = m.narration.map((x) => x.request);
  assert.equal(a.id, b.id); // local is the default, and stays out of the id
  assert.equal(c.voice.provider, 'elevenlabs');
  assert.notEqual(a.id, c.id);
  assert.match(errorAt('frame { say "x" (provider: elevenlab) }').message, /unknown TTS provider 'elevenlab'/);
});

test('project voice: wins over the script header, not over later voice changes; old clip ids stay', () => {
  const src = `video { voice: { speaker: Jasper, preset: expressive } }
frame { say "hi" }
say "hi" (provider: local, speaker: Luna)
voice { speed: 1.2 }
say "hi"`;
  const voice = { settings: { provider: 'elevenlabs', speaker: 'Roger', model: '' }, defaultProvider: 'espeak' };
  const [a, b, c] = compile(src, { voice }).narration.map((x) => x.request);
  assert.equal(a.voice.provider, 'elevenlabs');
  assert.equal(a.voice.speaker, 'Roger'); // the project's, not the header's Jasper
  assert.equal(a.voice.preset, 'expressive'); // header settings the project doesn't set stay
  assert.equal(a.voice.model, DEFAULT_TTS_MODEL); // empty project values don't count
  assert.equal(b.voice.provider, 'local'); // per-line options win
  assert.equal(b.voice.speaker, 'Luna');
  assert.equal(c.voice.speed, '1.2');
  assert.notEqual(a.id, c.id);
  assert.deepEqual(collectNarration(src, voice).map((r) => r.id), [a.id, b.id, c.id]);
  // Kino's default provider only applies when nobody names one
  assert.equal(compile('frame { say "x" }', { voice: { defaultProvider: 'espeak' } }).narration[0].request.voice.provider, 'espeak');
  assert.equal(compile('video { voice: { provider: openai } }\nframe { say "x" }', { voice: { defaultProvider: 'espeak' } }).narration[0].request.voice.provider, 'openai');
  // the id this clip had before provider/speed existed: caches stay valid
  assert.equal(compile('frame { say "hello" }', { voice: {} }).narration[0].request.id, '0ec44c441381700b6564633439c8');
});

test('video padding: the picture is scaled to fit inside it, positions keep canvas coordinates', () => {
  // 1280×720 with 100px left/right: scaled by 1080/1280, centered vertically
  const m = compile('video { padding: [0, 100] }\nframe { a: box at (0, 0) }');
  const f = m.frameAt(m.duration);
  assert.deepEqual([f.nodes.find((n) => n.key === 'a/bg')!.attrs.x, f.nodes.find((n) => n.key === 'a/bg')!.attrs.y], [0, 0]);
  const k = 1280 / 1080;
  assert.deepEqual(f.view, { x: -100 * k, y: -(720 - 720 / k) / 2 * k, w: 1280 * k, h: 720 * k });
  // a camera zoom is padded the same way, around what it shows
  const z = compile('video { padding: [0, 100] }\nframe { a: box at (0, 0)\n camera.zoom = 2 }');
  assert.ok(Math.abs(z.frameAt(z.duration).view.w - (1280 * k) / 2) < 1e-9);
  assert.deepEqual([compile('video { padding: 30 }').video.padding, compile('video { padding: [10, 20] }').video.padding, compile('video { padding: { top: 70 } }').video.padding], [
    { top: 30, right: 30, bottom: 30, left: 30 },
    { top: 10, right: 20, bottom: 10, left: 20 },
    { top: 70, right: 0, bottom: 0, left: 0 },
  ]);
  assert.throws(() => compile('video { padding: { up: 3 } }'), /unknown padding side 'up'/);
  assert.throws(() => compile('video { padding: [700, 0] }'), /leaves no room/);
  assert.throws(() => compile('video { padding: -5 }'), /negative/);
  // themes can bring their own (fractions of the frame); the script's wins
  assert.deepEqual(compile('video { theme: { base: light, padding: "0, 0.09" } }').video.padding, { top: 0, right: 1280 * 0.09, bottom: 0, left: 1280 * 0.09 });
  assert.deepEqual(compile('video { theme: { base: light, padding: "0, 0.09" }, padding: 0 }').video.padding, { top: 0, right: 0, bottom: 0, left: 0 });
});

test('memory: typed little/big-endian writes', () => {
  const svg = compile(`frame { m: memory { size: 12 } }
step { m.write(0, 3.14, f32); m.write(4, 258, i32); m.write(8, 258, u16, big) }`).svgAt(1e9);
  const bytes = [...svg.matchAll(/>([0-9A-F]{2})<\/text>/g)].map((r) => r[1]).join(' ');
  assert.equal(bytes, 'C3 F5 48 40 02 01 00 00 01 02 00 00');
});

test('bits: IEEE-754, shifts and logic', () => {
  const val = (src: string) => /= ([^<]+)<\/text>/.exec(compile(src).svgAt(1e9))![1];
  assert.equal(val('frame { f: bits { width: 32, format: hex } }\nstep { f.setFloat(3.14) }'), '0x4048F5C3');
  assert.equal(val('frame { n: bits { value: 22 } }\nstep { n.shl(1) }'), '44');
  assert.equal(val('frame { n: bits { value: 0b1100 } }\nstep { n.xor(0b1010); n.not() }'), '249');
  assert.equal(val('frame { n: bits { value: 0x80, format: signed } }\nstep { n.sar(2) }'), '-32');
});

test('tree: BST delete moves the successor up; rotations; swaps', () => {
  const xs = (src: string) => {
    const svg = compile(src).svgAt(1e9);
    // node labels with their positions: [label, x, y]
    return [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"[^>]*>(\d+)<\/text>/g)].map((m) => [m[3], +m[1], +m[2]] as const);
  };
  const top = (src: string) => xs(src).sort((a, b) => a[2] - b[2])[0][0];
  const base = 'frame { t: tree { values: [50, 30, 70, 60, 80, 65] } }\n';
  assert.equal(top(base + 'step { t.delete(50) }'), '60');
  assert.equal(top(base + 'step { t.rotateLeft(50) }'), '70');
  assert.equal(top(base + 'step { t.swap(50, 30) }'), '30');
  // in-order layout: labels sorted by x read in sorted order
  assert.deepEqual(xs(base + 'step { t.insert(55) }').sort((a, b) => a[1] - b[1]).map((n) => n[0]), ['30', '50', '55', '60', '65', '70', '80']);
});

test('slide transitions: each picture is clipped to its part of the screen', () => {
  const src = (opts: string) => `frame { a: box at (100, 100) { text: one } }\nframe "b" (${opts}) { b: box at (100, 100) { text: two } }`;
  for (const opts of ['wipe, 1s', 'iris, 1s, shape: star', 'slide, 1s, direction: up', 'push, 1s']) {
    const m = compile(src(opts));
    const mid = m.svgAt(m.chapters[1].time + 500);
    assert.equal((mid.match(/<clipPath id="kclip\d"/g) ?? []).length, 2, opts);
    assert.equal((mid.match(/<g clip-path=/g) ?? []).length, (mid.match(/<\/g>/g) ?? []).length, opts);
    assert.match(mid, />one</, opts);
    assert.match(mid, />two</, opts);
    // settled: no clipping left
    assert.doesNotMatch(m.svgAt(m.duration), /clip-path/, opts);
  }
  // push moves the old picture out: halfway, `one` is shifted by half the width
  const push = compile(src('push, 1s, linear')).svgAt(900 + 500);
  assert.match(push, /<rect [^>]*transform="translate\(-640 0\)"/);
  assert.throws(() => compile(src('wipe, shape: star')), /'shape' is for iris/);
  assert.throws(() => compile(src('iris, shape: blob')), /unknown iris shape 'blob'/);
  assert.throws(() => compile(src('fade, direction: up')), /'direction' is for wipe, slide and push/);
});

test('group: members move, scale and leave together; relative layout inside it', () => {
  const pos = (svg: string, text: string) => {
    const m = new RegExp(`<text [^>]*transform="([^"]*)"[^>]*>${text}</text>`).exec(svg);
    return m ? m[1] : null;
  };
  const base = 'frame { g: group\n a: box at (100, 100) { text: A, group: g }\n b: box at right-of(a) { text: B, group: g }\n c: box at (800, 500) { text: C }\n a -> c }\n';
  const m0 = compile(base);
  // without `at` the group leaves members where they are
  const anchor = (svg: string) => /translate\(([-\d.]+) ([-\d.]+)\) rotate\(0\) scale\(1\) translate\(([-\d.]+) ([-\d.]+)\)/.exec(svg)!;
  const a0 = anchor(m0.svgAt(0));
  assert.equal(+a0[1] + +a0[3], 0);
  assert.equal(+a0[2] + +a0[4], 0);
  assert.equal(pos(m0.svgAt(0), 'C'), null);
  // moving the group moves its members, not others; the arrow follows
  const m1 = compile(base + 'step { g.at = (400, 300) }');
  const end = m1.svgAt(m1.duration);
  assert.match(pos(end, 'A')!, /^translate\(/);
  assert.equal(pos(end, 'A'), pos(end, 'B'));
  const arrowStart = (svg: string) => /<path d="M([-\d.]+) ([-\d.]+)[^"]*"[^>]*stroke-width/.exec(svg)![1];
  assert.notEqual(arrowStart(m0.svgAt(0)), arrowStart(end));
  // groups and their members leave together, with arrows to them
  const gone = compile(base + 'step { remove g }');
  assert.doesNotMatch(gone.svgAt(gone.duration), />A<|>B</);
  assert.match(gone.svgAt(gone.duration), />C</);
  assert.throws(() => compile('frame { x: box\n a: box { group: x } }'), /'x' is a box, not a group/);
  assert.throws(() => compile('frame { g: group { group: h }\n h: group { group: g }\n a: box { group: g } }'), /contains itself|circular/);
});

test('contact sheet: a labeled tile per page', () => {
  const m = compile('frame "one" { a: box { text: x } }\nstep "two" { a.text = "y"\nthen\n a.text = "z" }');
  const layout = sheetLayout(m, { columns: 2 });
  assert.deepEqual(layout.pages.map((p) => [p.title, p.line]), [['one', 1], ['two', 2], ['two', 3]]);
  const sheet = contactSheetSvg(m, layout, layout.pages.map(() => 'data:image/png;base64,'));
  assert.equal((sheet.svg.match(/<image /g) ?? []).length, 3);
  assert.match(sheet.svg, />line 3</);
  assert.equal(sheet.width, 16 * 2 + 2 * 480 + 14);
});

test('rich text: bold, italic, code and colors; plain text is untouched', () => {
  const svg = (t: string, w = 'label') => compile(`frame { a: ${w} { text: ${JSON.stringify(t)} } }`).svgAt(0);
  const plain = svg('a * b and 2*3');
  assert.equal((plain.match(/<text /g) ?? []).length, 1);
  const rich = svg('is **fast** and *new*, see `zstd` in {good: green}');
  assert.match(rich, /font-weight="700"[^>]*>fast</);
  assert.match(rich, /skewX\(-12\)[^>]*>new</);
  assert.match(rich, /font-family="JetBrains Mono[^"]*"[^>]*>zstd</);
  assert.match(rich, new RegExp(`fill="${themes.neon.good}"[^>]*>green<`));
  assert.doesNotMatch(rich, /\*\*|`|\{good/);
  // an unknown color name stays as written
  assert.match(svg('{nope: x}'), />\{nope: x\}</);
  // caps keep color names
  assert.match(compile('frame { a: label { text: "{accent: hi}", caps: true } }').svgAt(0), new RegExp(`fill="${themes.neon.accent}"[^>]*>HI<`));
  assert.match(svg('**b**', 'box'), /font-weight="700"[^>]*>b</);
  assert.match(compile('frame { c: callout { target: (10, 10), text: "**b**" } }').svgAt(0), /font-weight="700"[^>]*>b</);
  assert.match(compile('frame { l: list { items: ["x **y**"] } }').svgAt(0), /font-weight="700"[^>]*>y</);
});

test('chart: bars keep identity, pies turn, lines move', () => {
  const m = compile('frame { c: chart { values: [10, 20], labels: [a, b] } }\nstep { c.values = [20, 10]; c.push("c", 5) }');
  const bar = (svg: string) => [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="[\d.]+" height="([\d.]+)"[^>]*stroke-width="1.5"/g)].map((x) => +x[3]);
  const [a0, b0] = bar(m.svgAt(0));
  assert.ok(b0 > a0);
  const end = bar(m.svgAt(m.duration));
  assert.equal(end.length, 3);
  assert.ok(end[0] > end[1] && end[1] > end[2]);
  // halfway, the bars are in between (they grow, not crossfade)
  const mid = bar(m.svgAt(m.chapters[1].time + 350));
  assert.ok(mid[0] > a0 && mid[0] < end[0]);
  // data by label: ids follow labels
  const pie = compile('frame { p: chart { type: pie, data: { x: 1, y: 3 } } }\nstep { p.data = { y: 1, x: 3 } }');
  assert.match(pie.svgAt(0), />y 75%</);
  assert.match(pie.svgAt(pie.duration), />x 75%</);
  assert.match(compile('frame { l: chart { type: line, values: [1, 3, 2] } }').svgAt(0), /<path d="M[^"]*L[^"]*L/);
  compile('frame { c: chart { values: [1, 2] }\n p: pointer { target: c[1] } }').svgAt(0);
});

test('notes: on their beats, never on the slide', () => {
  const m = compile('frame "a" { note "first"\n b: box { text: x } }\nstep "b" { b.text = "y"\n note "second"\nthen\n notes "third"\n say "[excited] Spoken line" }');
  assert.deepEqual(m.beats.map((b) => b.notes), [['first'], ['second'], ['third']]);
  assert.deepEqual(m.beats[2].spoken, ['Spoken line']);
  assert.doesNotMatch(m.svgAt(m.duration), /first|second|third/);
});

test('links, zoom transitions and zoom-dependent details', () => {
  const src = 'frame "Overview" { a: box at (100, 100) { text: A, link: "Detail" }\n d: label at (100, 200) { text: tiny, minZoom: 2 }\n o: label at (300, 200) { text: big, maxZoom: 1.5 } }\n' +
    'step "close" { camera.focus(a, 3) }\nframe "Detail" (zoom-in, target: a, 1s, linear) { t: title { text: Inside } }';
  const m = compile(src);
  assert.match(m.slideSvgAt(1), /data-link="Detail"/);
  assert.doesNotMatch(m.slideSvgAt(1), />tiny</);
  assert.match(m.slideSvgAt(1), />big</);
  assert.match(m.slideSvgAt(2), />tiny</);
  assert.doesNotMatch(m.slideSvgAt(2), />big</);
  assert.equal(m.beatOf('Detail'), 3);
  // jumping from the overview plays the zoom: both slides on screen, the new one scaled down
  const jump = m.jumpSvgAt(1, 3, 300);
  assert.match(jump, />A</);
  assert.match(jump, /Inside[^]*|scale\(/);
  assert.match(jump, /translate\([-\d.]+ [-\d.]+\) scale\(0\.\d+\)/);
  assert.match(m.jumpSvgAt(1, 3, 5000), />Inside</);
  // jumping back out of a zoomed-into slide zooms out (the detail shrinks into its box)
  const back = m.jumpSvgAt(3, 1, 300);
  assert.match(back, />Inside</);
  assert.match(back, />A</);
  assert.match(back, /scale\(0\.\d+\)/);
  assert.throws(() => compile(src.replace('link: "Detail"', 'link: "Nowhere"')), /link "Nowhere" doesn't match/);
  compile(src.replace('link: "Detail"', 'link: "https://example.com"'));
  assert.throws(() => compile(src.replace('target: a', 'target: zz')), /zoom target 'zz' isn't a widget/);
  assert.throws(() => compile(src.replace('(zoom-in, target: a', '(fade, target: a')), /'target' is for zoom-in and zoom-out/);
  // links survive the paper themes
  for (const theme of ['sketch', 'comic', 'pixel', 'paper-cut', 'whiteboard']) assert.match(compile(src, { theme }).slideSvgAt(1), /data-link="Detail"/, theme);
});

// combine phases use their own millisecond clock, including in presentation mode.
const combineScene = `video { transition: 100ms, hold: 0ms }
frame {
  a: array at (0, 0) { values: [1, 2] }
  b: array at (0, 100) { values: [10, 20] }
  out: array at (0, 200) { capacity: 2 }
}`;
const visibleCombine = (m: ReturnType<typeof compile>, elapsed: number) => m.frameAt(m.beats[1].start + elapsed).nodes.filter(n => n.key.includes('cmb:') && Number(n.attrs.opacity ?? 1) > 0.001);

test('combine: defaults provide a readable pause; later steps do not replay or extend it', () => {
  const m = compile(combineScene + '\nstep { out.combine("+", a, b) }\nstep { out.highlight(all, good) }');
  assert.equal(m.beats[1].end - m.beats[1].start, 1700);
  assert.equal(m.beats[2].end - m.beats[2].start, 100);
  for (const elapsed of [600, 900, 1299]) {
   const nodes = visibleCombine(m, elapsed);
   assert.equal(nodes.length, 6);
   assert.ok(nodes.every(n => Number(n.attrs.opacity ?? 1) === 1));
   assert.equal(m.slideFrameAt(1, elapsed).nodes.filter(n => n.key.includes('cmb:') && Number(n.attrs.opacity ?? 1) > 0.001).length, 6);
  }
  assert.equal(visibleCombine(m, 1750).length, 0);
  assert.match(m.slideSvgAt(2), />11</);
  assert.match(m.slideSvgAt(2), />22</);
  assert.doesNotMatch(m.slideSvgAt(2), /cmb:/);
});

test('combine: custom timing, lanes, effects and easing are independent of step easing', () => {
  const src = combineScene + '\nstep (4s, spring) { out.combine("+", a, b, [1], { fly: 400ms, hold: 800ms, merge: 400ms, flyEasing: linear, mergeEasing: linear, operator: fade, result: fade }) }';
  const m = compile(src);
  const node = (elapsed: number, match: string) => m.frameAt(elapsed).nodes.find(n => n.key.includes(match))!;
  const input = node(200, 'in0');
  const end = node(400, 'in0');
  assert.equal(Number(input.attrs.y), (Number(end.attrs.y) + 40.4) / 2); // source baseline 40.4, destination baseline 240.4
  assert.equal(visibleCombine(m, 800).length, 3);
  assert.equal(Number(node(1400, 'op1').attrs.opacity), 0.5);
  const result = m.frameAt(1400).nodes.find(n => n.tag === 'text' && n.text === '22')!;
  assert.equal(Number(result.attrs.opacity), 0.5);
  assert.equal(result.attrs.transform, undefined); // fade, not pop
  assert.equal(visibleCombine(m, 1800).length, 0);
  assert.equal(m.beats[1].end - m.beats[1].start, 4000);
  assert.match(m.slideSvgAt(2), />22</);
  assert.doesNotMatch(m.slideSvgAt(2), />11</);
});

test('combine: ternary operations, in-place inputs and zero-length phases', () => {
  const src = combineScene.replace('out: array at (0, 200) { capacity: 2 }', 'out: array at (0, 200) { values: [3, 4] }');
  const m = compile(src + '\nstep { out.combine("fma", a, b, out, { fly: 0ms, hold: 500ms, merge: 0ms }) }');
  assert.equal(visibleCombine(m, 250).length, 10);
  assert.match(m.slideSvgAt(2), />13</);
  assert.match(m.slideSvgAt(2), />44</);
  assert.doesNotMatch(m.svgAt(m.duration), /NaN|Infinity/);
});

test('combine: cut and fade preserve their whole-scene semantics', () => {
  for (const kind of ['cut', 'fade']) {
   const m = compile(combineScene + `\nstep (${kind}) { out.combine("+", a, b) }`);
   assert.equal(m.beats[1].end - m.beats[1].start, kind === 'cut' ? 0 : 100);
   assert.equal(visibleCombine(m, 50).length, 0);
   assert.match(m.svgAt(m.duration), />11</);
  }
});

test('combine arrows: selected lanes keep operands stationary and show a complete boxed operation before the result', () => {
  const m = compile(combineScene + '\nstep { out.combine("+", a, b, [1], { style: arrows, label: "ADD", result: fade }) }\nstep { out.highlight(all, good) }');
  const before = m.frameAt(0);
  const paused = m.frameAt(800);
  const nodes = visibleCombine(m, 800);
  assert.equal(nodes.filter(n => n.key.endsWith(':label')).length, 1);
  assert.equal(nodes.find(n => n.key.endsWith(':label'))?.text, 'ADD');
  assert.equal(nodes.filter(n => /:(in[01]|out)$/.test(n.key)).length, 3);
  assert.ok(nodes.every(n => Number(n.attrs.opacity ?? 1) === 1));
  assert.equal(nodes.filter(n => n.origin).length, 0); // no flying operand copies
  for (const source of before.nodes.filter(n => n.key.startsWith('@item:a#') || n.key.startsWith('@item:b#'))) {
    assert.deepEqual(paused.nodes.find(n => n.key === source.key)?.attrs, source.attrs);
  }
  assert.ok(!paused.nodes.some(n => n.tag === 'text' && n.text === '22' && Number(n.attrs.opacity ?? 1) > 0));
  const outgoing = nodes.find(n => n.key.endsWith(':out'))!;
  assert.equal(Number(outgoing.attrs['stroke-dashoffset'] ?? 0), 0);
  const midway = visibleCombine(m, 150).find(n => n.key.endsWith(':in0'))!;
  assert.ok(Number(midway.attrs['stroke-dashoffset']) > 0);
  assert.equal(visibleCombine(m, 1750).length, 0);
  assert.equal(m.beats[2].end - m.beats[2].start, 100);
  assert.doesNotMatch(m.slideSvgAt(2), />11</);
  assert.match(m.slideSvgAt(2), />22</);
  assert.doesNotMatch(m.slideSvgAt(2), /cmb:/);
});

test('combine arrows: all lanes, ternary in-place operations, removed sources and zero-length phases', () => {
  const m = compile(combineScene + '\nstep { out.combine("+", a, b, { style: arrows }) }\nstep { remove a, b }');
  assert.equal(visibleCombine(m, 800).filter(n => n.key.endsWith(':bubble')).length, 2);
  assert.equal(visibleCombine(m, 800).filter(n => n.key.endsWith(':label') && n.text === '+').length, 2);
  assert.match(m.slideSvgAt(2), />11</);
  const src = combineScene.replace('out: array at (0, 200) { capacity: 2 }', 'out: array at (0, 200) { values: [3, 4] }');
  const ternary = compile(src + '\nstep { out.combine("fma", a, b, out, { style: arrows, fly: 0ms, hold: 500ms, merge: 0ms }) }');
  assert.equal(visibleCombine(ternary, 250).filter(n => /:in[012]$/.test(n.key)).length, 6);
  assert.match(ternary.svgAt(ternary.duration), />13</);
  assert.match(ternary.svgAt(ternary.duration), />44</);
  assert.doesNotMatch(ternary.svgAt(250), /NaN|Infinity/);
  for (const kind of ['cut', 'fade']) {
    const cut = compile(combineScene + `\nstep (${kind}) { out.combine("+", a, b, { style: arrows }) }`);
    assert.equal(visibleCombine(cut, 50).length, 0);
    assert.match(cut.svgAt(cut.duration), />11</);
  }
});

test('combine: invalid options produce DSL errors', () => {
  for (const [opts, message] of [
   ['{ fly: -1s }', /fly must be a non-negative duration/],
   ['{ hold: "slow" }', /hold must be a non-negative duration/],
   ['{ fly: 0ms, hold: 0ms, merge: 0ms }', /total duration must be greater than zero/],
   ['{ flyEasing: typo }', /unknown easing/],
   ['{ result: typo }', /result must be one of/],
   ['{ style: typo }', /style must be expression or arrows/],
   ['{ operator: draw }', /operator must be one of/],
   ['{ typo: 1s }', /unknown option/],
  ] as const) assert.throws(() => compile(combineScene + `\nstep { out.combine("+", a, b, ${opts}) }`), message);
});

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
