// Project flows: native dialogs in the desktop app, the in-app folder
// browser elsewhere (kino serve in a browser).
import { api, errorText } from '../api.ts';
import { useStore } from '../store.ts';

/** The examples bundled with the studio, to start new projects from. */
export const examples: { name: string; source: string }[] = Object.entries(
  import.meta.glob('../../../examples/*.kino', { query: '?raw', import: 'default', eager: true }) as Record<string, string>,
)
  .map(([path, source]) => ({ name: path.split('/').pop()!.replace(/\.kino$/, ''), source }))
  .sort((a, b) => a.name.localeCompare(b.name));

let native: Promise<boolean> | null = null;
const hasNative = () => (native ??= api.hasNativeDialogs().catch(() => false));

async function guarded(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    useStore.getState().showToast(errorText(e));
  }
}

export function openProject(path: string) {
  return guarded(async () => {
    await api.openProject(path);
    useStore.getState().setPicker(null);
  });
}

/** Creates the project in dir (from the chosen example, if any). */
export function createProject(dir: string, name = '') {
  const template = useStore.getState().template;
  return guarded(async () => {
    await api.newProject(dir, name || template?.name || '', template?.source ?? '');
    useStore.setState({ picker: null, template: null });
  });
}

/** "Open project…": a folder holding a .kino script. */
export function openProjectFlow() {
  return guarded(async () => {
    if (await hasNative()) {
      const dir = await api.chooseDirectory('Open a Kino project folder', false);
      if (dir) await openProject(dir);
    } else {
      useStore.getState().setPicker('open');
    }
  });
}

/** "New project…": choose or create the folder that will hold the script and its assets. */
export function newProjectFlow(template: { name: string; source: string } | null = null) {
  useStore.setState({ template });
  return guarded(async () => {
    if (await hasNative()) {
      const dir = await api.chooseDirectory(template ? `Choose a folder for the “${template.name}” project` : 'Choose or create a folder for the new project', true);
      if (dir) await createProject(dir);
      else useStore.setState({ template: null });
    } else {
      useStore.getState().setPicker('new');
    }
  });
}

export function closeProject() {
  return guarded(() => api.closeProject());
}
