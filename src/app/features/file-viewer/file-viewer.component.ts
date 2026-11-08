import { ChangeDetectionStrategy, Component, ElementRef, Injector, computed, effect, inject, signal, viewChild } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { I18nService } from '../../core/i18n/i18n.service';
import { AnnouncerService } from '../../core/services/announcer.service';
import { ClaudeAgentService } from '../../core/services/claude-agent.service';
import { ComposerService } from '../../core/services/composer.service';
import { MarkdownService } from '../../core/services/markdown.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { TPipe } from '../../core/i18n/t.pipe';
import { focusAfterRender } from '../../shared/focus/focus-after-render';
import { IconComponent } from '../../shared/icon/icon.component';

type ViewMode = 'edit' | 'preview';

interface MetaField {
  key: string;
  value: string;
}

@Component({
  selector: 'app-file-viewer',
  imports: [IconComponent, TPipe],
  templateUrl: './file-viewer.component.html',
  styleUrl: './file-viewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileViewerComponent {
  readonly store = inject(WorkspaceStore);
  readonly agent = inject(ClaudeAgentService);
  private readonly composer = inject(ComposerService);
  private readonly announcer = inject(AnnouncerService);
  private readonly i18n = inject(I18nService);
  private readonly markdown = inject(MarkdownService);

  readonly editor = viewChild<ElementRef<HTMLTextAreaElement>>('editor');
  private readonly injector = inject(Injector);
  private readonly renameButton = viewChild<ElementRef<HTMLButtonElement>>('renameButton');
  private readonly deleteButton = viewChild<ElementRef<HTMLButtonElement>>('deleteButton');
  private readonly cancelDeleteButton = viewChild<ElementRef<HTMLButtonElement>>('cancelDeleteButton');
  readonly mode = signal<ViewMode>('preview');
  readonly confirmingDelete = signal(false);
  readonly renaming = signal(false);
  readonly renameError = signal<string | null>(null);
  readonly preview = signal<SafeHtml | null>(null);
  readonly frontmatter = signal<string | null>(null);

  readonly file = this.store.selectedFile;
  readonly isMarkdown = computed(() => /\.(md|markdown)$/i.test(this.file()?.path ?? ''));
  readonly lineCount = computed(() => (this.file()?.content.match(/\n/g)?.length ?? 0) + 1);
  readonly effectiveMode = computed<ViewMode>(() => (this.isMarkdown() ? this.mode() : 'edit'));
  /** Simple `key: value` frontmatter shows as labelled fields; anything nested falls back to the raw block. */
  readonly metaFields = computed(() => parseFrontmatter(this.frontmatter()));
  /** Direction of the file's first strong letter, so the metadata card lines up with the text below it. */
  readonly contentDir = computed(() => {
    const body = (this.file()?.content ?? '').replace(/^---[\s\S]*?\n---/, '');
    const first = /[A-Za-z֐-ࣿ]/.exec(body)?.[0] ?? '';
    return /[֐-ࣿ]/.test(first) ? 'rtl' : 'ltr';
  });

  /** The latest thing Claude did in the running reply, shown under the loading line. */
  readonly lastStep = computed(() => {
    if (!this.agent.running()) return null;
    const reply = this.store.project().chat.at(-1);
    const step = reply?.role === 'assistant' ? reply.activity?.at(-1) : undefined;
    return step ? this.i18n.t(`act.${step.kind}` as const, { path: step.path ?? '' }) : null;
  });

  constructor() {
    effect(() => {
      // Leaving a file drops any half-finished delete or rename on it.
      this.file()?.path;
      this.confirmingDelete.set(false);
      this.renaming.set(false);
    });

    effect(() => {
      const file = this.file();
      if (!file || !this.isMarkdown() || this.effectiveMode() !== 'preview') return;
      void this.renderMarkdown(file.content);
    });
  }

  isKnownKey(key: string): key is 'name' | 'description' {
    return key === 'name' || key === 'description';
  }

  /** Known frontmatter keys get a translated label; others show as written. */
  metaLabel(key: string): string {
    return this.isKnownKey(key) ? this.i18n.t(`viewer.fm.${key}`) : key;
  }

  onEdit(event: Event): void {
    const path = this.file()?.path;
    if (path) this.store.writeFile(path, (event.target as HTMLTextAreaElement).value);
  }

  /** Tab inserts two spaces instead of leaving the editor; Escape still lets keyboard users out. */
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
    const area = event.target as HTMLTextAreaElement;
    if (area.dataset['tabTrap'] === 'off') return;
    event.preventDefault();
    area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  onEscape(event: Event): void {
    (event.target as HTMLTextAreaElement).dataset['tabTrap'] = 'off';
  }

  onEditorFocus(event: Event): void {
    (event.target as HTMLTextAreaElement).dataset['tabTrap'] = 'on';
  }

  askAboutSelection(): void {
    const file = this.file();
    if (!file) return;
    const area = this.editor()?.nativeElement;
    let selection = '';
    if (area && area.selectionEnd > area.selectionStart) selection = area.value.slice(area.selectionStart, area.selectionEnd);
    else selection = document.getSelection()?.toString() ?? '';
    this.composer.askAbout(
      { path: file.path, selection: selection.trim() || undefined },
      selection.trim() ? this.i18n.t('viewer.draftSel') : this.i18n.t('viewer.draftFile', { path: file.path }),
    );
  }

  startRename(): void {
    this.renameError.set(null);
    this.renaming.set(true);
    focusAfterRender(this.injector, () => document.getElementById('rename-input'), true);
  }

  submitRename(event: Event): void {
    event.preventDefault();
    const file = this.file();
    const field = (event.target as HTMLFormElement).elements.namedItem('rename-input') as HTMLInputElement;
    if (!file) return;
    if (field.value.trim() === file.path) {
      this.closeRename();
      return;
    }
    const to = this.store.renameFile(file.path, field.value);
    if (!to) {
      this.renameError.set(this.i18n.t('viewer.renameError'));
      return;
    }
    this.closeRename();
    this.announcer.announce(this.i18n.t('viewer.renamed', { path: to }));
  }

  /** The form replaces the heading; closing it returns focus to the Rename button. */
  closeRename(): void {
    this.renaming.set(false);
    focusAfterRender(this.injector, () => this.renameButton()?.nativeElement);
  }

  /** The Delete button leaves the DOM, so focus moves to the safe choice in the confirm row. */
  askDelete(): void {
    this.confirmingDelete.set(true);
    focusAfterRender(this.injector, () => this.cancelDeleteButton()?.nativeElement);
  }

  cancelDelete(): void {
    this.confirmingDelete.set(false);
    focusAfterRender(this.injector, () => this.deleteButton()?.nativeElement);
  }

  deleteFile(): void {
    const path = this.file()?.path;
    if (!path) return;
    this.store.deleteFile(path);
    this.confirmingDelete.set(false);
    this.announcer.announce(this.i18n.t('viewer.deleted', { path }));
    // The viewer now shows another file (or none); continue from the tree.
    focusAfterRender(this.injector, () => document.querySelector<HTMLElement>('.c-tree__row.is-selected') ?? document.getElementById('main'));
  }

  private async renderMarkdown(source: string): Promise<void> {
    const { html, frontmatter } = await this.markdown.render(source);
    this.frontmatter.set(frontmatter);
    this.preview.set(html);
  }
}

function parseFrontmatter(source: string | null): MetaField[] | null {
  if (!source) return null;
  const fields: MetaField[] = [];
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const field = /^([\w-]+):\s*(.*)$/.exec(line);
    if (field) fields.push({ key: field[1], value: field[2] });
    else if (/^\s+\S/.test(line) && fields.length && !/^\s*-\s/.test(line)) fields.at(-1)!.value += ' ' + line.trim();
    else return null;
  }
  for (const field of fields) {
    field.value = field.value.replace(/^[>|]-?\s*/, '').trim();
    if (/^(["']).*\1$/.test(field.value)) field.value = field.value.slice(1, -1);
    if (!field.value) return null;
  }
  return fields.length ? fields : null;
}
