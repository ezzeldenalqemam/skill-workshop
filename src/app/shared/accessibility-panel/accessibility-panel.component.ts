import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AccessibilityService, COLOR_FILTERS } from '../../core/services/accessibility.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { AnnouncerService } from '../../core/services/announcer.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { IconComponent } from '../icon/icon.component';
import { AnchoredPopoverDirective } from '../popover/anchored-popover.directive';

/** Same tools as the qAIPlatform header panel: text size, read aloud, colour mode, reset — plus reduced motion. */
@Component({
  selector: 'app-accessibility-panel',
  imports: [IconComponent, AnchoredPopoverDirective, TPipe],
  templateUrl: './accessibility-panel.component.html',
  styleUrl: './accessibility-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccessibilityPanelComponent {
  readonly a11y = inject(AccessibilityService);
  private readonly announcer = inject(AnnouncerService);
  private readonly i18n = inject(I18nService);
  readonly colorSteps = COLOR_FILTERS;

  zoomIn(): void {
    this.a11y.zoomIn();
    this.announcer.announce(this.i18n.t('a11y.sizeAnnounce', { n: this.a11y.zoomPercent() }));
  }

  zoomOut(): void {
    this.a11y.zoomOut();
    this.announcer.announce(this.i18n.t('a11y.sizeAnnounce', { n: this.a11y.zoomPercent() }));
  }

  cycleColor(): void {
    this.a11y.cycleColor();
    this.announcer.announce(this.i18n.t(this.a11y.colorMode().label));
  }

  toggleReadAloud(): void {
    this.a11y.readAloud.update((on) => !on);
    this.announcer.announce(this.i18n.t(this.a11y.readAloud() ? 'a11y.readOn' : 'a11y.readOff'));
  }

  toggleMotion(): void {
    this.a11y.reduceMotion.update((on) => !on);
  }

  reset(): void {
    this.a11y.reset();
    this.announcer.announce(this.i18n.t('a11y.resetDone'));
  }
}
