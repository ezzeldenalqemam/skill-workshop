import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from '@angular/core';

/** Shown after this long under a resting mouse; keyboard focus shows it at once. */
const HOVER_DELAY = 350;
/** Time to move the pointer from the control onto the tooltip without it closing (WCAG 1.4.13 hoverable). */
const HIDE_DELAY = 150;
const GAP = 8;

/**
 * One styled tooltip for the whole page. Any element with a `title` gets it on hover or keyboard
 * focus; the native `title` is held back while it shows, so there is never a second, browser tooltip.
 * Escape hides it, the pointer can move onto it, and it stays until focus or the pointer leaves.
 * It repeats the control's name visually only (the controls are already named), so it is aria-hidden.
 */
@Component({
  selector: 'app-tooltip-host',
  template: `<div #tip class="c-tip" aria-hidden="true" [class.is-open]="text()" [attr.data-side]="side()" (pointerenter)="keep()" (pointerleave)="hideSoon()"><span dir="auto">{{ text() }}</span></div>`,
  styleUrl: './tooltip-host.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TooltipHostComponent {
  private readonly tip = viewChild.required<ElementRef<HTMLElement>>('tip');
  readonly text = signal('');
  readonly side = signal<'below' | 'above'>('below');

  private target: HTMLElement | null = null;
  private showTimer?: ReturnType<typeof setTimeout>;
  private hideTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = this.holder(e.target);
      if (!el) return;
      this.keep();
      if (el === this.target) return;
      clearTimeout(this.showTimer);
      this.showTimer = setTimeout(() => this.show(el), this.text() ? 0 : HOVER_DELAY);
    };
    const out = (e: PointerEvent) => {
      const el = this.holder(e.target);
      if (!el) return;
      clearTimeout(this.showTimer);
      if (el.contains(e.relatedTarget as Node | null)) return;
      this.hideSoon();
    };
    const focusIn = (e: FocusEvent) => {
      const el = this.holder(e.target);
      if (el && el.matches(':focus-visible')) this.show(el);
    };
    const focusOut = (e: FocusEvent) => {
      if (this.holder(e.target) === this.target) this.hide();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.text()) this.hide();
    };
    const away = () => this.hide();
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focusIn);
    document.addEventListener('focusout', focusOut);
    document.addEventListener('keydown', key, true);
    document.addEventListener('click', away, true);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focusIn);
      document.removeEventListener('focusout', focusOut);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('click', away, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
    });
  }

  keep(): void {
    clearTimeout(this.hideTimer);
  }

  hideSoon(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hide(), HIDE_DELAY);
  }

  /** The nearest element with a title (or one whose title we are holding back). */
  private holder(node: EventTarget | null): HTMLElement | null {
    return (node instanceof Element ? node.closest<HTMLElement>('[title], [data-tip]') : null) ?? null;
  }

  private show(el: HTMLElement): void {
    const text = (el.getAttribute('title') ?? el.dataset['tip'] ?? '').trim();
    if (!text) return;
    if (this.target && this.target !== el) this.restore(this.target);
    // Hold back the native title so the browser does not show its own tooltip on top.
    if (el.hasAttribute('title')) {
      el.dataset['tip'] = text;
      el.removeAttribute('title');
    }
    this.target = el;
    this.text.set(text);
    // Measured after the next frame, once the new text is on screen.
    requestAnimationFrame(() => {
      if (this.target === el) this.place(el);
    });
  }

  private hide(): void {
    clearTimeout(this.showTimer);
    clearTimeout(this.hideTimer);
    if (this.target) this.restore(this.target);
    this.target = null;
    this.text.set('');
  }

  private restore(el: HTMLElement): void {
    const text = el.dataset['tip'];
    if (text && !el.hasAttribute('title')) el.setAttribute('title', text);
    delete el.dataset['tip'];
  }

  /** Under the control, centred; above it when there is no room below; always inside the window. */
  private place(el: HTMLElement): void {
    const tip = this.tip().nativeElement;
    const box = el.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    const below = box.bottom + GAP + size.height <= window.innerHeight - 4;
    this.side.set(below ? 'below' : 'above');
    const top = below ? box.bottom + GAP : box.top - GAP - size.height;
    const left = Math.min(Math.max(4, box.left + box.width / 2 - size.width / 2), window.innerWidth - size.width - 4);
    // inset-inline-start follows the page direction: measured from the right edge in Arabic.
    const rtl = getComputedStyle(tip).direction === 'rtl';
    tip.style.insetBlockStart = `${Math.round(top)}px`;
    tip.style.insetInlineStart = `${Math.round(rtl ? window.innerWidth - left - size.width : left)}px`;
  }
}
