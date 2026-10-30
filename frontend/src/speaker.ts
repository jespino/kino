// The speaker view window: shows what the presenting window sends (current
// and next slide, notes) and sends navigation back. It compiles nothing itself.
import { SpeakerView, type DeckCommand, type SpeakerState } from '../present.ts';
import { loadFonts } from '../fonts.ts';
import { broadcast, EVENT_PRESENT_CMD, EVENT_PRESENT_SHOW, on } from './api.ts';

export function speakerWindow(root: HTMLElement) {
  const view = new SpeakerView(root, (c: DeckCommand) => broadcast(EVENT_PRESENT_CMD, c).catch(() => {}));
  view.show(null);
  on<SpeakerState | null>(EVENT_PRESENT_SHOW, (s) => view.show(s));
  loadFonts().catch(() => {});
  broadcast(EVENT_PRESENT_CMD, 'hello').catch(() => {});
}
