import { KinoError, type Pos } from './ast.ts';

export type TokType = 'ident' | 'num' | 'dur' | 'str' | 'color' | 'punct' | 'eof';

export interface Token {
  type: TokType;
  value: string;
  num?: number;
  pos: Pos;
}

const PUNCT = ['->', '-->', '{', '}', '(', ')', '[', ']', ',', ';', ':', '.', '='];

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const pos = (): Pos => ({ line, col });
  const advance = (n = 1) => {
    for (let k = 0; k < n; k++) {
      if (src[i] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
    }
  };
  const isIdentStart = (c: string) => /[A-Za-z_$]/.test(c);
  const isIdent = (c: string) => /[A-Za-z0-9_$]/.test(c);

  while (i < src.length) {
    const c = src[i];

    if (/\s/.test(c)) {
      advance();
      continue;
    }
    // Comments: `// ...` and `# ...` (a hash followed by whitespace; `#fff` is a color).
    if ((c === '/' && src[i + 1] === '/') || (c === '#' && /[\s]/.test(src[i + 1] ?? ' '))) {
      while (i < src.length && src[i] !== '\n') advance();
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) advance();
      advance(2);
      continue;
    }

    const start = pos();

    if (c === '#') {
      const m = /^#([0-9a-fA-F]{3,8})\b/.exec(src.slice(i));
      if (!m) throw new KinoError(`invalid color literal`, start);
      out.push({ type: 'color', value: m[0], pos: start });
      advance(m[0].length);
      continue;
    }

    // Hex and binary integers: 0x4048F5C3, 0b1010
    const radix = /^-?0(?:([xX])([0-9a-fA-F_]+)|([bB])([01_]+))(?![\w.])/.exec(src.slice(i));
    if (radix && /[0-9]/.test(c === '-' ? src[i + 1] : c)) {
      const hex = !!radix[1];
      const digits = (hex ? radix[2] : radix[4]).replace(/_/g, '');
      const n = parseInt(digits, hex ? 16 : 2) * (c === '-' ? -1 : 1);
      if (!isNaN(n)) {
        out.push({ type: 'num', value: radix[0], num: n, pos: start });
        advance(radix[0].length);
        continue;
      }
    }

    // Numbers, optionally negative, optionally with a duration unit.
    if (/[0-9]/.test(c) || (c === '-' && /[0-9.]/.test(src[i + 1] ?? '') && /[0-9]/.test(src[i + 1] === '.' ? src[i + 2] ?? '' : src[i + 1]))) {
      const m = /^-?(?:\d+\.?\d*|\.\d+)(ms|s)?/.exec(src.slice(i))!;
      const n = parseFloat(m[0]);
      if (m[1]) {
        out.push({ type: 'dur', value: m[0], num: m[1] === 's' ? n * 1000 : n, pos: start });
      } else {
        out.push({ type: 'num', value: m[0], num: n, pos: start });
      }
      advance(m[0].length);
      continue;
    }

    if (isIdentStart(c)) {
      let j = i;
      // Hyphens are allowed inside identifiers (ease-in-out, right-of) when followed by a letter.
      while (j < src.length && (isIdent(src[j]) || (src[j] === '-' && /[A-Za-z]/.test(src[j + 1] ?? '')))) j++;
      const word = src.slice(i, j);
      out.push({ type: 'ident', value: word, pos: start });
      advance(j - i);
      continue;
    }

    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\n') throw new KinoError('unterminated string', start);
        if (src[j] === '\\') {
          const e = src[j + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          j += 2;
        } else {
          s += src[j++];
        }
      }
      if (j >= src.length) throw new KinoError('unterminated string', start);
      out.push({ type: 'str', value: s, pos: start });
      advance(j + 1 - i);
      continue;
    }

    // Backtick strings are raw and multi-line; common indentation is removed.
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end < 0) throw new KinoError('unterminated `string`', start);
      out.push({ type: 'str', value: dedent(src.slice(i + 1, end)), pos: start });
      advance(end + 1 - i);
      continue;
    }

    const p = PUNCT.filter((p) => src.startsWith(p, i)).sort((a, b) => b.length - a.length)[0];
    if (p) {
      out.push({ type: 'punct', value: p, pos: start });
      advance(p.length);
      continue;
    }

    throw new KinoError(`unexpected character '${c}'`, start);
  }
  out.push({ type: 'eof', value: '', pos: pos() });
  return out;
}

export function dedent(s: string): string {
  let lines = s.split('\n');
  if (lines.length && lines[0].trim() === '') lines = lines.slice(1);
  if (lines.length && lines[lines.length - 1].trim() === '') lines = lines.slice(0, -1);
  const indents = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min).replace(/\t/g, '    ')).join('\n');
}
