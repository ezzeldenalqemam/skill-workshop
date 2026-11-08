import { Injectable, signal } from '@angular/core';

/** Feeds the app's single polite live region, so screen readers hear what changed. */
@Injectable({ providedIn: 'root' })
export class AnnouncerService {
  readonly message = signal('');

  announce(text: string): void {
    // Clearing first makes a repeated message announce again.
    this.message.set('');
    queueMicrotask(() => this.message.set(text));
  }
}
