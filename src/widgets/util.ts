import type { WidgetCtx } from '../core/widget.ts';
import { isRef, list, num, str, type Value } from '../core/values.ts';

/** Resolve an index argument against a length; negative indexes count from the end. */
export function index(ctx: WidgetCtx, v: Value | undefined, len: number, allowEnd = false): number {
  if (v === undefined) ctx.error('missing index');
  let i = num(v, 'index must be a number');
  if (i < 0) i += len;
  if (i < 0 || i > len || (i === len && !allowEnd)) ctx.error(`index ${str(v)} out of range (length ${len})`);
  return i;
}

/** Arguments of `push(1, 2)` and `push([1, 2])` mean the same thing. */
export function spread(args: Value[]): Value[] {
  return args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
}

/** Indexes given as numbers, arrays, or the string "all". */
export function indexes(ctx: WidgetCtx, v: Value | undefined, len: number): number[] {
  if (v === undefined || v === 'all' || (isRef(v) && v.text === 'all')) return Array.from({ length: len }, (_, i) => i);
  return list(v).map((x) => index(ctx, x, len));
}
