import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { OutletChoice } from '../core/models';
import { SessionStore } from '../core/session.store';

@Component({
  selector: 'app-outlet-pick',
  template: `
    <div class="auth-page">
      <div class="auth-scene" aria-hidden="true">
        <div class="auth-grid"></div>
        <div class="auth-glow auth-glow-a"></div>
        <div class="auth-glow auth-glow-b"></div>
      </div>
      <main class="outlet-pick">
        <div class="auth-brand">
          <span class="brand-mark"><img src="brand/logo-icon.png" alt=""></span>
          <strong>{{ store.me?.company?.name }}</strong>
          <span>Hello {{ firstName }}</span>
        </div>
        <h1>Which outlet are you working in?</h1>
        <p class="auth-lead">Everything you see and add stays inside the outlet you choose. You can switch from the top bar at any time.</p>
        <div class="outlet-pick-grid" role="list">
          @if (store.me?.outlets?.master) {
            <button type="button" class="outlet-pick-tile is-all" role="listitem" (click)="choose('all')">
              <i class="bi bi-diagram-3"></i>
              <strong>All outlets</strong>
              <small>See every outlet together. Choose one outlet to add records or run payroll.</small>
            </button>
          }
          @for (outlet of outlets; track outlet.id) {
            <button type="button" class="outlet-pick-tile" role="listitem" (click)="choose(outlet.id)">
              <i class="bi bi-building"></i>
              <strong>{{ outlet.name }}</strong>
              <small>{{ place(outlet) }}</small>
              @if (!outlet.usable) {
                <span class="outlet-pick-flag bad">Subscription paused</span>
              } @else if (!outlet.payroll) {
                <span class="outlet-pick-flag">HR only, no payroll</span>
              }
            </button>
          }
        </div>
        <button type="button" class="linkish outlet-pick-out" (click)="signOut()">Sign out</button>
      </main>
    </div>
  `,
})
export class OutletPickComponent {
  readonly store = inject(SessionStore);
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  get outlets(): OutletChoice[] {
    return this.store.me?.outlets?.list || [];
  }

  get firstName(): string {
    return (this.store.me?.name || '').split(' ')[0] || 'there';
  }

  place(outlet: OutletChoice): string {
    return [outlet.city, outlet.country === 'IN' ? 'India' : outlet.country].filter(Boolean).join(', ');
  }

  choose(id: string): void {
    this.api.setOutlet(id);
    window.location.assign('/');
  }

  signOut(): void {
    this.api.setToken('');
    this.store.clear();
    void this.router.navigateByUrl('/login');
  }
}
