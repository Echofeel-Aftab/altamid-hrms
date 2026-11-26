import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { DataColumn, DataTableComponent, RowActionsDirective } from '../shared/data-table.component';
import { ListingFilterItem, ListingFiltersComponent } from '../shared/listing-filters.component';
import { ModalComponent } from '../shared/modal.component';
import { Sweet } from '../shared/sweet';

interface ApplicationRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  resumeUrl: string;
  portal: string;
  status: string;
  note: string;
  message: string;
  jobTitle: string;
  jobCode: string;
  openingId: string;
  coolingUntil: string;
  score: number | null;
  repeat: { times: number; rejected: number; employee: string; sameName: number };
  createdAt: string;
}

export interface HiringRules {
  rejectDays: number;
  exitDays: number;
  tellApplicant: boolean;
  message: string;
  emailAuto: boolean;
  mailbox: boolean;
}

export const APPLICATION_STATUSES = [
  { key: 'new', label: 'New' },
  { key: 'cooling', label: 'Cooling period' },
  { key: 'reviewing', label: 'Reviewing' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'interview', label: 'Interview' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'hired', label: 'Hired' },
];

export function scoreLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return 'Not scored';
  return (score >= 70 ? 'Strong' : score >= 45 ? 'Fair' : 'Low') + ' · ' + score + '%';
}

@Component({
  selector: 'app-applications',
  imports: [RouterLink, FormsModule, DataTableComponent, RowActionsDirective, ModalComponent, ListingFiltersComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-inboxes"></i></span>
        <p class="eyebrow">HR</p>
        <h1>Applications</h1>
        <p class="muted">From the website, website forms that named an open job, and the job portals.</p>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-ghost" (click)="openRules()"><i class="bi bi-hourglass-split"></i> Reapply rules</button>
        <a class="btn btn-ghost" routerLink="/hiring"><i class="bi bi-briefcase"></i> Jobs</a>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }

    <div class="appl-stats">
      @for (tile of tiles(); track tile.key) {
        <button type="button" class="card bento-stat appl-stat" [class.is-on]="statusFilter === tile.key" (click)="pickStatusTile(tile.key)">
          <span class="bento-ico" [class]="'bento-ico ' + tile.tone"><i class="bi" [class]="tile.icon"></i></span>
          <span class="muted">{{ tile.label }}</span>
          <strong>{{ tile.count }}</strong>
        </button>
      }
    </div>

    <app-data-table tableId="hiring-applications" title="Received" empty="No applications match." [rows]="filtered()" [columns]="columns" [loading]="loading">
      <div tableFilter>
        <app-listing-filters
          storageKey="hiring-applications"
          [catalog]="filterCatalog"
          [values]="filterValues"
          (valuesChange)="onFilters($event)" />
      </div>
      <ng-template appRowActions let-item>
        <a class="btn btn-sm" [routerLink]="['/hiring/applications', item.id]"><i class="bi bi-person-vcard"></i> Details</a>
      </ng-template>
    </app-data-table>

    <app-modal [open]="rulesOpen" size="md" icon="bi-hourglass-split" title="Reapply rules" subtitle="A gap before someone can apply again" (closed)="rulesOpen = false">
      @if (rules) {
        <form id="rules-form" class="rules-form" (ngSubmit)="saveRules()">
          <div class="form-cols">
            <div>
              <label for="r-reject">After a rejection</label>
              <div class="input-unit"><input id="r-reject" name="rejectDays" type="number" min="0" max="1095" [(ngModel)]="rules.rejectDays"><span>days</span></div>
            </div>
            <div>
              <label for="r-exit">After someone leaves</label>
              <div class="input-unit"><input id="r-exit" name="exitDays" type="number" min="0" max="1095" [(ngModel)]="rules.exitDays"><span>days</span></div>
            </div>
          </div>
          <p class="muted rules-hint">0 means no gap. People are matched on email or mobile number. A phone number shared by three or more people, such as an office line, is not used.</p>
          <label class="check"><input type="checkbox" name="tell" [(ngModel)]="rules.tellApplicant"> Show the applicant a reply on the form</label>
          <label for="r-message">Reply to the applicant</label>
          <textarea id="r-message" name="message" rows="4" maxlength="600" [(ngModel)]="rules.message"></textarea>
          <p class="muted rules-hint">Use {{ '{{' }}date{{ '}}' }} for the day they can apply again. {{ '{{' }}name{{ '}}' }} and {{ '{{' }}job{{ '}}' }} also work.</p>
          <div class="rules-mail" [class.is-on]="rules.emailAuto && rules.mailbox">
            <i class="bi" [class]="rules.emailAuto && rules.mailbox ? 'bi-envelope-check' : 'bi-envelope-slash'"></i>
            <div>
              <strong>{{ rules.emailAuto && rules.mailbox ? 'The reply is also emailed' : 'The reply is not emailed' }}</strong>
              <small class="muted">
                @if (!rules.mailbox) { Add a mailbox in Settings → Email first. }
                @if (rules.mailbox && !rules.emailAuto) { Turn on automatic sending for "Cooling period reply" in Settings → Templates. }
                @if (rules.mailbox && rules.emailAuto) { It uses the "Cooling period reply" template in Settings → Templates. }
              </small>
            </div>
          </div>
          <p class="muted rules-hint">The application is still kept, marked Cooling period, so it shows in the person's history.</p>
        </form>
      }
      <footer modalFooter class="md-foot">
        <button type="button" class="btn btn-ghost" (click)="rulesOpen = false">Cancel</button>
        <button type="submit" form="rules-form" class="btn btn-primary" [disabled]="savingRules || !rules"><i class="bi bi-check2"></i> {{ savingRules ? 'Saving…' : 'Save rules' }}</button>
      </footer>
    </app-modal>
  `,
})
export class ApplicationsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  readonly statuses = APPLICATION_STATUSES;
  rows: ApplicationRow[] = [];
  error = '';
  loading = true;
  statusFilter = '';
  jobFilter = '';
  sourceFilter = '';
  filterValues: Record<string, string> = { status: '', job: '', source: '' };

  get filterCatalog(): ListingFilterItem[] {
    return [
      {
        key: 'status',
        label: 'Status',
        allLabel: 'Every status',
        options: [
          { value: 'repeat', label: 'Repeat applicants' },
          ...this.statuses.map((status) => ({ value: status.key, label: status.label })),
        ],
      },
      {
        key: 'job',
        label: 'Jobs',
        allLabel: 'Every job',
        options: this.jobs().map((job) => ({ value: job.key, label: job.label })),
      },
      {
        key: 'source',
        label: 'Sources',
        allLabel: 'Every source',
        options: this.sources().map((source) => ({ value: source, label: source })),
      },
    ];
  }

  onFilters(values: Record<string, string>): void {
    this.filterValues = values;
    this.statusFilter = values['status'] || '';
    this.jobFilter = values['job'] || '';
    this.sourceFilter = values['source'] || '';
  }

  pickStatusTile(key: string): void {
    const status = this.statusFilter === key ? '' : key;
    this.onFilters({ ...this.filterValues, status });
  }
  rulesOpen = false;
  rules: HiringRules | null = null;
  savingRules = false;

  readonly columns: DataColumn<ApplicationRow>[] = [
    { key: 'name', label: 'Candidate', text: (row) => row.name, sub: (row) => row.email, link: (row) => '/hiring/applications/' + row.id },
    { key: 'job', label: 'Job', text: (row) => row.jobTitle || 'General form', sub: (row) => row.jobCode, link: (row) => row.openingId ? '/hiring/' + row.openingId : '' },
    { key: 'match', label: 'Match', text: (row) => scoreLabel(row.score), pill: true },
    { key: 'repeat', label: 'Seen before', text: (row) => this.repeatLabel(row), pill: true },
    { key: 'status', label: 'Status', text: (row) => this.statusLabel(row.status), pill: true },
    { key: 'portal', label: 'Source', text: (row) => row.portal },
    { key: 'received', label: 'Received', text: (row) => this.received(row) },
    { key: 'note', label: 'HR note', text: (row) => row.note || '—', optional: true },
    { key: 'phone', label: 'Phone', text: (row) => row.phone || '—', optional: true },
    { key: 'city', label: 'City', text: (row) => row.city || '—', optional: true },
    { key: 'message', label: 'Message', text: (row) => row.message ? (row.message.length > 60 ? row.message.slice(0, 60) + '…' : row.message) : '—', optional: true },
    { key: 'resume', label: 'Resume', text: (row) => /^https?:\/\//i.test(row.resumeUrl || '') ? 'Attached' : '—', optional: true },
  ];

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  filtered(): ApplicationRow[] {
    return this.rows.filter((row) =>
      (!this.statusFilter || (this.statusFilter === 'repeat' ? this.isRepeat(row) : row.status === this.statusFilter))
      && (!this.jobFilter || (row.openingId || 'general') === this.jobFilter)
      && (!this.sourceFilter || row.portal === this.sourceFilter));
  }

  tiles(): { key: string; label: string; icon: string; tone: string; count: number }[] {
    const count = (key: string) => this.rows.filter((row) => row.status === key).length;
    const tiles = [
      { key: '', label: 'All applications', icon: 'bi-inboxes', tone: '', count: this.rows.length },
      { key: 'new', label: 'New', icon: 'bi-envelope-open', tone: 'is-gold', count: count('new') },
      { key: 'repeat', label: 'Repeat applicants', icon: 'bi-arrow-repeat', tone: '', count: this.rows.filter((row) => this.isRepeat(row)).length },
      { key: 'shortlisted', label: 'Shortlisted', icon: 'bi-star', tone: '', count: count('shortlisted') },
      { key: 'interview', label: 'Interview', icon: 'bi-people', tone: '', count: count('interview') },
      { key: 'hired', label: 'Hired', icon: 'bi-person-check', tone: '', count: count('hired') },
    ];
    const cooling = count('cooling');
    if (cooling) tiles.splice(2, 0, { key: 'cooling', label: 'Cooling period', icon: 'bi-hourglass-split', tone: '', count: cooling });
    return tiles;
  }

  jobs(): { key: string; label: string }[] {
    const seen = new Map<string, string>();
    for (const row of this.rows) seen.set(row.openingId || 'general', row.openingId ? row.jobTitle + (row.jobCode ? ' · ' + row.jobCode : '') : 'General form');
    return [...seen].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
  }

  sources(): string[] {
    return [...new Set(this.rows.map((row) => row.portal).filter(Boolean))].sort();
  }

  isRepeat(row: ApplicationRow): boolean {
    return row.repeat.times > 0 || Boolean(row.repeat.employee);
  }

  repeatLabel(row: ApplicationRow): string {
    if (row.repeat.rejected) return 'Rejected before';
    if (row.repeat.employee === 'former') return 'Former employee';
    if (row.repeat.employee === 'current') return 'Works here';
    if (row.repeat.times) return 'Repeat · ' + (row.repeat.times + 1) + ' applications';
    if (row.repeat.sameName) return 'Same name only';
    return '—';
  }

  async openRules(): Promise<void> {
    this.error = '';
    try {
      this.rules = await this.api.get<HiringRules>('/v1/hiring/rules');
      this.rulesOpen = true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load the rules.';
    }
  }

  async saveRules(): Promise<void> {
    if (!this.rules) return;
    this.savingRules = true;
    try {
      this.rules = await this.api.post<HiringRules>('/v1/hiring/rules', {
        rejectDays: Number(this.rules.rejectDays) || 0,
        exitDays: Number(this.rules.exitDays) || 0,
        tellApplicant: this.rules.tellApplicant,
        message: this.rules.message,
      });
      this.rulesOpen = false;
      const on = this.rules.rejectDays || this.rules.exitDays;
      this.sweet.success({
        title: 'Rules saved',
        text: on ? 'New applications inside the gap are marked Cooling period.' : 'There is no gap now. Everyone can apply again at any time.',
        rows: [
          { label: 'After a rejection', value: this.rules.rejectDays ? this.rules.rejectDays + ' days' : 'No gap' },
          { label: 'After someone leaves', value: this.rules.exitDays ? this.rules.exitDays + ' days' : 'No gap' },
        ],
      });
    } catch (error) {
      this.sweet.error({ title: 'Rules not saved', text: error instanceof Error ? error.message : 'Try again.' });
    } finally {
      this.savingRules = false;
    }
  }

  statusLabel(key: string): string {
    return APPLICATION_STATUSES.find((item) => item.key === key)?.label || key;
  }

  received(row: ApplicationRow): string {
    return new Date(row.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.rows = await this.api.get<ApplicationRow[]>('/v1/hiring/applications');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load applications.';
    } finally {
      this.loading = false;
    }
  }
}
