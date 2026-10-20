export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });
export const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function union(rs: Rect[]): Rect {
  if (!rs.length) return rect(0, 0, 0, 0);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rs) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  return rect(x0, y0, x1 - x0, y1 - y0);
}

/** Point where the segment from the rect center towards (tx, ty) leaves the rect. */
export function clipToRect(r: Rect, tx: number, ty: number, pad = 0): { x: number; y: number } {
  const c = center(r);
  const dx = tx - c.x;
  const dy = ty - c.y;
  if (dx === 0 && dy === 0) return c;
  const hw = r.w / 2 + pad;
  const hh = r.h / 2 + pad;
  const s = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * Math.min(s, 1), y: c.y + dy * Math.min(s, 1) };
}

// ---- SVG path helpers (absolute and relative commands) ----

export interface PathCmd {
  c: string;
  n: number[];
}

export function parsePath(d: string): PathCmd[] {
  const out: PathCmd[] = [];
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const nums = (m[2].match(/-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? []).map(Number);
    out.push({ c: m[1], n: nums });
  }
  return out;
}

export const pathToString = (cmds: PathCmd[]) => cmds.map((c) => c.c + c.n.map(fmt).join(' ')).join(' ');

export function translatePath(d: string, dx: number, dy: number): string {
  const cmds = parsePath(d);
  cmds.forEach((cmd, i) => {
    const up = cmd.c.toUpperCase();
    if (cmd.c !== up) {
      // relative commands move with their predecessor; only a leading `m` is absolute
      if (i === 0 && cmd.c === 'm') {
        cmd.n[0] += dx;
        cmd.n[1] += dy;
      }
      return;
    }
    if (up === 'H') cmd.n = cmd.n.map((v) => v + dx);
    else if (up === 'V') cmd.n = cmd.n.map((v) => v + dy);
    else if (up === 'A') cmd.n = cmd.n.map((v, k) => (k % 7 === 5 ? v + dx : k % 7 === 6 ? v + dy : v));
    else if (up !== 'Z') cmd.n = cmd.n.map((v, k) => (k % 2 === 0 ? v + dx : v + dy));
  });
  return pathToString(cmds);
}

export function lerpPath(a: string, b: string, t: number): string | null {
  const pa = parsePath(a);
  const pb = parsePath(b);
  if (pa.length !== pb.length) return null;
  const out: PathCmd[] = [];
  for (let i = 0; i < pa.length; i++) {
    if (pa[i].c !== pb[i].c || pa[i].n.length !== pb[i].n.length) return null;
    out.push({ c: pa[i].c, n: pa[i].n.map((v, k) => v + (pb[i].n[k] - v) * t) });
  }
  return pathToString(out);
}

/** Absolute points of a path (endpoints and control points); used for bounding boxes and lengths. */
export function pathPoints(d: string): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  let cx = 0, cy = 0;
  for (const { c, n } of parsePath(d)) {
    const up = c.toUpperCase();
    const rel = c !== up;
    if (up === 'Z') continue;
    if (up === 'H') {
      for (const v of n) pts.push({ x: (cx = rel ? cx + v : v), y: cy });
      continue;
    }
    if (up === 'V') {
      for (const v of n) pts.push({ x: cx, y: (cy = rel ? cy + v : v) });
      continue;
    }
    const step = up === 'A' ? 7 : 2;
    for (let k = 0; k + 1 < n.length; k += step) {
      const [x, y] = up === 'A' ? [n[k + 5], n[k + 6]] : [n[k], n[k + 1]];
      const px = rel ? cx + x : x;
      const py = rel ? cy + y : y;
      pts.push({ x: px, y: py });
      const last = up === 'C' ? (k / 2) % 3 === 2 : up === 'Q' || up === 'S' ? (k / 2) % 2 === 1 : true;
      if (last || up === 'A') {
        cx = px;
        cy = py;
      }
    }
  }
  return pts;
}

/** Approximate length of an absolute M/L/Q/C path. */
export function pathLength(d: string): number {
  let len = 0;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const seg = (pts: number[][]) => {
    // sample bezier of arbitrary degree
    const N = pts.length > 2 ? 24 : 1;
    let px = pts[0][0], py = pts[0][1];
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      let p = pts.map((q) => [...q]);
      while (p.length > 1) p = p.slice(1).map((q, k) => [p[k][0] + (q[0] - p[k][0]) * t, p[k][1] + (q[1] - p[k][1]) * t]);
      len += Math.hypot(p[0][0] - px, p[0][1] - py);
      px = p[0][0];
      py = p[0][1];
    }
  };
  for (const { c, n } of parsePath(d)) {
    if (c === 'M') { cx = sx = n[0]; cy = sy = n[1]; }
    else if (c === 'L') for (let k = 0; k < n.length; k += 2) { seg([[cx, cy], [n[k], n[k + 1]]]); cx = n[k]; cy = n[k + 1]; }
    else if (c === 'Q') { seg([[cx, cy], [n[0], n[1]], [n[2], n[3]]]); cx = n[2]; cy = n[3]; }
    else if (c === 'C') { seg([[cx, cy], [n[0], n[1]], [n[2], n[3]], [n[4], n[5]]]); cx = n[4]; cy = n[5]; }
    else if (c === 'Z') { seg([[cx, cy], [sx, sy]]); cx = sx; cy = sy; }
  }
  return len;
}

export function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** Map a point through an SVG transform list (translate, scale, rotate, matrix). */
export function transformPoint(t: string | undefined, x: number, y: number): { x: number; y: number } {
  if (!t) return { x, y };
  const ops = [...t.matchAll(/(translate|scale|rotate|matrix)\(([^)]*)\)/g)].map((m) => ({ f: m[1], a: m[2].split(/[\s,]+/).filter(Boolean).map(Number) }));
  // the rightmost transform applies first
  for (let i = ops.length - 1; i >= 0; i--) {
    const { f, a } = ops[i];
    if (f === 'translate') {
      x += a[0];
      y += a[1] ?? 0;
    } else if (f === 'scale') {
      x *= a[0];
      y *= a[1] ?? a[0];
    } else if (f === 'rotate') {
      const r = (a[0] * Math.PI) / 180, cx = a[1] ?? 0, cy = a[2] ?? 0;
      const dx = x - cx, dy = y - cy;
      x = cx + dx * Math.cos(r) - dy * Math.sin(r);
      y = cy + dx * Math.sin(r) + dy * Math.cos(r);
    } else if (f === 'matrix') {
      [x, y] = [a[0] * x + a[2] * y + a[4], a[1] * x + a[3] * y + a[5]];
    }
  }
  return { x, y };
}

/**
 * Point at fraction `q` (0..1) of a path's length (M/L/Q/C/Z), with the direction
 * of travel there in degrees: what a `draw` reveal has reached at progress q.
 */
export function pointAlong(d: string, q: number): { x: number; y: number; angle: number } {
  const pts: number[][] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  const seg = (ctrl: number[][]) => {
    const N = ctrl.length > 2 ? 24 : 1;
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      let p = ctrl.map((c) => [...c]);
      while (p.length > 1) p = p.slice(1).map((c, k) => [p[k][0] + (c[0] - p[k][0]) * t, p[k][1] + (c[1] - p[k][1]) * t]);
      pts.push(p[0]);
    }
  };
  for (const { c, n } of parsePath(d)) {
    if (c === 'M') { cx = sx = n[0]; cy = sy = n[1]; pts.push([cx, cy]); }
    else if (c === 'L') for (let k = 0; k < n.length; k += 2) { seg([[cx, cy], [n[k], n[k + 1]]]); cx = n[k]; cy = n[k + 1]; }
    else if (c === 'Q') { seg([[cx, cy], [n[0], n[1]], [n[2], n[3]]]); cx = n[2]; cy = n[3]; }
    else if (c === 'C') { seg([[cx, cy], [n[0], n[1]], [n[2], n[3]], [n[4], n[5]]]); cx = n[4]; cy = n[5]; }
    else if (c === 'Z') { seg([[cx, cy], [sx, sy]]); cx = sx; cy = sy; }
  }
  if (pts.length < 2) return { x: pts[0]?.[0] ?? 0, y: pts[0]?.[1] ?? 0, angle: 0 };
  const lens = [0];
  for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const target = Math.max(0, Math.min(1, q)) * lens[lens.length - 1];
  let i = 1;
  while (i < pts.length - 1 && lens[i] < target) i++;
  const a = pts[i - 1], b = pts[i];
  const f = lens[i] > lens[i - 1] ? (target - lens[i - 1]) / (lens[i] - lens[i - 1]) : 1;
  return { x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, angle: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI };
}
