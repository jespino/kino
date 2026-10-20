import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { defineConfig, type Plugin } from 'vite';
import { cachedClip, ensureClip, ttsServer, type TtsConfig } from '../src/node/tts.ts';
import type { NarrationRequest } from '../src/core/narration.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg: TtsConfig = { cacheDir: process.env.KINO_CACHE ?? join(root, '.kino-cache') };

const readJson = (req: IncomingMessage) =>
  new Promise<any>((ok, fail) => {
    let s = '';
    req.on('data', (c) => (s += c));
    req.on('end', () => {
      try {
        ok(JSON.parse(s || '{}'));
      } catch (e) {
        fail(e);
      }
    });
  });

const send = (res: ServerResponse, code: number, body: unknown) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

/**
 * Narration endpoints for the studio:
 *   POST /__kino/narration {requests, generate}  -> {clips: [{id, duration, url}], missing: [id]}
 *   GET  /__kino/audio/<id>.wav                   -> cached audio
 *   GET  /__kino/tts-health                       -> TTS server status
 *   GET  /__kino/image?src=<path or url>          -> image bytes for the image widget
 *        (paths resolve against examples/, then the project root, and must stay inside it)
 */
function narration(): Plugin {
  return {
    name: 'kino-narration',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        try {
          if (url === '/__kino/narration' && req.method === 'POST') {
            const { requests, generate } = (await readJson(req)) as { requests: NarrationRequest[]; generate?: boolean };
            const clips = [];
            const missing = [];
            for (const r of requests) {
              const c = generate ? await ensureClip(r, cfg) : cachedClip(r, cfg);
              if (c) clips.push({ id: c.id, duration: c.duration, url: `/__kino/audio/${c.id}.wav` });
              else missing.push(r.id);
            }
            return send(res, 200, { clips, missing });
          }
          const m = /^\/__kino\/audio\/([0-9a-f]+)\.wav$/.exec(url);
          if (m) {
            const file = join(cfg.cacheDir!, 'tts', `${m[1]}.wav`);
            if (!existsSync(file)) return send(res, 404, { error: 'not cached' });
            res.setHeader('Content-Type', 'audio/wav');
            return void createReadStream(file).pipe(res);
          }
          if (url.startsWith('/__kino/image?')) {
            const src = new URLSearchParams(url.slice(url.indexOf('?') + 1)).get('src') ?? '';
            if (/^https?:\/\//i.test(src)) {
              const r = await fetch(src);
              if (!r.ok) return send(res, 404, { error: `HTTP ${r.status}` });
              res.setHeader('Content-Type', r.headers.get('content-type') ?? 'application/octet-stream');
              return void res.end(Buffer.from(await r.arrayBuffer()));
            }
            const file = [join(root, 'examples', src), join(root, src)].find((f) => !relative(root, resolve(f)).startsWith('..') && existsSync(f));
            if (!file) return send(res, 404, { error: 'not found' });
            return void res.end(readFileSync(file));
          }
          if (url === '/__kino/tts-health') {
            try {
              const h = await fetch(`${ttsServer(cfg)}/health`);
              return send(res, 200, { reachable: true, server: ttsServer(cfg), ...(await h.json()) });
            } catch {
              return send(res, 200, { reachable: false, server: ttsServer(cfg) });
            }
          }
        } catch (e) {
          return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [narration()],
  server: { fs: { allow: [root] } },
});
