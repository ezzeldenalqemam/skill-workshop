import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { I18nService } from '../../core/i18n/i18n.service';
import { TPipe } from '../../core/i18n/t.pipe';
import { AnnouncerService } from '../../core/services/announcer.service';
import { AppearanceService } from '../../core/services/appearance.service';
import { ClaudeAgentService } from '../../core/services/claude-agent.service';
import { MermaidService } from '../../core/services/mermaid.service';
import { WorkspaceStore } from '../../core/services/workspace.store';
import { UiStateService } from '../../core/services/ui-state.service';
import { focusAfterRender } from '../../shared/focus/focus-after-render';
import { IconComponent } from '../../shared/icon/icon.component';
import { Flow, nextNodeId, parseFlow, printFlow } from './flow-model';

const MIN_SCALE = 0.2;
const MAX_SCALE = 4;
const STEP = 1.2;
const PAN = 48;

/** Where the on-map editor sits, in viewport pixels. */
interface Overlay {
  x: number;
  y: number;
  width: number;
  height: number;
}

@Component({
  selector: 'app-idea-map',
  imports: [IconComponent, TPipe],
  templateUrl: './idea-map.component.html',
  styleUrl: './idea-map.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IdeaMapComponent {
  readonly store = inject(WorkspaceStore);
  readonly agent = inject(ClaudeAgentService);
  readonly ui = inject(UiStateService);
  private readonly mermaid = inject(MermaidService);
  private readonly appearance = inject(AppearanceService);
  private readonly announcer = inject(AnnouncerService);
  private readonly i18n = inject(I18nService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly injector = inject(Injector);

  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  private readonly stage = viewChild<ElementRef<HTMLElement>>('stage');

  readonly dir = this.i18n.dir;
  readonly svg = signal<SafeHtml | null>(null);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly codeOpen = signal(false);
  readonly draft = signal('');

  // View: the stage is translated, then scaled from its top-left corner.
  readonly scale = signal(1);
  readonly tx = signal(0);
  readonly ty = signal(0);
  readonly zoomPercent = computed(() => Math.round(this.scale() * 100));
  readonly transform = computed(() => `translate(${this.tx()}px, ${this.ty()}px) scale(${this.scale()})`);
  private fittedProject: string | null = null;
  /** The editor field to focus once the on-map editor has appeared. */
  private focusTarget: { id: string; select: boolean } | null = null;
  /** Once the viewer pans or zooms, resizes stop re-framing the map. */
  private touched = false;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private dragMoved = false;

  // Editing happens on the map itself: pick a step or a link, and a small editor appears on it.
  readonly editMode = signal(false);
  readonly selectedId = signal<string | null>(null);
  readonly selectedEdge = signal<number | null>(null);
  /** Waiting for the viewer to click the step a new link should point to. */
  readonly connecting = signal(false);
  readonly overlay = signal<Overlay | null>(null);
  readonly flow = computed(() => (this.store.project().map.trim() ? parseFlow(this.store.project().map) : null));
  readonly selectedNode = computed(() => this.flow()?.nodes.find((n) => n.id === this.selectedId()) ?? null);
  readonly edge = computed(() => {
    const index = this.selectedEdge();
    return index === null ? null : (this.flow()?.edges[index] ?? null);
  });

  constructor() {
    // Keep the map framed while the panel settles or resizes, until the viewer takes over.
    const observer = new ResizeObserver(() => {
      if (!this.touched) this.fit();
      this.place();
    });
    effect(() => {
      const view = this.viewport()?.nativeElement;
      observer.disconnect();
      if (view) observer.observe(view);
    });
    inject(DestroyRef).onDestroy(() => observer.disconnect());

    effect(() => {
      const source = this.store.project().map;
      // Re-render when the palette changes so the map keeps matching the page.
      this.appearance.mode();
      this.appearance.accent();
      void this.render(source);
    });
    // A selection that no longer exists (deleted, other project) is dropped.
    effect(() => {
      const flow = this.flow();
      untracked(() => {
        if (this.selectedId() && !flow?.nodes.some((n) => n.id === this.selectedId())) this.clearSelection();
        if (this.selectedEdge() !== null && !flow?.edges[this.selectedEdge()!]) this.clearSelection();
      });
    });
    // Keep the on-map editor over its target as the view moves.
    effect(() => {
      this.transform();
      this.selectedId();
      this.selectedEdge();
      this.svg();
      afterNextRender(() => this.place(), { injector: this.injector });
    });
  }

  label(id: string): string {
    return this.flow()?.nodes.find((n) => n.id === id)?.label ?? id;
  }

  // ---- code view ------------------------------------------------------------

  openSource(): void {
    this.draft.set(this.store.project().map);
    this.codeOpen.set(true);
  }

  async applySource(): Promise<void> {
    try {
      await this.mermaid.validate(this.draft());
      this.store.checkpoint(this.i18n.t('store.mapEdit'));
      this.store.setMap(this.draft(), true);
      this.codeOpen.set(false);
      this.announcer.announce(this.i18n.t('map.updated'));
    } catch (error) {
      this.error.set(this.describe(error));
    }
  }

  // ---- pan and zoom -----------------------------------------------------------

  zoomIn(): void {
    this.touched = true;
    this.zoomAtCenter(STEP);
  }

  zoomOut(): void {
    this.touched = true;
    this.zoomAtCenter(1 / STEP);
  }

  /** Frames the whole map; it also hands the view back to automatic framing. */
  fitView(): void {
    this.touched = false;
    this.fit();
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.touched = true;
    if (event.ctrlKey || event.metaKey) {
      // Pinch on a trackpad arrives as Ctrl + wheel too.
      const rect = this.viewport()!.nativeElement.getBoundingClientRect();
      this.zoomAt(Math.exp(-event.deltaY * 0.002), event.clientX - rect.left, event.clientY - rect.top);
    } else {
      this.tx.update((x) => x - (event.shiftKey ? event.deltaY : event.deltaX));
      this.ty.update((y) => y - (event.shiftKey ? 0 : event.deltaY));
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.dragMoved = false;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    const last = this.pointers.get(event.pointerId);
    if (!last) return;
    if (this.pointers.size === 2) {
      // Two fingers: zoom by the change in distance, around their midpoint.
      const [a, b] = [...this.pointers.values()];
      const other = a === last ? b : a;
      const before = Math.hypot(last.x - other.x, last.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      const rect = this.viewport()!.nativeElement.getBoundingClientRect();
      this.touched = true;
      if (before > 0) this.zoomAt(after / before, (event.clientX + other.x) / 2 - rect.left, (event.clientY + other.y) / 2 - rect.top);
    } else {
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      if (!this.dragMoved && Math.hypot(dx, dy) < 3) return;
      this.dragMoved = true;
      this.touched = true;
      this.tx.update((x) => x + dx);
      this.ty.update((y) => y + dy);
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }

  onPointerUp(event: PointerEvent): void {
    const wasDrag = this.dragMoved;
    this.pointers.delete(event.pointerId);
    if (event.type !== 'pointerup' || wasDrag || !this.editMode()) return;
    // Pointer capture retargets the event to the viewport, so find what is under the pointer.
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const nodeId = this.nodeIdAt(target);
    const edgeIndex = this.edgeIndexAt(target);
    if (nodeId) this.onNodeClick(nodeId);
    else if (edgeIndex !== null) this.selectEdge(edgeIndex);
    else if (!this.connecting()) this.clearSelection();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && (this.connecting() || this.selectedId() || this.selectedEdge() !== null)) {
      event.preventDefault();
      this.connecting() ? this.connecting.set(false) : this.clearSelection();
      this.viewport()?.nativeElement.focus();
      return;
    }
    if (event.target !== event.currentTarget || event.ctrlKey || event.metaKey || event.altKey) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [PAN, 0],
      ArrowRight: [-PAN, 0],
      ArrowUp: [0, PAN],
      ArrowDown: [0, -PAN],
    };
    if (moves[event.key]) {
      const [dx, dy] = moves[event.key];
      this.touched = true;
      this.tx.update((x) => x + dx);
      this.ty.update((y) => y + dy);
    } else if (event.key === '+' || event.key === '=') {
      this.zoomIn();
    } else if (event.key === '-') {
      this.zoomOut();
    } else if (event.key === '0') {
      this.fitView();
    } else {
      return;
    }
    event.preventDefault();
  }

  // ---- editing ----------------------------------------------------------------

  toggleEdit(): void {
    this.editMode.update((on) => !on);
    if (!this.editMode()) this.clearSelection();
  }

  startMap(): void {
    const flow: Flow = {
      direction: 'TD',
      nodes: [{ id: 'n1', label: this.i18n.t('map.startNode'), shape: 'stadium', group: null }],
      edges: [],
      groups: [],
      extras: [],
    };
    this.editMode.set(true);
    this.fittedProject = null;
    this.touched = false;
    this.commit(flow, this.i18n.t('map.nodeAdded', { name: flow.nodes[0].label }));
    this.selectNode('n1');
  }

  /** The keyboard route to a step: the step picker in the toolbar. */
  pick(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    // Arrow keys fire change on each step, so the picker keeps focus; Tab reaches the editor.
    if (id) this.selectNode(id, false, false);
    else this.clearSelection();
  }

  rename(id: string, event: Event): void {
    const label = (event.target as HTMLInputElement).value.trim();
    const node = this.flow()?.nodes.find((n) => n.id === id);
    if (!label || !node || node.label === label) return;
    this.edit((flow) => {
      flow.nodes.find((n) => n.id === id)!.label = label;
    }, this.i18n.t('map.updated'));
  }

  /** Enter keeps the change; Esc closes the editor without it. */
  onEditorKey(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault();
      (event.target as HTMLInputElement).blur();
      this.viewport()?.nativeElement.focus();
    }
  }

  addAfter(id: string): void {
    let added = '';
    const label = this.i18n.t('map.newStep');
    this.edit(
      (flow) => {
        added = nextNodeId(flow);
        const group = flow.nodes.find((n) => n.id === id)?.group ?? null;
        flow.nodes.push({ id: added, label, shape: 'rect', group });
        flow.edges.push({ from: id, to: added, arrow: '-->', label: '' });
      },
      this.i18n.t('map.nodeAdded', { name: label }),
      true,
    );
    this.selectNode(added, true);
  }

  startConnect(): void {
    this.connecting.set(true);
    this.announcer.announce(this.i18n.t('map.connectHint'));
    this.viewport()?.nativeElement.focus();
  }

  deleteNode(id: string): void {
    const name = this.label(id);
    this.edit(
      (flow) => {
        flow.nodes = flow.nodes.filter((n) => n.id !== id);
        flow.edges = flow.edges.filter((e) => e.from !== id && e.to !== id);
      },
      this.i18n.t('map.nodeDeleted', { name }),
      true,
    );
    this.clearSelection();
    this.viewport()?.nativeElement.focus();
  }

  relabelEdge(index: number, event: Event): void {
    const label = (event.target as HTMLInputElement).value.trim();
    if (this.flow()?.edges[index]?.label === label) return;
    this.edit((flow) => {
      flow.edges[index].label = label;
    }, this.i18n.t('map.updated'));
  }

  deleteEdge(index: number): void {
    this.edit((flow) => {
      flow.edges.splice(index, 1);
    }, this.i18n.t('map.linkDeleted'));
    this.clearSelection();
    this.viewport()?.nativeElement.focus();
  }

  // ---- internals --------------------------------------------------------------

  private onNodeClick(id: string): void {
    const from = this.selectedId();
    if (this.connecting() && from) {
      this.connecting.set(false);
      if (id === from) return;
      this.edit((flow) => {
        flow.edges.push({ from, to: id, arrow: '-->', label: '' });
      }, this.i18n.t('map.linkAdded'));
      this.selectNode(id);
      return;
    }
    this.selectNode(id);
  }

  private selectNode(id: string, selectText = false, focus = true): void {
    this.selectedEdge.set(null);
    this.selectedId.set(id);
    this.announcer.announce(this.label(id));
    this.focusTarget = focus ? { id: 'map-node-text', select: selectText } : null;
  }

  private selectEdge(index: number): void {
    this.connecting.set(false);
    this.selectedId.set(null);
    this.selectedEdge.set(index);
    this.focusTarget = { id: 'map-edge-text', select: false };
  }

  private clearSelection(): void {
    this.selectedId.set(null);
    this.selectedEdge.set(null);
    this.connecting.set(false);
  }

  /** `refit` re-frames the view after the map grows or shrinks. */
  private edit(mutate: (flow: Flow) => void, note: string, refit = false): void {
    const current = this.flow();
    if (!current) return;
    const next = structuredClone(current);
    mutate(next);
    if (refit) {
      this.fittedProject = null;
      this.touched = false;
    }
    this.commit(next, note);
  }

  private commit(flow: Flow, note: string): void {
    this.store.checkpoint(this.i18n.t('store.mapEdit'));
    this.store.setMap(printFlow(flow), true);
    this.announcer.announce(note);
  }

  private fit(): void {
    const view = this.viewport()?.nativeElement;
    const svg = this.stage()?.nativeElement.querySelector('svg');
    if (!view || !svg || !view.clientWidth || !view.clientHeight) return;
    const { width, height } = this.svgSize(svg);
    if (!width || !height) return;
    const pad = 32;
    const scale = this.clamp(Math.min((view.clientWidth - pad * 2) / width, (view.clientHeight - pad * 2) / height, 1));
    this.scale.set(scale);
    this.tx.set((view.clientWidth - width * scale) / 2);
    this.ty.set((view.clientHeight - height * scale) / 2);
  }

  private zoomAtCenter(factor: number): void {
    const view = this.viewport()?.nativeElement;
    if (view) this.zoomAt(factor, view.clientWidth / 2, view.clientHeight / 2);
  }

  /** Zooms keeping the point (x, y) of the viewport still. */
  private zoomAt(factor: number, x: number, y: number): void {
    const before = this.scale();
    const after = this.clamp(before * factor);
    if (after === before) return;
    this.tx.update((tx) => x - (x - tx) * (after / before));
    this.ty.update((ty) => y - (y - ty) * (after / before));
    this.scale.set(after);
  }

  private clamp(scale: number): number {
    return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
  }

  private svgSize(svg: SVGSVGElement): { width: number; height: number } {
    const box = svg.viewBox.baseVal;
    return box?.width ? { width: box.width, height: box.height } : { width: svg.clientWidth, height: svg.clientHeight };
  }

  /** Mermaid names node groups `flowchart-<id>-<n>`. */
  private nodeIdAt(target: Element | null): string | null {
    const group = target?.closest('g.node');
    return /flowchart-(.+)-\d+$/.exec(group?.id ?? '')?.[1] ?? null;
  }

  private edgeIndexAt(target: Element | null): number | null {
    const hit = target?.closest('[data-edge]');
    return hit ? Number(hit.getAttribute('data-edge')) : null;
  }

  /** Positions the on-map editor over the picked step, or at the middle of the picked link. */
  private place(): void {
    const view = this.viewport()?.nativeElement;
    const stage = this.stage()?.nativeElement;
    if (!view || !stage || !this.editMode()) {
      this.overlay.set(null);
      return;
    }
    const origin = view.getBoundingClientRect();
    const id = this.selectedId();
    const edge = this.selectedEdge();
    if (id) {
      const node = [...stage.querySelectorAll('g.node')].find((g) => this.nodeIdAt(g) === id);
      if (!node) return this.overlay.set(null);
      const box = node.getBoundingClientRect();
      this.overlay.set({ x: box.left - origin.left, y: box.top - origin.top, width: box.width, height: box.height });
    } else if (edge !== null) {
      const path = stage.querySelector<SVGPathElement>(`[data-edge="${edge}"]`);
      const matrix = path?.getScreenCTM();
      if (!path || !matrix) return this.overlay.set(null);
      const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(matrix);
      this.overlay.set({ x: point.x - origin.left, y: point.y - origin.top, width: 0, height: 0 });
    } else {
      this.overlay.set(null);
    }
    const focus = this.focusTarget;
    if (focus && this.overlay()) {
      this.focusTarget = null;
      focusAfterRender(this.injector, () => document.getElementById(focus.id), focus.select);
    }
  }

  private async render(source: string): Promise<void> {
    if (!source.trim()) {
      this.svg.set(null);
      this.error.set(null);
      return;
    }
    this.loading.set(true);
    try {
      // Mermaid's strict security level strips scripts and event handlers from its own SVG output.
      const svg = await this.mermaid.render(source);
      this.svg.set(this.sanitizer.bypassSecurityTrustHtml(svg));
      this.error.set(null);
      afterNextRender(() => this.afterDraw(), { injector: this.injector });
    } catch (error) {
      this.error.set(this.describe(error));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Gives the SVG its natural size (so zoom is real zoom), fits it once per project, and lays a wide,
   * invisible stroke over each link so a thin line is easy to click.
   */
  private afterDraw(): void {
    const svg = this.stage()?.nativeElement.querySelector('svg');
    if (!svg) return;
    const { width, height } = this.svgSize(svg);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.style.maxWidth = 'none';

    const edges = this.flow()?.edges ?? [];
    const used = new Set<number>();
    for (const path of svg.querySelectorAll<SVGPathElement>('path[id^="L-"]')) {
      const [, from, to] = /^L-(.+?)-(.+?)-\d+$/.exec(path.id) ?? [];
      const index = edges.findIndex((e, i) => !used.has(i) && e.from === from && e.to === to);
      if (index < 0) continue;
      used.add(index);
      const hit = path.cloneNode() as SVGPathElement;
      hit.removeAttribute('id');
      hit.removeAttribute('marker-end');
      hit.removeAttribute('marker-start');
      hit.setAttribute('class', 'c-map-hit');
      hit.setAttribute('data-edge', String(index));
      path.after(hit);
    }

    const project = this.store.project().id;
    if (this.fittedProject !== project) {
      this.fittedProject = project;
      this.touched = false;
    }
    if (!this.touched) this.fit();
    this.place();
  }

  private describe(error: unknown): string {
    const message = (error as Error)?.message ?? String(error);
    return /load/.test(message)
      ? this.i18n.t('map.loadError')
      : this.i18n.t('map.syntaxError', { msg: message.split('\n')[0] });
  }
}
