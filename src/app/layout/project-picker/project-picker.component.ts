import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, Injector, signal, viewChild } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { TPipe } from '../../core/i18n/t.pipe';
import { KIND_LABELS, LibraryOrigin, ProjectSummary } from '../../core/models/project.model';
import { ClaudeAgentService } from '../../core/services/claude-agent.service';
import { LocalSkillsService } from '../../core/services/local-skills.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { focusAfterRender } from '../../shared/focus/focus-after-render';
import { IconComponent } from '../../shared/icon/icon.component';
import { AnchoredPopoverDirective } from '../../shared/popover/anchored-popover.directive';

/**
 * The header's project chooser: a button that opens a panel with three groups. "My projects" rows
 * each have a delete button (it removes the workshop's copy only); "On my computer" and
 * "My saved skills" open a skill as a project.
 */
@Component({
  selector: 'app-project-picker',
  imports: [IconComponent, AnchoredPopoverDirective, TPipe],
  templateUrl: './project-picker.component.html',
  styleUrl: './project-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectPickerComponent {
  readonly store = inject(WorkspaceStore);
  readonly local = inject(LocalSkillsService);
  private readonly agent = inject(ClaudeAgentService);
  private readonly ui = inject(UiStateService);
  private readonly i18n = inject(I18nService);
  private readonly injector = inject(Injector);
  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly kindLabels = KIND_LABELS;
  readonly originLabels: Record<LibraryOrigin, MessageKey> = { code: 'library.code', claude: 'library.claude', workshop: 'library.workshop' };
  /** The project whose delete is waiting for a yes. */
  readonly confirming = signal<string | null>(null);

  /** Saved projects, with an unsaved draft first when one is open. */
  readonly projects = computed<(ProjectSummary & { draft?: boolean })[]>(() => {
    const list = this.store.projects();
    const current = this.store.project();
    if (list.some((p) => p.id === current.id)) return list;
    return [{ id: current.id, name: current.spec.name || this.i18n.t('header.untitled'), kind: current.spec.kind, updatedAt: 0, draft: true }, ...list];
  });

  readonly currentName = computed(() => {
    const p = this.store.project();
    return `${p.spec.name || this.i18n.t('header.untitled')} · ${KIND_LABELS[p.spec.kind]}`;
  });

  async open(id: string): Promise<void> {
    this.close();
    await this.store.open(id);
  }

  async openLocal(name: string): Promise<void> {
    this.close();
    if (await this.local.open(name)) this.ui.showWorkspace('files');
  }

  /** A saved skill opens on its map: drawn straight away only when the user chose that, otherwise offered. */
  async openLibrary(id: string): Promise<void> {
    this.close();
    await this.store.openLibrary(id);
    const project = this.store.project();
    this.ui.showWorkspace('map');
    if (this.ui.autoMap() && !project.map.trim() && project.files.length && this.agent.canRun()) void this.agent.drawMap();
  }

  /** The delete button turns into a yes / cancel pair; focus moves to cancel, the safe choice. */
  askDelete(id: string): void {
    this.confirming.set(id);
    focusAfterRender(this.injector, () => this.host.nativeElement.querySelector<HTMLElement>(`[data-cancel="${id}"]`));
  }

  cancelDelete(id: string): void {
    this.confirming.set(null);
    focusAfterRender(this.injector, () => this.host.nativeElement.querySelector<HTMLElement>(`[data-delete="${id}"]`));
  }

  async confirmDelete(id: string, index: number): Promise<void> {
    this.confirming.set(null);
    await this.store.deleteProjectById(id);
    // Focus stays in the list: on the row that took the deleted one's place.
    focusAfterRender(this.injector, () => {
      const rows = this.host.nativeElement.querySelectorAll<HTMLElement>('.c-picker__open[data-project]');
      return rows[Math.min(index, rows.length - 1)] ?? this.host.nativeElement.querySelector<HTMLElement>('.c-picker__toggle');
    });
  }

  /** When the panel closes with focus inside it (Escape, a click outside), focus goes back to the button. */
  onToggle(event: Event, toggle: HTMLButtonElement): void {
    if ((event as ToggleEvent).newState !== 'closed') return;
    this.confirming.set(null);
    const active = document.activeElement;
    if (!active || active === document.body || this.panel().nativeElement.contains(active)) toggle.focus();
  }

  private close(): void {
    const panel = this.panel().nativeElement;
    if (panel.matches(':popover-open')) panel.hidePopover();
    this.confirming.set(null);
  }
}
