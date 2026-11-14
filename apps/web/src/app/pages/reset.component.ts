import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-reset',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="auth-page">
      <div class="auth-scene" aria-hidden="true">
        <div class="auth-grid"></div>
        <div class="auth-glow auth-glow-a"></div>
        <div class="auth-glow auth-glow-b"></div>
      </div>
      <main class="auth-shell auth-shell-single">
        <form class="auth-card" (ngSubmit)="submit()">
          <div class="auth-brand">
            <span class="brand-mark"><img src="brand/logo-icon.png" alt="Altamid"></span>
            <strong>Altamid</strong>
            <span>HRMS & Payroll</span>
          </div>
          @if (token) {
            <h1>Set a new password</h1>
            <p class="auth-lead">Use 8 or more characters, with a letter and a number. The link works once, for 30 minutes.</p>
          } @else {
            <h1>Forgot password</h1>
            <p class="auth-lead">Enter your work email. If it has a sign-in, we email a link to set a new password.</p>
          }
          @if (error) { <div class="form-error">{{ error }}</div> }
          @if (done) {
            <div class="form-ok">{{ done }}</div>
            <a class="btn btn-gold" routerLink="/login"><i class="bi bi-box-arrow-in-right"></i> Back to sign in</a>
          } @else {
            @if (token) {
              <div class="auth-field">
                <label for="new-password">New password</label>
                <div class="auth-input">
                  <i class="bi bi-shield-lock"></i>
                  <input id="new-password" name="password" type="password" autocomplete="new-password" [(ngModel)]="password" required>
                </div>
              </div>
              <div class="auth-field">
                <label for="again-password">Type it again</label>
                <div class="auth-input">
                  <i class="bi bi-shield-check"></i>
                  <input id="again-password" name="again" type="password" autocomplete="new-password" [(ngModel)]="again" required>
                </div>
              </div>
            } @else {
              <div class="auth-field">
                <label for="reset-email">Work email</label>
                <div class="auth-input">
                  <i class="bi bi-envelope"></i>
                  <input id="reset-email" name="email" type="email" autocomplete="username" [(ngModel)]="email" placeholder="you@company.com" required>
                </div>
              </div>
            }
            <button class="btn btn-gold" type="submit" [disabled]="busy">
              <i class="bi bi-check2"></i> {{ busy ? 'Please wait…' : token ? 'Set password' : 'Email me a link' }}
            </button>
            <p class="auth-switch"><a routerLink="/login">Back to sign in</a></p>
          }
        </form>
      </main>
    </div>
  `,
})
export class ResetComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  token = '';
  email = '';
  password = '';
  again = '';
  error = '';
  done = '';
  busy = false;

  ngOnInit(): void {
    this.token = this.route.snapshot.queryParamMap.get('token') || '';
  }

  async submit(): Promise<void> {
    this.error = '';
    if (this.token) {
      if (this.password.length < 8 || !/[a-z]/i.test(this.password) || !/\d/.test(this.password)) {
        this.error = 'Use 8 or more characters, with a letter and a number.';
        return;
      }
      if (this.password !== this.again) {
        this.error = 'The two passwords do not match.';
        return;
      }
    } else if (!this.email.includes('@')) {
      this.error = 'Enter your work email.';
      return;
    }
    this.busy = true;
    try {
      const result = this.token
        ? await this.api.post<{ message: string }>('/v1/auth/reset', { token: this.token, password: this.password })
        : await this.api.post<{ message: string }>('/v1/auth/forgot', { email: this.email.trim() });
      this.done = result.message || (this.token ? 'Password changed. Sign in with the new password.' : 'Check your email.');
      this.password = '';
      this.again = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'That did not work. Try again.';
    } finally {
      this.busy = false;
    }
  }
}
