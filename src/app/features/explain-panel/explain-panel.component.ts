import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { ClaudeAgentService } from '../../core/services/claude-agent.service';
import { ImportFlowService } from '../../core/services/import-flow.service';
import { MarkdownService } from '../../core/services/markdown.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { DropZoneComponent } from '../../shared/drop-zone/drop-zone.component';
import { TPipe } from '../../core/i18n/t.pipe';
import { IconComponent } from '../../shared/icon/icon.component';

@Component({
  selector: 'app-explain-panel',
  imports: [IconComponent, DropZoneComponent, TPipe],
  templateUrl: './explain-panel.component.html',
  styleUrl: './explain-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExplainPanelComponent {
  readonly store = inject(WorkspaceStore);
  readonly agent = inject(ClaudeAgentService);
  readonly importFlow = inject(ImportFlowService);
  private readonly markdown = inject(MarkdownService);

  readonly html = signal<SafeHtml | null>(null);

  constructor() {
    effect(() => {
      const text = this.store.project().explanation ?? '';
      if (!text.trim()) {
        this.html.set(null);
        return;
      }
      void this.markdown.render(text).then(({ html }) => this.html.set(html));
    });
  }

  onFolder(event: Event): void {
    const field = event.target as HTMLInputElement;
    const files = Array.from(field.files ?? []);
    field.value = '';
    void this.importFlow.openAndExplain(files);
  }
}
