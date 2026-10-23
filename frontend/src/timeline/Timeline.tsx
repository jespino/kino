import { useEffect, useRef, useState } from 'react';
import type { ElementMark, Movie, TimelineElement } from '../../kino.ts';
import { spokenText } from '../../kino.ts';
import { play, seek } from '../engine.ts';
import { useStore } from '../store.ts';

const HEADER_W = 168;
const RULER_H = 24;
const STEPS_H = 42;
const VOICE_H = 28;
const CAMERA_H = 22;
const ELEMENT_H = 24;
const DOUBLE_CLICK_MS = 350;

/** Something drawn on the canvas that reacts to the pointer. */
interface Hit {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  key: string;
  /** where a click moves the playhead; null = where the pointer is */
  time: number | null;
  line?: number;
  tip: string;
}

interface Row {
  kind: 'steps' | 'voice' | 'camera' | 'element';
  label: string;
  sub?: string;
  y: number;
  h: number;
  element?: TimelineElement;
}

const PALETTE = ['#6ea8fe', '#4fc3a1', '#f2a65a', '#c792ea', '#ef7f8f', '#e6c84f', '#5ccfe6', '#9bd36b'];
function typeColor(type: string): string {
  let h = 0;
  for (const c of type) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const secs = (ms: number) => `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
const range = (a: number, b: number) => `${secs(a)}–${secs(b)}`;

function niceStep(pps: number): number {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s * pps >= 64) ?? 600;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** The fixed rows (always visible) and the element rows (scrolled vertically). */
function layoutRows(movie: Movie | null): { fixed: Row[]; elements: Row[] } {
  const fixed: Row[] = [];
  let y = RULER_H;
  const add = (r: Omit<Row, 'y'>) => {
    fixed.push({ ...r, y });
    y += r.h;
  };
  add({ kind: 'steps', label: 'Steps', sub: 'transitions', h: STEPS_H });
  if (movie?.narration.length) add({ kind: 'voice', label: 'Voice', sub: 'narration', h: VOICE_H });
  if (movie?.timeline.camera.length) add({ kind: 'camera', label: 'Camera', h: CAMERA_H });
  const elements = (movie?.timeline.elements ?? []).map((element, i) => ({
    kind: 'element' as const,
    label: element.name,
    sub: element.type,
    y: y + i * ELEMENT_H,
    h: ELEMENT_H,
    element,
  }));
  return { fixed, elements };
}

const markTip = (owner: string, m: ElementMark) =>
  `${owner}: ${m.label}\n${m.kind === 'effect' ? 'effect' : m.kind === 'method' ? 'method call' : 'change'} at ${secs(m.time)}${m.duration ? ` (${m.duration}ms)` : ''} · line ${m.line}`;

/**
 * The movie as tracks, like a video editor: steps with their transitions,
 * narration, camera moves, and one row per element showing when it is on
 * stage and when it changes. Click to seek, double-click to open the source.
 */
export function Timeline() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hits = useRef<Hit[]>([]);
  const movie = useStore((s) => s.movie);
  const time = useStore((s) => s.time);
  const playing = useStore((s) => s.playing);
  const selection = useStore((s) => s.selection);
  const projectPath = useStore((s) => s.project?.path);
  const [pps, setPps] = useState(60); // pixels per second
  const [scroll, setScroll] = useState(0); // seconds at the left edge
  const [scrollY, setScrollY] = useState(0); // pixels the element rows are scrolled up
  const [size, setSize] = useState({ w: 0, h: 0 }); // measured by the ResizeObserver
  const [hover, setHover] = useState<{ x: number; y: number; tip: string } | null>(null);
  const [cursor, setCursor] = useState('default');
  const lastClick = useRef<{ key: string; at: number } | null>(null);
  const fitted = useRef<string | null>(null);

  const { fixed, elements } = layoutRows(movie);
  const fixedBottom = fixed.length ? fixed[fixed.length - 1].y + fixed[fixed.length - 1].h : RULER_H;
  const contentH = elements.length * ELEMENT_H;
  const maxScrollY = Math.max(0, contentH - (size.h - fixedBottom));

  useEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const xOf = (ms: number) => HEADER_W + (ms / 1000 - scroll) * pps;
  const msOf = (x: number) => (scroll + (x - HEADER_W) / pps) * 1000;

  const fit = () => {
    const dur = (movie?.duration ?? 0) / 1000;
    if (dur > 0) {
      setPps(Math.max(2, (size.w - HEADER_W - 24) / dur));
      setScroll(0);
    }
  };
  // fit each project once its movie (and the panel size) are known
  useEffect(() => {
    if (movie && projectPath && fitted.current !== projectPath && size.w > HEADER_W) {
      fitted.current = projectPath;
      fit();
    }
  }, [movie, projectPath, size.w]);

  useEffect(() => setScrollY((y) => Math.min(y, maxScrollY)), [maxScrollY]);

  // keep the playhead visible while playing
  useEffect(() => {
    if (!playing) return;
    const sec = time / 1000;
    const visible = (size.w - HEADER_W) / pps;
    if (sec > scroll + visible * 0.95 || sec < scroll) setScroll(Math.max(0, sec - visible * 0.1));
  }, [time, playing]);

  // ---- drawing -------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = {
      bg: cssVar('--tl-bg'),
      row: cssVar('--tl-row'),
      rowAlt: cssVar('--tl-row-alt'),
      grid: cssVar('--tl-grid'),
      text: cssVar('--text'),
      muted: cssVar('--text-muted'),
      accent: cssVar('--accent'),
      playhead: cssVar('--playhead'),
      header: cssVar('--panel'),
      border: cssVar('--border'),
      frame: cssVar('--clip-frame'),
      step: cssVar('--clip-step'),
      say: cssVar('--clip-say'),
      wait: cssVar('--clip-wait'),
      voice: cssVar('--clip-voice'),
      effect: cssVar('--mark-effect'),
    };
    const out: Hit[] = [];
    const end = movie?.duration ?? 0;
    const xEnd = Math.min(size.w, xOf(end));
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.textBaseline = 'middle';

    const label = (text: string, x: number, y: number, maxW: number, font = '11px system-ui, sans-serif', color = '#fff') => {
      if (maxW < 14) return;
      ctx.font = font;
      ctx.fillStyle = color;
      let t = text;
      if (ctx.measureText(t).width > maxW) {
        while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
        t += '…';
      }
      ctx.fillText(t, x, y);
    };
    const selected = (key: string) => selection?.key === key;
    const outline = (x0: number, y: number, w: number, h: number) => {
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 2;
      ctx.strokeRect(x0 + 1, y + 1, Math.max(1, w - 2), h - 2);
      ctx.lineWidth = 1;
    };
    /** the part of [x0, x1] right of the headers */
    const vis = (x0: number, x1: number) => [Math.max(x0, HEADER_W), Math.min(x1, size.w)] as const;

    // row backgrounds
    const allRows = [...fixed, ...elements.map((r) => ({ ...r, y: r.y - scrollY }))];
    allRows.forEach((r, i) => {
      if (r.y + r.h < fixedBottom && r.kind === 'element') return;
      ctx.fillStyle = i % 2 ? c.rowAlt : c.row;
      ctx.fillRect(HEADER_W, r.y, size.w - HEADER_W, r.h);
    });
    // past the end of the movie
    if (xEnd < size.w) {
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(Math.max(HEADER_W, xEnd), RULER_H, size.w - Math.max(HEADER_W, xEnd), size.h - RULER_H);
    }

    // ruler and grid
    const step = niceStep(pps);
    ctx.strokeStyle = c.grid;
    for (let s = Math.floor(scroll / step) * step; HEADER_W + (s - scroll) * pps < size.w; s += step) {
      const x = Math.round(HEADER_W + (s - scroll) * pps) + 0.5;
      if (x < HEADER_W) continue;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 7);
      ctx.lineTo(x, size.h);
      ctx.stroke();
      const m = Math.floor(s / 60);
      label(m ? `${m}:${String(+(s % 60).toFixed(2)).padStart(2, '0')}` : `${+s.toFixed(2)}s`, x + 4, RULER_H / 2 - 1, 60, '11px system-ui, sans-serif', c.muted);
    }
    if (!movie) {
      hits.current = out;
      return;
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(HEADER_W, RULER_H, size.w - HEADER_W, size.h - RULER_H);
    ctx.clip();

    // ---- steps and transitions
    const stepsRow = fixed.find((r) => r.kind === 'steps')!;
    {
      const y = stepsRow.y + 4;
      const h = stepsRow.h - 8;
      movie.timeline.steps.forEach((s, i) => {
        const x0 = xOf(s.start);
        const x1 = xOf(Math.max(s.end, s.start + 1));
        if (x1 < HEADER_W || x0 > size.w) return;
        const key = `step:${i}`;
        ctx.fillStyle = s.kind === 'frame' ? c.frame : s.kind === 'say' ? c.say : s.kind === 'wait' ? c.wait : c.step;
        ctx.beginPath();
        ctx.roundRect(x0 + 0.5, y, Math.max(2, x1 - x0 - 1), h, 4);
        ctx.fill();
        const [v0, v1] = vis(x0, x1);
        const prefix = s.kind === 'frame' ? '▣ ' : s.kind === 'say' ? '🗨 ' : s.kind === 'wait' ? '⏸ ' : '';
        label(prefix + s.name, v0 + 6, y + 11, v1 - v0 - 10, '600 11px system-ui, sans-serif');
        const tips = s.transitions.filter((t) => t.end > t.start || t.kind === 'cut');
        out.push({
          x0, x1, y0: y, y1: y + h, key, time: s.start, line: s.line,
          tip: `${s.kind} “${s.name}”\n${range(s.start, s.end)} · line ${s.line}${tips.length > 1 ? `\n${tips.length} sub-steps (then)` : ''}`,
        });
        // transitions: the part of the step where things move
        s.transitions.forEach((t, j) => {
          const tk = `${key}:t${j}`;
          const tx0 = xOf(t.start);
          const tx1 = xOf(t.end);
          const ty = y + h / 2;
          const th = h / 2;
          if (t.end <= t.start) {
            // cut: a marker
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.beginPath();
            ctx.moveTo(tx0, ty);
            ctx.lineTo(tx0 + 5, ty + th / 2);
            ctx.lineTo(tx0, ty + th);
            ctx.fill();
            out.push({ x0: tx0 - 3, x1: tx0 + 6, y0: ty, y1: ty + th, key: tk, time: t.start, line: t.line, tip: `cut at ${secs(t.start)} · line ${t.line}` });
            return;
          }
          ctx.fillStyle = selected(tk) ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)';
          ctx.fillRect(tx0, ty, tx1 - tx0, th);
          ctx.strokeStyle = 'rgba(255,255,255,0.75)';
          ctx.beginPath();
          ctx.moveTo(tx0, ty + th);
          ctx.lineTo(tx1, ty);
          if (t.kind === 'fade') {
            ctx.moveTo(tx0, ty);
            ctx.lineTo(tx1, ty + th);
          }
          ctx.stroke();
          if (tx1 - tx0 > 40) label(t.kind, tx0 + 4, ty + th / 2, tx1 - tx0 - 8, '10px system-ui, sans-serif', 'rgba(255,255,255,0.9)');
          if (selected(tk)) outline(tx0, ty, tx1 - tx0, th);
          out.push({ x0: tx0, x1: tx1, y0: ty, y1: ty + th, key: tk, time: t.start, line: t.line, tip: `${t.kind} transition · ${t.ease} · ${t.end - t.start}ms\n${range(t.start, t.end)} · line ${t.line}` });
        });
        if (selected(key)) outline(x0, y, x1 - x0, h);
      });
    }

    // ---- narration
    const voiceRow = fixed.find((r) => r.kind === 'voice');
    if (voiceRow) {
      const y = voiceRow.y + 4;
      const h = voiceRow.h - 8;
      movie.narration.forEach((n, i) => {
        const x0 = xOf(n.start);
        const x1 = xOf(n.start + n.duration);
        if (x1 < HEADER_W || x0 > size.w) return;
        const key = `voice:${i}`;
        ctx.globalAlpha = n.ready ? 1 : 0.55;
        ctx.fillStyle = c.voice;
        ctx.beginPath();
        ctx.roundRect(x0 + 0.5, y, Math.max(2, x1 - x0 - 1), h, 4);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (!n.ready) {
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.stroke();
          ctx.setLineDash([]);
        }
        const [v0, v1] = vis(x0, x1);
        label(spokenText(n.request.text), v0 + 6, y + h / 2, v1 - v0 - 10);
        if (selected(key)) outline(x0, y, x1 - x0, h);
        out.push({
          x0, x1, y0: y, y1: y + h, key, time: n.start, line: n.line,
          tip: `“${spokenText(n.request.text)}”\n${n.request.voice.speaker} · ${(n.duration / 1000).toFixed(1)}s${n.ready ? '' : ' (estimated: not generated yet)'} · line ${n.line}`,
        });
      });
    }

    // ---- marks (camera moves, element changes)
    const drawMark = (m: ElementMark, x: number, cy: number, key: string, owner: string, color: string) => {
      const r = 4.5;
      if (m.duration > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.moveTo(x, cy + r + 2.5);
        ctx.lineTo(xOf(m.time + m.duration), cy + r + 2.5);
        ctx.stroke();
      }
      ctx.fillStyle = m.kind === 'effect' ? c.effect : color;
      ctx.strokeStyle = selected(key) ? c.accent : 'rgba(0,0,0,0.55)';
      ctx.lineWidth = selected(key) ? 2 : 1;
      ctx.beginPath();
      if (m.kind === 'set') {
        ctx.moveTo(x, cy - r);
        ctx.lineTo(x + r, cy);
        ctx.lineTo(x, cy + r);
        ctx.lineTo(x - r, cy);
        ctx.closePath();
      } else if (m.kind === 'method') {
        ctx.arc(x, cy, r - 0.5, 0, Math.PI * 2);
      } else {
        // effect: a star
        for (let k = 0; k < 10; k++) {
          const a = (k * Math.PI) / 5 - Math.PI / 2;
          const rr = k % 2 ? r * 0.5 : r + 1.5;
          ctx.lineTo(x + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 1;
      out.push({ x0: x - r - 2, x1: x + r + 2, y0: cy - r - 2, y1: cy + r + 2, key, time: m.time, line: m.line, tip: markTip(owner, m) });
    };

    const cameraRow = fixed.find((r) => r.kind === 'camera');
    if (cameraRow) {
      movie.timeline.camera.forEach((m, i) => {
        const x = xOf(m.time);
        if (x > HEADER_W - 6 && x < size.w + 6) drawMark(m, x, cameraRow.y + cameraRow.h / 2 - 2, `camera:${i}`, 'camera', '#d0d4dc');
      });
    }

    // ---- elements (scrolled)
    ctx.save();
    ctx.beginPath();
    ctx.rect(HEADER_W, fixedBottom, size.w - HEADER_W, size.h - fixedBottom);
    ctx.clip();
    for (const r of elements) {
      const y = r.y - scrollY;
      if (y + r.h < fixedBottom || y > size.h) continue;
      const el = r.element!;
      const color = typeColor(el.type);
      const ey = y + 4;
      const eh = r.h - 8;
      el.spans.forEach((sp, i) => {
        const x0 = xOf(sp.start);
        const x1 = xOf(sp.end);
        if (x1 < HEADER_W || x0 > size.w) return;
        const key = `el:${el.name}:${el.type}:${i}`;
        // fade in over the enter transition, out over the exit one
        const grad = ctx.createLinearGradient(x0, 0, x1, 0);
        const w = Math.max(1, x1 - x0);
        const inFrac = Math.min(0.5, ((sp.enter / 1000) * pps) / w);
        const outFrac = Math.min(0.5, ((sp.exit / 1000) * pps) / w);
        grad.addColorStop(0, color + '33');
        grad.addColorStop(inFrac, color + 'cc');
        grad.addColorStop(1 - outFrac, color + 'cc');
        grad.addColorStop(1, outFrac > 0 ? color + '33' : color + 'cc');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(x0 + 0.5, ey, Math.max(2, x1 - x0 - 1), eh, 3);
        ctx.fill();
        if (selected(key) || selection?.key === `row:${el.name}:${el.type}`) outline(x0, ey, x1 - x0, eh);
        out.push({
          x0, x1, y0: ey, y1: ey + eh, key, time: null, line: el.line,
          tip: `${el.name} (${el.type})\non stage ${range(sp.start, sp.end)}${sp.enter ? ` · enters in ${sp.enter}ms` : ''}${sp.exit ? ` · exits in ${sp.exit}ms` : ''}\ndeclared at line ${el.line}`,
        });
      });
      el.marks.forEach((m, i) => {
        const x = xOf(m.time);
        if (x > HEADER_W - 6 && x < size.w + 6) drawMark(m, x, y + r.h / 2 - 1, `mark:${el.name}:${el.type}:${i}`, el.name, '#f4f6fa');
      });
    }
    ctx.restore();
    ctx.restore();

    // ---- headers
    ctx.fillStyle = c.header;
    ctx.fillRect(0, 0, HEADER_W, size.h);
    ctx.strokeStyle = c.border;
    ctx.beginPath();
    ctx.moveTo(HEADER_W - 0.5, 0);
    ctx.lineTo(HEADER_W - 0.5, size.h);
    ctx.moveTo(0, fixedBottom - 0.5);
    ctx.lineTo(size.w, fixedBottom - 0.5);
    ctx.stroke();
    const header = (r: Row, y: number) => {
      const rowKey = r.element ? `row:${r.element.name}:${r.element.type}` : '';
      if (rowKey && selected(rowKey)) {
        ctx.fillStyle = c.accent;
        ctx.fillRect(0, y, 3, r.h);
      }
      if (r.element) {
        ctx.fillStyle = typeColor(r.element.type);
        ctx.fillRect(10, y + r.h / 2 - 4, 8, 8);
      }
      const x = r.element ? 24 : 10;
      ctx.font = '600 12px system-ui, sans-serif';
      const nameW = Math.min(ctx.measureText(r.label).width, HEADER_W - x - 50);
      label(r.label, x, y + r.h / 2, HEADER_W - x - 50, '600 12px system-ui, sans-serif', c.text);
      if (r.sub) label(r.sub, x + nameW + 6, y + r.h / 2, HEADER_W - x - nameW - 12, '11px system-ui, sans-serif', c.muted);
      if (r.element) out.push({ x0: 0, x1: HEADER_W, y0: y, y1: y + r.h, key: rowKey, time: r.element.spans[0]?.start ?? 0, line: r.element.line, tip: `${r.element.name} (${r.element.type}) · declared at line ${r.element.line}` });
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, fixedBottom, HEADER_W, size.h - fixedBottom);
    ctx.clip();
    for (const r of elements) {
      const y = r.y - scrollY;
      if (y + r.h >= fixedBottom && y <= size.h) header(r, y);
    }
    ctx.restore();
    fixed.forEach((r) => header(r, r.y));
    label(`${elements.length} element${elements.length === 1 ? '' : 's'}`, 10, RULER_H / 2, HEADER_W - 20, '11px system-ui, sans-serif', c.muted);

    // vertical scrollbar for the element rows
    if (maxScrollY > 0) {
      const trackH = size.h - fixedBottom;
      const barH = Math.max(24, (trackH * trackH) / contentH);
      const barY = fixedBottom + (scrollY / maxScrollY) * (trackH - barH);
      ctx.fillStyle = 'rgba(127,127,127,0.35)';
      ctx.beginPath();
      ctx.roundRect(size.w - 6, barY, 4, barH, 2);
      ctx.fill();
    }

    // playhead
    const px = Math.round(xOf(time)) + 0.5;
    if (px >= HEADER_W) {
      ctx.strokeStyle = c.playhead;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, size.h);
      ctx.stroke();
      ctx.fillStyle = c.playhead;
      ctx.beginPath();
      ctx.moveTo(px - 5, 0);
      ctx.lineTo(px + 5, 0);
      ctx.lineTo(px, 7);
      ctx.fill();
      ctx.lineWidth = 1;
    }
    // marks are drawn after bars: search them first
    hits.current = out.reverse();
  });

  // ---- pointer ---------------------------------------------------------------
  const local = (ev: { clientX: number; clientY: number }) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };
  const hitAt = (x: number, y: number) => hits.current.find((h) => x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) ?? null;

  /** move the playhead to x and follow the pointer until it is released */
  const scrub = (x0: number) => {
    play(false);
    seek(msOf(Math.max(HEADER_W, x0)));
    const move = (e: PointerEvent) => seek(msOf(Math.max(HEADER_W, local(e).x)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onPointerDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    const { x, y } = local(ev);
    const st = useStore.getState();
    const hit = y > RULER_H ? hitAt(x, y) : null;
    if (!hit) {
      if (x >= HEADER_W) {
        st.select(null);
        scrub(x);
      }
      return;
    }
    const now = performance.now();
    const double = lastClick.current?.key === hit.key && now - lastClick.current.at < DOUBLE_CLICK_MS;
    lastClick.current = { key: hit.key, at: now };
    st.select({ key: hit.key, line: hit.line });
    if (double && hit.line) {
      st.revealLine(hit.line);
      return;
    }
    if (hit.time === null) scrub(x);
    else {
      play(false);
      seek(hit.time);
    }
  };

  const onPointerMove = (ev: React.PointerEvent) => {
    const { x, y } = local(ev);
    const hit = y > RULER_H ? hitAt(x, y) : null;
    setCursor(hit ? 'pointer' : x >= HEADER_W ? 'text' : 'default');
    setHover(hit ? { x, y, tip: hit.tip } : null);
  };

  const onWheel = (ev: React.WheelEvent) => {
    const { x } = local(ev);
    if (ev.ctrlKey || ev.metaKey) {
      const anchor = scroll + (x - HEADER_W) / pps;
      const next = Math.min(2000, Math.max(2, pps * Math.exp(-ev.deltaY * 0.002)));
      setPps(next);
      setScroll(Math.max(0, anchor - (x - HEADER_W) / next));
    } else if (ev.shiftKey || Math.abs(ev.deltaX) > Math.abs(ev.deltaY) || maxScrollY === 0) {
      const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
      setScroll(Math.max(0, scroll + d / pps));
    } else {
      setScrollY(Math.max(0, Math.min(maxScrollY, scrollY + ev.deltaY)));
    }
    setHover(null);
  };

  const legend = (
    <span className="tl-legend small muted">
      <span><i className="lg-set" /> change</span>
      <span><i className="lg-method" /> method</span>
      <span><i className="lg-effect">★</i> effect</span>
    </span>
  );

  return (
    <div className="panel timeline">
      <div className="panel-header">
        <span className="panel-title">Timeline</span>
        <span className="muted small hint">click to seek · double-click to open in the source · Ctrl+wheel to zoom</span>
        <span className="spacer" />
        {legend}
        <span className="sep" />
        <button onClick={() => setPps(Math.max(2, pps / 1.5))} title="Zoom out">−</button>
        <button onClick={() => setPps(Math.min(2000, pps * 1.5))} title="Zoom in">+</button>
        <button onClick={fit} title="Fit the whole movie">Fit</button>
      </div>
      <div className="timeline-canvas" ref={wrapRef} onWheel={onWheel} onPointerLeave={() => setHover(null)}>
        <canvas ref={canvasRef} style={{ cursor }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} />
        {hover && (
          <div className="tl-tip" style={{ left: Math.min(hover.x + 14, size.w - 280), top: hover.y + 16 > size.h - 70 ? hover.y - 70 : hover.y + 16 }}>
            {hover.tip}
          </div>
        )}
      </div>
    </div>
  );
}
