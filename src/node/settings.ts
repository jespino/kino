// Node-only: the settings Kino Studio edits, read by the CLI too (the studio's
// Go backend, internal/app/settings.go, reads and writes the same files):
//
//   <config dir>/kino/config.json  global: provider credentials and commands, the
//                                  default provider, the narration cache, export quality
//   <project>/kino.json            per project: its narration provider and default voice
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ProjectVoice, Voice } from '../core/narration.ts';

export interface ProviderSettings {
  apiKey?: string;
  url?: string;
  /** espeak / festival: the program to run */
  command?: string;
}

export interface Settings {
  tts?: {
    /** for projects that don't choose one */
    provider?: string;
    local?: ProviderSettings;
    elevenlabs?: ProviderSettings;
    openai?: ProviderSettings;
    espeak?: ProviderSettings;
    festival?: ProviderSettings;
  };
  /** narration cache shared by every project ('' = each project's .kino-cache) */
  cacheDir?: string;
}

export interface ProjectSettings {
  tts?: {
    /** '' = the global default */
    provider?: string;
    voice?: Partial<Voice>;
  };
}

/** Env vars that win over the config file (handy in CI and scripts). */
const ENV: Record<string, Partial<Record<keyof ProviderSettings, string>>> = {
  local: { url: 'KINO_TTS_URL' },
  elevenlabs: { apiKey: 'ELEVENLABS_API_KEY', url: 'ELEVENLABS_BASE_URL' },
  openai: { apiKey: 'OPENAI_API_KEY', url: 'OPENAI_BASE_URL' },
};

/** Go's os.UserConfigDir(), so the CLI and the studio read the same file. */
export function userConfigDir(): string {
  if (process.platform === 'win32') return process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support');
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
}

export const settingsFile = () => join(userConfigDir(), 'kino', 'config.json');

const expandHome = (p: string) => (p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p);

function readJSON<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

let settings: Settings | undefined;

export function readSettings(): Settings {
  return (settings ??= readJSON<Settings>(settingsFile()) ?? {});
}

/** A provider's settings, env vars first. */
export function providerSettings(name: string): ProviderSettings {
  const out: ProviderSettings = { ...(readSettings().tts as Record<string, ProviderSettings> | undefined)?.[name] };
  for (const [k, env] of Object.entries(ENV[name] ?? {})) if (process.env[env!]) out[k as keyof ProviderSettings] = process.env[env!];
  if (out.command) out.command = expandHome(out.command);
  return out;
}

/** Narration cache folder for a project: $KINO_CACHE, then the global setting, then <project>/.kino-cache. */
export function cacheRoot(projectDir = '.'): string {
  const dir = process.env.KINO_CACHE || readSettings().cacheDir;
  return dir ? resolve(expandHome(dir)) : resolve(projectDir, '.kino-cache');
}

export const readProjectSettings = (dir: string): ProjectSettings => readJSON<ProjectSettings>(join(dir, 'kino.json')) ?? {};

/** A project's voice settings (its kino.json) and Kino's default provider. */
export function projectVoice(dir: string): ProjectVoice {
  const tts = readProjectSettings(dir).tts ?? {};
  return { settings: { ...tts.voice, provider: tts.provider }, defaultProvider: readSettings().tts?.provider };
}
