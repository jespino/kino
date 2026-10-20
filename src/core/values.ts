import { KinoError, type Expr } from '../dsl/ast.ts';

// Runtime values are plain JSON-compatible data so scene states can be cloned
// with structuredClone. Special values are tagged objects.
export type Value = number | string | boolean | null | Value[] | Ref | Point | CallValue | { [k: string]: Value };

/** A reference to a widget or to a part of it: `data[0]`, `s.len`. */
export interface Ref {
  $ref: (string | number)[];
  text: string;
}
/** A 2D point / tuple: `(100, 200)`. */
export interface Point {
  $pt: number[];
}
/** A function-like value: `below(header, 40)`. */
export interface CallValue {
  $call: string;
  args: Value[];
}

export const isRef = (v: unknown): v is Ref => typeof v === 'object' && v !== null && '$ref' in v;
export const isPoint = (v: unknown): v is Point => typeof v === 'object' && v !== null && '$pt' in v;
export const isCall = (v: unknown): v is CallValue => typeof v === 'object' && v !== null && '$call' in v;
export const isObj = (v: unknown): v is { [k: string]: Value } =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !isRef(v) && !isPoint(v) && !isCall(v);

export function evaluate(e: Expr): Value {
  switch (e.t) {
    case 'num':
      return e.v;
    case 'str':
    case 'color':
      return e.v;
    case 'bool':
      return e.v;
    case 'null':
      return null;
    case 'dur':
      return e.ms;
    case 'arr':
      return e.items.map(evaluate);
    case 'obj':
      return Object.fromEntries(e.entries.map(([k, v]) => [k, evaluate(v)]));
    case 'tuple':
      return { $pt: e.items.map((i) => num(evaluate(i), 'tuple items must be numbers')) };
    case 'call':
      return { $call: e.name, args: e.args.map(evaluate) };
    case 'path':
      return {
        $ref: e.path.map((s) => {
          if ('name' in s) return s.name;
          const v = evaluate(s.index);
          if (typeof v !== 'number' && typeof v !== 'string') throw new KinoError('index must be a number or name', e.pos);
          return v;
        }),
        text: e.text,
      };
  }
}

/** Human readable rendering of a value, used for cell contents etc. */
export function str(v: Value | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(+v.toFixed(4));
  if (typeof v === 'boolean') return String(v);
  if (isRef(v)) return v.text;
  if (isPoint(v)) return `(${v.$pt.join(', ')})`;
  if (isCall(v)) return `${v.$call}(${v.args.map(str).join(', ')})`;
  if (Array.isArray(v)) return `[${v.map(str).join(', ')}]`;
  return JSON.stringify(v);
}

export function num(v: Value | undefined, msg = 'expected a number'): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(+v)) return +v;
  throw new KinoError(msg + `, got ${str(v)}`);
}

export function list(v: Value | undefined): Value[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

export function bool(v: Value | undefined): boolean {
  return v !== undefined && v !== null && v !== false && v !== 0 && v !== '' && v !== 'false';
}
