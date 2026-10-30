import { KinoError, type Expr, type Item, type Pos, type Program, type Seg, type Stmt } from './ast.ts';
import { tokenize, type Token } from './lexer.ts';

export function parse(src: string): Program {
  return new Parser(tokenize(src)).program();
}

class Parser {
  private i = 0;
  constructor(private toks: Token[]) {}

  private peek(o = 0): Token {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  private next(): Token {
    return this.toks[this.i++];
  }
  private is(value: string, o = 0): boolean {
    const t = this.peek(o);
    return (t.type === 'punct' || t.type === 'ident') && t.value === value;
  }
  private accept(value: string): boolean {
    if (this.is(value)) {
      this.i++;
      return true;
    }
    return false;
  }
  private expect(value: string): Token {
    if (!this.is(value)) this.fail(`expected '${value}' but found ${describe(this.peek())}`);
    return this.next();
  }
  private ident(): string {
    const t = this.peek();
    if (t.type !== 'ident') this.fail(`expected a name but found ${describe(t)}`);
    return this.next().value;
  }
  private fail(msg: string, pos: Pos = this.peek().pos): never {
    throw new KinoError(msg, pos);
  }
  private skipSeps() {
    while (this.accept(';') || this.accept(',')) {}
  }

  program(): Program {
    const items: Item[] = [];
    this.skipSeps();
    while (this.peek().type !== 'eof') {
      items.push(this.item());
      this.skipSeps();
    }
    return { items };
  }

  private item(): Item {
    const t = this.peek();
    if (t.type !== 'ident') this.fail(`expected 'video', 'frame', 'step', 'say', 'voice' or 'wait' but found ${describe(t)}`);
    switch (t.value) {
      case 'video':
        this.next();
        return { t: 'video', props: this.propBlock(), pos: t.pos };
      case 'frame':
      case 'step':
      case 'transition': {
        this.next();
        const name = this.peek().type === 'str' ? this.next().value : undefined;
        const opts = this.stepOpts();
        const body = this.body();
        return t.value === 'frame' ? { t: 'frame', name, opts, body, pos: t.pos } : { t: 'step', name, opts, body, pos: t.pos };
      }
      case 'say':
        return this.say();
      case 'voice':
        this.next();
        return { t: 'voice', props: this.propBlock(), pos: t.pos };
      case 'wait': {
        this.next();
        const d = this.next();
        if (d.type !== 'dur') this.fail(`'wait' needs a duration like 500ms or 1s`, d.pos);
        return { t: 'wait', ms: d.num!, pos: t.pos };
      }
      default:
        this.fail(`unknown top-level keyword '${t.value}' (expected video, frame, step, say, voice or wait)`);
    }
  }

  // `(600ms, ease-out, hold: 1s)` or a bare duration: `step 1s { ... }`
  private stepOpts(): Expr[] {
    const opts: Expr[] = [];
    if (this.peek().type === 'dur') opts.push(this.expr());
    if (this.accept('(')) {
      while (!this.is(')')) {
        const t = this.peek();
        if (t.type === 'ident' && this.is(':', 1)) {
          this.next();
          this.next();
          opts.push({ t: 'obj', entries: [[t.value, this.expr()]], pos: t.pos });
        } else {
          opts.push(this.expr());
        }
        if (!this.accept(',')) break;
      }
      this.expect(')');
    }
    return opts;
  }

  private body(): Stmt[] {
    this.expect('{');
    const stmts: Stmt[] = [];
    this.skipSeps();
    while (!this.is('}')) {
      if (this.peek().type === 'eof') this.fail(`unterminated block, missing '}'`);
      stmts.push(this.stmt());
      this.skipSeps();
    }
    this.expect('}');
    return stmts;
  }

  private stmt(): Stmt {
    const t = this.peek();
    if (t.type !== 'ident') this.fail(`expected a statement but found ${describe(t)}`);

    if (t.value === 'then' && !this.isPathContinuation(1)) {
      this.next();
      return { t: 'then', pos: t.pos };
    }
    if (t.value === 'say' && this.peek(1).type === 'str') return this.say();
    if ((t.value === 'note' || t.value === 'notes') && this.peek(1).type === 'str') {
      this.next();
      return { t: 'note', text: (this.next() as { value: string }).value, pos: t.pos };
    }
    if (t.value === 'remove' && this.peek(1).type === 'ident' && !this.isPathContinuation(1)) {
      this.next();
      const names = [this.ident()];
      while (this.accept(',')) names.push(this.ident());
      return { t: 'remove', names, pos: t.pos };
    }

    const target = this.path();

    if (this.is(':')) {
      if (target.length !== 1 || !('name' in target[0])) this.fail(`only plain names can be declared`, t.pos);
      this.next();
      const name = target[0].name;
      const rhsPos = this.peek().pos;
      const rhs = this.path();
      if (this.is('->') || this.is('-->')) return this.connect(name, { t: 'path', path: rhs, text: pathText(rhs), pos: rhsPos }, t.pos);
      if (rhs.length !== 1 || !('name' in rhs[0])) this.fail(`expected a widget type after '${name}:'`, rhsPos);
      const type = rhs[0].name;
      let at: Expr | undefined;
      if (this.accept('at')) at = this.expr();
      const props = this.is('{') ? this.propBlock() : [];
      return { t: 'decl', name, type, at, props, pos: t.pos };
    }
    if (this.is('->') || this.is('-->')) {
      return this.connect(undefined, { t: 'path', path: target, text: pathText(target), pos: t.pos }, t.pos);
    }
    if (this.accept('=')) {
      return { t: 'assign', target, value: this.expr(), pos: t.pos };
    }
    if (this.is('(')) {
      const last = target[target.length - 1];
      if (target.length < 2 || !('name' in last)) this.fail(`expected 'widget.method(...)'`, t.pos);
      this.next();
      const args = this.args(')');
      return { t: 'call', target: target.slice(0, -1), method: last.name, args, pos: t.pos };
    }
    if (this.is('{')) {
      return { t: 'merge', target, props: this.propBlock(), pos: t.pos };
    }
    this.fail(`expected ':', '=', '(', '{' or '->' after '${pathText(target)}'`);
  }

  // say "text" [(opts)]
  private say(): { t: 'say'; text: string; opts: Expr[]; pos: Pos } {
    const kw = this.next();
    const s = this.next();
    if (s.type !== 'str') this.fail(`'say' needs a string: say "Hello"`, s.pos);
    return { t: 'say', text: s.value, opts: this.stepOpts(), pos: kw.pos };
  }

  private connect(name: string | undefined, from: Expr, pos: Pos): Stmt {
    const dashed = this.next().value === '-->';
    const to = this.expr();
    const props = this.is('{') ? this.propBlock() : [];
    return { t: 'connect', name, from, to, dashed, props, pos };
  }

  private isPathContinuation(o: number): boolean {
    return this.is('.', o) || this.is('[', o) || this.is('=', o) || this.is(':', o) || this.is('(', o) || this.is('{', o) || this.is('->', o);
  }

  private path(): Seg[] {
    const segs: Seg[] = [{ name: this.ident() }];
    for (;;) {
      if (this.is('.') && this.peek(1).type === 'ident') {
        this.next();
        segs.push({ name: this.ident() });
      } else if (this.is('.') && this.peek(1).type === 'num') {
        // `m.0` style is not supported; keep error readable
        this.fail(`use brackets for indexes: [${this.peek(1).value}]`);
      } else if (this.accept('[')) {
        segs.push({ index: this.expr() });
        this.expect(']');
      } else {
        return segs;
      }
    }
  }

  private propBlock(): [string, Expr][] {
    this.expect('{');
    const entries: [string, Expr][] = [];
    this.skipSeps();
    while (!this.is('}')) {
      const k = this.peek();
      if (k.type !== 'ident' && k.type !== 'str') this.fail(`expected a property name but found ${describe(k)}`);
      this.next();
      this.expect(':');
      entries.push([k.value, this.expr()]);
      this.skipSeps();
    }
    this.expect('}');
    return entries;
  }

  private args(close: string): Expr[] {
    const items: Expr[] = [];
    while (!this.is(close)) {
      items.push(this.expr());
      if (!this.accept(',')) break;
    }
    this.expect(close);
    return items;
  }

  expr(): Expr {
    const t = this.peek();
    switch (t.type) {
      case 'num':
        this.next();
        return { t: 'num', v: t.num!, pos: t.pos };
      case 'dur':
        this.next();
        return { t: 'dur', ms: t.num!, pos: t.pos };
      case 'str':
        this.next();
        return { t: 'str', v: t.value, pos: t.pos };
      case 'color':
        this.next();
        return { t: 'color', v: t.value, pos: t.pos };
      case 'ident': {
        if (t.value === 'true' || t.value === 'false') {
          this.next();
          return { t: 'bool', v: t.value === 'true', pos: t.pos };
        }
        if (t.value === '_' || t.value === 'null') {
          this.next();
          return { t: 'null', pos: t.pos };
        }
        if (this.is('(', 1)) {
          this.next();
          this.next();
          return { t: 'call', name: t.value, args: this.args(')'), pos: t.pos };
        }
        const path = this.path();
        return { t: 'path', path, text: pathText(path), pos: t.pos };
      }
      case 'punct':
        if (t.value === '[') {
          this.next();
          return { t: 'arr', items: this.args(']'), pos: t.pos };
        }
        if (t.value === '{') {
          return { t: 'obj', entries: this.propBlock(), pos: t.pos };
        }
        if (t.value === '(') {
          this.next();
          const items = this.args(')');
          return items.length === 1 ? items[0] : { t: 'tuple', items, pos: t.pos };
        }
    }
    this.fail(`expected a value but found ${describe(t)}`);
  }
}

export function pathText(path: Seg[]): string {
  return path
    .map((s, i) => ('name' in s ? (i ? '.' : '') + s.name : `[${exprText(s.index)}]`))
    .join('');
}

function exprText(e: Expr): string {
  switch (e.t) {
    case 'num':
      return String(e.v);
    case 'str':
      return JSON.stringify(e.v);
    case 'path':
      return e.text;
    default:
      return '?';
  }
}

function describe(t: Token): string {
  if (t.type === 'eof') return 'end of file';
  if (t.type === 'str') return `string "${t.value}"`;
  return `'${t.value}'`;
}
