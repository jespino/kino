import { KinoError } from '../dsl/ast.ts';
import { center, pathPoints, rect, transformPoint, translatePath, union, type Rect } from './geometry.ts';
import { measure } from './text.ts';
import { resolveColor, type Theme } from './theme.ts';
import { GLOW_FILTER, SHADOW_FILTER } from './svg.ts';
import { emojiDataUri, type EmojiProvider } from './emoji.ts';
import type { ImageProvider } from './image.ts';
import { isCall, isPoint, isRef, num, str, type Value } from './values.ts';
import type { RenderCtx, RNode } from './widget.ts';
import type { SceneState, Instance } from './scene.ts';
import type { WidgetRegistry } from '../widgets/index.ts';

/** A fully laid out picture: absolute primitives + the camera viewport. */
export interface Frame {
  nodes: RNode[];
  view: Rect;
  /** nodes[from..to) are drawn clipped to path `d` (canvas coordinates, even-odd); set by whole-picture transitions */
  clips?: { from: number; to: number; d: string }[];
  /** where each widget is (canvas coordinates), for zoom transitions */
  boxes?: Record<string, Rect>;
}

/** Space kept clear at each side of every slide (px). */
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface VideoInfo {
  width: number;
  height: number;
  padding?: Padding;
}

/**
 * Widens a camera view so that what it shows lands inside the padding on
 * screen: scaled evenly to fit the padded area and centered in it. Chrome drawn
 * relative to the view (backgrounds, side bars, footers) still fills the screen.
 */
export function padView(view: Rect, v: VideoInfo): Rect {
  const p = v.padding;
  if (!p || !(p.top || p.right || p.bottom || p.left)) return view;
  const aw = v.width - p.left - p.right, ah = v.height - p.top - p.bottom;
  const s = Math.min(aw / v.width, ah / v.height);
  const ox = p.left + (aw - v.width * s) / 2, oy = p.top + (ah - v.height * s) / 2;
  // view units per screen pixel
  const k = view.w / (v.width * s);
  return rect(view.x - ox * k, view.y - oy * k, v.width * k, v.height * k);
}

export class Renderer {
  private cache = new WeakMap<SceneState, Frame>();

  constructor(private registry: WidgetRegistry, private video: VideoInfo, private theme: Theme, private emoji?: EmojiProvider, private images?: ImageProvider) {}

  build(state: SceneState): Frame {
    let f = this.cache.get(state);
    if (!f) {
      f = new Layout(this.registry, this.video, this.theme, state, this.emoji, this.images).frame();
      this.cache.set(state, f);
    }
    return f;
  }
}

interface Placed {
  nodes: RNode[]; // global coordinates
  dx: number;
  dy: number;
  bbox: Rect; // global
  /** members of groups: the groups' transforms (SVG syntax) from the group's space to the canvas */
  xf?: string;
}

/** Lays out one scene state: resolves positions (incl. relative ones) and anchors. */
class Layout {
  private placed = new Map<string, Placed>();
  /** placements in the space of the widget's group (= `placed` outside groups) */
  private local = new Map<string, Placed>();
  /** each group's own transform, from its members' space to its parent's */
  private groupXf = new Map<string, string>();
  private visiting = new Set<string>();

  constructor(
    private registry: WidgetRegistry,
    private video: VideoInfo,
    private theme: Theme,
    private state: SceneState,
    private emojiProvider?: EmojiProvider,
    private imageProvider?: ImageProvider,
  ) {}

  frame(): Frame {
    const order = this.state.widgets
      .map((w, i) => ({ w, i }))
      .sort((a, b) => (a.w.props.z ?? 0) - (b.w.props.z ?? 0) || a.i - b.i)
      .map((x) => x.w);
    const nodes: RNode[] = [];
    for (const w of order) {
      const p = this.place(w.name);
      // emphasis (w.bounce(), w.shake()...) pivots around the widget's center; members join their group's
      const chain = [w, ...this.ancestors(w.name).map((g) => this.inst(g))];
      const actor = chain.find((x) => x.props.action);
      const act = actor?.props.action as { name: string; n: number } | undefined;
      const ab = actor && this.place(actor.name).bbox;
      const action = act && ab ? { name: act.name, id: `${actor!.name}:${act.name}:${act.n}`, cx: ab.x + ab.w / 2, cy: ab.y + ab.h / 2 } : undefined;
      // `minZoom`/`maxZoom`: details that show only when the camera is that close (or far)
      const zoom = this.state.camera.zoom || 1;
      const shown = (x: Instance) => zoom >= num(x.props.minZoom ?? 0) - 1e-9 && (x.props.maxZoom === null || x.props.maxZoom === undefined || zoom <= num(x.props.maxZoom) + 1e-9);
      const op = chain.reduce((o, x) => o * (x.props.opacity ?? 1) * (shown(x) ? 1 : 0), 1);
      // `link`: clicking it while presenting jumps to that frame or step (or opens the URL)
      const link = chain.find((x) => x.props.link !== null && x.props.link !== undefined && x.props.link !== '')?.props.link;
      for (const n of p.nodes) {
        const node: RNode = {
          ...n,
          key: n.key.startsWith('@') ? n.key : `${w.name}/${n.key}`,
          enter: n.enter ?? w.props.enter,
          exit: n.exit ?? w.props.exit,
          // decorations (ribbons, particles) stay put while the widget itself bounces or shakes
          action: n.decor ? undefined : action,
        };
        if (op !== 1) node.attrs = { ...node.attrs, opacity: num(node.attrs.opacity ?? 1) * op };
        if (link !== undefined && !n.decor) node.attrs = { ...node.attrs, 'data-link': str(link) };
        nodes.push(node);
      }
    }
    const boxes = Object.fromEntries(this.state.widgets.map((w) => [w.name, this.place(w.name).bbox]));
    return { nodes, view: this.camera(), boxes };
  }

  private camera(): Rect {
    const { width: W, height: H } = this.video;
    const cam = this.state.camera;
    const c = cam.center === null ? { x: W / 2, y: H / 2 } : center(this.anchor(cam.center));
    const z = cam.zoom || 1;
    return padView(rect(c.x - W / z / 2, c.y - H / z / 2, W / z, H / z), this.video);
  }

  private inst(name: string): Instance {
    const w = this.state.widgets.find((w) => w.name === name);
    if (!w) throw new KinoError(`unknown widget '${name}'`);
    return w;
  }

  private rc(name: string): RenderCtx {
    return {
      name,
      theme: this.theme,
      video: this.video,
      color: (v, fallback) => resolveColor(this.theme, v, fallback),
      measure: (text, size, mono = false, weight, ls, family) => measure(text, size, mono, weight, ls, family ?? (mono ? this.theme.fontMono : this.theme.fontSans)),
      anchor: (v) => this.anchor(v),
      emoji: (e) => emojiDataUri(this.emojiProvider, e),
      image: (src) => this.imageProvider?.(src),
    };
  }

  /** The group a widget belongs to (`group: g`), if any. */
  private groupOf(name: string): string | null {
    const g = this.inst(name).props.group;
    if (g === null || g === undefined || g === false) return null;
    if (!isRef(g) || g.$ref.length !== 1) throw new KinoError(`'group' of '${name}' must name a group widget, got ${str(g)}`);
    const gname = String(g.$ref[0]);
    if (this.inst(gname).type !== 'group') throw new KinoError(`'${name}' has group: ${gname}, but '${gname}' is a ${this.inst(gname).type}, not a group`);
    return gname;
  }

  /** Groups containing a widget, innermost first. */
  private ancestors(name: string): string[] {
    const out: string[] = [];
    for (let g = this.groupOf(name); g; g = this.groupOf(g)) {
      if (out.includes(g) || g === name) throw new KinoError(`group '${g}' contains itself`);
      out.push(g);
    }
    return out;
  }

  /** Placement on the canvas: the placement in the group's space, moved by the groups around it. */
  private place(name: string): Placed {
    const done = this.placed.get(name);
    if (done) return done;
    const l = this.placeLocal(name);
    const def = this.registry.get(this.inst(name).type)!;
    // overlays are drawn from global anchors already
    const xf = def.overlay ? '' : this.ancestors(name).map((g) => (this.placeLocal(g), this.groupXf.get(g)!)).reverse().join(' ');
    const result: Placed = xf
      ? { nodes: l.nodes.map((n) => ({ ...n, attrs: { ...n.attrs, transform: n.attrs.transform ? `${xf} ${n.attrs.transform}` : xf } })), dx: l.dx, dy: l.dy, bbox: mapRect(xf, l.bbox), xf }
      : l;
    this.placed.set(name, result);
    return result;
  }

  private placeLocal(name: string): Placed {
    const done = this.local.get(name);
    if (done) return done;
    if (this.visiting.has(name)) throw new KinoError(`circular reference while positioning '${name}'`);
    this.visiting.add(name);
    const w = this.inst(name);
    const def = this.registry.get(w.type)!;
    if (w.type === 'group') {
      const result = this.placeGroup(w);
      this.visiting.delete(name);
      this.local.set(name, result);
      return result;
    }
    let local = def.render(w.props, this.rc(name));
    let result: Placed;
    if (def.overlay) {
      result = { nodes: local, dx: 0, dy: 0, bbox: bbox(local) };
    } else {
      // optional panel around the widget; content is shifted inside it
      let sx = 0, sy = 0;
      if (w.props.panel !== null && w.props.panel !== undefined && w.props.panel !== false) {
        const inner = bbox(local);
        const deco = panelNodes(w.props, inner, this.rc(name));
        sx = deco.sx;
        sy = deco.sy;
        local = [...deco.nodes, ...local.map((n) => translateNode(n, sx, sy))];
      }
      const bb = bbox(local);
      const { dx, dy } = this.position(w, bb);
      const nodes = local.map((n) => translateNode(n, dx, dy));
      result = { nodes, dx: dx + sx, dy: dy + sy, bbox: rect(bb.x + dx, bb.y + dy, bb.w, bb.h) };
    }
    if (def.placed) {
      // register first: the hook may anchor to this widget's own parts
      this.local.set(name, result);
      if (!this.groupOf(name)) this.placed.set(name, result);
      result.nodes.push(...def.placed(w.props, this.rc(name), { bbox: result.bbox, dx: result.dx, dy: result.dy }));
    }
    this.visiting.delete(name);
    this.local.set(name, result);
    return result;
  }

  /**
   * A group in its parent's space: its members' box (plus its panel), moved by
   * `at`/`origin` (members stay where they are without `at`), then scaled and
   * turned about its center. Its nodes are only the panel; members draw themselves.
   */
  private placeGroup(w: Instance): Placed {
    const members = this.state.widgets.filter((m) => m.name !== w.name && !this.registry.get(m.type)!.overlay && this.groupOf(m.name) === w.name);
    const inner = union(members.map((m) => this.placeLocal(m.name).bbox));
    let nodes: RNode[] = [];
    let bb = inner;
    if (w.props.panel !== null && w.props.panel !== undefined && w.props.panel !== false) {
      const deco = panelNodes(w.props, inner, this.rc(w.name));
      nodes = deco.nodes.map((n) => translateNode(n, -deco.sx, -deco.sy));
      bb = bbox(nodes);
    }
    const { dx, dy } = w.props.at === null || w.props.at === undefined ? { dx: 0, dy: 0 } : this.position(w, bb);
    const c = center(bb), s = num(w.props.scale ?? 1), r = num(w.props.rotate ?? 0);
    // a fixed shape, so that moving, scaling and turning all tween
    const xf = `translate(${c.x + dx} ${c.y + dy}) rotate(${r}) scale(${s}) translate(${-c.x} ${-c.y})`;
    this.groupXf.set(w.name, xf);
    return { nodes: nodes.map((n) => ({ ...n, attrs: { ...n.attrs, transform: n.attrs.transform ? `${xf} ${n.attrs.transform}` : xf } })), dx: 0, dy: 0, bbox: mapRect(xf, bb) };
  }

  /** Offset that moves the widget's local bbox to where `at` + `origin` say. */
  private position(w: Instance, bb: Rect): { dx: number; dy: number } {
    const at: Value = w.props.at;
    const o = originOf(str(w.props.origin ?? 'top-left'), bb);
    if (at === null || at === undefined) return { dx: -o.x + 0, dy: -o.y + 0 };
    if (isPoint(at)) return { dx: at.$pt[0] - o.x, dy: at.$pt[1] - o.y };
    const space = this.groupOf(w.name);
    if (isRef(at)) {
      const c = center(this.anchor(at, space));
      return { dx: c.x - o.x, dy: c.y - o.y };
    }
    if (isCall(at)) {
      const [target, gapV] = at.args;
      const gap = gapV === undefined ? 32 : num(gapV);
      const origin = str(w.props.origin ?? 'top-left');
      const centerX = ['center', 'top', 'bottom'].includes(origin);
      const centerY = ['center', 'left', 'right'].includes(origin);
      if (at.$call === 'center') return { dx: this.video.width / 2 - (bb.x + bb.w / 2), dy: this.video.height / 2 - (bb.y + bb.h / 2) };
      const r = this.anchor(target, space);
      const alignX = centerX ? r.x + r.w / 2 - bb.w / 2 : r.x;
      const alignY = centerY ? r.y + r.h / 2 - bb.h / 2 : r.y;
      switch (at.$call) {
        case 'below':
          return { dx: alignX - bb.x, dy: r.y + r.h + gap - bb.y };
        case 'above':
          return { dx: alignX - bb.x, dy: r.y - gap - bb.h - bb.y };
        case 'right-of':
        case 'rightOf':
          return { dx: r.x + r.w + gap - bb.x, dy: alignY - bb.y };
        case 'left-of':
        case 'leftOf':
          return { dx: r.x - gap - bb.w - bb.x, dy: alignY - bb.y };
      }
      throw new KinoError(`unknown position '${at.$call}(...)'; use below, above, right-of, left-of, center`);
    }
    throw new KinoError(`'at' must be a point like (100, 200), a widget, or below(w)/right-of(w)/..., got ${str(at)}`);
  }

  /**
   * Global rect for a reference (`data[0]`), a widget name, or a point. With
   * `space` (a group), widgets of that group are measured in the group's own
   * space, so members lay out relative to each other wherever the group goes.
   */
  anchor(v: Value, space: string | null = null): Rect {
    if (isPoint(v)) return rect(v.$pt[0], v.$pt[1], 0, 0);
    if (!isRef(v)) throw new KinoError(`expected a widget reference or a point, got ${str(v)}`);
    const [name, ...path] = v.$ref;
    const w = this.inst(String(name));
    const inSpace = space !== null && this.groupOf(w.name) === space;
    const placed = inSpace ? this.placeLocal(w.name) : this.place(w.name);
    if (!path.length) return placed.bbox;
    const def = this.registry.get(w.type)!;
    const r = def.anchor?.(w.props, path, this.rc(w.name));
    if (!r) throw new KinoError(`'${v.text}' does not point to a part of the ${w.type} '${w.name}'`);
    const local = rect(r.x + placed.dx, r.y + placed.dy, r.w, r.h);
    return placed.xf ? mapRect(placed.xf, local) : local;
  }
}

/** Frame + caption + optional glow drawn behind a widget that has `panel: "Caption"` (or `panel: true`). */
function panelNodes(p: Record<string, any>, inner: Rect, rc: RenderCtx) {
  const pad = p.panelPadding ?? 22;
  const caption = typeof p.panel === 'string' || isRef(p.panel) ? str(p.panel).toUpperCase() : '';
  const capSize = 14;
  const capH = caption ? capSize * 2.4 : 0;
  const W = inner.w + pad * 2;
  const H = inner.h + pad * 2 + capH;
  const glow = rc.color(p.panelGlow === true ? 'glow' : p.panelGlow, 'glow');
  const rx = +rc.theme.panelRadius || 16;
  const shadow = +rc.theme.panelShadow > 0;
  const nodes: RNode[] = [
    ...(shadow ? [{ key: 'panel:shadow', tag: 'rect' as const, attrs: { x: 0, y: 0, width: W, height: H, rx, fill: '#000000', filter: SHADOW_FILTER } }] : []),
    { key: 'panel:glow', tag: 'rect', attrs: { x: 0, y: 0, width: W, height: H, rx, fill: 'none', stroke: glow, 'stroke-width': 5, filter: GLOW_FILTER, opacity: p.panelGlow ? 0.85 : 0 } },
    { key: 'panel:bg', tag: 'rect', attrs: { x: 0, y: 0, width: W, height: H, rx, fill: rc.theme.panel, 'fill-opacity': shadow ? 1 : 0.88, stroke: p.panelGlow ? glow : rc.theme.panelBorder, 'stroke-width': 1.5 } },
  ];
  if (caption)
    nodes.push({
      key: 'panel:caption',
      tag: 'text',
      text: caption,
      attrs: { x: pad - 4, y: pad + capSize * 0.4, 'font-size': capSize, 'font-family': rc.theme.fontCaption || rc.theme.fontSans, 'font-weight': 800, 'letter-spacing': 1.6, fill: rc.color(p.panelColor, 'caption') },
    });
  return { nodes, sx: pad - inner.x, sy: pad + capH - inner.y };
}

/** Bounding box of a rect after an SVG transform. */
function mapRect(xf: string, r: Rect): Rect {
  const pts = [transformPoint(xf, r.x, r.y), transformPoint(xf, r.x + r.w, r.y), transformPoint(xf, r.x, r.y + r.h), transformPoint(xf, r.x + r.w, r.y + r.h)];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return rect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

function originOf(origin: string, bb: Rect) {
  const o = origin.replace('_', '-');
  const x = o.includes('left') ? bb.x : o.includes('right') ? bb.x + bb.w : o === 'top' || o === 'bottom' || o === 'center' ? bb.x + bb.w / 2 : bb.x;
  const y = o.includes('top') ? bb.y : o.includes('bottom') ? bb.y + bb.h : o === 'left' || o === 'right' || o === 'center' ? bb.y + bb.h / 2 : bb.y;
  return { x, y };
}

const COORD_X = ['x', 'x1', 'x2', 'cx'];
const COORD_Y = ['y', 'y1', 'y2', 'cy'];

export function translateNode(n: RNode, dx: number, dy: number): RNode {
  if (!dx && !dy) return n;
  const attrs = { ...n.attrs };
  if (typeof attrs.transform === 'string' && attrs.transform) {
    // transformed nodes keep local coordinates; move the whole coordinate system instead
    attrs.transform = `translate(${dx} ${dy}) ${attrs.transform}`;
    return { ...n, attrs };
  }
  for (const k of COORD_X) if (typeof attrs[k] === 'number') attrs[k] = (attrs[k] as number) + dx;
  for (const k of COORD_Y) if (typeof attrs[k] === 'number') attrs[k] = (attrs[k] as number) + dy;
  if (typeof attrs.d === 'string') attrs.d = translatePath(attrs.d, dx, dy);
  if (typeof attrs.points === 'string')
    attrs.points = attrs.points.split(/[\s,]+/).filter(Boolean).map((v, i) => +v + (i % 2 ? dy : dx)).join(' ');
  return { ...n, attrs };
}

export function nodeBox(n: RNode): Rect {
  const a = n.attrs;
  const N = (k: string) => num(a[k] ?? 0);
  switch (n.tag) {
    case 'rect':
    case 'image':
      return rect(N('x'), N('y'), N('width'), N('height'));
    case 'circle':
      return rect(N('cx') - N('r'), N('cy') - N('r'), N('r') * 2, N('r') * 2);
    case 'ellipse':
      return rect(N('cx') - N('rx'), N('cy') - N('ry'), N('rx') * 2, N('ry') * 2);
    case 'line':
      return rect(Math.min(N('x1'), N('x2')), Math.min(N('y1'), N('y2')), Math.abs(N('x2') - N('x1')), Math.abs(N('y2') - N('y1')));
    case 'text': {
      const size = N('font-size') || 16;
      const family = String(a['font-family'] ?? '');
      const w = measure(n.text ?? '', size, /mono/i.test(family), N('font-weight') || 400, N('letter-spacing'), family);
      const anchor = a['text-anchor'];
      const x = anchor === 'middle' ? N('x') - w / 2 : anchor === 'end' ? N('x') - w : N('x');
      return rect(x, N('y') - size * 0.8, w, size * 1.05);
    }
    case 'path':
    case 'polygon': {
      const pts =
        n.tag === 'path'
          ? pathPoints(String(a.d ?? ''))
          : String(a.points ?? '').split(/[\s,]+/).filter(Boolean).map(Number).reduce<{ x: number; y: number }[]>((acc, v, i, arr) => (i % 2 ? acc : [...acc, { x: v, y: arr[i + 1] }]), []);
      if (!pts.length) return rect(0, 0, 0, 0);
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      return rect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    }
  }
}

export function bbox(nodes: RNode[]): Rect {
  return union(nodes.filter((n) => !n.transient && !n.decor && !(n.tag === 'text' && !n.text)).map(nodeBox));
}
