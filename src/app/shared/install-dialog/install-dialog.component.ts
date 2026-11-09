import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { TPipe } from '../../core/i18n/t.pipe';
import { slugify } from '../../core/models/project.model';
import { AnnouncerService } from '../../core/services/announcer.service';
import { LocalSkillsService } from '../../core/services/local-skills.service';
import { PersistenceService } from '../../core/services/persistence.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { ZipService } from '../../core/services/zip.service';
import { IconComponent } from '../icon/icon.component';

/**
 * The way from the workshop into Claude: save to "my skills", download the ZIP, install it in
 * claude.ai or Claude Code, then mark it installed so the workshop knows that version is live.
 * The page cannot install by itself, so each step says exactly where to go.
 */
@Component({
  selector: 'app-install-dialog',
  imports: [IconComponent, TPipe],
  templateUrl: './install-dialog.component.html',
  styleUrl: './install-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstallDialogComponent {
  readonly store = inject(WorkspaceStore);
  readonly persistence = inject(PersistenceService);
  readonly local = inject(LocalSkillsService);
  readonly localExists = signal(false);
  private readonly zip = inject(ZipService);
  private readonly i18n = inject(I18nService);
  private readonly announcer = inject(AnnouncerService);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly closeButton = viewChild.required<ElementRef<HTMLButtonElement>>('closeButton');
  private returnTo: HTMLElement | null = null;

  readonly busy = signal<'save' | 'download' | 'mark' | null>(null);
  readonly note = signal<string | null>(null);
  readonly copied = signal(false);

  readonly state = this.store.syncState;
  readonly stateLabel = computed(() => `sync.${this.state()}` as MessageKey);
  readonly folder = computed(() => slugify(this.store.project().spec.name, 'my-skill'));
  readonly codePath = computed(() => `~/.claude/skills/${this.folder()}/`);
  /** Saving first keeps the library copy, the ZIP and the "installed" mark on the same version. */
  readonly needsSave = computed(() => this.persistence.libraryAvailable() && (this.state() === 'notSaved' || this.state() === 'unsaved'));
  readonly canMark = computed(() => this.persistence.libraryAvailable() && (this.state() === 'new' || this.state() === 'changed'));

  open(): void {
    this.returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.note.set(null);
    this.copied.set(false);
    this.dialog().nativeElement.showModal();
    this.closeButton().nativeElement.focus();
  }

  close(): void {
    const dialog = this.dialog().nativeElement;
    if (dialog.open) dialog.close();
    this.returnTo?.focus();
    this.returnTo = null;
  }

  onCancelEvent(event: Event): void {
    event.preventDefault();
    this.close();
  }

  onClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.close();
  }

  async save(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('save');
    const result = await this.store.saveToLibrary();
    this.busy.set(null);
    this.say(`library.${result}` as MessageKey);
  }

  async download(): Promise<void> {
    if (this.busy()) return;
    if (!this.store.files().length) {
      this.say('download.empty');
      return;
    }
    this.busy.set('download');
    const result = await this.zip.export(this.store.project());
    this.busy.set(null);
    this.say(result === 'saved' ? 'download.done' : result === 'declined' ? 'download.declined' : 'download.unavailable');
  }

  /** Writes the skill into Claude Code's skills folder on this computer; later edits follow it there. */
  async saveLocal(overwrite: boolean): Promise<void> {
    if (this.busy()) return;
    this.busy.set('download');
    const result = await this.local.saveAs(this.folder(), overwrite);
    this.busy.set(null);
    this.localExists.set(result === 'exists');
    if (result === 'saved') this.say('install.localSaved');
    else if (result !== 'exists') this.say('install.localFailed');
  }

  async markInstalled(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('mark');
    const ok = await this.store.markInstalled();
    this.busy.set(null);
    this.say(ok ? 'install.marked' : 'library.failed');
  }

  /** Clipboard writes can be refused in some viewers; the path stays selectable either way. */
  async copyPath(field: HTMLInputElement): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.codePath());
      this.copied.set(true);
      this.announcer.announce(this.i18n.t('install.copied'));
    } catch {
      field.select();
    }
  }

  private say(key: MessageKey): void {
    const text = this.i18n.t(key);
    this.note.set(text);
    this.announcer.announce(text);
  }
}
