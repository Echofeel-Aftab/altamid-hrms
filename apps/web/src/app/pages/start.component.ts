import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { STATES } from '../core/models';

@Component({
  selector: 'app-start',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-page">
      <div class="auth-scene" aria-hidden="true">
        <div class="auth-grid"></div>
        <div class="auth-glow auth-glow-a"></div>
        <div class="auth-glow auth-glow-b"></div>
      </div>
      <main class="auth-shell">
        <section class="auth-hero">
          <p class="auth-kicker">Altamid Solutions</p>
          <h2>A workspace your team can understand on the first morning.</h2>
          <p>You become the owner and the first employee. Add everyone else when you are ready.</p>
          <ul class="auth-pills">
            <li>Owner setup</li>
            <li>Indian states</li>
            <li>Ready to punch in</li>
          </ul>
        </section>
        <form class="auth-card" (ngSubmit)="submit()">
          <div class="auth-brand">
            <span class="brand-mark"><img src="brand/logo-icon.png" alt="Altamid"></span>
            <strong>Altamid</strong>
            <span>HRMS & Payroll</span>
          </div>
          <h1>Create your company</h1>
          <p class="auth-lead">Same mark, same navy and gold, a new company workspace.</p>
          @if (error) { <div class="form-error">{{ error }}</div> }
          <div class="auth-field">
            <label for="company">Company name</label>
            <div class="auth-input"><i class="bi bi-building"></i><input id="company" name="company" [(ngModel)]="companyName" required></div>
          </div>
          <div class="auth-field">
            <label for="state">State</label>
            <div class="auth-input">
              <i class="bi bi-geo-alt"></i>
              <select id="state" name="state" [(ngModel)]="state" required>
                @for (item of states; track item) { <option [value]="item">{{ item }}</option> }
              </select>
            </div>
          </div>
          <div class="auth-field">
            <label for="name">Your name</label>
            <div class="auth-input"><i class="bi bi-person"></i><input id="name" name="name" [(ngModel)]="adminName" required></div>
          </div>
          <div class="auth-field">
            <label for="email">Work email</label>
            <div class="auth-input"><i class="bi bi-envelope"></i><input id="email" name="email" type="email" autocomplete="username" [(ngModel)]="email" required></div>
          </div>
          <div class="auth-field">
            <label for="password">Password</label>
            <div class="auth-input"><i class="bi bi-shield-lock"></i><input id="password" name="password" type="password" autocomplete="new-password" [(ngModel)]="password" required></div>
          </div>
          <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2-circle"></i> {{ busy ? 'Creating…' : 'Create workspace' }}</button>
          <p class="auth-switch">Already set up? <a routerLink="/login">Sign in</a></p>
        </form>
      </main>
    </div>
  `,
})
export class StartComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  readonly states = STATES;
  companyName = '';
  state = 'Maharashtra';
  adminName = '';
  email = '';
  password = '';
  error = '';
  busy = false;

  async submit(): Promise<void> {
    this.error = '';
    this.busy = true;
    try {
      const result = await this.api.post<{ token: string }>('/v1/start', {
        companyName: this.companyName,
        state: this.state,
        adminName: this.adminName,
        email: this.email,
        password: this.password,
      });
      this.api.setToken(result.token);
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not create the company.';
    } finally {
      this.busy = false;
    }
  }
}
