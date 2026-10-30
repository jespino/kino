import { useEffect, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { themes } from '../kino.ts';
import { loadFonts } from '../fonts.ts';
import { api, errorText, EVENT_PROJECT, EVENT_SOURCE, on, type Project } from './api.ts';
import { exportFrame, exportPage, exportSlides, exportVideo, jump, play, rebuild, replaceSource } from './engine.ts';
import { Preview } from './preview/Preview.tsx';
import { openSpeakerView, present, Slides } from './preview/Slides.tsx';
import { ProjectMenu } from './project/ProjectMenu.tsx';
import { ProjectPicker } from './project/ProjectPicker.tsx';
import { Welcome } from './project/Welcome.tsx';
import { SettingsDialog } from './settings/SettingsDialog.tsx';
import { SourcePanel } from './source/SourcePanel.tsx';
import { useStore } from './store.ts';
import { TerminalPanel } from './terminal/TerminalPanel.tsx';
import { Timeline } from './timeline/Timeline.tsx';

export function App() {
  const project = useStore((s) => s.project);
  const loaded = useStore((s) => s.loaded);
  const toast = useStore((s) => s.toast);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const st = useStore.getState;
    // also sent when kino.json changes (the narration voice): recompile either way
    const offProject = on<Project | null>(EVENT_PROJECT, (p) => {
      st().setProject(p);
      if (p) rebuild();
    });
    // the script changed on disk (the agent, another editor)
    const offSource = on<{ path: string; source: string }>(EVENT_SOURCE, (ch) => {
      if (ch.path === st().project?.path && ch.source !== st().source) replaceSource(ch.source);
    });
    // the global settings pick the default narration provider: load them before compiling
    Promise.all([api.currentProject(), api.settings().catch(() => null)]).then(
      ([p, settings]) => {
        useStore.setState({ settings });
        st().setProject(p);
        if (p) rebuild();
      },
      (e) => setError(errorText(e)),
    );
    // redraw once the bundled fonts are in (the first frames may use fallbacks)
    loadFonts().then(() => useStore.setState((s) => ({ movie: s.movie })), (e) => console.warn('could not load fonts', e));
    return () => {
      offProject();
      offSource();
    };
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const st = useStore.getState();
      if (!st.project || st.presenting) return;
      if ((ev.ctrlKey || ev.metaKey) && ev.key === '2') {
        ev.preventDefault();
        st.toggleSource();
        return;
      }
      if ((ev.target as HTMLElement).closest('input, textarea, select, .cm-editor, .xterm') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === ' ') {
        ev.preventDefault();
        play();
      } else if (ev.key === 'ArrowRight') jump(1);
      else if (ev.key === 'ArrowLeft') jump(-1);
      else if (ev.key === 'Escape') st.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      {error && <div className="banner error">{error}</div>}
      {toast && (
        <div className="toast" key={toast.id} onClick={() => useStore.setState({ toast: null })}>
          {toast.text}
        </div>
      )}
      <ProjectPicker />
      <SettingsDialog />
      {loaded && !project && !error && <Welcome />}
      {/* keyed by project: switching projects remounts the editor, timeline and terminal */}
      {project && <Editor key={project.path} />}
      <Slides />
    </div>
  );
}

function Toolbar() {
  const project = useStore((s) => s.project);
  const hasMovie = useStore((s) => !!s.movie);
  const error = useStore((s) => s.error);
  const theme = useStore((s) => s.theme);
  const showSource = useStore((s) => s.showSource);
  return (
    <header className="toolbar">
      <span className="brand">kino</span>
      {project && <ProjectMenu />}
      <span className="spacer" />
      <SettingsButton />
      {project && (
        <>
          {error && (
            <button className="small danger" onClick={() => (error.line ? useStore.getState().revealLine(error.line) : useStore.getState().toggleSource(true))} title={error.message}>
              1 error{error.line ? ` · line ${error.line}` : ''}
            </button>
          )}
          <select
            value={theme}
            title="Theme (overrides the script's video { theme })"
            onChange={(e) => {
              useStore.getState().setTheme(e.target.value);
              rebuild();
            }}
          >
            <option value="">Theme: from script</option>
            {Object.keys(themes).map((t) => (
              <option key={t} value={t}>
                Theme: {t}
              </option>
            ))}
          </select>
          <button className={showSource ? 'on' : ''} onClick={() => useStore.getState().toggleSource()} title="Source panel (Ctrl+2)">
            Source
          </button>
          <span className="sep" />
          <span className="split">
            <button onClick={() => present('fullscreen')} disabled={!hasMovie} title="Fullscreen slides: each click or space plays one transition (f: switch to window, s: speaker view)">
              Present
            </button>
            <button onClick={() => present('window')} disabled={!hasMovie} title="Slides filling the window, without going fullscreen (f: switch to fullscreen)">
              Window
            </button>
            <button onClick={() => openSpeakerView()} disabled={!hasMovie} title="Speaker view in its own window: notes, the next slide and a timer (s while presenting)">
              Speaker
            </button>
          </span>
          <ExportMenu />
        </>
      )}
    </header>
  );
}

const EXPORTS = [
  { label: 'Video (MP4)', hint: 'Render the whole video, with narration', run: exportVideo, long: true },
  { label: 'Presentation (HTML)', hint: 'The slides as one self-contained file that presents in any browser', run: exportPage, long: true },
  { label: 'Slides (PDF)', hint: 'A page per step and sub-step', run: exportSlides, long: true },
  { label: 'Current frame (SVG)', hint: 'The frame at the playhead', run: exportFrame, long: false },
];

function ExportMenu() {
  const hasMovie = useStore((s) => !!s.movie);
  const exporting = useStore((s) => !!s.progress && /^(Rendering|Mixing narration|Saving)/.test(s.progress));
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <span className="export-menu" ref={box}>
      <button className="primary" onClick={() => setOpen(!open)} disabled={!hasMovie} title="Export the video, the presentation, the slides or a frame">
        {exporting ? 'Exporting…' : 'Export'} ▾
      </button>
      {open && (
        <div className="menu right">
          {EXPORTS.map((x) => (
            <button
              key={x.label}
              disabled={x.long && exporting}
              onClick={() => {
                setOpen(false);
                x.run();
              }}
            >
              {x.label}
              <span className="menu-hint">{x.hint}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

function SettingsButton() {
  const project = useStore((s) => s.project);
  return (
    <button onClick={() => useStore.setState({ settingsOpen: project ? 'project' : 'global' })} title="Narration voice and providers, export quality">
      ⚙ Settings
    </button>
  );
}

function Editor() {
  const showSource = useStore((s) => s.showSource);
  return (
    <Group orientation="horizontal" className="main">
      <Panel id="left" minSize={480}>
        <Group orientation="vertical">
          <Panel id="top" defaultSize="60" minSize={200}>
            <Group orientation="horizontal">
              <Panel id="preview" minSize={300}>
                <Preview />
              </Panel>
              {showSource && (
                <>
                  <Separator className="sep-v" />
                  <Panel id="source" defaultSize="42" minSize={260}>
                    <SourcePanel />
                  </Panel>
                </>
              )}
            </Group>
          </Panel>
          <Separator className="sep-h" />
          <Panel id="bottom" minSize={120}>
            <Timeline />
          </Panel>
        </Group>
      </Panel>
      <Separator className="sep-v" />
      <Panel id="agent" defaultSize="32" minSize={320}>
        <TerminalPanel />
      </Panel>
    </Group>
  );
}
