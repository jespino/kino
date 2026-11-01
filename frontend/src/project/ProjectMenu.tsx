import { ProjectMenu as StudioProjectMenu } from '@jespino/agentstudio';
import { useStore } from '../store.ts';
import { builtinTemplates, customTemplates } from './actions.ts';

const templates = async () => [
  { label: 'New from template', templates: builtinTemplates },
  { label: 'New from your template', templates: (await customTemplates()).templates },
];

/** Toolbar project name with New / Open / Recent / Close. */
export function ProjectMenu() {
  const project = useStore((s) => s.project);
  return <StudioProjectMenu project={project} templates={templates} />;
}
