// Backend transport. In the desktop app, calls go through the Wails runtime;
// in a browser (kino serve / Vite dev), through HTTP + server-sent events.
// Both reach the same Go service (internal/app.App).

const SERVICE = 'github.com/jespino/kino/internal/app.App';

const NO_BACKEND =
  'No Kino backend is reachable. In a browser, run `make dev` (it starts `kino serve` and this UI); ' +
  'the desktop app (`make app-dev`) has it built in.';

export const isWails =
  typeof window !== 'undefined' && (window.location.protocol === 'wails:' || window.location.hostname === 'wails.localhost');

export interface Project {
  path: string;
  dir: string;
  name: string;
  source: string;
  /** the project's kino.json */
  settings: ProjectSettings;
}

/** Narration engines (src/core/narration.ts TTS_PROVIDERS). */
export type Provider = 'local' | 'elevenlabs' | 'openai' | 'espeak' | 'festival';

export interface ProviderSettings {
  apiKey?: string;
  url?: string;
  /** espeak / festival: the program to run */
  command?: string;
}

/** Global settings: <config dir>/kino/config.json */
export interface Settings {
  tts: { provider?: Provider | '' } & Record<Provider, ProviderSettings>;
  /** narration cache shared by every project ('' = each project's .kino-cache) */
  cacheDir?: string;
  export: {
    /** Mbit/s */
    videoBitrate?: number;
    /** PDF page size × the video size */
    pdfScale?: number;
  };
}

export interface SettingsView {
  settings: Settings;
  file: string;
  /** settings an env var overrides: "elevenlabs.apiKey" → "ELEVENLABS_API_KEY" */
  env: Record<string, string>;
}

/** Per project: kino.json */
export interface ProjectSettings {
  tts: {
    /** '' = the global default */
    provider?: Provider | '';
    /** default voice settings (speaker, model, language, speed...) */
    voice?: Record<string, string>;
  };
}

/** A template a new project starts from: built in (the bundled examples) or custom (~/.kino/templates). */
export interface Template {
  name: string;
  source: string;
  /** custom templates: the backend copies it (and a folder template's assets) by name */
  custom?: boolean;
}

/** The custom templates in ~/.kino/templates. */
export interface TemplatesView {
  dir: string;
  templates: { name: string; path: string; folder: boolean; source: string }[];
}

export interface RecentProject {
  path: string;
  name: string;
  opened: string;
  exists: boolean;
}

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  isProject: boolean;
  isScript: boolean;
}

export interface DirListing {
  path: string;
  parent?: string;
  scripts: string[];
  entries: DirEntry[];
}

export interface Harness {
  id: string;
  name: string;
  command: string;
  available: boolean;
}

export interface TerminalInfo {
  id: string;
  harness: string;
  running: boolean;
}

/** What the studio reports after compiling; written to .kino/status.json for agents. */
export interface Status {
  ok: boolean;
  error?: { line: number; col: number; message: string };
  duration: number;
  steps?: { kind: string; name: string; start: number; end: number; line: number }[];
  narration?: { clips: number; missing: number };
}

type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

let wails: typeof import('@wailsio/runtime') | null = null;
const ready: Promise<void> = (async () => {
  if (isWails) {
    wails = await import('@wailsio/runtime');
    return;
  }
  const es = new EventSource('/events');
  es.onmessage = (ev) => {
    const msg = JSON.parse(ev.data) as { name: string; data: unknown };
    listeners.get(msg.name)?.forEach((fn) => fn(msg.data));
  };
})();

async function call<T>(method: string, ...args: unknown[]): Promise<T> {
  await ready;
  if (wails) return (await wails.Call.ByName(`${SERVICE}.${method}`, ...args)) as T;
  let res: Response;
  try {
    res = await fetch(`/rpc/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  } catch {
    throw new Error(NO_BACKEND);
  }
  // a dev proxy with nothing behind it answers with an HTML/text error page
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) throw new Error(NO_BACKEND);
  const body = (await res.json()) as { result?: T; error?: string };
  if (body.error) throw new Error(body.error);
  return body.result as T;
}

export function on<T>(name: string, fn: (data: T) => void): () => void {
  let set = listeners.get(name);
  if (!set) listeners.set(name, (set = new Set()));
  set.add(fn as Listener);
  let off: (() => void) | undefined;
  let gone = false;
  if (isWails) {
    ready.then(() => {
      if (!gone) off = wails!.Events.On(name, (ev: { data: unknown }) => fn(ev.data as T));
    });
  }
  return () => {
    gone = true;
    set!.delete(fn as Listener);
    off?.();
  };
}

export const errorText = (e: unknown) => String(e instanceof Error ? e.message : e).replace(/^Error: /, '');

export const api = {
  currentProject: () => call<Project | null>('CurrentProject'),
  openProject: (path: string) => call<Project>('OpenProject', path),
  /** template: the name of a custom template to start from instead of source */
  newProject: (dir: string, name: string, source: string, template = '') => call<Project>('NewProject', dir, name, source, template),
  templates: () => call<TemplatesView>('Templates'),
  closeProject: () => call<void>('CloseProject'),
  recentProjects: () => call<RecentProject[] | null>('RecentProjects'),
  listDir: (path: string) => call<DirListing>('ListDir', path),
  hasNativeDialogs: () => call<boolean>('HasNativeDialogs'),
  chooseDirectory: (title: string, canCreate: boolean) => call<string>('ChooseDirectory', title, canCreate),
  saveSource: (source: string) => call<void>('SaveSource', source),
  reportStatus: (source: string, status: Status) => call<void>('ReportStatus', source, status),
  harnesses: () => call<Harness[]>('Harnesses'),
  startTerminal: (harness: string, cols: number, rows: number) => call<string>('StartTerminal', harness, cols, rows),
  terminalWrite: (id: string, data: string) => call<void>('TerminalWrite', id, data),
  terminalResize: (id: string, cols: number, rows: number) => call<void>('TerminalResize', id, cols, rows),
  terminalBuffer: (id: string) => call<string>('TerminalBuffer', id),
  stopTerminal: (id: string) => call<void>('StopTerminal', id),
  terminals: () => call<TerminalInfo[] | null>('Terminals'),
  settings: () => call<SettingsView>('Settings'),
  saveSettings: (s: Settings) => call<void>('SaveSettings', s),
  saveProjectSettings: (s: ProjectSettings) => call<Project>('SaveProjectSettings', s),
  ttsVoices: (provider: Provider) => call<string[] | null>('TTSVoices', provider),
};

export const EVENT_PROJECT = 'project:changed';
export const EVENT_SOURCE = 'project:source';
export const EVENT_TERMINAL_DATA = 'terminal:data';
export const EVENT_TERMINAL_EXIT = 'terminal:exit';
