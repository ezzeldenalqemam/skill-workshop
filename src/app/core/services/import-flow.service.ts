import { inject, Injectable, signal } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { AnnouncerService } from './announcer.service';
import { ClaudeAgentService } from './claude-agent.service';
import { UiStateService } from './ui-state.service';
import { WorkspaceStore } from './workspace.store';
import { ZipService } from './zip.service';

/** "I already have a skill/plugin": open its files as a new project and have Claude explain it. */
@Injectable({ providedIn: 'root' })
export class ImportFlowService {
  private readonly zip = inject(ZipService);
  private readonly store = inject(WorkspaceStore);
  private readonly agent = inject(ClaudeAgentService);
  private readonly ui = inject(UiStateService);
  private readonly announcer = inject(AnnouncerService);
  private readonly i18n = inject(I18nService);

  readonly note = signal<string | null>(null);

  async openAndExplain(picked: File[]): Promise<void> {
    if (!picked.length) return;
    const { files, skipped, hasGit } = await this.zip.import(picked);
    if (!files.length) {
      this.note.set(this.i18n.t('explain.noText'));
      this.announcer.announce(this.note()!);
      return;
    }
    const first = picked[0];
    const sourceName = picked.length === 1 ? first.name.replace(/\.[^.]+$/, '') : (first.webkitRelativePath.split('/')[0] || 'imported');
    this.store.importAsProject(files, /^skill$/i.test(sourceName) ? '' : sourceName, hasGit);
    this.note.set(
      this.i18n.t('explain.opened', { n: files.length }) +
        (skipped.length ? this.i18n.t('spec.skipped', { n: skipped.length }) : '') +
        (hasGit ? this.i18n.t('import.gitSkipped') : ''),
    );
    this.ui.showWorkspace('explain');
    this.announcer.announce(this.note()!);
    if (this.agent.availability() === 'ready') await this.agent.explain();
  }
}
