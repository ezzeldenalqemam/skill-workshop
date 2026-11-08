import { inject, Pipe, PipeTransform } from '@angular/core';
import { I18nService, MessageParams } from './i18n.service';
import { MessageKey } from './messages';

/** `{{ 'spec.title' | t }}` / `[attr.aria-label]="'viewer.delete' | t"` — re-evaluates on language change. */
@Pipe({ name: 't', pure: false })
export class TPipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: MessageKey, params?: MessageParams): string {
    return this.i18n.t(key, params);
  }
}
