import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { DataColumn, DataTableComponent } from '../shared/data-table.component';
import { Sweet } from '../shared/sweet';

interface JobRow {
  id: string;
  code: string;
  title: string;
  department: string;
  location: string;
  status: string;
  portalLabel: string;
  applications: number;
  fresh: number;
}

interface PortalRow {
  id: string;
  label: string;
  blurb: string;
  enabled: boolean;
}

interface PortalDesk {
  feedToken: string;
  feedPath: string;
  xmlPath: string;
  webhookPath: string;
  portals: PortalRow[];
}

type HiringTab = 'jobs' | 'portals';

@Component({
  selector: 'app-hiring',
  imports: [RouterLink, FormsModule, DataTableComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-briefcase"></i></span>
        <p class="eyebrow">HR</p>
        <h1>Hiring</h1>
      </div>
      <div class="actions">
        <a class="btn btn-ghost" routerLink="/vendors"><i class="bi bi-building"></i> Vendors</a>
        <a class="btn btn-ghost" routerLink="/hiring/applications"><i class="bi bi-inboxes"></i> Applications</a>
        <a class="btn btn-primary" routerLink="/hiring/new"><i class="bi bi-plus-lg"></i> New job</a>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }

    <div class="seg-tabs page-tabs" role="tablist" aria-label="Hiring sections">
      <button type="button" role="tab" [attr.aria-selected]="tab === 'jobs'" [class.is-on]="tab === 'jobs'" (click)="setTab('jobs')">
        <i class="bi bi-briefcase"></i> Jobs
        @if (jobs.length) { <span class="chip">{{ jobs.length }}</span> }
      </button>
      <button type="button" role="tab" [attr.aria-selected]="tab === 'portals'" [class.is-on]="tab === 'portals'" (click)="setTab('portals')">
        <i class="bi bi-globe2"></i> Portals
        @if (desk) { <span class="chip">{{ desk.portals.length }}</span> }
      </button>
    </div>

    @if (tab === 'jobs') {
      <app-data-table tableId="hiring-jobs" title="Openings" hint="Open a job and tick the portals it should appear on. Applications from those portals land with HR." empty="No jobs yet. Create one, then open it." [rows]="jobs" [columns]="columns" [loading]="loading" />
    }

    @if (tab === 'portals' && desk) {
      <section class="card portal-board">
        <h2><i class="bi bi-globe2"></i> Job portals</h2>
        <p class="muted">Altamid gives each open job an apply address and puts ticked jobs on a feed the portal can read. Paste the address into Naukri, LinkedIn, Indeed, and the others. When a candidate applies, or the portal calls the webhook, the application arrives in Hiring.</p>
        <label for="feed-url">Job feed</label>
        <div class="copy-row">
          <input id="feed-url" [value]="absolute(desk.feedPath)" readonly>
          <button type="button" class="btn btn-ghost" (click)="copy(absolute(desk.feedPath))">Copy</button>
        </div>
        <label for="xml-url">XML feed</label>
        <div class="copy-row">
          <input id="xml-url" [value]="absolute(desk.xmlPath)" readonly>
          <button type="button" class="btn btn-ghost" (click)="copy(absolute(desk.xmlPath))">Copy</button>
        </div>
        <p class="muted">Add <span class="mono">?portal=naukri</span> (or linkedin, indeed, shine, foundit, apna, internshala, hirist, cutshort) so the feed lists only jobs posted to that portal, and the apply address is tagged with it.</p>
        <div class="portal-grid">
          @for (portal of desk.portals; track portal.id) {
            <article class="portal-card">
              <label class="check">
                <input type="checkbox" [(ngModel)]="portal.enabled" [name]="'portal-' + portal.id">
                <strong>{{ portal.label }}</strong>
              </label>
              <p>{{ portal.blurb }}</p>
              <p class="mono">{{ absolute(desk.webhookPath + '/' + portal.id) }}</p>
              <button type="button" class="btn btn-ghost btn-sm" (click)="check(portal)" [disabled]="busy || !portal.enabled">Send a check application</button>
            </article>
          }
        </div>
        <div class="actions portal-actions">
          <button type="button" class="btn btn-primary" (click)="save()" [disabled]="busy">Save portals</button>
          <button type="button" class="btn btn-ghost" (click)="rotate()" [disabled]="busy">Replace the feed address</button>
        </div>
      </section>
    } @else if (tab === 'portals') {
      <section class="card"><p class="muted">Portal settings could not be loaded.</p></section>
    }
  `,
})
export class HiringComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly tabKey = 'altamid.hiring.tab';
  tab: HiringTab = 'jobs';
  jobs: JobRow[] = [];
  desk: PortalDesk | null = null;
  error = '';
  ok = '';
  loading = true;
  busy = false;
  readonly columns: DataColumn<JobRow>[] = [
    { key: 'title', label: 'Job', text: (row) => row.title, sub: (row) => row.department || row.code, link: (row) => '/hiring/' + row.id },
    { key: 'code', label: 'Code', text: (row) => row.code },
    { key: 'location', label: 'Location', text: (row) => row.location || '—' },
    { key: 'status', label: 'Status', text: (row) => row.status, pill: true },
    { key: 'portals', label: 'Portals', text: (row) => row.portalLabel },
    { key: 'applications', label: 'Applications', text: (row) => String(row.applications), sub: (row) => row.fresh ? row.fresh + ' new' : '' },
  ];

  setTab(tab: HiringTab): void {
    this.tab = tab;
    try { sessionStorage.setItem(this.tabKey, tab); } catch { /* ignore */ }
  }

  async ngOnInit(): Promise<void> {
    try {
      const saved = sessionStorage.getItem(this.tabKey) as HiringTab | null;
      if (saved && ['jobs', 'portals'].includes(saved)) this.tab = saved;
    } catch { /* ignore */ }
    await this.load();
  }

  absolute(path: string): string {
    return location.origin + path;
  }

  async copy(value: string): Promise<void> {
    this.error = '';
    try {
      await navigator.clipboard.writeText(value);
      this.ok = 'Copied.';
    } catch {
      this.error = 'Could not copy that address.';
    }
  }

  async save(): Promise<void> {
    if (!this.desk) return;
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const body: Record<string, boolean> = {};
      for (const portal of this.desk.portals) body[portal.id] = portal.enabled;
      this.desk = { ...this.desk, ...(await this.api.post<PortalDesk>('/v1/hiring/portals', body)) };
      this.ok = 'Portal choices saved.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save the portals.';
    } finally {
      this.busy = false;
    }
  }

  async rotate(): Promise<void> {
    if (!this.desk) return;
    const go = await this.sweet.confirm({
      title: 'Replace the feed address?',
      text: 'Portals using the old one will stop receiving jobs until you paste the new address.',
      confirmText: 'Replace',
      danger: true,
    });
    if (!go) return;
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      this.desk = { ...this.desk, ...(await this.api.post<PortalDesk>('/v1/hiring/portals/rotate', {})) };
      this.ok = 'The feed address has been replaced. Paste the new one into each portal.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not replace the feed address.';
    } finally {
      this.busy = false;
    }
  }

  async check(portal: PortalRow): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      await this.api.post('/v1/hiring/portals/' + portal.id + '/check', {});
      this.ok = 'A check application from ' + portal.label + ' is in the applications list.';
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not send the check.';
    } finally {
      this.busy = false;
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const data = await this.api.get<{ jobs: JobRow[]; portals: PortalDesk }>('/v1/hiring');
      this.jobs = data.jobs;
      this.desk = data.portals;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load hiring.';
    } finally {
      this.loading = false;
    }
  }
}
