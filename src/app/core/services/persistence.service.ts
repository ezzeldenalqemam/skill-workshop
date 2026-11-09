import { inject, Injectable, signal } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { claudeRuntime, Db } from '../claude/claude-runtime';
import { LibraryEntry, Project, ProjectFile, ProjectSummary } from '../models/project.model';

export type StorageMode = 'connecting' | 'account' | 'browser';
/** Why a write to the store failed, in words the page can explain. */
export type StoreFailure = 'refused' | 'full' | 'failed';

const LOCAL_KEY = 'skill-workshop.projects';
/** The store caps one document at 256 KiB; above this the files move into chunk documents. */
const INLINE_LIMIT = 230_000;
/** Characters per chunk: even if every character takes 3 bytes in UTF-8, a chunk stays near 180 KB. */
const CHUNK_CHARS = 60_000;

/** A store rejection, sorted into what the page can tell the user. */
export class StoreError extends Error {
  constructor(
    readonly reason: StoreFailure,
    readonly code: string,
    detail: string,
  ) {
    super(detail || code);
  }
}

/**
 * Saves projects in the artifact's private per-user store (`data/users/<id>/<projectId>`),
 * or in this browser's localStorage when the page runs outside a Claude viewer.
 * A skill too large for one document keeps its files in `<doc>/chunks/<n>` beside it.
 */
@Injectable({ providedIn: 'root' })
export class PersistenceService {
  private readonly i18n = inject(I18nService);
  readonly mode = signal<StorageMode>('connecting');
  readonly lastError = signal<string | null>(null);
  /** The skill library is the owner's own: only they read and write `library/*`. */
  readonly libraryAvailable = signal(false);

  private db: Db | null = null;
  private uid: string | null = null;
  private ready?: Promise<void>;
  /** One write at a time per project document. */
  private writeChains = new Map<string, Promise<void>>();
  /** How many chunk documents each stored document has, so a smaller rewrite can delete the extras. */
  private chunkCounts = new Map<string, number>();

  init(): Promise<void> {
    this.ready ??= (async () => {
      const [db, user] = await Promise.all([claudeRuntime.db(), claudeRuntime.user()]);
      const uid = user ? await user.id().catch(() => null) : null;
      if (db && uid) {
        this.db = db;
        this.uid = uid;
        this.mode.set('account');
        this.libraryAvailable.set(!!(await user?.isOwner?.().catch(() => false)));
      } else {
        this.mode.set('browser');
      }
    })();
    return this.ready;
  }

  async list(): Promise<ProjectSummary[]> {
    await this.init();
    if (this.db && this.uid) {
      try {
        const snap = await this.db.collection(`data/users/${this.uid}`).get();
        return snap.docs
          .filter((d) => d.exists)
          .map((d) => this.summarize(d.data() as unknown as Project))
          .sort((a, b) => b.updatedAt - a.updatedAt);
      } catch {
        this.lastError.set(this.i18n.t('persist.read'));
        return [];
      }
    }
    return Object.values(this.readLocal())
      .map((p) => this.summarize(p))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async load(id: string): Promise<Project | null> {
    await this.init();
    // A save still in flight lands first, so switching back to a tab shows its latest state.
    await this.writeChains.get(id);
    if (this.db && this.uid) {
      const path = this.projectPath(id);
      const snap = await this.db.doc(path).get();
      if (!snap.exists) return null;
      return this.withFiles(path, snap.data()!) as unknown as Project;
    }
    return this.readLocal()[id] ?? null;
  }

  save(project: Project): Promise<void> {
    const previous = this.writeChains.get(project.id) ?? Promise.resolve();
    const next = previous.then(() => this.write(project)).catch(() => undefined);
    this.writeChains.set(project.id, next);
    return next;
  }

  async remove(id: string): Promise<void> {
    await this.init();
    if (this.db && this.uid) {
      await this.removeDoc(this.projectPath(id));
      return;
    }
    const all = this.readLocal();
    delete all[id];
    this.writeLocal(all);
  }

  /** Deletes every saved project, after any write still in flight has landed. */
  async removeAll(): Promise<void> {
    await this.init();
    await Promise.all(this.writeChains.values());
    this.writeChains.clear();
    if (this.db && this.uid) {
      const snap = await this.db.collection(`data/users/${this.uid}`).get();
      await Promise.all(snap.docs.map((d) => this.removeDoc(this.projectPath(d.id))));
      return;
    }
    this.writeLocal({});
  }

  // ---- skill library ------------------------------------------------------

  async listLibrary(): Promise<LibraryEntry[]> {
    await this.init();
    if (!this.db || !this.libraryAvailable()) return [];
    try {
      const snap = await this.db.collection('library').get();
      const entries = await Promise.all(
        snap.docs
          .filter((d) => d.exists)
          .map(async (d) => ({ ...((await this.withFiles(`library/${d.id}`, d.data()!)) as unknown as LibraryEntry), id: d.id })),
      );
      return entries.filter((e) => Array.isArray(e.files)).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  /** Throws a StoreError when the store turns the write down. */
  async saveLibrary(entry: LibraryEntry): Promise<void> {
    await this.init();
    if (!this.db || !this.libraryAvailable()) throw new StoreError('refused', 'unavailable', '');
    await this.writeDoc(`library/${entry.id}`, JSON.parse(JSON.stringify(entry)) as Record<string, unknown>);
  }

  // ---- documents with files that may be split -----------------------------

  /** Writes a document; when it is too large for one, its `files` go to chunk documents written first. */
  private async writeDoc(path: string, body: Record<string, unknown>): Promise<void> {
    const db = this.db!;
    const previous = this.chunkCounts.get(path) ?? 0;
    let main = body;
    let count = 0;
    if (byteSize(body) > INLINE_LIMIT) {
      const text = JSON.stringify(body['files'] ?? []);
      count = Math.ceil(text.length / CHUNK_CHARS);
      try {
        for (let i = 0; i < count; i++) {
          await db.doc(`${path}/chunks/${i}`).set({ i, data: text.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS) });
        }
      } catch (error) {
        throw toStoreError(error);
      }
      main = { ...body, files: [], chunks: count };
    }
    try {
      await db.doc(path).set(main);
    } catch (error) {
      throw toStoreError(error);
    }
    this.chunkCounts.set(path, count);
    // Chunks left over from a larger earlier version are dropped; failing to drop them is harmless.
    for (let i = count; i < previous; i++) await db.doc(`${path}/chunks/${i}`).delete().catch(() => undefined);
  }

  /** Puts a split document's files back together. */
  private async withFiles(path: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
    const count = typeof data['chunks'] === 'number' ? data['chunks'] : 0;
    this.chunkCounts.set(path, count);
    if (!count) return data;
    const snap = await this.db!.collection(`${path}/chunks`).get();
    const parts = snap.docs
      .filter((d) => d.exists)
      .map((d) => d.data() as { i: number; data: string })
      .filter((c) => c.i < count)
      .sort((a, b) => a.i - b.i);
    if (parts.length !== count) throw new Error('chunks missing');
    const files = JSON.parse(parts.map((c) => c.data).join('')) as ProjectFile[];
    const { chunks: _chunks, ...rest } = data;
    return { ...rest, files };
  }

  private async removeDoc(path: string): Promise<void> {
    const db = this.db!;
    const snap = await db.doc(path).get();
    const count = snap.exists && typeof snap.data()!['chunks'] === 'number' ? (snap.data()!['chunks'] as number) : 0;
    for (let i = 0; i < count; i++) await db.doc(`${path}/chunks/${i}`).delete().catch(() => undefined);
    await db.doc(path).delete();
    this.chunkCounts.delete(path);
  }

  private projectPath(id: string): string {
    return `data/users/${this.uid}/${id}`;
  }

  private async write(project: Project): Promise<void> {
    await this.init();
    const body = JSON.parse(JSON.stringify({ ...project, isDraft: false })) as Record<string, unknown>;
    try {
      if (this.db && this.uid) {
        await this.writeDoc(this.projectPath(project.id), body);
      } else {
        const all = this.readLocal();
        all[project.id] = body as unknown as Project;
        this.writeLocal(all);
      }
      this.lastError.set(null);
    } catch (error) {
      const reason = error instanceof StoreError ? error.reason : 'failed';
      this.lastError.set(this.i18n.t(reason === 'full' ? 'persist.full' : reason === 'refused' ? 'persist.refused' : 'persist.failed'));
      throw error;
    }
  }

  private summarize(p: Project): ProjectSummary {
    return {
      id: p.id,
      name: p.spec?.name || this.i18n.t('header.untitled'),
      kind: p.spec?.kind ?? 'skill',
      updatedAt: p.updatedAt ?? 0,
      libraryId: p.libraryId,
      localSkill: p.localSkill,
    };
  }

  private readLocal(): Record<string, Project> {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, Project>;
    } catch {
      return {};
    }
  }

  private writeLocal(all: Record<string, Project>): void {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
    } catch {
      this.lastError.set(this.i18n.t('persist.local'));
    }
  }
}

function byteSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * The store answers `invalid_argument` both for a malformed write and for one the access rules turn
 * down; since sizes are handled by chunking, here it means the write was refused.
 */
function toStoreError(error: unknown): StoreError {
  const code = (error as { code?: string })?.code ?? '';
  const message = (error as { message?: string })?.message ?? '';
  console.warn('[skill-workshop] store write rejected:', code, message);
  if (code === 'quota_exceeded') return new StoreError('full', code, message);
  if (code === 'invalid_argument' || code === 'transform_error' || code === 'not_granted' || code === 'revoked') {
    return new StoreError('refused', code, message);
  }
  return new StoreError('failed', code, message);
}
