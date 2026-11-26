import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { PasswordToggleDirective } from '../shared/password-toggle.directive';

type Mode = 'password' | 'otp';
type OtpChannel = 'email' | 'sms';

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink, PasswordToggleDirective],
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
          <h1>{{ step === 'mfa' ? 'Authenticator' : 'Sign in' }}</h1>
          <p class="auth-lead">{{ lead }}</p>
          @if (notice) { <div class="form-ok">{{ notice }}</div> }
          @if (error) { <div class="form-error">{{ error }}</div> }

          @if (step === 'mfa') {
            <div class="auth-field">
              <label for="mfa">Authenticator or backup code</label>
              <div class="auth-input">
                <i class="bi bi-phone"></i>
                <input id="mfa" name="mfa" inputmode="numeric" autocomplete="one-time-code" [(ngModel)]="mfaCode" placeholder="6-digit code" required>
              </div>
            </div>
            <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-shield-check"></i> {{ busy ? 'Checking…' : 'Continue' }}</button>
            <button class="btn btn-ghost" type="button" (click)="resetFlow()" [disabled]="busy">Back</button>
          } @else {
            <div class="chip-row auth-modes" role="tablist" aria-label="Sign-in method">
              <button type="button" class="chip" [class.is-on]="mode === 'password'" (click)="mode = 'password'">Password</button>
              <button type="button" class="chip" [class.is-on]="mode === 'otp'" (click)="mode = 'otp'">One-time code</button>
            </div>

            @if (mode === 'password') {
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
            } @else {
              <div class="chip-row auth-modes" role="tablist" aria-label="Code channel">
                <button type="button" class="chip" [class.is-on]="otpChannel === 'email'" (click)="otpChannel = 'email'">Email</button>
                <button type="button" class="chip" [class.is-on]="otpChannel === 'sms'" (click)="otpChannel = 'sms'">Mobile</button>
              </div>
              @if (!otpSent) {
                <div class="auth-field">
                  <label for="otp-id">{{ otpChannel === 'email' ? 'Work email' : 'Mobile number' }}</label>
                  <div class="auth-input">
                    <i class="bi" [class]="otpChannel === 'email' ? 'bi-envelope' : 'bi-phone'"></i>
                    <input id="otp-id" name="otpId" [type]="otpChannel === 'email' ? 'email' : 'tel'" [(ngModel)]="otpIdentity" [placeholder]="otpChannel === 'email' ? 'you@company.com' : '10-digit mobile'" required>
                  </div>
                </div>
                <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-send"></i> {{ busy ? 'Sending…' : 'Send code' }}</button>
              } @else {
                <div class="auth-field">
                  <label for="otp-code">One-time code</label>
                  <div class="auth-input">
                    <i class="bi bi-key"></i>
                    <input id="otp-code" name="otpCode" inputmode="numeric" autocomplete="one-time-code" [(ngModel)]="otpCode" placeholder="6-digit code" required>
                  </div>
                </div>
                <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-box-arrow-in-right"></i> {{ busy ? 'Signing in…' : 'Sign in' }}</button>
                <button class="btn btn-ghost" type="button" (click)="otpSent = false; otpCode = ''" [disabled]="busy">Send again</button>
              }
            }
            <p class="auth-switch">New company? <a routerLink="/start">Create your workspace</a></p>
          }
        </form>
      </main>
    </div>
  `,
  styles: [`
    .auth-modes { margin: 0 0 14px; gap: 8px; }
    .auth-modes .chip { border: 1px solid var(--border); background: transparent; cursor: pointer; font: inherit; }
    .auth-modes .chip.is-on { border-color: var(--gold-500); background: color-mix(in srgb, var(--gold-500) 18%, transparent); }
    .auth-card .btn-ghost { margin-top: 10px; width: 100%; }
  `],
})
export class LoginComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  mode: Mode = 'password';
  step: 'sign' | 'mfa' = 'sign';
  email = '';
  password = '';
  otpChannel: OtpChannel = 'email';
  otpIdentity = '';
  otpCode = '';
  otpSent = false;
  mfaTicket = '';
  mfaCode = '';
  error = '';
  notice = '';
  busy = false;

  get lead(): string {
    if (this.step === 'mfa') return 'Enter the code from Google Authenticator, or an 8-digit backup code.';
    if (this.mode === 'otp') return this.otpSent ? 'Enter the code we sent you.' : 'We will send a short code to your email or mobile.';
    return 'Use the work email your company set up.';
  }

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('reason') === 'idle') {
      this.notice = 'You were signed out after 2 hours without activity.';
    }
  }

  resetFlow(): void {
    this.step = 'sign';
    this.mfaTicket = '';
    this.mfaCode = '';
    this.error = '';
  }

  async submit(): Promise<void> {
    this.error = '';
    this.busy = true;
    try {
      if (this.step === 'mfa') {
        await this.finish(await this.api.post<LoginResult>('/v1/auth/mfa/verify', { ticket: this.mfaTicket, code: this.mfaCode }));
        return;
      }
      if (this.mode === 'password') {
        await this.finish(await this.api.post<LoginResult>('/v1/auth/login', { email: this.email, password: this.password }));
        return;
      }
      if (!this.otpSent) {
        const result = await this.api.post<{ message: string }>('/v1/auth/otp/start', {
          channel: this.otpChannel,
          identity: this.otpIdentity,
        });
        this.otpSent = true;
        this.notice = result.message;
        return;
      }
      await this.finish(await this.api.post<LoginResult>('/v1/auth/otp/verify', {
        channel: this.otpChannel,
        identity: this.otpIdentity,
        code: this.otpCode,
      }));
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Sign-in failed.';
    } finally {
      this.busy = false;
    }
  }

  private async finish(result: LoginResult): Promise<void> {
    if (result.mfaRequired && result.ticket) {
      this.step = 'mfa';
      this.mfaTicket = result.ticket;
      this.notice = '';
      return;
    }
    if (!result.token) throw new Error('Sign-in failed.');
    this.api.setToken(result.token);
    void this.api.get('/v1/me');
    void this.api.get('/v1/home');
    await this.router.navigateByUrl('/');
  }
}

interface LoginResult {
  token?: string;
  mfaRequired?: boolean;
  ticket?: string;
  name?: string;
}
