import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Me } from '../core/models';
import { citiesOf, COUNTRY_CURRENCY, CURRENCIES, regionsOf, zoneLabel, zonesOf } from '../core/places';
import { SessionStore } from '../core/session.store';
import { Sweet } from '../shared/sweet';

interface OutletAdmin { userId: string; role: string; name: string }
interface OutletRow {
  id: string;
  name: string;
  code: string;
  country: string;
  state: string;
  city: string;
  timezone: string;
  currency: string;
  status: string;
  payroll: boolean;
  people: number;
  termEndsAt: string;
  usable: boolean;
  admins: OutletAdmin[];
}
interface SignIn { id: string; name: string; email: string; role: string; master: boolean }
interface OutletBoard { allowed: number; open: number; canAdd: boolean; countries: string[]; outlets: OutletRow[]; users: SignIn[]; copied?: Record<string, number> }
interface Draft { name: string; code: string; country: string; state: string; city: string; timezone: string; currency: string }

const COUNTRY_NAMES: Record<string, string> = {
  IN: 'India', US: 'United States', GB: 'United Kingdom', AE: 'United Arab Emirates', SG: 'Singapore', AU: 'Australia', CA: 'Canada',
  DE: 'Germany', NL: 'Netherlands', SA: 'Saudi Arabia', QA: 'Qatar', NP: 'Nepal', BD: 'Bangladesh', LK: 'Sri Lanka', OTHER: 'Another country',
};
const PARTS = [
  { id: 'departments', label: 'Departments' },
  { id: 'locations', label: 'Locations' },
  { id: 'teams', label: 'Teams' },
  { id: 'leaveTypes', label: 'Leave types' },
  { id: 'holidays', label: 'Holidays' },
];
const ROLES = [
  { id: 'owner', label: 'Owner' },
  { id: 'hr', label: 'HR' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'accountant', label: 'Accountant' },
  { id: 'manager', label: 'Manager' },
  { id: 'employee', label: 'Employee' },
];

@Component({
  selector: 'app-settings-outlets',
  imports: [FormsModule],
  template: `
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    @if (board) {
      <div class="att-stack">
      <header class="settings-panel-head">
        <h2><i class="bi bi-diagram-3"></i> Branches and who works in them</h2>
        <p>Each outlet is one branch with its own people and setup. Masters switch between all outlets from the top bar. Everyone else only sees outlets they are given below.</p>
      </header>
      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-building"></i></span>
          <div>
            <h2>Outlets</h2>
            <p>{{ board.open }} of {{ board.allowed }} {{ board.allowed === 1 ? 'outlet' : 'outlets' }} open. Each HRMS subscription opens one outlet.</p>
          </div>
          <button type="button" class="btn btn-gold outlet-add" (click)="startAdd()" [disabled]="!board.canAdd || !!draft" title="Opens another branch when a free subscription is available">
            <i class="bi bi-plus-lg"></i> Add outlet
          </button>
        </header>
        <div class="settings-card-body">
          @if (!board.canAdd) {
            <p class="banner outlet-note"><i class="bi bi-info-circle"></i> Every outlet your subscriptions pay for is open. To open another, add an HRMS subscription as an outlet in Altamid Control. It shows here after the next check-in.</p>
          }
          @if (draft) {
            <form class="outlet-form" (ngSubmit)="save()">
              <h3 class="settings-subhead">{{ editing ? 'Edit ' + editingName : 'New outlet' }}</h3>
              <div class="field-grid">
                <div><label for="o-name">Outlet name</label><input id="o-name" name="name" [(ngModel)]="draft.name" placeholder="Delhi Office" required></div>
                <div><label for="o-code">Short code</label><input id="o-code" name="code" [(ngModel)]="draft.code" placeholder="DEL" maxlength="8"></div>
                <div>
                  <label for="o-country">Country</label>
                  <select id="o-country" name="country" [(ngModel)]="draft.country" (ngModelChange)="countryChanged()">
                    @for (code of board.countries; track code) { <option [value]="code">{{ countryName(code) }}</option> }
                  </select>
                </div>
                <div>
                  <label for="o-state">State or region</label>
                  @if (stateOptions().length) {
                    <select id="o-state" name="state" [(ngModel)]="draft.state" (ngModelChange)="stateChanged()">
                      <option value="">Choose a state or region</option>
                      @for (item of stateOptions(); track item) { <option [value]="item">{{ item }}</option> }
                    </select>
                  } @else {
                    <input id="o-state" name="state" [(ngModel)]="draft.state" maxlength="60">
                  }
                </div>
                <div>
                  <label for="o-city">City</label>
                  @if (cityOptions().length) {
                    <select id="o-city" name="city" [ngModel]="cityOther ? other : draft.city" (ngModelChange)="pickCity($event)">
                      <option value="">{{ draft.country === 'IN' && !draft.state ? 'Choose the state first' : 'Choose a city' }}</option>
                      @for (item of cityOptions(); track item) { <option [value]="item">{{ item }}</option> }
                      <option [value]="other">Other city…</option>
                    </select>
                    @if (cityOther) {
                      <input class="outlet-city-other" name="cityOther" [(ngModel)]="draft.city" maxlength="60" placeholder="Type the city" aria-label="City name">
                    }
                  } @else {
                    <input id="o-city" name="city" [(ngModel)]="draft.city" maxlength="60" [placeholder]="draft.country === 'IN' ? 'Choose the state first' : 'City'">
                  }
                </div>
                <div>
                  <label for="o-tz">Time zone</label>
                  <select id="o-tz" name="timezone" [(ngModel)]="draft.timezone">
                    @if (!draft.timezone) { <option value="">Choose a time zone</option> }
                    @for (item of zoneOptions(); track item) { <option [value]="item">{{ zoneLabel(item) }}</option> }
                  </select>
                </div>
                <div>
                  <label for="o-cur">Currency</label>
                  <select id="o-cur" name="currency" [(ngModel)]="draft.currency">
                    @if (!draft.currency) { <option value="">Choose a currency</option> }
                    @for (item of currencyOptions(); track item.code) { <option [value]="item.code">{{ item.code }} · {{ item.name }}</option> }
                  </select>
                </div>
              </div>
              @if (draft.country !== 'IN') {
                <p class="banner outlet-note">Outlets outside India use the HR features: people, attendance, leave, hiring and documents. Payroll stays off for them.</p>
              }
              <div class="settings-inline-save">
                <button type="submit" class="btn btn-gold" [disabled]="busy"><i class="bi bi-check2"></i> {{ editing ? 'Save outlet' : 'Open outlet' }}</button>
                <button type="button" class="btn btn-ghost" (click)="draft = null" [disabled]="busy">Cancel</button>
              </div>
            </form>
          }
          <div class="outlet-list">
            @for (outlet of board.outlets; track outlet.id) {
              <article class="outlet-row" [class.is-archived]="outlet.status !== 'active'">
                <div class="outlet-row-main">
                  <strong>{{ outlet.name }} @if (outlet.code) { <small>{{ outlet.code }}</small> }</strong>
                  <span class="muted">{{ place(outlet) }} · {{ outlet.people }} {{ outlet.people === 1 ? 'person' : 'people' }}@if (outlet.termEndsAt) { · term ends {{ day(outlet.termEndsAt) }} }</span>
                  <span class="chip-row">
                    @if (outlet.status !== 'active') { <span class="chip">Archived</span> }
                    @else if (!outlet.usable) { <span class="chip is-bad">Subscription paused</span> }
                    @else { <span class="chip is-ok">Open</span> }
                    <span [class]="'chip ' + (outlet.payroll ? 'is-info' : 'is-warn')">{{ outlet.payroll ? 'HR and payroll' : 'HR only' }}</span>
                    @if (outlet.admins.length) {
                      <span class="chip is-soft">{{ outlet.admins.length }} sign-in{{ outlet.admins.length === 1 ? '' : 's' }} here</span>
                    }
                  </span>
                </div>
                <div class="outlet-row-actions">
                  @if (outlet.status === 'active') {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="startEdit(outlet)" title="Change name, place, time zone or currency"><i class="bi bi-pencil"></i> Edit</button>
                    <button type="button" class="btn btn-ghost btn-sm" [class.is-active]="adminFor === outlet.id" (click)="openAdmins(outlet)" title="Let a staff sign-in work in this outlet"><i class="bi bi-person-plus"></i> Who can work here</button>
                    <button type="button" class="btn btn-ghost btn-sm" [class.is-active]="copyFor === outlet.id" (click)="openCopy(outlet)" [disabled]="board.outlets.length < 2" [attr.title]="board.outlets.length < 2 ? 'Need another outlet to copy from' : 'Copy departments, leave types and more from another outlet'"><i class="bi bi-files"></i> Copy setup</button>
                    <button type="button" class="btn btn-ghost btn-sm btn-danger" (click)="archive(outlet, true)" [disabled]="board.open < 2" [attr.title]="board.open < 2 ? 'Keep at least one outlet open' : 'Close this outlet and free its subscription'"><i class="bi bi-archive"></i> Archive</button>
                  } @else {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="archive(outlet, false)" [disabled]="!board.canAdd" title="Open this outlet again if a subscription is free"><i class="bi bi-arrow-counterclockwise"></i> Reopen</button>
                  }
                </div>
                @if (adminFor === outlet.id) {
                  <div class="outlet-panel">
                    <div class="outlet-panel-head">
                      <strong>Who can work in {{ outlet.name }}</strong>
                      <p class="muted">This is not a new password. It links an existing HRMS sign-in (email login) to this outlet so they can switch into it. Masters already see every outlet — you do not need to add them here.</p>
                    </div>
                    @if (outlet.admins.length) {
                      <ul class="outlet-member-list">
                        @for (admin of outlet.admins; track admin.userId) {
                          <li>
                            <span>
                              <strong>{{ admin.name || 'Sign-in' }}</strong>
                              <small>{{ memberEmail(admin.userId) }} · {{ admin.role ? roleLabel(admin.role) + ' here' : 'Same role as their sign-in' }}@if (isMasterUser(admin.userId)) { · also a master }</small>
                            </span>
                            <button type="button" class="btn btn-ghost btn-sm" (click)="removeAdmin(outlet, admin)" [disabled]="busy">Remove</button>
                          </li>
                        }
                      </ul>
                    } @else {
                      <p class="outlet-empty muted">Nobody is linked yet. People whose employee record is in this outlet still appear in People; this list is for extra sign-ins that should open this branch.</p>
                    }
                    <form class="outlet-inline" (ngSubmit)="addAdmin(outlet)">
                      @if (availableUsers(outlet).length) {
                        <div>
                          <label [for]="'a-user-' + outlet.id">Sign-in to add</label>
                          <select [id]="'a-user-' + outlet.id" name="user" [(ngModel)]="adminUser">
                            <option value="">Choose a sign-in</option>
                            @for (user of availableUsers(outlet); track user.id) {
                              <option [value]="user.id">{{ user.name }} · {{ user.email }} · {{ roleLabel(user.role) }}</option>
                            }
                          </select>
                        </div>
                        <div>
                          <label [for]="'a-role-' + outlet.id">Role in {{ outlet.name }}</label>
                          <select [id]="'a-role-' + outlet.id" name="role" [(ngModel)]="adminRole">
                            <option value="">Same as their sign-in</option>
                            @for (role of roles; track role.id) { <option [value]="role.id">{{ role.label }}</option> }
                          </select>
                        </div>
                        <div class="outlet-inline-actions">
                          <button type="submit" class="btn btn-gold btn-sm" [disabled]="busy || !adminUser">Add</button>
                          <button type="button" class="btn btn-ghost btn-sm" (click)="adminFor = ''">Done</button>
                        </div>
                      } @else {
                        <p class="banner outlet-note"><i class="bi bi-info-circle"></i>
                          @if (allUsersAreMaster()) {
                            Every sign-in is a master, so they already open every outlet. Turn Master off for someone under Master access if they should only work in one branch — then add them here.
                          } @else {
                            Every non-master sign-in is already linked to this outlet.
                          }
                        </p>
                        <div class="outlet-inline-actions">
                          <button type="button" class="btn btn-ghost btn-sm" (click)="adminFor = ''">Done</button>
                        </div>
                      }
                    </form>
                  </div>
                }
                @if (copyFor === outlet.id) {
                  <div class="outlet-panel">
                    <div class="outlet-panel-head">
                      <strong>Copy setup into {{ outlet.name }}</strong>
                      <p class="muted">Brings lists from another outlet. Names that already exist here are left alone — nothing is overwritten.</p>
                    </div>
                    <form class="outlet-inline" (ngSubmit)="copy(outlet)">
                      <div><label [for]="'c-from-' + outlet.id">Copy from</label>
                        <select [id]="'c-from-' + outlet.id" name="from" [(ngModel)]="copyFrom">
                          @for (other of board.outlets; track other.id) { @if (other.id !== outlet.id) { <option [value]="other.id">{{ other.name }}</option> } }
                        </select>
                      </div>
                      <fieldset class="outlet-parts">
                        <legend>What to copy</legend>
                        @for (part of parts; track part.id) {
                          <label class="check"><input type="checkbox" [name]="'p-' + part.id" [(ngModel)]="copyParts[part.id]"> {{ part.label }}</label>
                        }
                      </fieldset>
                      <div class="outlet-inline-actions">
                        <button type="submit" class="btn btn-gold btn-sm" [disabled]="busy || !copyFrom">Copy</button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="copyFor = ''">Cancel</button>
                      </div>
                    </form>
                  </div>
                }
              </article>
            }
          </div>
        </div>
      </section>
      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-shield-check"></i></span>
          <div>
            <h2>Master access</h2>
            <p>Masters see every outlet, choose “All outlets”, and manage this page. Non-masters only open outlets listed under Who can work here (or where their employee record sits).</p>
          </div>
        </header>
        <div class="settings-card-body">
          <p class="field-hint">Your own Master switch stays on so you cannot lock yourself out. Ask another master if you need yours removed.</p>
          @for (user of board.users; track user.id) {
            <div class="outlet-unit">
              <span><strong>{{ user.name }}</strong><small>{{ user.email }} · {{ roleLabel(user.role) }}</small></span>
              <label class="check"><input type="checkbox" [checked]="user.master" [disabled]="busy || user.id === me?.id" (change)="setMaster(user, $any($event.target).checked)"> Master</label>
            </div>
          }
        </div>
      </section>
      </div>
    }
  `,
})
export class OutletSettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly sweet = inject(Sweet);
  readonly parts = PARTS;
  readonly roles = ROLES;
  me: Me | null = this.store.me;
  board: OutletBoard | null = null;
  draft: Draft | null = null;
  editing = '';
  editingName = '';
  adminFor = '';
  adminUser = '';
  adminRole = '';
  copyFor = '';
  copyFrom = '';
  copyParts: Record<string, boolean> = {};
  readonly other = '__other__';
  cityOther = false;
  error = '';
  ok = '';
  busy = false;

  async ngOnInit(): Promise<void> {
    await this.run(async () => (this.board = await this.api.get<OutletBoard>('/v1/outlets')), '');
  }

  countryName(code: string): string {
    return COUNTRY_NAMES[code] || code;
  }

  place(outlet: OutletRow): string {
    return [outlet.city, outlet.state, this.countryName(outlet.country)].filter(Boolean).join(', ');
  }

  day(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
  }

  isMasterUser(userId: string): boolean {
    return !!this.board?.users.find((user) => user.id === userId)?.master;
  }

  /** Angular templates cannot use arrow functions such as users.every(...). */
  allUsersAreMaster(): boolean {
    const users = this.board?.users || [];
    return users.length > 0 && users.every((user) => user.master);
  }

  memberEmail(userId: string): string {
    return this.board?.users.find((user) => user.id === userId)?.email || '';
  }

  roleLabel(role: string): string {
    if (!role) return 'Same as sign-in';
    return ROLES.find((item) => item.id === role)?.label || role;
  }

  /** Non-master sign-ins not already linked to this outlet. */
  availableUsers(outlet: OutletRow): SignIn[] {
    const linked = new Set(outlet.admins.map((admin) => admin.userId));
    return (this.board?.users || []).filter((user) => !user.master && !linked.has(user.id));
  }

  startAdd(): void {
    this.editing = '';
    this.cityOther = false;
    this.draft = { name: '', code: '', country: 'IN', state: '', city: '', timezone: 'Asia/Kolkata', currency: 'INR' };
  }

  startEdit(outlet: OutletRow): void {
    this.editing = outlet.id;
    this.editingName = outlet.name;
    this.draft = { name: outlet.name, code: outlet.code, country: outlet.country, state: outlet.state, city: outlet.city, timezone: outlet.timezone, currency: outlet.currency };
    this.cityOther = !!outlet.city && !citiesOf(outlet.country, outlet.state).includes(outlet.city);
  }

  /** The list for the country, plus a saved value that is not on it, so nothing is lost on edit. */
  stateOptions(): string[] {
    return this.keep(regionsOf(this.draft?.country || ''), this.draft?.state || '');
  }

  cityOptions(): string[] {
    return this.draft ? citiesOf(this.draft.country, this.draft.state) : [];
  }

  zoneOptions(): string[] {
    return this.keep(zonesOf(this.draft?.country || ''), this.draft?.timezone || '');
  }

  currencyOptions(): Array<{ code: string; name: string }> {
    const code = this.draft?.currency || '';
    return code && !CURRENCIES.some((item) => item.code === code) ? [{ code, name: code }, ...CURRENCIES] : CURRENCIES;
  }

  zoneLabel(zone: string): string {
    return zoneLabel(zone);
  }

  countryChanged(): void {
    if (!this.draft) return;
    const draft = this.draft;
    if (!regionsOf(draft.country).includes(draft.state)) draft.state = '';
    if (!citiesOf(draft.country, draft.state).includes(draft.city)) {
      draft.city = '';
      this.cityOther = false;
    }
    const zones = zonesOf(draft.country);
    if (!zones.includes(draft.timezone)) draft.timezone = zones.length === 1 ? zones[0] : '';
    if (!this.editing || !draft.currency) draft.currency = COUNTRY_CURRENCY[draft.country] || draft.currency;
  }

  stateChanged(): void {
    if (!this.draft || this.cityOther) return;
    if (!citiesOf(this.draft.country, this.draft.state).includes(this.draft.city)) this.draft.city = '';
  }

  pickCity(value: string): void {
    if (!this.draft) return;
    this.cityOther = value === this.other;
    this.draft.city = this.cityOther ? '' : value;
  }

  private keep(list: string[], value: string): string[] {
    return value && !list.includes(value) ? [value, ...list] : list;
  }

  async save(): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    await this.run(async () => {
      this.board = this.editing
        ? await this.api.patch<OutletBoard>('/v1/outlets/' + this.editing, draft)
        : await this.api.post<OutletBoard>('/v1/outlets', draft);
      this.draft = null;
      await this.refreshMe();
    }, this.editing ? 'Outlet saved.' : `${draft.name} is open. Use Copy setup to bring departments, leave types and holidays across.`);
  }

  async archive(outlet: OutletRow, archived: boolean): Promise<void> {
    if (archived && !(await this.sweet.confirm({ title: `Archive ${outlet.name}?`, text: 'Its records stay, but nobody can work in it and it frees its subscription. Move or exit its people first.', confirmText: 'Archive', danger: true, kind: 'warning' }))) return;
    await this.run(async () => {
      this.board = await this.api.post<OutletBoard>(`/v1/outlets/${outlet.id}/status`, { archived });
      await this.refreshMe();
    }, archived ? `${outlet.name} is archived.` : `${outlet.name} is open again.`);
  }

  openAdmins(outlet: OutletRow): void {
    this.copyFor = '';
    this.adminFor = this.adminFor === outlet.id ? '' : outlet.id;
    this.adminUser = '';
    this.adminRole = '';
  }

  async addAdmin(outlet: OutletRow): Promise<void> {
    await this.run(async () => {
      this.board = await this.api.post<OutletBoard>(`/v1/outlets/${outlet.id}/members`, { userId: this.adminUser, role: this.adminRole });
      this.adminFor = '';
    }, `Added to ${outlet.name}.`);
  }

  async removeAdmin(outlet: OutletRow, admin: OutletAdmin): Promise<void> {
    await this.run(async () => {
      this.board = await this.api.post<OutletBoard>(`/v1/outlets/${outlet.id}/members`, { userId: admin.userId, remove: true });
    }, `${admin.name} no longer works in ${outlet.name}.`);
  }

  openCopy(outlet: OutletRow): void {
    this.adminFor = '';
    this.copyFor = this.copyFor === outlet.id ? '' : outlet.id;
    this.copyFrom = this.board?.outlets.find((row) => row.id !== outlet.id)?.id || '';
    this.copyParts = { departments: true, leaveTypes: true, holidays: true };
  }

  async copy(outlet: OutletRow): Promise<void> {
    const parts = Object.keys(this.copyParts).filter((key) => this.copyParts[key]);
    await this.run(async () => {
      const result = await this.api.post<OutletBoard>(`/v1/outlets/${outlet.id}/copy`, { from: this.copyFrom, parts });
      this.board = result;
      this.copyFor = '';
      const copied = result.copied || {};
      const withCounts = PARTS.filter((part) => copied[part.id] !== undefined);
      const said = withCounts.map((part) => `${copied[part.id]} ${part.label.toLowerCase()}`);
      this.ok = `Copied into ${outlet.name}: ${said.join(', ') || 'nothing new'}.`;
      if (withCounts.length) {
        await this.sweet.success({
          title: `Copied into ${outlet.name}`,
          rows: withCounts.map((part) => ({ label: part.label, value: String(copied[part.id]) })),
        });
      } else if (Object.keys(copied).length) {
        await this.sweet.info({ title: 'Copy finished', text: this.ok });
      }
    }, '');
  }

  async setMaster(user: SignIn, master: boolean): Promise<void> {
    await this.run(async () => {
      this.board = await this.api.post<OutletBoard>('/v1/outlets/masters', { userId: user.id, master });
    }, master ? `${user.name} is now a master.` : `${user.name} works only in their own outlet now.`);
  }

  private async refreshMe(): Promise<void> {
    this.store.me = await this.api.get<Me>('/v1/me');
    this.me = this.store.me;
  }

  private async run(work: () => Promise<unknown>, done: string): Promise<void> {
    this.busy = true;
    this.error = '';
    if (done) this.ok = '';
    try {
      await work();
      if (done) this.ok = done;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'That did not work.';
      if (this.board) {
        try {
          this.board = await this.api.get<OutletBoard>('/v1/outlets');
        } catch {
          /* keep what is on screen */
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
