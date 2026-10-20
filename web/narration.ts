// Studio side of narration: asks the dev server for cached/generated clips,
// decodes them and plays them in sync with the timeline.
import type { Movie, NarrationAudio, NarrationRequest } from '../src/index.ts';

interface ClipInfo {
  id: string;
  duration: number;
  url: string;
}

async function post(requests: NarrationRequest[], generate: boolean): Promise<{ clips: ClipInfo[]; missing: string[] }> {
  const res = await fetch('/__kino/narration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests, generate }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

export class Narration {
  private known = new Map<string, NarrationAudio>();
  private checked = new Set<string>();
  private buffers = new Map<string, AudioBuffer>();
  private sources: AudioBufferSourceNode[] = [];
  private ctx: AudioContext | null = null;

  /** for compile(): real durations of clips we know are cached */
  lookup = (r: NarrationRequest) => this.known.get(r.id);

  /** Ask which clips are already cached (no generation). Resolves true if anything new was learned. */
  async check(reqs: NarrationRequest[]): Promise<boolean> {
    const todo = reqs.filter((r) => !this.known.has(r.id) && !this.checked.has(r.id));
    if (!todo.length) return false;
    todo.forEach((r) => this.checked.add(r.id));
    try {
      const { clips } = await post(todo, false);
      clips.forEach((c) => this.known.set(c.id, { duration: c.duration, url: c.url }));
      return clips.length > 0;
    } catch {
      return false; // e.g. static build without the dev server
    }
  }

  /** Generate the given clips one by one (the server caches them). */
  async generate(reqs: NarrationRequest[], onProgress: (done: number, total: number, r: NarrationRequest) => void) {
    const todo = reqs.filter((r) => !this.known.has(r.id));
    for (let i = 0; i < todo.length; i++) {
      onProgress(i, todo.length, todo[i]);
      const { clips } = await post([todo[i]], true);
      clips.forEach((c) => this.known.set(c.id, { duration: c.duration, url: c.url }));
    }
  }

  audio(): AudioContext {
    this.ctx ??= new AudioContext();
    return this.ctx;
  }

  /** Decode every ready clip of the movie. */
  async load(movie: Movie) {
    const ctx = this.audio();
    await Promise.all(
      movie.narration.map(async (c) => {
        if (!c.url || this.buffers.has(c.request.id)) return;
        const data = await (await fetch(c.url)).arrayBuffer();
        this.buffers.set(c.request.id, await ctx.decodeAudioData(data));
      }),
    );
  }

  /** Schedule all clips relative to timeline time `time` (ms), playing at `speed`. */
  start(movie: Movie, time: number, speed: number) {
    this.stop();
    const ctx = this.audio();
    const now = ctx.currentTime;
    for (const c of movie.narration) {
      const buf = this.buffers.get(c.request.id);
      if (!buf || c.start + buf.duration * 1000 <= time) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = speed;
      src.connect(ctx.destination);
      const delay = (c.start - time) / 1000 / speed;
      if (delay >= 0) src.start(now + delay);
      else src.start(now, (time - c.start) / 1000);
      this.sources.push(src);
    }
  }

  stop() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {}
    }
    this.sources = [];
  }

  /** Mix the whole narration track offline (for the MP4 exporter). */
  async mix(movie: Movie, sampleRate = 48000): Promise<AudioBuffer | null> {
    await this.load(movie);
    const clips = movie.narration.filter((c) => this.buffers.has(c.request.id));
    if (!clips.length) return null;
    const ctx = new OfflineAudioContext(2, Math.ceil((movie.duration / 1000) * sampleRate), sampleRate);
    for (const c of clips) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffers.get(c.request.id)!;
      src.connect(ctx.destination);
      src.start(c.start / 1000);
    }
    return ctx.startRendering();
  }

  async health(): Promise<{ reachable: boolean; ready?: boolean; device?: string; server: string }> {
    try {
      return await (await fetch('/__kino/tts-health')).json();
    } catch {
      return { reachable: false, server: '?' };
    }
  }
}
