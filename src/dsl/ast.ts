// AST produced by the parser. Every node carries the source position so that
// runtime errors (unknown widget, bad method, ...) can point at the right line.

export interface Pos {
  line: number;
  col: number;
}

export type Expr =
  | { t: 'num'; v: number; pos: Pos }
  | { t: 'str'; v: string; pos: Pos }
  | { t: 'bool'; v: boolean; pos: Pos }
  | { t: 'null'; pos: Pos }
  | { t: 'color'; v: string; pos: Pos }
  | { t: 'dur'; ms: number; pos: Pos }
  | { t: 'arr'; items: Expr[]; pos: Pos }
  | { t: 'obj'; entries: [string, Expr][]; pos: Pos }
  | { t: 'tuple'; items: Expr[]; pos: Pos }
  | { t: 'path'; path: Seg[]; text: string; pos: Pos }
  | { t: 'call'; name: string; args: Expr[]; pos: Pos };

export type Seg = { name: string } | { index: Expr };

export type Stmt =
  // name: type [at <pos>] [{ props }]
  | { t: 'decl'; name: string; type: string; at?: Expr; props: [string, Expr][]; pos: Pos }
  // [name:] a.b -> c[0] [{ props }]
  | { t: 'connect'; name?: string; from: Expr; to: Expr; dashed: boolean; props: [string, Expr][]; pos: Pos }
  // a.b[1] = value
  | { t: 'assign'; target: Seg[]; value: Expr; pos: Pos }
  // a.method(args)
  | { t: 'call'; target: Seg[]; method: string; args: Expr[]; pos: Pos }
  // a { k: v, ... }   (bulk assignment)
  | { t: 'merge'; target: Seg[]; props: [string, Expr][]; pos: Pos }
  | { t: 'remove'; names: string[]; pos: Pos }
  // splits a step into sequential sub-steps
  | { t: 'then'; pos: Pos }
  // narration: say "text" (speaker: Ryan, instruct: "...")
  | { t: 'say'; text: string; opts: Expr[]; pos: Pos };

export type Item =
  | { t: 'video'; props: [string, Expr][]; pos: Pos }
  | { t: 'frame'; name?: string; opts: Expr[]; body: Stmt[]; pos: Pos }
  | { t: 'step'; name?: string; opts: Expr[]; body: Stmt[]; pos: Pos }
  | { t: 'wait'; ms: number; pos: Pos }
  // narration over a still picture
  | { t: 'say'; text: string; opts: Expr[]; pos: Pos }
  // change the default voice from here on
  | { t: 'voice'; props: [string, Expr][]; pos: Pos };

export interface Program {
  items: Item[];
}

export class KinoError extends Error {
  constructor(message: string, public pos?: Pos) {
    super(pos ? `${pos.line}:${pos.col}: ${message}` : message);
  }
}
