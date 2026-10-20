import { defineWidget, glowRect, h, midBaseline, type Props, type RNode, type WidgetCtx } from '../core/widget.ts';
import { clipToRect, rect, type Rect } from '../core/geometry.ts';
import { fillTint } from '../core/color.ts';
import { glowCircle } from './shapes.ts';
import { isObj, list, str, type Value } from '../core/values.ts';

type Kids = (string | null)[];

const id = (v: Value | undefined) => (v === null || v === undefined ? null : str(v));
const cmp = (a: string, b: string) => (!isNaN(+a) && !isNaN(+b) ? +a - +b : a.localeCompare(b));

/** parent of `x`, and x's index among its children */
function parentOf(p: Props, x: string): [string, number] | null {
  for (const [k, kids] of Object.entries(p.nodes as Record<string, Kids>)) {
    const i = kids.indexOf(x);
    if (i >= 0) return [k, i];
  }
  return null;
}

/** put `y` where `x` was (as root or as a child) */
function replaceInParent(p: Props, x: string, y: string | null) {
  const par = parentOf(p, x);
  if (par) p.nodes[par[0]][par[1]] = y;
  else if (p.root === x) p.root = y;
}

const kid = (p: Props, n: string | null, i: number): string | null => (n === null ? null : (p.nodes[n]?.[i] ?? null));

function ensure(p: Props, n: string) {
  p.nodes[n] ??= p.binary ? [null, null] : [];
}

function bstInsert(p: Props, v: string, ctx: WidgetCtx) {
  if (p.nodes[v]) ctx.error(`'${v}' is already in the tree`);
  ensure(p, v);
  if (p.root === null) return void (p.root = v);
  let cur = p.root as string;
  for (;;) {
    const side = cmp(v, cur) < 0 ? 0 : 1;
    const next = kid(p, cur, side);
    if (next === null) {
      while (p.nodes[cur].length < 2) p.nodes[cur].push(null);
      p.nodes[cur][side] = v;
      return;
    }
    cur = next;
  }
}

/** root → v search path (BST order), and whether v was found */
function searchPath(p: Props, v: string): { path: string[]; found: boolean } {
  const path: string[] = [];
  let cur: string | null = p.root;
  while (cur !== null) {
    path.push(cur);
    const c = cmp(v, cur);
    if (c === 0) return { path, found: true };
    cur = kid(p, cur, c < 0 ? 0 : 1);
  }
  return { path, found: false };
}

function removeSubtree(p: Props, n: string) {
  for (const c of p.nodes[n] ?? []) if (c !== null) removeSubtree(p, c);
  delete p.nodes[n];
  for (const k of Object.keys(p.hl)) if (k === n) delete p.hl[k];
}

function layout(p: Props) {
  const pos = new Map<string, { slot: number; depth: number }>();
  let next = 0;
  const visit = (n: string | null, depth: number) => {
    if (n === null || pos.has(n) || !p.nodes[n]) return;
    const kids = (p.nodes[n] as Kids).filter((k): k is string => k !== null && !!p.nodes[k]);
    if (p.binary) {
      // in-order slots: BSTs read left-to-right in sorted order
      visit(kid(p, n, 0), depth + 1);
      pos.set(n, { slot: next++, depth });
      visit(kid(p, n, 1), depth + 1);
    } else if (!kids.length) {
      pos.set(n, { slot: next++, depth });
    } else {
      kids.forEach((k) => visit(k, depth + 1));
      const xs = kids.map((k) => pos.get(k)!.slot);
      pos.set(n, { slot: (Math.min(...xs) + Math.max(...xs)) / 2, depth });
    }
  };
  visit(p.root, 0);
  const horizontal = p.direction === 'horizontal';
  const box = (n: string): Rect => {
    const q = pos.get(n)!;
    const along = q.slot * p.siblingGap, across = q.depth * p.levelGap;
    const [cx, cy] = horizontal ? [across, along] : [along, across];
    const w = p.shape === 'box' ? p.r * 2.6 : p.r * 2;
    return rect(cx - w / 2, cy - p.r, w, p.r * 2);
  };
  return { pos, box };
}

/**
 * Trees with automatic layout: BSTs, heaps, tries, linked lists (direction: horizontal).
 *   t: tree at (960, 160) { values: [8, 3, 10, 1, 6], origin: top }        // BST by insertion
 *   t: tree { nodes: { root: [a, b], a: [c] }, binary: false }              // any tree
 */
export const tree = defineWidget({
  type: 'tree',
  description:
    'Tree with automatic layout. Props: values (BST by insertion) or nodes ({id: [children]}), root, binary (true), labels ({id: text}), ' +
    'shape (circle|box), r, size, levelGap, siblingGap, direction (vertical|horizontal), arrows. ' +
    'Methods: insert(v...), delete(v), add(parent, child, side?), remove(id), rotateLeft(id), rotateRight(id), swap(a, b), ' +
    'search(v), highlight(id, color), highlightPath([ids], color), unhighlight(id?), label(id, text). Anchors: t[id]',
  defaults: {
    values: null, nodes: {}, root: null, binary: true, labels: {}, shape: 'circle', r: 30, size: 22,
    levelGap: 100, siblingGap: 72, direction: 'vertical', arrows: false, hl: {}, hlEdges: {},
  } as Props,
  init(p, ctx) {
    const given = isObj(p.nodes) ? (p.nodes as Record<string, Value>) : {};
    p.nodes = {};
    for (const [k, v] of Object.entries(given)) p.nodes[k] = list(v).map(id);
    for (const kids of Object.values(p.nodes as Record<string, Kids>)) for (const c of kids) if (c !== null) ensure(p, c);
    if (p.root !== null) p.root = str(p.root);
    else {
      const children = new Set(Object.values(p.nodes as Record<string, Kids>).flat());
      p.root = Object.keys(p.nodes).find((k) => !children.has(k)) ?? null;
    }
    if (p.values !== null) for (const v of list(p.values)) bstInsert(p, str(v), ctx);
    delete p.values;
  },
  methods: {
    insert(p, args, ctx) {
      for (const v of args.flatMap((a) => list(a))) bstInsert(p, str(v), ctx);
    },
    /** BST delete; with two children the in-order successor moves up into the hole */
    delete(p, [v], ctx) {
      const x = str(v);
      if (!p.nodes[x]) ctx.error(`'${x}' is not in the tree`);
      const [l, r] = [kid(p, x, 0), kid(p, x, 1)];
      if (l === null || r === null) {
        replaceInParent(p, x, l ?? r);
      } else {
        let s = r;
        while (kid(p, s, 0) !== null) s = kid(p, s, 0)!;
        if (s !== r) {
          replaceInParent(p, s, kid(p, s, 1));
          p.nodes[s] = [l, r];
        } else p.nodes[s] = [l, kid(p, s, 1)];
        replaceInParent(p, x, s);
      }
      delete p.nodes[x];
      delete p.hl[x];
    },
    add(p, [parent, child, side], ctx) {
      const par = str(parent), c = str(child);
      if (!p.nodes[par]) ctx.error(`'${par}' is not in the tree`);
      ensure(p, c);
      if (p.binary) {
        const i = side === 'left' || side === 0 ? 0 : side === 'right' || side === 1 ? 1 : p.nodes[par][0] === null ? 0 : 1;
        while (p.nodes[par].length < 2) p.nodes[par].push(null);
        p.nodes[par][i] = c;
      } else p.nodes[par].push(c);
    },
    remove(p, [v], ctx) {
      const x = str(v);
      if (!p.nodes[x]) ctx.error(`'${x}' is not in the tree`);
      const par = parentOf(p, x);
      if (par && !p.binary) p.nodes[par[0]].splice(par[1], 1);
      else replaceInParent(p, x, null);
      removeSubtree(p, x);
    },
    rotateLeft(p, [v], ctx) {
      const x = str(v), y = kid(p, x, 1);
      if (y === null) return ctx.error(`rotateLeft(${x}) needs a right child`);
      replaceInParent(p, x, y);
      p.nodes[x][1] = kid(p, y, 0);
      while (p.nodes[y].length < 2) p.nodes[y].push(null);
      p.nodes[y][0] = x;
    },
    rotateRight(p, [v], ctx) {
      const x = str(v), y = kid(p, x, 0);
      if (y === null) return ctx.error(`rotateRight(${x}) needs a left child`);
      replaceInParent(p, x, y);
      p.nodes[x][0] = kid(p, y, 1);
      while (p.nodes[y].length < 2) p.nodes[y].push(null);
      p.nodes[y][1] = x;
    },
    /** exchange the places of two nodes (heap sift-up/down) */
    swap(p, [a, b], ctx) {
      const x = str(a), y = str(b);
      if (!p.nodes[x] || !p.nodes[y]) ctx.error(`swap needs two nodes of the tree`);
      const f = (n: string | null) => (n === x ? y : n === y ? x : n);
      const nodes: Record<string, Kids> = {};
      for (const [k, kids] of Object.entries(p.nodes as Record<string, Kids>)) nodes[f(k)!] = kids.map(f);
      p.nodes = nodes;
      p.root = f(p.root);
    },
    /** highlight the BST search path to v: visited nodes accent, the target good (or the last node bad) */
    search(p, [v, color]) {
      const { path, found } = searchPath(p, str(v));
      p.hl = {};
      p.hlEdges = {};
      path.forEach((n, i) => {
        p.hl[n] = i === path.length - 1 ? (found ? 'good' : 'bad') : str(color ?? 'accent');
        if (i) p.hlEdges[`${path[i - 1]}>${n}`] = str(color ?? 'accent');
      });
    },
    highlight(p, [v, color]) {
      p.hl[str(v)] = str(color ?? 'highlight');
    },
    highlightPath(p, [ids, color]) {
      const path = list(ids ?? null).map(str);
      path.forEach((n, i) => {
        p.hl[n] = str(color ?? 'accent');
        if (i) p.hlEdges[`${path[i - 1]}>${n}`] = str(color ?? 'accent');
      });
    },
    unhighlight(p, [v]) {
      if (v === undefined) {
        p.hl = {};
        p.hlEdges = {};
      } else delete p.hl[str(v)];
    },
    label(p, [v, text]) {
      p.labels[str(v)] = str(text ?? null);
    },
  },
  render(p, rc) {
    const { pos, box } = layout(p);
    const nodes: RNode[] = [];
    const edgeW = 2.5;
    for (const [n, kids] of Object.entries(p.nodes as Record<string, Kids>)) {
      if (!pos.has(n)) continue;
      for (const c of kids) {
        if (c === null || !pos.has(c)) continue;
        const a = box(n), b = box(c);
        const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        const s = clipToRect(a, cb.x, cb.y, 2), e = clipToRect(b, ca.x, ca.y, p.arrows ? 6 : 2);
        const hl = p.hlEdges[`${n}>${c}`];
        const color = hl ? rc.color(hl, 'accent') : rc.theme.border;
        nodes.push(h.path(`e:${n}>${c}`, `M${s.x} ${s.y} L${e.x} ${e.y}`, { stroke: color, 'stroke-width': hl ? edgeW + 1 : edgeW, fill: 'none' }, { enter: 'draw' }));
        if (p.arrows) {
          const d = Math.hypot(e.x - s.x, e.y - s.y) || 1, ux = (e.x - s.x) / d, uy = (e.y - s.y) / d, k = 11;
          nodes.push(h.path(`a:${n}>${c}`, `M${e.x} ${e.y} L${e.x - ux * k - uy * k * 0.55} ${e.y - uy * k + ux * k * 0.55} L${e.x - ux * k + uy * k * 0.55} ${e.y - uy * k - ux * k * 0.55} Z`, { fill: color }));
        }
      }
    }
    for (const n of pos.keys()) {
      const b = box(n);
      const hl = p.hl[n] ? rc.color(p.hl[n], 'highlight') : null;
      const fill = hl ? fillTint(rc.theme, hl, 0.2) : rc.theme.surface;
      const stroke = hl ?? rc.theme.border;
      if (p.shape === 'box') {
        nodes.push(
          glowRect(`g:${n}`, b.x, b.y, b.w, b.h, 10, hl ?? rc.theme.glow, hl ? 0.9 : 0),
          h.rect(`n:${n}`, b.x, b.y, b.w, b.h, { rx: 10, fill, stroke, 'stroke-width': 2 }),
        );
      } else {
        nodes.push(
          glowCircle(`g:${n}`, b.x + b.w / 2, b.y + b.h / 2, p.r, hl ?? rc.theme.glow, hl ? 0.9 : 0),
          h.circle(`n:${n}`, b.x + b.w / 2, b.y + b.h / 2, p.r, { fill, stroke, 'stroke-width': 2 }),
        );
      }
      nodes.push(
        h.text(`t:${n}`, b.x + b.w / 2, midBaseline(b.y, b.h, p.size), str(p.labels[n] ?? n), {
          'font-size': p.size, 'font-family': rc.theme.fontMono, 'font-weight': 700, 'text-anchor': 'middle', fill: rc.theme.fg,
        }),
      );
    }
    return nodes;
  },
  anchor(p, path) {
    if (path.length !== 1) return undefined;
    const n = str(path[0]);
    const { pos, box } = layout(p);
    return pos.has(n) ? box(n) : undefined;
  },
});

