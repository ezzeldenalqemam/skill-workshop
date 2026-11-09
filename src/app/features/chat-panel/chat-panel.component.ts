import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  untracked,
  viewChild,
} from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { MessageKey } from '../../core/i18n/messages';
import { TPipe } from '../../core/i18n/t.pipe';
import { ActivityEntry, ChatMessage, ClarifyingQuestion } from '../../core/models/project.model';
import { AnnouncerService } from '../../core/services/announcer.service';
import { ClaudeAgentService } from '../../core/services/claude-agent.service';
import { ComposerService } from '../../core/services/composer.service';
import { UiStateService } from '../../core/services/ui-state.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { IconComponent } from '../../shared/icon/icon.component';

const ACTIVITY: Record<ActivityEntry['kind'], { key: MessageKey; icon: string }> = {
  write: { key: 'act.write', icon: 'edit' },
  read: { key: 'act.read', icon: 'eye' },
  delete: { key: 'act.delete', icon: 'trash' },
  map: { key: 'act.map', icon: 'map' },
  mapError: { key: 'act.mapError', icon: 'alert' },
  explain: { key: 'act.explain', icon: 'help' },
  spec: { key: 'act.spec', icon: 'layers' },
  local: { key: 'act.local', icon: 'laptop' },
};

@Component({
  selector: 'app-chat-panel',
  imports: [IconComponent, TPipe],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatPanelComponent {
  readonly store = inject(WorkspaceStore);
  readonly agent = inject(ClaudeAgentService);
  readonly composer = inject(ComposerService);
  private readonly ui = inject(UiStateService);
  private readonly announcer = inject(AnnouncerService);
  private readonly i18n = inject(I18nService);
  private readonly injector = inject(Injector);

  private readonly input = viewChild<ElementRef<HTMLTextAreaElement>>('composerInput');
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');

  readonly messages = computed(() => this.store.project().chat);
  readonly canSend = computed(() => this.agent.canRun() && !!this.composer.draft().trim());

  constructor() {
    effect(() => {
      if (!this.composer.focusRequest()) return;
      untracked(() => {
        this.ui.showSide('chat');
        // The panel un-hides on the next render; focus once it is visible.
        afterNextRender(
          () => {
            const field = this.input()?.nativeElement;
            if (!field) return;
            field.focus();
            field.setSelectionRange(field.value.length, field.value.length);
          },
          { injector: this.injector },
        );
      });
    });

    // Follow the newest message while Claude writes.
    afterRenderEffect(() => {
      const last = this.messages().at(-1);
      void last?.text;
      void last?.activity?.length;
      const el = this.log()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  activityText(entry: ActivityEntry): string {
    return this.i18n.t(ACTIVITY[entry.kind].key, { path: entry.path ?? '' });
  }

  activityIcon(entry: ActivityEntry): string {
    return ACTIVITY[entry.kind].icon;
  }

  onDraft(event: Event): void {
    this.composer.draft.set((event.target as HTMLTextAreaElement).value);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.send();
    }
  }

  send(event?: Event): void {
    event?.preventDefault();
    const text = this.composer.draft().trim();
    if (!text || !this.agent.canRun()) return;
    const focus = this.composer.focus() ?? (this.store.selectedPath() ? { path: this.store.selectedPath()! } : null);
    this.composer.draft.set('');
    this.composer.focus.set(null);
    void this.agent.chat(text, focus);
  }

  clearFocus(): void {
    this.composer.focus.set(null);
  }

  answer(message: ChatMessage, question: ClarifyingQuestion, event: Event): void {
    const value = (event.target as HTMLTextAreaElement).value;
    // Read the stored message, not the rendered one, so an answer never overwrites another.
    const current = this.store.project().chat.find((m) => m.id === message.id) ?? message;
    this.store.patchMessage(
      message.id,
      { questions: current.questions?.map((q) => (q.id === question.id ? { ...q, answer: value } : q)) },
      false,
    );
  }

  /** Answers become part of the brief ("clarifications"), so every later build sees them. */
  submitAnswers(message: ChatMessage, event: Event): void {
    event.preventDefault();
    const current = this.store.project().chat.find((m) => m.id === message.id);
    const answered = (current?.questions ?? []).filter((q) => q.answer?.trim());
    if (!answered.length) return;
    const qa = this.i18n.lang() === 'ar' ? ['س', 'ج'] : ['Q', 'A'];
    const block = answered.map((q) => `${qa[0]}: ${q.question}\n${qa[1]}: ${q.answer!.trim()}`).join('\n\n');
    const existing = this.store.spec().clarifications.trim();
    this.store.updateSpec({ clarifications: existing ? `${existing}\n\n${block}` : block });
    this.store.patchMessage(message.id, { questionsAnswered: true, questions: current?.questions });
    this.store.addMessage({ role: 'user', text: this.i18n.t('chat.answered', { n: answered.length }), textKey: 'chat.answered', textParams: { n: answered.length }, status: 'done' });
    this.announcer.announce(this.i18n.t('chat.answersAnnounce'));
  }

  statusKey(message: ChatMessage): MessageKey | null {
    switch (message.status) {
      case 'thinking':
        return 'chat.thinking';
      case 'streaming':
        return 'chat.streaming';
      case 'stopped':
        return 'chat.stopped';
      case 'error':
        return 'chat.failed';
      default:
        return null;
    }
  }
}
