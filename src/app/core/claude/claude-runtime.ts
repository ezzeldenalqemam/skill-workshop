/**
 * Thin, typed access to the claude.ai artifact runtime (`window.claude.use`).
 * Every capability may be absent (page opened outside a Claude viewer, consent declined, plan
 * without the feature), so each getter resolves `null` instead of throwing.
 */

export type ModelTier = 'quick' | 'default' | 'complex';

export interface SampleMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface SampleTool {
  name: string;
  description: string;
  inputSchema?: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
  execute(input: Record<string, unknown>, context: { signal: AbortSignal }): unknown;
}

export interface SampleOptions {
  onText?: (update: { text: string; delta: string }) => void;
  signal?: AbortSignal;
  tools?: SampleTool[];
  modelTier?: ModelTier;
  cache?: boolean;
}

export interface SampleError {
  code: string;
  message: string;
  text?: string;
}

export interface SampleFn {
  (input: string | SampleMessage[], options?: SampleOptions): Promise<{ text: string; truncated: boolean }>;
  json<T = unknown>(input: string | SampleMessage[], options?: SampleOptions): Promise<T>;
  limits(): Promise<{ maxPromptBytes: number; tools?: { maxCount: number } }>;
}

export interface DocSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface DocRef {
  id: string;
  get(): Promise<DocSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}

export interface CollectionRef {
  doc(id: string): DocRef;
  get(): Promise<{ docs: DocSnapshot[] }>;
}

export interface Db {
  doc(path: string): DocRef;
  collection(path: string): CollectionRef;
}

export interface UserCap {
  id(): Promise<string | null>;
  isOwner?(): Promise<boolean>;
}

export interface DownloadsCap {
  save(request: { filename: string; data: Blob | string | ArrayBuffer }): Promise<{ status: 'saved' | 'delivered' }>;
}

interface ClaudeHost {
  use(name: string): Promise<unknown>;
}

declare global {
  interface Window {
    claude?: ClaudeHost;
  }
}

function use<T>(name: string): Promise<T | null> {
  const host = globalThis.window?.claude;
  if (!host?.use) return Promise.resolve(null);
  return host.use(name).then(
    (cap) => (cap ?? null) as T | null,
    () => null,
  );
}

export const claudeRuntime = {
  sample: () => use<SampleFn>('sample'),
  db: () => use<Db>('db'),
  user: () => use<UserCap>('user'),
  downloads: () => use<DownloadsCap>('downloads'),
};

export function isSampleError(value: unknown): value is SampleError {
  return !!value && typeof value === 'object' && 'code' in value;
}
