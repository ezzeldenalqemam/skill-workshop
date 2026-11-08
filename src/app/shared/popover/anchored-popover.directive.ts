import { Directive, ElementRef, HostListener, inject, input } from '@angular/core';

/**
 * Pins a native `popover` element under the button that opened it, aligned to the button's
 * inline-end edge in either direction, and moves focus into it when it opens.
 */
@Directive({
  selector: '[appAnchoredPopover]',
  host: { popover: 'auto' },
})
export class AnchoredPopoverDirective {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly anchor = input.required<HTMLElement>({ alias: 'appAnchoredPopover' });

  /** Positioned before it shows, so it never paints a frame in the default centred spot. */
  @HostListener('beforetoggle', ['$event'])
  onBeforeToggle(event: Event): void {
    if ((event as Event & { newState?: string }).newState === 'open') this.place();
  }

  @HostListener('toggle', ['$event'])
  onToggle(event: Event): void {
    if ((event as Event & { newState?: string }).newState !== 'open') return;
    const root = this.el.nativeElement;
    const target =
      root.querySelector<HTMLElement>('input:checked') ??
      root.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled]), [tabindex="0"]');
    target?.focus();
  }

  @HostListener('window:resize')
  onResize(): void {
    if (this.el.nativeElement.matches(':popover-open')) this.place();
  }

  private place(): void {
    const rect = this.anchor().getBoundingClientRect();
    const rtl = getComputedStyle(this.anchor()).direction === 'rtl';
    const gap = 8;
    const fromEnd = rtl ? rect.left : window.innerWidth - rect.right;
    Object.assign(this.el.nativeElement.style, {
      insetBlockStart: `${rect.bottom + gap}px`,
      insetInlineEnd: `${Math.max(8, fromEnd)}px`,
      insetInlineStart: 'auto',
      insetBlockEnd: 'auto',
    });
  }
}
