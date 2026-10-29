# Developing Kino

How Kino works inside, where the code lives, and how to extend it.

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

## Code layout

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

## Kino Studio internals

The studio's backend is Go (`internal/app`): projects, the file watcher, the
terminals, and the `/__kino/*` endpoints for narration audio, images and
saving exports. The UI talks to it through the Wails runtime in the app, or
over HTTP (`kino serve`) in a browser, which is also how the UI is tested. The
TTS server is a separate process (`npm run tts`).

The studio builds with [Wails 3](https://v3.wails.io). `make install` installs
the pinned `wails3` tool if it's missing; to build by hand:

```sh
go install -tags gtk3 github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.33
make app               # wails3 task build -> bin/kino, without installing it
bin/kino [project]     # run it from the repo
make app-dev           # wails3 task dev: the app with hot reload through Vite
make app-package       # .deb/.rpm/AppImage on Linux, .app on macOS, installer on Windows
make dev PROJECT=...   # the same UI in a browser: `kino serve` + Vite (http://127.0.0.1:5173)
```

On Linux the app builds against GTK3 / WebKitGTK 4.1 (`libgtk-3-dev`,
`libwebkit2gtk-4.1-dev`) through the `gtk3` build tag. To use Wails' default
GTK4 / WebKitGTK 6.0 instead, install `libgtk-4-dev libwebkitgtk-6.0-dev` and
build with `wails3 task build EXTRA_TAGS=` (and `GO_TAGS=` for `make dev`).

When an agent starts, the studio writes the context it needs into the project:
`AGENTS.md` (plus `CLAUDE.md`/`GEMINI.md` pointing to it), the DSL reference in
`.kino/docs/DSL.md` and the skill in `.claude/skills/kino/`. After every compile
it writes `.kino/status.json` (errors with `line:col`, the step timeline), which
is how the agent checks its edits without the Node CLI.

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
- **Studio:** add it to [`frontend/widgets.ts`](../frontend/widgets.ts).
- **Library:** `compile(source, { widgets: [gauge] })`.

Widget API (see [`src/core/widget.ts`](../src/core/widget.ts)):

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
