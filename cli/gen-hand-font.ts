// Builds assets/fonts/KinoHand-Regular.otf: Patrick Hand plus the glyphs it lacks
// (arrows, check marks) borrowed from Fantasque Sans Mono, so text in the sketch
// theme never falls back to another font mid-line. Both fonts are OFL; the result
// is renamed as the license asks of modified versions.
//   npx tsx cli/gen-hand-font.ts && npx tsx cli/gen-metrics.ts
// @ts-ignore no types shipped
import opentype from 'opentype.js';

const base = opentype.loadSync('assets/fonts/PatrickHand-Regular.ttf');
const donor = opentype.loadSync('assets/fonts/FantasqueSansMono-Regular.ttf');
const ADD = '←→↑↓✓✗';

const glyphs: any[] = [];
for (let i = 0; i < base.glyphs.length; i++) glyphs.push(base.glyphs.get(i));

const k = base.unitsPerEm / donor.unitsPerEm;
// Patrick Hand's figures are a little lighter and narrower than Fantasque's
const scale = k * 0.95;
for (const c of ADD) {
  if (base.charToGlyph(c).index !== 0) continue;
  const g = donor.charToGlyph(c);
  const path = new opentype.Path();
  for (const cmd of g.path.commands) {
    const t: any = { type: cmd.type };
    for (const key of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) if (cmd[key] !== undefined) t[key] = cmd[key] * scale;
    path.commands.push(t);
  }
  glyphs.push(new opentype.Glyph({ name: `uni${c.codePointAt(0)!.toString(16).toUpperCase()}`, unicode: c.codePointAt(0), advanceWidth: Math.round(g.advanceWidth * scale), path }));
}

const font = new opentype.Font({
  familyName: 'Kino Hand',
  styleName: 'Regular',
  unitsPerEm: base.unitsPerEm,
  ascender: base.ascender,
  descender: base.descender,
  designer: 'Patrick Wagesreiter (Patrick Hand); arrows from Fantasque Sans Mono by Jany Belluz',
  license: 'SIL Open Font License 1.1',
  glyphs,
});
const buf = Buffer.from(font.toArrayBuffer());
(await import('node:fs')).writeFileSync('assets/fonts/KinoHand-Regular.otf', buf);
console.log(`wrote assets/fonts/KinoHand-Regular.otf (${glyphs.length} glyphs, ${buf.length} bytes)`);
