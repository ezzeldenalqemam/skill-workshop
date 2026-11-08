import { ChangeDetectionStrategy, Component, input, output, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/** File picker that also takes drag-and-drop; emits the chosen files. */
@Component({
  selector: 'app-drop-zone',
  imports: [IconComponent],
  templateUrl: './drop-zone.component.html',
  styleUrl: './drop-zone.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DropZoneComponent {
  readonly inputId = input.required<string>();
  readonly label = input.required<string>();
  readonly hint = input('');
  readonly compact = input(false);
  readonly files = output<File[]>();

  readonly dragging = signal(false);

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    const list = event.dataTransfer?.files;
    if (list?.length) this.files.emit(Array.from(list));
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onPick(event: Event): void {
    const field = event.target as HTMLInputElement;
    if (field.files?.length) this.files.emit(Array.from(field.files));
    field.value = '';
  }
}
