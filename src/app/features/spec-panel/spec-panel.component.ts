import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { isSampleError, ModelTier } from '../../core/claude/claude-runtime';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { TPipe } from '../../core/i18n/t.pipe';
import { BUILD_KINDS, KIND_LABELS, ProjectKind, ProjectSpec } from '../../core/models/project.model';
import { AnnouncerService } from '../../core/services/announcer.service';
import { BriefField, ClaudeAgentService } from '../../core/services/claude-agent.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { ZipService } from '../../core/services/zip.service';
import { DropZoneComponent } from '../../shared/drop-zone/drop-zone.component';
import { IconComponent } from '../../shared/icon/icon.component';

type TextField = Exclude<keyof ProjectSpec, 'kind'>;

interface FieldDef {
  key: BriefField;
  label: MessageKey;
  hint: MessageKey;
  placeholder: MessageKey;
  area: boolean;
}

/** Optional questions after the idea, from naming down to constraints; each maps onto part of the generated files. */
const DETAIL_FIELDS: FieldDef[] = [
  { key: 'name', label: 'spec.name', hint: 'spec.nameHint', placeholder: 'spec.namePh', area: false },
  { key: 'triggers', label: 'spec.triggers', hint: 'spec.triggersHint', placeholder: 'spec.triggersPh', area: true },
  { key: 'details', label: 'spec.details', hint: 'spec.detailsHint', placeholder: 'spec.detailsPh', area: true },
  { key: 'examples', label: 'spec.examples', hint: 'spec.examplesHint', placeholder: 'spec.examplesPh', area: true },
  { key: 'constraints', label: 'spec.constraints', hint: 'spec.constraintsHint', placeholder: 'spec.constraintsPh', area: true },
];

/** Form order: a field's suggestions come from the ones above it. */
const ORDER: BriefField[] = ['idea', ...DETAIL_FIELDS.map((f) => f.key)];
/** Leading "e.g." of a sample placeholder, dropped when the sample itself is used. */
const EXAMPLE_PREFIX = /^(مثال:\s*|e\.g\.\s*)/i;

@Component({
  selector: 'app-spec-panel',
  imports: [IconComponent, DropZoneComponent, TPipe],
  templateUrl: './spec-panel.component.html',
  styleUrl: './spec-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpecPanelComponent {
  readonly store = inject(WorkspaceStore);
  readonly agent = inject(ClaudeAgentService);
  private readonly zip = inject(ZipService);
  private readonly announcer = inject(AnnouncerService);
  private readonly i18n = inject(I18nService);

  readonly fields = DETAIL_FIELDS;
  readonly kinds = BUILD_KINDS.map((kind) => [kind, KIND_LABELS[kind]] as [ProjectKind, string]);
  readonly linkError = signal(false);
  readonly tiers: { value: ModelTier; label: MessageKey }[] = [
    { value: 'quick', label: 'tier.quick' },
    { value: 'default', label: 'tier.default' },
    { value: 'complex', label: 'tier.complex' },
  ];

  readonly ideaTouched = signal(false);
  readonly importNote = signal<string | null>(null);
  /** Claude's proposals for fields still empty, shown as their placeholders. */
  readonly suggestions = signal<Partial<Record<BriefField, string>>>({});
  readonly suggesting = signal(false);
  private suggestController?: AbortController;
  private suggestPausedUntil = 0;
  readonly ideaMissing = computed(() => !this.store.spec().idea.trim());
  readonly ideaInvalid = computed(() => this.ideaTouched() && this.ideaMissing());
  readonly referenceCount = computed(() => this.store.files().filter((f) => f.path.startsWith('references/')).length);
  /** Type, idea, the optional details and reference files. */
  readonly total = DETAIL_FIELDS.length + 3;
  readonly answered = computed(() => {
    const spec = this.store.spec();
    const details = DETAIL_FIELDS.filter((f) => spec[f.key].trim()).length;
    return 1 + (this.ideaMissing() ? 0 : 1) + details + (this.referenceCount() ? 1 : 0);
  });

  constructor() {
    // Another project or language: the old proposals no longer fit.
    const projectId = computed(() => this.store.project().id);
    effect(() => {
      projectId();
      this.i18n.lang();
      untracked(() => {
        this.cancelSuggest();
        this.suggestions.set({});
      });
    });
    inject(DestroyRef).onDestroy(() => this.cancelSuggest());
  }

  value(key: TextField): string {
    return this.store.spec()[key];
  }

  onInput(key: TextField, event: Event): void {
    this.store.updateSpec({ [key]: (event.target as HTMLInputElement | HTMLTextAreaElement).value });
  }

  placeholder(key: BriefField, fallback: MessageKey): string {
    return this.suggestions()[key] ?? this.i18n.t(fallback);
  }

  hasSuggestion(key: BriefField): boolean {
    return !!this.suggestions()[key];
  }

  /** Tab in an empty field takes the text it shows; a second Tab moves on as usual. */
  onFieldKey(key: BriefField, fallback: MessageKey, event: KeyboardEvent): void {
    if (event.key !== 'Tab' || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
    const field = event.target as HTMLInputElement | HTMLTextAreaElement;
    if (field.value) return;
    const text = this.suggestions()[key] ?? this.i18n.t(fallback).replace(EXAMPLE_PREFIX, '').trim();
    if (!text) return;
    event.preventDefault();
    // insertText keeps the browser's own undo (Ctrl+Z) and fires the usual input event.
    const inserted = document.execCommand('insertText', false, text);
    if (!inserted || field.value !== text) {
      field.value = text;
      this.store.updateSpec({ [key]: text });
    }
    this.announcer.announce(this.i18n.t('spec.suggestUsed'));
  }

  setKind(kind: ProjectKind): void {
    this.store.updateSpec({ kind });
  }

  setTier(event: Event): void {
    this.agent.tier.set((event.target as HTMLSelectElement).value as ModelTier);
  }

  build(): void {
    if (this.requireIdea()) void this.agent.build();
  }

  ask(): void {
    if (this.requireIdea()) void this.agent.askQuestions();
  }

  drawMap(): void {
    void this.agent.drawMap();
  }

  async addReferences(files: File[]): Promise<void> {
    const { files: imported, skipped, hasGit } = await this.zip.import(files);
    const count = this.store.addFiles(imported, 'references');
    const note = this.i18n.t('spec.refsAdded', { n: count }) + (skipped.length ? this.i18n.t('spec.skipped', { n: skipped.length }) : '') + (hasGit ? this.i18n.t('import.gitSkipped') : '');
    this.importNote.set(note);
    this.announcer.announce(note);
  }

  // ---- suggestions ----------------------------------------------------------

  /** True when "suggest" has something to work from and somewhere to put it. */
  readonly canSuggest = computed(
    () => this.store.spec().idea.trim().length >= 6 && ORDER.slice(1).some((key) => !this.store.spec()[key].trim()) && this.agent.canRun() && !this.suggesting(),
  );

  /** One quick Claude request, only when the user presses "suggest": text for every empty field after the idea. */
  async suggest(): Promise<void> {
    const spec = this.store.spec();
    if (spec.idea.trim().length < 6 || this.agent.running() || Date.now() < this.suggestPausedUntil) return;
    const targets = ORDER.slice(1).filter((key) => !spec[key].trim());
    if (!targets.length) return;
    this.suggestController?.abort();
    const controller = (this.suggestController = new AbortController());
    this.suggesting.set(true);
    try {
      const found = await this.agent.suggestBrief(targets, controller.signal);
      if (!controller.signal.aborted && Object.keys(found).length) {
        this.suggestions.update((current) => ({ ...current, ...found }));
        this.announcer.announce(this.i18n.t('spec.suggestReady', { n: Object.keys(found).length }));
      }
    } catch (error) {
      // Suggestions are a nicety: on refusal or rate limits they pause quietly; the sample placeholders stay.
      const code = isSampleError(error) ? error.code : '';
      if (code === 'rate_limited') this.suggestPausedUntil = Date.now() + 60_000;
      else if (code !== 'cancelled') this.suggestPausedUntil = Date.now() + 15_000;
    } finally {
      if (this.suggestController === controller) {
        this.suggestController = undefined;
        this.suggesting.set(false);
      }
    }
  }

  private cancelSuggest(): void {
    this.suggestController?.abort();
    this.suggestController = undefined;
    this.suggesting.set(false);
  }

  /** A reference link is kept in references/links.md; Claude reads the address, it cannot open the page. */
  addLink(urlField: HTMLInputElement, titleField: HTMLInputElement): void {
    const url = urlField.value.trim();
    if (!/^https?:\/\/\S+\.\S+/i.test(url)) {
      this.linkError.set(true);
      urlField.focus();
      return;
    }
    this.linkError.set(false);
    this.store.addLink(url, titleField.value.trim());
    urlField.value = '';
    titleField.value = '';
    const note = this.i18n.t('spec.refsLinkAdded');
    this.importNote.set(note);
    this.announcer.announce(note);
  }

  private requireIdea(): boolean {
    this.ideaTouched.set(true);
    if (!this.ideaMissing()) return true;
    document.getElementById('spec-idea')?.focus();
    return false;
  }
}
