// Project flows (agentstudio's): native dialogs in the desktop app, the
// in-app folder browser elsewhere (kino serve in a browser).
import { api, type Template } from '../api.ts';

export { closeProject, createProject, newProjectFlow, openProject, openProjectFlow } from '@jespino/agentstudio';

/** The built-in templates: the examples bundled with the studio. */
export const builtinTemplates: Template[] = Object.entries(
  import.meta.glob('../../../examples/*.kino', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)
  .map(([path, source]) => ({ name: path.split('/').pop()!.replace(/\.kino$/, ''), source }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** The custom templates in ~/.kino/templates (none if the backend can't list them). */
export async function customTemplates(): Promise<{ dir: string; templates: Template[] }> {
  try {
    const v = await api.templates();
    return { dir: v.dir, templates: (v.templates ?? []).map((t) => ({ name: t.name, source: t.source, custom: true })) };
  } catch {
    return { dir: '', templates: [] };
  }
}

/** Creates a project in dir: a custom template is copied by the backend (with its assets). */
export async function create(dir: string, name: string, template: Template | null) {
  if (template?.custom) await api.newProject(dir, name || template.name, '', template.name);
  else await api.newProject(dir, name || template?.name || '', template?.source ?? '');
}
