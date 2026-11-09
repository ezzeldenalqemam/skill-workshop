# skill-workshop

**ورشة المهارات / Skill Workshop**: a page for building, reading, and maintaining Claude skills. It runs as a claude.ai Artifact, so it has no backend of its own. Claude calls use the viewer's own account.

- Build a skill or a plugin from a short brief, with reference files, images, and links.
- Open an existing skill (ZIP, folder, or files) and have Claude explain it and draw its idea map.
- Keep your skills in a private library ("مهاراتي"), open several as tabs, edit them, and install them in claude.ai or Claude Code.
- English (the default, LTR) and Arabic (RTL), light and dark themes, and accessibility tools. The idea map is always written in English.

## Run it locally

You need Node.js 20 or newer.

```bash
npm ci
npm start
```

Then open http://localhost:4200/?mock-claude

Locally, Claude's buttons talk to a mock (`src/dev/claude-mock.js`) that returns fixed replies. Real Claude only answers when the page is published as an Artifact on claude.ai.

Mock options, added to the URL:

| Option | Effect |
|---|---|
| `&slow` | Each reply waits 4 seconds, to see loading states |
| `&no-tools` | Claude answers in JSON mode instead of calling page tools |

## Publish your own copy on claude.ai

```bash
npm run build:artifact
```

Then ask Claude Code to publish `dist/artifact/index.html` as an Artifact, with the other files in `dist/artifact` as its files and these capabilities:

```
sample: { images: true }, db: { rules: [{ path: "library", read: "owner", write: "owner" }] }, downloads: true, user: {}
```

The `library` rule keeps your saved skills readable and writable by you alone, even when you share the page. `images: true` lets Claude see the reference images you add.

## Project layout

| Path | What it holds |
|---|---|
| `src/app/core` | Services: Claude agent, workspace store, persistence, i18n |
| `src/app/features` | Brief, chat, file tree and viewer, idea map, explanation, start screen |
| `src/app/layout` | Header and project tabs |
| `src/app/shared` | Icons, dialogs, popovers, drop zone, accessibility panel |
| `src/assets/scss` | Styles following the AXIS architecture (ITCSS + BEM) |
| `scripts/build-artifact.mjs` | Turns the Angular build into an Artifact page |
