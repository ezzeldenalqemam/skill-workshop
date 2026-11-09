// Runs the official filesystem MCP server on a fixed folder (the Claude Code skills folder),
// and adds one tool of its own, `write_skill`, that saves a whole skill in a single call.
//
// 1. Fixed folder: the filesystem server replaces its command-line folders with the client's
//    "roots" whenever the client supports them, and the Claude app does (it would hand over the
//    session's working folder instead of ~/.claude/skills). The roots capability is hidden from the
//    server and roots change notices are dropped, so it keeps the folder it was started with.
// 2. One call per save: the Claude app asks the user to allow each call that writes. Saving a skill
//    file by file meant one request per file and per folder; `write_skill` writes every file of one
//    skill folder at once, so a save is one request. Paths are checked to stay inside the folder.
//
// Usage: node skill-files-server.mjs <path to server-filesystem dist/index.js> <folder>
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [entry, root] = process.argv.slice(2);
if (!entry || !root) {
  process.stderr.write('usage: skill-files-server.mjs <server entry> <folder>\n');
  process.exit(2);
}
const ROOT = path.resolve(root);

const WRITE_SKILL = {
  name: 'write_skill',
  description:
    'Writes the files of one skill or plugin folder inside the skills folder in a single call, creating the folder and any sub-folders. Existing files with the same paths are replaced; other files are left as they are.',
  inputSchema: {
    type: 'object',
    properties: {
      folder: { type: 'string', description: 'Folder name directly under the skills folder, e.g. "px-to-rem".' },
      files: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path inside the folder, with forward slashes, e.g. "skills/x/SKILL.md".' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      },
    },
    required: ['folder', 'files'],
  },
  annotations: { title: 'Save skill files', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const server = spawn(process.execPath, [entry, ROOT], { stdio: ['pipe', 'pipe', 'inherit'] });
server.on('exit', (code) => process.exit(code ?? 0));

const toolListIds = new Set();
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');

// Client → server.
lines(process.stdin, async (line) => {
  const message = parse(line);
  if (!message) return server.stdin.write(line + '\n');
  if (message.method === 'notifications/roots/list_changed') return;
  if (message.method === 'initialize' && message.params?.capabilities?.roots) {
    delete message.params.capabilities.roots;
    return server.stdin.write(JSON.stringify(message) + '\n');
  }
  if (message.method === 'tools/list') toolListIds.add(message.id);
  if (message.method === 'tools/call' && message.params?.name === WRITE_SKILL.name) {
    return send({ jsonrpc: '2.0', id: message.id, result: await writeSkill(message.params.arguments ?? {}) });
  }
  server.stdin.write(line + '\n');
});
process.stdin.on('end', () => server.stdin.end());

// Server → client: the tool list gains write_skill.
lines(server.stdout, (line) => {
  const message = parse(line);
  if (message && toolListIds.has(message.id) && Array.isArray(message.result?.tools)) {
    toolListIds.delete(message.id);
    message.result.tools.push(WRITE_SKILL);
    return send(message);
  }
  process.stdout.write(line + '\n');
});

async function writeSkill({ folder, files }) {
  try {
    if (typeof folder !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(folder)) throw new Error(`Invalid folder name: ${folder}`);
    if (!Array.isArray(files) || !files.length) throw new Error('No files to write.');
    const base = path.join(ROOT, folder);
    const targets = files.map((file) => {
      if (typeof file?.path !== 'string' || typeof file?.content !== 'string') throw new Error('Each file needs a path and text content.');
      const rel = file.path.replace(/\\/g, '/');
      if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.split('/').some((part) => part === '..' || part === '')) throw new Error(`Invalid path: ${file.path}`);
      const full = path.resolve(base, ...rel.split('/'));
      if (!full.startsWith(base + path.sep)) throw new Error(`Path leaves the folder: ${file.path}`);
      return { full, content: file.content, rel };
    });
    for (const target of targets) {
      await mkdir(path.dirname(target.full), { recursive: true });
      await writeFile(target.full, target.content, 'utf8');
    }
    const text = `Wrote ${targets.length} file(s) to ${base}`;
    return { content: [{ type: 'text', text }], structuredContent: { written: targets.map((t) => t.rel), folder: base } };
  } catch (error) {
    return { content: [{ type: 'text', text: String(error?.message ?? error) }], isError: true };
  }
}

function lines(stream, onLine) {
  let pending = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    pending += chunk;
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).replace(/\r$/, '');
      pending = pending.slice(end + 1);
      if (line.trim()) onLine(line);
    }
  });
}

function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
