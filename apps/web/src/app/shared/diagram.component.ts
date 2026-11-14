import { Component, ElementRef, HostListener, Input, OnChanges, OnDestroy, OnInit, ViewChild } from '@angular/core';

type MermaidApi = typeof import('mermaid').default;

let loader: Promise<MermaidApi> | null = null;
let serial = 0;

function mermaidApi(): Promise<MermaidApi> {
  loader ??= import('mermaid').then((module) => module.default);
  return loader;
}

function palette(dark: boolean): Record<string, string> {
  return dark
    ? {
        background: '#0f1a27', primaryColor: '#16263a', primaryTextColor: '#e8eef5', primaryBorderColor: '#e8c85c',
        secondaryColor: '#2a2615', secondaryTextColor: '#f3e3a6', secondaryBorderColor: '#e8c85c', tertiaryColor: '#121f2f',
        tertiaryTextColor: '#e8eef5', tertiaryBorderColor: '#2b3d52', lineColor: '#8fa3b8', textColor: '#e8eef5',
        clusterBkg: '#121f2f', clusterBorder: '#2b3d52', edgeLabelBackground: '#0f1a27', titleColor: '#ffffff',
        attributeBackgroundColorOdd: '#132233', attributeBackgroundColorEven: '#0f1c2b', nodeTextColor: '#e8eef5',
        labelBackgroundColor: '#0f1a27', stateLabelColor: '#e8eef5', compositeBackground: '#121f2f',
        actorBkg: '#16263a', actorBorder: '#e8c85c', actorTextColor: '#e8eef5', signalColor: '#8fa3b8', signalTextColor: '#e8eef5',
        noteBkgColor: '#2a2615', noteTextColor: '#f3e3a6', noteBorderColor: '#e8c85c', activationBkgColor: '#2a2615',
      }
    : {
        background: '#ffffff', primaryColor: '#eef3f8', primaryTextColor: '#103860', primaryBorderColor: '#103860',
        secondaryColor: '#fbf3d6', secondaryTextColor: '#5c4a10', secondaryBorderColor: '#c9a83c', tertiaryColor: '#f7f9fb',
        tertiaryTextColor: '#103860', tertiaryBorderColor: '#d5dde6', lineColor: '#5b6b7c', textColor: '#1d2b3a',
        clusterBkg: '#f7f9fb', clusterBorder: '#d5dde6', edgeLabelBackground: '#ffffff', titleColor: '#103860',
        attributeBackgroundColorOdd: '#ffffff', attributeBackgroundColorEven: '#f4f7fa', nodeTextColor: '#103860',
        labelBackgroundColor: '#ffffff', stateLabelColor: '#103860', compositeBackground: '#f7f9fb',
        actorBkg: '#eef3f8', actorBorder: '#103860', actorTextColor: '#103860', signalColor: '#5b6b7c', signalTextColor: '#1d2b3a',
        noteBkgColor: '#fbf3d6', noteTextColor: '#5c4a10', noteBorderColor: '#c9a83c', activationBkgColor: '#fbf3d6',
      };
}

/** Text that is safe inside a quoted Mermaid label. */
export function label(value: string): string {
  return String(value ?? '').replace(/["`<>{}[\]|#;\\]/g, ' ').replace(/\s+/g, ' ').trim() || '-';
}

@Component({
  selector: 'app-diagram',
  template: `
    <section class="card dg" [class.is-full]="full">
      <header class="dg-head">
        <div>
          <h2>{{ title }}</h2>
          @if (hint) { <p class="muted">{{ hint }}</p> }
        </div>
        <div class="dg-tools" role="toolbar" [attr.aria-label]="title + ' tools'">
          <button type="button" class="icon-btn" (click)="zoomBy(-0.2)" aria-label="Zoom out" title="Zoom out"><i class="bi bi-zoom-out"></i></button>
          <span class="dg-zoom">{{ (zoom * 100).toFixed(0) }}%</span>
          <button type="button" class="icon-btn" (click)="zoomBy(0.2)" aria-label="Zoom in" title="Zoom in"><i class="bi bi-zoom-in"></i></button>
          <button type="button" class="icon-btn" (click)="fit()" aria-label="Fit to width" title="Fit to width"><i class="bi bi-arrows-angle-contract"></i></button>
          <button type="button" class="icon-btn" (click)="download()" [disabled]="!ready" aria-label="Download SVG" title="Download SVG"><i class="bi bi-download"></i></button>
          <button type="button" class="icon-btn" (click)="toggleFull()" [attr.aria-label]="full ? 'Close full screen' : 'Full screen'" [title]="full ? 'Close full screen' : 'Full screen'"><i class="bi" [class.bi-fullscreen]="!full" [class.bi-fullscreen-exit]="full"></i></button>
        </div>
      </header>
      <div class="dg-body" #body>
        @if (!ready && !problem) { <p class="muted dg-wait"><i class="bi bi-hourglass-split"></i> Drawing…</p> }
        @if (problem) { <p class="form-error" data-inline-message>{{ problem }}</p> }
        <div class="dg-canvas" #canvas></div>
      </div>
    </section>
  `,
})
export class DiagramComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) code = '';
  @Input() title = '';
  @Input() hint = '';
  @Input() file = 'diagram';
  @ViewChild('canvas', { static: true }) canvas!: ElementRef<HTMLDivElement>;
  @ViewChild('body', { static: true }) body!: ElementRef<HTMLDivElement>;

  ready = false;
  problem = '';
  zoom = 1;
  full = false;
  private natural = 0;
  private watcher?: MutationObserver;
  private drawn = '';

  ngOnInit(): void {
    this.watcher = new MutationObserver(() => void this.draw(true));
    this.watcher.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  }

  ngOnChanges(): void {
    void this.draw(false);
  }

  @HostListener('document:keydown.escape')
  closeFull(): void {
    if (this.full) this.toggleFull();
  }

  ngOnDestroy(): void {
    this.watcher?.disconnect();
    document.body.classList.remove('dg-locked');
  }

  private async draw(themeOnly: boolean): Promise<void> {
    const dark = document.documentElement.classList.contains('theme-dark');
    const stamp = (dark ? 'd:' : 'l:') + this.code;
    if (!this.code || stamp === this.drawn || (themeOnly && !this.drawn)) return;
    this.drawn = stamp;
    this.problem = '';
    try {
      const mermaid = await mermaidApi();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: { ...palette(dark), fontFamily: getComputedStyle(document.body).fontFamily, fontSize: '14px' },
        flowchart: { useMaxWidth: false, curve: 'basis', padding: 12 },
        er: { useMaxWidth: false },
        state: { useMaxWidth: false },
        sequence: { useMaxWidth: false },
      });
      const { svg } = await mermaid.render('dg-' + ++serial, this.code);
      if (this.drawn !== stamp) return;
      this.canvas.nativeElement.innerHTML = svg;
      const node = this.canvas.nativeElement.querySelector('svg');
      if (node) {
        node.removeAttribute('height');
        node.style.maxWidth = 'none';
        this.natural = node.viewBox?.baseVal?.width || node.getBoundingClientRect().width;
        if (!themeOnly) this.fit(); else this.apply();
      }
      this.ready = true;
    } catch (error) {
      this.ready = false;
      this.canvas.nativeElement.innerHTML = '';
      this.problem = 'This diagram could not be drawn. ' + (error instanceof Error ? error.message.split('\n')[0] : '');
    }
  }

  zoomBy(step: number): void {
    this.zoom = Math.min(3, Math.max(0.2, Math.round((this.zoom + step) * 10) / 10));
    this.apply();
  }

  fit(): void {
    const room = this.body.nativeElement.clientWidth - 24;
    this.zoom = this.natural > 0 && room > 0 ? Math.min(1.1, Math.max(0.7, Math.floor((room / this.natural) * 100) / 100)) : 1;
    this.apply();
  }

  toggleFull(): void {
    this.full = !this.full;
    document.body.classList.toggle('dg-locked', this.full);
    setTimeout(() => this.fit());
  }

  download(): void {
    const node = this.canvas.nativeElement.querySelector('svg');
    if (!node) return;
    const copy = node.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    copy.style.width = this.natural + 'px';
    copy.style.background = palette(document.documentElement.classList.contains('theme-dark'))['background'];
    const url = URL.createObjectURL(new Blob([copy.outerHTML], { type: 'image/svg+xml' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = this.file + '.svg';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private apply(): void {
    const node = this.canvas.nativeElement.querySelector('svg');
    if (node && this.natural) node.style.width = Math.round(this.natural * this.zoom) + 'px';
  }
}
