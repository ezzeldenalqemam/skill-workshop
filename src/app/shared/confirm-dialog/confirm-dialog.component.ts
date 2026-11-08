import { ChangeDetectionStrategy, Component, ElementRef, input, output, viewChild } from '@angular/core';
import { TPipe } from '../../core/i18n/t.pipe';
import { IconComponent } from '../icon/icon.component';

/**
 * Modal confirmation for destructive actions. The viewer blocks `confirm()`, so this uses a native
 * `<dialog>`: showModal() makes the page behind it inert, Esc cancels, and focus goes back to
 * whatever opened it.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [IconComponent, TPipe],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
  readonly dialogId = input.required<string>();
  readonly heading = input.required<string>();
  readonly message = input.required<string>();
  readonly confirmLabel = input.required<string>();
  readonly confirmed = output<void>();

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly cancelButton = viewChild.required<ElementRef<HTMLButtonElement>>('cancelButton');
  private returnTo: HTMLElement | null = null;
  private settled = true;

  open(): void {
    this.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.settled = false;
    this.dialog().nativeElement.showModal();
    // The safe choice takes focus first.
    this.cancelButton().nativeElement.focus();
  }

  cancel(): void {
    this.finish(false);
  }

  confirm(): void {
    this.finish(true);
  }

  /** Esc: handled here rather than left to the browser, so the outcome never waits on the async close event. */
  onCancelEvent(event: Event): void {
    event.preventDefault();
    this.finish(false);
  }

  /** A click that lands on the dialog element itself is on the backdrop. */
  onClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.finish(false);
  }

  /** Fallback for any other way the dialog closes. */
  onClosed(): void {
    this.finish(false);
  }

  private finish(accepted: boolean): void {
    if (this.settled) return;
    this.settled = true;
    const dialog = this.dialog().nativeElement;
    if (dialog.open) dialog.close();
    this.returnTo?.focus();
    this.returnTo = null;
    if (accepted) this.confirmed.emit();
  }
}
