import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { spokenText } from '../../kino.ts';
import { jump, narration, play, resync, seek } from '../engine.ts';
import { useStore } from '../store.ts';
import { askActiveAgent, getActiveAgent, subscribeToAgent } from '../terminal/bus.ts';

const fmt = (ms: number) => {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
};

/** The animation at the playhead, its subtitle and the transport controls. */
export function Preview() {
  const stage = useRef<HTMLDivElement>(null);
  const movie = useStore((s) => s.movie);
  const time = useStore((s) => s.time);
  const error = useStore((s) => s.error);
  const playing = useStore((s) => s.playing);
  const preparing = useStore((s) => s.preparing);
  const speed = useStore((s) => s.speed);
  const progress = useStore((s) => s.progress);

  // the frame is an SVG string; React doesn't need to diff it
  useEffect(() => {
    if (stage.current) stage.current.innerHTML = movie ? movie.svgAt(time) : '';
  }, [movie, time]);

  const clip = movie?.narrationAt(time);
  const ids = new Set(movie?.narration.map((c) => c.request.id));
  const ready = new Set(movie?.narration.filter((c) => c.ready).map((c) => c.request.id));

  return (
    <div className="panel preview">
      <div className="panel-header">
        <span className="panel-title">Preview</span>
        {movie && (
          <span className="muted small">
            {movie.video.width}×{movie.video.height} · {movie.video.fps} fps
          </span>
        )}
        <span className="spacer" />
        {ids.size > 0 && (
          <span className="muted small" title={ready.size === ids.size ? 'All narration is cached' : 'Missing clips are generated when you press play (timings are estimated until then)'}>
            {ready.size === ids.size ? `🔊 ${ids.size} clip${ids.size === 1 ? '' : 's'}` : `🔈 ${ready.size}/${ids.size} clips generated`}
          </span>
        )}
      </div>
      {error && <ErrorBanner hasMovie={!!movie} />}
      <div className="preview-stage">
        <div className="stage" ref={stage} onClick={() => play()} />
        {!movie && !error && <div className="preview-empty muted">Compiling…</div>}
      </div>
      <div className={`subtitle ${clip && !clip.ready ? 'estimated' : ''}`}>{clip ? spokenText(clip.request.text) : ''}</div>
      {progress && <div className="progress small muted">{progress}</div>}
      <div className="transport">
        <button onClick={() => jump(-1)} title="Previous step (←)">⏮</button>
        <button className="play" onClick={() => play()} disabled={!movie} title="Play/pause (space)">
          {preparing ? '⏳' : playing ? '⏸' : '▶'}
        </button>
        <button onClick={() => jump(1)} title="Next step (→)">⏭</button>
        <input
          className="scrub"
          type="range"
          min={0}
          max={movie?.duration ?? 0}
          step={1}
          value={time}
          onChange={(e) => {
            play(false);
            seek(Number(e.target.value));
          }}
        />
        <span className="timecode">
          {fmt(time)} / {fmt(movie?.duration ?? 0)}
        </span>
        <select
          value={speed}
          title="Playback speed"
          onChange={(e) => {
            useStore.getState().setSpeed(Number(e.target.value));
            if (useStore.getState().playing) resync();
          }}
        >
          {[0.25, 0.5, 1, 2].map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <TtsStatus />
      </div>
    </div>
  );
}

function ErrorBanner({ hasMovie }: { hasMovie: boolean }) {
  const error = useStore((s) => s.error)!;
  const agent = useSyncExternalStore(subscribeToAgent, getActiveAgent);
  const [sent, setSent] = useState(false);
  useEffect(() => setSent(false), [error.message, error.line]);
  const file = useStore.getState().project?.path.split(/[\\/]/).pop();
  const ask = async () => {
    const where = error.line ? ` at line ${error.line}:${error.col}` : '';
    if (await askActiveAgent(`Kino Studio can't compile ${file}${where}: ${error.message}\nPlease fix it.`)) setSent(true);
  };
  return (
    <div className="preview-error" role="alert">
      <button className="link" onClick={() => error.line && useStore.getState().revealLine(error.line)} title="Show in the source">
        <strong>{error.line ? `Line ${error.line}: ` : ''}</strong>
        {error.message}
      </button>
      <span className="spacer" />
      {hasMovie && <span className="muted small">showing the last version that compiled</span>}
      {agent && (
        <button className="small" onClick={ask} disabled={sent}>
          {sent ? 'Sent to the agent' : 'Ask the agent to fix it'}
        </button>
      )}
    </div>
  );
}

/** Whether the narration server is up (checked when the voice track needs it; hosted providers don't). */
function TtsStatus() {
  const needs = useStore((s) => (s.movie?.narration.some((c) => !c.ready && c.request.voice.provider === 'local') ? 1 : 0));
  const health = useSyncExternalStore(subscribeHealth, () => healthState);
  useEffect(() => {
    if (needs) refreshHealth();
  }, [needs]);
  if (!needs || !health) return null;
  return health.reachable ? null : (
    <span className="small danger-text" title={`Start it with \`npm run tts\` in the Kino repo (${health.server})`}>
      TTS server offline
    </span>
  );
}

let healthState: { reachable: boolean; server: string } | null = null;
const healthSubs = new Set<() => void>();
function subscribeHealth(fn: () => void) {
  healthSubs.add(fn);
  return () => void healthSubs.delete(fn);
}
let lastCheck = 0;
function refreshHealth() {
  if (Date.now() - lastCheck < 5000) return;
  lastCheck = Date.now();
  narration.health().then((h) => {
    healthState = h;
    healthSubs.forEach((fn) => fn());
  });
}
