import { ChangeDetectionStrategy, Component, ElementRef, inject, output, signal, viewChild } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { AnnouncerService } from '../../core/services/announcer.service';
import { LocalSkillsService } from '../../core/services/local-skills.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { IconComponent } from '../../shared/icon/icon.component';
import { AnchoredPopoverDirective } from '../../shared/popover/anchored-popover.directive';

/**
 * The header's refresh button: read everything again (projects, saved skills, the computer's
 * skills folder), or start over by deleting everything (that asks first, in a dialog).
 */
@Component({
  selector: 'app-refresh-menu',
  imports: [IconComponent, AnchoredPopoverDirective, TPipe],
  templateUrl: './refresh-menu.component.html',
  styleUrl: './refresh-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RefreshMenuComponent {
  private readonly store = inject(WorkspaceStore);
  private readonly local = inject(LocalSkillsService);
  private readonly announcer = inject(AnnouncerService);
  private readonly i18n = inject(I18nService);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');

  readonly resetRequested = output<void>();
  readonly busy = signal(false);

  async refresh(toggle: HTMLButtonElement): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.store.refresh();
      await this.local.recheck();
      this.announcer.announce(this.i18n.t('refresh.done'));
    } catch {
      this.announcer.announce(this.i18n.t('refresh.failed'));
    } finally {
      this.busy.set(false);
      this.hide();
      toggle.focus();
    }
  }

  startOver(): void {
    this.hide();
    this.resetRequested.emit();
  }

  /** Focus goes back to the button when the panel closes with focus inside it. */
  onToggle(event: Event, toggle: HTMLButtonElement): void {
    if ((event as ToggleEvent).newState !== 'closed') return;
    const active = document.activeElement;
    if (!active || active === document.body || this.panel().nativeElement.contains(active)) toggle.focus();
  }

  private hide(): void {
    const panel = this.panel().nativeElement;
    if (panel.matches(':popover-open')) panel.hidePopover();
  }
}
