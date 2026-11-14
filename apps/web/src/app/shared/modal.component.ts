import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy, Output, SimpleChanges, ViewChild } from '@angular/core';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';
export type ModalTone = 'navy' | 'gold' | 'ok' | 'warn' | 'bad' | 'info';

let openCount = 0;
let serial = 0;

@Component({
  selector: 'app-modal',
  template: `
    <div #layer class="md-layer" [class.is-on]="shown" [class.is-leaving]="leaving" [attr.hidden]="shown ? null : ''">
      <div class="md-backdrop" (click)="dismissible && close()"></div>
      <section #panel class="md-panel" [class]="'md-panel md-' + size" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" tabindex="-1" (keydown)="trap($event)">
        @if (title) {
          <header class="md-head">
            @if (icon) { <span class="md-icon" [class]="'md-icon is-' + tone"><i class="bi" [class]="icon"></i></span> }
            <div class="md-titles">
              <h2 [id]="titleId">{{ title }}</h2>
              @if (subtitle) { <p>{{ subtitle }}</p> }
            </div>
            <ng-content select="[modalHead]" />
            @if (dismissible) {
              <button type="button" class="md-x" (click)="close()" aria-label="Close"><i class="bi bi-x-lg"></i></button>
            }
          </header>
        }
        <div class="md-body" [class.is-flush]="flush"><ng-content /></div>
        <ng-content select="[modalFooter]" />
      </section>
    </div>
  `,
})
export class ModalComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() open = false;
  @Input() size: ModalSize = 'md';
  @Input() title = '';
  @Input() subtitle = '';
  @Input() icon = '';
  @Input() tone: ModalTone = 'navy';
  @Input() dismissible = true;
  /** Removes body padding, for previews that fill the panel. */
  @Input() flush = false;
  @Output() closed = new EventEmitter<void>();
  @ViewChild('layer', { static: true }) layer!: ElementRef<HTMLDivElement>;
  @ViewChild('panel', { static: true }) panel!: ElementRef<HTMLElement>;

  readonly titleId = 'md-title-' + ++serial;
  shown = false;
  leaving = false;
  private returnFocus: HTMLElement | null = null;
  private leaveTimer = 0;
  private readonly onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.shown && this.dismissible && this.isTop()) {
      event.stopPropagation();
      this.close();
    }
  };

  ngAfterViewInit(): void {
    document.body.appendChild(this.layer.nativeElement);
    document.addEventListener('keydown', this.onKey, true);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['open']) return;
    if (this.open) this.show();
    else if (this.shown) this.hide();
  }

  ngOnDestroy(): void {
    window.clearTimeout(this.leaveTimer);
    document.removeEventListener('keydown', this.onKey, true);
    if (this.shown) this.unlock();
    this.layer.nativeElement.remove();
  }

  close(): void {
    this.closed.emit();
  }

  trap(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const items = [...this.panel.nativeElement.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])')]
      .filter((item) => item.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private show(): void {
    window.clearTimeout(this.leaveTimer);
    this.leaving = false;
    if (this.shown) return;
    this.shown = true;
    this.returnFocus = document.activeElement as HTMLElement | null;
    document.body.appendChild(this.layer.nativeElement);
    openCount += 1;
    document.body.classList.add('md-locked');
    setTimeout(() => {
      const target = this.panel.nativeElement.querySelector<HTMLElement>('[autofocus], .md-body input, .md-body select, .md-body textarea, [modalFooter] .btn-primary') || this.panel.nativeElement;
      target.focus({ preventScroll: true });
    }, 30);
  }

  private hide(): void {
    this.leaving = true;
    const quick = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.leaveTimer = window.setTimeout(() => {
      this.shown = false;
      this.leaving = false;
      this.unlock();
      this.returnFocus?.focus?.({ preventScroll: true });
    }, quick ? 0 : 170);
  }

  private unlock(): void {
    openCount = Math.max(0, openCount - 1);
    if (!openCount) document.body.classList.remove('md-locked');
  }

  private isTop(): boolean {
    const layers = [...document.querySelectorAll('.md-layer.is-on')];
    return layers[layers.length - 1] === this.layer.nativeElement;
  }
}
