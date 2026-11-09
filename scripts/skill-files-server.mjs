// Runs the official filesystem MCP server on a fixed folder (the Claude Code skills folder).
//
// The filesystem server replaces its command-line folders with the client's "roots" whenever the
// client supports them, and the Claude app does: it would hand over the session's working folder
// instead of ~/.claude/skills. This wrapper hides the roots capability from the server and drops
// roots change notices, so the server keeps the folder it was started with.
//
// Usage: node skill-files-server.mjs <path to server-filesystem dist/index.js> <folder>
import { spawn } from 'node:child_process';

const [entry, ...folders] = process.argv.slice(2);
if (!entry || !folders.length) {
  process.stderr.write('usage: skill-files-server.mjs <server entry> <folder>\n');
  process.exit(2);
}

const server = spawn(process.execPath, [entry, ...folders], { stdio: ['pipe', 'inherit', 'inherit'] });
server.on('exit', (code) => process.exit(code ?? 0));

let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  pending += chunk;
  let end;
  while ((end = pending.indexOf('\n')) >= 0) {
    const line = pending.slice(0, end);
    pending = pending.slice(end + 1);
    const kept = filter(line);
    if (kept !== null) server.stdin.write(kept + '\n');
  }
});
process.stdin.on('end', () => server.stdin.end());

/** Removes the client's roots capability from `initialize` and drops roots change notices. */
function filter(line) {
  if (!line.trim()) return line;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return line;
  }
  if (message.method === 'notifications/roots/list_changed') return null;
  if (message.method === 'initialize' && message.params?.capabilities?.roots) {
    delete message.params.capabilities.roots;
    return JSON.stringify(message);
  }
  return line;
}
