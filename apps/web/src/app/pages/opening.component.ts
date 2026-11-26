import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { SessionStore } from '../core/session.store';
import { RichEditorComponent } from '../shared/rich-editor.component';
import { Sweet } from '../shared/sweet';

interface PortalChoice {
  id: string;
  label: string;
}

interface ApplicationRow {
  id: string;
  name: string;
  email: string;
  portal: string;
  status: string;
  createdAt: string;
}

interface Opening {
  id: string;
  code: string;
  title: string;
  department: string;
  location: string;
  workplace: string;
  employment: string;
  seats: number;
  description: string;
  requirements: string;
  salaryNote: string;
  status: string;
  portals: string[];
  internal: boolean;
  referral: boolean;
  agencyId: string;
  applyPath: string;
  applications: number;
  recent: ApplicationRow[];
}

type OpeningTab = 'details' | 'portals' | 'applications';

const PORTALS: PortalChoice[] = [
  { id: 'naukri', label: 'Naukri' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'indeed', label: 'Indeed' },
  { id: 'shine', label: 'Shine' },
  { id: 'foundit', label: 'Foundit' },
  { id: 'apna', label: 'Apna' },
  { id: 'internshala', label: 'Internshala' },
  { id: 'hirist', label: 'Hirist' },
  { id: 'cutshort', label: 'Cutshort' },
];

@Component({
  selector: 'app-opening',
  imports: [FormsModule, RouterLink, RichEditorComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-briefcase"></i></span>
        <p class="eyebrow">Hiring</p>
        <h1>{{ job?.code || 'New job' }}</h1>
      </div>
      <a class="btn btn-ghost" routerLink="/hiring"><i class="bi bi-arrow-left"></i> All jobs</a>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }

    <div class="seg-tabs page-tabs" role="tablist" aria-label="Job sections">
      <button type="button" role="tab" [attr.aria-selected]="tab === 'details'" [class.is-on]="tab === 'details'" (click)="setTab('details')">
        <i class="bi bi-briefcase"></i> Details
      </button>
      @if (job) {
        <button type="button" role="tab" [attr.aria-selected]="tab === 'portals'" [class.is-on]="tab === 'portals'" (click)="setTab('portals')">
          <i class="bi bi-globe2"></i> Portals
          @if (chosen.size) { <span class="chip">{{ chosen.size }}</span> }
        </button>
        <button type="button" role="tab" [attr.aria-selected]="tab === 'applications'" [class.is-on]="tab === 'applications'" (click)="setTab('applications')">
          <i class="bi bi-people"></i> Applications
          @if (job.applications) { <span class="chip">{{ job.applications }}</span> }
        </button>
      }
    </div>

    @if (tab === 'details') {
    <form class="card" (ngSubmit)="save(job?.status || 'draft')">
      <h2><i class="bi bi-briefcase"></i> The job</h2>
      <div class="split">
        <div>
          <label for="job-title">Job title</label>
          <input id="job-title" name="title" [(ngModel)]="title" maxlength="120" required>
        </div>
        <div>
          <label for="job-seats">Openings</label>
          <input id="job-seats" name="seats" type="number" min="1" max="50" [(ngModel)]="seats">
        </div>
      </div>
      <div class="split">
        <div>
          <label for="job-department">Department</label>
          <input id="job-department" name="department" [(ngModel)]="department" maxlength="80">
        </div>
        <div>
          <label for="job-location">Location</label>
          <input id="job-location" name="location" [(ngModel)]="location" maxlength="80" placeholder="Kochi, or Remote">
        </div>
      </div>
      <div class="split">
        <div>
          <label for="job-workplace">Workplace</label>
          <select id="job-workplace" name="workplace" [(ngModel)]="workplace">
            <option value="office">Office</option>
            <option value="hybrid">Hybrid</option>
            <option value="remote">Remote</option>
          </select>
        </div>
        <div>
          <label for="job-employment">Employment</label>
          <select id="job-employment" name="employment" [(ngModel)]="employment">
            <option value="full-time">Full-time</option>
            <option value="part-time">Part-time</option>
            <option value="contract">Contract</option>
            <option value="intern">Intern</option>
          </select>
        </div>
      </div>
      @if (agencies.length) {
        <label for="job-agency">Hiring through agency</label>
        <select id="job-agency" name="agency" [(ngModel)]="agencyId">
          <option value="">No agency</option>
          @for (item of agencies; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
        </select>
      }
      <label for="job-description">Description</label>
      <app-rich-editor inputId="job-description" name="description" label="Description" placeholder="What the role is, the team, and a typical week." [max]="8000" [minHeight]="180" [(ngModel)]="description" />
      <label for="job-requirements">Requirements</label>
      <app-rich-editor inputId="job-requirements" name="requirements" label="Requirements" placeholder="Skills, experience, and must-haves. A bullet list works well." [max]="4000" [(ngModel)]="requirements" />
      <label for="job-salary">What candidates should know about pay</label>
      <input id="job-salary" name="salaryNote" [(ngModel)]="salaryNote" maxlength="160" placeholder="Optional. Leave blank if you do not want it on the listing.">
      <label class="check"><input type="checkbox" name="internal" [(ngModel)]="internal"> Employees can apply</label>
      <label class="check"><input type="checkbox" name="referral" [(ngModel)]="referral"> Employees can refer someone</label>
      <div class="actions">
        <button class="btn btn-ghost" type="submit" [disabled]="busy">Save</button>
        <button class="btn btn-primary" type="button" (click)="save('open')" [disabled]="busy">Open this job</button>
        @if (job?.status === 'open') {
          <button class="btn btn-ghost" type="button" (click)="save('closed')" [disabled]="busy">Close applications</button>
        }
        @if (job?.status === 'draft') {
          <button class="btn btn-ghost" type="button" (click)="remove()" [disabled]="busy">Delete draft</button>
        }
      </div>
    </form>
    }

    @if (tab === 'portals' && job) {
      <section class="card">
        <h2><i class="bi bi-globe2"></i> Where this job is posted</h2>
        <p class="muted">The company website takes applications whenever the job is open. Tick a portal to include the job on that portal's feed and to give you an apply address tagged for it.</p>
        <p>Status: <span class="pill">{{ job.status }}</span></p>
        <article class="portal-card">
          <strong>Company website</strong>
          <p>Candidates can apply here while the job is open.</p>
          @if (job.status === 'open') {
            <div class="copy-row">
              <input [value]="absolute(job.applyPath + '?from=website')" readonly aria-label="Website apply address">
              <button type="button" class="btn btn-ghost" (click)="copy(absolute(job.applyPath + '?from=website'))">Copy</button>
            </div>
          } @else {
            <p class="muted">Open the job to make the apply address live.</p>
          }
        </article>
        <div class="portal-grid">
          @for (portal of portals; track portal.id) {
            <article class="portal-card">
              <label class="check">
                <input type="checkbox" [checked]="chosen.has(portal.id)" (change)="toggle(portal.id, $any($event.target).checked)">
                <strong>{{ portal.label }}</strong>
              </label>
              @if (chosen.has(portal.id) && job.status === 'open') {
                <div class="copy-row">
                  <input [value]="absolute(job.applyPath + '?from=' + portal.id)" readonly [attr.aria-label]="portal.label + ' apply address'">
                  <button type="button" class="btn btn-ghost" (click)="copy(absolute(job.applyPath + '?from=' + portal.id))">Copy</button>
                </div>
              } @else if (chosen.has(portal.id)) {
                <p class="muted">Included when you save. Open the job before you paste the address.</p>
              } @else {
                <p class="muted">Not posted here.</p>
              }
            </article>
          }
        </div>
      </section>
    }

    @if (tab === 'applications' && job) {
      <section class="card">
        <h2><i class="bi bi-people"></i> Applications for this job</h2>
        @if (!job.recent.length) {
          <p class="muted">None yet. They show up here after someone applies, or after a portal sends one.</p>
        } @else {
          <ul class="plain-list">
            @for (row of job.recent; track row.id) {
              <li><a [routerLink]="'/hiring/applications/' + row.id"><strong>{{ row.name }}</strong></a> · {{ row.portal }} · {{ row.status }} <span class="muted">{{ when(row.createdAt) }}</span></li>
            }
          </ul>
          <a routerLink="/hiring/applications">Open the full list</a>
        }
      </section>
    }
  `,
})
export class OpeningComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject(SessionStore);
  private readonly tabKey = 'altamid.opening.tab';
  tab: OpeningTab = 'details';
  readonly portals = PORTALS;
  job: Opening | null = null;
  title = '';
  department = '';
  location = '';
  workplace = 'office';
  employment = 'full-time';
  seats = 1;
  description = '';
  requirements = '';
  salaryNote = '';
  internal = false;
  referral = false;
  agencyId = '';
  agencies: Array<{ id: string; name: string }> = [];
  chosen = new Set<string>();
  error = '';
  ok = '';
  busy = false;

  setTab(tab: OpeningTab): void {
    this.tab = tab;
    try { sessionStorage.setItem(this.tabKey, tab); } catch { /* ignore */ }
  }

  async ngOnInit(): Promise<void> {
    try {
      const saved = sessionStorage.getItem(this.tabKey) as OpeningTab | null;
      if (saved && ['details', 'portals', 'applications'].includes(saved)) this.tab = saved;
    } catch { /* ignore */ }
    try {
      const desk = await this.api.get<{ hireViaAgencies: boolean; vendors: Array<{ id: string; name: string; hireThrough: boolean }> }>('/v1/vendors');
      this.agencies = desk.hireViaAgencies ? desk.vendors.filter((item) => item.hireThrough) : [];
    } catch {
      this.agencies = [];
    }
    const id = this.route.snapshot.paramMap.get('id') || '';
    if (!id || id === 'new') {
      this.department = this.store.me?.workplace?.department || '';
      this.location = this.store.me?.workplace?.location || this.store.me?.company.city || '';
      if (this.tab !== 'details') this.setTab('details');
      return;
    }
    await this.load(id);
  }

  toggle(id: string, on: boolean): void {
    if (on) this.chosen.add(id);
    else this.chosen.delete(id);
    this.chosen = new Set(this.chosen);
  }

  absolute(path: string): string {
    return location.origin + path;
  }

  when(value: string): string {
    return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  }

  async copy(value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.ok = 'Copied the apply address.';
      this.error = '';
    } catch {
      this.error = 'Could not copy that address.';
    }
  }

  async save(status: string): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    const body = {
      title: this.title,
      department: this.department,
      location: this.location,
      workplace: this.workplace,
      employment: this.employment,
      seats: Number(this.seats),
      description: this.description,
      requirements: this.requirements,
      salaryNote: this.salaryNote,
      portals: [...this.chosen],
      internal: this.internal,
      referral: this.referral,
      agencyId: this.agencyId,
      status,
    };
    try {
      let saved = this.job
        ? await this.api.patch<Opening>('/v1/hiring/' + this.job.id, body)
        : await this.api.post<Opening>('/v1/hiring', body);
      if (!this.job && status !== 'draft') saved = await this.api.patch<Opening>('/v1/hiring/' + saved.id, body);
      if (!this.job) await this.router.navigateByUrl('/hiring/' + saved.id);
      await this.load(saved.id);
      this.ok = status === 'open' ? 'This job is open. Applications can land from the website and the portals you ticked.' : status === 'closed' ? 'Applications are closed. The ones already in are still here.' : 'Draft saved.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save this job.';
    } finally {
      this.busy = false;
    }
  }

  async remove(): Promise<void> {
    if (!this.job) return;
    const go = await this.sweet.confirm({
      title: 'Delete this draft?',
      text: 'This job draft is removed and cannot be restored.',
      confirmText: 'Delete',
      danger: true,
    });
    if (!go) return;
    this.busy = true;
    this.error = '';
    try {
      await this.api.post('/v1/hiring/' + this.job.id + '/delete', {});
      await this.router.navigateByUrl('/hiring');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not delete this draft.';
      this.busy = false;
    }
  }

  private async load(id: string): Promise<void> {
    const job = await this.api.get<Opening>('/v1/hiring/' + id);
    this.job = job;
    this.title = job.title;
    this.department = job.department;
    this.location = job.location;
    this.workplace = job.workplace;
    this.employment = job.employment;
    this.seats = job.seats;
    this.description = job.description;
    this.requirements = job.requirements;
    this.salaryNote = job.salaryNote;
    this.internal = job.internal;
    this.referral = job.referral;
    this.agencyId = job.agencyId || '';
    this.chosen = new Set(job.portals);
  }
}
