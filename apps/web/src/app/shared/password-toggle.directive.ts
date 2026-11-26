import { AfterViewInit, Directive, ElementRef, OnDestroy, Renderer2, inject } from '@angular/core';

/** Adds a show/hide eye control to every `type="password"` input. */
@Directive({
  selector: 'input[type="password"]',
  standalone: true,
})
export class PasswordToggleDirective implements AfterViewInit, OnDestroy {
  private readonly el = inject(ElementRef<HTMLInputElement>);
  private readonly renderer = inject(Renderer2);
  private shown = false;
  private button: HTMLButtonElement | null = null;
  private host: HTMLElement | null = null;
  private createdWrap = false;
  private unlisten: (() => void) | null = null;

  ngAfterViewInit(): void {
    const input = this.el.nativeElement;
    if (input.dataset['pwToggle'] === 'off' || input.closest('.pw-wrap')) return;

    const parent = input.parentElement;
    if (!parent) return;

    if (parent.classList.contains('auth-input')) {
      this.host = parent;
      this.renderer.addClass(parent, 'pw-wrap');
    } else {
      const wrap = this.renderer.createElement('div') as HTMLElement;
      this.renderer.addClass(wrap, 'pw-wrap');
      this.renderer.insertBefore(parent, wrap, input);
      this.renderer.appendChild(wrap, input);
      this.host = wrap;
      this.createdWrap = true;
    }

    const btn = this.renderer.createElement('button') as HTMLButtonElement;
    btn.type = 'button';
    btn.className = 'pw-toggle';
    btn.setAttribute('aria-label', 'Show password');
    btn.setAttribute('aria-pressed', 'false');
    btn.innerHTML = '<i class="bi bi-eye" aria-hidden="true"></i>';
    this.unlisten = this.renderer.listen(btn, 'click', (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
      this.toggle();
    });
    this.renderer.appendChild(this.host, btn);
    this.button = btn;
  }

  private toggle(): void {
    this.shown = !this.shown;
    const input = this.el.nativeElement;
    input.type = this.shown ? 'text' : 'password';
    if (!this.button) return;
    this.button.setAttribute('aria-label', this.shown ? 'Hide password' : 'Show password');
    this.button.setAttribute('aria-pressed', String(this.shown));
    const icon = this.button.querySelector('i');
    if (icon) icon.className = this.shown ? 'bi bi-eye-slash' : 'bi bi-eye';
  }

  ngOnDestroy(): void {
    this.unlisten?.();
    this.unlisten = null;
    this.button?.remove();
    this.button = null;
    if (this.createdWrap && this.host?.isConnected) {
      const parent = this.host.parentElement;
      const input = this.el.nativeElement;
      if (parent && input) {
        this.renderer.insertBefore(parent, input, this.host);
        this.host.remove();
      }
    }
    this.host = null;
  }
}
