import { Injectable } from '@angular/core';

interface MermaidApi {
  initialize(config: Record<string, unknown>): void;
  parse(text: string): Promise<unknown>;
  render(id: string, text: string): Promise<{ svg: string }>;
}

declare global {
  interface Window {
    mermaid?: MermaidApi;
  }
}

/** A run of Latin words with their code punctuation, e.g. "SKILL.md files", "px()", "check-my-styles". */
const LATIN_RUN = /[A-Za-z0-9][\w.\-/@#+:'()[\]{}]*(?:[ \t]+[A-Za-z0-9][\w.\-/@#+:'()[\]{}]*)*/g;

const MERMAID_SRC ='https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js';

/** Loads Mermaid on first use and renders it in the page's own palette. */
@Injectable({ providedIn: 'root' })
export class MermaidService {
  private loading?: Promise<MermaidApi>;
  private renderCount = 0;

  load(): Promise<MermaidApi> {
    this.loading ??= new Promise<MermaidApi>((resolve, reject) => {
      if (window.mermaid) {
        resolve(window.mermaid);
        return;
      }
      const script = document.createElement('script');
      script.src = MERMAID_SRC;
      script.async = true;
      script.onload = () => (window.mermaid ? resolve(window.mermaid) : reject(new Error('mermaid missing')));
      script.onerror = () => reject(new Error('mermaid failed to load'));
      document.head.appendChild(script);
    }).catch((error) => {
      this.loading = undefined;
      throw error;
    });
    return this.loading;
  }

  /** Throws with Mermaid's own message when the source does not parse. */
  async validate(source: string): Promise<void> {
    const mermaid = await this.load();
    await mermaid.parse(source);
  }

  async render(source: string): Promise<string> {
    const mermaid = await this.load();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: getComputedStyle(document.body).fontFamily,
      flowchart: { htmlLabels: false, curve: 'basis', padding: 14 },
      themeVariables: this.themeVariables(),
    });
    const { svg } = await mermaid.render(`idea-map-${++this.renderCount}`, source);
    return this.fixLabelDirection(svg);
  }

  /**
   * SVG text inherits the map's left-to-right stage, so an Arabic label holding an English word
   * ("مراجعة SCSS قبل الإيداع") came out with its parts in the wrong order. Each label now takes
   * its own direction from its first strong letter, so both languages read in their natural order.
   */
  private fixLabelDirection(svg: string): string {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return svg;
    let changed = false;
    for (const text of doc.querySelectorAll('text')) {
      const first = /[֐-ࣿיִ-﷿ﹰ-﻿]|[A-Za-zÀ-ɏ]/.exec(text.textContent ?? '');
      if (!first) continue;
      const rtl = !/[A-Za-zÀ-ɏ]/.test(first[0]);
      text.setAttribute('direction', rtl ? 'rtl' : 'ltr');
      text.setAttribute('unicode-bidi', 'embed');
      if (rtl) {
        // English runs inside Arabic stay whole, brackets and dots included ("px()", "SKILL.md").
        for (const node of this.textNodes(text)) node.data = node.data.replace(LATIN_RUN, '⁦$&⁩');
        // Edge labels are laid out from their left edge; keep that edge where Mermaid put it.
        if (text.closest('.edgeLabel')) text.setAttribute('style', `${text.getAttribute('style') ?? ''};text-anchor:end`);
      }
      changed = true;
    }
    return changed ? new XMLSerializer().serializeToString(doc.documentElement) : svg;
  }

  private textNodes(root: Node): Text[] {
    const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    return nodes;
  }

  /** Mermaid's colour maths can't read oklch(), so tokens are resolved to hex through a canvas. */
  private themeVariables(): Record<string, string> {
    const hex = this.resolver();
    return {
      background: 'transparent',
      primaryColor: hex('--accent-soft'),
      primaryBorderColor: hex('--accent-text'),
      primaryTextColor: hex('--text'),
      secondaryColor: hex('--surface-2'),
      tertiaryColor: hex('--surface'),
      lineColor: hex('--text-muted'),
      textColor: hex('--text'),
      mainBkg: hex('--accent-soft'),
      nodeBorder: hex('--accent-text'),
      clusterBkg: hex('--surface-2'),
      clusterBorder: hex('--line-strong'),
      edgeLabelBackground: hex('--surface'),
      fontSize: '15px',
    };
  }

  private resolver(): (token: string) => string {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const probe = document.createElement('span');
    document.body.appendChild(probe);
    const cache = new Map<string, string>();
    const resolve = (token: string): string => {
      if (cache.has(token)) return cache.get(token)!;
      probe.style.color = `var(${token})`;
      const css = getComputedStyle(probe).color;
      let out = '#888888';
      if (ctx) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = '#000';
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        out = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      }
      cache.set(token, out);
      return out;
    };
    queueMicrotask(() => probe.remove());
    return resolve;
  }
}
