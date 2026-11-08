import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, Injector } from '@angular/core';
import { I18nService } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { KIND_LABELS, ProjectKind } from '../../core/models/project.model';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { focusAfterRender } from '../../shared/focus/focus-after-render';
import { IconComponent } from '../../shared/icon/icon.component';

interface Tab {
  id: string;
  name: string;
  kind: ProjectKind;
  active: boolean;
  draft: boolean;
}

/** Open projects as tabs above the workspace, to move between several skills. */
@Component({
  selector: 'app-project-tabs',
  imports: [IconComponent, TPipe],
  templateUrl: './project-tabs.component.html',
  styleUrl: './project-tabs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectTabsComponent {
  readonly store = inject(WorkspaceStore);
  private readonly i18n = inject(I18nService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly kindLabels = KIND_LABELS;

  readonly tabs = computed<Tab[]>(() => {
    const current = this.store.project();
    const summaries = new Map(this.store.projects().map((p) => [p.id, p]));
    const tabs: Tab[] = this.store.openTabs().flatMap((id) => {
      const active = id === current.id;
      const summary = summaries.get(id);
      if (!summary && !active) return [];
      const name = active ? current.spec.name || summary?.name || this.i18n.t('header.untitled') : summary!.name;
      return [{ id, name, kind: active ? current.spec.kind : summary!.kind, active, draft: false }];
    });
    if (current.isDraft) tabs.push({ id: current.id, name: this.i18n.t('tabs.draft'), kind: current.spec.kind, active: true, draft: true });
    return tabs;
  });

  open(tab: Tab): void {
    void this.store.openTab(tab.id);
  }

  /** Focus stays in the strip: on the tab that takes the closed one's place, or on "new tab". */
  async close(tab: Tab, index: number): Promise<void> {
    if (tab.draft) {
      const last = this.store.openTabs().at(-1);
      if (!last) return;
      await this.store.openTab(last);
    } else {
      await this.store.closeTab(tab.id);
    }
    focusAfterRender(this.injector, () => {
      const buttons = this.host.nativeElement.querySelectorAll<HTMLButtonElement>('.l-tabs__tab');
      return buttons[Math.min(index, buttons.length - 1)] ?? this.host.nativeElement.querySelector<HTMLButtonElement>('.l-tabs__new');
    });
  }

  /** Middle click closes a tab, as in a browser. */
  onAux(event: MouseEvent, tab: Tab, index: number): void {
    if (event.button !== 1) return;
    event.preventDefault();
    void this.close(tab, index);
  }
}
