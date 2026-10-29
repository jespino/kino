// Bundled fonts (assets/fonts) for the live preview and for the MP4 exporter.
// An SVG drawn into a canvas can't see page fonts, so the exporter embeds them.
import interRegular from '../assets/fonts/Inter-Regular.ttf?url';
import interSemiBold from '../assets/fonts/Inter-SemiBold.ttf?url';
import interBold from '../assets/fonts/Inter-Bold.ttf?url';
import interExtraBold from '../assets/fonts/Inter-ExtraBold.ttf?url';
import monoRegular from '../assets/fonts/JetBrainsMono-Regular.ttf?url';
import monoBold from '../assets/fonts/JetBrainsMono-Bold.ttf?url';
import kinoHand from '../assets/fonts/KinoHand-Regular.otf?url';
import latoLight from '../assets/fonts/Lato-Light.ttf?url';
import latoRegular from '../assets/fonts/Lato-Regular.ttf?url';
import latoBold from '../assets/fonts/Lato-Bold.ttf?url';
import latoBlack from '../assets/fonts/Lato-Black.ttf?url';
import fantasqueRegular from '../assets/fonts/FantasqueSansMono-Regular.ttf?url';
import fantasqueBold from '../assets/fonts/FantasqueSansMono-Bold.ttf?url';
import bangers from '../assets/fonts/Bangers-Regular.ttf?url';
import comicRegular from '../assets/fonts/ComicNeue-Regular.ttf?url';
import comicBold from '../assets/fonts/ComicNeue-Bold.ttf?url';
import pressStart from '../assets/fonts/PressStart2P-Regular.ttf?url';
import vt323 from '../assets/fonts/VT323-Regular.ttf?url';
import fredokaRegular from '../assets/fonts/Fredoka-Regular.ttf?url';
import fredokaSemiBold from '../assets/fonts/Fredoka-SemiBold.ttf?url';
import fredokaBold from '../assets/fonts/Fredoka-Bold.ttf?url';

const FONTS = [
  { family: 'Inter', weight: 400, url: interRegular },
  { family: 'Inter', weight: 600, url: interSemiBold },
  { family: 'Inter', weight: 700, url: interBold },
  { family: 'Inter', weight: 800, url: interExtraBold },
  { family: 'JetBrains Mono', weight: 400, url: monoRegular },
  { family: 'JetBrains Mono', weight: 700, url: monoBold },
  // sketch theme
  { family: 'Kino Hand', weight: 400, url: kinoHand },
  // Lato (slide-template themes)
  { family: 'Lato', weight: 300, url: latoLight },
  { family: 'Lato', weight: 400, url: latoRegular },
  { family: 'Lato', weight: 700, url: latoBold },
  { family: 'Lato', weight: 900, url: latoBlack },
  { family: 'Fantasque Sans Mono', weight: 400, url: fantasqueRegular },
  { family: 'Fantasque Sans Mono', weight: 700, url: fantasqueBold },
  // comic theme
  { family: 'Bangers', weight: 400, url: bangers },
  { family: 'Comic Neue', weight: 400, url: comicRegular },
  { family: 'Comic Neue', weight: 700, url: comicBold },
  // pixel theme
  { family: 'Press Start 2P', weight: 400, url: pressStart },
  { family: 'VT323', weight: 400, url: vt323 },
  // paper-cut theme
  { family: 'Fredoka', weight: 400, url: fredokaRegular },
  { family: 'Fredoka', weight: 600, url: fredokaSemiBold },
  { family: 'Fredoka', weight: 700, url: fredokaBold },
];

export async function loadFonts(): Promise<void> {
  await Promise.all(
    FONTS.map(async (f) => {
      const face = new FontFace(f.family, `url(${f.url})`, { weight: String(f.weight) });
      document.fonts.add(await face.load());
    }),
  );
}

const rules = new Map<string, Promise<string>>();

function fontFaceRule(f: (typeof FONTS)[number]): Promise<string> {
  const key = `${f.family}|${f.weight}`;
  if (!rules.has(key))
    rules.set(
      key,
      fetch(f.url)
        .then((r) => r.arrayBuffer())
        .then((ab) => {
          const buf = new Uint8Array(ab);
          let bin = '';
          for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          const otf = f.url.includes('.otf');
          return `@font-face{font-family:'${f.family}';font-weight:${f.weight};src:url(data:font/${otf ? 'otf' : 'ttf'};base64,${btoa(bin)}) format('${otf ? 'opentype' : 'truetype'}')}`;
        }),
    );
  return rules.get(key)!;
}

/**
 * `<style>` with the fonts as data URIs, to put inside each exported SVG's <defs>.
 * Only the families named in `fontFamilies` (the theme's font lists) are embedded.
 */
export async function embeddedFontStyle(fontFamilies: string[]): Promise<string> {
  const wanted = fontFamilies.join(',');
  const used = FONTS.filter((f) => wanted.includes(f.family));
  return `<style>${(await Promise.all(used.map(fontFaceRule))).join('')}</style>`;
}
