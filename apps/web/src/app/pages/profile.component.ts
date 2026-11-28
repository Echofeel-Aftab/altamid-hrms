import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Sweet } from '../shared/sweet';
import { PunchState } from '../core/models';
import { squarePhoto } from '../core/photo';
import { PhotoComponent } from '../shared/photo.component';
import { MyDetailsComponent } from './my-details.component';
import { AccessPanelComponent } from './access-panel.component';
import { ProfileSecurityComponent } from './profile-security.component';

interface PersonCard {
  id: string;
  photo: string;
  service: string;
  name: string;
  code: string;
  workerType: string;
  dateOfJoining: string;
  department: { name: string } | null;
  designation: { name: string } | null;
  location: { name: string } | null;
  manager: { name: string } | null;
}

interface DocRow { id: string; title: string; kindLabel: string; access: string; sharedOn: string; mine: boolean }
interface PayView {
  structure: { effectiveFrom: string; annual: string; published: boolean } | null;
  slips: Array<{ label: string; net: string; published: boolean }>;
  forms: Array<{ year: string; published: boolean }>;
}
interface BadgeRow { badge: string; note: string; from: string; to: string; at: string }
interface LeaveBalance { name: string; entitled: number; left: number }
interface RequestRow { id: string; type: string; startsOn: string; endsOn: string; status: string }
interface AssetRow { id: string; name: string; tag: string; kind: string; kindLabel?: string; serialNo?: string; issuedOn: string; holder: string; code: string; inStock: boolean }

@Component({
  selector: 'app-profile',
  imports: [RouterLink, FormsModule, AccessPanelComponent, PhotoComponent, MyDetailsComponent, ProfileSecurityComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-person-circle"></i></span>
        <p class="eyebrow">My day</p>
        <h1>My profile</h1>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (person) {
      <section class="p-hero">
        <div class="p-hero-band">
          <div class="p-band-row" aria-label="Today at a glance">
            <a class="p-band-item" routerLink="/attendance" [class.is-live]="punch?.state === 'in'">
              <i class="bi" [class]="punch?.state === 'in' ? 'bi-clock-history' : punch?.lastOut ? 'bi-box-arrow-right' : 'bi-fingerprint'"></i>
              <span><small>Today</small><strong>{{ punchLine }}</strong></span>
            </a>
            @if (milestone) {
              <div class="p-band-item" [class.is-party]="milestone.days === 0">
                <i class="bi" [class]="milestone.icon"></i>
                <span><small>{{ milestone.label }}</small><strong>{{ milestone.when }}</strong></span>
              </div>
            }
            @if (holiday) {
              <a class="p-band-item" routerLink="/leave">
                <i class="bi bi-sun"></i>
                <span><small>Next holiday</small><strong>{{ holiday.name }} · {{ holiday.when }}</strong></span>
              </a>
            }
            @if (leaveLeft !== null) {
              <a class="p-band-item" routerLink="/leave">
                <i class="bi bi-airplane"></i>
                <span><small>Leave left</small><strong>{{ leaveLeft }} {{ leaveLeft === 1 ? 'day' : 'days' }}</strong></span>
              </a>
            }
          </div>
        </div>
        <div class="p-hero-body">
          <div class="p-avatar-wrap">
            <app-photo [personId]="person.id" [stamp]="person.photo" [name]="person.name" />
            <label class="p-avatar-cam" [title]="person.photo ? 'Change photo' : 'Add photo'">
              <i class="bi" [class]="photoBusy ? 'bi-hourglass-split' : 'bi-camera-fill'"></i>
              <span class="sr-only">{{ person.photo ? 'Change photo' : 'Add photo' }}</span>
              <input type="file" accept="image/*" class="sr-only" [disabled]="photoBusy" (change)="pickPhoto($event)">
            </label>
          </div>
          <div class="p-hero-id">
            <h2>{{ person.name }}</h2>
            <p>{{ person.designation?.name || 'Team member' }}@if (person.department) { · {{ person.department.name }} }</p>
            <div class="chip-row">
              <span class="chip"><i class="bi bi-hash"></i>{{ person.code }}</span>
              <span class="chip is-cap"><i class="bi bi-briefcase"></i>{{ person.workerType }}</span>
              @if (person.location) { <span class="chip"><i class="bi bi-geo-alt"></i>{{ person.location.name }}</span> }
              <span class="chip is-info"><i class="bi bi-hourglass-split"></i>{{ person.service || 'New' }}</span>
              @if (received.length) { <span class="chip is-ok"><i class="bi bi-award"></i>{{ received.length }} badges</span> }
            </div>
          </div>
          <div class="p-hero-actions">
            <button type="button" class="btn btn-secondary" (click)="tab = 'details'"><i class="bi bi-pencil-square"></i> Update my details</button>
            <button type="button" class="btn btn-ghost" (click)="tab = 'security'"><i class="bi bi-shield-lock"></i> Security</button>
            <a class="btn btn-ghost" routerLink="/settings" [queryParams]="{ tab: 'password' }"><i class="bi bi-key"></i> Password</a>
            <a class="btn btn-primary" [routerLink]="'/people/' + person.id"><i class="bi bi-person-vcard"></i> Open dossier</a>
          </div>
        </div>
      </section>
      <div class="profile-desk">
        <nav class="profile-tabs" aria-label="Profile sections">
          @for (item of tabs; track item.id) {
            <button type="button" class="profile-tab" [class.is-on]="tab === item.id" (click)="tab = item.id">
              <i [class]="item.icon"></i> {{ item.label }}
            </button>
          }
        </nav>
        <div class="profile-pane">
          @switch (tab) {
            @case ('about') {
              <div class="bento is-pane">
                <article class="bento-stat"><span class="bento-ico"><i class="bi bi-calendar-check"></i></span><small>Joined</small><strong>{{ person.dateOfJoining }}</strong></article>
                <article class="bento-stat"><span class="bento-ico"><i class="bi bi-diagram-3"></i></span><small>Manager</small><strong>{{ person.manager?.name || '—' }}</strong></article>
                <article class="bento-stat"><span class="bento-ico is-gold"><i class="bi bi-people"></i></span><small>Report to you</small><strong>{{ reports }}</strong></article>
                <section class="card bento-wide">
                  <div class="card-head"><h2><i class="bi bi-briefcase"></i> Work</h2><span class="source-chip"><i class="bi bi-database"></i> HR record</span></div>
                  <dl class="kv">
                    <div><dt>Department</dt><dd>{{ person.department?.name || '—' }}</dd></div>
                    <div><dt>Designation</dt><dd>{{ person.designation?.name || '—' }}</dd></div>
                    <div><dt>Location</dt><dd>{{ person.location?.name || '—' }}</dd></div>
                    <div><dt>Worker type</dt><dd>{{ person.workerType }}</dd></div>
                  </dl>
                </section>
              </div>
            }
            @case ('details') {
              <app-my-details [personId]="person.id" (photo)="person.photo = $event" />
            }
            @case ('documents') {
              <section class="card">
                <div class="card-head">
                  <h2><i class="bi bi-folder2-open"></i> My documents</h2>
                  <a routerLink="/library">Library</a>
                </div>
                <p class="muted">Offer letters, increment letters, circulars, and the handbook that have been shared with you.</p>
                @if (handbook) {
                  <div class="people-hit">
                    <span class="people-avatar"><i class="bi bi-journal"></i></span>
                    <div><strong>{{ handbook.title }}</strong><small>Handbook · {{ handbook.version }}</small></div>
                    <button type="button" class="btn btn-ghost btn-sm" (click)="openFile('/v1/library/handbook/file', handbook.title, 'Handbook · ' + handbook.version)"><i class="bi bi-eye"></i> Preview</button>
                  </div>
                }
                @if (!documents.length && !handbook) {
                  <p class="muted">No document has been shared with you yet.</p>
                }
                @for (item of documents; track item.id) {
                  <div class="people-hit">
                    <span class="people-avatar"><i class="bi bi-file-earmark-text"></i></span>
                    <div><strong>{{ item.title }}</strong><small>{{ item.kindLabel }} · {{ item.sharedOn }}</small></div>
                    <button type="button" class="btn btn-ghost btn-sm" (click)="openFile('/v1/library/files/' + item.id, item.title, item.kindLabel)"><i class="bi bi-eye"></i> Preview</button>
                  </div>
                }
              </section>
            }
            @case ('pay') {
              <section class="card">
                <div class="card-head">
                  <h2><i class="bi bi-wallet2"></i> My pay</h2>
                  <a routerLink="/pay">Open pay</a>
                </div>
                <p class="muted">Figures payroll has published. This page does not calculate PF, ESI, or tax.</p>
                @if (!pay?.structure && !pay?.slips?.length && !pay?.forms?.length) {
                  <p class="muted">Payroll has not published a salary for you yet.</p>
                } @else {
                  @if (pay?.structure) {
                    <p><strong>{{ pay?.structure?.annual }}</strong> <span class="muted">annual CTC from {{ pay?.structure?.effectiveFrom }}</span></p>
                  }
                  <ul class="plain">
                    @for (slip of pay?.slips || []; track slip.label) {
                      <li><span>{{ slip.label }}</span><strong>{{ slip.net }}</strong></li>
                    }
                    @for (form of pay?.forms || []; track form.year) {
                      <li><span>Form 16 {{ form.year }}</span><strong>{{ form.published ? 'Published' : 'Draft' }}</strong></li>
                    }
                  </ul>
                }
              </section>
            }
            @case ('growth') {
              <section class="card">
                <div class="card-head">
                  <h2><i class="bi bi-graph-up-arrow"></i> My growth</h2>
                  <a routerLink="/growth">Open My Growth</a>
                </div>
                <p class="muted">The career chart, each year's grade, and the CTC breakup are on My Growth. Your manager or HR publishes an appraisal every year. Badges from colleagues stay here.</p>
                <div class="field-grid">
                  <div><label>Service</label><strong>{{ person.service || 'Not added' }}</strong></div>
                  <div><label>Badges received</label><strong>{{ received.length }}</strong></div>
                </div>
                @if (!received.length) {
                  <p class="muted">No badge has been given to you yet.</p>
                }
                @for (item of received; track item.at + item.badge + item.from) {
                  <div class="people-hit">
                    <span class="people-avatar"><i class="bi bi-award"></i></span>
                    <div><strong>{{ item.badge }}</strong><small>{{ item.note || 'No note' }} · {{ item.from }} · {{ item.at }}</small></div>
                  </div>
                }
              </section>
            }
            @case ('time') {
              <section class="card">
                <div class="card-head">
                  <h2><i class="bi bi-sun"></i> Time off</h2>
                  <a routerLink="/leave">Apply</a>
                </div>
                @if (!balances.length) {
                  <p class="muted">Leave balances appear once your sign-in is linked to a person.</p>
                }
                @for (item of balances; track item.name) {
                  <div class="leave-line">
                    <div><span>{{ item.name }}</span><strong>{{ item.entitled ? item.left : 'Open' }}</strong></div>
                    <small>{{ item.entitled ? item.left + ' of ' + item.entitled + ' left' : 'No yearly limit' }}</small>
                  </div>
                }
                <div class="actions"><a class="btn btn-ghost" routerLink="/attendance">Attendance</a></div>
              </section>
            }
            @case ('requests') {
              <section class="card">
                <div class="card-head">
                  <h2><i class="bi bi-inbox"></i> My requests</h2>
                  <a routerLink="/requests">Open requests</a>
                </div>
                @if (!requests.length) { <p class="muted">You have not sent a request yet.</p> }
                <ul class="plain">
                  @for (item of requests; track item.id) {
                    <li><span>{{ item.type }} · {{ item.startsOn }}<span class="muted"> to {{ item.endsOn }}</span></span><strong>{{ item.status }}</strong></li>
                  }
                </ul>
              </section>
            }
            @case ('assets') {
              <section class="card">
                <div class="card-head">
                  <h2><i class="bi bi-laptop"></i> My assets</h2>
                  <a routerLink="/assets">Assets</a>
                </div>
                @if (!mineAssets.length) { <p class="muted">Nothing is issued to you.</p> }
                <ul class="plain">
                  @for (item of mineAssets; track item.id) {
                    <li><span>{{ item.name }} <span class="muted">{{ item.tag }} · {{ item.kindLabel || item.kind }}@if (item.serialNo) { · S/N {{ item.serialNo }} }</span></span><strong>{{ item.issuedOn || 'Issued' }}</strong></li>
                  }
                </ul>
              </section>
            }
            @case ('access') {
              <app-access-panel [employeeId]="person.id" />
            }
            @case ('security') {
              <app-profile-security />
            }
            @case ('work') {
              @if (tasks.length) {
                <section class="card">
                  <h2><i class="bi bi-rocket-takeoff"></i> Onboarding</h2>
                  <ul class="plain">
                    @for (task of tasks; track task.id) { <li><span>{{ task.title }}</span><strong>{{ task.done ? 'Done' : 'Open' }}</strong></li> }
                  </ul>
                </section>
              }
              <section class="card">
                <h2><i class="bi bi-box-arrow-right"></i> Resignation</h2>
                @if (exit && exit.status === 'pending') {
                  <p>Waiting. Last working day {{ exit.lastDay }}.</p>
                  <div class="actions"><button type="button" class="btn btn-ghost" (click)="cancelExit()">Cancel</button></div>
                } @else if (exit && exit.status !== 'cancelled') {
                  <p>This resignation was {{ exit.status }}. Last working day {{ exit.lastDay }}.</p>
                } @else if (confirming) {
                  <div class="approval-card">
                    <div class="approval-head">
                      <span class="approval-ico"><i class="bi bi-shield-exclamation"></i></span>
                      <div><h2>Send this resignation?</h2><p>Your manager or HR will be told. You can cancel while it is waiting.</p></div>
                      <span class="chip is-warn">Needs approval</span>
                    </div>
                    <ul class="diff-list">
                      <li><span class="diff-key">Last working day</span><span class="diff-new">{{ lastDay }}</span><span></span><span></span></li>
                      <li><span class="diff-key">Reason</span><span>{{ reason }}</span><span></span><span></span></li>
                    </ul>
                    <div class="actions">
                      <button type="button" class="btn btn-primary" [disabled]="busy" (click)="resign()"><i class="bi bi-send"></i> Approve and send</button>
                      <button type="button" class="btn btn-ghost" (click)="confirming = false"><i class="bi bi-pencil"></i> Edit</button>
                      <button type="button" class="btn btn-ghost btn-danger" (click)="confirming = false; reason = ''"><i class="bi bi-x-lg"></i> Reject</button>
                    </div>
                  </div>
                } @else {
                  <p class="muted">Send a last working day and a reason. Your manager, or HR, decides. Accepting records the date. It does not remove you.</p>
                  <form class="form-grid" (ngSubmit)="confirming = true">
                    <label for="last-day">Last working day</label>
                    <input id="last-day" name="lastDay" type="date" [(ngModel)]="lastDay" required>
                    @if (noticeDays) { <p class="field-hint">Filled from the {{ noticeDays }}-day notice period. You can change it; your manager or HR decides.</p> }
                    <label for="exit-reason">Reason</label>
                    <textarea id="exit-reason" name="reason" rows="2" [(ngModel)]="reason" required></textarea>
                    <div class="actions"><button class="btn btn-secondary" type="submit" [disabled]="busy">Review resignation</button></div>
                  </form>
                }
              </section>
            }
          }
        </div>
      </div>
    } @else if (!error) {
      <section class="card"><h2><i class="bi bi-person-x"></i> No person linked</h2><p class="muted">Ask HR to connect this sign-in to a person.</p></section>
    }
  `,
})
export class ProfileComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly route = inject(ActivatedRoute);
  photoBusy = false;
  readonly tabs = [
    { id: 'about', label: 'About me', icon: 'bi bi-person' },
    { id: 'details', label: 'My details', icon: 'bi bi-person-lines-fill' },
    { id: 'documents', label: 'My documents', icon: 'bi bi-folder2-open' },
    { id: 'pay', label: 'My pay', icon: 'bi bi-wallet2' },
    { id: 'growth', label: 'My growth', icon: 'bi bi-graph-up' },
    { id: 'time', label: 'Time off', icon: 'bi bi-calendar2-week' },
    { id: 'requests', label: 'My requests', icon: 'bi bi-inbox' },
    { id: 'assets', label: 'My assets', icon: 'bi bi-laptop' },
    { id: 'access', label: 'Access', icon: 'bi bi-shield-check' },
    { id: 'security', label: 'Security', icon: 'bi bi-shield-lock' },
    { id: 'work', label: 'Work', icon: 'bi bi-box-arrow-right' },
  ];
  tab = 'about';
  confirming = false;
  person: PersonCard | null = null;
  reports = 0;
  error = '';
  busy = false;
  lastDay = '';
  noticeDays = 0;
  reason = '';
  tasks: Array<{ id: string; title: string; done: boolean }> = [];
  exit: { id: string; lastDay: string; status: string } | null = null;
  documents: DocRow[] = [];
  handbook: { title: string; version: string } | null = null;
  pay: PayView | null = null;
  received: BadgeRow[] = [];
  balances: LeaveBalance[] = [];
  requests: RequestRow[] = [];
  mineAssets: AssetRow[] = [];

  punch: PunchState | null = null;
  today = '';
  birthday = '';
  nextHoliday: { day: string; name: string } | null = null;

  get punchLine(): string {
    if (!this.punch) return 'Open attendance';
    if (this.punch.state === 'in') return 'Checked in · ' + this.clock(this.punch.sessionStart || this.punch.firstIn);
    if (this.punch.lastOut) return 'Checked out · ' + this.clock(this.punch.lastOut);
    return 'Not checked in yet';
  }

  get leaveLeft(): number | null {
    const counted = this.balances.filter((item) => item.entitled);
    return counted.length ? counted.reduce((sum, item) => sum + item.left, 0) : null;
  }

  get holiday(): { name: string; when: string } | null {
    if (!this.nextHoliday || !this.today) return null;
    const days = this.gap(this.today, this.nextHoliday.day);
    const date = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(this.nextHoliday.day + 'T00:00:00Z'));
    return { name: this.nextHoliday.name, when: days === 0 ? 'today' : days === 1 ? 'tomorrow' : `${date}, in ${days} days` };
  }

  get milestone(): { icon: string; label: string; when: string; days: number } | null {
    if (!this.person || !this.today) return null;
    const options: Array<{ icon: string; label: string; days: number; years: number; kind: 'birthday' | 'work' }> = [];
    const year = Number(this.today.slice(0, 4));
    const next = (mmdd: string) => {
      const thisYear = `${year}-${mmdd}`;
      return thisYear >= this.today ? thisYear : `${year + 1}-${mmdd}`;
    };
    if (/^\d{2}-\d{2}$/.test(this.birthday)) {
      const day = next(this.birthday);
      options.push({ icon: 'bi-cake2', label: 'Birthday', days: this.gap(this.today, day), years: 0, kind: 'birthday' });
    }
    const joined = this.person.dateOfJoining;
    if (/^\d{4}-\d{2}-\d{2}$/.test(joined)) {
      const day = next(joined.slice(5));
      const years = Number(day.slice(0, 4)) - Number(joined.slice(0, 4));
      if (years > 0) options.push({ icon: 'bi-balloon', label: `${years}-year work anniversary`, days: this.gap(this.today, day), years, kind: 'work' });
    }
    const soonest = options.sort((left, right) => left.days - right.days)[0];
    if (!soonest || soonest.days > 60) return null;
    if (soonest.days === 0) return { icon: soonest.kind === 'birthday' ? 'bi-cake2-fill' : 'bi-stars', label: soonest.label, when: soonest.kind === 'birthday' ? 'Happy birthday!' : 'Happy anniversary!', days: 0 };
    return { icon: soonest.icon, label: soonest.label, when: soonest.days === 1 ? 'Tomorrow' : `In ${soonest.days} days`, days: soonest.days };
  }

  private gap(from: string, to: string): number {
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
  }

  private clock(iso: string): string {
    return iso ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso)) : '';
  }

  get initials(): string {
    const name = this.person?.name || '';
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  }

  async ngOnInit(): Promise<void> {
    try {
      const data = await this.api.get<{ linked: boolean; reports?: number; person?: PersonCard; today?: string; birthday?: string; nextHoliday?: { day: string; name: string } | null }>('/v1/profile');
      this.person = data.linked ? data.person || null : null;
      this.reports = data.reports || 0;
      this.today = data.today || '';
      this.birthday = data.birthday || '';
      this.nextHoliday = data.nextHoliday || null;
      if (!this.person) return;
      const asked = this.route.snapshot.queryParamMap.get('tab') || '';
      if (this.tabs.some((item) => item.id === asked)) this.tab = asked;
      this.api.get<PunchState | null>('/v1/attendance/me').then((state) => (this.punch = state)).catch(() => undefined);
      const id = this.person.id;
      const name = this.person.name;
      const code = this.person.code;
      const [tasks, exits, library, pay, growth, leave, requests, assets] = await Promise.all([
        this.api.get<{ items: Array<{ id: string; title: string; done: boolean }> }>('/v1/onboarding/' + id).catch(() => ({ items: [] })),
        this.api.get<{ mine: { id: string; lastDay: string; status: string } | null; noticeDays?: number; suggestedLastDay?: string }>('/v1/exits').catch(() => ({ mine: null, noticeDays: 0, suggestedLastDay: '' })),
        this.api.get<{ handbook: { title: string; version: string } | null; documents: DocRow[] }>('/v1/library').catch(() => ({ handbook: null, documents: [] })),
        this.api.get<PayView>('/v1/pay').catch(() => null),
        this.api.get<{ feed: BadgeRow[] }>('/v1/recognition?range=all').catch(() => ({ feed: [] })),
        this.api.get<{ balances: LeaveBalance[] }>('/v1/leave').catch(() => ({ balances: [] })),
        this.api.get<{ items: RequestRow[] }>('/v1/requests').catch(() => ({ items: [] })),
        this.api.get<{ items: AssetRow[] }>('/v1/assets').catch(() => ({ items: [] })),
      ]);
      this.tasks = tasks.items;
      this.exit = exits.mine;
      this.noticeDays = exits.noticeDays || 0;
      if (!this.lastDay && exits.suggestedLastDay) this.lastDay = exits.suggestedLastDay;
      this.handbook = library.handbook;
      const mine = library.documents.filter((item) => item.mine);
      this.documents = mine.length ? mine : library.documents;
      this.pay = pay;
      this.received = growth.feed.filter((item) => item.to === name);
      this.balances = leave.balances || [];
      this.requests = (requests.items || []).slice(0, 12);
      this.mineAssets = (assets.items || []).filter((item) => !item.inStock && (item.code === code || item.holder === name));
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load your profile.';
    }
  }

  async pickPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.person) return;
    this.photoBusy = true;
    this.error = '';
    try {
      const saved = await this.api.post<{ photo: string }>('/v1/people/' + this.person.id + '/photo', { data: await squarePhoto(file) });
      this.person = { ...this.person, photo: saved.photo };
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not upload that photo.';
    } finally {
      this.photoBusy = false;
    }
  }

  async openFile(path: string, title = 'Document', subtitle = ''): Promise<void> {
    try {
      const blob = await this.api.blob(path);
      await this.sweet.preview({ title, subtitle, blob });
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not open that file.';
    }
  }

  async resign(): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      this.exit = await this.api.post<{ id: string; lastDay: string; status: string }>('/v1/exits', { lastDay: this.lastDay, reason: this.reason });
      this.reason = '';
      this.confirming = false;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not send the resignation.';
    } finally {
      this.busy = false;
    }
  }

  async cancelExit(): Promise<void> {
    if (!this.exit) return;
    const yes = await this.sweet.confirm({
      title: 'Take back your resignation?',
      text: 'Your employment continues as usual. You can resign again later if you need to.',
      confirmText: 'Take it back',
      danger: true,
    });
    if (!yes) return;
    this.error = '';
    try {
      await this.api.post('/v1/exits/' + this.exit.id + '/cancel', {});
      this.exit = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not cancel that.';
    }
  }
}
