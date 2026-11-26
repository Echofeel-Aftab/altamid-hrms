import { Component, EventEmitter, inject, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Sweet } from '../shared/sweet';
import { Me, STATES } from '../core/models';
import { SessionStore } from '../core/session.store';
import {
  AiSettingsView,
  IntegrationAccountView,
  IntegrationField,
  IntegrationProvider,
  IntegrationView,
  NumberingRow,
  OfficePoint,
  PURPOSE_LABELS,
  SalaryAccountView,
  SettingsView,
  SmtpAccountView,
  StatutorySettings,
} from '../core/settings';
import { PasswordToggleDirective } from '../shared/password-toggle.directive';
import { BrandSettingsComponent } from './brand-settings.component';
import { SettingsAiComponent } from './settings-ai.component';

async function loadSettings(api: ApiService): Promise<SettingsView> {
  return api.get<SettingsView>('/v1/settings');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Could not save.';
}

@Component({
  selector: 'app-settings-general',
  imports: [FormsModule, BrandSettingsComponent],
  template: `
    <div class="settings-workspace">
      <nav class="settings-toc" aria-label="General settings">
        <p class="settings-toc-kicker">On this page</p>
        <button type="button" class="settings-toc-item" [class.is-active]="pane === 'company'" (click)="pane = 'company'">
          <i class="bi bi-building"></i>
          <span><strong>Company</strong><small>Letterhead and tax ids</small></span>
        </button>
        <button type="button" class="settings-toc-item" [class.is-active]="pane === 'accounts'" (click)="pane = 'accounts'">
          <i class="bi bi-bank"></i>
          <span><strong>Salary accounts</strong><small>{{ accounts.length ? accounts.length + ' account' + (accounts.length === 1 ? '' : 's') : 'Where salary is paid from' }}</small></span>
        </button>
        <button type="button" class="settings-toc-item" [class.is-active]="pane === 'appearance'" (click)="pane = 'appearance'">
          <i class="bi bi-palette"></i>
          <span><strong>Appearance</strong><small>Logo and colours</small></span>
        </button>
      </nav>
      <div class="settings-workspace-main">
        @if (pane === 'company') {
          <header class="settings-panel-head">
            <h2><i class="bi bi-building"></i> Company</h2>
            <p>Letterhead on payslips and letters, and the company's tax ids.</p>
          </header>
          @if (error) { <p class="form-error">{{ error }}</p> }
          @if (ok) { <p class="form-ok">{{ ok }}</p> }
          <form class="settings-card" (ngSubmit)="save()">
            <header class="settings-card-head">
              <span class="settings-icon"><i class="bi bi-building"></i></span>
              <div>
                <h2>Company</h2>
                <p>Printed on payslips and letters</p>
              </div>
            </header>
            <div class="settings-card-body">
              <div class="field-grid">
                <div><label for="co-name">Company name</label><input id="co-name" name="name" [(ngModel)]="name"></div>
                <div><label for="co-legal">Legal name</label><input id="co-legal" name="legal" [(ngModel)]="legalName"></div>
                <div class="span-2"><label for="co-address">Street address</label><textarea id="co-address" name="address" rows="2" [(ngModel)]="address"></textarea></div>
                <div><label for="co-city">City</label><input id="co-city" name="city" [(ngModel)]="city"></div>
                <div>
                  <label for="co-state">State</label>
                  <select id="co-state" name="state" [(ngModel)]="state">
                    @for (item of states; track item) { <option [value]="item">{{ item }}</option> }
                  </select>
                </div>
                <div><label for="co-zip">PIN / ZIP</label><input id="co-zip" name="zip" [(ngModel)]="zip"></div>
                <div><label for="co-country">Country</label><input id="co-country" name="country" [(ngModel)]="country"></div>
                <div><label for="co-phone">Phone</label><input id="co-phone" name="phone" [(ngModel)]="phone"></div>
                <div><label for="co-email">Email</label><input id="co-email" name="email" type="email" [(ngModel)]="email"></div>
                <div class="span-2"><label for="co-web">Website</label><input id="co-web" name="website" [(ngModel)]="website" placeholder="https://www.yourcompany.com"></div>
                <div><label for="co-pan">Company PAN</label><input id="co-pan" name="pan" [(ngModel)]="pan"></div>
                <div><label for="co-gstin">GSTIN</label><input id="co-gstin" name="gstin" [(ngModel)]="gstin"></div>
                <div><label for="co-tan">TAN</label><input id="co-tan" name="tan" [(ngModel)]="tan"></div>
              </div>
              <p class="muted">The accounts salary is paid from are under <button type="button" class="link-btn" (click)="pane = 'accounts'">Salary accounts</button>.</p>
              <div class="settings-savebar">
                <span>Existing payslips keep the letterhead they were issued with.</span>
                <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> Save company</button>
              </div>
            </div>
          </form>
        } @else if (pane === 'accounts') {
          <header class="settings-panel-head">
            <h2><i class="bi bi-bank"></i> Salary accounts</h2>
            <p>Company bank accounts that salary is paid from. Payroll makes one bank transfer file per account.</p>
          </header>
          @if (error) { <p class="form-error">{{ error }}</p> }
          @if (ok) { <p class="form-ok">{{ ok }}</p> }
          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon"><i class="bi bi-bank"></i></span>
              <div>
                <h2>Accounts</h2>
                <p>The default account pays everyone not tied to another account by location</p>
              </div>
            </header>
            <div class="settings-card-body">
              @if (accounts.length) {
                <div class="smtp-account-list">
                  @for (row of accounts; track row.id) {
                    <div class="smtp-account-row" [class.is-off]="!row.active">
                      <div>
                        <strong>{{ row.label }}</strong>
                        @if (row.isDefault) { <span class="pill warn">Default</span> }
                        @if (!row.active) { <span class="pill">Off</span> }
                        <div class="muted small">{{ row.name }} · {{ row.ifsc }} · {{ row.accountMask || 'No number' }}@if (row.accountName) { · {{ row.accountName }} }</div>
                        <div class="muted small">{{ paysText(row) }}</div>
                      </div>
                      <div class="smtp-account-actions">
                        @if (!row.isDefault && row.active) { <button type="button" class="btn btn-ghost btn-sm" (click)="makeDefault(row)" [disabled]="busy"><i class="bi bi-star"></i> Make default</button> }
                        <button type="button" class="btn btn-ghost btn-sm" (click)="editAccount(row)"><i class="bi bi-pencil"></i> Edit</button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="removeAccount(row)" [disabled]="busy"><i class="bi bi-trash"></i> Remove</button>
                      </div>
                    </div>
                  }
                </div>
              } @else {
                <p class="muted">No salary account yet. Add the current account salary is paid from. People keep their own bank details on their record.</p>
              }
              <form class="smtp-account-form" (ngSubmit)="saveAccount()">
                <h3>{{ accountId ? 'Edit ' + accountDraft.label : 'Add a salary account' }}</h3>
                <div class="field-grid">
                  <div><label for="acc-label">Label</label><input id="acc-label" name="label" [(ngModel)]="accountDraft.label" placeholder="HDFC salary account" maxlength="60"></div>
                  <div><label for="acc-bank">Bank name</label><input id="acc-bank" name="bankName" [(ngModel)]="accountDraft.bankName" list="acc-banks" placeholder="HDFC Bank" maxlength="80">
                    <datalist id="acc-banks">@for (bank of banks; track bank) { <option [value]="bank"></option> }</datalist>
                  </div>
                  <div><label for="acc-holder">Account name</label><input id="acc-holder" name="accountName" [(ngModel)]="accountDraft.accountName" [placeholder]="legalName || 'As printed on the cheque book'" maxlength="120"></div>
                  <div>
                    <label for="acc-ifsc">IFSC</label>
                    <input id="acc-ifsc" name="ifsc" [(ngModel)]="accountDraft.ifsc" (ngModelChange)="accountDraft.ifsc = $event.toUpperCase()" placeholder="HDFC0001234" maxlength="11" autocomplete="off">
                  </div>
                  <div>
                    <label for="acc-no">Account number</label>
                    <input id="acc-no" name="accountNumber" [(ngModel)]="accountDraft.accountNumber" inputmode="numeric" autocomplete="off" [placeholder]="accountHint || '9 to 18 digits'">
                  </div>
                  <div class="acc-flags">
                    <label class="check"><input type="checkbox" name="isDefault" [(ngModel)]="accountDraft.isDefault"> Default account</label>
                    <label class="check"><input type="checkbox" name="active" [(ngModel)]="accountDraft.active"> On</label>
                  </div>
                </div>
                @if (offices.length) {
                  <h3 class="settings-subhead">Pays people at</h3>
                  <p class="muted">Optional. Tick the locations this account pays. Anyone not covered is paid from the default account.</p>
                  <div class="acc-offices">
                    @for (office of offices; track office.id) {
                      <label class="check" [class.is-taken]="takenBy(office.id)">
                        <input type="checkbox" [name]="'acc-loc-' + office.id" [checked]="accountDraft.locationIds.includes(office.id)" [disabled]="!!takenBy(office.id)" (change)="toggleOffice(office.id)">
                        {{ office.name }}@if (takenBy(office.id)) { <small class="muted"> · {{ takenBy(office.id) }}</small> }
                      </label>
                    }
                  </div>
                }
                <div class="settings-savebar">
                  <span>The number is stored encrypted and shown as the last four digits.</span>
                  @if (accountId) { <button class="btn btn-ghost" type="button" (click)="resetAccount()">Cancel</button> }
                  <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> {{ accountId ? 'Save account' : 'Add account' }}</button>
                </div>
              </form>
            </div>
          </section>
        } @else {
          <header class="settings-panel-head">
            <h2><i class="bi bi-palette"></i> Appearance</h2>
            <p>Sidebar brand, document logo, and the colours everyone in this company sees.</p>
          </header>
          <app-brand-settings />
        }
      </div>
    </div>
  `,
})
export class SettingsGeneralComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly sweet = inject(Sweet);
  @Output() openTab = new EventEmitter<string>();
  readonly states = STATES;
  readonly banks = ['State Bank of India', 'HDFC Bank', 'ICICI Bank', 'Axis Bank', 'Kotak Mahindra Bank', 'Yes Bank', 'IndusInd Bank', 'IDFC FIRST Bank', 'Punjab National Bank', 'Bank of Baroda', 'Canara Bank', 'Union Bank of India', 'Bank of India', 'Indian Bank', 'Central Bank of India', 'Indian Overseas Bank', 'UCO Bank', 'Bank of Maharashtra', 'Punjab & Sind Bank', 'Federal Bank', 'South Indian Bank', 'Karur Vysya Bank', 'City Union Bank', 'RBL Bank', 'DCB Bank', 'Bandhan Bank', 'CSB Bank', 'Karnataka Bank', 'Tamilnad Mercantile Bank', 'Dhanlaxmi Bank', 'J&K Bank', 'AU Small Finance Bank', 'Equitas Small Finance Bank', 'Ujjivan Small Finance Bank', 'Standard Chartered', 'HSBC', 'Citibank', 'DBS Bank India', 'Deutsche Bank'];
  pane: 'company' | 'accounts' | 'appearance' = 'company';
  accounts: SalaryAccountView[] = [];
  offices: OfficePoint[] = [];
  accountId = '';
  accountDraft = this.blankAccount();
  name = '';
  legalName = '';
  state = '';
  city = '';
  pan = '';
  address = '';
  zip = '';
  country = 'India';
  phone = '';
  email = '';
  website = '';
  gstin = '';
  tan = '';
  accountHint = '';
  error = '';
  ok = '';
  busy = false;

  async ngOnInit(): Promise<void> {
    try {
      this.apply(await loadSettings(this.api));
    } catch (error) {
      this.error = messageOf(error);
    }
  }

  async save(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', {
        section: 'profile',
        name: this.name,
        legalName: this.legalName,
        state: this.state,
        city: this.city,
        pan: this.pan,
        address: this.address,
        zip: this.zip,
        country: this.country,
        phone: this.phone,
        email: this.email,
        website: this.website,
        gstin: this.gstin,
        tan: this.tan,
      });
      this.apply(view);
      const me = await this.api.get<Me>('/v1/me');
      this.store.me = me;
      this.ok = 'Company saved.';
    } catch (error) {
      this.error = messageOf(error);
    } finally {
      this.busy = false;
    }
  }

  private apply(view: SettingsView): void {
    const company = view.company;
    this.name = company.name;
    this.legalName = company.legalName;
    this.state = company.state;
    this.city = company.city;
    this.pan = company.pan;
    this.address = company.address;
    this.zip = company.zip;
    this.country = company.country || 'India';
    this.phone = company.phone;
    this.email = company.email;
    this.website = company.website;
    this.gstin = company.gstin;
    this.tan = company.tan;
    this.accounts = view.bankAccounts || [];
    this.offices = view.offices || [];
  }

  paysText(row: SalaryAccountView): string {
    const names = row.locationIds.map((id) => this.offices.find((office) => office.id === id)?.name).filter(Boolean);
    if (!row.active) return 'Off. Not used for bank files.';
    if (names.length) return 'Pays people at ' + names.join(', ') + (row.isDefault ? ', and everyone not tied to another account' : '');
    return row.isDefault ? 'Pays everyone not tied to another account' : 'Not tied to a location yet, so it pays nobody. Edit it to choose locations, or make it the default.';
  }

  takenBy(officeId: string): string {
    return this.accounts.find((row) => row.id !== this.accountId && row.locationIds.includes(officeId))?.label || '';
  }

  toggleOffice(officeId: string): void {
    const ids = this.accountDraft.locationIds;
    this.accountDraft.locationIds = ids.includes(officeId) ? ids.filter((id) => id !== officeId) : [...ids, officeId];
  }

  editAccount(row: SalaryAccountView): void {
    this.accountId = row.id;
    this.accountDraft = { label: row.label, bankName: row.name, accountName: row.accountName, ifsc: row.ifsc, accountNumber: '', isDefault: row.isDefault, active: row.active, locationIds: [...row.locationIds] };
    this.accountHint = row.accountMask ? 'Saved ' + row.accountMask + ' — leave blank to keep' : '';
    this.error = '';
    this.ok = '';
  }

  resetAccount(): void {
    this.accountId = '';
    this.accountDraft = this.blankAccount();
    this.accountHint = '';
  }

  async saveAccount(): Promise<void> {
    const draft = this.accountDraft;
    const number = draft.accountNumber.replace(/[\s-]+/g, '');
    const ifsc = draft.ifsc.trim().toUpperCase();
    this.error = '';
    this.ok = '';
    if (!draft.label.trim()) { this.error = 'Give the account a label, like HDFC salary account.'; return; }
    if (!draft.bankName.trim()) { this.error = 'Enter the bank name.'; return; }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) { this.error = 'The IFSC must be 11 characters: 4 letters, a zero, then 6 letters or digits, like HDFC0001234.'; return; }
    if (!this.accountId && !number) { this.error = 'Enter the account number.'; return; }
    if (number && !/^\d{9,18}$/.test(number)) { this.error = 'The account number must be 9 to 18 digits.'; return; }
    const saved = await this.runAccount(this.accountId ? 'Account saved.' : 'Account added.', {
      section: 'bankAccount', id: this.accountId, label: draft.label, bankName: draft.bankName, accountName: draft.accountName,
      ifsc, accountNumber: number, isDefault: draft.isDefault, active: draft.active, locationIds: draft.locationIds,
    });
    if (saved) this.resetAccount();
  }

  async makeDefault(row: SalaryAccountView): Promise<void> {
    await this.runAccount(row.label + ' is now the default.', { section: 'bankAccount', id: row.id, label: row.label, bankName: row.name, accountName: row.accountName, ifsc: row.ifsc, isDefault: true, active: true, locationIds: row.locationIds });
  }

  async removeAccount(row: SalaryAccountView): Promise<void> {
    const others = this.accounts.filter((item) => item.id !== row.id);
    const ok = await this.sweet.confirm({
      title: 'Remove ' + row.label + '?',
      text: row.isDefault && others.length ? 'Another account becomes the default. Bank files already downloaded are not changed.' : 'Bank files already downloaded are not changed.',
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    if (await this.runAccount('Account removed.', { section: 'bankAccount', id: row.id, remove: true }) && this.accountId === row.id) this.resetAccount();
  }

  private async runAccount(message: string, body: Record<string, unknown>): Promise<boolean> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', body);
      this.accounts = view.bankAccounts || [];
      this.offices = view.offices || this.offices;
      this.ok = message;
      return true;
    } catch (error) {
      this.error = messageOf(error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private blankAccount() {
    return { label: '', bankName: '', accountName: '', ifsc: '', accountNumber: '', isDefault: false, active: true, locationIds: [] as string[] };
  }
}

@Component({
  selector: 'app-settings-email',
  imports: [FormsModule, PasswordToggleDirective],
  template: `
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    <section class="settings-card">
      <header class="settings-card-head">
        <span class="settings-icon"><i class="bi bi-mailbox"></i></span>
        <div>
          <h2>SMTP accounts</h2>
          <p>Add one or more mailboxes, test each one, then map which mail type uses which sender</p>
        </div>
      </header>
      <div class="settings-card-body">
        @if (accounts.length) {
          <div class="smtp-account-list">
            @for (row of accounts; track row.id) {
              <div class="smtp-account-row" [class.is-off]="!row.active">
                <div>
                  <strong>{{ row.label }}</strong>
                  @if (row.isDefault) { <span class="pill warn">Default</span> }
                  @if (!row.active) { <span class="pill">Off</span> }
                  @if (!row.hasPassword) { <span class="pill bad">No password</span> }
                  <div class="muted small">{{ row.fromName }} · {{ row.fromEmail || row.username }}</div>
                  <div class="muted small">{{ row.username }} · {{ row.host }}:{{ row.port }} · {{ row.encryption.toUpperCase() }}</div>
                  @if (usesOf(row.id).length) {
                    <div class="smtp-use-chips">
                      @for (use of usesOf(row.id); track use) {
                        <span class="chip is-info">{{ use }}</span>
                      }
                    </div>
                  } @else if (row.isDefault) {
                    <div class="muted small">Fallback for any mail type without its own mailbox</div>
                  }
                  @if (row.lastTest) {
                    <div class="muted small" data-inline-message [class.form-ok]="row.lastTest.ok" [class.form-error]="!row.lastTest.ok">{{ row.lastTest.message }}</div>
                  }
                </div>
                <div class="smtp-account-actions">
                  <button type="button" class="btn btn-ghost btn-sm" (click)="test(row)" [disabled]="busy || !row.hasPassword"><i class="bi bi-send"></i> Test</button>
                  @if (!row.isDefault && row.active) {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="makeDefault(row)" [disabled]="busy"><i class="bi bi-star"></i> Default</button>
                  }
                  <button type="button" class="btn btn-ghost btn-sm" (click)="edit(row)"><i class="bi bi-pencil"></i> Edit</button>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="remove(row)" [disabled]="busy"><i class="bi bi-trash"></i> Remove</button>
                </div>
              </div>
            }
          </div>
        } @else {
          <p class="muted">No SMTP accounts yet. Add Gmail (app password), Outlook, Zoho or any SMTP sender. Then map payslips, leave, hiring and more below.</p>
        }
        <form class="smtp-account-form" (ngSubmit)="saveAccount()">
          <h3>{{ editing ? 'Edit account' : 'Add SMTP account' }}</h3>
          <div class="smtp-presets" role="group" aria-label="Provider presets">
            @for (preset of presets; track preset.id) {
              <button type="button" class="smtp-preset" [class.is-active]="host === preset.host && encryption === preset.encryption" (click)="applyPreset(preset)">
                <strong>{{ preset.label }}</strong>
                <small>{{ preset.host }}:{{ preset.port }}</small>
              </button>
            }
          </div>
          <div class="field-grid">
            <div><label for="smtp-label">Label</label><input id="smtp-label" name="label" [(ngModel)]="label" placeholder="Payslip mailbox" maxlength="60"></div>
            <div><label for="smtp-user">Username / login email</label><input id="smtp-user" name="username" type="email" [(ngModel)]="username" placeholder="you@gmail.com"></div>
            <div><label for="smtp-host">Host</label><input id="smtp-host" name="host" [(ngModel)]="host" maxlength="120"></div>
            <div><label for="smtp-port">Port</label><input id="smtp-port" name="port" type="number" [(ngModel)]="port" min="1" max="65535"></div>
            <div>
              <label for="smtp-enc">Encryption</label>
              <select id="smtp-enc" name="encryption" [(ngModel)]="encryption" (ngModelChange)="onEncryption($event)">
                <option value="tls">TLS (587)</option>
                <option value="ssl">SSL (465)</option>
              </select>
            </div>
            <div>
              <label for="smtp-pass">App password</label>
              <input id="smtp-pass" name="password" type="password" [(ngModel)]="password" [placeholder]="editing ? 'Saved — leave blank to keep' : 'App password or SMTP password'" autocomplete="new-password">
            </div>
            <div><label for="smtp-from">From name</label><input id="smtp-from" name="fromName" [(ngModel)]="fromName" placeholder="Company HR" maxlength="80"></div>
            <div><label for="smtp-reply">From / reply-to email</label><input id="smtp-reply" name="fromEmail" type="email" [(ngModel)]="fromEmail" placeholder="Usually the same as the username"></div>
          </div>
          <div class="settings-toggle-row">
            <label class="check"><input type="checkbox" name="active" [(ngModel)]="active"> Active — can send mail</label>
            <label class="check"><input type="checkbox" name="isDefault" [(ngModel)]="isDefault" [disabled]="!active"> System default / fallback</label>
          </div>
          <p class="field-hint">Gmail needs an <strong>app password</strong> (Google Account → Security), not your normal login password. The default mailbox is used whenever a mail type has no specific account.</p>
          <div class="settings-inline-save">
            <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> {{ editing ? 'Update account' : 'Add account' }}</button>
            @if (editing) { <button class="btn btn-ghost" type="button" (click)="clear()">Cancel edit</button> }
          </div>
        </form>
      </div>
    </section>
    <section class="settings-card">
      <header class="settings-card-head">
        <span class="settings-icon"><i class="bi bi-diagram-3"></i></span>
        <div>
          <h2>Default account by mail type</h2>
          <p>Each group of emails can send from a different mailbox. Leave blank to use the default.</p>
        </div>
      </header>
      <form class="settings-card-body" (ngSubmit)="savePurposes()">
        @if (!accounts.length) {
          <p class="muted">Add at least one SMTP account first.</p>
        } @else if (!readyAccounts.length) {
          <p class="banner warn"><i class="bi bi-exclamation-triangle"></i> Turn on an account and save its password before mapping mail types.</p>
        } @else {
          <div class="smtp-purpose-grid">
            @for (item of purposeLabels; track item.key) {
              <div class="smtp-purpose-card">
                <label [for]="'purpose-' + item.key">{{ item.label }}</label>
                <p class="field-hint">{{ item.hint }}</p>
                <select [id]="'purpose-' + item.key" [name]="item.key" [(ngModel)]="purposes[item.key]">
                  <option value="">Use the default mailbox{{ defaultLabel }}</option>
                  @for (row of readyAccounts; track row.id) {
                    <option [value]="row.id">{{ row.label }} — {{ row.fromEmail || row.username }}</option>
                  }
                </select>
                @if (purposeWarning(item.key); as warn) {
                  <p class="form-error" data-inline-message>{{ warn }}</p>
                }
              </div>
            }
          </div>
          <p class="field-hint">Templates in Settings → Templates follow these groups when they send. Test each mailbox above before publishing automatic mail.</p>
          <div class="settings-inline-save">
            <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> Save mail routing</button>
          </div>
        }
      </form>
    </section>
  `,
})
export class SettingsEmailComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  readonly purposeLabels = PURPOSE_LABELS;
  readonly presets: Array<{ id: string; label: string; host: string; port: number; encryption: 'tls' | 'ssl' }> = [
    { id: 'gmail', label: 'Gmail', host: 'smtp.gmail.com', port: 587, encryption: 'tls' },
    { id: 'outlook', label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, encryption: 'tls' },
    { id: 'zoho', label: 'Zoho Mail', host: 'smtp.zoho.com', port: 587, encryption: 'tls' },
    { id: 'ssl', label: 'Generic SSL', host: 'smtp.example.com', port: 465, encryption: 'ssl' },
  ];
  accounts: SmtpAccountView[] = [];
  purposes: SettingsView['purposes'] = {
    payslip: '', leave: '', announcement: '', onboarding: '', hiring: '', celebrations: '', system: '',
  };
  editing = '';
  label = '';
  host = 'smtp.gmail.com';
  port = 587;
  username = '';
  password = '';
  encryption: 'tls' | 'ssl' = 'tls';
  fromName = '';
  fromEmail = '';
  active = true;
  isDefault = false;
  error = '';
  ok = '';
  busy = false;

  get readyAccounts(): SmtpAccountView[] {
    return this.accounts.filter((row) => row.active && row.hasPassword);
  }

  get defaultLabel(): string {
    const row = this.accounts.find((item) => item.isDefault);
    return row ? ` (${row.label})` : '';
  }

  async ngOnInit(): Promise<void> {
    try {
      this.apply(await loadSettings(this.api));
    } catch (error) {
      this.error = messageOf(error);
    }
  }

  usesOf(id: string): string[] {
    return this.purposeLabels.filter((item) => this.purposes[item.key] === id).map((item) => item.label);
  }

  purposeWarning(key: keyof SettingsView['purposes']): string {
    const id = this.purposes[key];
    if (!id) return '';
    const row = this.accounts.find((item) => item.id === id);
    if (!row) return 'That mailbox was removed. Pick another or use the default.';
    if (!row.active) return 'This mailbox is off. Turn it on or pick another before saving.';
    if (!row.hasPassword) return 'This mailbox has no password saved.';
    return '';
  }

  applyPreset(preset: { host: string; port: number; encryption: 'tls' | 'ssl'; label: string }): void {
    this.host = preset.host;
    this.port = preset.port;
    this.encryption = preset.encryption;
    if (!this.label.trim()) this.label = preset.label + ' mailbox';
  }

  onEncryption(value: 'tls' | 'ssl'): void {
    this.encryption = value;
    if (value === 'ssl' && (this.port === 587 || !this.port)) this.port = 465;
    if (value === 'tls' && (this.port === 465 || !this.port)) this.port = 587;
  }

  edit(row: SmtpAccountView): void {
    this.editing = row.id;
    this.label = row.label;
    this.host = row.host;
    this.port = row.port;
    this.username = row.username;
    this.password = '';
    this.encryption = row.encryption;
    this.fromName = row.fromName;
    this.fromEmail = row.fromEmail;
    this.active = row.active;
    this.isDefault = row.isDefault;
  }

  clear(): void {
    this.editing = '';
    this.label = '';
    this.host = 'smtp.gmail.com';
    this.port = 587;
    this.username = '';
    this.password = '';
    this.encryption = 'tls';
    this.fromName = '';
    this.fromEmail = '';
    this.active = true;
    this.isDefault = this.accounts.length === 0;
  }

  async saveAccount(): Promise<void> {
    await this.run('Mailbox saved.', {
      section: 'smtp',
      id: this.editing,
      label: this.label,
      host: this.host,
      port: Number(this.port),
      username: this.username,
      password: this.password,
      encryption: this.encryption,
      fromName: this.fromName,
      fromEmail: this.fromEmail,
      active: this.active,
      isDefault: this.isDefault,
    }, true);
  }

  async makeDefault(row: SmtpAccountView): Promise<void> {
    await this.run(row.label + ' is now the default mailbox.', {
      section: 'smtp',
      id: row.id,
      label: row.label,
      host: row.host,
      port: row.port,
      username: row.username,
      password: '',
      encryption: row.encryption,
      fromName: row.fromName,
      fromEmail: row.fromEmail,
      active: row.active,
      isDefault: true,
    });
  }

  async remove(row: SmtpAccountView): Promise<void> {
    const used = this.usesOf(row.id);
    const sure = await this.sweet.confirm({
      title: 'Remove ' + row.label + '?',
      text: used.length
        ? 'Used for: ' + used.join(', ') + '. Those mail types will fall back to the default mailbox.'
        : 'This mailbox is removed from saved settings. Purpose defaults that used it fall back to the default mailbox.',
      confirmText: 'Remove',
      danger: true,
    });
    if (!sure) return;
    await this.run('Mailbox removed.', { section: 'smtp', id: row.id, remove: true }, true);
  }

  async test(row: SmtpAccountView): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      this.apply(await this.api.post<SettingsView>('/v1/settings', { section: 'test', target: 'smtp', id: row.id }));
      const fresh = this.accounts.find((item) => item.id === row.id);
      if (fresh?.lastTest && !fresh.lastTest.ok) this.error = fresh.lastTest.message;
      else this.ok = fresh?.lastTest?.message || 'Test finished.';
    } catch (error) {
      this.error = messageOf(error);
    } finally {
      this.busy = false;
    }
  }

  async savePurposes(): Promise<void> {
    const blocked = this.purposeLabels.map((item) => this.purposeWarning(item.key)).filter(Boolean);
    if (blocked.length) {
      this.error = blocked[0];
      return;
    }
    await this.run('Mail routing saved. Each mail type will use the mailbox you chose.', { section: 'purposes', ...this.purposes });
  }

  private apply(view: SettingsView): void {
    this.accounts = view.smtp;
    this.purposes = {
      payslip: view.purposes.payslip || '',
      leave: view.purposes.leave || '',
      announcement: view.purposes.announcement || '',
      onboarding: view.purposes.onboarding || '',
      hiring: view.purposes.hiring || '',
      celebrations: view.purposes.celebrations || '',
      system: view.purposes.system || '',
    };
    if (!this.editing) this.isDefault = this.accounts.length === 0;
  }

  private async run(success: string, body: unknown, resetForm = false): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      this.apply(await this.api.post<SettingsView>('/v1/settings', body));
      if (resetForm) this.clear();
      this.ok = success;
    } catch (error) {
      this.error = messageOf(error);
    } finally {
      this.busy = false;
    }
  }
}

@Component({
  selector: 'app-settings-integrations',
  imports: [FormsModule, SettingsAiComponent, PasswordToggleDirective],
  template: `
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    @if (issuedKey) {
      <p class="form-ok" data-inline-message>Copy this API key now. It will not be shown again.<br><strong>{{ issuedKey }}</strong></p>
    }
    @if (showAi) {
      <div class="int-back"><button type="button" class="btn btn-ghost btn-sm" (click)="closeAi()"><i class="bi bi-arrow-left"></i> All connections</button></div>
      <app-settings-ai />
    } @else if (!current) {
      <div class="integration-cards">
        <article class="integration-card">
          <div class="integration-card-main">
            <span class="integration-card-icon"><i class="bi bi-stars"></i></span>
            <span class="integration-card-body">
              <strong>AI assistant</strong>
              <small>{{ aiBlurb }}</small>
            </span>
            <span class="integration-status" [class.is-on]="aiOn" [class.is-off]="!aiOn">{{ aiOn ? 'On' : 'Off' }}</span>
          </div>
          <p class="integration-card-last"><span class="pill pill-scope" [class.ok]="aiScope().kind === 'ok'" [class.warn]="aiScope().kind === 'warn'">{{ aiScope().label }}</span></p>
          @if (ai?.lastTest; as lastTest) {
            <p class="integration-card-last" [class.is-ok]="lastTest.ok" [class.is-err]="!lastTest.ok">{{ testLine(lastTest) }}</p>
          }
          <div class="integration-card-actions">
            <button type="button" class="btn btn-ghost btn-sm" (click)="openAi()">Configure</button>
            <button type="button" class="btn btn-sm" (click)="testAi()" [disabled]="busy || !ai?.accounts?.length">Test</button>
            <button type="button" class="btn btn-ghost btn-sm" (click)="showAiInfo()"><i class="bi bi-info-circle"></i> Info</button>
          </div>
        </article>
        @for (card of cards; track card.key) {
          <article class="integration-card">
            <div class="integration-card-main">
              <span class="integration-card-icon"><i [class]="icon(card.key)"></i></span>
              <span class="integration-card-body">
                <strong>{{ card.title }}</strong>
                <small>{{ card.key === 'api' ? card.blurb : card.providerLabel + ' · ' + card.blurb }}</small>
              </span>
              <span class="integration-status" [class.is-on]="card.status === 'on'" [class.is-off]="card.status !== 'on'">{{ card.statusLabel }}</span>
            </div>
            <p class="integration-card-last"><span class="pill pill-scope" [class.ok]="scopeOf(card).kind === 'ok'" [class.warn]="scopeOf(card).kind === 'warn'">{{ scopeOf(card).label }}</span></p>
            @if (card.enabled && card.missing.length) {
              <p class="integration-card-last is-err">Still needed: {{ listOf(card.missing) }}</p>
            } @else if (card.lastTest) {
              <p class="integration-card-last" [class.is-ok]="card.lastTest.ok" [class.is-err]="!card.lastTest.ok">{{ testLine(card.lastTest) }}</p>
            }
            <div class="integration-card-actions">
              <button type="button" class="btn btn-ghost btn-sm" (click)="open(card)">Configure</button>
              <button type="button" class="btn btn-sm" (click)="test(card)" [disabled]="busy">Test</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="showInfo(card)"><i class="bi bi-info-circle"></i> Info</button>
            </div>
          </article>
        }
      </div>
      <p class="muted small">
        <strong>On / Ready</strong> means credentials are saved and usable.
        The pill under each title says whether HRMS already uses that link (AI, biometrics, bank file, webhooks, API) or only stores and tests it for now (WhatsApp, SMS, accounting).
        Test checks the provider without sending staff messages.
      </p>
    } @else if (multiChannel(current.key)) {
      <div class="int-back"><button type="button" class="btn btn-ghost btn-sm" (click)="close()"><i class="bi bi-arrow-left"></i> All connections</button></div>
      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i [class]="icon(current.key)"></i></span>
          <div>
            <h2>{{ current.title }}</h2>
            <p>{{ current.summary }}</p>
          </div>
          <span class="integration-status" [class.is-on]="current.status === 'on'" [class.is-off]="current.status !== 'on'">{{ current.statusLabel }}</span>
        </header>
        <div class="settings-card-body">
          @if (channelAccounts.length) {
            <div class="smtp-account-list">
              @for (row of channelAccounts; track row.id) {
                <div class="smtp-account-row" [class.is-off]="!row.enabled">
                  <div>
                    <strong>{{ row.label }}</strong>
                    @if (row.isDefault) { <span class="pill warn">Default</span> }
                    @if (!row.enabled) { <span class="pill">Off</span> }
                    <div class="muted small">{{ row.providerLabel }}@if (row.purpose) { · {{ row.purpose }} }</div>
                    @if (row.lastTest) {
                      <div class="muted small" data-inline-message [class.form-ok]="row.lastTest.ok" [class.form-error]="!row.lastTest.ok">{{ row.lastTest.message }}</div>
                    }
                  </div>
                  <div class="smtp-account-actions">
                    @if (!row.isDefault && row.enabled) { <button type="button" class="btn btn-ghost btn-sm" (click)="makeDefault(row)" [disabled]="busy"><i class="bi bi-star"></i> Default</button> }
                    <button type="button" class="btn btn-ghost btn-sm" (click)="testAccount(row)" [disabled]="busy">Test</button>
                    <button type="button" class="btn btn-ghost btn-sm" (click)="editAccount(row)"><i class="bi bi-pencil"></i> Edit</button>
                    <button type="button" class="btn btn-ghost btn-sm" (click)="removeAccount(row)" [disabled]="busy"><i class="bi bi-trash"></i> Remove</button>
                  </div>
                </div>
              }
            </div>
          } @else {
            <p class="muted">No accounts yet. Add one provider connection below.</p>
          }
          <form class="smtp-account-form" (ngSubmit)="saveAccount()" novalidate>
            <h3>{{ editingAccountId ? 'Edit connection' : 'Add connection' }}</h3>
            <div class="field-grid">
              <div><label for="int-acc-label">Label</label><input id="int-acc-label" name="accLabel" [(ngModel)]="accountLabel" placeholder="Payslip WhatsApp"></div>
              <div><label for="int-acc-purpose">Purpose tag (optional)</label><input id="int-acc-purpose" name="accPurpose" [(ngModel)]="accountPurpose" placeholder="payslip, leave, alerts…" maxlength="40"></div>
            </div>
            <label class="check"><input type="checkbox" name="enabled" [(ngModel)]="enabled"> Use this connection</label>
            <div class="int-provider">
              <label for="int-provider">{{ current.key === 'webhook' ? 'Where to post' : 'Provider' }}</label>
              <select id="int-provider" name="provider" [(ngModel)]="providerId" (ngModelChange)="errors = {}">
                @for (item of providers; track item.id) { <option [value]="item.id">{{ item.label }} · {{ item.region }}</option> }
              </select>
              @if (provider) {
                <p class="int-check">
                  <span class="chip" [class.is-ok]="provider.check === 'live'">{{ provider.check === 'live' ? 'Live check' : 'Format check' }}</span>
                  <span>{{ provider.checkNote }}</span>
                </p>
              }
            </div>
            @if (provider && provider.setup.length) {
              <div class="int-setup">
                <strong><i class="bi bi-signpost-split"></i> Where to find these</strong>
                <ol>@for (step of provider.setup; track step) { <li>{{ step }}</li> }</ol>
              </div>
            }
            @if (provider) {
              <div class="field-grid">
                @for (field of visible(); track field.key) {
                  <div [class.span-2]="field.kind === 'url' || field.kind === 'secret' && field.key !== 'authToken'">
                    <label [for]="'int-' + field.key">{{ field.label }}@if (field.required) { <span class="int-req" aria-hidden="true">*</span> }</label>
                    @if (field.kind === 'select') {
                      <select [id]="'int-' + field.key" [name]="'f-' + field.key" [ngModel]="draft().fields[field.key]" (ngModelChange)="setField(field, $event)">
                        @for (option of field.options || []; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
                      </select>
                    } @else if (field.kind === 'secret') {
                      <input [id]="'int-' + field.key" [name]="'s-' + field.key" type="password" autocomplete="new-password" [ngModel]="draft().secrets[field.key]" (ngModelChange)="setSecret(field, $event)" [placeholder]="savedMask(field) ? 'Saved ' + savedMask(field) + ' — leave blank to keep' : field.placeholder || ''" [class.is-invalid]="errors[field.key]" [attr.aria-invalid]="!!errors[field.key]">
                    } @else {
                      <input [id]="'int-' + field.key" [name]="'f-' + field.key" [type]="field.kind === 'url' ? 'url' : 'text'" [ngModel]="draft().fields[field.key]" (ngModelChange)="setField(field, $event)" [placeholder]="field.placeholder || ''" [attr.maxlength]="field.max || null" [class.is-invalid]="errors[field.key]" [attr.aria-invalid]="!!errors[field.key]">
                    }
                    @if (errors[field.key]) { <p class="int-error">{{ errors[field.key] }}</p> }
                    @else if (field.hint) { <p class="field-hint">{{ field.hint }}</p> }
                  </div>
                }
              </div>
            }
            <div class="settings-toggle-row">
              <label class="check"><input type="checkbox" name="isDefault" [(ngModel)]="accountDefault"> Default account</label>
            </div>
            <div class="settings-inline-save">
              <button class="btn btn-ghost" type="button" (click)="saveAccountAndTest()" [disabled]="busy"><i class="bi bi-plug"></i> Save and test</button>
              <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> {{ editingAccountId ? 'Update connection' : 'Add connection' }}</button>
              @if (editingAccountId) { <button class="btn btn-ghost" type="button" (click)="resetAccountForm()">Cancel edit</button> }
            </div>
          </form>
        </div>
      </section>
    } @else {
      <div class="int-back"><button type="button" class="btn btn-ghost btn-sm" (click)="close()"><i class="bi bi-arrow-left"></i> All connections</button></div>
      <form class="settings-card" (ngSubmit)="save()" novalidate>
        <header class="settings-card-head">
          <span class="settings-icon"><i [class]="icon(current.key)"></i></span>
          <div>
            <h2>{{ current.title }}</h2>
            <p>{{ current.summary }}</p>
          </div>
          <span class="integration-status" [class.is-on]="current.status === 'on'" [class.is-off]="current.status !== 'on'">{{ current.statusLabel }}</span>
        </header>
        <div class="settings-card-body">
          <label class="check"><input type="checkbox" name="enabled" [(ngModel)]="enabled"> Use this connection</label>
          @if (current.key !== 'api') {
            <div class="int-provider">
              <label for="int-provider">{{ current.key === 'bank' ? 'Salary account bank' : current.key === 'biometric' ? 'Reader brand' : current.key === 'webhook' ? 'Where to post' : 'Provider' }}</label>
              <select id="int-provider" name="provider" [(ngModel)]="providerId" (ngModelChange)="errors = {}">
                @for (item of providers; track item.id) { <option [value]="item.id">{{ item.label }} · {{ item.region }}</option> }
              </select>
              @if (provider) {
                <p class="int-check">
                  <span class="chip" [class.is-ok]="provider.check === 'live'">{{ provider.check === 'live' ? 'Live check' : 'Format check' }}</span>
                  <span>{{ provider.checkNote }}</span>
                </p>
              }
            </div>
          }
          @if (provider && provider.setup.length) {
            <div class="int-setup">
              <strong><i class="bi bi-signpost-split"></i> Where to find these</strong>
              <ol>@for (step of provider.setup; track step) { <li>{{ step }}</li> }</ol>
            </div>
          }
          @if (provider && current.key !== 'api') {
            <div class="field-grid">
              @for (field of visible(); track field.key) {
                <div [class.span-2]="field.kind === 'url' || field.kind === 'secret' && field.key !== 'authToken'">
                  <label [for]="'int-' + field.key">{{ field.label }}@if (field.required) { <span class="int-req" aria-hidden="true">*</span> }</label>
                  @if (field.kind === 'select') {
                    <select [id]="'int-' + field.key" [name]="'f-' + field.key" [ngModel]="draft().fields[field.key]" (ngModelChange)="setField(field, $event)">
                      @for (option of field.options || []; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
                    </select>
                  } @else if (field.kind === 'secret') {
                    <input [id]="'int-' + field.key" [name]="'s-' + field.key" type="password" autocomplete="new-password" [ngModel]="draft().secrets[field.key]" (ngModelChange)="setSecret(field, $event)" [placeholder]="savedMask(field) ? 'Saved ' + savedMask(field) + ' — leave blank to keep' : field.placeholder || ''" [class.is-invalid]="errors[field.key]" [attr.aria-invalid]="!!errors[field.key]">
                  } @else {
                    <input [id]="'int-' + field.key" [name]="'f-' + field.key" [type]="field.kind === 'url' ? 'url' : 'text'" [ngModel]="draft().fields[field.key]" (ngModelChange)="setField(field, $event)" [placeholder]="field.placeholder || ''" [attr.maxlength]="field.max || null" [class.is-invalid]="errors[field.key]" [attr.aria-invalid]="!!errors[field.key]">
                  }
                  @if (errors[field.key]) { <p class="int-error">{{ errors[field.key] }}</p> }
                  @else if (field.hint) { <p class="field-hint">{{ field.hint }}</p> }
                </div>
              }
            </div>
          }
          @if (current.key === 'api') {
            <p class="muted">{{ current.hasSecret ? 'A key is saved (' + current.secretMask + '). Generating a new one stops the old key at once.' : 'No key yet.' }}</p>
          }
          <div class="settings-inline-save">
            @if (current.key === 'api') {
              <button class="btn btn-ghost" type="button" (click)="generate()" [disabled]="busy"><i class="bi bi-key"></i> Generate a new key</button>
            } @else {
              <button class="btn btn-ghost" type="button" (click)="saveAndTest()" [disabled]="busy"><i class="bi bi-plug"></i> Save and test</button>
            }
            <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> Save connection</button>
          </div>
          @if (current.lastTest) {
            <p class="integration-card-last int-last" [class.is-ok]="current.lastTest.ok" [class.is-err]="!current.lastTest.ok">{{ testLine(current.lastTest) }}</p>
          }
        </div>
      </form>
    }
  `,
})
export class SettingsIntegrationsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  /** Channels that already drive product behaviour when switched on (others are save/test only for now). */
  readonly liveKeys = new Set(['biometric', 'bank', 'webhook', 'api']);
  cards: IntegrationView[] = [];
  catalog: Record<string, IntegrationProvider[]> = {};
  current: IntegrationView | null = null;
  channelAccounts: IntegrationAccountView[] = [];
  editingAccountId = '';
  accountLabel = '';
  accountPurpose = '';
  accountDefault = false;
  enabled = false;
  providerId = '';
  drafts: Record<string, { fields: Record<string, string>; secrets: Record<string, string> }> = {};
  errors: Record<string, string> = {};
  issuedKey = '';
  error = '';
  ok = '';
  busy = false;
  showAi = false;
  ai: AiSettingsView | null = null;

  private readonly multiKeys = new Set(['whatsapp', 'sms', 'webhook']);

  multiChannel(key: string): boolean {
    return this.multiKeys.has(key);
  }

  get aiOn(): boolean {
    return !!(this.ai?.enabled && this.ai?.ready);
  }

  get aiBlurb(): string {
    if (!this.ai) return 'OpenAI, Claude, Gemini, Azure — staff chat with fallback';
    const n = this.ai.accounts.length;
    if (!n) return 'Bring your own keys · staff chat (bottom-right)';
    if (this.aiOn) return n + ' account' + (n === 1 ? '' : 's') + ' · staff chat is available';
    if (this.ai.ready) return n + ' account' + (n === 1 ? '' : 's') + ' saved · switch on to use chat';
    return n + ' account' + (n === 1 ? '' : 's') + ' · add a working API key';
  }

  /** Short line under the title: what this connection does in the product right now. */
  scopeOf(card: IntegrationView): { label: string; kind: 'ok' | 'warn' | 'muted' } {
    const live = this.liveKeys.has(card.key);
    if (live) {
      if (card.status === 'on') {
        if (card.key === 'biometric') return { label: 'Receiving punches in Attendance', kind: 'ok' };
        if (card.key === 'bank') return { label: 'Shapes the payroll bank file', kind: 'ok' };
        if (card.key === 'webhook') return { label: 'Can post to your channel', kind: 'ok' };
        if (card.key === 'api') return { label: 'Company API key is active', kind: 'ok' };
        return { label: 'In use in HRMS', kind: 'ok' };
      }
      if (card.key === 'biometric') return { label: 'Will feed Attendance when switched on', kind: 'muted' };
      if (card.key === 'bank') return { label: 'Will shape bank files when switched on', kind: 'muted' };
      if (card.key === 'webhook') return { label: 'Will post when switched on', kind: 'muted' };
      if (card.key === 'api') return { label: 'Generate a key to use the API', kind: 'muted' };
      return { label: 'Used in HRMS when switched on', kind: 'muted' };
    }
    if (card.status === 'on') return { label: 'Credentials saved · sending not live yet', kind: 'warn' };
    if (card.enabled && card.missing.length) return { label: 'Switched on · finish the required fields', kind: 'warn' };
    return { label: 'Setup and test only for now', kind: 'muted' };
  }

  aiScope(): { label: string; kind: 'ok' | 'warn' | 'muted' } {
    if (this.aiOn) return { label: 'Staff chat is live', kind: 'ok' };
    if (this.ai?.ready) return { label: 'Ready · switch on for staff chat', kind: 'warn' };
    if (this.ai?.accounts?.length) return { label: 'Add a working key, then switch on', kind: 'warn' };
    return { label: 'Add a provider to enable staff chat', kind: 'muted' };
  }

  testLine(note: { ok: boolean; message: string }): string {
    return (note.ok ? 'Test passed' : 'Test failed') + ' · ' + note.message;
  }

  listOf(items: string[]): string {
    if (items.length <= 1) return items[0] || '';
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  get providers(): IntegrationProvider[] {
    return this.current ? this.catalog[this.current.key] || [] : [];
  }

  get provider(): IntegrationProvider | undefined {
    return this.providers.find((item) => item.id === this.providerId);
  }

  async ngOnInit(): Promise<void> {
    try {
      this.apply(await loadSettings(this.api));
      if (this.route.snapshot.queryParamMap.get('integration') === 'ai') this.openAi();
    } catch (error) {
      this.error = messageOf(error);
    }
  }

  icon(key: string): string {
    const icons: Record<string, string> = {
      whatsapp: 'bi bi-whatsapp',
      sms: 'bi bi-chat-dots',
      biometric: 'bi bi-fingerprint',
      bank: 'bi bi-bank',
      accounting: 'bi bi-journal-check',
      webhook: 'bi bi-broadcast',
      api: 'bi bi-code-slash',
    };
    return icons[key] || 'bi bi-plugin';
  }

  openAi(): void {
    this.showAi = true;
    this.current = null;
    this.error = '';
    this.ok = '';
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: 'integrations', integration: 'ai' },
      replaceUrl: true,
    });
  }

  closeAi(): void {
    this.showAi = false;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: 'integrations', integration: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    void this.refreshAi();
  }

  showAiInfo(): void {
    void this.sweet.info({
      title: 'AI assistant',
      text: 'Bring your own OpenAI, Claude, Gemini, Azure or compatible keys. When status is On, staff use the bottom-right chat for feature help, rules, violations, screen shortcuts and report briefs. Access still follows each person’s permissions.',
    });
  }

  async testAi(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', { section: 'test', target: 'ai' });
      this.apply(view);
      const note = this.ai?.lastTest;
      if (note && !note.ok) void this.sweet.error({ title: 'AI test failed', text: note.message });
      else void this.sweet.success({ title: 'AI test passed', text: note?.message || 'Credentials were accepted.' });
    } catch (error) {
      this.error = messageOf(error);
    } finally {
      this.busy = false;
    }
  }

  open(card: IntegrationView): void {
    this.showAi = false;
    this.current = card;
    this.channelAccounts = card.accounts || [];
    this.resetAccountForm();
    if (!this.multiChannel(card.key)) {
      this.enabled = card.enabled;
      this.providerId = card.provider;
      this.drafts = {};
      for (const [id, config] of Object.entries(card.configs)) this.drafts[id] = { fields: { ...config.fields }, secrets: {} };
    }
    this.errors = {};
    this.issuedKey = '';
    this.error = '';
    this.ok = '';
  }

  close(): void {
    this.current = null;
    this.channelAccounts = [];
    this.editingAccountId = '';
    this.errors = {};
    this.ok = '';
    this.error = '';
  }

  editAccount(row: IntegrationAccountView): void {
    this.editingAccountId = row.id;
    this.accountLabel = row.label;
    this.accountPurpose = row.purpose;
    this.accountDefault = row.isDefault;
    this.enabled = row.enabled;
    this.providerId = row.provider;
    this.drafts = {};
    for (const [id, config] of Object.entries(row.configs)) this.drafts[id] = { fields: { ...config.fields }, secrets: {} };
    this.errors = {};
  }

  resetAccountForm(): void {
    const card = this.current;
    this.editingAccountId = '';
    this.accountLabel = '';
    this.accountPurpose = '';
    this.accountDefault = !this.channelAccounts.length;
    this.enabled = false;
    this.providerId = card?.provider || this.providers[0]?.id || '';
    this.drafts = {};
    if (this.providerId && card?.configs[this.providerId]) {
      this.drafts[this.providerId] = { fields: { ...card.configs[this.providerId].fields }, secrets: {} };
    }
    this.errors = {};
  }

  async makeDefault(row: IntegrationAccountView): Promise<void> {
    if (!this.current) return;
    await this.persist(
      { section: 'integration', key: this.current.key, setDefault: true, id: row.id },
      row.label + ' is now the default.',
    );
  }

  async removeAccount(row: IntegrationAccountView): Promise<void> {
    if (!this.current) return;
    const go = await this.sweet.confirm({ title: 'Remove ' + row.label + '?', text: 'This connection is removed from saved settings.', confirmText: 'Remove', danger: true });
    if (!go) return;
    await this.persist({ section: 'integration', key: this.current.key, remove: true, id: row.id }, 'Connection removed.');
    this.resetAccountForm();
  }

  async saveAccount(): Promise<boolean> {
    if (!this.current || !this.multiChannel(this.current.key)) return false;
    if (!this.accountLabel.trim()) {
      this.error = 'Add a label for this connection.';
      return false;
    }
    if (!this.validate()) return false;
    const draft = this.draft();
    const secrets: Record<string, string> = {};
    for (const [key, value] of Object.entries(draft.secrets)) if (value.trim()) secrets[key] = value.trim();
    return this.persist(
      {
        section: 'integration',
        key: this.current.key,
        id: this.editingAccountId || undefined,
        label: this.accountLabel.trim(),
        purpose: this.accountPurpose.trim(),
        enabled: this.enabled,
        isDefault: this.accountDefault,
        provider: this.providerId,
        fields: draft.fields,
        secrets,
      },
      this.enabled ? 'Connection saved and switched on.' : 'Connection saved.',
      true,
    );
  }

  async saveAccountAndTest(): Promise<void> {
    if (!this.current) return;
    const before = this.editingAccountId;
    const ok = await this.saveAccount();
    if (!ok) return;
    const fresh = this.channelAccounts.find((item) => item.id === before) || this.channelAccounts[this.channelAccounts.length - 1];
    if (fresh) await this.testAccount(fresh);
  }

  async testAccount(row: IntegrationAccountView): Promise<void> {
    if (!this.current) return;
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', { section: 'test', target: this.current.key, id: row.id });
      this.apply(view);
      const card = this.cards.find((item) => item.key === this.current!.key);
      if (card) {
        this.current = card;
        this.channelAccounts = card.accounts || [];
        const updated = this.channelAccounts.find((item) => item.id === row.id);
        if (updated?.lastTest && !updated.lastTest.ok) void this.sweet.error({ title: row.label + ' test failed', text: updated.lastTest.message });
        else void this.sweet.success({ title: row.label + ' test passed', text: updated?.lastTest?.message || 'Test finished.' });
      }
    } catch (error) {
      this.error = messageOf(error);
    } finally {
      this.busy = false;
    }
  }

  draft(): { fields: Record<string, string>; secrets: Record<string, string> } {
    if (!this.drafts[this.providerId]) this.drafts[this.providerId] = { fields: {}, secrets: {} };
    return this.drafts[this.providerId];
  }

  visible(): IntegrationField[] {
    const provider = this.provider;
    if (!provider) return [];
    const fields = this.draft().fields;
    return provider.fields.filter((field) => {
      if (!field.showIf) return true;
      const parent = provider.fields.find((item) => item.key === field.showIf!.field);
      return field.showIf.equals.includes(fields[field.showIf.field] || parent?.value || '');
    });
  }

  savedMask(field: IntegrationField): string {
    if (this.editingAccountId) {
      const row = this.channelAccounts.find((item) => item.id === this.editingAccountId);
      return row?.configs[this.providerId]?.secrets[field.key] || '';
    }
    return this.current?.configs[this.providerId]?.secrets[field.key] || '';
  }

  setField(field: IntegrationField, value: string): void {
    this.draft().fields[field.key] = field.upper ? String(value || '').toUpperCase() : value;
    delete this.errors[field.key];
  }

  setSecret(field: IntegrationField, value: string): void {
    this.draft().secrets[field.key] = value;
    delete this.errors[field.key];
  }

  async save(): Promise<boolean> {
    if (!this.current) return false;
    if (this.current.key === 'api') return this.persist({ section: 'integration', key: 'api', enabled: this.enabled }, 'Connection saved.');
    if (!this.validate()) return false;
    const draft = this.draft();
    const secrets: Record<string, string> = {};
    for (const [key, value] of Object.entries(draft.secrets)) if (value.trim()) secrets[key] = value.trim();
    return this.persist(
      { section: 'integration', key: this.current.key, enabled: this.enabled, provider: this.providerId, fields: draft.fields, secrets },
      this.enabled ? `${this.provider?.label} saved and switched on.` : `${this.provider?.label} saved. It stays off until “Use this connection” is ticked.`,
    );
  }

  async saveAndTest(): Promise<void> {
    if (!this.current) return;
    const card = this.current;
    if (await this.save()) await this.test(card);
  }

  async generate(): Promise<void> {
    if (!this.current) return;
    if (this.current.hasSecret) {
      const go = await this.sweet.confirm({ title: 'Replace the API key?', text: 'The current key stops working at once. Anything using it must be updated with the new key.', confirmText: 'Generate new key', danger: true });
      if (!go) return;
    }
    await this.persist({ section: 'integration', key: 'api', enabled: true, generate: true }, 'New API key created.');
  }

  showInfo(card: IntegrationView): void {
    const provider = (this.catalog[card.key] || []).find((item) => item.id === card.provider);
    const scope = this.scopeOf(card);
    const rows: { label: string; value: string; tone?: 'ok' | 'bad' | 'muted' }[] = [
      { label: 'Status', value: card.statusLabel, tone: card.status === 'on' ? 'ok' : 'muted' },
      { label: 'In product', value: scope.label, tone: scope.kind === 'ok' ? 'ok' : scope.kind === 'warn' ? 'bad' : 'muted' },
      { label: 'Switched on', value: card.enabled ? 'Yes' : 'No', tone: card.enabled ? 'ok' : 'muted' },
    ];
    if (card.key !== 'api') rows.splice(1, 0, { label: 'Provider', value: card.providerLabel });
    if (provider) rows.push({ label: provider.check === 'live' ? 'Live check' : 'Format check', value: provider.checkNote });
    if (card.missing.length) rows.push({ label: 'Still needed', value: this.listOf(card.missing), tone: 'bad' });
    if (card.lastTest) rows.push({ label: 'Last test', value: this.testLine(card.lastTest), tone: card.lastTest.ok ? 'ok' : 'bad' });
    const others = (this.catalog[card.key] || []).map((item) => item.label).join(', ');
    void this.sweet.info({
      title: card.title,
      text: card.summary + (card.key === 'api' ? '' : ' Available: ' + others + '.'),
      rows,
      points: provider?.setup || [],
      pointsTitle: 'How to set it up',
      size: 'md',
    });
  }

  async test(card: IntegrationView): Promise<void> {
    if (this.multiChannel(card.key)) {
      const row = card.accounts?.find((item) => item.isDefault) || card.accounts?.[0];
      if (row) return this.testAccount(row);
    }
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', { section: 'test', target: card.key });
      this.apply(view);
      const fresh = this.cards.find((item) => item.key === card.key);
      if (this.current && fresh) this.current = fresh;
      const note = fresh?.lastTest;
      if (note && !note.ok) void this.sweet.error({ title: card.title + ' test failed', text: note.message });
      else void this.sweet.success({ title: card.title + ' test passed', text: note?.message || 'Test finished.' });
    } catch (error) {
      this.error = messageOf(error);
    } finally {
      this.busy = false;
    }
  }

  private validate(): boolean {
    const errors: Record<string, string> = {};
    const draft = this.draft();
    for (const field of this.visible()) {
      const value = String((field.kind === 'secret' ? draft.secrets[field.key] : draft.fields[field.key]) || '').trim().replace(field.kind === 'secret' ? /^Bearer\s+/i : /$^/, '');
      const saved = field.kind === 'secret' && !!this.savedMask(field);
      if (!value) {
        if (this.enabled && field.required && !saved) errors[field.key] = `Add the ${field.label}, or untick “Use this connection” to save it for later.`;
        continue;
      }
      if (field.pattern && !new RegExp(field.pattern).test(value)) errors[field.key] = field.patternMessage || `${field.label} is not in the expected format.`;
    }
    this.errors = errors;
    const first = Object.keys(errors)[0];
    if (first) {
      this.error = 'Fix the highlighted fields before saving.';
      setTimeout(() => document.getElementById('int-' + first)?.focus(), 0);
      return false;
    }
    return true;
  }

  private async persist(body: unknown, success: string, resetMultiForm = false): Promise<boolean> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', body);
      this.issuedKey = view.issuedKey;
      this.apply(view);
      const key = this.current?.key;
      const fresh = this.cards.find((item) => item.key === key) || null;
      if (fresh) {
        this.current = fresh;
        this.channelAccounts = fresh.accounts || [];
        for (const draft of Object.values(this.drafts)) draft.secrets = {};
        if (resetMultiForm) this.resetAccountForm();
      }
      this.ok = success;
      return true;
    } catch (error) {
      this.error = messageOf(error);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private apply(view: SettingsView): void {
    this.cards = view.integrations;
    this.catalog = view.integrationCatalog || {};
    this.ai = view.ai || null;
  }

  private async refreshAi(): Promise<void> {
    try {
      this.apply(await loadSettings(this.api));
    } catch {
      /* keep last known AI card state */
    }
  }
}

@Component({
  selector: 'app-settings-statutory',
  imports: [FormsModule],
  template: `
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    <form class="settings-card" (ngSubmit)="save()">
      <header class="settings-card-head">
        <span class="settings-icon"><i class="bi bi-percent"></i></span>
        <div>
          <h2>India payroll setup</h2>
          <p>Registration numbers and the rates this company follows for records and future payroll maths.</p>
        </div>
      </header>
      <div class="settings-card-body">
        <p class="banner" data-inline-message>Payslips today use the CTC and slip lines you enter under Payroll — these statutory rates are saved for compliance records and are not auto-applied to slips yet.</p>
        <div class="field-grid">
          <div>
            <label for="cycle">Pay cycle</label>
            <select id="cycle" name="payCycle" [(ngModel)]="form.payCycle">
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
          <div><label for="payday">Pay day (1–28)</label><input id="payday" name="payDay" type="number" min="1" max="28" [(ngModel)]="form.payDay"></div>
        </div>
        <h3 class="settings-subhead">Provident fund</h3>
        <label class="check"><input type="checkbox" name="pfEnabled" [(ngModel)]="form.pfEnabled"> PF applies</label>
        <div class="field-grid">
          <div><label for="pf-no">Establishment number</label><input id="pf-no" name="pfNumber" [(ngModel)]="form.pfNumber"></div>
          <div><label for="pf-ee">Employee rate %</label><input id="pf-ee" name="pfEmployeeRate" [(ngModel)]="form.pfEmployeeRate"></div>
          <div><label for="pf-er">Employer rate %</label><input id="pf-er" name="pfEmployerRate" [(ngModel)]="form.pfEmployerRate"></div>
          <div><label for="pf-cap">Wage ceiling (₹)</label><input id="pf-cap" name="pfWageCeiling" [(ngModel)]="form.pfWageCeiling"></div>
        </div>
        <h3 class="settings-subhead">ESI</h3>
        <label class="check"><input type="checkbox" name="esiEnabled" [(ngModel)]="form.esiEnabled"> ESI applies</label>
        <div class="field-grid">
          <div><label for="esi-no">Employer code</label><input id="esi-no" name="esiNumber" [(ngModel)]="form.esiNumber"></div>
          <div><label for="esi-ee">Employee rate %</label><input id="esi-ee" name="esiEmployeeRate" [(ngModel)]="form.esiEmployeeRate"></div>
          <div><label for="esi-er">Employer rate %</label><input id="esi-er" name="esiEmployerRate" [(ngModel)]="form.esiEmployerRate"></div>
          <div><label for="esi-cap">Wage ceiling (₹)</label><input id="esi-cap" name="esiWageCeiling" [(ngModel)]="form.esiWageCeiling"></div>
        </div>
        <h3 class="settings-subhead">Other statutory</h3>
        <div class="settings-toggle-row">
          <label class="check"><input type="checkbox" name="pt" [(ngModel)]="form.ptEnabled"> Professional tax, using the company state</label>
          <label class="check"><input type="checkbox" name="lwf" [(ngModel)]="form.lwfEnabled"> Labour welfare fund</label>
          <label class="check"><input type="checkbox" name="tds" [(ngModel)]="form.tdsEnabled"> TDS on salary</label>
          <label class="check"><input type="checkbox" name="gratuity" [(ngModel)]="form.gratuityEnabled"> Gratuity</label>
        </div>
        <p class="muted">The starting rates are the usual EPF and ESI percentages. Change them if this establishment follows a different notified rate. Nothing here is a payslip amount.</p>
        <div class="settings-savebar">
          <span>Payroll runs will read this setup. They do not calculate yet.</span>
          <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> Save statutory setup</button>
        </div>
      </div>
    </form>
  `,
})
export class SettingsStatutoryComponent implements OnInit {
  private readonly api = inject(ApiService);
  form: StatutorySettings = {
    pfEnabled: true, pfNumber: '', pfEmployeeRate: '12', pfEmployerRate: '12', pfWageCeiling: '15000',
    esiEnabled: true, esiNumber: '', esiEmployeeRate: '0.75', esiEmployerRate: '3.25', esiWageCeiling: '21000',
    ptEnabled: true, lwfEnabled: false, tdsEnabled: true, gratuityEnabled: true, payCycle: 'monthly', payDay: 1,
  };
  error = '';
  ok = '';
  busy = false;

  async ngOnInit(): Promise<void> {
    try {
      this.form = { ...(await loadSettings(this.api)).statutory };
    } catch (error) {
      this.error = messageOf(error);
    }
  }

  async save(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', { section: 'statutory', ...this.form, payDay: Number(this.form.payDay) });
      this.form = { ...view.statutory };
      this.ok = 'Statutory setup saved.';
    } catch (error) {
      this.error = messageOf(error);
    } finally {
      this.busy = false;
    }
  }
}

@Component({
  selector: 'app-settings-numbering',
  imports: [FormsModule],
  template: `
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    <form class="settings-card" (ngSubmit)="save()">
      <header class="settings-card-head">
        <span class="settings-icon"><i class="bi bi-hash"></i></span>
        <div>
          <h2>Document sequences</h2>
          <p>The next number continues after the last issued id</p>
        </div>
      </header>
      <div class="settings-card-body">
        <table class="seq-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Prefix</th>
              <th>Padding</th>
              <th>Include year</th>
              <th>Reset yearly</th>
              <th>Last</th>
              <th>Next</th>
            </tr>
          </thead>
          <tbody>
            @for (row of rows; track row.type) {
              <tr>
                <td><strong>{{ row.label }}</strong></td>
                <td><input [name]="'prefix-' + row.type" [(ngModel)]="row.prefix"></td>
                <td><input [name]="'pad-' + row.type" type="number" min="1" max="8" [(ngModel)]="row.padding"></td>
                <td><label class="check"><input type="checkbox" [name]="'year-' + row.type" [(ngModel)]="row.includeYear"> Year</label></td>
                <td><label class="check"><input type="checkbox" [name]="'reset-' + row.type" [(ngModel)]="row.resetYearly"> Reset</label></td>
                <td class="muted">{{ row.lastNumber }}</td>
                <td class="muted">{{ row.preview }}</td>
              </tr>
            }
          </tbody>
        </table>
        <div class="settings-savebar">
          <span>People already hired keep their employee codes. New people use the employee row.</span>
          <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> Save numbering</button>
        </div>
      </div>
    </form>
  `,
})
export class SettingsNumberingComponent implements OnInit {
  private readonly api = inject(ApiService);
  rows: NumberingRow[] = [];
  error = '';
  ok = '';
  busy = false;

  async ngOnInit(): Promise<void> {
    try {
      this.rows = (await loadSettings(this.api)).numbering.map((row) => ({ ...row }));
    } catch (error) {
      this.error = messageOf(error);
    }
  }

  async save(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', {
        section: 'numbering',
        sequences: this.rows.map((row) => ({
          type: row.type,
          prefix: row.prefix,
          padding: Number(row.padding),
          includeYear: row.includeYear,
          resetYearly: row.resetYearly,
        })),
      });
      this.rows = view.numbering.map((row) => ({ ...row }));
      this.ok = 'Numbering saved.';
    } catch (error) {
      this.error = messageOf(error);
    } finally {
      this.busy = false;
    }
  }
}

