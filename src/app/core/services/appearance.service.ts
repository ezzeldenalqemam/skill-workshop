import { effect, Injectable, signal } from '@angular/core';
import { MessageKey } from '../i18n/messages';

export type ColorMode = 'auto' | 'light' | 'dark';
export type Accent = 'navy' | 'green' | 'petrol' | 'burgundy' | 'bronze' | 'slate';

export const COLOR_MODES: { value: ColorMode; label: MessageKey }[] = [
  { value: 'auto', label: 'mode.auto' },
  { value: 'light', label: 'mode.light' },
  { value: 'dark', label: 'mode.dark' },
];

/** Accent families; their values live in the theme tokens. */
export const ACCENTS: { value: Accent; label: MessageKey }[] = [
  { value: 'navy', label: 'accent.navy' },
  { value: 'green', label: 'accent.green' },
  { value: 'petrol', label: 'accent.petrol' },
  { value: 'burgundy', label: 'accent.burgundy' },
  { value: 'bronze', label: 'accent.bronze' },
  { value: 'slate', label: 'accent.slate' },
];

const KEY = 'skill-workshop.appearance';

/** The user's design choices, mirrored onto <html> as data attributes the theme tokens key on. */
@Injectable({ providedIn: 'root' })
export class AppearanceService {
  readonly mode = signal<ColorMode>('auto');
  readonly accent = signal<Accent>('navy');

  constructor() {
    const saved = this.read();
    if (saved) {
      if (COLOR_MODES.some((m) => m.value === saved.mode)) this.mode.set(saved.mode);
      if (ACCENTS.some((a) => a.value === saved.accent)) this.accent.set(saved.accent);
    }

    effect(() => {
      const root = document.documentElement;
      root.dataset['accent'] = this.accent();
      if (this.mode() === 'auto') delete root.dataset['mode'];
      else root.dataset['mode'] = this.mode();
      try {
        localStorage.setItem(KEY, JSON.stringify({ mode: this.mode(), accent: this.accent() }));
      } catch {
        // Private windows and previews refuse storage; the choice still applies for this visit.
      }
    });
  }

  private read(): { mode: ColorMode; accent: Accent } | null {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch {
      return null;
    }
  }
}
