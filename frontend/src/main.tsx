import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { configureStudio } from '@jespino/agentstudio';
import '@jespino/agentstudio/styles.css';
import { backend } from './api.ts';
import { App } from './App.tsx';
import { create } from './project/actions.ts';
import { speakerWindow } from './speaker.ts';
import { useStore } from './store.ts';
import './styles.css';

configureStudio({
  backend,
  id: 'kino',
  sourceOpen: true,
  openTitle: 'Open a Kino project folder',
  openHint: 'Choose a project folder (one that holds a .kino script), or a script.',
  newHint: 'A project is a folder: it will contain the .kino script and an assets/ folder.',
  namePlaceholder: 'my-animation',
  notOpenable: 'This folder has no .kino script',
  create,
  currentDir: () => useStore.getState().project?.dir,
});

// the speaker view is the same page in its own window (#speaker)
if (location.hash === '#speaker') speakerWindow(document.getElementById('root')!);
else
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
