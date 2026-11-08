import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, viewChildren } from '@angular/core';
import { MessageKey } from '../../core/i18n/messages';
import { UiStateService, WorkspaceTab } from '../../core/services/ui-state.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { TPipe } from '../../core/i18n/t.pipe';
import { IconComponent } from '../../shared/icon/icon.component';
import { FileTreeComponent } from '../file-tree/file-tree.component';
import { FileViewerComponent } from '../file-viewer/file-viewer.component';
import { ExplainPanelComponent } from '../explain-panel/explain-panel.component';
import { IdeaMapComponent } from '../idea-map/idea-map.component';
import { StartPanelComponent } from '../start-panel/start-panel.component';

@Component({
  selector: 'app-workspace',
  imports: [IconComponent, FileTreeComponent, FileViewerComponent, IdeaMapComponent, ExplainPanelComponent, StartPanelComponent, TPipe],
  templateUrl: './workspace.component.html',
  styleUrl: './workspace.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspaceComponent {
  readonly store = inject(WorkspaceStore);
  private readonly ui = inject(UiStateService);
  readonly tab = this.ui.workspaceTab;
  /** An untouched new project has nothing to show yet: offer the saved skills, an import, or a brief. */
  readonly showStart = computed(() => this.store.project().isDraft && !this.store.files().length);
  readonly tabs: { id: WorkspaceTab; label: MessageKey; icon: string }[] = [
    { id: 'files', label: 'ws.files', icon: 'file' },
    { id: 'map', label: 'ws.map', icon: 'map' },
    { id: 'explain', label: 'ws.explain', icon: 'help' },
  ];
  private readonly tabButtons = viewChildren<ElementRef<HTMLButtonElement>>('tabButton');

  select(id: WorkspaceTab): void {
    this.tab.set(id);
  }

  /** Arrow keys move between tabs (automatic activation), Home/End jump to the ends. */
  onTabKey(event: KeyboardEvent, index: number): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const rtl = getComputedStyle(event.target as Element).direction === 'rtl';
    const keys: Record<string, number> = {
      ArrowRight: rtl ? -1 : 1,
      ArrowLeft: rtl ? 1 : -1,
      Home: -index,
      End: this.tabs.length - 1 - index,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = (index + keys[event.key] + this.tabs.length) % this.tabs.length;
    this.select(this.tabs[next].id);
    this.tabButtons()[next]?.nativeElement.focus();
  }
}
