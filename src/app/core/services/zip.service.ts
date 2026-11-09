import { Injectable } from '@angular/core';
import { claudeRuntime } from '../claude/claude-runtime';
import { isGitPath, normalizePath, Project, ProjectFile, slugify, imageMime } from '../models/project.model';

export interface ImportResult {
  files: ProjectFile[];
  skipped: string[];
  /** The upload held a Git repository; its `.git` folder was left out. */
  hasGit: boolean;
}

const MAX_FILE_BYTES = 400 * 1024;
/** Larger images are scaled down to this many pixels on the long side (Claude sees about 1.2 MP anyway). */
const IMAGE_SIDE = 1600;
const KEEP_IMAGE_BYTES = 700 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}


/** Reads dropped files and zips into text files, and packs a project back into a zip. */
@Injectable({ providedIn: 'root' })
export class ZipService {
  async import(list: FileList | File[]): Promise<ImportResult> {
    const result: ImportResult = { files: [], skipped: [], hasGit: false };
    for (const file of Array.from(list)) {
      if (/\.zip$/i.test(file.name)) {
        const inner = await this.readZip(file);
        result.files.push(...inner.files);
        result.skipped.push(...inner.skipped);
        result.hasGit ||= inner.hasGit;
        continue;
      }
      if (isGitPath(file.webkitRelativePath || file.name)) {
        result.hasGit = true;
        continue;
      }
      const picked = normalizePath(file.webkitRelativePath || file.name);
      if (picked && imageMime(picked)) {
        const image = await this.readImage(file, picked);
        if (image) result.files.push(image);
        else result.skipped.push(file.name);
        continue;
      }
      const text = await this.readText(new Uint8Array(await file.arrayBuffer()));
      const path = picked;
      if (text === null || !path) result.skipped.push(file.name);
      else result.files.push({ path, content: text });
    }
    // A picked folder arrives as `<folder>/...` paths; drop the shared top folder like a zip's.
    result.files = this.stripSharedRoot(result.files);
    return result;
  }

  /** Offers `<name>.zip` to the viewer through the artifact's downloads capability. */
  async export(project: Project): Promise<'saved' | 'declined' | 'unavailable'> {
    const downloads = await claudeRuntime.downloads();
    if (!downloads) return 'unavailable';
    const { default: JSZip } = await import('jszip');
    const root = slugify(project.spec.name, 'my-skill');
    const zip = new JSZip();
    const folder = zip.folder(root)!;
    for (const file of project.files) folder.file(file.path, file.content, file.encoding === 'base64' ? { base64: true } : undefined);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    try {
      await downloads.save({ filename: `${root}.zip`, data: blob });
      return 'saved';
    } catch (error) {
      const code = (error as { code?: string })?.code;
      return code === 'declined' ? 'declined' : 'unavailable';
    }
  }

  private async readZip(file: File): Promise<ImportResult> {
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(file);
    const result: ImportResult = { files: [], skipped: [], hasGit: Object.keys(zip.files).some(isGitPath) };
    const entries = Object.values(zip.files).filter((e) => !e.dir && !isGitPath(e.name) && !/(^|\/)(__MACOSX|\.DS_Store)/.test(e.name));
    for (const entry of entries) {
      const entryPath = normalizePath(entry.name);
      const mime = entryPath ? imageMime(entryPath) : null;
      if (entryPath && mime) {
        const bytes = await entry.async('uint8array');
        if (bytes.byteLength > MAX_IMAGE_BYTES) result.skipped.push(entry.name);
        else result.files.push({ path: entryPath, content: toBase64(bytes), encoding: 'base64', mime });
        continue;
      }
      const text = await this.readText(await entry.async('uint8array'));
      const path = entryPath;
      if (text === null || !path) result.skipped.push(entry.name);
      else result.files.push({ path, content: text });
    }
    result.files = this.stripSharedRoot(result.files);
    return result;
  }

  /** `my-skill/SKILL.md, my-skill/x.md` -> `SKILL.md, x.md`, so a re-imported zip lands at the root. */
  private stripSharedRoot(files: ProjectFile[]): ProjectFile[] {
    const tops = new Set(files.map((f) => f.path.split('/')[0]));
    if (tops.size !== 1 || files.some((f) => !f.path.includes('/'))) return files;
    const top = [...tops][0].length + 1;
    return files.map((f) => ({ ...f, path: f.path.slice(top) }));
  }

  /** UTF-8 text, or null for anything binary or too large to be useful as context. */
  /** A picked image as a reference file: kept as is when small, otherwise scaled down to WebP. */
  private async readImage(file: File, path: string): Promise<ProjectFile | null> {
    const mime = imageMime(path)!;
    if (file.size <= KEEP_IMAGE_BYTES) {
      return { path, content: toBase64(new Uint8Array(await file.arrayBuffer())), encoding: 'base64', mime };
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.85));
      if (!blob || blob.size > MAX_IMAGE_BYTES) return null;
      return { path: path.replace(/\.[a-z0-9]+$/i, '.webp'), content: toBase64(new Uint8Array(await blob.arrayBuffer())), encoding: 'base64', mime: 'image/webp' };
    } catch {
      return null;
    }
  }

  private async readText(bytes: Uint8Array): Promise<string | null> {
    if (bytes.byteLength > MAX_FILE_BYTES) return null;
    const sample = bytes.subarray(0, 8000);
    if (sample.includes(0)) return null;
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return null;
    }
  }
}
