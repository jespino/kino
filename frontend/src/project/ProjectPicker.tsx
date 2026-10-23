import { useEffect, useState } from 'react';
import { api, errorText, type DirListing } from '../api.ts';
import { useStore } from '../store.ts';
import { createProject, openProject } from './actions.ts';

/** In-app folder browser for opening or creating a project (shells without native dialogs). */
export function ProjectPicker() {
  const mode = useStore((s) => s.picker);
  const template = useStore((s) => s.template);
  const setPicker = useStore((s) => s.setPicker);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const go = async (p: string) => {
    try {
      const l = await api.listDir(p);
      setListing(l);
      setPath(l.path);
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  };

  useEffect(() => {
    setName('');
    setError(null);
    if (!mode) return;
    const dir = useStore.getState().project?.dir;
    go(dir ? dir.replace(/[\\/][^\\/]+$/, '') : '');
  }, [mode]);

  if (!mode) return null;
  const close = () => useStore.setState({ picker: null, template: null });
  const sep = path.includes('\\') ? '\\' : '/';
  const target = name.trim() ? `${path}${path.endsWith(sep) ? '' : sep}${name.trim()}` : path;
  const entries = listing?.entries.filter((e) => e.isDir || (mode === 'open' && e.isScript)) ?? [];

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{mode === 'new' ? (template ? `New project from “${template.name}”` : 'New project') : 'Open project'}</h2>
        <p className="muted small">
          {mode === 'new'
            ? 'A project is a folder: it will contain the .kino script and an assets/ folder.'
            : 'Choose a project folder (one that holds a .kino script), or a script.'}
        </p>
        <div className="picker-path">
          <button onClick={() => listing?.parent && go(listing.parent)} disabled={!listing?.parent} title="Parent folder">↑</button>
          <input value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go(path)} />
          <button onClick={() => go(path)}>Go</button>
        </div>
        <ul className="picker-list">
          {entries.map((e) => (
            <li
              key={e.path}
              className={e.isProject || e.isScript ? 'project' : ''}
              onClick={() => (e.isScript ? openProject(e.path) : go(e.path))}
              title={e.path}
            >
              <span className="icon">{e.isScript ? '◆' : e.isProject ? '▣' : '▸'}</span>
              <span className="ellipsis">{e.name}</span>
              {e.isProject && <span className="tag">project</span>}
            </li>
          ))}
          {entries.length === 0 && <li className="muted small">Nothing here.</li>}
        </ul>
        {error && <div className="danger-text small">{error}</div>}
        {mode === 'new' ? (
          <>
            <label className="field">
              Project folder name (created inside the current folder; leave empty to use the current folder)
              <input value={name} placeholder="my-animation" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createProject(target)} />
            </label>
            <div className="row">
              <span className="muted small ellipsis" title={target}>{target}</span>
              <span className="spacer" />
              <button onClick={close}>Cancel</button>
              <button className="primary" onClick={() => createProject(target)} disabled={!path}>Create project</button>
            </div>
          </>
        ) : (
          <div className="row">
            <span className="spacer" />
            <button onClick={close}>Cancel</button>
            <button className="primary" onClick={() => openProject(path)} disabled={!listing?.scripts.length} title={listing?.scripts.length ? '' : 'This folder has no .kino script'}>
              Open this folder
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
