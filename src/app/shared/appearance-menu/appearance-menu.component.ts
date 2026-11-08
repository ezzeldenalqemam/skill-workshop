import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { Lang } from '../../core/i18n/messages';
import { TPipe } from '../../core/i18n/t.pipe';
import {
  Accent,
  ACCENTS,
  AppearanceService,
  COLOR_MODES,
  ColorMode,
} from '../../core/services/appearance.service';
import { ClaudeAgentService } from '../../core/services/claude-agent.service';
import { IconComponent } from '../icon/icon.component';
import { AnchoredPopoverDirective } from '../popover/anchored-popover.directive';

/** One settings menu for the header: interface language, colour mode, accent, and starting over. */
@Component({
  selector: 'app-appearance-menu',
  imports: [IconComponent, AnchoredPopoverDirective, TPipe],
  templateUrl: './appearance-menu.component.html',
  styleUrl: './appearance-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppearanceMenuComponent {
  readonly appearance = inject(AppearanceService);
  readonly i18n = inject(I18nService);
  private readonly agent = inject(ClaudeAgentService);
  readonly modes = COLOR_MODES;
  readonly accents = ACCENTS;
  /** Each language is named in itself. */
  readonly langs: { value: Lang; label: string }[] = [
    { value: 'ar', label: 'العربية' },
    { value: 'en', label: 'English' },
  ];
  readonly resetRequested = output<void>();

  setMode(value: ColorMode): void {
    this.appearance.mode.set(value);
  }

  setAccent(value: Accent): void {
    this.appearance.accent.set(value);
  }

  /** The page flips at once; a kept translation of the map comes back for free, a new one is offered, never spent. */
  setLang(value: Lang): void {
    if (this.i18n.lang() === value) return;
    this.i18n.toggle();
    this.agent.followLanguage();
  }
}
