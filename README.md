# Kino

Describe explanatory animations as text and get a video out of them. Kino is
aimed at concept animations: how slices work, a sorting algorithm, a code
refactor, a UI walkthrough.

```kino
frame "a slice is a header + a backing array" {
  s: struct at (90, 170) { title: "s", fields: { ptr: "•", len: 0, cap: 4 } }
  data: array at (470, 166) { label: "backing array", capacity: 4 }
  ptr: s.ptr -> data[0]
}

step "append(s, 1)" {
  data.push(1)
  s.len = 1
}

step "grow" {
  data2: array at below(data, 90) { capacity: 8 }
then
  data2.copyFrom(data)        // copies fly from the old array to the new one
then
  ptr.to = data2[0]           // the arrow re-routes smoothly
  s { len: 5, cap: 8 }
}
```

The full language reference is in [docs/DSL.md](docs/DSL.md). The examples are in [examples/](examples).

## Writing scripts with Claude Code

The repo includes a project skill, `.claude/skills/kino/SKILL.md`, that teaches
Claude Code the whole language, the authoring workflow and the house style. Ask
for an explainer ("make a kino video explaining how hash maps resize") and
Claude will:
1. write the `.kino` file
2. validate it with `npm run check`
3. inspect a contact sheet (`npm run check -- file.kino --sheet out/sheet.png`)
4. render it

You can also invoke it explicitly with `/kino`.

## Look and themes

| Theme | Look |
|---|---|
| `neon` (default) | Deep navy background with soft light blobs and a vignette, translucent panels, cyan and pink accents, glows on highlights. Inter + JetBrains Mono. `examples/registers.kino` shows it. |
| `sketch` | Pencil and watercolor on paper: handwriting (Kino Hand: Patrick Hand plus arrows and check marks, built by `cli/gen-hand-font.ts`), thin graphite outlines drawn twice with overshooting corners, fills painted as uneven watercolor washes with darker edges, paper grain, and soft watercolor halos instead of glows. Code blocks use a hand-drawn monospace (Fantasque Sans Mono). `examples/columnar-compression.kino` uses it. |
| `comic` | A comic book: newsprint paper with halftone dots and an inked panel frame, thick ink outlines with solid offset shadows, flat primary colors, Bangers lettering for headlines and captions (title cards burst out of a red starburst), Comic Neue for text. Glows become hard colored rims. |
| `dark`, `light` | Plain, flat versions of the above. |

Pick one in the script with `video { theme: sketch }`, tweak tokens with
`video { theme: { base: sketch, accent: "#c0392b" } }`, or override the
script's theme from outside it:

```sh
npm run render -- file.kino --theme sketch     # also: npm run check -- file.kino --theme sketch
make render THEME=neon
```

In the studio, the theme selector in the header does the same (your choice is
remembered).

Besides colors, a theme sets fonts (`fontSans`, `fontMono`, `fontCaption` for
captions, tabs and eyebrows, `fontCode` for code blocks, `fontTitle` and
`titleTracking` for title-card headlines), `tint` (strength of
highlight fills), `shade` (what a spotlight dims with) and the paper look:
`roughness` (how far pencil strokes stray from the exact shape; `0` is crisp
vector), `watercolor` (fills as washes), `paperGrain` (grain opacity) and
`fauxBold` (bold for single-weight handwriting fonts). Slide-template themes also set `edgeLeft`/`edgeRight`/`edgeWidth` (gradient side
bars), `footerLeft`/`footerCenter`/`footerRight` (footer texts; override them per
script, e.g. `video { theme: { base: light, footerCenter: "KubeCon 2026" } }`),
`titleStyle: bar` with `titleBackdrop` (cover-style title cards), `brandGradient`
(the `brand` color) and `panelRadius`/`panelShadow` (white cards). Comic themes
set `inkWidth` (outline width; glows become hard rims), `inkShadow` (offset of
the solid shadows), `halftone`/`halftoneColor` (dots towards the edges),
`frameBorder` (the panel frame) and `titleStyle: burst`. All of them
live in [`src/core/theme.ts`](src/core/theme.ts).

The paper look costs no SVG filters: when the SVG is written,
[`src/core/sketch.ts`](src/core/sketch.ts) redraws each rect, line and circle
as pencil strokes and washes, seeded by the shape's key so it keeps its look
while it moves. The grain is a small pre-rendered tile (`cli/gen-grain.ts`)
repeated over the frame. A sketch frame renders about as fast as a neon one.

All fonts are bundled in `assets/fonts` (OFL). The CLI renderer, the live
preview and the browser exporter use the same files, and text layout uses
advance widths generated from them (`npx tsx cli/gen-metrics.ts`), so it's
exact. To add a font, put its `.ttf` files there, list them in
`cli/gen-metrics.ts` and `frontend/fonts.ts`, and regenerate the metrics.

## Quick start

```sh
npm install
make app && bin/kino examples/go-slices.kino   # Kino Studio: preview, timeline, agent terminal (see below)
npm run render -- examples/go-slices.kino -o out/go-slices.mp4
npm run render -- examples/go-slices.kino --png out/frame.png --at 3.5s
npm run render -- examples/go-slices.kino -o out/go-slices.pdf   # slides as a PDF: a page per step and sub-step
npm run check -- file.kino      # validate: errors with line numbers, step timeline, narration status
npm test                        # compiles + renders every example, plus DSL checks
```

### Narration (text to speech)

`say "..."` lines are spoken by an AI voice: **[Kitten TTS 2](https://github.com/KittenML/KittenTTS)**
(`KittenML/kitten-tts-2`), running on the GPU (CUDA or ROCm, CPU fallback) in a small local Python server.
Kitten TTS 2 gives you 47 voices, emotion tags (`[joyful]`, `<laugh>`,
`(((stress)))`), 20 languages and voice cloning from a short recording.

```sh
npm run tts:setup      # once: tts/.venv with Python 3.12, torch for your GPU (auto-detected) and kittenml
npm run tts            # start the server on http://127.0.0.1:8808 (downloads the model, ~1 GB, on first run)
```

- **Studio:** when you press Play, missing clips are generated (with progress),
  cached, and then played in sync with the animation. While you edit, steps use
  real durations for cached clips and estimates for the rest. The current line
  is shown as a subtitle.
- **CLI:** `npm run render` generates missing clips the same way and mixes
  them into the video (AAC in MP4, Opus in WebM). `--no-audio` skips audio.
  `--tts <url>` points at another server.
- The studio's **Export** menu: **Video (MP4)** also includes the narration
  (Opus track). **Web page (HTML)** writes one self-contained file that plays in
  any browser, offline: the engine, the script, the theme's fonts, pictures,
  emoji and the narration track are all inline. It has a video mode (scrubber
  with step marks, subtitles) and a slides mode (`s`), and takes deep links
  (`#t=12.5`, `#slide=3`). **Slides (PDF)** exports the slides: a page for every step and every
  `then` sub-step (what Present mode stops on), without narration. A step that
  only plays effects (bursts, clicks, bounces) is shown halfway through them.
  **Current frame (SVG)** saves the frame at the playhead.
- **Cache:** `.kino-cache/tts/<hash>.wav`, keyed by the text and all voice
  settings. The CLI and the studio share it. Delete a file to
  regenerate that line.
- Qwen3-TTS models still work as an alternative: run `tts/setup.sh --with-qwen`,
  then set `voice: { model: "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", speaker: Ryan }`.
- **Other voices:** each project picks its narration provider in the studio's
  **Settings → This project** (saved as `kino.json` next to the script): the local
  Kitten server, **ElevenLabs** or **OpenAI** (hosted), or the classic **espeak-ng** and
  **festival** synthesizers. API keys and programs are set once in **Settings → Kino**
  (`~/.config/kino/config.json`). See [docs/DSL.md](docs/DSL.md#narration-providers).
- `KINO_TTS_URL` and `KINO_CACHE` override the server and cache locations.
  The server uses the GPU when torch sees one; `npm run tts -- --device cpu` forces CPU.

In the studio, use Space to play or pause and ←/→ to jump between steps.
Ctrl+Enter plays from the step under the cursor. Click an error to jump to
its line.

### Presenting (slides mode)

Press **Present** in the studio to show the animation fullscreen as slides, or
**Window** next to it to show the slides filling the browser window without
going fullscreen (handy when sharing a single window in a call, or to keep other
windows around). It starts at the current position. Each click, Space, → or Enter plays exactly
one transition (a `frame`, a `step` or a `then` sub-step) and then waits.
Holds, `wait`s and narration pauses are skipped, and narration isn't played,
so you can talk over it yourself. Pressing again during a transition finishes it.

| Key | Action |
|---|---|
| click, Space, →, ↓, Enter, PageDown | next transition |
| ←, ↑, Backspace, PageUp, right-click | previous state (instant) |
| `]` / `[` | next / previous whole step |
| Home / End | first / last state |
| `f` | switch between fullscreen and window |
| Esc | leave (the studio jumps to the slide you were on) |

PDF pages are pictures of the slides at twice the video size (`--scale`
changes it), so every theme looks exactly as in the video; each page is the
size of the video in points. The studio stores pages as JPEG and the CLI as
PNG, which is sharper but larger for paper-textured themes.

The CLI needs `ffmpeg` on the PATH. It writes `.mp4`, `.webm` or `.gif`
depending on the extension, and renders frames in parallel.

## Kino Studio

Kino Studio is a desktop app (built with [Wails 3](https://v3.wails.io)) for
working on one animation at a time, laid out like a video editor:

- **Preview** (top left): the animation at the playhead, with subtitles for
  the narration and play/step/speed controls. Next to it, the **Source**
  panel (Ctrl+2) edits the script; it is saved as you type.
- **Timeline** (bottom): the movie as tracks. The *Steps* track shows every
  `frame`, `step`, `say` and `wait`, with each transition (and `then`
  sub-step) drawn over it: two crossed lines for a fade, one diagonal for a
  morph, a marker for a cut. *Voice* shows the narration clips (dashed while
  their length is still an estimate), *Camera* the camera moves, and below
  them every element gets a row: a bar while it is on stage (fading in and out
  over its enter and exit transitions) and a mark each time a step changes it
  (◆ a property, ● a method call, ★ an effect such as `bounce()`). Click to
  seek, double-click to jump to the line in the source, hover for details,
  Ctrl+wheel to zoom.
- **Agent** (right): a terminal running your coding agent (Claude Code,
  Codex, Gemini CLI, Antigravity) or a shell in the project folder.

A **project** is a folder: a `.kino` script holds the whole animation, and the
assets it references (pictures for `image`, voice recordings for cloning) live
next to it. Open a folder (or a script) from the welcome screen, the project
menu or the command line; start a new one empty or from an example; recent
projects are remembered. The studio watches the script, so edits made by the
agent or another editor show up at once. If the script stops compiling, the
last good version keeps playing and the error points at its line.

When an agent starts, the studio writes the context it needs into the project:
`AGENTS.md` (plus `CLAUDE.md`/`GEMINI.md` pointing to it), the DSL reference in
`.kino/docs/DSL.md` and the skill in `.claude/skills/kino/`. After every compile
it writes `.kino/status.json` (errors with `line:col`, the step timeline), which
is how the agent checks its edits without the Node CLI. Narration clips are
cached per project in `.kino-cache/` (`KINO_CACHE` overrides it).

```sh
go install -tags gtk3 github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.33
make app               # wails3 task build      -> bin/kino
bin/kino [project]     # a folder holding a .kino script, or the script itself
make app-dev           # wails3 task dev: the app with hot reload through Vite
make app-package       # .deb/.rpm/AppImage on Linux, .app on macOS, installer on Windows
make dev PROJECT=...   # the same UI in a browser: `kino serve` + Vite (http://127.0.0.1:5173)
```

The studio's backend is Go (`internal/app`): projects, the file watcher, the
terminals, and the `/__kino/*` endpoints for narration audio, images and
saving exports. The UI talks to it through the Wails runtime in the app, or
over HTTP (`kino serve`) in a browser, which is also how the UI is tested. The
TTS server is still a separate process (`npm run tts`).

On Linux the app builds against GTK3 / WebKitGTK 4.1 (`libgtk-3-dev`,
`libwebkit2gtk-4.1-dev`) through the `gtk3` build tag. To use Wails' default
GTK4 / WebKitGTK 6.0 instead, install `libgtk-4-dev libwebkitgtk-6.0-dev` and
build with `wails3 task build EXTRA_TAGS=` (and `GO_TAGS=` for `make dev`).

## Prior art and what Kino borrows

There's no industry-standard text format for this kind of animation. The
nearest tools each cover only part of it:

| Tool | What it is | What Kino takes from it |
|---|---|---|
| [Manim](https://www.manim.community/) | Python library for math animations (3Blue1Brown) | the "scene + animate changes" mental model |
| [Motion Canvas](https://motioncanvas.io/), [Remotion](https://www.remotion.dev/) | TypeScript/React code → video | deterministic **time → frame** rendering, so the preview and the export match exactly |
| [D2](https://d2lang.com/), [Mermaid](https://mermaid.js.org/) | text → static diagrams | the declaration syntax: `name: type { ... }` and `a -> b` connections |
| Keynote Magic Move, [reveal.js auto-animate](https://revealjs.com/auto-animate/), [Shiki Magic Move](https://github.com/shikijs/shiki-magic-move) | animate between two slides by matching elements | **the core animation model**: keyed morphing between states |
| CSS transitions | | durations (`600ms`), easing names (`ease-in-out`) |

Manim and Motion Canvas are programming libraries: you write code that drives
the animation. Kino is declarative. You describe **states** and the engine works
out the motion. That keeps scripts short enough to write by hand or generate
with an LLM.

## How it works

```
 .kino text ──► parser ──► AST ──► SceneBuilder ──► scene states (S0, S1, S2, ...)
                                   (runs statements,      │  plain JSON: widgets + props + camera
                                    widget methods)       ▼
                                               Renderer / layout
                                     (widget.render → keyed SVG primitives,
                                      positions, anchors, relative layout)
                                                          │  frames F0, F1, F2 ...
                                                          ▼
                    Movie.frameAt(t) = interpolate(Fi, Fi+1, ease(p))   ◄── timeline segments
                                                          │
                                         frameToSVG ──────┴──► browser <svg> / resvg → ffmpeg
```

- **States, not animations.** Each `step` produces a new scene state. Animation
  happens only *between* states.
- **Keyed primitives.** A widget renders to flat SVG primitives (`rect`, `text`,
  `path`, ...), each with a `key`. Between two frames, nodes with the same key
  tween all numeric attributes, colors and compatible paths. New keys play their
  `enter` effect and vanished keys play their `exit` effect. Text changes
  crossfade.
- **Identity matters.** Array items, table rows and list items get stable ids,
  so `swap`, `sort` and `insert` look like things moving rather than
  re-rendering. Keys starting with `@` are global, which lets an item fly from
  one widget to another. `origin` lets a new node start from an existing one,
  which is how `copyFrom` works.
- **Deterministic.** `movie.svgAt(t)` is a pure function of `t`. The browser
  preview, the in-browser WebCodecs MP4 export and the Node renderer (resvg +
  ffmpeg) all produce the same frames.

```
src/dsl/        lexer, parser, AST
src/core/       values, scene (statement execution), render (layout), animate
                (interpolation + effects), movie (timeline), timeline (steps and
                element lifespans for the studio), svg, theme, text metrics
src/widgets/    built-in widgets
frontend/       Kino Studio UI (React + Vite): preview, timeline, source, agent terminal
main.go         Kino Studio (Wails 3): embeds frontend/dist; `kino serve` for browsers
internal/app/   studio backend: projects, file watching, narration/image endpoints
internal/terminal/  agent terminals (PTYs)    internal/agentctx/  context files for agents
internal/server/    HTTP adapter for `kino serve`
build/          Wails build config, icons and packaging (Linux, macOS, Windows)
cli/            render.ts (video/PNG/SVG), smoke.ts (tests)
src/node/       TTS clip cache for the CLI (internal/app/studio.go uses the same layout)
tts/            server.py (TTS HTTP server: Kitten TTS 2, optionally Qwen3-TTS), setup.sh
examples/       .kino examples + widgets/gauge.ts (a custom widget)
```

## Built-in widgets

`label`, `box`, `circle`, `button`, `array`, `struct`, `matrix`, `table`,
`list`, `code`, `tabs`, `title`, `emoji`, `image`, `merge`, `tree`, `memory`, `bits`, `arrow`,
`pointer`, `cursor`, `callout`, `brace`, `spotlight`, plus a built-in
`camera`. Any widget can be wrapped in a captioned, optionally glowing panel
with `panel: "Caption"`. Their
properties, methods and anchors are listed in [docs/DSL.md](docs/DSL.md#widgets).

## Writing your own widget

A widget is a TypeScript object with:
- default props
- optional methods (the DSL verbs)
- a `render` function that returns keyed SVG primitives in local coordinates

Positioning, anchors for arrows, and all animation come from the engine.

```ts
import { defineWidget, h, values } from 'kino';   // or '../src/index.ts'

export const gauge = defineWidget({
  type: 'gauge',
  defaults: { value: 0, label: '', r: 70, color: 'accent' },
  methods: {
    add(p, [n]) { p.value = Math.min(100, p.value + values.num(n)); },
  },
  render(p, rc) {
    const c = p.r + 10, len = 2 * Math.PI * p.r;
    return [
      h.circle('track', c, c, p.r, { fill: 'none', stroke: rc.theme.surface, 'stroke-width': 14 }),
      h.circle('arc', c, c, p.r, {
        fill: 'none', stroke: rc.color(p.color, 'accent'), 'stroke-width': 14,
        'stroke-dasharray': `${(len * p.value) / 100} ${len}`,   // tweened automatically
        transform: `rotate(-90 ${c} ${c})`,
      }),
      h.text('value', c, c + 10, `${p.value}%`, { 'text-anchor': 'middle', fill: rc.theme.fg }),
    ];
  },
  // optional: expose parts for arrows/pointers, e.g. `g.center`
  // anchor(p, path, rc) { ... return rect }
});
```

Then use it as `cpu: gauge at (200, 200) { value: 40 }` and `cpu.add(30)`.

- **CLI:** `npm run render -- file.kino --widgets path/to/widgets.ts`. Every exported widget is registered.
- **Studio:** add it to [`frontend/widgets.ts`](frontend/widgets.ts).
- **Library:** `compile(source, { widgets: [gauge] })`.

Widget API (see [`src/core/widget.ts`](src/core/widget.ts)):

| Hook | Purpose |
|---|---|
| `defaults` | props and their types; string defaults make bare words act as strings |
| `init(props, ctx)` | normalize after declaration (e.g. give items stable ids with `ctx.newId()`) |
| `assign(props, path, value, ctx)` | custom handling of `w.x = v` / `w[i] = v` |
| `methods` | `w.method(args)` |
| `render(props, rc)` | primitives; `rc.color()`, `rc.measure()`, `rc.theme`, `rc.anchor(ref)`; helpers `glowRect()`, `captionAttrs()` for the house style |
| `anchor(props, path, rc)` | local rect of a part (`w[2]`, `w.field`) for arrows, pointers and relative layout |
| `overlay: true` | drawn in global coordinates from references (like `arrow`); ignores `at` |
| `placed(props, rc, self)` | extra nodes in global coordinates once the widget is placed (`self.bbox`, `self.dx/dy`), e.g. particles flying in from other widgets (`merge` ribbons and pulses) |

Node extras: `enter`/`exit` effects, `origin` (start from another node's
state), `transient` (only visible while appearing, used for click ripples),
`delay` (0..1 fraction of the transition to wait before entering, for
staggered entrances like the `title` card).

## Credits

- Fonts: [Inter](https://rsms.me/inter/), [JetBrains Mono](https://www.jetbrains.com/lp/mono/), [Patrick Hand](https://fonts.google.com/specimen/Patrick+Hand) (Patrick Wagesreiter; extended as Kino Hand), [Lato](https://www.latofonts.com/) (Łukasz Dziedzic), [Fantasque Sans Mono](https://github.com/belluzj/fantasque-sans) (Jany Belluz), [Bangers](https://github.com/googlefonts/bangers) (Vernon Adams) and [Comic Neue](https://github.com/crozynski/comicneue) (Craig Rozynski), SIL Open Font License.
- Emoji artwork: [Twemoji](https://github.com/jdecked/twemoji) (`@twemoji/svg`). Graphics are licensed CC-BY 4.0; credit Twemoji when you publish videos that use them.

## Current limitations and ideas

- Text metrics cover Latin text in the bundled fonts. Other scripts and emoji
  fall back to system fonts and estimated widths.
- Numbers crossfade rather than count up. Per-statement timing within a step
  is limited to `then` (no stagger or overlap offsets yet).
- There's no background music track yet.
- The studio's timeline is for reading and navigating: dragging a transition
  to change its duration isn't supported yet. The source editor has
  highlighting but no completion.
- Grouping/nesting of widgets isn't supported yet. Images can't have rounded corners or masks.
