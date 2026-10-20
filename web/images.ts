// Pictures for the image widget in the studio, fetched through the dev server
// (paths are relative to examples/ or the project root; URLs are fetched server-side).
// The live preview points at blob: URLs, so a big photo isn't re-parsed from a
// data: URI on every frame; the MP4 exporter needs self-contained frames and
// uses `inlineImages` (data: URIs) instead.
import { extractImages, imageAsset, type ImageAsset, type ImageProvider } from '../src/index.ts';

const loaded = new Map<string, { inline: ImageAsset; preview: ImageAsset } | null>();

export const studioImages: ImageProvider = (src) => loaded.get(src)?.preview;
export const inlineImages: ImageProvider = (src) => loaded.get(src)?.inline;

/** Load every image `source` uses; resolves true if something new arrived. */
export async function preloadImages(source: string): Promise<boolean> {
  const todo = extractImages(source).filter((s) => !loaded.has(s));
  if (!todo.length) return false;
  await Promise.all(
    todo.map(async (src) => {
      try {
        const res = await fetch(`/__kino/image?src=${encodeURIComponent(src)}`);
        const bytes = res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
        const inline = bytes && imageAsset(bytes, src);
        if (!inline) return void loaded.set(src, null);
        const type = inline.uri.slice(5, inline.uri.indexOf(';'));
        loaded.set(src, { inline, preview: { ...inline, uri: URL.createObjectURL(new Blob([bytes], { type })) } });
      } catch {
        loaded.set(src, null); // static build without the dev server: placeholders
      }
    }),
  );
  return todo.some((s) => loaded.get(s));
}
