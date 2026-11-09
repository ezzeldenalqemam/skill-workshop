import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MessageKey } from '../../core/i18n/messages';
import { TPipe } from '../../core/i18n/t.pipe';
import { entryState, LibraryEntry, LibraryOrigin } from '../../core/models/project.model';
import { ClaudeAgentService } from '../../core/services/claude-agent.service';
import { ImportFlowService } from '../../core/services/import-flow.service';
import { LocalSkillsService } from '../../core/services/local-skills.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { DropZoneComponent } from '../../shared/drop-zone/drop-zone.component';
import { IconComponent } from '../../shared/icon/icon.component';

/**
 * What a new tab opens on: the user's saved skills first, to open or have explained, then bringing in
 * a skill from a file, and building a new one from a brief last.
 */
@Component({
  selector: 'app-start-panel',
  imports: [IconComponent, DropZoneComponent, TPipe],
  templateUrl: './start-panel.component.html',
  styleUrl: './start-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartPanelComponent {
  readonly store = inject(WorkspaceStore);
  readonly agent = inject(ClaudeAgentService);
  readonly importFlow = inject(ImportFlowService);
  readonly local = inject(LocalSkillsService);
  private readonly ui = inject(UiStateService);

  readonly originLabels: Record<LibraryOrigin, MessageKey> = { code: 'library.code', claude: 'library.claude', workshop: 'library.workshop' };

  stateKey(entry: LibraryEntry): MessageKey {
    return `start.state.${entryState(entry)}` as MessageKey;
  }

  stateOf(entry: LibraryEntry): string {
    return entryState(entry);
  }

  /** Opens a skill straight from the computer's skills folder; edits are written back there. */
  async openLocal(name: string): Promise<void> {
    if (await this.local.open(name)) this.ui.showWorkspace('files');
  }

  async open(entry: LibraryEntry): Promise<void> {
    await this.store.openLibrary(entry.id);
    this.ui.showWorkspace('files');
  }

  /** Spends one Claude request; the button says so. */
  async openAndExplain(entry: LibraryEntry): Promise<void> {
    await this.store.openLibrary(entry.id);
    this.ui.showWorkspace('explain');
    if (!this.store.project().explanation && this.agent.canRun()) await this.agent.explain();
  }

  /** Building from a brief happens in the sidebar: show it and put the cursor in the idea. */
  startFromBrief(): void {
    this.ui.showSide('spec');
    setTimeout(() => document.getElementById('spec-idea')?.focus());
  }
}
