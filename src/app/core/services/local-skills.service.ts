import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { claudeRuntime, McpCap, McpResult, PermissionsCap, PermissionState } from '../claude/claude-runtime';
import { imageMime, isImageFile, ProjectFile, slugify } from '../models/project.model';
import { I18nService } from '../i18n/i18n.service';
import { WorkspaceStore } from './workspace.store';

/** The MCP server, set up in the Claude app, that reaches the user's Claude Code skills folder. */
export const LOCAL_SERVER = 'host:skill-files';
/** The tools the page uses on it (the manifest declares the same list). */
export const LOCAL_TOOLS = ['list_allowed_directories', 'list_directory', 'directory_tree', 'read_text_file', 'read_media_file', 'write_skill', 'write_file', 'create_directory'];
/** The scoped permission name for that server (see the permissions capability). */
const LOCAL_PERMISSION = `mcp:${LOCAL_SERVER}`;

/** `blocked`: the server is there but the user has not allowed this page to use it yet. */
export type LocalState = 'checking' | 'ready' | 'blocked' | 'none';
/** Where the open project stands against its folder on the computer. */
export type LocalSyncState = 'off' | 'synced' | 'pending' | 'saving' | 'differs' | 'error' | 'offline';

export interface LocalSkill {
  /** Folder name under the skills folder. */
  name: string;
}

export type LocalSaveResult = 'saved' | 'exists' | 'failed' | 'unavailable';

interface TreeNode {
  name: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

const MAX_FILES = 200;
const SAVE_DELAY = 1500;

/**
 * The user's Claude Code skills folder (`~/.claude/skills`) as seen through a local MCP server.
 * A project linked to a folder there (`project.localSkill`) is written back on every change,
 * so editing it here is the same as editing it from Claude Code. Works only when the page is
 * open in the Claude desktop app with that server connected; elsewhere it stays `none`.
 */
@Injectable({ providedIn: 'root' })
export class LocalSkillsService {
  private readonly store = inject(WorkspaceStore);
  private readonly i18n = inject(I18nService);

  readonly state = signal<LocalState>('checking');
  readonly root = signal<string | null>(null);
  readonly skills = signal<LocalSkill[]>([]);
  readonly sync = signal<LocalSyncState>('off');
  readonly lastError = signal<string | null>(null);
  /** Why the last save to the computer stopped, and how far it got. */
  readonly failure = signal<LocalWriteError | null>(null);
  /** Files on disk that the workshop no longer has: the server cannot delete, so they stay there. */
  readonly leftovers = signal<string[]>([]);
  readonly available = computed(() => this.state() === 'ready');
  /** The user's answer to "allow this page to use the skills folder". */
  readonly permission = signal<PermissionState>('unavailable');
  /** Show an Allow button: the page may use the folder but has not been allowed to yet, or was refused. */
  readonly needsAllow = computed(() => this.state() === 'blocked' || (this.state() !== 'none' && (this.permission() === 'prompt' || this.permission() === 'denied')));

  private mcp: McpCap | null = null;
  private permissions: PermissionsCap | null = null;
  /** path → content as last read from or written to disk, per linked project. */
  private onDisk = new Map<string, Map<string, string>>();
  private saveTimer?: ReturnType<typeof setTimeout>;
  private saving = Promise.resolve();

  constructor() {
    // Every change to a linked project is written to its folder shortly after it settles.
    effect(() => {
      const project = this.store.project();
      untracked(() => {
        if (!project.localSkill) {
          this.sync.set('off');
          return;
        }
        if (!this.available()) {
          this.sync.set(this.state() === 'checking' ? 'pending' : 'offline');
          return;
        }
        if (this.sync() === 'differs') return;
        const known = this.onDisk.get(project.id);
        if (!known) {
          void this.compareWithDisk();
          return;
        }
        if (this.changedFiles(project.files, known).length) {
          this.sync.set('pending');
          clearTimeout(this.saveTimer);
          this.saveTimer = setTimeout(() => void this.flush(), SAVE_DELAY);
        } else if (this.sync() !== 'saving') {
          this.sync.set('synced');
        }
      });
    });
  }

  async init(): Promise<void> {
    [this.mcp, this.permissions] = await Promise.all([claudeRuntime.mcp(), claudeRuntime.permissions()]);
    if (!this.mcp) {
      this.state.set('none');
      return;
    }
    await this.readPermission();
    try {
      const result = await this.call('list_allowed_directories', {});
      const root = text(result)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => /[\\/]/.test(line) && !/^allowed/i.test(line));
      if (!root) throw new Error('no folder');
      this.root.set(root);
      this.state.set('ready');
      await this.refresh();
      // A project opened before the connection was ready gets checked now.
      if (this.store.project().localSkill) await this.compareWithDisk();
    } catch (error) {
      // Not allowed yet (or the request was dismissed): offer Allow instead of hiding the feature.
      this.state.set(isConsentError(error) || this.permission() === 'prompt' || this.permission() === 'denied' ? 'blocked' : 'none');
    }
  }

  /**
   * Asks the user, in one Claude app dialog, to let this page use the skills folder; after a refusal
   * it opens the app's permissions panel instead. Called from a button.
   */
  async allow(): Promise<void> {
    if (!this.permissions) return;
    try {
      if (this.permission() === 'denied') await this.permissions.manage();
      else await this.permissions.request([LOCAL_PERMISSION]);
    } catch {
      // The panel could not open; the state read below keeps the button.
    }
    await this.readPermission();
    if (this.permission() !== 'denied') await this.init();
  }

  private async readPermission(): Promise<void> {
    if (!this.permissions) return;
    this.permission.set(await this.permissions.state(LOCAL_PERMISSION).catch(() => 'unavailable' as PermissionState));
  }

  /** The skill folders, as `[DIR] name` lines from the server. */
  async refresh(): Promise<void> {
    if (!this.available()) return;
    try {
      const listing = text(await this.call('list_directory', { path: this.root()! }));
      const names = [...listing.matchAll(/^\[DIR\]\s+(.+)$/gm)].map((m) => m[1].trim()).filter((n) => !n.startsWith('.') && n !== 'synced');
      this.skills.set(names.sort((a, b) => a.localeCompare(b)).map((name) => ({ name })));
    } catch {
      this.skills.set([]);
    }
  }

  /** Reads a skill folder from disk: text files as text, images as base64. */
  async read(name: string): Promise<ProjectFile[]> {
    const base = this.join(this.root()!, name);
    const tree = JSON.parse(text(await this.call('directory_tree', { path: base }))) as TreeNode[];
    const paths: string[] = [];
    const walk = (nodes: TreeNode[], prefix: string) => {
      for (const node of nodes) {
        if (node.name === '.git' || node.name === 'node_modules') continue;
        const path = prefix ? `${prefix}/${node.name}` : node.name;
        if (node.type === 'directory') walk(node.children ?? [], path);
        else paths.push(path);
      }
    };
    walk(tree, '');
    const files: ProjectFile[] = [];
    for (const path of paths.slice(0, MAX_FILES)) {
      const full = this.join(base, path);
      const mime = imageMime(path);
      try {
        if (mime) {
          const result = await this.call('read_media_file', { path: full });
          const block = result.content.find((b) => typeof (b as { data?: unknown }).data === 'string') as { data: string; mimeType?: string } | undefined;
          if (block) files.push({ path, content: block.data, encoding: 'base64', mime: block.mimeType ?? mime });
        } else {
          files.push({ path, content: text(await this.call('read_text_file', { path: full })) });
        }
      } catch {
        // An unreadable file (binary, too large) is left out rather than failing the whole skill.
      }
    }
    return files;
  }

  /** Opens a skill from the computer as a project linked to its folder. */
  async open(name: string): Promise<boolean> {
    if (!this.available()) return false;
    let files: ProjectFile[];
    try {
      files = await this.read(name);
    } catch {
      this.lastError.set(name);
      return false;
    }
    await this.store.openLocal(name, files);
    this.remember(files);
    this.sync.set('synced');
    return true;
  }

  /**
   * Saves the open project into `<skills>/<folder>` and links it, so later edits follow.
   * An existing folder that this project is not linked to is only replaced with `overwrite`.
   */
  async saveAs(folder?: string, overwrite = false): Promise<LocalSaveResult> {
    if (!this.available()) return 'unavailable';
    // One permission dialog before the save, rather than in the middle of it.
    if (this.permission() === 'prompt') await this.allow();
    const project = this.store.project();
    const name = slugify(folder || project.localSkill || project.spec.name, 'my-skill');
    await this.refresh();
    if (project.localSkill !== name && !overwrite && this.skills().some((s) => s.name === name)) return 'exists';
    try {
      await this.write(name, project.files, new Map());
    } catch (error) {
      this.failure.set(error instanceof LocalWriteError ? error : new LocalWriteError(0, 0, name, error));
      this.sync.set('error');
      return 'failed';
    }
    this.failure.set(null);
    this.store.linkLocal(name);
    this.remember(this.store.project().files);
    this.sync.set('synced');
    await this.refresh();
    return 'saved';
  }

  /** The folder changed outside the workshop: take the computer's copy. */
  async useDiskCopy(): Promise<void> {
    const name = this.store.project().localSkill;
    if (!name) return;
    const files = await this.read(name);
    this.store.replaceFiles(files);
    this.remember(files);
    this.sync.set('synced');
  }

  /** The folder changed outside the workshop: write the workshop's copy over it. */
  async useWorkshopCopy(): Promise<void> {
    this.onDisk.set(this.store.project().id, new Map());
    this.sync.set('pending');
    await this.flush();
  }

  // ---- internals ------------------------------------------------------------

  /** Why the last save stopped, in the user's words: how far it got, and what to do. */
  failureText(): string {
    const f = this.failure();
    if (!f) return '';
    if (f.refused) return this.i18n.t('local.refused', { done: f.done, total: f.total });
    return this.i18n.t('local.failedAt', { done: f.done, total: f.total, at: f.at, reason: f.message });
  }

  /** Reads the skills folder again and checks the open project against its files. */
  async recheck(): Promise<void> {
    if (this.state() === 'none') await this.init();
    else await this.refresh();
    if (this.store.project().localSkill) await this.compareWithDisk();
  }

  private async compareWithDisk(): Promise<void> {
    const project = this.store.project();
    if (!project.localSkill || !this.available()) return;
    try {
      const disk = await this.read(project.localSkill);
      if (this.store.project().id !== project.id) return;
      const same = disk.length === project.files.length && !this.changedFiles(project.files, toMap(disk)).length;
      this.onDisk.set(project.id, toMap(disk));
      this.sync.set(same ? 'synced' : 'differs');
    } catch {
      this.sync.set('error');
    }
  }

  private async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saving = this.saving.then(async () => {
      const project = this.store.project();
      const known = this.onDisk.get(project.id);
      if (!project.localSkill || !known) return;
      this.sync.set('saving');
      try {
        await this.write(project.localSkill, project.files, known);
        this.leftovers.set([...known.keys()].filter((p) => !project.files.some((f) => f.path === p)));
        this.sync.set(this.changedFiles(this.store.project().files, this.onDisk.get(project.id)!).length ? 'pending' : 'synced');
        this.lastError.set(null);
        this.failure.set(null);
      } catch (error) {
        this.failure.set(error instanceof LocalWriteError ? error : new LocalWriteError(0, 0, project.localSkill, error));
        this.sync.set('error');
      }
    });
    return this.saving;
  }

  /**
   * Writes the files that differ from what is on disk, with as few calls as possible: the Claude app
   * may ask the user to allow each write, so folders that already exist are skipped and a missing
   * nested folder is made in one call. Images cannot be written by this server and are kept as they are.
   * Throws a LocalWriteError saying how far it got and why it stopped.
   */
  private async write(name: string, files: ProjectFile[], known: Map<string, string>): Promise<void> {
    const base = this.join(this.root()!, name);
    const project = this.store.project();
    const disk = this.onDisk.get(project.id) ?? new Map<string, string>();
    const todo = this.changedFiles(files, known).filter((f) => !isImageFile(f));
    if (!todo.length) return;

    // One call for the whole save: the user is asked once, not once per file.
    try {
      await this.call('write_skill', { folder: name, files: todo.map((f) => ({ path: f.path, content: f.content })) });
      for (const file of todo) disk.set(file.path, file.content);
      this.onDisk.set(project.id, disk);
      return;
    } catch (error) {
      if (!isMissingTool(error)) throw new LocalWriteError(0, 1, name, error);
      // An older skill-files server without write_skill: fall back to file by file below.
    }

    // Folders already there (a read, which needs no approval).
    const existing = new Set<string>();
    try {
      const tree = JSON.parse(text(await this.call('directory_tree', { path: base }))) as TreeNode[];
      existing.add('');
      const walk = (nodes: TreeNode[], prefix: string) => {
        for (const node of nodes) {
          if (node.type !== 'directory') continue;
          const p = prefix ? `${prefix}/${node.name}` : node.name;
          existing.add(p);
          walk(node.children ?? [], p);
        }
      };
      walk(tree, '');
    } catch {
      // The skill's folder does not exist yet.
    }
    // Only the deepest missing folders: create_directory makes the ones above them too.
    const needed = new Set(todo.map((f) => f.path.split('/').slice(0, -1).join('/')).filter((d) => !existing.has(d)));
    const leaves = [...needed].filter((d) => ![...needed].some((o) => o !== d && o.startsWith(d ? d + '/' : '')));

    const total = leaves.length + todo.length;
    let done = 0;
    const step = async (label: string, run: () => Promise<unknown>) => {
      try {
        await run();
        done++;
      } catch (error) {
        throw new LocalWriteError(done, total, label, error);
      }
    };
    for (const dir of leaves) await step(dir || name, () => this.call('create_directory', { path: dir ? this.join(base, dir) : base }));
    for (const file of todo) {
      await step(file.path, () => this.call('write_file', { path: this.join(base, file.path), content: file.content }));
      disk.set(file.path, file.content);
      this.onDisk.set(project.id, disk);
    }
    this.onDisk.set(project.id, disk);
  }

  private changedFiles(files: ProjectFile[], known: Map<string, string>): ProjectFile[] {
    return files.filter((f) => known.get(f.path) !== f.content);
  }

  private remember(files: ProjectFile[]): void {
    this.onDisk.set(this.store.project().id, toMap(files));
    this.leftovers.set([]);
  }

  private join(base: string, path: string): string {
    const sep = base.includes('\\') ? '\\' : '/';
    return [base.replace(/[\\/]+$/, ''), ...path.split('/').filter(Boolean)].join(sep);
  }

  /**
   * One call to the server. A first call whose permission prompt could not be shown just then (another
   * prompt was open) comes back retryable and never reached the server, so it is safe to send once more.
   */
  private async call(tool: string, input: Record<string, unknown>): Promise<McpResult> {
    try {
      return await this.mcp!.callTool(LOCAL_SERVER, tool, input, { cache: false });
    } catch (error) {
      const e = error as { code?: string; retryable?: boolean; retryAfterMs?: number };
      if (e?.code !== 'upstream_error' || !e.retryable) throw error;
      await new Promise((resolve) => setTimeout(resolve, Math.min(e.retryAfterMs ?? 1500, 5000)));
      return this.mcp!.callTool(LOCAL_SERVER, tool, input, { cache: false });
    }
  }
}

/** A save to the computer that stopped part way. `refused`: the user declined (or did not answer) the Claude app's request to allow the write. */
export class LocalWriteError extends Error {
  readonly refused: boolean;
  constructor(
    readonly done: number,
    readonly total: number,
    readonly at: string,
    cause: unknown,
  ) {
    const code = (cause as { code?: string })?.code ?? '';
    super((cause as { message?: string })?.message || code || 'unknown');
    this.refused = ['cancelled', 'approval_required', 'consent_required', 'not_in_manifest', 'blocked_by_policy'].includes(code);
  }
}

/** The Claude app or the user stopped the call: not allowed, declined, or left unanswered. */
function isConsentError(error: unknown): boolean {
  return ['approval_required', 'consent_required', 'cancelled', 'upstream_error'].includes((error as { code?: string })?.code ?? '');
}

/** The server does not offer the tool (an older skill-files server). */
function isMissingTool(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  return e?.code === 'not_in_manifest' || (e?.code === 'tool_error' && /unknown tool|not found/i.test(e.message ?? ''));
}

function toMap(files: ProjectFile[]): Map<string, string> {
  return new Map(files.map((f) => [f.path, f.content]));
}

/**
 * The text a filesystem tool returned. Raw text first: `payload` parses JSON-looking text, which would
 * turn a file such as plugin.json into an object.
 */
function text(result: McpResult): string {
  const structured = result.structuredContent as { content?: unknown } | undefined;
  if (structured && typeof structured.content === 'string') return structured.content;
  const block = result.content.find((b) => (b as { type?: string }).type === 'text') as { text?: string } | undefined;
  if (typeof block?.text === 'string') return block.text;
  return typeof result.payload === 'string' ? result.payload : '';
}
