import { useEffect, useState } from 'react';
import { Welcome as StudioWelcome } from '@jespino/agentstudio';
import type { Template } from '../api.ts';
import { builtinTemplates, customTemplates } from './actions.ts';

/** Shown when no project is open. */
export function Welcome() {
  const [custom, setCustom] = useState<{ dir: string; templates: Template[] }>({ dir: '', templates: [] });
  useEffect(() => {
    customTemplates().then(setCustom);
  }, []);
  return (
    <StudioWelcome
      title="Kino Studio"
      templates={[
        { label: 'Built-in', templates: builtinTemplates },
        {
          label: 'Yours',
          templates: custom.templates,
          empty: (
            <>
              Put <code>.kino</code> scripts, or folders holding one with its assets, in <code>{custom.dir || '~/.kino/templates'}</code>.
            </>
          ),
        },
      ]}
    >
      <p>
        Explanatory animations written as text. A project is a folder with a <code>.kino</code> script and the assets it uses.
      </p>
    </StudioWelcome>
  );
}
