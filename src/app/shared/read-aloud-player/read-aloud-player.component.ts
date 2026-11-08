import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, ElementRef, inject, signal, viewChild } from '@angular/core';
import { AccessibilityService } from '../../core/services/accessibility.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { IconComponent } from '../icon/icon.component';

/** Floating transport that appears while read-aloud is on and the viewer has text selected. */
@Component({
  selector: 'app-read-aloud-player',
  imports: [IconComponent, TPipe],
  templateUrl: './read-aloud-player.component.html',
  styleUrl: './read-aloud-player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReadAloudPlayerComponent {
  readonly a11y = inject(AccessibilityService);
  readonly selection = signal('');
  readonly visible = computed(() => this.a11y.readAloud() && (!!this.selection() || this.a11y.speaking()));
  private readonly playButton = viewChild<ElementRef<HTMLButtonElement>>('playButton');
  /** Where focus was before it entered the player, so closing it does not drop focus to <body>. */
  private returnFocus: HTMLElement | null = null;

  private timer?: ReturnType<typeof setTimeout>;
  private readonly onFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLElement;
    if (!target.closest('.c-player')) this.returnFocus = target;
  };

  private readonly onSelection = () => {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const text = this.readSelection();
      // Keep the last selection while the viewer clicks the player itself.
      if (text) this.selection.set(text);
      else if (!this.a11y.speaking()) this.selection.set('');
    }, 250);
  };

  constructor() {
    document.addEventListener('selectionchange', this.onSelection);
    document.addEventListener('focusin', this.onFocusIn);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('selectionchange', this.onSelection);
      document.removeEventListener('focusin', this.onFocusIn);
    });
    effect(() => {
      if (!this.a11y.readAloud()) this.selection.set('');
    });
  }

  play(): void {
    if (this.a11y.speaking()) this.a11y.togglePause();
    else this.a11y.speak(this.selection());
  }

  /** Stop disables itself, so focus moves to Play first. */
  stop(): void {
    this.playButton()?.nativeElement.focus();
    this.a11y.stopSpeaking();
  }

  close(): void {
    const back = this.returnFocus?.isConnected ? this.returnFocus : document.getElementById('main');
    this.a11y.stopSpeaking();
    this.selection.set('');
    document.getSelection()?.removeAllRanges();
    back?.focus();
  }

  /** Text selected in the page, or inside a focused textarea/input (their selection is not in the DOM). */
  private readSelection(): string {
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement || (active instanceof HTMLInputElement && active.type === 'text')) {
      const { selectionStart, selectionEnd, value } = active;
      if (selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart) {
        return value.slice(selectionStart, selectionEnd).trim();
      }
    }
    return document.getSelection()?.toString().trim() ?? '';
  }
}
