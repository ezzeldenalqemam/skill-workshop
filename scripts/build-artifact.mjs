// Turns the Angular production build into a claude.ai Artifact page.
// The Artifact host supplies its own <!doctype>/<html>/<head>/<body>, so the page is written as body
// content: title + meta first, then the stylesheets, the app root and the module scripts that
// `ng build` emitted. Bundles are copied next to it and published as the artifact's files.
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const browser = 'dist/skill-workshop/browser';
const out = 'dist/artifact';
const html = readFileSync(join(browser, 'index.html'), 'utf8');

const title = /<title>[\s\S]*?<\/title>/.exec(html)?.[0] ?? '<title>Skill Workshop</title>';
const tags = html.match(/<link rel="(?:stylesheet|modulepreload)"[^>]*>|<script[^>]*><\/script>/g) ?? [];

const page = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  ...tags.filter((t) => t.includes('stylesheet')),
  '<app-root></app-root>',
  ...tags.filter((t) => !t.includes('stylesheet')),
  '',
].join('\n');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), page);
const assets = readdirSync(browser).filter((f) => /\.(js|css)$/.test(f));
for (const file of assets) copyFileSync(join(browser, file), join(out, file));
console.log(`artifact page + ${assets.length} files -> ${out}`);
console.log(JSON.stringify(assets));
