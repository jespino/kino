import type { Frame } from './render.ts';
import type { SceneState } from './scene.ts';
import { isCall, isRef, num, type Value } from './values.ts';
import type { RNode } from './widget.ts';

/**
 * Staggering, after Lottie's per-layer start offsets: inside one morph
 * transition every node gets a start offset (ms) and animates over the step's
 * duration from there, so the transition lasts `duration + the largest offset`.
 *
 * - Step option `stagger: 80ms`: each statement starts 80ms after the one
 *   before. A widget follows the first statement that changes it; widgets no
 *   statement changes follow the widgets they point at (arrows, relative
 *   positions), so they stay attached.
 * - Widget prop `stagger: 60ms`: the widget's new parts (cells, items, rows)
 *   enter one after another, in the order the widget draws them.
 */

/** Names of the widgets whose props differ between two scene states (added, changed or removed). */
export function changedWidgets(before: SceneState, after: SceneState): string[] {
  const was = new Map(before.widgets.map((w) => [w.name, JSON.stringify(w.props)]));
  const out: string[] = [];
  for (const w of after.widgets) {
    if (was.get(w.name) !== JSON.stringify(w.props)) out.push(w.name);
    was.delete(w.name);
  }
  return [...out, ...was.keys()];
}

/** Widget names a value points at: references, also inside calls (`below(x, 10)`), lists and objects. */
function refs(v: Value | undefined, out: Set<string>) {
  if (v === null || v === undefined || typeof v !== 'object') return;
  if (isRef(v)) {
    if (typeof v.$ref[0] === 'string') out.add(v.$ref[0]);
    return;
  }
  if (isCall(v)) return v.args.forEach((a) => refs(a, out));
  if (Array.isArray(v)) return v.forEach((a) => refs(a, out));
  for (const x of Object.values(v)) refs(x as Value, out);
}

/**
 * Start offset of every widget: `first[name]` is the index of the first
 * statement that changed it. The rest take the latest offset among the widgets
 * they point at, or 0.
 */
export function widgetOffsets(state: SceneState, first: Map<string, number>, stagger: number): Map<string, number> {
  const out = new Map<string, number>();
  for (const [name, i] of first) out.set(name, i * stagger);
  const deps = new Map<string, Set<string>>();
  for (const w of state.widgets) {
    if (first.has(w.name)) continue;
    const s = new Set<string>();
    for (const v of Object.values(w.props)) refs(v as Value, s);
    s.delete(w.name);
    deps.set(w.name, s);
  }
  // follow chains (an arrow to a label placed below a moved box), without looping
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const [name, s] of deps) {
      const off = Math.max(0, ...[...s].map((d) => out.get(d) ?? 0));
      if (off > (out.get(name) ?? 0)) {
        out.set(name, off);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return out;
}

/** The part of a widget a node belongs to: its `part`, or the id in keys like `bg:n3` / `c:r2:1`, or its key. */
export function partOf(n: RNode): string {
  if (n.part !== undefined) return String(n.part);
  const key = n.key.slice(n.key.indexOf('/') + 1).replace(/^@/, '');
  const m = /^[^:]+:([^:>]+)/.exec(key);
  return m ? m[1] : key;
}

/**
 * Offsets (ms) of the nodes of a transition from `A` to `B`, keyed by node key:
 * the widget's offset plus, for widgets with a `stagger` prop, one more step
 * per new part. Empty when nothing is staggered.
 */
export function nodeOffsets(A: Frame, B: Frame, state: SceneState, widgets: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const n of [...A.nodes, ...B.nodes]) {
    const off = n.owner ? widgets.get(n.owner) ?? 0 : 0;
    if (off > 0) out.set(n.key, off);
  }
  const old = new Set(A.nodes.map((n) => n.key));
  for (const w of state.widgets) {
    const step = num(w.props.stagger ?? 0);
    if (!(step > 0)) continue;
    const base = widgets.get(w.name) ?? 0;
    const parts = new Map<string, number>();
    for (const n of B.nodes) {
      if (n.owner !== w.name || old.has(n.key) || n.decor) continue;
      const p = partOf(n);
      if (!parts.has(p)) parts.set(p, parts.size);
      const k = parts.get(p)!;
      if (k > 0) out.set(n.key, base + k * step);
    }
  }
  return out;
}
