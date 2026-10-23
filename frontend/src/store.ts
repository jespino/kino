import { create } from 'zustand';
import type { Movie } from '../kino.ts';
import type { Project, SettingsView } from './api.ts';

export interface CompileError {
  message: string;
  line?: number;
  col?: number;
}

/** What is selected on the timeline (its key, for highlighting) */
export interface TimelineSelection {
  key: string;
  line?: number;
}

const prefs = {
  get(k: string, fallback: string): string {
    try {
      return localStorage.getItem(`kino:${k}`) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(`kino:${k}`, v);
    } catch {
      /* storage unavailable */
    }
  },
};

interface State {
  project: Project | null;
  /** true once the backend told us whether a project is open */
  loaded: boolean;
  setProject: (p: Project | null) => void;

  /** the script as edited (saved to disk shortly after each change) */
  source: string;
  /** bumped when the source is replaced from outside the editor (disk, project switch) */
  sourceRev: number;
  setSource: (s: string, external?: boolean) => void;

  /** last successfully compiled movie (kept while the script has errors) */
  movie: Movie | null;
  error: CompileError | null;

  /** '' = the script's own theme */
  theme: string;
  setTheme: (t: string) => void;

  time: number;
  playing: boolean;
  /** generating narration / decoding before playback starts */
  preparing: boolean;
  speed: number;
  setSpeed: (s: number) => void;
  presenting: 'fullscreen' | 'window' | null;

  showSource: boolean;
  toggleSource: (on?: boolean) => void;
  /** asks the source panel to select a line (n makes repeated requests distinct) */
  reveal: { line: number; n: number } | null;
  revealLine: (line: number) => void;

  selection: TimelineSelection | null;
  select: (s: TimelineSelection | null) => void;

  /** long-running work (narration, export) shown under the preview */
  progress: string | null;
  setProgress: (p: string | null) => void;

  /** global settings (null until loaded) */
  settings: SettingsView | null;
  /** the settings dialog, on one of its tabs */
  settingsOpen: 'project' | 'global' | null;

  picker: 'open' | 'new' | null;
  setPicker: (p: 'open' | 'new' | null) => void;
  /** example source the next new project starts from */
  template: { name: string; source: string } | null;

  toast: { id: number; text: string } | null;
  showToast: (text: string) => void;
}

let toastId = 0;
let revealN = 0;

export const useStore = create<State>((set, get) => ({
  project: null,
  loaded: false,
  setProject: (project) =>
    set((s) => {
      if (!project) return { project: null, loaded: true, movie: null, error: null, playing: false, presenting: null };
      if (s.project?.path === project.path) return { project, loaded: true };
      // another project: drop per-project state
      return {
        project,
        loaded: true,
        source: project.source,
        sourceRev: s.sourceRev + 1,
        movie: null,
        error: null,
        time: 0,
        playing: false,
        selection: null,
        progress: null,
      };
    }),

  source: '',
  sourceRev: 0,
  setSource: (source, external) => set((s) => (external ? { source, sourceRev: s.sourceRev + 1 } : { source })),

  movie: null,
  error: null,

  theme: prefs.get('theme', ''),
  setTheme: (theme) => {
    prefs.set('theme', theme);
    set({ theme });
  },

  time: 0,
  playing: false,
  preparing: false,
  speed: 1,
  setSpeed: (speed) => set({ speed }),
  presenting: null,

  showSource: prefs.get('showSource', '1') === '1',
  toggleSource: (on) => {
    const showSource = on ?? !get().showSource;
    prefs.set('showSource', showSource ? '1' : '0');
    set({ showSource });
  },
  reveal: null,
  revealLine: (line) => {
    get().toggleSource(true);
    set({ reveal: { line, n: ++revealN } });
  },

  selection: null,
  select: (selection) => set({ selection }),

  progress: null,
  setProgress: (progress) => set({ progress }),

  settings: null,
  settingsOpen: null,

  picker: null,
  setPicker: (picker) => set({ picker }),
  template: null,

  toast: null,
  showToast: (text) => {
    const id = ++toastId;
    set({ toast: { id, text } });
    setTimeout(() => set((s) => (s.toast?.id === id ? { toast: null } : {})), 5000);
  },
}));
