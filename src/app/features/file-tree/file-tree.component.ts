import { ChangeDetectionStrategy, Component, ElementRef, Injector, computed, inject, signal, viewChild } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { AnnouncerService } from '../../core/services/announcer.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { ZipService } from '../../core/services/zip.service';
import { imageMime } from '../../core/models/project.model';
import { TPipe } from '../../core/i18n/t.pipe';
import { focusAfterRender } from '../../shared/focus/focus-after-render';
import { IconComponent } from '../../shared/icon/icon.component';

export interface TreeNode {
  name: string;
  path: string;
  depth: number;
  isFolder: boolean;
  size?: number;
}

@Component({
  selector: 'app-file-tree',
  imports: [IconComponent, TPipe],
  templateUrl: './file-tree.component.html',
  styleUrl: './file-tree.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTreeComponent {
  readonly isImagePath = (path: string) => !!imageMime(path);
  readonly store = inject(WorkspaceStore);
  private readonly zip = inject(ZipService);
  private readonly announcer = inject(AnnouncerService);
  private readonly i18n = inject(I18nService);

  readonly collapsed = signal<Set<string>>(new Set());
  readonly creating = signal(false);
  readonly newPathError = signal<string | null>(null);
  private readonly newToggle = viewChild<ElementRef<HTMLButtonElement>>('newToggle');
  private readonly injector = inject(Injector);

  /** Every folder in the project, to fold or unfold them all at once. */
  readonly folders = computed(() => {
    const folders = new Set<string>();
    for (const f of this.store.files()) {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
    }
    return [...folders];
  });
  readonly allCollapsed = computed(() => this.folders().length > 0 && this.folders().every((f) => this.collapsed().has(f)));

  /** Folds every folder, or unfolds them all when they already are. */
  toggleAll(): void {
    this.collapsed.set(this.allCollapsed() ? new Set() : new Set(this.folders()));
  }

  /** What a file is, for its icon colour: a folder, an image, code, configuration or a document. */
  kindOf(path: string, isFolder: boolean): string {
    if (isFolder) return 'folder';
    if (imageMime(path)) return 'image';
    const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? '';
    if (['py', 'js', 'mjs', 'cjs', 'ts', 'sh', 'ps1', 'bat'].includes(ext)) return 'code';
    if (['json', 'yml', 'yaml', 'toml', 'xml'].includes(ext)) return 'config';
    if (['md', 'markdown', 'txt'].includes(ext)) return 'doc';
    return 'other';
  }

  /** Folders first, then files, flattened in display order with collapsed folders' children hidden. */
  readonly rows = computed<TreeNode[]>(() => {
    const files = this.store.files();
    const folders = new Set<string>();
    for (const f of files) {
      const parts = f.path.split('/');
      for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
    }
    const nodes: TreeNode[] = [
      ...[...folders].map((path) => ({ name: path.split('/').at(-1)!, path, depth: path.split('/').length - 1, isFolder: true })),
      ...files.map((f) => ({
        name: f.path.split('/').at(-1)!,
        path: f.path,
        depth: f.path.split('/').length - 1,
        isFolder: false,
        size: f.content.length,
      })),
    ];
    const parentOf = (p: string) => p.split('/').slice(0, -1).join('/');
    const sortKey = (n: TreeNode): string =>
      n.path
        .split('/')
        .map((seg, i, all) => (i < all.length - 1 || n.isFolder ? `0${seg}` : `1${seg}`))
        .join('/');
    // Segment by segment: comparing whole paths as one string lets '-' and '/' trade places,
    // which put .claude/settings.json under .claude-plugin.
    nodes.sort((a, b) => {
      const x = sortKey(a).split('/');
      const y = sortKey(b).split('/');
      for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const order = x[i].localeCompare(y[i]);
        if (order) return order;
      }
      return x.length - y.length;
    });
    const hidden = this.collapsed();
    return nodes.filter((n) => {
      let parent = parentOf(n.path);
      while (parent) {
        if (hidden.has(parent)) return false;
        parent = parentOf(parent);
      }
      return true;
    });
  });

  toggleFolder(path: string): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  isOpen(path: string): boolean {
    return !this.collapsed().has(path);
  }

  toggleCreate(): void {
    if (this.creating()) {
      this.closeCreate();
      return;
    }
    this.creating.set(true);
    focusAfterRender(this.injector, () => document.getElementById('new-file-path'));
  }

  /** Esc or a finished create closes the form; focus goes back to the toggle, not <body>. */
  closeCreate(): void {
    this.creating.set(false);
    this.newPathError.set(null);
    focusAfterRender(this.injector, () => this.newToggle()?.nativeElement);
  }

  createFile(event: Event): void {
    event.preventDefault();
    const field = (event.target as HTMLFormElement).elements.namedItem('new-file-path') as HTMLInputElement;
    const raw = field.value.trim();
    if (this.store.files().some((f) => f.path === raw)) {
      this.newPathError.set(this.i18n.t('tree.exists'));
      return;
    }
    const path = this.store.writeFile(raw, '');
    if (!path) {
      this.newPathError.set(this.i18n.t('tree.invalid'));
      return;
    }
    this.store.select(path);
    this.closeCreate();
    this.announcer.announce(this.i18n.t('tree.created', { path }));
  }

  async importFiles(event: Event): Promise<void> {
    const field = event.target as HTMLInputElement;
    if (!field.files?.length) return;
    const { files, skipped, hasGit } = await this.zip.import(field.files);
    field.value = '';
    const count = this.store.addFiles(files);
    if (hasGit) this.store.markGit();
    if (!this.store.selectedFile() && files[0]) this.store.select(files[0].path);
    this.announcer.announce(
      this.i18n.t('tree.added', { n: count }) + (skipped.length ? this.i18n.t('spec.skipped', { n: skipped.length }) : '') +
        (hasGit ? this.i18n.t('import.gitSkipped') : ''),
    );
  }
}
