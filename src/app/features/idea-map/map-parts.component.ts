import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TPipe } from '../../core/i18n/t.pipe';
import { MapComponent, MapPlan } from '../../core/models/project.model';
import { AppearanceService } from '../../core/services/appearance.service';
import { MermaidService } from '../../core/services/mermaid.service';

/** Component kinds are product terms, shown in English in both languages. */
const KIND_NAMES: Record<MapComponent['kind'], string> = { skill: 'Skill', command: 'Command', agent: 'Agent', hook: 'Hook' };

/**
 * A plugin's map, one part at a time: the order to use the parts in (when there is one),
 * then a card per skill, command, agent or hook with what it does and its own small flow.
 * It is laid out as one wide canvas inside the map's frame, which pans and zooms it.
 */
@Component({
  selector: 'app-map-parts',
  imports: [TPipe],
  templateUrl: './map-parts.component.html',
  styleUrl: './map-parts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MapPartsComponent {
  private readonly mermaid = inject(MermaidService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly appearance = inject(AppearanceService);

  readonly plan = input.required<MapPlan>();
  /** Every flow is drawn (or failed): the frame around it can measure and fit it now. */
  readonly drawn = output<void>();
  /** Rendered SVG per part name, or 'error' when that part's flow could not be drawn. */
  readonly svgs = signal<Record<string, SafeHtml | 'error'>>({});
  readonly kindNames = KIND_NAMES;

  /** The parts in the order the user should use them; empty when the order does not matter. */
  readonly ordered = computed(() => {
    const plan = this.plan();
    return plan.order.map((name) => plan.components.find((c) => c.name === name)).filter((c): c is MapComponent => !!c);
  });

  constructor() {
    // Drawn again when the palette changes, so the flows match the page.
    effect(() => {
      const plan = this.plan();
      this.appearance.mode();
      this.appearance.accent();
      untracked(() => void this.renderAll(plan));
    });
  }

  /** The part's place in the order (1, 2, …), or 0 when it has none. */
  step(name: string): number {
    return this.ordered().length > 1 ? this.ordered().findIndex((c) => c.name === name) + 1 : 0;
  }

  svg(name: string): SafeHtml | null {
    const value = this.svgs()[name];
    return value && value !== 'error' ? value : null;
  }

  failed(name: string): boolean {
    return this.svgs()[name] === 'error';
  }

  private async renderAll(plan: MapPlan): Promise<void> {
    const out: Record<string, SafeHtml | 'error'> = {};
    for (const part of plan.components) {
      try {
        if (!part.map.trim()) throw new Error('empty');
        out[part.name] = this.sanitizer.bypassSecurityTrustHtml(await this.mermaid.render(part.map));
      } catch {
        out[part.name] = 'error';
      }
    }
    this.svgs.set(out);
    this.drawn.emit();
  }
}
