// Tiny regex based syntax highlighter. Good enough for short snippets in videos.

export type TokKind = 'kw' | 'str' | 'num' | 'comment' | 'func' | 'type' | 'punct' | 'text' | 'ws' | 'reg' | 'addr';

export interface CodeToken {
  text: string;
  kind: TokKind;
}

const KEYWORDS: Record<string, string> = {
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false append len cap make new',
  js: 'async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while yield',
  ts: 'async await break case catch class const continue default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null of private protected public readonly return static super switch this throw true try type typeof undefined var void while yield',
  python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self',
  rust: 'as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
  c: 'auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while NULL',
  sql: 'select from where and or not insert into values update set delete create table index on join left right inner outer group by order having limit as distinct null is in like primary key',
};
KEYWORDS.javascript = KEYWORDS.js;
KEYWORDS.typescript = KEYWORDS.ts;
KEYWORDS.py = KEYWORDS.python;
KEYWORDS.cpp = KEYWORDS.c + ' class namespace template typename public private protected new delete virtual nullptr bool true false';

const kwSets = new Map<string, Set<string>>();

function keywords(lang: string): Set<string> {
  let s = kwSets.get(lang);
  if (!s) {
    s = new Set((KEYWORDS[lang] ?? KEYWORDS.js).split(' '));
    kwSets.set(lang, s);
  }
  return s;
}

const ASM = new Set(['asm', 'arm64', 'aarch64', 'x86', 'x64', 'nasm', 'gas', 's']);
const REG = /^(%?(?:[xwvqdsbh]\d{1,2}|r\d{1,2}[dwb]?|[re]?[abcd]x|[re]?[sd]i|[re]?[sb]p|[re]?ip|sp|pc|lr|fp|xzr|wzr|[abcd][lh]))\b/i;

/** Assembly: optional leading address, mnemonic, registers, immediates, comments. */
function highlightAsm(line: string): CodeToken[] {
  const out: CodeToken[] = [];
  let i = 0;
  let sawMnemonic = false;
  const m0 = /^(\s*)([0-9a-fA-F]{4,}:?)/.exec(line);
  if (m0) {
    if (m0[1]) out.push({ text: m0[1], kind: 'ws' });
    out.push({ text: m0[2], kind: 'addr' });
    i = m0[0].length;
  }
  while (i < line.length) {
    const rest = line.slice(i);
    let m: RegExpExecArray | null;
    let kind: TokKind;
    if ((m = /^\s+/.exec(rest))) kind = 'ws';
    else if ((m = /^(;|\/\/|@ ).*/.exec(rest))) kind = 'comment';
    else if ((m = /^[A-Za-z_.][\w.]*:/.exec(rest)) && !sawMnemonic) kind = 'func';
    else if ((m = REG.exec(rest))) kind = 'reg';
    else if ((m = /^[A-Za-z_.][\w.]*/.exec(rest))) {
      kind = sawMnemonic ? 'text' : 'kw';
      sawMnemonic = true;
    } else if ((m = /^[#$]?-?(0x[0-9a-fA-F]+|\d+)/.exec(rest))) kind = 'num';
    else if ((m = /^[[\](),!+*-]+/.exec(rest))) kind = 'punct';
    else {
      m = [rest[0]] as unknown as RegExpExecArray;
      kind = 'text';
    }
    out.push({ text: m[0], kind });
    i += m[0].length;
  }
  return out;
}

export function highlightLine(line: string, lang: string): CodeToken[] {
  if (ASM.has(lang.toLowerCase())) return highlightAsm(line);
  const kws = keywords(lang.toLowerCase());
  const caseInsensitive = lang === 'sql';
  const hashComments = lang === 'python' || lang === 'py' || lang === 'sh' || lang === 'bash' || lang === 'yaml';
  const out: CodeToken[] = [];
  let i = 0;
  const push = (text: string, kind: TokKind) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && (kind === 'ws' || kind === 'text')) last.text += text;
    else out.push({ text, kind });
  };
  while (i < line.length) {
    const rest = line.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^\s+/.exec(rest))) push(m[0], 'ws');
    else if ((m = (hashComments ? /^#.*/ : lang === 'sql' ? /^--.*/ : /^\/\/.*/).exec(rest))) push(m[0], 'comment');
    else if ((m = /^("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`[^`]*`?)/.exec(rest))) push(m[0], 'str');
    else if ((m = /^\d[\d_]*(\.\d+)?([eE][+-]?\d+)?|^0x[0-9a-fA-F]+/.exec(rest))) push(m[0], 'num');
    else if ((m = /^[A-Za-z_$][\w$]*/.exec(rest))) {
      const w = m[0];
      const after = line.slice(i + w.length);
      if (kws.has(caseInsensitive ? w.toLowerCase() : w)) push(w, 'kw');
      else if (/^\s*\(/.test(after)) push(w, 'func');
      else if (/^[A-Z]/.test(w) || /^(int|string|bool|byte|rune|float64|float32|int64|int32|uint\d*|error|any|number|boolean|str|usize|i32|i64|u8|f64)$/.test(w)) push(w, 'type');
      else push(w, 'text');
    } else if ((m = /^[{}()[\].,;:+\-*/%=<>!&|^~?]+/.exec(rest))) push(m[0], 'punct');
    else push(rest[0], 'text');
    i += m ? m[0].length : 1;
  }
  return out;
}
