---
name: skill-workshop
description: Sets up, updates, or opens Skill Workshop (ورشة المهارات), the page for building and maintaining Claude skills and plugins. Downloads the project from GitHub, builds it, and publishes the user's own private copy on claude.ai so Claude works inside it; falls back to running it locally. Use when the user asks to install, set up, run, open, launch or update Skill Workshop, e.g. "set up Skill Workshop", "open the skill workshop", "update the workshop", "نزّل ورشة المهارات", "شغّل ورشة المهارات", "افتح الورشة", "حدّث الورشة".
---

# Skill Workshop setup

Skill Workshop is an Angular app that runs as a claude.ai Artifact. Claude only works inside it once it is **published as an Artifact on the user's own claude.ai account**. Running it locally shows the page with a mock Claude that gives fixed replies. So the goal is always: get the code, build it, publish the user's own copy, and give them the link.

Reply to the user in the language they write in. Keep each progress message to one or two lines. Never sign in for the user, and never publish anything other than the built page.

## Fixed facts

- Repository: `https://github.com/ezzeldenalqemam/skill-workshop.git`
- Default folder: `skill-workshop` inside the current working directory. Use another folder only if the user names one.
- Build command: `npm run build:artifact`. Its last output line is a JSON array of the files to publish beside the page, for example `["chunk-AB12.js","main.js","polyfills.js","styles.css"]`.
- Page to publish: `<folder>/dist/artifact/index.html`
- Capabilities to declare on publish (exactly this object):

```json
{ "sample": { "images": true }, "db": { "rules": [{ "path": "library", "read": "owner", "write": "owner" }] }, "downloads": true, "user": {} }
```

- Where the user's copy is remembered: `<folder>/.workshop.json`, holding `{ "artifactUrl": "<claude.ai artifact link>" }`. Git ignores this file.

## Steps

### 1. Check the tools

Run `git --version`, `node --version` and `npm --version`.

- Node must be 20 or newer.
- If something is missing or too old, tell the user what to install and stop:
  - Node.js LTS: https://nodejs.org
  - Git: https://git-scm.com

### 2. Get or update the code

- If `<folder>/.git` exists and its `origin` is the repository above, run `git -C <folder> pull --ff-only`.
- If `<folder>` exists but is something else, ask the user for another folder. Do not touch it.
- Otherwise run `git clone https://github.com/ezzeldenalqemam/skill-workshop.git <folder>`.
- If the clone or pull fails because of access, the repository may be private. Tell the user they need access to `ezzeldenalqemam/skill-workshop` from its owner, then stop.

### 3. Install and build

In `<folder>`:

```bash
npm ci
npm run build:artifact
```

`npm ci` can take a few minutes the first time. Read the file list from the last line of the build output.

### 4. Publish the user's own copy

This needs the **Artifact** tool (the Claude desktop app's Code tab, or Claude Code signed in with a claude.ai account). If you do not have it, go to step 6.

1. Read `<folder>/.workshop.json` if it exists, and take `artifactUrl` from it.
2. The Artifact tool only publishes files under the working directory or your scratchpad directory. If `<folder>` is outside both, copy `<folder>/dist/artifact` into your scratchpad directory first and publish from that copy.
3. Publish with the Artifact tool:
   - `file_path`: the `index.html` from step 3 (or its scratchpad copy)
   - `root`: the folder that holds it (`dist/artifact` or the scratchpad copy)
   - `files`: the file list from step 3
   - `capabilities`: the exact object above
   - On the first publish only: `icon: "tools"` and `description: "Build, read and maintain Claude skills and plugins."`
   - When `artifactUrl` exists, pass it as `url`. This updates the same page, and the user's projects and saved skills stay.
4. Write the returned link to `<folder>/.workshop.json` as `{ "artifactUrl": "<link>" }`.

If publishing to a saved `url` is refused because the user cannot edit that artifact, publish without `url` (a new copy) and save the new link.

### 5. Hand it over

Tell the user, in a few short lines:

- The link to their Skill Workshop. Open it with the Artifact tool's `open` action if it did not open by itself.
- The page is private to them. To give it to someone else, they use **Share** on the page.
- The first time they press a Claude button, claude.ai asks them to allow the page to use Claude (and to send images).
- Their projects and their skill library ("My skills") are saved in their own account.
- To update later, they ask you to "update Skill Workshop". The same link stays.

### 6. Local fallback (no Artifact tool, or the user asked to run it locally)

In `<folder>`, start the dev server: `npm start`. It always runs on port **38291**, a port kept for Skill Workshop alone; never move it to another port. If 38291 is busy, tell the user which program holds it (on Windows: `Get-NetTCPConnection -LocalPort 38291`) and stop. Use the app's preview or browser tools when you have them; otherwise run it as a background process. Then open:

```
http://localhost:38291/?mock-claude
```

Tell the user plainly that locally the Claude buttons use a mock with fixed replies. Real Claude only works in the published copy on claude.ai. Stop the dev server when they are done, or tell them how to stop it.

## Rules

- Do not change the project's source files during setup.
- Do not commit or push anything to the repository.
- If any step fails, show the error in one or two lines and the likely fix, and stop. Do not invent a link or claim the page is ready when publishing did not succeed.
