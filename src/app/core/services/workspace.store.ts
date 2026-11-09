import { computed, effect, Injectable, inject, signal, untracked } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import type { Lang } from '../i18n/messages';
import {
  ChatMessage,
  emptySpec,
  buildKind,
  entryState,
  filesHash,
  isGitPath,
  LibraryEntry,
  newId,
  normalizePath,
  Project,
  ProjectFile,
  ProjectSpec,
  ProjectSummary,
  skillMeta,
  SyncState,
} from '../models/project.model';
import { AnnouncerService } from './announcer.service';
import { PersistenceService, StoreError, StoreFailure } from './persistence.service';

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

interface Snapshot {
  files: ProjectFile[];
  map: string;
  label: string;
}

const SAVE_DELAY_MS = 1200;
const TABS_KEY = 'skill-workshop.tabs';
const ACTIVE_KEY = 'skill-workshop.active-tab';

export type LibrarySaveResult = 'created' | 'updated' | StoreFailure;
const MAX_UNDO = 10;

/** The open project and everything the three benches read from it. */
@Injectable({ providedIn: 'root' })
export class WorkspaceStore {
  private readonly persistence = inject(PersistenceService);
  private readonly announcer = inject(AnnouncerService);
  private readonly i18n = inject(I18nService);

  readonly project = signal<Project>(this.blankProject());
  readonly projects = signal<ProjectSummary[]>([]);
  readonly selectedPath = signal<string | null>('SKILL.md');
  readonly saveState = signal<SaveState>('idle');
  readonly undoStack = signal<Snapshot[]>([]);
  /** The owner's saved skills (Claude Code, claude.ai, and ones saved from here). */
  readonly library = signal<LibraryEntry[]>([]);
  /** Projects open as tabs, in tab order; the current one is always among them unless it is a draft. */
  readonly openTabs = signal<string[]>(this.readTabs());

  readonly spec = computed(() => this.project().spec);
  readonly files = computed(() => [...this.project().files].sort((a, b) => a.path.localeCompare(b.path)));
  readonly selectedFile = computed(() => this.project().files.find((f) => f.path === this.selectedPath()) ?? null);
  readonly canUndo = computed(() => this.undoStack().length > 0);
  /** The library entry the open project belongs to, if any. */
  readonly libraryEntry = computed(() => {
    const id = this.project().libraryId;
    return id ? (this.library().find((e) => e.id === id) ?? null) : null;
  });
  /** Saved in "my skills"? Installed in Claude as is? Drives the install button and dialog. */
  readonly syncState = computed<SyncState>(() => {
    const files = this.project().files;
    if (!files.length) return 'empty';
    const entry = this.libraryEntry();
    if (!entry) return 'notSaved';
    if (filesHash(files) !== filesHash(entry.files)) return 'unsaved';
    return entryState(entry);
  });

  private saveTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    // Whatever project is shown gets a tab; the order and set are remembered for the next visit.
    effect(() => {
      const { id, isDraft } = this.project();
      untracked(() => {
        if (!isDraft && !this.openTabs().includes(id)) this.openTabs.update((tabs) => [...tabs, id]);
      });
    });
    effect(() => {
      const tabs = this.openTabs();
      const { id, isDraft } = this.project();
      try {
        localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
        if (!isDraft) localStorage.setItem(ACTIVE_KEY, id);
      } catch {
        // Storage can be refused; tabs then last for this visit.
      }
    });

    // An untouched draft greets in the interface language.
    effect(() => {
      this.i18n.lang();
      untracked(() => {
        if (this.project().isDraft) this.setProject(this.blankProject());
      });
    });
  }

  async init(): Promise<void> {
    await this.persistence.init();
    const list = await this.persistence.list();
    this.projects.set(list);
    // Tabs of projects deleted elsewhere drop out; the last tab in use opens first.
    const known = new Set(list.map((p) => p.id));
    this.openTabs.update((tabs) => tabs.filter((id) => known.has(id)));
    let last: string | null = null;
    try {
      last = localStorage.getItem(ACTIVE_KEY);
    } catch {
      // No storage: start on the first tab.
    }
    // No open tabs: start on the start screen (saved skills, import, brief) rather than the newest project.
    const first = last && this.openTabs().includes(last) ? last : this.openTabs()[0];
    if (first) await this.open(first);
    void this.refreshLibrary();
  }

  async refreshLibrary(): Promise<void> {
    this.library.set(await this.persistence.listLibrary());
  }

  /** A library skill opens as its own project; the same skill opened again reuses that project. */
  async openLibrary(id: string): Promise<void> {
    const entry = this.library().find((e) => e.id === id);
    if (!entry) return;
    const existing = this.projects().find((p) => p.libraryId === id);
    if (existing) {
      await this.open(existing.id);
      return;
    }
    this.flushSave();
    const project: Project = {
      id: newId(),
      spec: { ...emptySpec(), kind: buildKind(entry.kind), name: entry.name, idea: entry.description },
      files: [],
      map: '',
      explanation: '',
      updatedAt: Date.now(),
      chat: [],
      libraryId: id,
    };
    this.setProject(project);
    this.change((p) => ({ ...p, files: entry.files.map((f) => ({ ...f })) }));
    this.selectedPath.set(this.files().find((f) => /(^|\/)SKILL\.md$/.test(f.path))?.path ?? this.files()[0]?.path ?? null);
    this.announcer.announce(this.i18n.t('library.opened', { name: entry.name }));
  }

  /** Saves the open project into the library: back over the skill it came from, or as a new one. */
  async saveToLibrary(): Promise<LibrarySaveResult> {
    const p = this.project();
    const skill = p.files.find((f) => /(^|\/)SKILL\.md$/.test(f.path));
    const meta = skill ? skillMeta(skill.content) : {};
    const name = meta.name || p.spec.name || this.i18n.t('header.untitled');
    const known = p.libraryId ? this.library().find((e) => e.id === p.libraryId) : undefined;
    const id = p.libraryId ?? this.libraryIdFor(name);
    const entry: LibraryEntry = {
      id,
      name,
      kind: p.spec.kind,
      description: meta.description || p.spec.idea,
      origin: known?.origin ?? 'workshop',
      installedHash: known?.installedHash,
      files: p.files.filter((f) => !isGitPath(f.path)),
      updatedAt: Date.now(),
    };
    try {
      await this.persistence.saveLibrary(entry);
    } catch (error) {
      return error instanceof StoreError ? error.reason : 'failed';
    }
    if (!p.libraryId) this.change((current) => ({ ...current, libraryId: id }));
    this.library.update((list) => [...list.filter((e) => e.id !== id), entry].sort((a, b) => a.name.localeCompare(b.name)));
    return known ? 'updated' : 'created';
  }

  /** After the user installs the saved copy in Claude: the library remembers that this version is the installed one. */
  async markInstalled(): Promise<boolean> {
    const entry = this.libraryEntry();
    if (!entry) return false;
    const marked: LibraryEntry = { ...entry, installedHash: filesHash(entry.files) };
    try {
      await this.persistence.saveLibrary(marked);
    } catch {
      return false;
    }
    this.library.update((list) => list.map((e) => (e.id === marked.id ? marked : e)));
    return true;
  }

  /** Switches to a tab's project. */
  async openTab(id: string): Promise<void> {
    if (id !== this.project().id) await this.open(id);
  }

  /** Closes a tab; closing the shown one moves to its neighbour, or to a fresh draft when none is left. */
  async closeTab(id: string): Promise<void> {
    const tabs = this.openTabs();
    const index = tabs.indexOf(id);
    const rest = tabs.filter((t) => t !== id);
    this.openTabs.set(rest);
    if (id !== this.project().id) return;
    const next = rest[Math.min(index, rest.length - 1)];
    if (next) await this.open(next);
    else this.newProject();
  }

  async open(id: string): Promise<void> {
    const loaded = await this.persistence.load(id);
    if (!loaded) return;
    // Only skills and plugins are built here now; an older command or hook project opens as a plugin.
    this.setProject(loaded.spec.kind === buildKind(loaded.spec.kind) ? loaded : { ...loaded, spec: { ...loaded.spec, kind: buildKind(loaded.spec.kind) } });
    // Projects imported before `.git` was filtered out still carry it: drop it once and keep the flag.
    if (loaded.files.some((f) => isGitPath(f.path))) {
      this.change((p) => ({ ...p, files: p.files.filter((f) => !isGitPath(f.path)), hasGit: true }));
      this.selectedPath.set(this.files().find((f) => /(^|\/)SKILL\.md$/.test(f.path))?.path ?? this.files()[0]?.path ?? null);
    }
  }

  /** Opens an empty draft; it is saved once the user changes something. */
  newProject(): void {
    this.flushSave();
    this.setProject(this.blankProject());
    this.announcer.announce(this.i18n.t('store.created'));
  }

  /** Opens existing skill/plugin files as a fresh project, ready to be explained. */
  importAsProject(files: ProjectFile[], sourceName: string, hasGit = false): void {
    this.flushSave();
    const project: Project = {
      id: newId(),
      spec: { ...emptySpec(), name: sourceName.replace(/\.zip$/i, '') },
      files: [],
      map: '',
      explanation: '',
      updatedAt: Date.now(),
      chat: [],
      hasGit: hasGit || undefined,
    };
    this.setProject(project);
    this.change((p) => ({
      ...p,
      files: files.flatMap((f) => {
        const path = normalizePath(f.path);
        return path && !isGitPath(path) ? [{ ...f, path }] : [];
      }),
      hasGit: hasGit || files.some((f) => isGitPath(f.path)) || undefined,
    }));
    this.selectedPath.set(this.project().files.find((f) => /(^|\/)SKILL\.md$/.test(f.path))?.path ?? this.files()[0]?.path ?? null);
  }

  setExplanation(explanation: string): void {
    this.change((p) => ({ ...p, explanation, translations: undefined, contentLang: this.i18n.lang() }));
  }

  async deleteProject(): Promise<void> {
    const current = this.project();
    if (!current.isDraft) await this.persistence.remove(current.id);
    const list = (await this.persistence.list()).filter((p) => p.id !== current.id);
    this.projects.set(list);
    this.openTabs.update((tabs) => tabs.filter((t) => t !== current.id));
    if (list.length) await this.open(list[0].id);
    else this.setProject(this.blankProject());
    this.announcer.announce(this.i18n.t('store.deleted'));
  }

  /** Deletes every project and returns to an empty draft; a pending save is dropped, not flushed. */
  async resetAll(): Promise<boolean> {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    let ok = true;
    try {
      await this.persistence.removeAll();
    } catch {
      ok = false;
    }
    this.projects.set(ok ? [] : await this.persistence.list());
    if (ok) this.openTabs.set([]);
    this.setProject(this.blankProject());
    this.announcer.announce(this.i18n.t(ok ? 'reset.done' : 'reset.failed'));
    return ok;
  }

  updateSpec(patch: Partial<ProjectSpec>): void {
    this.change((p) => ({ ...p, spec: { ...p.spec, ...patch } }));
  }

  // ---- files -------------------------------------------------------------

  /** `image` carries an image's encoding; text written over an existing image is refused. */
  writeFile(rawPath: string, content: string, image?: Pick<ProjectFile, 'encoding' | 'mime'>): string | null {
    const path = normalizePath(rawPath);
    if (!path) return null;
    if (isGitPath(path)) {
      this.markGit();
      return null;
    }
    if (!image && this.project().files.some((f) => f.path === path && f.encoding)) return null;
    this.change((p) => {
      const files = p.files.filter((f) => f.path !== path);
      files.push({ path, content, ...(image?.encoding ? image : {}) });
      return { ...p, files };
    });
    return path;
  }

  deleteFile(path: string): boolean {
    const exists = this.project().files.some((f) => f.path === path);
    if (!exists) return false;
    this.change((p) => ({ ...p, files: p.files.filter((f) => f.path !== path) }));
    if (this.selectedPath() === path) this.selectedPath.set(this.files()[0]?.path ?? null);
    return true;
  }

  renameFile(from: string, rawTo: string): string | null {
    const to = normalizePath(rawTo);
    const file = this.project().files.find((f) => f.path === from);
    if (!to || !file || this.project().files.some((f) => f.path === to)) return null;
    this.change((p) => ({ ...p, files: p.files.map((f) => (f.path === from ? { ...f, path: to } : f)) }));
    if (this.selectedPath() === from) this.selectedPath.set(to);
    return to;
  }

  /** Flags the project as coming from a Git repository (shown next to the file list). */
  markGit(): void {
    if (!this.project().hasGit) this.change((p) => ({ ...p, hasGit: true }));
  }

  addFiles(files: ProjectFile[], base = ''): number {
    let count = 0;
    for (const file of files) {
      const image = file.encoding ? { encoding: file.encoding, mime: file.mime } : undefined;
      if (this.writeFile(base ? `${base}/${file.path}` : file.path, file.content, image)) count++;
    }
    return count;
  }

  /** `byHand` marks the map as ahead of the files until Claude applies it. The map is always English, so it never touches the explanation's language. */
  setMap(map: string, byHand = false): void {
    this.change((p) => ({ ...p, map, mapEdited: byHand }));
  }

  /** Adds a reference link to references/links.md (created on first use). */
  addLink(url: string, title: string): void {
    const path = 'references/links.md';
    const current = this.project().files.find((f) => f.path === path)?.content ?? '# Reference links\n\nPages the user pointed to. Claude reads these addresses as text and cannot open them.\n';
    const line = title ? `- [${title.replace(/[[\]]/g, '')}](${url})` : `- <${url}>`;
    this.writeFile(path, `${current.trimEnd()}\n${line}\n`);
  }

  /** Shows the map and explanation in `lang`, keeping the current pair under `from` for the way back. */
  applyTranslation(from: Lang, lang: Lang, map: string, explanation: string): void {
    this.change((p) => ({ ...p, map, explanation, contentLang: lang, translations: { [from]: { map: p.map, explanation: p.explanation ?? '' } } }));
  }

  /** Swaps in a kept translation; false when there is none. */
  restoreTranslation(from: Lang, lang: Lang): boolean {
    const kept = this.project().translations?.[lang];
    if (!kept) return false;
    // Only the explanation follows the language; the map stays as it is (always English).
    this.applyTranslation(from, lang, this.project().map, kept.explanation);
    return true;
  }

  markMapApplied(): void {
    if (this.project().mapEdited) this.change((p) => ({ ...p, mapEdited: false }));
  }

  select(path: string | null): void {
    this.selectedPath.set(path);
  }

  // ---- undo --------------------------------------------------------------

  /** Called before Claude changes files, so one click puts them back. */
  checkpoint(label: string): void {
    const p = this.project();
    const snap: Snapshot = { files: p.files.map((f) => ({ ...f })), map: p.map, label };
    this.undoStack.update((stack) => [...stack, snap].slice(-MAX_UNDO));
  }

  /** Drops the last checkpoint when nothing changed since it was taken. */
  discardCheckpointIfUnchanged(): void {
    const last = this.undoStack().at(-1);
    const p = this.project();
    if (last && last.map === p.map && JSON.stringify(last.files) === JSON.stringify(p.files)) {
      this.undoStack.update((s) => s.slice(0, -1));
    }
  }

  undo(): void {
    const last = this.undoStack().at(-1);
    if (!last) return;
    this.undoStack.update((s) => s.slice(0, -1));
    this.change((p) => ({ ...p, files: last.files, map: last.map }));
    if (!last.files.some((f) => f.path === this.selectedPath())) this.selectedPath.set(last.files[0]?.path ?? null);
    this.announcer.announce(this.i18n.t('store.undone', { label: last.label }));
  }

  // ---- chat --------------------------------------------------------------

  addMessage(message: Omit<ChatMessage, 'id' | 'createdAt'>): string {
    const id = newId('m');
    this.change((p) => ({ ...p, chat: [...p.chat, { ...message, id, createdAt: Date.now() }].slice(-60) }));
    return id;
  }

  patchMessage(id: string, patch: Partial<ChatMessage>, persist = true): void {
    // A run that ended after a project switch or reset must not touch the project now open.
    if (!this.project().chat.some((m) => m.id === id)) return;
    const apply = (p: Project): Project => ({ ...p, chat: p.chat.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
    if (persist) this.change(apply);
    else this.project.update(apply);
  }

  clearChat(): void {
    this.change((p) => ({ ...p, chat: [] }));
  }

  // ---- internals ---------------------------------------------------------

  private blankProject(): Project {
    return {
      id: newId(),
      spec: emptySpec(),
      files: [],
      map: '',
      updatedAt: Date.now(),
      isDraft: true,
      chat: [{ id: newId('m'), role: 'assistant', status: 'done', createdAt: Date.now(), text: this.i18n.t('store.newGreeting'), textKey: 'store.newGreeting' }],
    };
  }

  private setProject(project: Project): void {
    this.flushSave();
    this.project.set(project);
    this.undoStack.set([]);
    this.selectedPath.set(project.files.find((f) => /(^|\/)SKILL\.md$/.test(f.path))?.path ?? project.files[0]?.path ?? null);
    this.saveState.set('idle');
  }

  private change(mutate: (p: Project) => Project): void {
    // The first change turns a draft into a saved project.
    this.project.update((p) => ({ ...mutate(p), updatedAt: Date.now(), isDraft: false }));
    this.scheduleSave();
  }

  private scheduleSave(): void {
    this.saveState.set('pending');
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DELAY_MS);
  }

  private libraryIdFor(name: string): string {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'skill';
    const taken = new Set(this.library().map((e) => e.id));
    let id = `ws-${slug}`;
    for (let n = 2; taken.has(id); n++) id = `ws-${slug}-${n}`;
    return id;
  }

  private readTabs(): string[] {
    try {
      const tabs = JSON.parse(localStorage.getItem(TABS_KEY) ?? '[]');
      return Array.isArray(tabs) ? tabs.filter((t): t is string => typeof t === 'string') : [];
    } catch {
      return [];
    }
  }

  private flushSave(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const snapshot = this.project();
    if (snapshot.isDraft) return;
    this.saveState.set('saving');
    this.persistence
      .save(snapshot)
      .then(async () => {
        this.saveState.set(this.persistence.lastError() ? 'error' : 'saved');
        this.projects.set(await this.persistence.list());
      })
      .catch(() => this.saveState.set('error'));
  }
}
