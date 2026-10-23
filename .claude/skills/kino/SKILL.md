---
name: kino
description: Write, extend or fix .kino animation scripts (the Kino DSL in this repo) that explain technical concepts as narrated videos — data structures, algorithms, memory layouts, CPU/registers/SIMD, code walkthroughs, UI tours. Use when the user asks for a new animation/video/explainer, a .kino file, or changes to an existing one. Covers the whole language: frames/steps/then/wait, positioning, all widgets (label, box, circle, button, array, struct, matrix, table, list, code, tabs, title, emoji, tree, memory, bits, arrow, pointer, cursor, callout, brace, spotlight), camera, emphasis actions, themes, narration (say/voice, Kitten TTS 2), and how to validate and render.
---

# Writing Kino animations

Kino turns a text script into a video. You declare **widgets**, then **change
them step by step**. The engine animates every change by matching what's on
screen before and after each step ("magic move"). You describe **states**,
never motion paths.

Full reference: `docs/DSL.md`. Working examples: `examples/*.kino`. Read the
example closest to the request before writing (`registers.kino` for CPU topics,
`simd-avx.kino` for register lanes, `go-slices.kino` for memory and pointers,
`bubble-sort.kino` for algorithms, `code-morph.kino` for code, `ui-walkthrough.kino`
for UIs, `emoji-fun.kino` for emoji).

## Workflow

1. **Plan the story first.** Decide what to show, in about 5–12 beats. Each beat
   is one `step` with one idea, with one narration line when narrated. Pick the
   widgets that model the concept (raw bytes → `memory`, bit layouts/flags/floats
   → `bits`, value sequences → `array`, record/header/registers → `struct`,
   trees/heaps/linked lists → `tree`, grid → `matrix`, code → `code`, pointers
   → arrows, indexes → `pointer`). Explain with `callout`, group spans with
   `brace`, and focus attention with `spotlight`.
2. **Write the file**, usually `examples/<topic>.kino` or where the user asks.
   Start with a `video {}` block and a `title` card frame.
3. **Validate**: `npm run check -- <file>`. It prints errors with `line:col`,
   the step timeline and narration status. Fix and repeat until it shows ✓.
4. **Look at it**: `npm run check -- <file> --sheet out/<name>-sheet.png`, then
   read the PNG. It shows the settled frame at the end of every step. Check for
   overlaps, things off screen, unreadable sizes and empty areas. For a single
   moment: `npm run render -- <file> --png out/x.png --at 12.5s`. Themes have
   different font widths, so if the script may be shown in another theme, check
   that one too (`--theme sketch`).
5. **Render** when asked: `npm run render -- <file> -o out/<name>.mp4` (or
   `-o out/<name>.pdf` for the slides as a PDF, a page per step and `then`
   sub-step). Narration
   is generated if the TTS server runs (`npm run tts`). Add `--no-audio` for a
   silent draft. Or open the project in Kino Studio (`make app`, then
   `bin/kino path/to/project`) for a live preview and a timeline.

## File structure

```kino
video {
  size: (1920, 1080), fps: 30            // 1920x1080 for detailed scenes; default 1280x720
  theme: neon                            // neon (default) | sketch (hand-drawn, paper) | comic (comic book) | dark | light | { base: neon, accent: "#ff0" }
  transition: 700ms, hold: 900ms         // default step animation / pause after each step
  narrationHold: 400ms                   // pause after a step's narration
  easing: ease-in-out
  voice: { speaker: Jasper }                // narration voice (Kitten TTS 2)
}

frame "title" (1500ms, ease-out, hold: 1800ms) {      // a FRESH scene (everything else disappears)
  cover: title at center() { eyebrow: "Go internals", text: "How slices work", subtitle: "headers, arrays, append" }
}

frame "setup" (fade) {                   // next fresh scene, crossfades from the card
  say "A slice is a small header that points into an array."
  s: struct at (90, 170) { title: "s", fields: { ptr: "•", len: 0, cap: 4 } }
  data: array at right-of(s, 140) { label: "backing array", capacity: 4 }
  ptr: s.ptr -> data[0]
}

step "append" (800ms, back-out) {        // CHANGES to the current scene
  say "Append writes into spare capacity."
  data.push(1)
  s.len = 1
then                                     // sequential sub-step (same duration/easing)
  s.highlight(len)
}

wait 1s                                  // hold the picture
say "A line over a still picture."       // top-level narration, holds until spoken
voice { speaker: Victoria }              // change the default voice from here on
```

- `frame` = new scene. Widgets with the same name as in the previous scene
  morph into their new state; others fade.
- `step` (alias `transition`) = modify the current scene.
- Step options, in any order: a duration (`600ms`, `1.2s`); an easing (`linear`,
  `ease`, `ease-in`, `ease-out`, `ease-in-out`, `back-out`, `back-in-out`,
  `spring`, `bounce`); a kind (`morph` (default), `fade`, `cut`); `hold: 2s`.
  The first frame appears instantly unless it has options like `(fade)` or `(1500ms)`.
- Statements in a step animate **together**. `then` splits them into
  consecutive animations. Use `then` for cause → effect (copy, *then* retarget
  the arrow).
- Comments: `// ...`, `/* ... */`, `# ...`.

## Statements

```kino
name: type [at <position>] [{ prop: value, ... }]   // declare or replace
name.prop = value          name[2] = v      m[1][3] = v      s.len = 3
name { a: 1, b: 2 }                                 // set several props
name.method(args)          name[2].highlight()      // = name.highlight(2)
a.part -> b[0] [{ props }]  /  p: a.part -> b[0]    // arrow (named so you can retarget: p.to = c[0])
a --> b                                             // dashed arrow
remove a, b
say "[excited] text <laugh>" [(speaker: Luna, preset: expressive)]
```

**Values:** numbers (also `0xFF`, `0b1010`), `"strings"`, `` `multi-line raw strings` `` (dedented, great
for code), `#hex` colors, `500ms`/`2s`, `true`/`false`, `_` (null/empty), lists
`[..]`, objects `{k: v}`, points `(x, y)`, references `data[0]`, `s.len`, `todo`.
Bare words work as strings where text is expected: `color: warn`,
`font: mono`, `origin: center`, `fields: [ptr, len, cap]`.

**Colors** are theme tokens or CSS colors: `fg muted accent accent2 pink
highlight good bad warn info caption glow surface surface2 border panel bg`.

## Positioning (the coordinate space is the video size)

- `at (x, y)` puts the widget's `origin` there. The default origin is
  `top-left`; others are `top`, `center`, `bottom`, `left`, `right`, plus the
  corners. Use `origin: top` or `origin: center` with x = half the width to
  center something.
- Relative: `at below(w, gap)`, `above(w, gap)`, `right-of(w, gap)`,
  `left-of(w, gap)`. `w` can be a part, like `below(data[2])`. Edges align to
  the start; set `origin: center`/`top` to center-align. `at center()` centers
  on the canvas. `at someWidget` centers on another widget.
- Moving: `w.at = (x, y)` animates.
- Layout recipe for 1920×1080: a 60px margin, the title area at y≈40–150, two
  columns (code/explanations at x≈60–900, data at x≈980–1860). Keep text ≥ 20px,
  and code ≥ 24px in 1080p.

## Widgets

Common props on every widget: `at`, `origin`, `opacity` (`hide()`/`show()`),
`z`, `enter`/`exit` (`fade pop draw slide-up slide-down slide-left slide-right none`),
`panel: "Caption"` (wraps it in a captioned panel), `panelGlow: true`.

**Emphasis methods on every widget** play during their step: `bounce() jump() shake() pulse() spin() wiggle() tada()`.

| Widget | Key props | Methods / assignment | Anchors |
|---|---|---|---|
| `title` | `text` (`\n` ok), `eyebrow`, `subtitle`, `size` (84), `align` | (static card; parts enter staggered) | |
| `label` | `text`, `size`, `color`, `weight`, `font` (sans/mono), `align`, `caps`, `spacing` | `l.text = ...` (crossfades) | |
| `box` / `circle` | `text`, `width`/`height` or `r`, `fill`, `stroke`, `color`, `radius`, `dashed` | | |
| `button` | `text`, `variant` (primary/secondary/danger), `pressed`, `disabled` | `click()`, `press()`, `release()` | |
| `array` | `values`, `capacity` (empty slots), `cell`, `width` (cell width ×), `gap`, `indices`, `label`, `direction` (horizontal/vertical), `size` | `push pop shift unshift insert(i,v) remove(i) set(i,v) swap(i,j) move(a,b) clear reverse sort("desc"?)`, `highlight(i\|[i..]\|all, color)`, `unhighlight(i?)`, `range(name, from, to, color?)` (bracket under cells), `unrange`, `copyFrom(other)` (copies fly), `moveFrom(other, n?)` (first n items fly over), `broadcast(other, i)` (one value fills every slot), `gather(other, [idx or _])` (lane k ← other[idx[k]]: permute/blend), `a[i] = v`, `a.values = [...]` | `a[i]`, `a.<range>` |
| `struct` | `title`, `fields` ({name: value} or [names]), `columns` (grid), `direction`, `colors` ({f: color}), `notes` ({f: "fp"}), `span` ({f: n}), `cellWidth`, `dimZero` | `s.field = v`, `s { a: 1, b: 2 }`, `highlight(field, color)`, `unhighlight(field?)`, `addField`, `removeField` | `s.field` |
| `matrix` | `values` [[..]] or `rows`/`cols`, `cell`, `gap`, `labels` | `m[r][c] = v`, `set fill highlight(r,c,color) highlightRow highlightCol unhighlight` | `m[r][c]`, `m[r]` |
| `table` | `columns`, `rows`, `size`, `mono` | `addRow insertRow(i,..) removeRow setRow set(r,c,v) highlightRow(i,color) unhighlight sortBy(col,"desc"?) clear`, `t[r][c] = v` | `t[r]`, `t[r][c]` |
| `list` | `items`, `bullet` (dot/number/check/none), `size` | `push insert remove set highlight unhighlight check(i) uncheck clear` | `l[i]` |
| `code` | `code`, `lang` (go js ts python rust c cpp sql sh asm), `size`, `lineNumbers`, `title` (header bar), `highlight` (3, "2-4"), `focus`, `glow`, `width` | `highlight(a, b?)`, `focus(a, b?)` (dims the rest), `unfocus`, `unhighlight`; assigning `code` morphs lines (unchanged lines slide) | `c[line]` (1-based) |
| `tabs` | `items`, `active` (0-based), `numbers` | `select(i) next() prev()` | `t[i]` |
| `emoji` | `char`, `size`, `count` (repeat), `gap`, `rotate`, `flip`, `label`, `glow` | `set(c)`, `add(n)`, `remove(n)`, `burst(n?, char?)`, `float(char?)`; changing `char` pops | |
| `merge` | `label`, `width`/`height`, `color`, `spread` | `from(a, b.part, ...)`: ribbons converge from those sources into the hub; `flow()`: pulses run down every ribbon (show the result in a `then`) | `z.in`, `z.out` |
| `image` | `src` (PNG/JPEG/GIF/WebP/SVG file relative to the .kino file, or URL), `width`/`height` (one keeps the aspect ratio), `fit` (contain/cover/fill), `border`, `padding` (photo mat), `rotate`, `label`, `glow` | `img.src = "b.png"` / `set(src)` crossfades | |
| `tree` | `values` (BST by insertion) or `nodes` ({id: [kids]}, `_` = empty slot), `binary`, `labels`, `shape` (circle/box), `r`, `levelGap`, `siblingGap`, `direction` (horizontal = linked list), `arrows` | `insert(v..) delete(v) add(parent, child, side?) remove(id) rotateLeft(id) rotateRight(id) swap(a,b) search(v) highlight(id,color) highlightPath([..]) unhighlight label(id,text)` | `t[id]` |
| `memory` | `size` (bytes) or `bytes`, `base` (address), `columns`, `cell`, `fontSize`, `endian`, `ascii`, `label` | `write(off, v, type?)` (u8..u64 i8..i64 f32 f64 str bytes), `set fill copy(src,dst,len)`, `region(name, from, len, color?, label?)`, `unregion`, `highlight(from, len?, color?)`, `unhighlight` | `m[off]`, `m.<region>` |
| `bits` | `value` (num/`0b..`/`"0101"`), `width`, `format` (dec/hex/signed/float/none), `cell`, `fontSize`, `nibbles`, `label` | `set setFloat shl shr sar rol ror and or xor not setBit clearBit flip`, `group(name, hi, lo, color?, label?)`, `highlight(hi, lo?, color?)`; bit 0 = LSB | `b[i]`, `b.<group>` |
| `callout` (overlay) | `target`, `text` (`\n`), `side` (auto/left/right/above/below), `distance`, `color`, `mono` | retarget by assigning `target` | |
| `brace` (overlay) | `from`, `to`, `side` (below/above/left/right), `label`, `color`, `gap` | | |
| `spotlight` (overlay) | `target`, `padding`, `dim` | `spot.target = x` slides the hole; `remove spot` | |
| `arrow` (overlay) | `from`, `to` (refs or points), `label`, `curve` (-1..1), `color`, `dashed`, `head`, `glow` | retarget: `p.to = x[0]` | |
| `pointer` (overlay) | `target`, `label`, `side` (below/above/left/right), `color` | `j.target = a[3]` slides it | |
| `cursor` (overlay) | `at` (point or widget) | `moveTo(t)`, `click(t?)` (ripple) | |

**Camera:** `camera.focus(widget, 1.8)`, `camera.zoom = 1.5`, `camera.center = (x, y)`, `camera.reset()`.

## Narration (TTS)

- `say "..."` starts with its step (or `then` sub-step). The step lasts until
  both its animation and its speech end, then pauses `narrationHold`.
- Write for the ear: short sentences (8–25 words), one idea each, and spell
  out symbols (`x zero`, not `x0`; `thirty-two bytes`). Put the `say` first
  in the step it describes.
- Expression markup in the text: a leading emotion tag (`[joyful] [excited]
  [tender] [stern] [sad] [nervous] [surprised] [contemplative] [angry]
  [mundane]`), inline sounds (`<laugh> <sigh> <pause> <gasp> <um>` ...),
  and stress (`(((word)))`). Subtitles hide the markup. Use it sparingly.
- Voice settings: `speaker` (default `Jasper`; also `Bella Luna Bruno Rosie
  Hugo Kiki Leo`, and character voices such as `Victoria` (narrator),
  `Marcus` (radio DJ), `Herbert` (professor), `Maeve` (storyteller), `Miles`,
  `Claire`, `Grace`), `language` (`Spanish`, `German`, ... switches to that
  language's voice), `instruct` (an emotion for every line), `preset`
  (`stable`/`expressive`), `reference` (a WAV to clone a voice), `model`,
  `provider`, `speed`. The provider (`local`, `elevenlabs`, `openai`, `espeak`,
  `festival`) and the default voice are normally per project, in `kino.json`
  next to the script (`{"tts": {"provider": "espeak", "voice": {"language": "Spanish"}}}`);
  the project's settings win over `video { voice }`, so don't fight them there;
  `voice {}` / `say (...)` still override per line. API keys live in the user's
  global settings, never in the script or the project.
- Clips are cached in `.kino-cache/tts` by text + voice. Editing a line
  regenerates only that line.

## Style guide

- Open with a `title` card frame, then `frame "..." (fade)` into the content.
- Keep one idea per step and highlight what changed. Use `good` for results,
  `bad` for errors or conflicts, `accent`/`accent2` for the operands being read,
  and `warn` for pointers or windows. Clear highlights in the next step
  (`unhighlight()`), or everything ends up glowing.
- Make data movement visible: prefer `copyFrom`, `gather`, `broadcast`, `swap`
  and `move` (values fly) over reassigning `values` (values crossfade). Use
  assignment for computed results.
- Use `code.highlight(n)` to tie the current step to its source line. Use a
  `label` formula (mono, accent) to state the rule (`ymm2[i] = ymm0[i] + ymm1[i]`).
- Use `panel: "Caption"` to group a widget with an uppercase caption, and
  `panelGlow` / `code.glow` to mark the active area.
- Use emphasis actions sparingly: `shake()` for wrong, `tada()`/`burst()` for
  success, `pulse()` to point at something.

## Pitfalls

- A `frame` drops everything not redeclared. Use `step` to keep the scene.
- Arrays/lists/tables keep item identity: `swap`/`sort`/`insert` move items,
  and highlights follow the item, not the index.
- `then` is not allowed inside `frame`. Overlay widgets (`arrow`, `pointer`,
  `cursor`) ignore `at`, except `cursor`, which uses `at` as its target.
- Emoji inside ordinary text (labels, code) don't render. Use the `emoji` widget.
- Relative positions refer to the widget's bounding box, including its label
  and index row.
- Unknown methods or props produce errors listing what's available. Read them
  and fix the call rather than guessing.

## Custom widgets

If no widget fits, write one in TypeScript with `defineWidget` (see
`examples/widgets/gauge.ts` and the README). Then pass it with
`--widgets path.ts` to `render`/`check`, and add it to `frontend/widgets.ts` for the
studio.
