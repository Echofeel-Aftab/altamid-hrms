import { Component, Injectable, OnDestroy, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ModalComponent, ModalSize, ModalTone } from './modal.component';

export type SweetKind = 'info' | 'success' | 'warning' | 'error' | 'question';

export interface SweetOptions {
  title: string;
  text?: string;
  kind?: SweetKind;
  /** Label and value lines shown under the text. */
  rows?: { label: string; value: string; tone?: 'ok' | 'bad' | 'muted' }[];
  /** Short points shown as a list. */
  points?: string[];
  pointsTitle?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  size?: ModalSize;
}

export interface PreviewOptions {
  title: string;
  subtitle?: string;
  blob: Blob;
  fileName?: string;
}

interface SweetItem extends SweetOptions {
  id: number;
  mode: 'alert' | 'confirm' | 'preview';
  resolve: (value: boolean) => void;
  preview?: { url: string; safe: SafeResourceUrl; type: 'pdf' | 'image' | 'text' | 'other'; text: string; fileName: string; size: string; subtitle: string };
}

const ICONS: Record<SweetKind, { icon: string; tone: ModalTone }> = {
  info: { icon: 'bi-info-lg', tone: 'info' },
  success: { icon: 'bi-check-lg', tone: 'ok' },
  warning: { icon: 'bi-exclamation-lg', tone: 'warn' },
  error: { icon: 'bi-x-lg', tone: 'bad' },
  question: { icon: 'bi-question-lg', tone: 'gold' },
};

let serial = 0;

@Injectable({ providedIn: 'root' })
export class Sweet {
  private readonly sanitizer = inject(DomSanitizer);
  readonly queue = signal<SweetItem[]>([]);
  private static guardsOn = false;

  constructor() {
    this.guardBrowserDialogs();
  }

  /** Route native alert/confirm through the centered sweet modal so nothing falls back to the browser chrome. */
  private guardBrowserDialogs(): void {
    if (Sweet.guardsOn || typeof window === 'undefined') return;
    Sweet.guardsOn = true;
    window.alert = (message?: string) => {
      void this.info({ title: 'Notice', text: String(message ?? ''), confirmText: 'Got it' });
    };
    window.confirm = ((message?: string) => {
      void this.confirm({ title: 'Please confirm', text: String(message ?? ''), confirmText: 'Continue', cancelText: 'Cancel' });
      // Native confirm is sync; callers must use Sweet.confirm instead. Returning false refuses the unsafe path.
      return false;
    }) as typeof window.confirm;
  }

  info(options: SweetOptions | string): Promise<boolean> {
    return this.push('alert', { kind: 'info', ...this.wrap(options) });
  }

  success(options: SweetOptions | string): Promise<boolean> {
    return this.push('alert', { kind: 'success', ...this.wrap(options) });
  }

  error(options: SweetOptions | string): Promise<boolean> {
    return this.push('alert', { kind: 'error', ...this.wrap(options) });
  }

  confirm(options: SweetOptions | string): Promise<boolean> {
    return this.push('confirm', { kind: 'question', confirmText: 'Yes, continue', cancelText: 'Cancel', ...this.wrap(options) });
  }

  async preview(options: PreviewOptions): Promise<void> {
    const blob = options.blob;
    const kind = blob.type.includes('pdf') ? 'pdf' : blob.type.startsWith('image/') ? 'image' : blob.type.startsWith('text/') || blob.type.includes('json') ? 'text' : 'other';
    const url = URL.createObjectURL(blob);
    const text = kind === 'text' ? (await blob.text()).slice(0, 200000) : '';
    const extension = blob.type.includes('pdf') ? '.pdf' : blob.type.startsWith('image/') ? '.' + blob.type.split('/')[1].replace('jpeg', 'jpg') : '';
    const fileName = options.fileName || options.title.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '') + extension;
    await this.push('preview', {
      title: options.title,
      size: kind === 'image' ? 'lg' : 'xl',
      preview: {
        url,
        safe: this.sanitizer.bypassSecurityTrustResourceUrl(url),
        type: kind,
        text,
        fileName,
        size: blob.size > 1048576 ? (blob.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(blob.size / 1024)) + ' KB',
        subtitle: options.subtitle || '',
      },
    } as SweetOptions & { preview: SweetItem['preview'] });
    setTimeout(() => URL.revokeObjectURL(url), 400);
  }

  settle(id: number, value: boolean): void {
    const item = this.queue().find((row) => row.id === id);
    if (!item) return;
    this.queue.update((rows) => rows.filter((row) => row.id !== id));
    item.resolve(value);
  }

  look(kind: SweetKind = 'info') {
    return ICONS[kind];
  }

  private wrap(options: SweetOptions | string): SweetOptions {
    return typeof options === 'string' ? { title: options } : options;
  }

  private push(mode: SweetItem['mode'], options: SweetOptions & { preview?: SweetItem['preview'] }): Promise<boolean> {
    return new Promise((resolve) => {
      this.queue.update((rows) => [...rows, { ...options, mode, id: ++serial, resolve }]);
    });
  }
}

@Component({
  selector: 'app-sweet-host',
  imports: [ModalComponent],
  template: `
    @for (item of sweet.queue(); track item.id) {
      @if (item.mode === 'preview' && item.preview; as file) {
        <app-modal [open]="true" [size]="item.size || 'xl'" [title]="item.title" [subtitle]="(file.subtitle ? file.subtitle + ' · ' : '') + file.size" icon="bi-file-earmark-text" tone="navy" [flush]="true" (closed)="sweet.settle(item.id, false)">
          <div class="sw-preview" [class]="'sw-preview is-' + file.type">
            @switch (file.type) {
              @case ('pdf') { <iframe [src]="file.safe" [title]="item.title"></iframe> }
              @case ('image') { <img [src]="file.safe" [alt]="item.title"> }
              @case ('text') { <pre>{{ file.text }}</pre> }
              @default {
                <div class="sw-none"><i class="bi bi-file-earmark"></i><strong>This file cannot be shown here</strong><p class="muted">Download it to open it on your computer.</p></div>
              }
            }
          </div>
          <footer modalFooter class="md-foot">
            <span class="muted md-foot-note"><i class="bi bi-shield-lock"></i> Opened privately in your browser</span>
            <a class="btn btn-ghost" [href]="file.safe" [attr.download]="file.fileName"><i class="bi bi-download"></i> Download</a>
            @if (file.type === 'pdf') { <a class="btn btn-ghost" [href]="file.safe" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> New tab</a> }
            <button type="button" class="btn btn-primary" (click)="sweet.settle(item.id, false)">Close</button>
          </footer>
        </app-modal>
      } @else {
        <app-modal [open]="true" [size]="item.size || 'sm'" [dismissible]="item.mode === 'alert'" (closed)="sweet.settle(item.id, false)">
          <div class="sw-card">
            <span class="sw-badge" [class]="'sw-badge is-' + sweet.look(item.kind).tone"><i class="bi" [class]="sweet.look(item.kind).icon"></i></span>
            <h2 class="sw-title">{{ item.title }}</h2>
            @if (item.text) { <p class="sw-text">{{ item.text }}</p> }
            @if (item.rows?.length) {
              <dl class="sw-rows">
                @for (row of item.rows; track row.label) { <div><dt>{{ row.label }}</dt><dd [class]="row.tone ? 'is-' + row.tone : ''">{{ row.value }}</dd></div> }
              </dl>
            }
            @if (item.points?.length) {
              <div class="sw-points">
                @if (item.pointsTitle) { <p>{{ item.pointsTitle }}</p> }
                <ul>@for (point of item.points; track point) { <li><i class="bi bi-check2"></i><span>{{ point }}</span></li> }</ul>
              </div>
            }
          </div>
          <footer modalFooter class="md-foot is-center">
            @if (item.mode === 'confirm') {
              <button type="button" class="btn btn-ghost" (click)="sweet.settle(item.id, false)">{{ item.cancelText || 'Cancel' }}</button>
              <button type="button" class="btn" [class.btn-primary]="!item.danger" [class.btn-danger-solid]="item.danger" (click)="sweet.settle(item.id, true)" autofocus>{{ item.confirmText || 'Yes, continue' }}</button>
            } @else {
              <button type="button" class="btn btn-primary" (click)="sweet.settle(item.id, true)" autofocus>{{ item.confirmText || 'Got it' }}</button>
            }
          </footer>
        </app-modal>
      }
    }
  `,
})
export class SweetHostComponent implements OnDestroy {
  readonly sweet = inject(Sweet);

  ngOnDestroy(): void {
    for (const item of this.sweet.queue()) this.sweet.settle(item.id, false);
  }
}
