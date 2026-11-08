import { afterNextRender, Injector } from '@angular/core';

/**
 * Moves focus once Angular has rendered the pending change — e.g. into a form that an `@if` is
 * about to create, or back to a button that is about to reappear. A timer or rAF is not enough:
 * with event coalescing, change detection itself waits for the next frame.
 */
export function focusAfterRender(injector: Injector, target: () => HTMLElement | null | undefined, select = false): void {
  afterNextRender(
    () => {
      const el = target();
      el?.focus();
      if (select && el instanceof HTMLInputElement) el.select();
    },
    { injector },
  );
}
