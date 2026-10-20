// Emoji artwork: hosts provide SVG markup per emoji (Twemoji by default), the
// engine embeds it as an <image>, so emoji look identical everywhere.

/** Returns the SVG markup for an emoji, or undefined if there's no artwork. */
export type EmojiProvider = (emoji: string) => string | undefined;

/** One emoji: pictographs with modifiers/ZWJ sequences, keycaps, or flags. */
export const EMOJI_RE =
  /(?:\p{Regional_Indicator}{2})|(?:[#*0-9]️?⃣)|(?:\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*(?:‍\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}])*)*)/gu;

/** Distinct emoji used anywhere in a source text (to preload artwork). */
export function extractEmojis(src: string): string[] {
  return [...new Set(src.match(EMOJI_RE) ?? [])];
}

/** Twemoji file names to try: "1f469-200d-1f4bb", then without variation selectors. */
export function emojiFileNames(emoji: string): string[] {
  const cps = [...emoji].map((c) => c.codePointAt(0)!.toString(16));
  const full = cps.join('-');
  const noVs = cps.filter((c) => c !== 'fe0f').join('-');
  return full === noVs ? [full] : [full, noVs];
}

const uriCache = new Map<string, string>();

/** data: URI for an emoji's artwork (cached), or undefined. */
export function emojiDataUri(provider: EmojiProvider | undefined, emoji: string): string | undefined {
  if (!provider) return undefined;
  let uri = uriCache.get(emoji);
  if (uri === undefined) {
    // only hits are cached: artwork may arrive later (lazy loading in the studio)
    const svg = provider(emoji);
    if (!svg) return undefined;
    uri = `data:image/svg+xml;base64,${toBase64(svg)}`;
    uriCache.set(emoji, uri);
  }
  return uri;
}

function toBase64(s: string): string {
  const B = (globalThis as any).Buffer;
  if (B) return B.from(s, 'utf8').toString('base64');
  return btoa(String.fromCharCode(...new TextEncoder().encode(s)));
}
