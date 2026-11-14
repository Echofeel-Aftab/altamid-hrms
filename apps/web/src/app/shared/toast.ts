import { Component, Injectable, NgZone, OnDestroy, inject, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

interface ToastItem { id: number; kind: ToastKind; title: string; text: string; ms: number; paused: boolean }

const TITLES: Record<ToastKind, string> = { success: 'Done', error: 'That did not work', info: 'Note', warning: 'Check this' };
const ICONS: Record<ToastKind, string> = { success: 'bi-check-lg', error: 'bi-x-lg', info: 'bi-info-lg', warning: 'bi-exclamation-lg' };
const MESSAGE = '.form-error, .form-ok';
/** Messages that must stay next to their form: the public apply page, and lines with a link or button in them. */
const KEEP_INLINE = '.apply-page, [data-inline-message]';

let serial = 0;

@Injectable({ providedIn: 'root' })
export class Toast {
  readonly items = signal<ToastItem[]>([]);
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private last = { text: '', at: 0 };

  success(text: string, title?: string): void { this.show('success', text, title); }
  error(text: string, title?: string): void { this.show('error', text, title); }
  info(text: string, title?: string): void { this.show('info', text, title); }
  warning(text: string, title?: string): void { this.show('warning', text, title); }

  show(kind: ToastKind, text: string, title?: string): void {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const now = Date.now();
    if (clean === this.last.text && now - this.last.at < 1500) return;
    this.last = { text: clean, at: now };
    const item: ToastItem = { id: ++serial, kind, title: title || TITLES[kind], text: clean, ms: kind === 'error' ? 7000 : 4500, paused: false };
    this.items.update((rows) => [...rows.slice(-3), item]);
    this.arm(item);
  }

  close(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.items.update((rows) => rows.filter((row) => row.id !== id));
  }

  hold(id: number, paused: boolean): void {
    const item = this.items().find((row) => row.id === id);
    if (!item) return;
    item.paused = paused;
    this.items.update((rows) => [...rows]);
    if (paused) clearTimeout(this.timers.get(id));
    else this.arm(item, 2500);
  }

  icon(kind: ToastKind): string {
    return ICONS[kind];
  }

  private arm(item: ToastItem, ms = item.ms): void {
    clearTimeout(this.timers.get(item.id));
    this.timers.set(item.id, setTimeout(() => this.close(item.id), ms));
  }
}

@Component({
  selector: 'app-toast-host',
  template: `
    <div class="toast-stack" aria-live="polite">
      @for (item of toast.items(); track item.id) {
        <div class="toast" [class]="'toast is-' + item.kind" [class.is-paused]="item.paused" [attr.role]="item.kind === 'error' ? 'alert' : 'status'"
          (mouseenter)="toast.hold(item.id, true)" (mouseleave)="toast.hold(item.id, false)">
          <span class="toast-badge"><i [class]="'bi ' + toast.icon(item.kind)"></i></span>
          <div class="toast-body">
            <strong>{{ item.title }}</strong>
            <p>{{ item.text }}</p>
          </div>
          <button type="button" class="toast-close" (click)="toast.close(item.id)" aria-label="Dismiss"><i class="bi bi-x"></i></button>
          <span class="toast-timer" [style.animation-duration.ms]="item.ms"></span>
        </div>
      }
    </div>
  `,
})
export class ToastHostComponent implements OnDestroy {
  readonly toast = inject(Toast);
  private readonly zone = inject(NgZone);
  private readonly seen = new WeakMap<Element, string>();
  private observer: MutationObserver | null = null;
  private queued = false;

  constructor() {
    if (typeof MutationObserver === 'undefined') return;
    this.zone.runOutsideAngular(() => {
      this.observer = new MutationObserver(() => this.schedule());
      this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.relay();
    });
  }

  /** Every success or error line a screen shows is moved into a toast, so all screens behave the same. */
  private relay(): void {
    const found: Array<{ kind: ToastKind; text: string }> = [];
    document.querySelectorAll(MESSAGE).forEach((node) => {
      if (node.closest(KEEP_INLINE) || node.querySelector('a, button, input, select')) return;
      node.classList.add('is-toasted');
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || this.seen.get(node) === text) return;
      this.seen.set(node, text);
      found.push({ kind: node.classList.contains('form-ok') ? 'success' : 'error', text });
    });
    if (found.length) this.zone.run(() => found.forEach((item) => this.toast.show(item.kind, item.text)));
  }
}
