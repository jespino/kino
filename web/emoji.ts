// Twemoji artwork for the studio, loaded lazily for the emoji a script uses.
import { emojiFileNames, extractEmojis, type EmojiProvider } from '../src/index.ts';

const files = import.meta.glob('../node_modules/@twemoji/svg/*.svg', { query: '?raw', import: 'default' }) as Record<string, () => Promise<string>>;
const loaded = new Map<string, string | null>();

export const studioEmoji: EmojiProvider = (e) => loaded.get(e) ?? undefined;

/** Load artwork for every emoji in `src`; resolves true if something new arrived. */
export async function preloadEmoji(src: string): Promise<boolean> {
  const todo = extractEmojis(src).filter((e) => !loaded.has(e));
  if (!todo.length) return false;
  await Promise.all(
    todo.map(async (e) => {
      const name = emojiFileNames(e).find((n) => files[`../node_modules/@twemoji/svg/${n}.svg`]);
      loaded.set(e, name ? await files[`../node_modules/@twemoji/svg/${name}.svg`]() : null);
    }),
  );
  return true;
}
