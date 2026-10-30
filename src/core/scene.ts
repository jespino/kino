import { KinoError, type Pos, type Stmt } from '../dsl/ast.ts';
import { evaluate, isObj, isRef, num, str, type Value } from './values.ts';
import type { Props, WidgetCtx } from './widget.ts';
import type { WidgetRegistry } from '../widgets/index.ts';

export interface Instance {
  name: string;
  type: string;
  props: Props;
}

export interface Camera {
  /** point or widget reference the camera centers on; null = video center */
  center: Value;
  zoom: number;
}

/** A snapshot of the whole scene; the timeline is a list of these. */
export interface SceneState {
  widgets: Instance[];
  camera: Camera;
}

/** Props every widget understands, handled by the engine. */
export const COMMON_DEFAULTS: Props = { at: null, origin: 'top-left', opacity: 1, z: 0, enter: 'fade', exit: 'fade', action: null, group: null, link: null, minZoom: 0, maxZoom: null, panel: null, panelGlow: false, panelColor: 'caption' };

/** emphasis methods every widget has: they play during the step that calls them */
export const EMPHASIS = ['bounce', 'shake', 'pulse', 'spin', 'wiggle', 'tada', 'jump'];

export const emptyState = (): SceneState => ({ widgets: [], camera: { center: null, zoom: 1 } });

export class SceneBuilder {
  private idSeq = 0;

  constructor(private registry: WidgetRegistry) {}

  /** Apply statements to a (mutable) state. */
  apply(state: SceneState, stmts: Stmt[]) {
    for (const s of stmts) this.exec(state, s);
  }

  private exec(state: SceneState, s: Stmt) {
    switch (s.t) {
      case 'decl':
        return this.declare(state, s.name, s.type, Object.fromEntries(s.props.map(([k, v]) => [k, evaluate(v)])), s.at && evaluate(s.at), s.pos);
      case 'connect': {
        const props: Props = { from: evaluate(s.from), to: evaluate(s.to), ...Object.fromEntries(s.props.map(([k, v]) => [k, evaluate(v)])) };
        if (s.dashed) props.dashed = true;
        const name = s.name ?? `${str(props.from)}->${str(props.to)}`;
        return this.declare(state, name, 'arrow', props, undefined, s.pos);
      }
      case 'remove':
        for (const n of s.names) {
          this.find(state, n, s.pos);
          // a group takes its members (and theirs) with it, and arrows/pointers lose what they point at
          const gone = new Set([n]);
          const refersToGone = (v: unknown): boolean =>
            isRef(v as Value) ? gone.has(String((v as { $ref: unknown[] }).$ref[0])) : Array.isArray(v) ? v.some(refersToGone) : false;
          for (let more = true; more; ) {
            more = false;
            for (const w of state.widgets) {
              if (gone.has(w.name)) continue;
              const member = isRef(w.props.group) && gone.has(String(w.props.group.$ref[0]));
              const dangling = this.registry.get(w.type)?.overlay && Object.entries(w.props).some(([k, v]) => k !== 'at' && refersToGone(v));
              if (member || dangling) {
                gone.add(w.name);
                more = true;
              }
            }
          }
          state.widgets = state.widgets.filter((w) => !gone.has(w.name));
        }
        return;
      case 'assign':
        return this.assign(state, s.target.map((x) => ('name' in x ? x.name : (evaluate(x.index) as string | number))), evaluate(s.value), s.pos);
      case 'merge': {
        const base = s.target.map((x) => ('name' in x ? x.name : (evaluate(x.index) as string | number)));
        for (const [k, v] of s.props) this.assign(state, [...base, k], evaluate(v), s.pos);
        return;
      }
      case 'call':
        return this.call(state, s.target.map((x) => ('name' in x ? x.name : (evaluate(x.index) as string | number))), s.method, s.args.map(evaluate), s.pos);
      case 'then':
      case 'say':
      case 'note':
        return;
    }
  }

  declare(state: SceneState, name: string, type: string, props: Props, at: Value | undefined, pos: Pos) {
    if (name === 'camera') throw new KinoError(`'camera' is reserved`, pos);
    const def = this.registry.get(type);
    if (!def) throw new KinoError(`unknown widget type '${type}'. Known: ${this.registry.all().map((d) => d.type).join(', ')}`, pos);
    const defaults = { ...structuredClone(COMMON_DEFAULTS), ...structuredClone(def.defaults) };
    const full: Props = { ...defaults, ...Object.fromEntries(Object.entries(props).map(([k, v]) => [k, coerce(defaults, k, v)])) };
    if (at !== undefined) full.at = at;
    def.init?.(full, this.ctx(state, name, pos));
    const inst: Instance = { name, type, props: full };
    const i = state.widgets.findIndex((w) => w.name === name);
    if (i >= 0) state.widgets[i] = inst;
    else state.widgets.push(inst);
  }

  private assign(state: SceneState, path: (string | number)[], value: Value, pos: Pos) {
    const [name, ...rest] = path;
    if (!rest.length) throw new KinoError(`cannot assign to '${name}' itself; assign a property like ${name}.text`, pos);
    if (name === 'camera') {
      if (rest[0] === 'zoom') state.camera.zoom = num(value);
      else if (rest[0] === 'center' || rest[0] === 'at') state.camera.center = value;
      else throw new KinoError(`camera has 'center' and 'zoom'`, pos);
      return;
    }
    const w = this.find(state, String(name), pos);
    const def = this.registry.get(w.type)!;
    const ctx = this.ctx(state, w.name, pos);
    try {
      if (def.assign?.(w.props, rest, value, ctx)) return;
    } catch (e) {
      throw wrap(e, pos);
    }
    // generic nested assignment
    let target: any = w.props;
    for (const k of rest.slice(0, -1)) {
      if (typeof target[k] !== 'object' || target[k] === null) target[k] = {};
      target = target[k];
    }
    const key = rest[rest.length - 1];
    target[key] = rest.length === 1 ? coerce({ ...COMMON_DEFAULTS, ...def.defaults }, String(key), value) : value;
  }

  private call(state: SceneState, path: (string | number)[], method: string, args: Value[], pos: Pos) {
    const name = String(path[0]);
    if (name === 'camera') {
      if (method === 'focus') {
        state.camera.center = args[0] ?? null;
        if (args[1] !== undefined) state.camera.zoom = num(args[1]);
      } else if (method === 'reset') {
        state.camera = { center: null, zoom: 1 };
      } else throw new KinoError(`camera methods: focus(target, zoom?), reset()`, pos);
      return;
    }
    const w = this.find(state, name, pos);
    if (path.length > 1) {
      // `arr[2].highlight()` -> `arr.highlight(2)`
      args = [...path.slice(1), ...args];
    }
    const def = this.registry.get(w.type)!;
    const fn = def.methods?.[method];
    const ctx = this.ctx(state, w.name, pos);
    if (fn) {
      try {
        return fn.call(def, w.props, args, ctx);
      } catch (e) {
        throw wrap(e, pos);
      }
    }
    // methods available on every widget
    switch (method) {
      case 'hide':
        w.props.opacity = 0;
        return;
      case 'show':
        w.props.opacity = 1;
        return;
      case 'moveTo':
        w.props.at = args[0];
        return;
    }
    if (EMPHASIS.includes(method)) {
      w.props.action = { name: method, n: (w.props.action?.n ?? 0) + 1 };
      return;
    }
    const known = [...Object.keys(def.methods ?? {}), 'hide', 'show', 'moveTo', ...EMPHASIS];
    throw new KinoError(`'${w.type}' has no method '${method}'. Available: ${known.join(', ')}`, pos);
  }

  private find(state: SceneState, name: string, pos: Pos): Instance {
    const w = state.widgets.find((w) => w.name === name);
    if (!w) throw new KinoError(`unknown widget '${name}'`, pos);
    return w;
  }

  private ctx(state: SceneState, name: string, pos: Pos): WidgetCtx {
    return {
      name,
      newId: () => `n${++this.idSeq}`,
      props: (n) => this.find(state, n, pos).props,
      error: (msg) => {
        throw new KinoError(msg, pos);
      },
    };
  }
}

/**
 * Bare words parse as references (`to: data[0]`), but for props whose default
 * is a string (`color: warn`, `font: mono`, `origin: center`) they mean the word itself.
 */
function coerce(defaults: Props, key: string, v: Value): Value {
  if (typeof defaults[key] === 'string' && isRef(v) && v.$ref.length === 1) return v.text;
  return v;
}

function wrap(e: unknown, pos: Pos): Error {
  if (e instanceof KinoError && e.pos) return e;
  return new KinoError(e instanceof Error ? e.message.replace(/^\d+:\d+: /, '') : String(e), pos);
}

