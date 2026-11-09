import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { claudeRuntime, McpCap, McpResult } from '../claude/claude-runtime';
import { imageMime, isImageFile, ProjectFile, slugify } from '../models/project.model';
import { WorkspaceStore } from './workspace.store';

/** The MCP server, set up in the Claude app, that reaches the user's Claude Code skills folder. */
export const LOCAL_SERVER = 'host:skill-files';
/** The tools the page uses on it (the manifest declares the same list). */
export const LOCAL_TOOLS = ['list_allowed_directories', 'list_directory', 'directory_tree', 'read_text_file', 'read_media_file', 'write_file', 'create_directory'];

export type LocalState = 'checking' | 'ready' | 'none';
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

  readonly state = signal<LocalState>('checking');
  readonly root = signal<string | null>(null);
  readonly skills = signal<LocalSkill[]>([]);
  readonly sync = signal<LocalSyncState>('off');
  readonly lastError = signal<string | null>(null);
  /** Files on disk that the workshop no longer has: the server cannot delete, so they stay there. */
  readonly leftovers = signal<string[]>([]);
  readonly available = computed(() => this.state() === 'ready');

  private mcp: McpCap | null = null;
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
    this.mcp = await claudeRuntime.mcp();
    if (!this.mcp) {
      this.state.set('none');
      return;
    }
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
    } catch {
      this.state.set('none');
    }
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
    const project = this.store.project();
    const name = slugify(folder || project.localSkill || project.spec.name, 'my-skill');
    await this.refresh();
    if (project.localSkill !== name && !overwrite && this.skills().some((s) => s.name === name)) return 'exists';
    try {
      await this.write(name, project.files, new Map());
    } catch {
      this.sync.set('error');
      return 'failed';
    }
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
      } catch (error) {
        this.lastError.set((error as { message?: string })?.message ?? '');
        this.sync.set('error');
      }
    });
    return this.saving;
  }

  /** Writes the files that differ from what is on disk; images cannot be written by this server and are kept as they are. */
  private async write(name: string, files: ProjectFile[], known: Map<string, string>): Promise<void> {
    const base = this.join(this.root()!, name);
    const project = this.store.project();
    const disk = this.onDisk.get(project.id) ?? new Map<string, string>();
    const dirs = new Set<string>([base]);
    for (const file of files) {
      const parts = file.path.split('/').slice(0, -1);
      for (let i = 1; i <= parts.length; i++) dirs.add(this.join(base, parts.slice(0, i).join('/')));
    }
    for (const dir of [...dirs].sort((a, b) => a.length - b.length)) await this.call('create_directory', { path: dir });
    for (const file of this.changedFiles(files, known)) {
      if (isImageFile(file)) continue;
      await this.call('write_file', { path: this.join(base, file.path), content: file.content });
      disk.set(file.path, file.content);
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

  private call(tool: string, input: Record<string, unknown>): Promise<McpResult> {
    return this.mcp!.callTool(LOCAL_SERVER, tool, input, { cache: false });
  }
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
