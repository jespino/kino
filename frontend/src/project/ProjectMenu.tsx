import { useEffect, useRef, useState } from 'react';
import { api, type RecentProject } from '../api.ts';
import { useStore } from '../store.ts';
import { closeProject, examples, newProjectFlow, openProject, openProjectFlow } from './actions.ts';

/** Toolbar project name with New / Open / Recent / Close. */
export function ProjectMenu() {
  const project = useStore((s) => s.project);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<RecentProject[]>([]);
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    api.recentProjects().then((r) => setRecent(r ?? []), () => {});
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  const file = project?.path.split(/[\\/]/).pop() ?? '';
  const pick = (fn: () => unknown) => () => {
    setOpen(false);
    fn();
  };
  const others = recent.filter((r) => r.exists && r.path !== project?.path).slice(0, 8);
  return (
    <span className="project-menu" ref={box}>
      <button className="link project-name" onClick={() => setOpen(!open)} title={project?.path}>
        {project?.name ?? 'No project'} <span className="muted">/ {file}</span> ▾
      </button>
      {open && (
        <div className="menu">
          <button onClick={pick(() => newProjectFlow())}>New project…</button>
          <button onClick={pick(openProjectFlow)}>Open project…</button>
          {others.length > 0 && <div className="menu-sep">Recent</div>}
          {others.map((r) => (
            <button key={r.path} onClick={pick(() => openProject(r.path))} title={r.path}>
              {r.name}
            </button>
          ))}
          {examples.length > 0 && <div className="menu-sep">New from example</div>}
          <div className="menu-examples">
            {examples.map((ex) => (
              <button key={ex.name} onClick={pick(() => newProjectFlow(ex))}>
                {ex.name}
              </button>
            ))}
          </div>
          <div className="menu-sep" />
          <button onClick={pick(closeProject)}>Close project</button>
        </div>
      )}
    </span>
  );
}
