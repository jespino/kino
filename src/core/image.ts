// Images (PNG, JPEG, GIF, WebP, SVG) for the image widget. Hosts load the files a
// script uses before compiling (the CLI from disk or http, the studio through
// its dev server) and hand them over as data: URIs, so every frame is still a
// pure function of time and renders the same in the browser and with resvg.

export interface ImageAsset {
  /** data: URI with the image */
  uri: string;
  /** natural size in px (SVG: from width/height or the viewBox) */
  width: number;
  height: number;
}

/** Returns the loaded image for a `src` as written in the script, or undefined if it isn't (yet) available. */
export type ImageProvider = (src: string) => ImageAsset | undefined;

/** Distinct image sources in a script: `src: "..."` props and `x.src = "..."` assignments. */
export function extractImages(source: string): string[] {
  const out = new Set<string>();
  for (const m of source.matchAll(/(?:\bsrc\s*:|\.src\s*=)\s*(["'])((?:(?!\1).)+)\1/g)) out.add(m[2]);
  return [...out];
}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
};

/** MIME type from the file's bytes (falling back to its extension). */
export function imageMime(bytes: Uint8Array, name = ''): string | undefined {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'image/webp';
  const head = new TextDecoder().decode(b.subarray(0, 512));
  if (/<svg[\s>]/i.test(head) || /^\s*<\?xml/.test(head)) return 'image/svg+xml';
  return MIME[name.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? ''];
}

/** Natural size of an image from its bytes, or undefined if the format isn't understood. */
export function imageSize(bytes: Uint8Array, mime: string): { width: number; height: number } | undefined {
  const b = bytes;
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u16le = (i: number) => b[i] | (b[i + 1] << 8);
  const u32be = (i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  switch (mime) {
    case 'image/png':
      return b.length >= 24 ? { width: u32be(16), height: u32be(20) } : undefined;
    case 'image/gif':
      return b.length >= 10 ? { width: u16le(6), height: u16le(8) } : undefined;
    case 'image/jpeg': {
      // walk the segments up to a start-of-frame marker
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) return undefined;
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: u16be(i + 7), height: u16be(i + 5) };
        i += 2 + u16be(i + 2);
      }
      return undefined;
    }
    case 'image/webp': {
      const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (chunk === 'VP8X') return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
      if (chunk === 'VP8L') {
        const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
        return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8 ') return { width: u16le(26) & 0x3fff, height: u16le(28) & 0x3fff };
      return undefined;
    }
    case 'image/svg+xml': {
      const text = new TextDecoder().decode(b);
      const tag = /<svg\b[^>]*>/i.exec(text)?.[0] ?? '';
      const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
      const px = (v?: string) => (v && /^\s*[\d.]+\s*(px)?\s*$/.test(v) ? parseFloat(v) : undefined);
      const vb = attr('viewBox')?.trim().split(/[\s,]+/).map(Number);
      const w = px(attr('width')) ?? (vb && vb.length === 4 ? vb[2] : undefined);
      const h = px(attr('height')) ?? (vb && vb.length === 4 ? vb[3] : undefined);
      return w && h ? { width: w, height: h } : undefined;
    }
  }
  return undefined;
}

/** An ImageAsset from raw file bytes, or undefined if it isn't a supported image. */
export function imageAsset(bytes: Uint8Array, name = ''): ImageAsset | undefined {
  const mime = imageMime(bytes, name);
  if (!mime) return undefined;
  const size = imageSize(bytes, mime);
  if (!size || !size.width || !size.height) return undefined;
  return { uri: `data:${mime};base64,${base64(bytes)}`, ...size };
}

function base64(bytes: Uint8Array): string {
  const B = (globalThis as any).Buffer;
  if (B) return B.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
