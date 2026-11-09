import { ChangeDetectionStrategy, Component, ElementRef, Injector, computed, inject, signal, viewChild } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { TPipe } from '../../core/i18n/t.pipe';
import { AnnouncerService } from '../../core/services/announcer.service';
import { ClaudeAgentService } from '../../core/services/claude-agent.service';
import { ImportFlowService } from '../../core/services/import-flow.service';
import { LocalSkillsService } from '../../core/services/local-skills.service';
import { PersistenceService } from '../../core/services/persistence.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { AccessibilityPanelComponent } from '../../shared/accessibility-panel/accessibility-panel.component';
import { AppearanceMenuComponent } from '../../shared/appearance-menu/appearance-menu.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { focusAfterRender } from '../../shared/focus/focus-after-render';
import { IconComponent } from '../../shared/icon/icon.component';
import { InstallDialogComponent } from '../../shared/install-dialog/install-dialog.component';
import { ProjectPickerComponent } from '../project-picker/project-picker.component';
import { RefreshMenuComponent } from '../refresh-menu/refresh-menu.component';

@Component({
  selector: 'app-header',
  imports: [IconComponent, AppearanceMenuComponent, AccessibilityPanelComponent, ConfirmDialogComponent, InstallDialogComponent, ProjectPickerComponent, RefreshMenuComponent, TPipe],
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppHeaderComponent {
  readonly store = inject(WorkspaceStore);
  readonly agent = inject(ClaudeAgentService);
  readonly persistence = inject(PersistenceService);
  readonly i18n = inject(I18nService);
  readonly local = inject(LocalSkillsService);
  private readonly importFlow = inject(ImportFlowService);
  private readonly announcer = inject(AnnouncerService);

  readonly savingSkill = signal(false);
  readonly note = signal<string | null>(null);
  readonly confirmingDelete = signal(false);
  private readonly injector = inject(Injector);
  private readonly deleteButton = viewChild<ElementRef<HTMLButtonElement>>('deleteButton');
  private readonly cancelDelete = viewChild<ElementRef<HTMLButtonElement>>('cancelDelete');

  readonly localLabel = computed(() => `local.${this.local.sync()}` as MessageKey);
  readonly syncLabel = computed(() => `sync.${this.store.syncState()}` as MessageKey);
  /** Something is left before Claude has this exact version. */
  readonly syncPending = computed(() => ['notSaved', 'unsaved', 'new', 'changed'].includes(this.store.syncState()));

  readonly claudeLabel = computed<MessageKey>(() => {
    switch (this.agent.availability()) {
      case 'ready':
        return 'claude.ready';
      case 'checking':
        return 'claude.checking';
      case 'denied':
        return 'claude.denied';
      default:
        return 'claude.unavailable';
    }
  });

  readonly saveLabel = computed(() => {
    if (this.store.project().isDraft) return this.i18n.t('save.draft');
    switch (this.store.saveState()) {
      case 'pending':
      case 'saving':
        return this.i18n.t('save.saving');
      case 'error':
        return this.persistence.lastError() ?? this.i18n.t('save.error');
      default:
        return this.i18n.t(this.persistence.mode() === 'account' ? 'save.account' : 'save.browser');
    }
  });

  /** Saves the open skill to the library: an update when it came from there, otherwise a new entry. */
  async saveSkill(): Promise<void> {
    if (this.savingSkill()) return;
    if (!this.store.files().length) {
      this.flash(this.i18n.t('library.empty'));
      return;
    }
    this.savingSkill.set(true);
    const result = await this.store.saveToLibrary();
    this.savingSkill.set(false);
    this.flash(this.i18n.t(`library.${result}` as MessageKey));
  }

  onOpen(event: Event): void {
    const field = event.target as HTMLInputElement;
    const files = Array.from(field.files ?? []);
    field.value = '';
    void this.importFlow.openAndExplain(files);
  }

  /** The trash button leaves the DOM, so focus moves to the safe choice in the confirm row. */
  askDelete(): void {
    this.confirmingDelete.set(true);
    focusAfterRender(this.injector, () => this.cancelDelete()?.nativeElement);
  }

  cancelDeleteProject(): void {
    this.confirmingDelete.set(false);
    focusAfterRender(this.injector, () => this.deleteButton()?.nativeElement);
  }

  async deleteProject(): Promise<void> {
    this.confirmingDelete.set(false);
    await this.store.deleteProject();
    focusAfterRender(this.injector, () => document.querySelector<HTMLElement>('.c-picker__toggle'));
  }

  /** Stops any Claude run first, so it cannot write into the project being wiped. */
  async resetAll(): Promise<void> {
    this.agent.stop();
    this.confirmingDelete.set(false);
    await this.store.resetAll();
  }

  private flash(note: string): void {
    this.note.set(note);
    this.announcer.announce(note);
    setTimeout(() => this.note.set(null), 4000);
  }
}
