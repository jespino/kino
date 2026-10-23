# The Kino language

A `.kino` file describes a video as a **sequence of scene states**. You declare
widgets, then change them step by step. The engine animates every change for
you: it matches what's on screen before and after each step and morphs between
the two ("magic move").

```kino
video { size: (1280, 720), fps: 30, theme: dark }

frame "start" {
  s: struct at (100, 200) { title: "s", fields: { ptr: "•", len: 0, cap: 4 } }
  data: array at right-of(s, 120) { capacity: 4 }
  s.ptr -> data[0]
}

step "append" (800ms, ease-out) {
  data.push(1)
  s.len = 1
}
```

## File structure

| Item | Meaning |
|---|---|
| `video { ... }` | Global settings (any position in the file). |
| `frame ["name"] [(options)] { ... }` | A **fresh** scene: everything not declared here disappears. Widgets with the same name as in the previous scene morph into their new state. |
| `step ["name"] [(options)] { ... }` | **Changes** to the current scene (alias: `transition`). |
| `wait <duration>` | Hold the current picture. |
| `say "text" [(voice options)]` | Narration over the current picture (see [Narration](#narration-tts)). |
| `voice { speaker: ..., ... }` | Change the default voice from here on. |

Each `frame`/`step` becomes a chapter in the player, named by its string, and
is followed by an automatic pause (`hold`).

### `video` settings

| Key | Default | |
|---|---|---|
| `size` | `(1280, 720)` | or `width`, `height` |
| `fps` | `30` | |
| `theme` | `neon` | `neon` (navy, cyan glows), `sketch` (hand-drawn on paper), `comic` (comic book: inked outlines, hard shadows, halftone dots), `dark`, `light`, or `{ base: sketch, accent: "#ff0", ... }` to override tokens. `render`/`check --theme <name>` and the studio's theme selector override it. |
| `background` | theme `bg` | color or theme token |
| `transition` | `700ms` | default step duration |
| `hold` | `900ms` | default pause after each step |
| `easing` | `ease-in-out` | default easing |
| `voice` | `{ speaker: Jasper }` | default narration voice, see below |
| `narrationHold` | `400ms` | pause after a step's narration ends |

### Step options

Write the options in parentheses, in any order: `step "x" (1s, back-out, fade, hold: 2s)`.

- **duration**: `500ms`, `1.2s`. A bare duration also works: `step 1s { ... }`.
- **easing**: `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `back-out`, `back-in-out`, `spring`, `bounce`, `step`.
- **kind**: `morph` (default: keyed interpolation), `fade` (crossfade the whole picture), `cut` (no animation).
- `hold: <dur>`: the pause after the step.

The first `frame` appears instantly unless it has options such as `(fade)` or `(600ms)`.

### `then`: sequential sub-steps

Statements inside a step animate **simultaneously**. Use `then` to split a step
into consecutive transitions, each with the step's duration and easing:

```kino
step "grow" {
  data2: array at (480, 470) { capacity: 8 }
then
  data2.copyFrom(data)
then
  ptr.to = data2[0]
}
```

## Statements

```kino
name: type [at <position>] [{ prop: value, ... }]   // declare (or replace) a widget
name.prop = value                                    // set a property
name[2] = value          name[1][3] = value          // set an indexed part (array cell, matrix cell, table row)
name.part = value                                    // widget-specific: struct fields (s.len = 3)
name { prop: value, other: value }                   // set several properties
name.method(args...)                                 // call a widget method
name[2].method(args...)                              // same as name.method(2, args...)
a.part -> b[0] [{ props }]                           // arrow between anchors (-->: dashed)
p: a.part -> b[0] [{ props }]                        // named arrow (so you can change it later)
remove a, b                                          // delete widgets (they play their exit effect)
say "Some narration" [(speaker: Luna)]               // spoken while this (sub)step animates
then                                                 // (steps only) start a new sub-step
```

Statements are separated by newlines or `;`. Comments are `// ...`, `/* ... */`, or `# ...` (hash followed by a space).

## Values

| Syntax | Value |
|---|---|
| `42`, `-3.5`, `0xFF`, `0b1010_0001` | number (hex and binary too; `_` separates digits) |
| `"text"`, `'text'` | string (`\n` for newline) |
| `` `multi-line` `` | raw multi-line string, common indentation removed (great for code) |
| `#7aa2f7` | color (also any CSS color as a string, or theme tokens: `accent`, `good`, ...) |
| `500ms`, `2s` | duration |
| `true`, `false`, `_` / `null` | booleans / empty |
| `[1, 2, 3]` | list |
| `{ a: 1, b: "x" }` | object (ordered) |
| `(100, 200)` | point |
| `data[0]`, `s.len`, `todo` | reference to a widget or a part of it |
| `below(s, 40)` | function value (used for positions) |

**Bare words.** A bare identifier is a reference, but if the property expects
text it means the word itself. So `color: warn`, `font: mono`, `origin: center`
and `fields: [ptr, len, cap]` all work without quotes.

## Positioning

Every non-overlay widget has `at` and `origin`:

- `at (x, y)`: put the widget's `origin` point at (x, y). The default origin is
  `top-left`. Others: `top`, `top-right`, `left`, `center`, `right`,
  `bottom-left`, `bottom`, `bottom-right`.
- `at below(w, gap)`, `above(w, gap)`, `right-of(w, gap)`, `left-of(w, gap)`:
  relative to another widget or part (`below(data[2])`). Edges are aligned to the
  start. Use `origin: center` (or `top`/`left`...) to center-align instead.
- `at center()`: center the widget on the canvas.
- `at someWidget`: center on another widget or part.

Changing `at` in a step moves the widget smoothly. The coordinate system is the
video size, e.g. 1280×720.

### Common properties (all widgets)

| Prop | |
|---|---|
| `at`, `origin` | position, see above |
| `opacity` | 0..1 (`w.hide()` / `w.show()` are shortcuts) |
| `z` | stacking order (higher is on top; cursors default to 100) |
| `enter`, `exit` | effect when parts appear/disappear: `fade`, `pop`, `draw`, `slide-up`, `slide-down`, `slide-left`, `slide-right`, `none` |
| `panel` | wrap the widget in a panel: `panel: "Register file · one M1 core"` (uppercase caption) or `panel: true` (no caption) |
| `panelGlow` | `true` or a color: glowing panel border (animates on/off) |
| `panelColor`, `panelPadding` | caption color (default `caption`), inner padding (22) |

## Narration (TTS)

`say` adds a spoken line. The audio is generated with
[Kitten TTS 2](https://github.com/KittenML/KittenTTS) (`KittenML/kitten-tts-2`,
running on the GPU when available) the first time it's needed. It's cached by text + voice, so
each line is synthesized only once.

```kino
video { voice: { speaker: Jasper } }

step "append" {
  say "Appending writes into the spare capacity."   // starts with the step's animation
  data.push(1)
then
  say "No allocation was (((needed))) at all."       // starts with the second sub-step; stressed word
  s.len = 1
}

say "[excited] A line over a still picture!"         // top-level: holds until it's spoken
voice { speaker: Victoria }                          // new default from here on
say "Now with another voice." (preset: expressive)   // per-line overrides
say "Hola a todos." (language: Spanish)              // other languages use that language's voice
```

**Expression markup inside the text** (Kitten TTS 2; subtitles hide it):
- A leading emotion tag sets the tone: `[angry]`, `[contemplative]`, `[excited]`,
  `[joyful]`, `[mundane]`, `[nervous]`, `[sad]`, `[stern]`, `[surprised]`, `[tender]`.
- Inline sounds: `<gasp>`, `<giggle>`, `<growl>`, `<gulp>`, `<laugh>`,
  `<pause>`, `<scoff>`, `<sigh>`, `<sob>`, `<um>`.
- Stress a word: `(((never)))`.

Timing rules:
- A clip starts when its step (or `then` sub-step) starts.
- A step lasts until both its animations and its narration have finished. Then
  it pauses for `narrationHold` (400ms), or for the step's own `hold:` if given.
- Until a clip has been generated, its duration is estimated from the text
  length, and the studio shows its subtitle in italics.

Voice settings (in `video { voice: {...} }`, `voice {...}` or `say "..." (...)`):

| Key | |
|---|---|
| `speaker` | a built-in voice (default `Jasper`). The original eight are `Bella`, `Jasper`, `Luna`, `Bruno`, `Rosie`, `Hugo`, `Kiki`, `Leo`. Character voices include `Victoria` (regal narrator), `Marcus` (radio DJ), `Herbert` (professor), `Maeve` (storyteller), `Miles` (librarian), `Claire`, `Grace`, `Diana`, `Dante`, `Saoirse` and more (38 English voices in total). |
| `language` | `Auto`/`English`, or `Spanish`, `German`, `French`, `Italian`, `Portuguese`, `Russian`, `Chinese`, `Arabic`, `Hindi`: uses that language's voice |
| `instruct` | an emotion applied to every line (`joyful`, `tender`, `stern`...; same as a leading `[tag]`). With a Qwen model: free-form style direction. |
| `preset` | `stable` (default) or `expressive` |
| `reference`, `referenceText` | voice cloning: a path to a 5–30s WAV of one speaker (relative to where you run kino), and optionally its transcript |
| `model` | default `KittenML/kitten-tts-2`. `Qwen/...` models (Qwen3-TTS) also work if installed (`tts/setup.sh --with-qwen`). With a hosted provider: its model id (see below). |
| `provider` | who speaks: `local` (the server above), `elevenlabs`, `openai`, `espeak` or `festival`. Usually chosen per project (see below), which wins over `video { voice }`; a `voice {}` block or `say (...)` option overrides it from there on. |
| `speed` | speaking rate, `1` = normal (`1.2` faster, `0.8` slower). Every provider except `local` (Kitten has no rate control). |

### Narration providers

A project chooses who speaks its lines in **Settings → This project** in the studio, saved as
`kino.json` in the project folder (the CLI reads it too, from the script's folder). It also holds
the project's voice, which wins over the script's `video { voice }` (speaker and model names belong
to one provider, so a header written for another one would break). Later `voice {}` blocks and
`say "..." (...)` options still apply over it:

```json
{ "tts": { "provider": "elevenlabs", "voice": { "speaker": "Rachel", "model": "eleven_v3" } } }
```

A project without a provider uses Kino's default (**Settings → Kino**, `local` unless changed).

| Provider | `speaker` | `model` (default) | Notes |
|---|---|---|---|
| `local` | Kitten voices (`Jasper`...) | `KittenML/kitten-tts-2` | The AI server above (`npm run tts`). Supports all the markup, emotions and voice cloning. |
| `elevenlabs` | a voice name from your account (`Rachel`, `Sarah`...) or a voice id | `eleven_multilingual_v2`; also `eleven_v3`, `eleven_flash_v2_5`... | `eleven_v3` keeps leading `[emotion]` tags and turns `instruct` into one; other models get the text without markup. The language is detected from the text. `speed` 0.7–1.2. |
| `openai` | `alloy` (default), `ash`, `coral`, `echo`, `fable`, `nova`, `onyx`, `sage`, `shimmer`... | `gpt-4o-mini-tts`; also `tts-1`, `tts-1-hd` | `instruct` is sent as free-form style direction. Any OpenAI-compatible server works through its URL. |
| `espeak` | an espeak-ng voice: `en-us`, `es`, `en+f3`... (default: from `language`) | – | Classic, robotic, offline and instant. Needs `espeak-ng` installed (`apt install espeak-ng`, `brew install espeak-ng`). |
| `festival` | a festival voice: `kal_diphone`, `cmu_us_slt_arctic_hts`... (default: festival's) | – | Classic, offline. Needs festival installed (`apt install festival`); kino runs its `text2wave`. |

Kitten markup (`(((stress)))`, `<laugh>`) is stripped for the other providers, and voice cloning
(`reference`) is local only: clone the voice in the provider and use it as the `speaker`.

Provider credentials are global and never go in the script or the project: set them in
**Settings → Kino**, saved in `~/.config/kino/config.json` (`~/Library/Application Support/kino/config.json`
on macOS, `%AppData%\kino\config.json` on Windows, readable only by you). The same dialog sets the
espeak/festival programs, the local server URL, a narration cache folder shared by all projects,
and the MP4/PDF export quality. Environment variables win over the file: `ELEVENLABS_API_KEY`,
`OPENAI_API_KEY`, `ELEVENLABS_BASE_URL`, `OPENAI_BASE_URL`, `KINO_TTS_URL`, `KINO_CACHE`.

Clips are cached by text + voice + provider, so each line is generated (and billed) once.

## Emphasis actions

Every widget has these methods. They play during the step that calls them and
end where they started (like Keynote's "action builds"):

`bounce()`, `jump()`, `shake()`, `pulse()`, `spin()`, `wiggle()`, `tada()`

```kino
step { arr.highlight(1, bad); arr.shake() }
step { result.tada(); badge.pulse() }
```

## Camera

`camera` is built in:

```kino
camera.focus(todo, 1.8)     // center on a widget/part, zoom 1.8x
camera.zoom = 1.5
camera.center = (400, 300)
camera.reset()
```

## Widgets

Theme color tokens can be used wherever a color is expected: `fg`, `muted`,
`accent`, `accent2`, `pink`, `highlight`, `good`, `bad`, `warn`, `info`,
`caption`, `glow`, `surface`, `surface2`, `border`, `panel`, `panelBorder`, `bg`.

Highlights (`highlight(...)` on arrays, structs, matrices) draw a tinted cell
with a colored border and a soft glow.

### `label`
Text. `text`, `size` (28), `color`, `weight`, `font` (`sans`|`mono`), `align` (`start`|`middle`|`end`), `lineHeight`, `caps` (uppercase), `spacing` (letter spacing in px).

### `box`, `circle`
A shape with text. `text`, `width`/`height` (auto), `r` (circle), `fill`, `stroke`, `color`, `radius`, `size`, `font`, `dashed`.

### `button`
`text`, `variant` (`primary`|`secondary`|`danger`|any color), `pressed`, `disabled`, `size`, `width`.
Methods: `click()` (flash), `press()`, `release()`.

### `array`
A row (or column) of cells whose items **keep identity**, so moving values slide instead of crossfading.
- Props: `values`, `capacity` (extra empty slots, e.g. a Go slice's cap), `cell` (64), `width` (cell width multiplier), `gap`, `indices` (true), `label`, `direction` (`horizontal`|`vertical`), `size`.
- Assign: `a[i] = v`, `a.values = [...]`.
- Methods: `push(v...)`, `pop()`, `shift()`, `unshift(v...)`, `insert(i, v)`, `remove(i)`, `set(i, v)`, `swap(i, j)`, `move(from, to)`, `clear()`, `reverse()`, `sort("desc"?)`, `highlight(i | [i, j] | all, color?)`, `unhighlight(i?)`, `range(name, from, to, color?, label?)` (bracket marking cells [from, to)), `unrange(name)`, `copyFrom(other, start?)` (copies fly out of the source), `moveFrom(other, count?)` (items fly over; all of them, or the first `count`).
- Anchors: `a[i]`, `a.<rangeName>`. Negative indexes count from the end.

### `struct`
A record with named fields (slice headers, structs, objects, register files). Each
field is a rounded cell with the name on the left and the value on the right;
zero/empty values are dimmed.
- Props: `title`, `fields` (`{ name: value }` or `[names]`), `columns` (grid; default 1, or all for `direction: horizontal`), `size`,
  `colors` (`{ sp: accent2 }` name colors), `notes` (`{ x29: fp }` small annotations), `span` (`{ pc: 4 }` cells spanning columns),
  `cellWidth`, `dimZero` (true), `gap`.
- Assign: `s.field = v`, `s { len: 2, cap: 4 }`.
- Methods: `highlight(field?, color?)`, `unhighlight(field?)`, `addField(name, v)`, `removeField(name)`.
- Anchors: `s.field`.

### `matrix`
A 2D grid (DP tables, boards, images).
- Props: `values` (`[[..], [..]]`) or `rows`/`cols` for an empty grid, `cell`, `labels` (show indexes), `size`.
- Assign: `m[r][c] = v`. Methods: `set(r, c, v)`, `fill(v)`, `highlight(r, c, color?)`, `highlightRow(r, color?)`, `highlightCol(c, color?)`, `unhighlight(r?, c?)`.
- Anchors: `m[r][c]`, `m[r]`.

### `table`
Rows keep identity, so sorting and inserting animate rows moving.
- Props: `columns`, `rows`, `size`, `mono`.
- Assign: `t[r][c] = v` (c may be a column name), `t[r] = [...]`.
- Methods: `addRow(...)`, `insertRow(i, ...)`, `removeRow(i)`, `setRow(i, ...)`, `set(r, c, v)`, `highlightRow(i, color?)`, `unhighlight(i?)`, `sortBy(column, "desc"?)`, `clear()`.
- Anchors: `t[r]`, `t[r][c]`.

### `list`
Bullet, numbered or check list.
- Props: `items`, `bullet` (`dot`|`number`|`check`|`none`), `size`, `gap`, `color`.
- Methods: `push`, `insert(i, v)`, `remove(i)`, `set(i, v)`, `highlight(i, color?)`, `unhighlight(i?)`, `check(i)`, `uncheck(i)`, `clear()`. Anchors: `l[i]`.

### `code`
A syntax-highlighted code block. Lines are keyed by content, so assigning new
`code` moves unchanged lines to their new place (like Keynote Magic Move).
- Props: `code`, `lang` (`go`, `js`, `ts`, `python`, `rust`, `c`, `cpp`, `sql`, `sh`, `asm`/`arm64`/`x86`), `size`, `lineNumbers`, `highlight` (`3`, `"2-4"`, `[1, "5-6"]`), `focus` (dim other lines), `title` (header bar), `titleSize`, `glow` (`true` or a color), `width`, `height`.
- `asm` colors a leading address, the mnemonic, registers and immediates.
- Methods: `highlight(from, to?)`, `focus(from, to?)`, `unfocus()`, `unhighlight()`.
- Anchors: `c[line]` (1-based).

### `title`
An opening or section card: eyebrow caption between two rules, a big headline
with a white→accent gradient and a soft halo, an accent bar that draws itself,
and a subtitle. The parts come in one after another.
In the `comic` theme the headline is lettered in Bangers with an ink outline and pops out of a red starburst (it replaces the accent bar).
With `titleStyle: bar` the card is drawn like a slide template's cover: a vertical bar, a heavy headline, the `eyebrow` as a light second line, the `subtitle` below, left-aligned over the theme's `titleBackdrop` gradient (`backdrop: false` keeps the plain page, for section headers).
`text` (headline, `\n` for several lines), `eyebrow`, `subtitle`, `size` (84), `align` (`center`|`start`), `color` (accent), `gradient` (true), `halo` (true). Its origin defaults to `center`.

```kino
frame "title" (1500ms, ease-out, hold: 1800ms) {
  cover: title at center() { eyebrow: "Go internals", text: "How slices work", subtitle: "headers, backing arrays, and append" }
}
frame "content" (fade) { ... }   // crossfades from the card
```

Theme tokens `titleFrom` / `titleTo` change the gradient.

### `emoji`
Emoji drawn as artwork (bundled [Twemoji](https://github.com/jdecked/twemoji)
SVGs), so they look the same everywhere and scale, rotate and flip smoothly.
- Props: `char` (`"🚀"`, ZWJ sequences, skin tones and flags work), `size` (96), `count` (repeat it; changing it pops copies in/out), `gap`, `rotate` (degrees), `flip` (mirror; animates as a flip), `label` (caption below), `labelSize`, `glow` (`true` or a color).
- Changing `char` swaps the artwork with a pop.
- Methods: `set(char)`, `add(n?)`, `remove(n?)`, `burst(n?, char?)` (copies fly out in all directions), `float(char?)` (a reaction drifts up and fades), plus the [emphasis actions](#emphasis-actions).
- Emoji inside ordinary text (`label`, `box`, `code`) are not drawn by the bundled fonts. Use the `emoji` widget instead.

```kino
apples: emoji at (960, 300) { char: "🍎", size: 120, count: 3, origin: top }
step { apples.add(2); apples.label = "five apples" }
step { heart.burst(14); party.burst(12, "✨"); like.float() }
```

### `image`
A picture from a file or a URL: PNG, JPEG, GIF, WebP or SVG. Paths are relative
to the `.kino` file (the CLI also tries the working directory; the studio looks
in the project folder, the one holding the script). The picture is embedded in the frames, so
previews, exported MP4s and CLI renders all match.
- Props: `src`, `width`, `height` (give one and the other follows the aspect ratio; neither = natural size), `fit` (`contain`|`cover`|`fill`, when both are given), `border` (`true` or a color), `padding` (a mat around the picture, like a mounted photo), `rotate` (degrees), `label` (caption below), `labelSize`, `glow`.
- Assigning `src` (or `img.set("other.png")`) crossfades to another picture.
- A picture that can't be loaded is drawn as a dashed placeholder with its path; `check` and `render` print why.

```kino
shot: image at (960, 120) { src: "images/dashboard.png", width: 1200, origin: top, padding: 12, border: true, label: "the query UI" }
step { shot.src = "images/dashboard-zoomed.png" }
```

### `merge`
Many things becoming one: compression, aggregation, joins. A rounded hub with a
ribbon converging from each source.
- Props: `label`, `width`/`height` (default: fits the label), `color`, `size`, `spread` (0..1: how much of the hub's side the ribbons land on).
- `z.from(sources...)`: draws a ribbon from each widget or part (e.g. `cols.level`) into the hub. Ribbons draw in one after another.
- `z.flow()`: in that step, a pulse runs down every ribbon into the hub, staggered, and the hub swells as they arrive. Show the result in a following `then`.
- Anchors: `z.in`, `z.out` (e.g. `z.out -> result`).

```kino
z: merge at (1290, 470) { label: "zstd", origin: center }
z.from(cols._time, cols.level, cols.status)
step {
  z.flow()
then
  out: box at right-of(z, 90) { text: "compressed", origin: left }
  z.out -> out
}
```

### `tabs`
Chapter pills like `① REGISTERS ② THE STACK ③ THE CACHE`; the active one glows.
`items`, `active` (0-based), `numbers` (true), `size`, `color`. Methods: `select(i)`, `next()`, `prev()`. Anchors: `t[i]`.

### `tree`
A tree with automatic layout: BSTs, heaps, tries, linked lists. Nodes keep
identity, so inserts, deletes, rotations and swaps re-lay the tree out and the
nodes slide to their new places.
- Props: `values` (a BST built by inserting these in order) or `nodes` (`{ id: [children] }`; `_` keeps an empty left/right slot), `root`, `binary` (true: children are left/right, laid out in in-order), `labels` (`{ id: "text" }`), `shape` (`circle`|`box`), `r`, `size`, `levelGap`, `siblingGap`, `direction` (`vertical`|`horizontal`, e.g. linked lists), `arrows` (directed edges).
- Methods: `insert(v...)` (BST), `delete(v)` (BST; with two children the in-order successor moves up), `add(parent, child, side?)`, `remove(id)` (with its subtree), `rotateLeft(id)`, `rotateRight(id)`, `swap(a, b)` (exchange places: heap sift), `search(v)` (highlights the BST search path; the target is `good`, or the last node `bad` if missing), `highlight(id, color)`, `highlightPath([ids], color)`, `unhighlight(id?)`, `label(id, text)`.
- Anchors: `t[id]`.

```kino
t: tree at (960, 200) { values: [50, 30, 70, 20, 40, 60, 80], origin: top }
step { t.search(65) then t.insert(65) }
step { t.delete(50) }                            // 60 moves up into the root
list: tree { nodes: { a: [b], b: [c] }, binary: false, direction: horizontal, shape: box, arrows: true }
```

### `memory`
A hex dump: an address column and byte cells (zero bytes dimmed), typed
writes with endianness, and named regions for fields, padding and cache lines.
Written bytes flash during their step.
- Props: `size` (number of bytes) or `bytes` (`[0x41, ...]`), `base` (address of byte 0, e.g. `0x7ffc1000`), `columns` (8), `cell`, `fontSize`, `endian` (`little`|`big`), `ascii` (character column), `addresses`, `label`.
- Methods: `write(offset, value, type?, endian?)` where type is `u8 u16 u32 u64 i8 i16 i32 i64 f32 f64 str bytes`; `set(offset, byte)`, `fill(byte, from?, len?)`, `copy(src, dst, len)`, `region(name, from, len, color?, label?)`, `unregion(name?)`, `highlight(from, len?, color?)`, `unhighlight()`.
- Anchors: `m[offset]`, `m.<region>`.

```kino
mem: memory at (980, 200) { size: 16, base: 0x7ffc1000 }
step { mem.write(4, 258, i32); mem.region(n, 4, 4, warn, "int n") }   // 02 01 00 00
step { mem.write(8, 3.14, f32) }                                        // C3 F5 48 40
```

### `bits`
The bits of an integer or a float. Bit cells keep identity, so shifts and
rotates slide them, while logic ops flip them in place (changed bits flash).
Bit 0 is the least significant, drawn on the right.
- Props: `value` (number, `0b1010`, `0xFF` or a `"0101"` string), `width` (8), `format` (`dec`|`hex`|`signed`|`float`|`none`, the value shown on the right), `cell`, `fontSize`, `nibbles` (gap every 4 bits), `indices`, `groups`, `label`.
- Methods: `set(v)`, `setFloat(f)` (IEEE-754, width 32 or 64), `shl(n)`, `shr(n)`, `sar(n)`, `rol(n)`, `ror(n)`, `and(mask)`, `or(mask)`, `xor(mask)`, `not()`, `setBit(i)`, `clearBit(i)`, `flip(i)`, `group(name, hi, lo, color?, label?)` (labeled bracket over bits hi..lo), `ungroup(name?)`, `highlight(hi, lo?, color?)`, `unhighlight()`. Also `b[i] = 1`.
- Anchors: `b[i]` (bit i), `b.<group>`.

```kino
f: bits at (80, 430) { width: 32, format: float }
step { f.setFloat(3.14); f.group(sign, 31, 31, pink); f.group(exponent, 30, 23, warn); f.group(mantissa, 22, 0) }
n: bits { value: 22 }     step { n.shl(1) }       // 44
```

### `callout` (overlay)
A note attached to anything: a rounded bubble, a dashed leader line and a dot
on the target. It stays inside the frame.
`target`, `text` (`\n` for lines), `side` (`auto`|`left`|`right`|`above`|`below`), `distance` (70), `color`, `size`, `mono`.

### `brace` (overlay)
A curly brace spanning one or more targets, with a label at its tip.
`from`, `to` (optional), `side` (`below`|`above`|`left`|`right`), `label`, `color`, `depth`, `gap`, `size`.
`size: brace { from: mem[0], to: mem[11], side: below, label: "12 bytes" }`

### `spotlight` (overlay)
Dims everything except its target and puts a glowing ring around it.
Assigning `target` slides the hole; `remove` fades it out.
`target`, `padding` (14), `dim` (0.7), `radius`, `color`.
`spot: spotlight { target: f.sign }  …  spot.target = mem.pad  …  remove spot`

### `arrow` (overlay)
`from`, `to` (references or points), `label`, `curve` (-1..1), `color`, `width`, `dashed`, `glow` (true), `head` (`end`|`both`|`none`). Draws itself in on enter. Retargeting (`p.to = other[0]`) animates.

### `pointer` (overlay)
A labeled marker pointing at a part: loop indexes, `head`/`tail`, `top`.
`target`, `label`, `side` (`below`|`above`|`left`|`right`), `color`, `size`, `distance`.

### `cursor` (overlay)
A mouse pointer. `at` (point or widget), `color`, `scale`. Methods: `moveTo(target)`, `click(target?)` (ripple).

## Grammar (EBNF)

```ebnf
program   = { item } ;
item      = "video" props
          | ("frame" | "step" | "transition") [ STRING ] [ DURATION ] [ "(" opts ")" ] body
          | "wait" DURATION
          | "say" STRING [ "(" opts ")" ]
          | "voice" props ;
opts      = opt { "," opt } ;            opt = expr | IDENT ":" expr ;
body      = "{" { stmt [";"] } "}" ;
stmt      = IDENT ":" IDENT [ "at" expr ] [ props ]          (* declaration *)
          | [ IDENT ":" ] path ("->" | "-->") expr [ props ]  (* arrow *)
          | path "=" expr | path "(" args ")" | path props
          | "remove" IDENT { "," IDENT } | "then"
          | "say" STRING [ "(" opts ")" ] ;
path      = IDENT { "." IDENT | "[" expr "]" } ;
props     = "{" { (IDENT | STRING) ":" expr [ "," | ";" ] } "}" ;
expr      = NUMBER | DURATION | STRING | COLOR | "true" | "false" | "_" | "null"
          | "[" args "]" | props | "(" args ")" | IDENT "(" args ")" | path ;
```
