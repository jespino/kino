import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { speakerWindow } from './speaker.ts';
import './styles.css';

// the speaker view is the same page in its own window (#speaker)
if (location.hash === '#speaker') speakerWindow(document.getElementById('root')!);
else
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
