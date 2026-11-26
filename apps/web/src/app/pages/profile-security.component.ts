import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-profile-security',
  imports: [FormsModule],
  template: `
    <section class="card">
      <div class="card-head">
        <h2><i class="bi bi-shield-lock"></i> Sign-in security</h2>
        <span class="source-chip"><i class="bi bi-phone"></i> Google Authenticator</span>
      </div>
      <p class="muted">Add an authenticator app so a stolen password alone cannot open your HRMS. Backup codes each work once.</p>
      @if (error) { <p class="form-error">{{ error }}</p> }
      @if (ok) { <p class="form-ok">{{ ok }}</p> }

      @if (status?.enabled) {
        <p><strong>Authenticator is on.</strong> {{ status?.backupsLeft || 0 }} backup code{{ status?.backupsLeft === 1 ? '' : 's' }} left.</p>
        <div class="form-grid">
          <div><label for="off-pass">Password</label><input id="off-pass" type="password" [(ngModel)]="disablePassword" autocomplete="current-password"></div>
          <div><label for="off-code">Authenticator or backup code</label><input id="off-code" [(ngModel)]="disableCode" inputmode="numeric" autocomplete="one-time-code"></div>
        </div>
        <div class="actions" style="margin-top:16px">
          <button class="btn btn-ghost btn-danger" type="button" [disabled]="busy" (click)="disable()">Turn off Authenticator</button>
        </div>
      } @else if (!setup) {
        <div class="actions" style="margin-top:16px">
          <button class="btn btn-primary" type="button" [disabled]="busy" (click)="begin()">Set up Google Authenticator</button>
        </div>
      } @else {
        <ol class="mx-lines">
          <li><span>Open Google Authenticator and add an account.</span></li>
          <li><span>Scan this QR, or type the key: <strong class="mono">{{ setup.secret }}</strong></span></li>
        </ol>
        <div class="sec-qr" aria-hidden="true">
          <img [src]="qrUrl" alt="" width="180" height="180">
        </div>
        <p class="muted fine">Prefer typing? Use the key above. The QR uses a standard otpauth link.</p>
        <div><label for="on-code">Code from the app</label><input id="on-code" [(ngModel)]="enableCode" inputmode="numeric" autocomplete="one-time-code" required></div>
        <div class="actions" style="margin-top:16px">
          <button class="btn btn-primary" type="button" [disabled]="busy || !enableCode" (click)="enable()">Turn on</button>
          <button class="btn btn-ghost" type="button" [disabled]="busy" (click)="setup = null">Cancel</button>
        </div>
      }

      @if (backups.length) {
        <section class="card" style="margin-top:16px">
          <h3>Backup codes</h3>
          <p class="muted">Copy these now. Each code works once. We will not show them again.</p>
          <ul class="mono">@for (code of backups; track code) { <li>{{ code }}</li> }</ul>
        </section>
      }
    </section>
  `,
  styles: [`
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; letter-spacing: 0.04em; }
    .sec-qr { margin: 12px 0; padding: 12px; display: inline-block; background: #fff; border-radius: 12px; border: 1px solid var(--border); }
    .fine { font-size: 12.5px; }
  `],
})
export class ProfileSecurityComponent implements OnInit {
  private readonly api = inject(ApiService);
  status: { enabled: boolean; backupsLeft: number } | null = null;
  setup: { secret: string; otpauth: string } | null = null;
  enableCode = '';
  disablePassword = '';
  disableCode = '';
  backups: string[] = [];
  error = '';
  ok = '';
  busy = false;

  get qrUrl(): string {
    if (!this.setup?.otpauth) return '';
    return 'https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=' + encodeURIComponent(this.setup.otpauth);
  }

  async ngOnInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    try {
      this.status = await this.api.get('/v1/auth/mfa');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load security settings.';
    }
  }

  async begin(): Promise<void> {
    this.error = '';
    this.ok = '';
    this.busy = true;
    try {
      this.setup = await this.api.post('/v1/auth/mfa/setup', {});
      this.enableCode = '';
      this.backups = [];
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not start setup.';
    } finally {
      this.busy = false;
    }
  }

  async enable(): Promise<void> {
    this.error = '';
    this.ok = '';
    this.busy = true;
    try {
      const result = await this.api.post<{ backups: string[]; message: string }>('/v1/auth/mfa/enable', { code: this.enableCode });
      this.backups = result.backups || [];
      this.ok = result.message;
      this.setup = null;
      await this.refresh();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not turn on Authenticator.';
    } finally {
      this.busy = false;
    }
  }

  async disable(): Promise<void> {
    this.error = '';
    this.ok = '';
    this.busy = true;
    try {
      const result = await this.api.post<{ message: string }>('/v1/auth/mfa/disable', {
        password: this.disablePassword,
        code: this.disableCode,
      });
      this.ok = result.message;
      this.disablePassword = '';
      this.disableCode = '';
      this.backups = [];
      await this.refresh();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not turn off Authenticator.';
    } finally {
      this.busy = false;
    }
  }
}
