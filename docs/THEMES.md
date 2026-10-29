# Themes

A theme decides how a video looks: colors, fonts, outlines, paper textures.
The script stays the same; switching theme restyles everything.

## Built-in themes

| Theme | Look |
|---|---|
| `neon` (default) | Deep navy background with soft light blobs and a vignette, translucent panels, cyan and pink accents, glows on highlights. Inter + JetBrains Mono. `examples/registers.kino` shows it. |
| `sketch` | Pencil and watercolor on paper: handwriting (Kino Hand: Patrick Hand plus arrows and check marks, built by `cli/gen-hand-font.ts`), thin graphite outlines drawn twice with overshooting corners, fills painted as uneven watercolor washes with darker edges, paper grain, and soft watercolor halos instead of glows. Code blocks use a hand-drawn monospace (Fantasque Sans Mono). `examples/columnar-compression.kino` uses it. |
| `comic` | A comic book: newsprint paper with halftone dots and an inked panel frame, thick ink outlines with solid offset shadows, flat primary colors, Bangers lettering for headlines and captions (title cards burst out of a red starburst), Comic Neue for text. Glows become hard colored rims. |
| `blueprint` | An engineering blueprint: cyanotype blue paper with a drafting grid (stronger lines every five cells) that pans and zooms with the camera, white and pale-cyan line work, square-cornered panels, JetBrains Mono lettering for captions and a thin drawing border. |
| `whiteboard` | A doodle on a whiteboard: thin, wobbly black-pen outlines drawn once, bright felt-marker fills laid flat and a little off the lines, big lettering in color outlined in black, handwriting for text and code, dashed doodle loops around highlighted things, highlighter strokes on code lines, white panels, and a dark board frame around the picture. |
| `pixel` | 8-bit pixel art: the Sweetie 16 palette on a dark LCD grid, Press Start 2P for captions and tabs, VT323 for headlines and text, square corners snapped to 4px pixels (so things move in steps), stepped circles, no anti-aliasing, hard drop shadows, and colored rims instead of glows. |
| `paper-cut` | Layered paper craft: every shape is a piece of paper cut by hand (straight snips that wander off the exact outline, the same every frame) with visible fibres, laid on a colored card with no outlines; each layer casts a tight contact shadow plus a soft one, highlights become a colored paper mat behind the piece, and text uses the rounded Fredoka. |
| `dark`, `light` | Plain, flat versions of the above. |

## Choosing a theme

In the script:

```kino
video { theme: sketch }
```

From the command line, overriding the script:

```sh
npm run render -- file.kino --theme sketch     # also: npm run check -- file.kino --theme sketch
make render THEME=neon
```

In the studio, the theme selector in the header does the same (your choice is
remembered).

## Tweaking a theme

Every theme is a set of named values ("tokens"). Start from a theme with
`base` and override the tokens you want:

```kino
video { theme: { base: sketch, accent: "#c0392b" } }
```

All tokens and their defaults live in [`src/core/theme.ts`](../src/core/theme.ts).

**Colors:** `bg`, `fg`, `muted`, `accent`, `accent2`, `good`, `bad`, `warn`,
`info`, the `code*` colors and the rest listed in `theme.ts`. Scripts can use
these names wherever a color is expected.

**Fonts:** `fontSans`, `fontMono`, `fontCaption` (captions, tabs and eyebrows),
`fontCode` (code blocks), `fontTitle` and `titleTracking` (title-card
headlines).

**General:** `tint` (strength of highlight fills), `shade` (what a spotlight
dims with).

**Paper look:** `roughness` (how far pencil strokes stray from the exact
shape; `0` is crisp vector), `watercolor` (fills as washes), `paperGrain`
(grain opacity) and `fauxBold` (bold for single-weight handwriting fonts).

**Slide templates:**
- `edgeLeft`/`edgeRight`/`edgeWidth`: gradient side bars.
- `padding`: space kept clear around every slide, as fractions of the frame,
  CSS-like. `"0, 0.09"` keeps 9% clear left and right, e.g. for side bars in
  line with the footer.
- `footerLeft`/`footerCenter`/`footerRight`: footer texts. Override them per
  script, e.g. `video { theme: { base: light, footerCenter: "KubeCon 2026" } }`.
- `titleStyle: bar` with `titleBackdrop`: cover-style title cards.
- `brandGradient`: the `brand` color (`stroke: brand` for gradient rings).
- `panelRadius`/`panelShadow`: white cards.

**Comic:** `inkWidth` (outline width; glows become hard rims), `inkShadow`
(offset of the solid shadows), `halftone`/`halftoneColor` (dots towards the
edges), `frameBorder` (the panel frame) and `titleStyle: burst`.

**Whiteboard:** `marker` (with `roughness`: outlines as single black pen
strokes this many px wide, flat marker fills slightly off the lines, outlined
colored headlines and dashed loops for glows), `board`/`boardColor` (a
whiteboard frame this many px wide around the picture).

**Pixel:** `pixel` (the size of one screen pixel: shapes snap to it, circles
become stepped, edges stay crisp, opaque shapes cast hard shadows).

**Paper cut:** `paperCut` (shapes become hand-cut paper pieces without
outlines, with fibres when `paperGrain` is set, and shadows this dark).

**Drafting grid:** `grid`/`gridMajor`/`gridColor`/`gridOpacity` (cell size in
px, a stronger line every N cells; blueprint's is `24`, `5`).

## How the paper look works

The paper look costs no SVG filters: when the SVG is written,
[`src/core/sketch.ts`](../src/core/sketch.ts) redraws each rect, line and
circle as pencil strokes and washes, seeded by the shape's key so it keeps its
look while it moves. The grain is a small pre-rendered tile
(`cli/gen-grain.ts`) repeated over the frame. A sketch frame renders about as
fast as a neon one.

## Fonts

All fonts are bundled in `assets/fonts` (OFL). The CLI renderer, the live
preview and the browser exporter use the same files, and text layout uses
advance widths generated from them (`npx tsx cli/gen-metrics.ts`), so it's
exact. To add a font, put its `.ttf` files there, list them in
`cli/gen-metrics.ts` and `frontend/fonts.ts`, and regenerate the metrics.
