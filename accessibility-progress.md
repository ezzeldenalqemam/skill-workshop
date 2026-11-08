# Accessibility Progress

## Repository Profile
- UI Stack: Angular — evidence: `angular.json` at root; `@angular/core` ^19.2 in `package.json`; 14 `*.component.ts` under `src/app/`; `bootstrapApplication` in `src/main.ts`
- Architecture: single app; no backend. Published as a claude.ai Artifact that reaches Claude, storage and downloads through `window.claude.use(...)` capabilities
- Direction: Arabic (RTL, default) and English (LTR), switched at runtime from the header; `core/i18n/i18n.service.ts` sets `<html lang dir>`. Workspace is pinned to the physical left in both. Code/paths isolated with `dir="ltr"` / `unicode-bidi: isolate`
- Runtime requirements: none to render; Claude/db/downloads capabilities resolve `null` outside claude.ai and the UI degrades with visible notices
- Never touch: `node_modules/`, `dist/`, `.angular/`, `public/`

### Angular
- Angular: 19.2, standalone components, `@if`/`@for` control flow, signals + `OnPush`, zone.js (not zoneless)
- Workspace root: `.`
- Localization: in-house `I18nService` + impure `TPipe` (`| t`); single catalogue `src/app/core/i18n/messages.ts` (`ar` formal MSA + `en`, typed `MessageKey`, `en` must define every `ar` key); params as `{name}`. Re-verified 2026-11-03 (profile was stale: app gained i18n after Batch 1)
  - attr idiom: `[attr.aria-label]="'key' | t"`; with params `[attr.aria-label]="'key' | t: { n: x }"`
  - typescript idiom: `this.i18n.t('key', { … })` (inject `I18nService`)
  - locales: ar, en (in sync — compile-time enforced by `Record<MessageKey, string>`)
- UI libs: none (hand-rolled). Native `popover` for menus; `marked` + `DOMPurify` for Markdown preview; Mermaid 10.9.1 loaded from jsDelivr at runtime; JSZip
- Icons: `<app-icon name="…" />` inline SVG, always `aria-hidden="true"`; icon-only buttons carry `aria-label`
- Forms: no Angular Forms module; native inputs bound with `[value]`/`(input)` to signals; error text in `.c-field__error` linked via `aria-describedby`; CVAs: none
- Dynamic UI: `shared/popover/anchored-popover.directive.ts` (positions + focuses popovers); `core/services/announcer.service.ts` feeds the single polite live region in `app.component.html`; no `createComponent` sites
- @angular/cdk: ABSENT   sr-only class: `u-visually-hidden`
- Commands: type-check `npx ng build --configuration development` (AOT template check) | lint: none configured | targeted lint: none | test `npx ng test` (no spec files; Karma needs Chrome) | build `npx ng build`
  - BROKEN: none known

## Runtime Profile
- Dev URL: http://localhost:4200 (source: `.claude/launch.json` -> `npx ng serve --port 4200`)
- Backend required to boot: no
- Auth/session: none locally; Claude-backed features (sample/db/downloads) resolve `null` outside claude.ai, so streaming/question states are not reachable at runtime here
- Axe source: CDN injection (`cdnjs axe-core 4.10.2`), re-injected after each navigation
- HMR: yes (component HMR; class changes need a reload)
- Harness note: in a hidden/background browser pane CSS transitions freeze at t=0 and rAF never fires — disable transitions before contrast scans; never use rAF/timers for focus (use `afterNextRender`)

## Established Patterns
- Visible focus: `@include focus-ring()` mixin (`src/assets/scss/tools/mixins/_focus-ring.mixin.scss`) or the global `:focus-visible` rule in `elements/_elements.scss`
- Visually hidden radios/file inputs inside a styled `<label>`; the label shows focus via `:has(:focus-visible)`
- Toggle buttons expose state with `aria-pressed`; disclosure buttons with `aria-expanded` + `[attr.aria-controls]="open ? 'id' : null"` (never reference an id that is not rendered)
- Destructive actions use an inline confirm row `role="group" aria-labelledby` + focus moves to Cancel on open, back to the trigger on cancel, to a stable target after delete; never `confirm()`
- Anything that removes or creates the focused control moves focus with `focusAfterRender(injector, () => el)` (`src/app/shared/focus/focus-after-render.ts`, wraps `afterNextRender`) — never rAF/setTimeout: with `eventCoalescing` change detection itself waits for a frame
- Status messages go through `AnnouncerService` (one persistent live region); do not add a second `role="status"` for the same text. Errors shown after blur/submit use `role="alert"`
- Busy buttons use `aria-disabled` + a guard instead of `disabled`, so focus is kept
- Custom tablists ignore Alt/Ctrl/Meta arrow combos

## Runtime Verification
| Route | Last verified | axe (touched rules) | Tab walk | Notes |
|---|---|---|---|---|
| `/` (ar, RTL) | 2026-11-03 | clean — full wcag2a/aa/21a/21aa + best-practice on files/map/explain tabs, Brief/Claude tabs, both popovers open | done | skip link, sidebar + workspace tablists (RTL arrows, End), popover Enter/Esc/focus return, rename, new-file form, header delete confirm |
| `/` (en, LTR) | 2026-11-03 | clean on files + map tabs | not repeated (same handlers, direction-aware) | workspace + tree pinned left verified |
| `/` colour matrix | 2026-11-03 | `color-contrast` clean on all 36 combos (light/dark × glass/solid/blueprint × 6 accents) | n/a | scanned with transitions disabled (harness note) |
| `/` phone 375px | 2026-11-03 | clean on Brief / Files / Claude views; no horizontal overflow | not done | |

## Shared Controls Ledger
| Control | Consumers | Status |
|---|---:|---|
| `app-icon` | 13 | done (decorative, `aria-hidden` + `focusable="false"`; no change needed) |
| `c-button` / `c-field` styles | all controls | pending (SCSS out of template scope) |
| `app-drop-zone` | 2 | done |
| `appAnchoredPopover` directive | 2 | done (opens on the checked option; native Esc/light-dismiss/focus return) |

## Batch 1 — Shared controls — DONE
- Scope: `shared/icon`, `shared/drop-zone` (+ its 2 call sites); SCSS in `assets/scss/components` not audited (template skill scope)
- Fixed: drop-zone accessible name now states the action ("اختار ملفات أو zip") instead of a drag-only instruction; drag moved into the hint, in the default and both consumers
- Shared impact: `app-drop-zone` (2 consumers); `app-icon` (13) verified clean, unchanged
- Verification: re-read edits; AOT gate `npx ng build --configuration development` passed
- Remaining: runtime check of the announced file-input name; explain-panel folder input has `aria-label` that differs from its visible label text (label-in-name) -> Batch 3
## Batch 2 — App shell, popovers and dialogs — DONE
- Scope: `app.component`, `layout/app-header`, `shared/popover` directive, `shared/appearance-menu`, `shared/accessibility-panel`, `shared/read-aloud-player` (audited after the formal/bilingual redesign)
- Fixed: sidebar tablist got its own name (`app.sideTabs`); header delete confirm -> labelled group with focus to Cancel / back to trash / to project select after delete; download button `aria-disabled` + guard (keeps focus) and its note no longer a duplicate live region; popover toggles `aria-haspopup="dialog"`, popovers focus the checked radio; a11y grid redundant group/label removed, colour-cycle button lost its binary `aria-pressed` (state stays in `aria-describedby`); player `role=group`, Esc closes, Close restores prior focus, Stop moves focus to Play; tab key handlers ignore modifier keys
- Shared impact: popover directive (2 consumers); new keys `app.sideTabs`, `chat.claude` in ar + en
- Verification: AOT gate `npx ng build --configuration development` passed; edited files re-read
- Remaining (runtime): Tab walk of header confirm, popover Esc/focus return in RTL and LTR, player Esc/Close focus, implicit `aria-expanded` from `popovertarget` in target browsers

## Batch 3 — Brief, chat and explanation features — DONE
- Scope: `features/spec-panel`, `features/chat-panel`, `features/explain-panel`, `features/idea-map`
- Fixed: idea required-field error `role="alert"`; map code toggle `aria-controls` only while the source editor exists; speaker prefix localized (`chat.claude`); duplicate `role="status"` notes removed where `AnnouncerService` already speaks them (references note, import note, explain waiting — explain now announces its start); folder picker label-in-name fixed (visible label is the only name)
- Kept by decision: type names Skill / Plugin / Command / Hook stay English technical terms in both locales
- Shared impact: none
- Verification: AOT gate passed
- Remaining (runtime): radio group announcement, streamed chat completion announced once, Mermaid figure name

## Batch 4 — Custom interactive widgets — DONE
- Scope: `features/workspace`, `features/file-tree`, `features/file-viewer`
- Fixed: tree new-file toggle `aria-controls` conditional, focus into the path field on open, Esc closes and returns focus, error `role="alert"`; viewer article keeps a name while renaming, rename Esc works from every control and returns focus to Rename, rename error `role="alert"`, delete confirm -> labelled group + focus management (Cancel, back to Delete, then the selected tree row), frontmatter `<pre>` given `role="group"` so its label is valid
- Verified clean: workspace tablist (roving tabindex, RTL-aware arrows, `[hidden]` panels), tree disclosure buttons + `aria-current`, editor Tab trap with Esc release and described help
- Shared impact: none
- Verification: AOT gate passed. A static pass cannot certify keyboard access
- Remaining (runtime): Tab walk of rename/delete/new-file focus targets; check no ancestor Esc handler fires when releasing the editor Tab trap
## Batch 5 — Final runtime verification — DONE
- Scope: `/` in ar/RTL and en/LTR, desktop + 375px, all workspace/sidebar tabs, both popovers, 36 colour combos
- Fixed at runtime: `scrollable-region-focusable` on the map canvas (`features/idea-map`: `tabindex="0"` on the figure, pre-simulated then verified); focus hand-offs moved from rAF/setTimeout to `afterNextRender` (`shared/focus/focus-after-render.ts`) after the Tab walk showed focus never reaching the new-file field (file-tree, file-viewer, app-header, chat-panel)
- Re-verify: scoped axe on the map canvas clean; full scans clean; Tab walk re-run on new-file, rename, header delete — all pass; console clean
- Not verified: screen-reader announcements (NVDA/VoiceOver) of live messages and the radio-group name; Claude-backed states (streaming reply, clarifying questions, download dialog) — only reachable inside claude.ai

## Next batch
None — all batches DONE. Re-run `accessibility-test` on `/` after UI changes.
