import { useEffect, useState } from 'react';
import { api, type RecentProject } from '../api.ts';
import { examples, newProjectFlow, openProject, openProjectFlow } from './actions.ts';

/** Shown when no project is open. */
export function Welcome() {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  useEffect(() => {
    api.recentProjects().then((r) => setRecent(r ?? []), () => {});
  }, []);
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>Kino Studio</h1>
        <p className="muted">
          Explanatory animations written as text. A project is a folder with a <code>.kino</code> script and the assets it uses.
        </p>
        <div className="welcome-actions">
          <button className="primary big" onClick={() => newProjectFlow()}>New project…</button>
          <button className="big" onClick={openProjectFlow}>Open project…</button>
        </div>
        {recent.length > 0 && (
          <>
            <h3>Recent</h3>
            <ul className="recent">
              {recent.map((r) => (
                <li key={r.path}>
                  <button className="link" disabled={!r.exists} onClick={() => openProject(r.path)} title={r.path}>
                    <span className="recent-name">{r.name}</span>
                    <span className="muted small ellipsis">{r.exists ? r.path : 'missing'}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
        {examples.length > 0 && (
          <>
            <h3>Start from an example</h3>
            <div className="example-grid">
              {examples.map((ex) => (
                <button key={ex.name} className="small" onClick={() => newProjectFlow(ex)} title={`New project with ${ex.name}.kino`}>
                  {ex.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
