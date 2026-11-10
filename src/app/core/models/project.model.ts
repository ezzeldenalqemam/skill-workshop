import type { Lang, MessageKey } from '../i18n/messages';

export type ProjectKind = 'skill' | 'plugin' | 'command' | 'hook';

export interface ProjectSpec {
  kind: ProjectKind;
  name: string;
  idea: string;
  triggers: string;
  details: string;
  examples: string;
  constraints: string;
  /** Answers collected from Claude's "ask me" questions. */
  clarifications: string;
}

export interface ProjectFile {
  path: string;
  /** Text, or for an image the base64 bytes (see `encoding`). */
  content: string;
  /** Set on images: `content` holds base64, not text. */
  encoding?: 'base64';
  mime?: string;
}

/** Image types a reference can be: the ones Claude accepts as images. */
export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function imageMime(path: string): string | null {
  return IMAGE_TYPES[/\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase() ?? ''] ?? null;
}

export function isImageFile(file: ProjectFile): boolean {
  return file.encoding === 'base64';
}

/** An image file back as bytes, to show it or hand it to Claude. */
export function fileToBlob(file: ProjectFile): Blob {
  const binary = atob(file.content);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: file.mime ?? imageMime(file.path) ?? 'application/octet-stream' });
}

/** The two kinds the workshop builds; older projects of other kinds open as plugins. */
export const BUILD_KINDS: ProjectKind[] = ['skill', 'plugin'];

export function buildKind(kind: ProjectKind | undefined): ProjectKind {
  return kind === 'skill' ? 'skill' : kind ? 'plugin' : 'skill';
}

export interface ClarifyingQuestion {
  id: string;
  question: string;
  hint?: string;
  answer?: string;
}

export type MessageStatus = 'thinking' | 'streaming' | 'done' | 'error' | 'stopped';

/** One thing Claude did through the page tools; rendered in the current UI language. */
export interface ActivityEntry {
  kind: 'write' | 'read' | 'delete' | 'map' | 'mapError' | 'explain' | 'spec' | 'local';
  path?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** The page's own wording for this message: shown in the current UI language instead of `text`. */
  textKey?: MessageKey;
  textParams?: Record<string, string | number>;
  status?: MessageStatus;
  /** What Claude did through the page tools, in order. */
  activity?: ActivityEntry[];
  questions?: ClarifyingQuestion[];
  questionsAnswered?: boolean;
  /** The brief a Build was sent with, shown under the request as question and answer. */
  brief?: BriefItem[];
  createdAt: number;
}

export interface BriefItem {
  /** The question's label key, so it reads in the current language. */
  key: MessageKey;
  value: string;
}

export interface Project {
  id: string;
  spec: ProjectSpec;
  files: ProjectFile[];
  map: string;
  chat: ChatMessage[];
  /** Claude's Arabic walkthrough of an imported skill or plugin (Markdown). */
  explanation?: string;
  updatedAt: number;
  /** The map was edited by hand and the files have not been updated to match it yet. */
  mapEdited?: boolean;
  /** The map and explanation in the other UI language, kept while neither changes, so switching back is instant. */
  translations?: Partial<Record<Lang, { map: string; explanation: string }>>;
  /** The UI language the map and explanation were last written in. */
  contentLang?: Lang;
  /** A blank project that is not saved until the user first changes it (first visit, New, after Reset). */
  isDraft?: boolean;
  /** The imported skill came from a Git repository; its `.git` folder was not imported. */
  hasGit?: boolean;
  /** The entry in the user's skill library this project opens from and saves back to. */
  libraryId?: string;
  /** The folder under the computer's Claude Code skills folder this project is written back to. */
  localSkill?: string;
  /** A plugin's map part by part: the order to use them in, and one small flow per part. */
  mapPlan?: MapPlan;
}

/** One skill, command, agent or hook of a plugin, with what it does and its own flow. */
export interface MapComponent {
  name: string;
  kind: 'skill' | 'command' | 'agent' | 'hook';
  /** One or two plain English sentences: what it does and when to use it. */
  description: string;
  /** Mermaid flowchart of this part alone. */
  map: string;
}

export interface MapPlan {
  /** Part names in the order the user should use them; empty when the order does not matter. */
  order: string[];
  /** One English sentence on why this order, or that any order works. */
  orderNote: string;
  components: MapComponent[];
}

/** The parts a plugin is made of, found from its files: skills, commands, agents and hooks. */
export function componentsOf(files: ProjectFile[]): { name: string; kind: MapComponent['kind']; path: string }[] {
  const found = new Map<string, { name: string; kind: MapComponent['kind']; path: string }>();
  const add = (kind: MapComponent['kind'], name: string, path: string) => {
    if (!found.has(`${kind}:${name}`)) found.set(`${kind}:${name}`, { kind, name, path });
  };
  for (const { path } of files) {
    let m: RegExpExecArray | null;
    if ((m = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/i.exec(path))) add('skill', m[1], path);
    else if (/^SKILL\.md$/i.test(path)) add('skill', 'SKILL.md', path);
    else if ((m = /(?:^|\/)commands\/(.+)\.md$/i.exec(path))) add('command', m[1].replace(/\//g, ':'), path);
    else if ((m = /(?:^|\/)agents\/([^/]+)\.md$/i.exec(path))) add('agent', m[1], path);
    else if (/(?:^|\/)hooks\/hooks\.json$/i.test(path)) add('hook', 'hooks', path);
  }
  return [...found.values()];
}

/** Where a saved skill came from: Claude Code on this computer, the claude.ai account, or this workshop. */
export type LibraryOrigin = 'code' | 'claude' | 'workshop';

/** One skill in the owner's private library (`library/<id>` in the artifact's store). */
export interface LibraryEntry {
  id: string;
  name: string;
  kind: ProjectKind;
  description: string;
  origin: LibraryOrigin;
  files: ProjectFile[];
  updatedAt: number;
  /** Content hash of the files as last installed in Claude; equal to the current hash means "installed as is". */
  installedHash?: string;
}

/** Where the open skill stands between the workshop, the library and Claude. */
export type SyncState = 'empty' | 'notSaved' | 'unsaved' | 'new' | 'changed' | 'installed';

/** Order-independent FNV-1a hash of a skill's files, to tell whether two copies match. */
export function filesHash(files: ProjectFile[]): string {
  let h = 0x811c9dc5;
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    const text = `${f.path}\u0000${f.content}\u0000`;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, '0');
}

/** A library entry on its own: installed as is, changed since it was installed, or never installed. */
export function entryState(entry: LibraryEntry): 'installed' | 'changed' | 'new' {
  if (!entry.installedHash) return 'new';
  return entry.installedHash === filesHash(entry.files) ? 'installed' : 'changed';
}

/** `name` and `description` from a SKILL.md frontmatter, when it has them. */
export function skillMeta(content: string): { name?: string; description?: string } {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];
  if (!fm) return {};
  const read = (key: string) => {
    const m = new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(fm);
    if (!m) return undefined;
    let value = m[1].trim();
    if (/^[>|][-+]?$/.test(value)) {
      const rest = fm.slice(fm.indexOf(m[0]) + m[0].length).split(/\r?\n/);
      const lines: string[] = [];
      for (const line of rest.slice(1)) {
        if (/^\S/.test(line)) break;
        lines.push(line.trim());
      }
      value = lines.join(' ').trim();
    }
    return value.replace(/^(['"])(.*)\1$/, '$2') || undefined;
  };
  return { name: read('name'), description: read('description') };
}

export interface ProjectSummary {
  id: string;
  libraryId?: string;
  localSkill?: string;
  name: string;
  kind: ProjectKind;
  updatedAt: number;
}

export const KIND_LABELS: Record<ProjectKind, string> = {
  skill: 'Skill',
  plugin: 'Plugin',
  command: 'Command',
  hook: 'Hook',
};

export function emptySpec(): ProjectSpec {
  return { kind: 'skill', name: '', idea: '', triggers: '', details: '', examples: '', constraints: '', clarifications: '' };
}

export function newId(prefix = 'p'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** kebab-case slug usable as a folder or zip name. */
export function slugify(text: string, fallback = 'my-skill'): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}

/** Best guess at the language of older content that predates `contentLang`: more Arabic letters than Latin ones, code left out. */
export function textLang(text: string): Lang {
  const prose = text.replace(/```[\s\S]*?```|`[^`]*`/g, '').replace(/^\s*(flowchart|graph)\b.*$/gm, '');
  const arabic = prose.match(/[\u0600-\u06FF]/g)?.length ?? 0;
  const latin = prose.match(/[A-Za-z]/g)?.length ?? 0;
  return arabic > latin / 3 ? 'ar' : 'en';
}

/** A path inside a `.git` folder (Git's objects, refs, hooks): never skill content. Windows `\` separators count too. */
export function isGitPath(raw: string): boolean {
  return /(^|\/)\.git(\/|$)/i.test(String(raw ?? '').replace(/\\/g, '/'));
}

/** Normalizes a path Claude or an upload gave us; null when it tries to leave the project. */
export function normalizePath(raw: string): string | null {
  const path = String(raw ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .trim();
  if (!path || path.endsWith('/')) return null;
  if (path.split('/').some((part) => part === '..' || part === '.')) return null;
  return path;
}
