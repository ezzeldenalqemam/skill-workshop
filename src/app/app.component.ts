import { ChangeDetectionStrategy, Component, effect, ElementRef, inject, OnInit, untracked, viewChildren } from '@angular/core';
import { I18nService } from './core/i18n/i18n.service';
import { MessageKey } from './core/i18n/messages';
import { TPipe } from './core/i18n/t.pipe';
import { AccessibilityService } from './core/services/accessibility.service';
import { AnnouncerService } from './core/services/announcer.service';
import { AppearanceService } from './core/services/appearance.service';
import { ClaudeAgentService } from './core/services/claude-agent.service';
import { LocalSkillsService } from './core/services/local-skills.service';
import { SideTab, UiStateService } from './core/services/ui-state.service';
import { WorkspaceStore } from './core/services/workspace.store';
import { ChatPanelComponent } from './features/chat-panel/chat-panel.component';
import { SpecPanelComponent } from './features/spec-panel/spec-panel.component';
import { WorkspaceComponent } from './features/workspace/workspace.component';
import { AppHeaderComponent } from './layout/app-header/app-header.component';
import { ProjectTabsComponent } from './layout/project-tabs/project-tabs.component';
import { IconComponent } from './shared/icon/icon.component';
import { ReadAloudPlayerComponent } from './shared/read-aloud-player/read-aloud-player.component';
import { TooltipHostComponent } from './shared/tooltip/tooltip-host.component';

type PhoneButton = 'spec' | 'work' | 'chat';

@Component({
  selector: 'app-root',
  imports: [AppHeaderComponent, ProjectTabsComponent, SpecPanelComponent, WorkspaceComponent, ChatPanelComponent, ReadAloudPlayerComponent, TooltipHostComponent, IconComponent, TPipe],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent implements OnInit {
  readonly announcer = inject(AnnouncerService);
  readonly ui = inject(UiStateService);
  private readonly store = inject(WorkspaceStore);
  private readonly agent = inject(ClaudeAgentService);
  private readonly local = inject(LocalSkillsService);
  private readonly sideTabButtons = viewChildren<ElementRef<HTMLButtonElement>>('sideTabButton');

  readonly sideTabs: { id: SideTab; label: MessageKey; icon: string }[] = [
    { id: 'spec', label: 'app.view.spec', icon: 'layers' },
    { id: 'chat', label: 'app.view.chat', icon: 'message' },
  ];
  readonly phoneButtons: { id: PhoneButton; label: MessageKey; icon: string }[] = [
    { id: 'spec', label: 'app.view.spec', icon: 'layers' },
    { id: 'work', label: 'app.view.work', icon: 'file' },
    { id: 'chat', label: 'app.view.chat', icon: 'message' },
  ];

  constructor() {
    // Created eagerly so saved language, theme and accessibility settings apply before first paint.
    inject(I18nService);
    inject(AppearanceService);
    inject(AccessibilityService);

    // When Claude starts working, show the conversation so its progress is visible.
    effect(() => {
      if (this.agent.running()) untracked(() => this.ui.sideTab.set('chat'));
    });
  }

  ngOnInit(): void {
    void this.store.init();
    void this.agent.init();
    void this.local.init();
  }

  isPhonePressed(id: PhoneButton): boolean {
    if (id === 'work') return this.ui.phoneView() === 'work';
    return this.ui.phoneView() === 'side' && this.ui.sideTab() === id;
  }

  showPhone(id: PhoneButton): void {
    if (id === 'work') this.ui.phoneView.set('work');
    else this.ui.showSide(id);
  }

  /** Arrow keys move between the sidebar tabs, Home/End jump to the ends. */
  onSideTabKey(event: KeyboardEvent, index: number): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const rtl = getComputedStyle(event.target as Element).direction === 'rtl';
    const step: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, Home: -index, End: this.sideTabs.length - 1 - index };
    if (!(event.key in step)) return;
    event.preventDefault();
    const next = (index + step[event.key] + this.sideTabs.length) % this.sideTabs.length;
    this.ui.sideTab.set(this.sideTabs[next].id);
    this.sideTabButtons()[next]?.nativeElement.focus();
  }
}
