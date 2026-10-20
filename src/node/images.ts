// Node-only: load the pictures a script uses (files relative to the .kino file,
// or http(s) URLs) so the image widget can embed them.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { extractImages, imageAsset, type ImageAsset } from '../core/image.ts';

export interface LoadedImages {
  /** by `src` as written in the script */
  assets: Record<string, ImageAsset>;
  /** sources that couldn't be loaded, with the reason */
  missing: { src: string; reason: string }[];
}

/** Load every image `source` refers to. Relative paths resolve against `baseDir` first, then the working directory. */
export async function loadImages(source: string, baseDir: string): Promise<LoadedImages> {
  const assets: Record<string, ImageAsset> = {};
  const missing: LoadedImages['missing'] = [];
  await Promise.all(
    extractImages(source).map(async (src) => {
      try {
        let bytes: Uint8Array;
        if (/^https?:\/\//i.test(src)) {
          const res = await fetch(src);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          bytes = new Uint8Array(await res.arrayBuffer());
        } else {
          const file = [isAbsolute(src) ? src : resolve(baseDir, src), resolve(src)].find(existsSync);
          if (!file) throw new Error('file not found');
          bytes = readFileSync(file);
        }
        const asset = imageAsset(bytes, src);
        if (!asset) throw new Error('not a PNG, JPEG, GIF, WebP or SVG image (or its size is unknown)');
        assets[src] = asset;
      } catch (e) {
        missing.push({ src, reason: e instanceof Error ? e.message : String(e) });
      }
    }),
  );
  return { assets, missing };
}
