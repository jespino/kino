// Node-only: emoji artwork from the bundled Twemoji package (@twemoji/svg).
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { emojiFileNames, type EmojiProvider } from '../core/emoji.ts';

let dir: string | null | undefined;
const cache = new Map<string, string | undefined>();

export const twemoji: EmojiProvider = (emoji) => {
  if (dir === undefined) {
    try {
      dir = dirname(createRequire(import.meta.url).resolve('@twemoji/svg/1f600.svg'));
    } catch {
      dir = null;
    }
  }
  if (!dir) return undefined;
  if (!cache.has(emoji)) {
    const f = emojiFileNames(emoji).map((n) => join(dir!, `${n}.svg`)).find(existsSync);
    cache.set(emoji, f && readFileSync(f, 'utf8'));
  }
  return cache.get(emoji);
};
