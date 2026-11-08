import { ChangeDetectionStrategy, Component, ElementRef, Injector, computed, inject, signal, viewChild } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { TPipe } from '../../core/i18n/t.pipe';
import { KIND_LABELS, LibraryOrigin } from '../../core/models/project.model';
import { AnnouncerService } from '../../core/services/announcer.service';
import { ClaudeAgentService } from '../../core/services/claude-agent.service';
import { ImportFlowService } from '../../core/services/import-flow.service';
import { PersistenceService } from '../../core/services/persistence.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { AccessibilityPanelComponent } from '../../shared/accessibility-panel/accessibility-panel.component';
import { AppearanceMenuComponent } from '../../shared/appearance-menu/appearance-menu.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog/confirm-dialog.component';
import { focusAfterRender } from '../../shared/focus/focus-after-render';
import { IconComponent } from '../../shared/icon/icon.component';
import { InstallDialogComponent } from '../../shared/install-dialog/install-dialog.component';

@Component({
  selector: 'app-header',
  imports: [IconComponent, AppearanceMenuComponent, AccessibilityPanelComponent, ConfirmDialogComponent, InstallDialogComponent, TPipe],
  templateUrl: './app-header.component.html',
  styleUrl: './app-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppHeaderComponent {
  readonly store = inject(WorkspaceStore);
  readonly agent = inject(ClaudeAgentService);
  readonly persistence = inject(PersistenceService);
  readonly i18n = inject(I18nService);
  private readonly ui = inject(UiStateService);
  private readonly importFlow = inject(ImportFlowService);
  private readonly announcer = inject(AnnouncerService);

  readonly kindLabels = KIND_LABELS;
  readonly originLabels: Record<LibraryOrigin, MessageKey> = { code: 'library.code', claude: 'library.claude', workshop: 'library.workshop' };
  readonly savingSkill = signal(false);
  readonly note = signal<string | null>(null);
  readonly confirmingDelete = signal(false);
  private readonly injector = inject(Injector);
  private readonly deleteButton = viewChild<ElementRef<HTMLButtonElement>>('deleteButton');
  private readonly cancelDelete = viewChild<ElementRef<HTMLButtonElement>>('cancelDelete');

  readonly options = computed(() => {
    const list = this.store.projects();
    const current = this.store.project();
    if (list.some((p) => p.id === current.id)) return list;
    const name = current.spec.name || this.i18n.t('header.untitled');
    return [{ id: current.id, name, kind: current.spec.kind, updatedAt: 0 }, ...list];
  });

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

  async onProjectChange(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    if (value.startsWith('lib:')) await this.store.openLibrary(value.slice(4));
    else await this.store.open(value);
    // A library choice becomes (or reuses) a project; the list then shows that project as chosen.
    select.value = this.store.project().id;
    if (value.startsWith('lib:')) this.showMap();
  }

  /** A skill from the library opens on its map: drawn straight away only when the user chose that, otherwise offered. */
  private showMap(): void {
    const project = this.store.project();
    this.ui.showWorkspace('map');
    if (this.ui.autoMap() && !project.map.trim() && project.files.length && this.agent.canRun()) void this.agent.drawMap();
  }

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
    focusAfterRender(this.injector, () => document.getElementById('project-select'));
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
