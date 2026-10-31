import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { api, errorText, EVENT_TERMINAL_DATA, EVENT_TERMINAL_EXIT, on, type Harness } from '../api.ts';
import { agentInput, setActiveAgent, setTerminalSink } from './bus.ts';

const STORAGE_KEY = 'kino:harness';

function decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function loadHarness(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? 'claude';
  } catch {
    return 'claude';
  }
}

/**
 * The agent panel: an embedded terminal running an agent harness (Claude
 * Code, Codex, Gemini CLI, …) in the project folder. The agent edits the
 * .kino script; the studio picks the changes up live.
 */
export function TerminalPanel() {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);
  const exited = useRef(false);
  const [id, setId] = useState<string | null>(null);
  const [harnesses, setHarnesses] = useState<Harness[]>([]);
  const [harness, setHarness] = useState(loadHarness);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Keystrokes are sent strictly in order, batched while a write is in flight.
  const queue = useRef('');
  const flushing = useRef(false);
  const send = (data: string) => {
    queue.current += data;
    if (flushing.current || !idRef.current) return;
    flushing.current = true;
    (async () => {
      while (queue.current && idRef.current) {
        const chunk = queue.current;
        queue.current = '';
        await api.terminalWrite(idRef.current, chunk).catch(() => {});
      }
      flushing.current = false;
    })();
  };

  const attach = (newId: string | null, activeHarness?: string) => {
    idRef.current = newId;
    exited.current = false;
    setId(newId);
    setActiveAgent(
      newId && activeHarness !== 'shell'
        ? {
            send: (prompt) => api.terminalWrite(newId, agentInput(prompt)),
            focus: () => term.current?.focus(),
          }
        : null,
    );
  };

  useEffect(() => {
    let disposed = false;
    const t = new Terminal({
      fontFamily: 'ui-monospace, "JetBrains Mono", "Fira Code", monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      theme: {
        background: cssVar('--term-bg'),
        foreground: cssVar('--term-fg'),
        cursor: cssVar('--accent'),
        selectionBackground: 'rgba(110,168,254,0.35)',
      },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(host.current!);
    term.current = t;
    fit.current = f;
    t.onData(send);
    t.onBinary(send);

    const ro = new ResizeObserver(() => {
      try {
        f.fit();
      } catch {
        return;
      }
      if (idRef.current) api.terminalResize(idRef.current, t.cols, t.rows).catch(() => {});
    });
    ro.observe(host.current!);

    const offData = on<{ id: string; data: string }>(EVENT_TERMINAL_DATA, (ev) => {
      if (ev.id === idRef.current) t.write(decode(ev.data));
    });
    const offExit = on<{ id: string; code: number }>(EVENT_TERMINAL_EXIT, (ev) => {
      if (ev.id === idRef.current) {
        exited.current = true;
        setActiveAgent(null);
        setExitCode(ev.code);
        t.write(`\r\n\x1b[2m[process exited with code ${ev.code}]\x1b[0m\r\n`);
      }
    });

    setTerminalSink((text) => {
      if (!idRef.current || exited.current) return false;
      send(text);
      t.focus();
      return true;
    });

    api.harnesses().then(setHarnesses, (e) => setError(String(e)));
    // Reattach to a session that survived a reload.
    api.terminals().then(
      async (list) => {
        if (disposed || idRef.current) return;
        const running = (list ?? []).find((x) => x.running);
        if (!running) return;
        setHarness(running.harness);
        const buf = await api.terminalBuffer(running.id);
        if (disposed || idRef.current) return;
        t.write(decode(buf));
        attach(running.id, running.harness);
        f.fit();
        api.terminalResize(running.id, t.cols, t.rows).catch(() => {});
      },
      () => {},
    );

    return () => {
      disposed = true;
      ro.disconnect();
      offData();
      offExit();
      setTerminalSink(null);
      setActiveAgent(null);
      t.dispose();
    };
  }, []);

  const start = async (h = harness, resume = false) => {
    if (starting) return;
    setStarting(true);
    const t = term.current!;
    setError(null);
    setExitCode(null);
    try {
      localStorage.setItem(STORAGE_KEY, h);
    } catch {
      /* storage unavailable */
    }
    if (idRef.current) await api.stopTerminal(idRef.current).catch(() => {});
    attach(null);
    t.reset();
    try {
      fit.current!.fit();
      const launch = resume ? api.resumeTerminal : api.startTerminal;
      attach(await launch(h, t.cols, t.rows), h);
      t.focus();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
    }
  };

  const stop = async () => {
    if (idRef.current) await api.stopTerminal(idRef.current).catch(() => {});
    attach(null);
  };

  const current = harnesses.find((h) => h.id === harness);
  const running = id !== null && exitCode === null;

  return (
    <div className="panel terminal">
      <div className="panel-header">
        <span className="panel-title">Agent</span>
        <select value={harness} onChange={(e) => setHarness(e.target.value)} title="Agent harness" disabled={running || starting}>
          {harnesses.map((h) => (
            <option key={h.id} value={h.id} disabled={!h.available}>
              {h.name}
              {h.available ? '' : ' (not installed)'}
            </option>
          ))}
        </select>
        <span className="spacer" />
        {running ? (
          <>
            <button onClick={() => start()} disabled={starting} title="Start a fresh agent session">
              Restart
            </button>
            <button onClick={stop} disabled={starting}>Stop</button>
          </>
        ) : (
          <>
            {current?.resumeArgs?.length ? (
              <button
                onClick={() => start(harness, true)}
                disabled={!current.available || starting}
                title={harness === 'gemini' ? 'Resume the latest session for this project' : 'Choose a saved session for this project'}
              >
                Resume
              </button>
            ) : null}
            <button className="primary" onClick={() => start()} disabled={!current?.available || starting}>
              Start
            </button>
          </>
        )}
      </div>
      {error && <div className="error small">{error}</div>}
      <div className="terminal-host-wrap">
        <div className="terminal-host" ref={host} />
        {id === null && (
          <div className="terminal-empty">
            <p>Run an agent in this project's folder.</p>
            <p className="muted small">
              It gets AGENTS.md, the Kino DSL reference and skill, and a status file with compile errors. Its edits to the script show up in the preview as soon
              as it saves.
            </p>
            <div className="harness-grid">
              {harnesses.map((h) => (
                <button key={h.id} disabled={!h.available || starting} onClick={() => (setHarness(h.id), start(h.id))}>
                  {h.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
