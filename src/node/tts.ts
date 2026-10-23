// Node-only: narration audio cache used by the CLI renderer (the studio's Go backend,
// internal/app/studio.go, reads and writes the same layout).
// Clips live in .kino-cache/tts/<id>.wav (+ .json with the text/voice for humans).
//
// Providers (voice `provider:`): the local server (tts/server.py), ElevenLabs,
// OpenAI, or espeak-ng / festival installed on this machine. Their keys and
// commands come from the settings the studio edits (see settings.ts).
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULT_TTS_MODEL, DEFAULT_VOICE, spokenText, type NarrationRequest, type Voice } from '../core/narration.ts';
import { cacheRoot, providerSettings, settingsFile } from './settings.ts';

export interface TtsConfig {
  /** TTS server, default $KINO_TTS_URL, the studio setting, or http://127.0.0.1:8808 */
  server?: string;
  /** default $KINO_CACHE, the studio setting, or ./.kino-cache */
  cacheDir?: string;
}

export interface CachedClip {
  id: string;
  file: string;
  /** ms */
  duration: number;
}

export const ttsServer = (c: TtsConfig = {}) => (c.server ?? providerSettings('local').url ?? 'http://127.0.0.1:8808').replace(/\/$/, '');
const cacheDir = (c: TtsConfig = {}) => resolve(c.cacheDir ?? cacheRoot(), 'tts');

/** Duration (ms) of a PCM WAV file from its header. */
export function wavDuration(buf: Buffer): number {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let byteRate = 0;
  for (let off = 12; off + 8 <= buf.length; ) {
    const id = buf.toString('ascii', off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(off + 16);
    if (id === 'data') {
      if (!byteRate) break;
      // streaming writers may leave the size as 0/0xffffffff
      if (size === 0 || size === 0xffffffff) size = buf.length - off - 8;
      return Math.round((size / byteRate) * 1000);
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('WAV file without fmt/data chunks');
}

/** Clip already in the cache, or undefined. */
export function cachedClip(req: NarrationRequest, cfg: TtsConfig = {}): CachedClip | undefined {
  const file = join(cacheDir(cfg), `${req.id}.wav`);
  if (!existsSync(file)) return undefined;
  try {
    return { id: req.id, file, duration: wavDuration(readFileSync(file)) };
  } catch {
    return undefined;
  }
}

const inflight = new Map<string, Promise<CachedClip>>();

/** Cached clip, synthesizing it with the TTS server if needed. Concurrent calls for the same clip share one request. */
export function ensureClip(req: NarrationRequest, cfg: TtsConfig = {}): Promise<CachedClip> {
  const hit = cachedClip(req, cfg);
  if (hit) return Promise.resolve(hit);
  let p = inflight.get(req.id);
  if (!p) {
    p = synthesize(req, cfg).finally(() => inflight.delete(req.id));
    inflight.set(req.id, p);
  }
  return p;
}

async function synthesize(req: NarrationRequest, cfg: TtsConfig): Promise<CachedClip> {
  const buf = await synthesizeAudio(req, cfg);
  const duration = wavDuration(buf);
  const dir = cacheDir(cfg);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${req.id}.wav`);
  writeFileSync(file, buf);
  writeFileSync(join(dir, `${req.id}.json`), JSON.stringify({ text: req.text, voice: req.voice, duration }, null, 2));
  return { id: req.id, file, duration };
}

/** WAV audio for a request from its provider, without caching it. */
export function synthesizeAudio(req: NarrationRequest, cfg: TtsConfig = {}): Promise<Buffer> {
  switch (req.voice.provider) {
    case 'elevenlabs':
      return elevenlabs(req);
    case 'openai':
      return openai(req);
    case 'espeak':
      return espeak(req);
    case 'festival':
      return festival(req);
    default:
      return local(req, cfg);
  }
}

async function local(req: NarrationRequest, cfg: TtsConfig): Promise<Buffer> {
  const url = `${ttsServer(cfg)}/synthesize`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // the server may run elsewhere: send an absolute path for voice-cloning references
      body: JSON.stringify({ text: req.text, ...req.voice, reference: req.voice.reference && resolve(req.voice.reference) }),
    });
  } catch {
    throw new Error(`TTS server not reachable at ${ttsServer(cfg)}. Start it with \`npm run tts\` (first time: \`npm run tts:setup\`).`);
  }
  return audioBody(req, res);
}

async function audioBody(req: NarrationRequest, res: Response): Promise<Buffer> {
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`TTS failed for "${req.text.slice(0, 40)}": ${res.status} ${msg}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Settings of a hosted provider, failing early without an API key or with local-only options. */
function hosted(req: NarrationRequest, name: string, envKey: string, defaultUrl: string) {
  const c = providerSettings(name);
  if (!c.apiKey) throw new Error(`${name} needs an API key: add it in Kino Studio's settings (or ${settingsFile()}), or set ${envKey}`);
  if (req.voice.reference) throw new Error(`voice cloning (reference) only works with the local provider; clone the voice in ${name} and use it as the speaker`);
  return { apiKey: c.apiKey, url: (c.url ?? defaultUrl).replace(/\/$/, '') };
}

const PCM_RATE = 24000;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** The voice's speed setting as a number, or undefined for the provider's normal rate. */
function speed(v: Voice): number | undefined {
  const s = parseFloat(v.speed);
  return s > 0 && s !== 1 ? s : undefined;
}

/** Wrap raw 16-bit mono PCM in a WAV header. */
export function pcmToWav(pcm: Buffer, rate = PCM_RATE): Buffer {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVEfmt ', 8, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const elevenVoices = new Map<string, Promise<{ voice_id: string; name: string }[]>>();

/** ElevenLabs voice id from a name ("Rachel") or an id. */
async function elevenVoice(speaker: string, apiKey: string, url: string): Promise<string> {
  if (/^[A-Za-z0-9]{20}$/.test(speaker)) return speaker;
  let list = elevenVoices.get(apiKey);
  if (!list) {
    list = fetch(`${url}/v1/voices`, { headers: { 'xi-api-key': apiKey } }).then(async (res) => {
      if (!res.ok) throw new Error(`ElevenLabs voices: ${res.status} ${await res.text().catch(() => '')}`);
      return (await res.json()).voices;
    });
    list.catch(() => elevenVoices.delete(apiKey));
    elevenVoices.set(apiKey, list);
  }
  const voices = await list;
  const name = speaker.toLowerCase();
  // names may carry a description: "Sarah - Mature, Reassuring"
  const short = (v: { name: string }) => v.name.split(/\s+-\s+/)[0];
  const v = voices.find((v) => v.name.toLowerCase() === name) ?? voices.find((v) => short(v).toLowerCase() === name);
  if (!v)
    throw new Error(
      `'${speaker}' is not one of your ElevenLabs voices: choose one in the project's kino.json (Settings → This project in the studio) or with speaker: in the script. Available: ${voices.map(short).join(', ')}`,
    );
  return v.voice_id;
}

async function elevenlabs(req: NarrationRequest): Promise<Buffer> {
  const { apiKey, url } = hosted(req, 'elevenlabs', 'ELEVENLABS_API_KEY', 'https://api.elevenlabs.io');
  const v = req.voice;
  const model = !v.model || v.model === DEFAULT_TTS_MODEL ? 'eleven_multilingual_v2' : v.model;
  // eleven_v3 understands [emotion] tags, like Kitten; older models would read them aloud
  let text = model === 'eleven_v3' ? req.text.replace(/\(\(\((.*?)\)\)\)/g, '$1').replace(/\s*<[a-z]+>\s*/gi, ' ').trim() : spokenText(req.text);
  if (model === 'eleven_v3' && v.instruct && !text.startsWith('[')) text = `[${v.instruct}] ${text}`;
  const id = await elevenVoice(v.speaker, apiKey, url);
  const res = await fetch(`${url}/v1/text-to-speech/${id}?output_format=pcm_${PCM_RATE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({ text, model_id: model, ...(speed(v) ? { voice_settings: { speed: clamp(speed(v)!, 0.7, 1.2) } } : {}) }),
  });
  return pcmToWav(await audioBody(req, res));
}

async function openai(req: NarrationRequest): Promise<Buffer> {
  const { apiKey, url } = hosted(req, 'openai', 'OPENAI_API_KEY', 'https://api.openai.com/v1');
  const v = req.voice;
  const res = await fetch(`${url}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: !v.model || v.model === DEFAULT_TTS_MODEL ? 'gpt-4o-mini-tts' : v.model,
      voice: !v.speaker || v.speaker === DEFAULT_VOICE.speaker ? 'alloy' : v.speaker.toLowerCase(),
      input: spokenText(req.text),
      // style direction (gpt-4o-mini-tts)
      ...(v.instruct ? { instructions: v.instruct } : {}),
      ...(speed(v) ? { speed: clamp(speed(v)!, 0.25, 4) } : {}),
      response_format: 'pcm', // 24kHz 16-bit mono
    }),
  });
  return pcmToWav(await audioBody(req, res));
}

/** Make sure every clip exists, one at a time (the model serializes anyway). */
export async function ensureAll(reqs: NarrationRequest[], cfg: TtsConfig = {}, onProgress?: (done: number, total: number, req: NarrationRequest) => void) {
  const out = new Map<string, CachedClip>();
  const missing = reqs.filter((r) => !cachedClip(r, cfg));
  let done = 0;
  for (const r of reqs) {
    const wasMissing = missing.includes(r);
    if (wasMissing) onProgress?.(done, missing.length, r);
    out.set(r.id, await ensureClip(r, cfg));
    if (wasMissing) done++;
  }
  if (missing.length) onProgress?.(done, missing.length, missing[missing.length - 1]);
  return out;
}

// ---- classic synthesizers on this machine -----------------------------------

/** espeak voices by language name; other values (en-us, es, en+f3...) go to espeak as they are */
const ESPEAK_LANGUAGES: Record<string, string> = {
  auto: 'en', english: 'en', spanish: 'es', german: 'de', french: 'fr', italian: 'it', portuguese: 'pt',
  russian: 'ru', chinese: 'cmn', japanese: 'ja', korean: 'ko', arabic: 'ar', hindi: 'hi', dutch: 'nl', polish: 'pl',
};

/** Voice names reach the command line: keep them to what voice names look like. */
function voiceName(name: string, provider: string): string {
  if (!/^[A-Za-z0-9_.+][A-Za-z0-9_.+-]*$/.test(name)) throw new Error(`invalid ${provider} voice '${name}'`);
  return name;
}

/** Runs a synthesizer that writes a WAV file, feeding it the text on stdin. */
async function runToWav(provider: string, command: string, args: (out: string) => string[], text: string): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), 'kino-tts-'));
  const out = join(dir, 'out.wav');
  try {
    await new Promise<void>((ok, fail) => {
      const child = execFile(command, args(out), { timeout: 120_000 }, (err, _stdout, stderr) => {
        if (!err) return ok();
        fail(
          (err as NodeJS.ErrnoException).code === 'ENOENT'
            ? new Error(`${provider} is not installed ('${command}' not found); install it or set its command in Kino Studio's settings`)
            : new Error(`${provider} failed: ${String(stderr).trim() || err.message}`),
        );
      });
      child.stdin?.end(text);
    });
    return readFileSync(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function espeak(req: NarrationRequest): Promise<Buffer> {
  const v = req.voice;
  const custom = v.speaker && v.speaker !== DEFAULT_VOICE.speaker;
  const voice = voiceName(custom ? v.speaker : (ESPEAK_LANGUAGES[v.language.toLowerCase()] ?? (v.language || 'en')), 'espeak');
  const wpm = Math.round(175 * (speed(v) ?? 1));
  return runToWav('espeak', providerSettings('espeak').command || 'espeak-ng', (out) => ['-v', voice, '-s', String(wpm), '-w', out, '--stdin'], spokenText(req.text));
}

function festival(req: NarrationRequest): Promise<Buffer> {
  const v = req.voice;
  const evals: string[] = [];
  // festival's Scheme names voices voice_<name>: kal_diphone, cmu_us_slt_arctic_hts...
  if (v.speaker && v.speaker !== DEFAULT_VOICE.speaker) evals.push('-eval', `(voice_${voiceName(v.speaker, 'festival').replace(/^voice_/, '')})`);
  if (speed(v)) evals.push('-eval', `(Parameter.set 'Duration_Stretch ${(1 / speed(v)!).toFixed(3)})`);
  return runToWav('festival', providerSettings('festival').command || 'text2wave', (out) => [...evals, '-o', out], spokenText(req.text));
}
