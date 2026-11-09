import { computed, effect, Injectable, signal } from '@angular/core';
import { Lang, MessageKey, MESSAGES } from './messages';

const KEY = 'skill-workshop.lang';

export type MessageParams = Record<string, string | number>;

/** English (LTR, the default) / Arabic (RTL). Switching language also flips `dir` on <html>. */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang = signal<Lang>(this.read());
  readonly dir = computed(() => (this.lang() === 'ar' ? 'rtl' : 'ltr'));

  constructor() {
    effect(() => {
      const root = document.documentElement;
      root.lang = this.lang();
      root.dir = this.dir();
      document.title = MESSAGES[this.lang()]['header.title'];
      try {
        localStorage.setItem(KEY, this.lang());
      } catch {
        // Storage can be blocked; the choice still applies for this visit.
      }
    });
  }

  t(key: MessageKey, params?: MessageParams): string {
    const text = MESSAGES[this.lang()][key] ?? key;
    return params ? text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? '')) : text;
  }

  toggle(): void {
    this.lang.update((l) => (l === 'ar' ? 'en' : 'ar'));
  }

  private read(): Lang {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'ar' || saved === 'en') return saved;
    } catch {
      // fall through to the default
    }
    return 'en';
  }
}
