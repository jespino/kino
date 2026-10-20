// Smoke tests: every example compiles and renders sane SVG at many points in time,
// plus a few targeted checks of DSL behaviour.
import { readdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { collectNarration, compile, extractImages, imageAsset, imageSize, KinoError } from '../src/index.ts';
import { gauge } from '../examples/widgets/gauge.ts';
import { twemoji } from '../src/node/emoji.ts';

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

for (const theme of ['dark', 'light', 'sketch']) {
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

test('slides: one beat per transition, holds and waits skipped', () => {
  const m = compile('video { transition: 500ms }\nframe { a: array }\nstep { a.push(1) then a.push(2) }\nwait 2s\nstep (cut) { a.push(3) }');
  assert.equal(m.beats.length, 4);
  assert.deepEqual(m.beats.map((b) => b.end - b.start), [0, 500, 500, 0]);
  assert.equal(m.beatAt(0), 1);
  assert.match(m.slideSvgAt(4), />3</);
  assert.doesNotMatch(m.slideSvgAt(3), />3</);
  assert.ok(!/NaN|undefined/.test(m.slideSvgAt(1, 250)));
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

console.log(failures ? `\n${failures} failing` : '\nall passed');
process.exit(failures ? 1 : 0);
