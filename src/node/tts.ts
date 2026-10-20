// Node-only: narration audio cache shared by the CLI renderer and the studio dev server.
// Clips live in .kino-cache/tts/<id>.wav (+ .json with the text/voice for humans).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { NarrationRequest } from '../core/narration.ts';

export interface TtsConfig {
  /** TTS server, default $KINO_TTS_URL or http://127.0.0.1:8808 */
  server?: string;
  /** default $KINO_CACHE or ./.kino-cache */
  cacheDir?: string;
}

export interface CachedClip {
  id: string;
  file: string;
  /** ms */
  duration: number;
}

export const ttsServer = (c: TtsConfig = {}) => (c.server ?? process.env.KINO_TTS_URL ?? 'http://127.0.0.1:8808').replace(/\/$/, '');
const cacheDir = (c: TtsConfig = {}) => resolve(c.cacheDir ?? process.env.KINO_CACHE ?? '.kino-cache', 'tts');

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
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`TTS failed for "${req.text.slice(0, 40)}": ${res.status} ${msg}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const duration = wavDuration(buf);
  const dir = cacheDir(cfg);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${req.id}.wav`);
  writeFileSync(file, buf);
  writeFileSync(join(dir, `${req.id}.json`), JSON.stringify({ text: req.text, voice: req.voice, duration }, null, 2));
  return { id: req.id, file, duration };
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
