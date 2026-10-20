import { KinoError, type Expr, type Item, type Program } from '../dsl/ast.ts';
import { parse } from '../dsl/parser.ts';
import { evaluate, isObj, isRef, str, type Value } from './values.ts';

export const DEFAULT_TTS_MODEL = 'KittenML/kitten-tts-2';

export interface Voice {
  model: string;
  /** built-in voice: Jasper, Bella, Bruno, Luna, Marcus, Victoria, ... (Kitten TTS 2 has 38 English voices) */
  speaker: string;
  /** "Auto"/"English", or another language: Spanish, German, French, ... (uses that language's voice) */
  language: string;
  /** Kitten: an emotion (joyful, excited, tender, stern, ...); Qwen: free-form style direction */
  instruct: string;
  /** Kitten decoding preset: "stable" (default) or "expressive" */
  preset: string;
  /** voice cloning: path to a 5-30s recording of one speaker, and optionally its transcript */
  reference: string;
  referenceText: string;
}

export const DEFAULT_VOICE: Voice = { model: DEFAULT_TTS_MODEL, speaker: 'Jasper', language: 'Auto', instruct: '', preset: '', reference: '', referenceText: '' };

const VOICE_KEYS = Object.keys(DEFAULT_VOICE) as (keyof Voice)[];

/** Text without Kitten expression markup ([joyful], <laugh>, (((stress)))), for subtitles. */
export const spokenText = (text: string) =>
  text.replace(/\(\(\((.*?)\)\)\)/g, '$1').replace(/^\s*\[[a-z]+\]\s*/i, '').replace(/\s*<[a-z]+>\s*/gi, ' ').trim();

/** One clip to synthesize. `id` is a content hash: same text + voice = same cached audio. */
export interface NarrationRequest {
  id: string;
  text: string;
  voice: Voice;
}

/** What the host knows about a clip (once generated). */
export interface NarrationAudio {
  /** milliseconds */
  duration: number;
  /** where the player/exporter can fetch it (browser) or the file path (node) */
  url?: string;
}

export type NarrationLookup = (req: NarrationRequest) => NarrationAudio | undefined;

/** Rough speaking time used until the real audio exists. */
export const estimateDuration = (text: string) => Math.round(400 + (spokenText(text).length / 15) * 1000);

export function narrationRequest(text: string, voice: Voice): NarrationRequest {
  const key = JSON.stringify([...VOICE_KEYS.map((k) => voice[k]), text]);
  return { id: hash(key), text, voice };
}

/** Voice settings from an object value (video.voice, a `voice {}` block, say options). */
export function applyVoice(base: Voice, v: Record<string, Value>, pos?: { line: number; col: number }): Voice {
  const out = { ...base };
  for (const [k, x] of Object.entries(v)) {
    if ((VOICE_KEYS as string[]).includes(k)) out[k as keyof Voice] = str(x);
    else throw new KinoError(`unknown voice setting '${k}' (${VOICE_KEYS.join(', ')})`, pos);
  }
  return out;
}

/** Voice for a `say` given its options: `(speaker: Aiden, instruct: "excited")`. */
export function sayVoice(base: Voice, opts: Expr[]): Voice {
  let v = base;
  for (const e of opts) {
    const val = evaluate(e);
    if (!isObj(val)) throw new KinoError(`say options are key: value pairs, like (speaker: Aiden)`, e.pos);
    v = applyVoice(v, val, e.pos);
  }
  return v;
}

/** The voice set in `video { voice: {...} }`. */
export function videoVoice(program: Program): Voice {
  let v = DEFAULT_VOICE;
  for (const it of program.items) {
    if (it.t !== 'video') continue;
    for (const [k, e] of it.props) {
      if (k !== 'voice') continue;
      const val = evaluate(e);
      if (isObj(val)) v = applyVoice(v, val, e.pos);
      else if (typeof val === 'string' || isRef(val)) v = { ...v, speaker: str(val) };
    }
  }
  return v;
}

/** All clips a script needs, in order (duplicates removed). Throws on syntax errors. */
export function collectNarration(src: string): NarrationRequest[] {
  const program = parse(src);
  let voice = videoVoice(program);
  const out = new Map<string, NarrationRequest>();
  const add = (text: string, opts: Expr[]) => {
    const r = narrationRequest(text, sayVoice(voice, opts));
    out.set(r.id, r);
  };
  for (const it of program.items as Item[]) {
    if (it.t === 'voice') voice = applyVoice(voice, Object.fromEntries(it.props.map(([k, e]) => [k, evaluate(e)])), it.pos);
    else if (it.t === 'say') add(it.text, it.opts);
    else if (it.t === 'frame' || it.t === 'step') for (const s of it.body) if (s.t === 'say') add(s.text, s.opts);
  }
  return [...out.values()];
}

/** 2 x 53-bit cyrb53, hex. Same result in the browser and in Node, no crypto needed. */
function hash(s: string): string {
  const one = (seed: number) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
  };
  return one(1) + one(2);
}
