import { useEffect, useState } from 'react';
import { api, type RecentProject, type Template } from '../api.ts';
import { builtinTemplates, customTemplates, newProjectFlow, openProject, openProjectFlow } from './actions.ts';

function TemplateGrid({ templates }: { templates: Template[] }) {
  return (
    <div className="example-grid">
      {templates.map((t) => (
        <button key={t.name} className="small" onClick={() => newProjectFlow(t)} title={`New project from ${t.name}`}>
          {t.name}
        </button>
      ))}
    </div>
  );
}

/** Shown when no project is open. */
export function Welcome() {
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const [custom, setCustom] = useState<{ dir: string; templates: Template[] }>({ dir: '', templates: [] });
  useEffect(() => {
    api.recentProjects().then((r) => setRecent(r ?? []), () => {});
    customTemplates().then(setCustom);
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
        <h3>Start from a template</h3>
        {builtinTemplates.length > 0 && (
          <>
            <h4>Built-in</h4>
            <TemplateGrid templates={builtinTemplates} />
          </>
        )}
        <h4>Yours</h4>
        {custom.templates.length > 0 ? (
          <TemplateGrid templates={custom.templates} />
        ) : (
          <p className="muted small">
            Put <code>.kino</code> scripts, or folders holding one with its assets, in <code>{custom.dir || '~/.kino/templates'}</code>.
          </p>
        )}
      </div>
    </div>
  );
}
