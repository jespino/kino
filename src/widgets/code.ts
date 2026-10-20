import { codeFont, defineWidget, glowRect, h, type Props, type RenderCtx, type RNode } from '../core/widget.ts';
import { rect } from '../core/geometry.ts';
import { fillTint } from '../core/color.ts';
import { bool, list, num, str, type Value } from '../core/values.ts';
import { highlightLine, type TokKind } from './highlight.ts';

const TOKEN_COLOR: Record<TokKind, string> = {
  kw: 'codeKeyword', str: 'codeString', num: 'codeNumber', comment: 'codeComment', func: 'codeFunc',
  type: 'codeType', punct: 'codePunct', text: 'codeText', ws: 'codeText', reg: 'codeReg', addr: 'codeAddr',
};

/** Parse highlight specs: 3, "2-4", [1, "5-6"] -> sorted list of 1-based line numbers. */
function lines(v: Value): number[] {
  const out = new Set<number>();
  for (const x of list(v)) {
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(str(x));
    if (m) for (let i = +m[1]; i <= +m[2]; i++) out.add(i);
    else if (x !== null) out.add(num(x));
  }
  return [...out].sort((a, b) => a - b);
}

/** contiguous runs, so each highlighted block gets one bar */
function runs(ls: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const l of ls) {
    const last = out[out.length - 1];
    if (last && l === last[1] + 1) last[1] = l;
    else out.push([l, l]);
  }
  return out;
}

function layout(p: Props, rc: RenderCtx) {
  const s = p.size;
  const src = str(p.code).split('\n');
  const lh = s * 1.55;
  const pad = s * 1.15;
  const titleSize = p.titleSize || Math.min(s * 0.75, 20);
  const titleH = p.title ? titleSize * 2.4 : 0;
  const gutter = bool(p.lineNumbers) ? rc.measure(String(src.length), s, true, 400, 0, codeFont(rc)) + s * 1.4 : 0;
  const contentW = Math.max(0, ...src.map((l) => rc.measure(l, s, true, 400, 0, codeFont(rc))));
  const W = Math.max(p.width || 0, pad * 2 + gutter + contentW);
  const H = Math.max(p.height || 0, titleH + (p.title ? pad * 1.5 : pad * 2) + src.length * lh - (lh - s * 1.2));
  const top = p.title ? pad * 0.75 : pad;
  const lineY = (i: number) => titleH + top + i * lh;
  return { s, src, lh, pad, titleH, titleSize, gutter, W, H, lineY };
}

/**
 * Code block with syntax highlighting. Lines are keyed by their content, so
 * changing `code` animates like Keynote's magic move: unchanged lines slide to
 * their new position, new lines fade in, removed lines fade out.
 */
export const code = defineWidget({
  type: 'code',
  description:
    'Code block. Props: code, lang (go|js|ts|python|rust|c|sql|asm), glow, size, lineNumbers, highlight (3 | "2-4" | [..]), focus (dim other lines), title, width. ' +
    'Methods: highlight(from, to?), unhighlight(), focus(from, to?), unfocus(). Anchors: c[line] (1-based)',
  defaults: { code: '', lang: 'go', size: 20, lineNumbers: true, highlight: [], focus: false, title: '', width: 0, height: 0, glow: false, titleSize: 0 } as Props,
  methods: {
    highlight(p, [a, b]) {
      p.highlight = b === undefined ? lines(a ?? []) : lines(`${num(a)}-${num(b)}`);
    },
    unhighlight(p) {
      p.highlight = [];
      p.focus = false;
    },
    focus(p, [a, b]) {
      p.highlight = b === undefined ? lines(a ?? []) : lines(`${num(a)}-${num(b)}`);
      p.focus = true;
    },
    unfocus(p) {
      p.focus = false;
    },
  },
  render(p, rc) {
    const L = layout(p, rc);
    const nodes: RNode[] = [];
    const hl = lines(p.highlight);
    const accent = rc.theme.accent;
    const R = 14;
    nodes.push(
      glowRect('glow', 0, 0, L.W, L.H, R, rc.color(p.glow === true ? 'glow' : p.glow, 'glow'), p.glow ? 0.85 : 0),
      h.rect('bg', 0, 0, L.W, L.H, { rx: R, fill: rc.theme.code, 'fill-opacity': 0.92, stroke: p.glow ? rc.color(p.glow === true ? 'glow' : p.glow, 'glow') : rc.theme.panelBorder, 'stroke-width': 1.5 }),
    );
    if (p.title) {
      const ts = L.titleSize;
      const T = L.titleH;
      nodes.push(
        h.path('header', `M0.75 ${T} V${R} Q0.75 0.75 ${R} 0.75 H${L.W - R} Q${L.W - 0.75} 0.75 ${L.W - 0.75} ${R} V${T} Z`, { fill: rc.theme.codeHeader }),
        h.line('titlesep', 0.75, T, L.W - 0.75, T, { stroke: rc.theme.border, 'stroke-width': 1 }),
        h.text('title', L.pad, T / 2 + ts * 0.36, str(p.title), {
          'font-size': ts, 'font-family': codeFont(rc), 'font-weight': 700, fill: rc.theme.codePunct, opacity: 0.85,
        }),
      );
    }
    runs(hl).forEach(([a, b], k) => {
      const y = L.lineY(a - 1) - (L.lh - L.s) / 2 - L.s * 0.1;
      const hh = (b - a + 1) * L.lh;
      nodes.push(h.rect(`hl${k}`, 3, y, L.W - 6, hh, { fill: fillTint(rc.theme, accent, 0.12) }));
      nodes.push(h.rect(`hlbar${k}`, 3, y, 4, hh, { fill: accent }));
    });
    const seen = new Map<string, number>();
    L.src.forEach((line, i) => {
      const n = (seen.get(line) ?? 0) + 1;
      seen.set(line, n);
      const key = `L${n}:${line}`;
      const baseline = L.lineY(i) + L.s * 0.85;
      const dim = bool(p.focus) && hl.length > 0 && !hl.includes(i + 1);
      const opacity = dim ? 0.3 : 1;
      if (L.gutter) {
        nodes.push(
          h.text(`ln${i}`, L.pad + L.gutter - L.s * 1.2, baseline, String(i + 1), {
            'font-size': L.s, 'font-family': codeFont(rc), 'text-anchor': 'end', fill: hl.includes(i + 1) ? rc.theme.fg : rc.theme.codeComment, opacity,
          }),
        );
      }
      let x = L.pad + L.gutter;
      highlightLine(line, p.lang).forEach((t, k) => {
        if (t.kind !== 'ws')
          nodes.push(
            h.text(`${key}#${k}`, x, baseline, t.text, {
              'font-size': L.s, 'font-family': codeFont(rc), fill: rc.color(TOKEN_COLOR[t.kind], 'codeText'), opacity, 'xml:space': 'preserve',
            }),
          );
        x += rc.measure(t.text, L.s, true, 400, 0, codeFont(rc));
      });
    });
    return nodes;
  },
  anchor(p, path, rc) {
    if (typeof path[0] !== 'number') return undefined;
    const L = layout(p, rc);
    const y = L.lineY(path[0] - 1) - (L.lh - L.s) / 2;
    return rect(0, y, L.W, L.lh);
  },
});
