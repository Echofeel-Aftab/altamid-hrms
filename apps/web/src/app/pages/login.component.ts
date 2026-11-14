import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-login',
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
          <h2>Run HR and payroll without the spreadsheet gymnastics.</h2>
          <p>People, attendance, leave, and announcements in the same navy-and-gold workspace as the rest of Altamid.</p>
          <ul class="auth-pills">
            <li><i class="bi bi-people"></i> People</li>
            <li><i class="bi bi-clock"></i> Attendance</li>
            <li><i class="bi bi-calendar2-week"></i> Leave</li>
            <li><i class="bi bi-megaphone"></i> Announcements</li>
          </ul>
        </section>
        <form class="auth-card" (ngSubmit)="submit()">
          <div class="auth-brand">
            <span class="brand-mark"><img src="brand/logo-icon.png" alt="Altamid"></span>
            <strong>Altamid</strong>
            <span>HRMS & Payroll</span>
          </div>
          <h1>Sign in</h1>
          <p class="auth-lead">Use the work email your company set up.</p>
          @if (error) { <div class="form-error">{{ error }}</div> }
          <div class="auth-field">
            <label for="email">Work email</label>
            <div class="auth-input">
              <i class="bi bi-envelope"></i>
              <input id="email" name="email" type="email" autocomplete="username" [(ngModel)]="email" placeholder="you@company.com" required>
            </div>
          </div>
          <div class="auth-field">
            <label for="password">Password</label>
            <div class="auth-input">
              <i class="bi bi-shield-lock"></i>
              <input id="password" name="password" type="password" autocomplete="current-password" [(ngModel)]="password" placeholder="Password" required>
            </div>
          </div>
          <a class="auth-forgot" routerLink="/forgot">Forgot password?</a>
          <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-box-arrow-in-right"></i> {{ busy ? 'Signing in…' : 'Sign in' }}</button>
          <p class="auth-switch">New company? <a routerLink="/start">Create your workspace</a></p>
        </form>
      </main>
    </div>
  `,
})
export class LoginComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  email = '';
  password = '';
  error = '';
  busy = false;

  async submit(): Promise<void> {
    this.error = '';
    this.busy = true;
    try {
      const result = await this.api.post<{ token: string }>('/v1/auth/login', { email: this.email, password: this.password });
      this.api.setToken(result.token);
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Sign-in failed.';
    } finally {
      this.busy = false;
    }
  }
}
