import { Injectable, signal } from '@angular/core';
import { Focus } from './claude-agent.service';

/** Lets the file viewer hand a "fix this part" request over to the chat composer. */
@Injectable({ providedIn: 'root' })
export class ComposerService {
  readonly draft = signal('');
  readonly focus = signal<Focus | null>(null);
  /** Bumped to ask the composer to take keyboard focus. */
  readonly focusRequest = signal(0);

  askAbout(focus: Focus, draft = ''): void {
    this.focus.set(focus);
    if (draft) this.draft.set(draft);
    this.focusRequest.update((n) => n + 1);
  }
}
