import { Injectable, signal } from '@angular/core';

export type WorkspaceTab = 'files' | 'map' | 'explain';
export type SideTab = 'spec' | 'chat';
export type PhoneView = 'side' | 'work';

/** View state more than one component steers: workspace tab, sidebar tab, and the phone view. */
@Injectable({ providedIn: 'root' })
export class UiStateService {
  readonly workspaceTab = signal<WorkspaceTab>('files');
  readonly sideTab = signal<SideTab>('spec');
  /** Phones show one area at a time; wider screens show both. */
  readonly phoneView = signal<PhoneView>('side');
  /** Draw the idea map by itself when a saved skill is opened (spends one Claude request each time); off unless chosen. */
  readonly autoMap = signal(this.readAutoMap());

  setAutoMap(on: boolean): void {
    this.autoMap.set(on);
    try {
      localStorage.setItem('skill-workshop.auto-map', on ? 'on' : 'off');
    } catch {
      // Storage refused: the choice lasts for this visit.
    }
  }

  private readAutoMap(): boolean {
    try {
      return localStorage.getItem('skill-workshop.auto-map') === 'on';
    } catch {
      return false;
    }
  }

  showWorkspace(tab: WorkspaceTab): void {
    this.workspaceTab.set(tab);
    this.phoneView.set('work');
  }

  showSide(tab: SideTab): void {
    this.sideTab.set(tab);
    this.phoneView.set('side');
  }
}
