// Backend transport (agentstudio's): in the desktop app, calls go through the
// Wails runtime; in a browser (kino serve / Vite dev), through HTTP +
// server-sent events. Both reach the same Go service (internal/app.App).
import { createBackend, workspaceApi, type Project as StudioProject } from '@jespino/agentstudio';

export const backend = createBackend({
  service: 'github.com/jespino/kino/internal/app.App',
  noBackend:
    'No Kino backend is reachable. In a browser, run `make dev` (it starts `kino serve` and this UI); ' +
    'the desktop app (`make app-dev`) has it built in.',
  channel: 'kino',
});

export const { isWails, call, on, broadcast } = backend;
export { errorText } from '@jespino/agentstudio';
export type { DirEntry, DirListing, Harness, RecentProject, TerminalInfo } from '@jespino/agentstudio';

export interface Project extends StudioProject {
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

/** What the studio reports after compiling; written to .kino/status.json for agents. */
export interface Status {
  ok: boolean;
  error?: { line: number; col: number; message: string };
  duration: number;
  steps?: { kind: string; name: string; start: number; end: number; line: number }[];
  narration?: { clips: number; missing: number };
}

export const api = {
  ...workspaceApi<Project>(call),
  /** template: the name of a custom template to start from instead of source */
  newProject: (dir: string, name: string, source: string, template = '') => call<Project>('NewProject', dir, name, source, template),
  templates: () => call<TemplatesView>('Templates'),
  reportStatus: (source: string, status: Status) => call<void>('ReportStatus', source, status),
  /** false when the shell can't open native windows (a browser: use window.open) */
  openSpeakerWindow: () => call<boolean>('OpenSpeakerWindow'),
  /** .kino/sheet.png (PNG bytes, base64) for the source last reported */
  reportSheet: (source: string, png: string) => call<void>('ReportSheet', source, png),
  settings: () => call<SettingsView>('Settings'),
  saveSettings: (s: Settings) => call<void>('SaveSettings', s),
  saveProjectSettings: (s: ProjectSettings) => call<Project>('SaveProjectSettings', s),
  ttsVoices: (provider: Provider) => call<string[] | null>('TTSVoices', provider),
};

export { EVENT_PROJECT, EVENT_SOURCE } from '@jespino/agentstudio';
/** presenting window → speaker view: SpeakerState (null: not presenting) */
export const EVENT_PRESENT_SHOW = 'present:show';
/** speaker view → presenting window: a DeckCommand, or 'hello' to get the current state */
export const EVENT_PRESENT_CMD = 'present:cmd';
