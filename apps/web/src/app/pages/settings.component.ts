import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Me } from '../core/models';
import { SessionStore } from '../core/session.store';
import { SettingsAttendanceComponent } from './attendance-settings.component';
import {
  SettingsEmailComponent,
  SettingsGeneralComponent,
  SettingsIntegrationsComponent,
  SettingsNumberingComponent,
  SettingsStatutoryComponent,
} from './settings-sections.component';
import { SettingsTemplatesComponent } from './mail-studio.component';
import { SettingsFormsComponent } from './settings-forms.component';
import { AccessSettingsComponent } from './access-settings.component';
import { SettingsRulesComponent } from './rules-settings.component';
import { HomeLayoutSettingsComponent } from './home-layout-settings.component';
import { OutletSettingsComponent } from './outlet-settings.component';
import { ApprovalFlowsSettingsComponent } from './approval-flows-settings.component';

interface Licence {
  mode: string;
  reason: string;
  message: string;
  checkedAt: string | null;
  product: string;
  packageLabel: string;
  seats: number;
  seatLimit: number | null;
  termStartsAt: string | null;
  termEndsAt: string | null;
  status: string;
  hasKey: boolean;
  active: boolean;
  keyHint: string;
  bindingHost: string;
  outlets?: { allowed: number; units: Array<{ subscriptionId: string; main: boolean; usable: boolean; verdict: string; termEndsAt: string; seatsUsed: number | null }> };
}

@Component({
  selector: 'app-settings',
  imports: [
    FormsModule,
    SettingsGeneralComponent,
    SettingsEmailComponent,
    SettingsFormsComponent,
    SettingsIntegrationsComponent,
    SettingsStatutoryComponent,
    SettingsNumberingComponent,
    SettingsTemplatesComponent,
    SettingsAttendanceComponent,
    AccessSettingsComponent,
    SettingsRulesComponent,
    HomeLayoutSettingsComponent,
    OutletSettingsComponent,
    ApprovalFlowsSettingsComponent,
  ],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-gear"></i></span>
        <h1>{{ title }}</h1>
        <p class="muted">{{ lead }}</p>
      </div>
    </div>
    @if (canOpen) {
      <nav class="settings-tabs" aria-label="Settings sections">
        @if (canSettings || canFormsOnly) {
        @for (item of visiblePrimary; track item.id) {
          <button type="button" class="settings-tab" [class.is-active]="tab === item.id" (click)="go(item.id)">
            <i [class]="item.icon"></i>
            <span><strong>{{ item.label }}</strong><small>{{ item.hint }}</small></span>
          </button>
        }
        }
        @if (moreItems.length) {
        <div class="settings-menu" [class.is-open]="moreOpen">
          <button type="button" class="settings-tab" [class.is-active]="moreOn" (click)="moreOpen = !moreOpen" aria-haspopup="true" [attr.aria-expanded]="moreOpen">
            <i class="bi bi-three-dots"></i>
            <span><strong>More</strong><small>{{ moreHint }}</small></span>
            <i class="bi bi-chevron-down settings-tab-caret"></i>
          </button>
          @if (moreOpen) {
            <div class="settings-flyout" role="menu">
              @for (item of moreItems; track item.id) {
                <button type="button" class="settings-flyout-item" [class.is-active]="tab === item.id" (click)="go(item.id)">
                  <i [class]="item.icon"></i>
                  <span><strong>{{ item.label }}</strong><small>{{ item.hint }}</small></span>
                </button>
              }
            </div>
          }
        </div>
        }
      </nav>
      @switch (tab) {
        @case ('general') { <app-settings-general (openTab)="go($event)" /> }
        @case ('integrations') { <app-settings-integrations /> }
        @case ('email') { <app-settings-email /> }
        @case ('forms') { <app-settings-forms /> }
        @case ('statutory') { <app-settings-statutory /> }
        @case ('templates') { <app-settings-templates /> }
        @case ('numbering') { <app-settings-numbering /> }
        @case ('attendance') { <app-settings-attendance /> }
        @case ('access') { <app-settings-access /> }
        @case ('rules') { <app-settings-rules /> }
        @case ('flows') { <app-settings-flows /> }
        @case ('home') { <app-settings-home /> }
        @case ('outlets') { <app-settings-outlets /> }
        @case ('licence') {
          @if (error) { <p class="form-error">{{ error }}</p> }
          @if (ok) { <p class="form-ok">{{ ok }}</p> }
          @if (licence?.hasKey) {
            <section class="settings-card licence-card">
              <header class="settings-card-head">
                <span class="settings-icon"><i class="bi bi-key"></i></span>
                <div>
                  <h2>Licence</h2>
                  <p>Features stay on while this key is valid with Altamid Control.</p>
                </div>
                <span [class]="'chip ' + (licence!.active ? 'is-ok' : 'is-bad')">{{ licence!.active ? 'Active' : unitVerdict(licence!.status || licence!.reason) }}</span>
              </header>
              <div class="settings-card-body">
                <p data-inline-message [class]="licence!.active ? 'form-ok' : 'form-error'">{{ licence!.message }}</p>
                <dl class="licence-facts">
                  <div><dt>Package</dt><dd>{{ licence!.packageLabel || licence!.product }}</dd></div>
                  <div><dt>License key</dt><dd class="mono">{{ licence!.keyHint || '••••' }}</dd></div>
                  <div><dt>Expires</dt><dd>{{ licence!.termEndsAt ? unitEnd(licence!.termEndsAt) : '—' }}</dd></div>
                  <div><dt>People</dt><dd>{{ licence!.seats }}@if (licence!.seatLimit !== null) { / {{ licence!.seatLimit }} }</dd></div>
                  @if (licence!.outlets?.allowed) {
                    <div><dt>Outlets</dt><dd>{{ licence!.outlets!.allowed }} allowed</dd></div>
                  }
                </dl>
                <div class="settings-inline-save licence-actions">
                  <button type="button" class="btn btn-ghost" [disabled]="!!busy" (click)="testLicence()"><i class="bi bi-wifi"></i> {{ busy === 'test' ? 'Testing…' : 'Test connection' }}</button>
                  <button type="button" class="btn btn-ghost btn-danger" [disabled]="!!busy" (click)="deactivateLicence()"><i class="bi bi-x-circle"></i> {{ busy === 'off' ? 'Deactivating…' : 'Deactivate' }}</button>
                </div>
              </div>
            </section>
          } @else {
            <form class="settings-card" (ngSubmit)="activateLicence()">
              <header class="settings-card-head">
                <span class="settings-icon"><i class="bi bi-key"></i></span>
                <div>
                  <h2>Activate licence</h2>
                  <p>Paste the license key from Altamid Control. Binding to this host is automatic.</p>
                </div>
              </header>
              <div class="settings-card-body">
                @if (licence) {
                  <p class="muted">{{ licence.message }}</p>
                }
                <label for="key">License key</label>
                <input id="key" name="key" [(ngModel)]="licenseKey" placeholder="AS1.HRMS.…" autocomplete="off" required>
                <div class="settings-inline-save">
                  <button class="btn btn-gold" type="submit" [disabled]="!!busy || !licenseKey.trim()"><i class="bi bi-check2"></i> {{ busy === 'on' ? 'Activating…' : 'Activate' }}</button>
                </div>
              </div>
            </form>
          }
        }
        @case ('password') {
          @if (error) { <p class="form-error">{{ error }}</p> }
          @if (ok) { <p class="form-ok">{{ ok }}</p> }
          <form class="settings-card" (ngSubmit)="changePassword()">
            <header class="settings-card-head">
              <span class="settings-icon"><i class="bi bi-shield-lock"></i></span>
              <div>
                <h2>Your password</h2>
                <p>Only this sign-in changes. Use 8 or more characters, with a letter and a number. Five wrong passwords pause the sign-in for 15 minutes.</p>
              </div>
            </header>
            <div class="settings-card-body">
              <div class="field-grid">
                <div><label for="current">Current password</label><input id="current" name="current" type="password" [(ngModel)]="current"></div>
                <div><label for="next">New password</label><input id="next" name="next" type="password" [(ngModel)]="next"></div>
              </div>
              <div class="settings-inline-save">
                <button class="btn btn-gold" type="submit" [disabled]="!!busy"><i class="bi bi-check2"></i> Update password</button>
              </div>
            </div>
          </form>
        }
      }
    } @else if (me) {
      @if (error) { <p class="form-error">{{ error }}</p> }
      @if (ok) { <p class="form-ok">{{ ok }}</p> }
      <form class="settings-card" (ngSubmit)="changePassword()">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-shield-lock"></i></span>
          <div><h2>Your password</h2><p>Use 8 or more characters, with a letter and a number. Five wrong passwords pause the sign-in for 15 minutes.</p></div>
        </header>
        <div class="settings-card-body">
          <label for="current">Current password</label>
          <input id="current" name="current" type="password" [(ngModel)]="current">
          <label for="next">New password</label>
          <input id="next" name="next" type="password" [(ngModel)]="next">
          <div class="settings-inline-save">
            <button class="btn btn-gold" type="submit" [disabled]="!!busy">Update password</button>
          </div>
        </div>
      </form>
    }
  `,
})
export class SettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  readonly primary = [
    { id: 'general', icon: 'bi bi-building', label: 'General', hint: 'Company and brand' },
    { id: 'rules', icon: 'bi bi-robot', label: 'Rules', hint: 'People, leave, hiring' },
    { id: 'flows', icon: 'bi bi-diagram-2', label: 'Approvals', hint: 'Who decides requests' },
    { id: 'attendance', icon: 'bi bi-clock', label: 'Attendance', hint: 'Shift and check-in' },
    { id: 'integrations', icon: 'bi bi-plugin', label: 'Integrations', hint: 'AI, apps and APIs' },
    { id: 'email', icon: 'bi bi-envelope', label: 'Email', hint: 'SMTP mailboxes' },
    { id: 'forms', icon: 'bi bi-ui-checks-grid', label: 'Forms', hint: 'Job applications' },
  ];
  readonly secondary = [
    { id: 'statutory', icon: 'bi bi-percent', label: 'Statutory', hint: 'PF, ESI, PT, TDS' },
    { id: 'templates', icon: 'bi bi-envelope-paper', label: 'Templates', hint: 'Message copy' },
    { id: 'numbering', icon: 'bi bi-hash', label: 'Numbering', hint: 'Codes and slips' },
    { id: 'licence', icon: 'bi bi-key', label: 'Licence', hint: 'Altamid Control' },
    { id: 'password', icon: 'bi bi-shield-lock', label: 'Password', hint: 'This sign-in' },
  ];
  me: Me | null = null;
  tab = 'general';
  moreOpen = false;
  licence: Licence | null = null;
  licenseKey = '';
  current = '';
  next = '';
  error = '';
  ok = '';
  busy: '' | 'on' | 'off' | 'test' | 'password' = '';

  get canSettings(): boolean {
    return !!this.me?.access?.includes('settings');
  }

  get canAccess(): boolean {
    return !!this.me?.access?.includes('access');
  }

  get canLibrary(): boolean {
    return !!this.me?.access?.includes('library');
  }

  get canForms(): boolean {
    return !!this.me?.access?.includes('hiring.forms') || !!this.me?.access?.includes('hiring');
  }

  get canFormsOnly(): boolean {
    return !this.canSettings && this.canForms;
  }

  get canOpen(): boolean {
    return this.canSettings || this.canAccess || this.canLibrary || this.canForms;
  }

  get visiblePrimary(): Array<{ id: string; icon: string; label: string; hint: string }> {
    if (this.canSettings) return this.primary;
    if (this.canFormsOnly) return this.primary.filter((item) => item.id === 'forms');
    return [];
  }

  get moreItems(): Array<{ id: string; icon: string; label: string; hint: string }> {
    const access = { id: 'access', icon: 'bi bi-shield-check', label: 'Access', hint: 'Who can manage' };
    const home = { id: 'home', icon: 'bi bi-house-gear', label: 'Home layouts', hint: 'Blocks per role and person' };
    const outlets = { id: 'outlets', icon: 'bi bi-diagram-3', label: 'Outlets', hint: 'Branches and master access' };
    const own = [...(this.me?.outlets?.master ? [outlets] : []), ...(this.canAccess ? [access] : []), ...(this.canSettings || this.canLibrary ? [home] : [])];
    return this.canSettings ? [...own, ...this.secondary] : own;
  }

  get moreHint(): string {
    if (this.canSettings) return 'Statutory, templates, access';
    if (this.canAccess) return 'Access and layouts';
    return 'More options';
  }

  get moreOn(): boolean {
    return this.moreItems.some((item) => item.id === this.tab);
  }

  get title(): string {
    return [...this.primary, ...this.moreItems].find((item) => item.id === this.tab)?.label || 'Settings';
  }

  get lead(): string {
    const leads: Record<string, string> = {
      general: 'Company profile, letterhead, salary accounts and brand. Start here for letterhead on payslips and documents.',
      integrations: 'AI assistant (bring your own keys), WhatsApp, SMS, biometric devices, salary bank files, accounting, webhooks and the company API. Cards show Live vs Configure-only.',
      email: 'SMTP mailboxes and which mailbox sends payslips, leave, announcements and onboarding mail.',
      forms: 'Public job application forms, embed codes, and submissions from your website.',
      statutory: 'PF, ESI, professional tax, TDS and pay cycle — stored for records. Payslip calculation still uses CTC lines you enter in Payroll.',
      templates: 'Email subjects and bodies. Pair with Email (SMTP) and Rules automation for auto-send.',
      numbering: 'Prefixes and sequences for people, payslips and requests.',
      attendance: 'Where people can check in, shift times, weekly off and office geofences.',
      licence: 'Paste a license key to activate. When it is valid, HRMS features unlock for this install.',
      password: 'Change the password for this sign-in only.',
      rules: 'People defaults (probation, notice), leave types, daily reminders, and hiring re-apply gaps. Approval chains are under Approvals.',
      flows: 'Who approves leave, attendance fixes, WFH and resignation — up to three steps. New requests follow these; open ones keep their old chain.',
      access: 'Pick a role (or an area) and turn features on or off. Owner always keeps everything. Extras cover departments, grades, and named people.',
      home: 'Choose the Home blocks each role, department or person sees.',
      outlets: 'Branches you run in this HRMS. Edit place details, choose who can work in each, copy setup between them, or archive a closed branch.',
    };
    return leads[this.tab] || 'Configure Altamid HRMS';
  }

  async ngOnInit(): Promise<void> {
    this.me = this.store.me;
    let tab = this.route.snapshot.queryParamMap.get('tab') || '';
    // AI moved under Integrations — keep old ?tab=ai links working.
    if (tab === 'ai') {
      tab = 'integrations';
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { tab: 'integrations', integration: 'ai' },
        replaceUrl: true,
      });
    }
    if (tab) this.tab = tab;
    const allowed = [...this.visiblePrimary, ...this.moreItems].map((item) => item.id);
    if (!allowed.includes(this.tab)) this.tab = allowed[0] || 'password';
    if (!this.canSettings) return;
    this.licence = await this.api.get<Licence>('/v1/licence');
  }

  go(id: string): void {
    this.tab = id;
    this.moreOpen = false;
    this.error = '';
    this.ok = '';
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: id, integration: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  unitEnd(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  }

  unitVerdict(verdict: string): string {
    const words: Record<string, string> = {
      expired: 'Expired',
      suspended: 'Suspended',
      cancelled: 'Cancelled',
      revoked: 'Revoked',
      not_started: 'Not started',
      seats_exceeded: 'Over seats',
      unlicensed: 'No key',
      no_lease: 'Not checked in',
      setup: 'Inactive',
      active: 'Active',
      grace: 'Grace',
      past_due: 'Past due',
    };
    return words[verdict] || (verdict ? verdict.replace(/_/g, ' ') : 'Paused');
  }

  async activateLicence(): Promise<void> {
    const key = this.licenseKey.trim();
    if (!key) {
      this.error = 'Paste a license key to activate.';
      return;
    }
    await this.runLicence('on', { licenseKey: key }, 'Licence activated.');
    this.licenseKey = '';
  }

  async deactivateLicence(): Promise<void> {
    if (!window.confirm('Deactivate this licence? New people and payroll stay paused until you activate a key again.')) return;
    await this.runLicence('off', { licenseKey: '' }, 'Licence deactivated.');
  }

  async testLicence(): Promise<void> {
    await this.runLicence('test', {}, 'Connection to Altamid Control is working.');
  }

  private async runLicence(kind: 'on' | 'off' | 'test', body: Record<string, string>, ok: string): Promise<void> {
    this.busy = kind;
    this.error = '';
    this.ok = '';
    try {
      this.licence = await this.api.post<Licence>('/v1/licence/check', body);
      this.store.me = await this.api.get<Me>('/v1/me');
      this.me = this.store.me;
      if (kind === 'on' && !this.licence.active) {
        this.error = this.licence.message || 'That key did not activate.';
      } else if (kind === 'test' && !this.licence.active) {
        this.error = this.licence.message || 'Control answered, but this licence is not usable.';
      } else {
        this.ok = ok;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not reach Altamid Control.';
    } finally {
      this.busy = '';
    }
  }

  async changePassword(): Promise<void> {
    this.busy = 'password';
    this.error = '';
    this.ok = '';
    try {
      await this.api.post('/v1/auth/password', { current: this.current, next: this.next });
      this.current = '';
      this.next = '';
      this.ok = 'Password updated.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not update password.';
    } finally {
      this.busy = '';
    }
  }
}
