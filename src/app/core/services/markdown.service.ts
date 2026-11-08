import { inject, Injectable } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export interface RenderedMarkdown {
  html: SafeHtml;
  frontmatter: string | null;
}

/** Markdown -> sanitized HTML, with every element tagged `c-markdown__<tag>` for styling. */
@Injectable({ providedIn: 'root' })
export class MarkdownService {
  private readonly sanitizer = inject(DomSanitizer);
  private hookAdded = false;

  async render(source: string): Promise<RenderedMarkdown> {
    const [{ marked }, { default: DOMPurify }] = await Promise.all([import('marked'), import('dompurify')]);
    if (!this.hookAdded) {
      // Generated markup has no classes; tag each element so styles never need bare tag selectors.
      DOMPurify.addHook('afterSanitizeAttributes', (node) => {
        if (node instanceof Element) node.setAttribute('class', `c-markdown__${node.tagName.toLowerCase()}`);
        if (node instanceof HTMLAnchorElement) {
          node.setAttribute('target', '_blank');
          node.setAttribute('rel', 'noopener noreferrer');
        }
      });
      this.hookAdded = true;
    }
    let body = source;
    const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
    if (fm) body = source.slice(fm[0].length);
    const clean = DOMPurify.sanitize(await marked.parse(body, { gfm: true }), { USE_PROFILES: { html: true } });
    // Sanitized by DOMPurify above: Claude's output and uploads are untrusted.
    return { html: this.sanitizer.bypassSecurityTrustHtml(clean), frontmatter: fm ? fm[1] : null };
  }
}
