# Kino

**Write a short text file, get an animated explainer video.**

Kino is for animations that explain technical ideas: how Go slices grow, how a
sorting algorithm works, how a refactor changes some code, how to use a UI. You
describe what is on screen and how it changes, and Kino animates everything
in between.

![Kino Studio: preview, timeline and agent terminal](docs/images/studio.png)

## What a script looks like

```kino
video { theme: sketch }

frame "Some numbers" {
  nums: array at center() { label: "nums", values: [5, 2, 8, 1] }
}

step "Sort them" {
  nums.sort()
}

step "Point at the smallest" {
  nums.highlight(0, good)
}
```

That's a complete video. Reading it top to bottom:

- `video { ... }` holds settings for the whole video. Here it picks the
  hand-drawn `sketch` look.
- `frame` starts a scene. `nums: array ...` puts an array named `nums` in the
  middle of the screen.
- Each `step` changes the scene. You only say what the new state is
  (`nums.sort()`); Kino animates the values sliding into place.

A few more things you'll use soon:

- `then` inside a step splits it into smaller animations that play one after
  another.
- `a -> b` draws an arrow between two things, and it follows them when they move.
- `say "..."` adds a spoken narration line (see [Narration](#narration)).

The [examples](#examples) show much more, and every widget and option is in the
[language reference](docs/DSL.md).

## Install

You need:

- [Node.js](https://nodejs.org/) (a current LTS release)
- [ffmpeg](https://ffmpeg.org/) on your `PATH`, to write video files

Then, from the repo folder:

```sh
npm install
```

The desktop app (Kino Studio) and AI narration need a few more tools; their
sections below explain how to set them up. You don't need them to make videos.

## Make your first video

1. Save the script above as `hello.kino`.
2. Check it for mistakes:

   ```sh
   npm run check -- hello.kino
   ```

   It lists the steps and how long each one takes, or points at the line with
   an error.
3. Render it:

   ```sh
   npm run render -- hello.kino -o out/hello.mp4
   ```

4. Open `out/hello.mp4`.

### Useful commands

| Command | What it does |
|---|---|
| `npm run check -- file.kino` | Find errors (with line numbers) and list the steps |
| `npm run check -- file.kino --sheet out/sheet.png` | Save a contact sheet: one picture per step |
| `npm run render -- file.kino -o out/video.mp4` | Render a video (`.mp4`, `.webm` or `.gif`) |
| `npm run render -- file.kino -o out/slides.pdf` | Render slides as a PDF, one page per step |
| `npm run render -- file.kino --png out/frame.png --at 3.5s` | Save one frame as a picture |
| `npm run render -- file.kino --theme comic` | Render with another theme |
| `npm test` | Run the test suite |

The `Makefile` has shortcuts for the same commands; run `make` to list them.

## Examples

Each one is a `.kino` file in [`examples/`](examples). Render any of them the
same way, e.g. `npm run render -- examples/bubble-sort.kino -o out/bubble.mp4`.

| Example | Shows |
|---|---|
| [`go-slices.kino`](examples/go-slices.kino) | How Go slices work: a header pointing into a backing array |
| [`bubble-sort.kino`](examples/bubble-sort.kino) | Pointers moving along an array while values swap |
| [`code-morph.kino`](examples/code-morph.kino) | Code lines sliding to their new place after a change |
| [`registers.kino`](examples/registers.kino) | What a CPU does to run `add`: registers, C source, disassembly |
| [`simd-avx.kino`](examples/simd-avx.kino) | SIMD instructions on 256-bit registers |
| [`bits-bytes-trees.kino`](examples/bits-bytes-trees.kino) | Float encoding, struct memory layout, a binary search tree |
| [`columnar-compression.kino`](examples/columnar-compression.kino) | How log rows become compressed columns (with narration) |
| [`tables-and-grids.kino`](examples/tables-and-grids.kino) | Sorting tables, highlighting matrices, camera moves |
| [`ui-walkthrough.kino`](examples/ui-walkthrough.kino) | A cursor clicking a button and a checklist updating |
| [`emoji-fun.kino`](examples/emoji-fun.kino) | Emoji and emphasis effects (bounce, shake, spin...) |
| [`custom-widget.kino`](examples/custom-widget.kino) | Using a widget you wrote yourself |

## Kino Studio

Kino Studio is a desktop app for working on one video at a time, laid out like
a video editor:

- **Preview** (top left): plays the video, with subtitles for the narration.
  The **Source** panel (Ctrl+2) next to it edits the script and saves as you
  type.
- **Timeline** (bottom): every step, narration clip, camera move and element
  as tracks. Click to jump there; double-click to open that line in the source;
  Ctrl+wheel to zoom.
- **Agent** (right): a terminal running your coding agent (Claude Code, Codex,
  Gemini CLI, Antigravity) or a plain shell, in the project folder.

The studio reloads whenever the script changes on disk, so edits from your agent
or your editor show up right away. If the script has an error, the last working
version keeps playing and the error points at its line.

**Shortcuts:** Space plays or pauses, ←/→ jumps between steps, Ctrl+Enter plays
from the step under the cursor. Click an error to jump to its line.

### Build and run it

The studio is a Go app built with [Wails 3](https://v3.wails.io). You need
[Go](https://go.dev/dl/), and on Linux also `libgtk-3-dev` and
`libwebkit2gtk-4.1-dev`.

```sh
go install -tags gtk3 github.com/wailsapp/wails/v3/cmd/wails3@v3.0.0-beta.33
make app                              # builds bin/kino
bin/kino examples/go-slices.kino      # open a script, or a folder that holds one
```

### Projects

A project is a folder with one `.kino` script plus the files it uses (pictures,
voice recordings). Open one from the welcome screen, the project menu or the
command line. New projects start empty or from a template: the examples are
built in, and you can add your own to `~/.kino/templates` (a `<name>.kino`
file, or a `<name>/` folder with the script and its files).

## Writing videos with an AI agent

The repo includes a Claude Code skill (`.claude/skills/kino/SKILL.md`) that
teaches Claude the whole language and how to check its work. Ask for an
explainer, for example *"make a kino video explaining how hash maps resize"*,
and Claude writes the `.kino` file, checks it, looks at a contact sheet and
renders it. You can also run it with `/kino`.

When you start an agent inside Kino Studio, the studio gives it the same
knowledge automatically (it writes `AGENTS.md`, the language reference and the
skill into the project).

## Themes

| Theme | Look |
|---|---|
| `neon` (default) | Dark navy with glowing cyan and pink accents |
| `sketch` | Pencil and watercolor on paper, handwritten text |
| `comic` | Comic book: ink outlines, halftone dots, bold lettering |
| `blueprint` | White line work on blue paper with a grid |
| `whiteboard` | Marker doodles on a whiteboard |
| `pixel` | 8-bit pixel art |
| `paper-cut` | Layers of hand-cut paper with soft shadows |
| `dark`, `light` | Plain and flat |

Pick one with `video { theme: sketch }` in the script, `--theme sketch` on the
command line, or the theme menu in the studio. You can also change single
colors and fonts: `video { theme: { base: sketch, accent: "#c0392b" } }`.
[docs/THEMES.md](docs/THEMES.md) has all the details.

## Narration

`say "..."` lines are read aloud by an AI voice. By default that's
[Kitten TTS 2](https://github.com/KittenML/KittenTTS), running on your machine
(on the GPU if you have one). It has 47 voices, 20 languages, emotion tags like
`[joyful]` and `<laugh>`, and can clone a voice from a short recording.

Set it up once, then start the voice server whenever you work with narration:

```sh
npm run tts:setup      # once: installs Python 3.12, torch and the model into tts/.venv
npm run tts            # starts the server (the first run downloads ~1 GB)
```

- **In the studio**, pressing Play generates any missing voice clips, then
  plays them in sync with the animation.
- **On the command line**, `npm run render` adds the narration to the video.
  Use `--no-audio` to skip it.
- **Other voices:** each project can use ElevenLabs or OpenAI (hosted), or
  espeak-ng or festival (local) instead. Choose one in the studio under
  **Settings → This project**, and enter API keys under **Settings → Kino**.
  See [Narration providers](docs/DSL.md#narration-providers).

<details>
<summary>More narration details</summary>

- Clips are cached in `.kino-cache/tts/<hash>.wav`, keyed by the text and all
  voice settings. The CLI and the studio share the cache. Delete a file to
  regenerate that line.
- `--tts <url>` (CLI) or `KINO_TTS_URL` points at another server;
  `KINO_CACHE` moves the cache.
- `npm run tts -- --device cpu` forces the CPU.
- Qwen3-TTS models work too: run `tts/setup.sh --with-qwen`, then set
  `voice: { model: "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice", speaker: Ryan }`.
- Project settings are saved as `kino.json` next to the script; app settings
  in `~/.config/kino/config.json`.

</details>

## Exporting and presenting

The studio's **Export** menu saves:

- **Video (MP4)**, with narration.
- **Presentation (HTML)**: one file that plays the slides in any browser, even
  offline (click or Space for the next slide, `f` for fullscreen). No
  narration.
- **Slides (PDF)**: one page per step. No narration.
- **Current frame (SVG)**: the picture at the playhead.

To present live, press **Present** (fullscreen) or **Window** (fills the window,
handy when sharing one window in a call). Each click or key press plays one
animation and stops, and narration is muted, so you can talk over it.

| Key | Action |
|---|---|
| click, Space, →, ↓, Enter, PageDown | next |
| ←, ↑, Backspace, PageUp, right-click | back |
| `]` / `[` | next / previous whole step |
| Home / End | first / last |
| `f` | switch between fullscreen and window |
| Esc | leave (the studio jumps to where you were) |

## Learn more

- [docs/DSL.md](docs/DSL.md): the full language, every widget and its options.
  The built-in widgets are `label`, `box`, `circle`, `button`, `array`,
  `struct`, `matrix`, `table`, `list`, `code`, `tabs`, `title`, `emoji`,
  `image`, `merge`, `tree`, `memory`, `bits`, `arrow`, `pointer`, `cursor`,
  `callout`, `brace`, `spotlight` and `camera`.
- [docs/THEMES.md](docs/THEMES.md): themes, every theme setting, fonts.
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md): how Kino works inside, the code
  layout, writing your own widgets, and current limitations.

## License and credits

Kino is released under the [MIT license](LICENSE).

- Fonts: [Inter](https://rsms.me/inter/), [JetBrains Mono](https://www.jetbrains.com/lp/mono/), [Patrick Hand](https://fonts.google.com/specimen/Patrick+Hand) (Patrick Wagesreiter; extended as Kino Hand), [Lato](https://www.latofonts.com/) (Łukasz Dziedzic), [Fantasque Sans Mono](https://github.com/belluzj/fantasque-sans) (Jany Belluz), [Bangers](https://github.com/googlefonts/bangers) (Vernon Adams), [Comic Neue](https://github.com/crozynski/comicneue) (Craig Rozynski), [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (Cody "CodeMan38" Boisclair), [VT323](https://fonts.google.com/specimen/VT323) (Peter Hull) and [Fredoka](https://github.com/hafontia-zz/Fredoka) (Milena Brandão; static instances cut from the variable font), SIL Open Font License.
- Emoji artwork: [Twemoji](https://github.com/jdecked/twemoji) (`@twemoji/svg`). Graphics are licensed CC-BY 4.0; credit Twemoji when you publish videos that use them.
