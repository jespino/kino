// Syntax highlighting for the Kino DSL (a StreamLanguage: tokens only, no grammar).
import { StreamLanguage } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const KEYWORDS = /^(video|frame|step|then|wait|say|note|voice|remove|at|effect|action)\b/;
const ATOMS = /^(true|false|null|morph|fade|cut)\b/;

export const kinoLanguage = StreamLanguage.define<{ inRaw: boolean; declType: boolean }>({
  name: 'kino',
  startState: () => ({ inRaw: false, declType: false }),
  token(stream, state) {
    if (stream.sol()) state.declType = false;
    if (state.inRaw) {
      // `multi-line` raw strings
      if (stream.skipTo('`')) {
        stream.next();
        state.inRaw = false;
      } else stream.skipToEnd();
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('`')) {
      state.inRaw = true;
      return 'string';
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^#[0-9a-fA-F]{3,8}\b/)) return 'atom';
    if (stream.match(/^-?(?:\d+\.?\d*|\.\d+)(?:%|(?:ms|s|f)?\b)/)) return 'number';
    if (stream.match(KEYWORDS)) return 'keyword';
    if (stream.match(ATOMS)) return 'atom';
    // `name: type [at ...] {` declarations start a line: the name is a definition, the type a type name
    if (/^\s*$/.test(stream.string.slice(0, stream.pos)) && stream.match(/^[A-Za-z_]\w*(?=\s*:\s*[a-z]\w*\s*(?:at\b|\{|$))/)) {
      state.declType = true;
      return 'definition';
    }
    if (state.declType && stream.match(/^[a-z]\w*/)) {
      state.declType = false;
      return 'typeName';
    }
    if (stream.match(/^[A-Za-z_]\w*(?=\s*:)/)) return 'propertyName';
    if (stream.match(/^[A-Za-z_]\w*(?=\s*\()/)) return 'function';
    if (stream.match(/^[A-Za-z_][\w-]*/)) return 'variableName';
    if (stream.match(/^->/)) return 'operator';
    stream.next();
    return null;
  },
  tokenTable: { definition: t.definition(t.variableName), function: t.function(t.variableName) },
  languageData: { commentTokens: { line: '//' } },
});
