import { computed, effect, Injectable, signal } from '@angular/core';

/** Same cycle as the qAIPlatform panel: original, then three filters. */
export const COLOR_FILTERS = [
  { key: 'original', label: 'filter.original', filter: '' },
  { key: 'lowSaturation', label: 'filter.lowSaturation', filter: 'saturate(0.6)' },
  { key: 'highSaturation', label: 'filter.highSaturation', filter: 'saturate(1.8)' },
  { key: 'grayscale', label: 'filter.grayscale', filter: 'grayscale(1)' },
] as const;

export const ZOOM_LEVELS = [87.5, 100, 112.5, 125, 137.5, 150];
const DEFAULT_ZOOM_INDEX = 1;
const KEY = 'skill-workshop.a11y';

/**
 * Zoom reflows the page by scaling the root font-size (every size is rem through px()), the colour
 * mode filters <html>, and read-aloud speaks the viewer's text selection with speechSynthesis.
 */
@Injectable({ providedIn: 'root' })
export class AccessibilityService {
  readonly zoomIndex = signal(DEFAULT_ZOOM_INDEX);
  readonly colorIndex = signal(0);
  readonly readAloud = signal(false);
  readonly reduceMotion = signal(false);

  readonly zoomPercent = computed(() => ZOOM_LEVELS[this.zoomIndex()]);
  readonly canZoomIn = computed(() => this.zoomIndex() < ZOOM_LEVELS.length - 1);
  readonly canZoomOut = computed(() => this.zoomIndex() > 0);
  readonly colorMode = computed(() => COLOR_FILTERS[this.colorIndex()]);
  readonly speechSupported = typeof globalThis.speechSynthesis !== 'undefined';
  readonly hasChanges = computed(
    () => this.zoomIndex() !== DEFAULT_ZOOM_INDEX || this.colorIndex() !== 0 || this.readAloud() || this.reduceMotion(),
  );

  constructor() {
    const saved = this.read();
    if (saved) {
      if (saved.zoomIndex >= 0 && saved.zoomIndex < ZOOM_LEVELS.length) this.zoomIndex.set(saved.zoomIndex);
      if (saved.colorIndex >= 0 && saved.colorIndex < COLOR_FILTERS.length) this.colorIndex.set(saved.colorIndex);
      this.reduceMotion.set(!!saved.reduceMotion);
    }

    effect(() => {
      const root = document.documentElement;
      const zoom = this.zoomPercent();
      root.style.fontSize = zoom === 100 ? '' : `${zoom}%`;
      root.style.filter = this.colorMode().filter;
      if (this.reduceMotion()) root.dataset['motion'] = 'reduced';
      else delete root.dataset['motion'];
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({ zoomIndex: this.zoomIndex(), colorIndex: this.colorIndex(), reduceMotion: this.reduceMotion() }),
        );
      } catch {
        // Storage can be blocked; settings still apply for this visit.
      }
    });

    effect(() => {
      if (!this.readAloud()) this.stopSpeaking();
    });
  }

  zoomIn(): void {
    if (this.canZoomIn()) this.zoomIndex.update((i) => i + 1);
  }

  zoomOut(): void {
    if (this.canZoomOut()) this.zoomIndex.update((i) => i - 1);
  }

  cycleColor(): void {
    this.colorIndex.update((i) => (i + 1) % COLOR_FILTERS.length);
  }

  reset(): void {
    this.zoomIndex.set(DEFAULT_ZOOM_INDEX);
    this.colorIndex.set(0);
    this.readAloud.set(false);
    this.reduceMotion.set(false);
  }

  // ---- read aloud ---------------------------------------------------------

  readonly speaking = signal(false);
  readonly paused = signal(false);
  readonly rate = signal(1);

  speak(text: string): void {
    if (!this.speechSupported || !text.trim()) return;
    const synth = globalThis.speechSynthesis;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[؀-ۿ]/.test(text) ? 'ar-EG' : 'en-US';
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(utterance.lang.slice(0, 2)));
    if (voice) utterance.voice = voice;
    utterance.rate = this.rate();
    utterance.onend = () => {
      this.speaking.set(false);
      this.paused.set(false);
    };
    utterance.onerror = utterance.onend;
    this.speaking.set(true);
    this.paused.set(false);
    synth.speak(utterance);
  }

  togglePause(): void {
    if (!this.speechSupported || !this.speaking()) return;
    const synth = globalThis.speechSynthesis;
    if (this.paused()) synth.resume();
    else synth.pause();
    this.paused.update((p) => !p);
  }

  stopSpeaking(): void {
    if (!this.speechSupported) return;
    globalThis.speechSynthesis.cancel();
    this.speaking.set(false);
    this.paused.set(false);
  }

  cycleRate(): void {
    const rates = [1, 1.25, 1.5, 0.75];
    this.rate.update((r) => rates[(rates.indexOf(r) + 1) % rates.length]);
  }

  private read(): { zoomIndex: number; colorIndex: number; reduceMotion: boolean } | null {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? 'null');
    } catch {
      return null;
    }
  }
}
