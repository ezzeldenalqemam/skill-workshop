# Accessibility Audit Plan

## Scope & method
UI Stack: Angular 19 (standalone components, `@if`/`@for` control flow, signals), single app at the repo root, one route (`/`) that renders a three-bench workshop (specs, workspace, Claude chat). Inspected `package.json`, `angular.json`, `src/main.ts`, `src/index.html`, every component folder under `src/app/` by glob, selector fan-out by grep, the one shared directive, and template sizes. No i18n library: user-visible text is Arabic literals in templates/TS, so the localization idiom is "literal Arabic text" (no locale files to sync). No dead-code candidates (every component has ≥ 1 consumer). Not opened: `node_modules/`, `dist/`, `.angular/`, the Mermaid SVG that is generated at runtime. No open questions before Batch 1.

## Batches

### Batch 1 — Shared controls
- Scope: `shared/icon` (`app-icon`), `shared/drop-zone` (`app-drop-zone`), template-less control styles `src/assets/scss/components/` (`c-button`, `c-field`, `c-chip`, `c-markdown`), `utilities/_visually-hidden.utility.scss`
- Why this order: `app-icon` has 13 consumers and `c-button`/`c-field` style every control in the app; drop-zone backs both file-import entry points (2)
- Status: DONE

### Batch 2 — App shell, popovers and dialogs
- Scope: `app.component` (skip link, phone bench switcher, global live region), `layout/app-header`, `shared/popover/anchored-popover.directive`, `shared/appearance-menu`, `shared/accessibility-panel`, `shared/read-aloud-player`
- Why this order: wraps every bench; owns the only live region and both native `popover` dialogs; the directive moves focus app-wide
- Status: DONE

### Batch 3 — Brief, chat and explanation features
- Scope: `features/spec-panel` (main form, required-field validation), `features/chat-panel` (message list, streaming status, clarifying-questions form, composer), `features/explain-panel`, `features/idea-map` (Mermaid SVG figure, source editor)
- Why this order: the primary forms and the streamed Claude output; depends on Batch 1 field/button patterns
- Status: DONE

### Batch 4 — Custom interactive widgets
- Scope: `features/workspace` (hand-rolled tablist with roving tabindex), `features/file-tree` (folder disclosure buttons, `aria-current` file rows, new-file form), `features/file-viewer` (preview/edit toggle, editor Tab-key trap, inline rename and delete confirm, sanitized Markdown via `core/services/markdown.service.ts`)
- Why this order: highest keyboard/ARIA risk; fix pattern differs from ordinary markup
- Status: DONE

### Batch 5 — Final runtime verification
- Scope: `/` on the dev server (no auth). States to cover: example project loaded; appearance menu open; accessibility panel open; each workspace tab (files, map, explain); phone width with each bench; glass/solid/blueprint × light/dark spot checks. Claude-backed states (streaming, questions) are only reachable inside claude.ai — test their static markup via the example chat message
- Status: DONE
