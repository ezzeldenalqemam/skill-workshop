// Development-only stand-in for the claude.ai runtime, so every Claude-backed button can be exercised
// on `ng serve`. Loaded only by the development build and only when the URL has `?mock-claude`.
// It never ships: the production build (and so the published artifact) does not include it.
(function () {
  const params = new URLSearchParams(location.search);
  if (!params.has('mock-claude')) return;
  // `&slow` holds each reply for a few seconds, to see the loading states.
  const THINK = params.has('slow') ? 4000 : 300;

  const wait = (ms, signal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject({ code: 'cancelled', message: 'Stopped' });
      });
    });

  const textOf = (input) => (typeof input === 'string' ? input : input.map((m) => m.content).join('\n'));
  const MAP = 'flowchart TD\n  A[Idea] --> B[SKILL.md]\n  B --> C[Result]';

  window.__mockLog = [];
  const record = (entry) => window.__mockLog.push(entry);

  async function stream(opts, words) {
    let text = '';
    for (const word of words) {
      await wait(120, opts?.signal);
      text += (text ? ' ' : '') + word;
      opts?.onText?.({ text, delta: word });
    }
    return text;
  }

  async function sample(input, opts = {}) {
    const prompt = textOf(input);
    record({ kind: 'sample', tools: (opts.tools || []).map((t) => t.name), images: opts.images ? opts.images.length : 0 });
    const tool = (name) => opts.tools?.find((t) => t.name === name);
    await wait(THINK, opts.signal);
    if (!opts.tools) return { text: '```mermaid\n' + MAP + '\n  C --> D[Map only]\n```', truncated: false };
    const files = await tool('list_files')?.execute({});
    if (/idea map|set the idea map only|map only/i.test(prompt) && !/complete/i.test(prompt)) {
      await tool('set_map')?.execute({ mermaid: MAP });
    } else {
      const existing = Array.isArray(files) && files.some((f) => f.path === 'SKILL.md');
      if (existing) await tool('read_file')?.execute({ path: 'SKILL.md' });
      await tool('write_files')?.execute({
        files: [
          { path: 'SKILL.md', content: '---\nname: mock-skill\ndescription: Written by the local mock.\n---\n\n# Mock skill\n\nUpdated ' + new Date().toISOString() + '\n' },
          { path: 'references/notes.md', content: '# Notes\n' },
        ],
      });
      await tool('set_map')?.execute({ mermaid: MAP });
    }
    const text = await stream(opts, ['Done', '(mock).', 'Files', 'and', 'map', 'updated.']);
    return { text, truncated: false };
  }

  sample.json = async (input, opts = {}) => {
    const prompt = textOf(input);
    record({ kind: 'json', images: opts.images ? opts.images.length : 0 });
    await wait(400, opts.signal);
    // Brief suggestions: each requested field gets a value built from the idea.
    const suggest = /^SUGGEST: (.*)$/m.exec(prompt);
    if (suggest) {
      const idea = (/^IDEA: (.*)$/m.exec(prompt)?.[1] ?? 'idea').slice(0, 30);
      const shapes = {
        name: 'mock-' + (idea.match(/[A-Za-z]+/g) ?? ['skill']).join('-').toLowerCase(),
        triggers: `${idea}، راجع هذا، check this`,
        details: `١. فهم: ${idea}
٢. التنفيذ
٣. عرض النتيجة`,
        examples: `Input: ${idea}
Output: done`,
        constraints: `لا تتجاوز نطاق: ${idea}`,
      };
      return Object.fromEntries(JSON.parse(suggest[1]).map((k) => [k, shapes[k] ?? idea]));
    }
    // Translation after a language switch: tag each text with the target language.
    const items = /^ITEMS: (.*)$/m.exec(prompt);
    if (items) {
      const tag = /into formal Modern Standard Arabic/.test(prompt) ? 'بالعربية' : 'EN';
      const explanation = /\nEXPLANATION:\n([\s\S]*)$/.exec(prompt)?.[1];
      return {
        items: JSON.parse(items[1]).map((s) => `${s} ${tag}`),
        ...(explanation ? { explanation: `${explanation}\n\n(${tag})` } : {}),
      };
    }
    if (prompt.includes('"questions"')) {
      return {
        questions: [
          { id: 'q1', question: 'Which files should it review?', hint: 'Only staged .scss files' },
          { id: 'q2', question: 'Should it fix issues or only report them?', hint: 'Report only' },
        ],
      };
    }
    if (prompt.includes('"explanation"')) {
      return {
        summary: 'A mock explanation of the uploaded files.',
        explanation: '## Summary\n\nExplained by the local mock.\n\n## Files\n\n| File | Purpose |\n|---|---|\n| SKILL.md | Entry point |\n',
        map: MAP,
        spec: { kind: 'skill', name: 'mock-imported', idea: 'Imported and explained by the mock.' },
      };
    }
    return { reply: 'JSON mode reply (mock).', writes: [{ path: 'SKILL.md', content: '# Mock (json)\n' }], map: MAP };
  };

  sample.limits = async () => ({
    tools: !new URLSearchParams(location.search).has('no-tools'),
    images: { maxCount: 5, maxInputBytes: 20 * 1024 * 1024, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] },
  });

  // A db kept in localStorage under its own key, with the same doc/collection shape the page uses.
  const DB_KEY = 'skill-workshop.mock-db';
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(DB_KEY) || '{}');
    } catch {
      return {};
    }
  };
  const writeAll = (all) => localStorage.setItem(DB_KEY, JSON.stringify(all));
  const snapshot = (path, data) => ({ id: path.split('/').pop(), exists: data !== undefined, data: () => data });
  const db = {
    doc: (path) => ({
      id: path.split('/').pop(),
      get: async () => snapshot(path, read()[path]),
      set: async (data) => {
        const all = read();
        all[path] = data;
        writeAll(all);
        record({ kind: 'db.set', path });
      },
      delete: async () => {
        const all = read();
        delete all[path];
        writeAll(all);
        record({ kind: 'db.delete', path });
      },
    }),
    collection: (path) => ({
      doc: (id) => db.doc(path + '/' + id),
      get: async () => ({
        docs: Object.entries(read())
          .filter(([key]) => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'))
          .map(([key, data]) => snapshot(key, data)),
      }),
    }),
  };

  // A fake ~/.claude/skills folder for the host:skill-files MCP server, kept in localStorage.
  const FS_KEY = 'skill-workshop.mock-fs';
  const ROOT = 'C:\\Users\\mock\\.claude\\skills';
  const readFs = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(FS_KEY) || 'null');
      if (saved) return saved;
    } catch {}
    return {
      'scss-review/SKILL.md': '---\nname: scss-review\ndescription: Reviews SCSS files before commit.\n---\n\n# SCSS review\n\n1. Read the changed files.\n2. Report issues.\n',
      'scss-review/references/rules.md': '# Rules\n\n- Logical properties only.\n',
      'commit-writer/SKILL.md': '---\nname: commit-writer\ndescription: Writes clear commit messages.\n---\n\n# Commit writer\n',
    };
  };
  const writeFs = (files) => localStorage.setItem(FS_KEY, JSON.stringify(files));
  const rel = (p) => p.replace(ROOT, '').replace(/^[\\/]+/, '').split(/[\\/]+/).join('/');
  const textResult = (text) => ({ content: [{ type: 'text', text }], payload: text });
  const treeOf = (files, base) => {
    const root = [];
    for (const key of Object.keys(files).filter((k) => k.startsWith(base + '/'))) {
      let level = root;
      const parts = key.slice(base.length + 1).split('/');
      parts.forEach((part, i) => {
        let node = level.find((n) => n.name === part);
        if (!node) {
          node = i === parts.length - 1 ? { name: part, type: 'file' } : { name: part, type: 'directory', children: [] };
          level.push(node);
        }
        level = node.children || level;
      });
    }
    return root;
  };
  const mcp = {
    callTool: async (server, tool, input = {}) => {
      record({ kind: 'mcp', tool, path: input.path ? rel(input.path) : undefined });
      if (server !== 'host:skill-files') throw { code: 'server_not_connected', message: 'no such server' };
      if (new URLSearchParams(location.search).has('no-computer')) throw { code: 'server_not_connected', message: 'not in the app' };
      const files = readFs();
      const p = input.path ? rel(input.path) : '';
      switch (tool) {
        case 'list_allowed_directories':
          return textResult('Allowed directories:\n' + ROOT);
        case 'list_directory': {
          const names = new Set(Object.keys(files).filter((k) => !p || k.startsWith(p + '/')).map((k) => (p ? k.slice(p.length + 1) : k).split('/')[0]));
          return textResult([...names].map((n) => (Object.keys(files).some((k) => k.startsWith((p ? p + '/' : '') + n + '/')) ? '[DIR] ' : '[FILE] ') + n).join('\n'));
        }
        case 'directory_tree':
          return textResult(JSON.stringify(treeOf(files, p)));
        case 'read_text_file':
          if (!(p in files)) throw { code: 'tool_error', message: 'ENOENT ' + p };
          return { content: [{ type: 'text', text: files[p] }], structuredContent: { content: files[p] } };
        case 'read_media_file':
          throw { code: 'tool_error', message: 'no media in mock' };
        case 'create_directory':
          return textResult('Successfully created directory ' + p);
        case 'write_file':
          files[p] = input.content;
          writeFs(files);
          return textResult('Successfully wrote to ' + p);
        default:
          throw { code: 'tool_error', message: 'unknown tool ' + tool };
      }
    },
  };

  const caps = {
    sample,
    mcp,
    db,
    user: { id: async () => 'mock-user', isOwner: async () => true },
    downloads: {
      save: async ({ filename, data }) => {
        record({ kind: 'download', filename, size: data?.size ?? data?.length ?? 0 });
        return { status: 'saved' };
      },
    },
  };

  window.claude = { use: async (name) => caps[name] ?? null };
  console.info('[claude-mock] active');
})();
