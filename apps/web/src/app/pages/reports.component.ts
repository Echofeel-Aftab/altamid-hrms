import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../core/api.service';
import { SessionStore } from '../core/session.store';
import { DataColumn, DataTableComponent } from '../shared/data-table.component';

type Period = 'none' | 'month' | 'range' | 'year';
type ColumnType = 'text' | 'number' | 'money' | 'date' | 'status' | 'percent';
type Cell = string | number | null;
type Row = Record<string, Cell>;

interface ReportItem {
  key: string;
  group: string;
  title: string;
  blurb: string;
  icon: string;
  period: Period;
  people: boolean;
  statuses: Array<{ key: string; label: string }>;
}

interface Catalog {
  today: string;
  reports: ReportItem[];
  departments: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  payMonths: string[];
}

interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  total?: boolean;
}

interface ReportResult {
  key: string;
  title: string;
  group: string;
  period: string;
  scope: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: Row[];
  truncated: boolean;
  totals: Record<string, number> | null;
  summary: Array<{ label: string; value: string }>;
  note: string;
}

const GROUP_ICON: Record<string, string> = {
  People: 'bi-people',
  Attendance: 'bi-clock-history',
  Leave: 'bi-calendar2-week',
  Payroll: 'bi-wallet2',
  Hiring: 'bi-briefcase',
  Assets: 'bi-laptop',
  Company: 'bi-building',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function rupees(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function prettyDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match ? `${Number(match[3])} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : value;
}

function shown(value: Cell, type: ColumnType): string {
  if (value === null || value === undefined || value === '') return type === 'money' || type === 'number' || type === 'percent' ? '' : '—';
  if (typeof value === 'number') {
    if (type === 'money') return rupees(value);
    if (type === 'percent') return value.toLocaleString('en-IN', { maximumFractionDigits: 1 }) + '%';
    return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  return type === 'date' ? prettyDate(value) : value;
}

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
}

@Component({
  selector: 'app-reports',
  imports: [FormsModule, DataTableComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-bar-chart-line"></i></span>
        <p class="eyebrow">Company</p>
        <h1>Reports</h1>
        <p class="muted">Employee, attendance, leave, payroll and hiring reports from your live records. Export to Excel or save as PDF.</p>
      </div>
    </div>
    @if (!canOpen) {
      <section class="card"><h2><i class="bi bi-bar-chart-line"></i> Reports</h2><p class="muted">Reports are turned off for your role.</p></section>
    } @else {
    @if (error) { <p class="form-error">{{ error }}</p> }

    @if (!catalog && !error) { <p class="muted">Loading reports…</p> }

    @if (catalog && !chosen) {
      <div class="rp-toolbar">
        <label class="rp-search">
          <i class="bi bi-search" aria-hidden="true"></i>
          <input type="search" [(ngModel)]="search" placeholder="Search reports, for example salary, late, PAN" aria-label="Search reports" />
        </label>
        <div class="rp-chips" role="group" aria-label="Area">
          <button type="button" class="rp-chip" [class.is-on]="!group" (click)="group = ''">All <span>{{ catalog.reports.length }}</span></button>
          @for (item of groups(); track item.name) {
            <button type="button" class="rp-chip" [class.is-on]="group === item.name" (click)="group = group === item.name ? '' : item.name">
              <i class="bi" [class]="'bi ' + item.icon"></i> {{ item.name }} <span>{{ item.count }}</span>
            </button>
          }
        </div>
      </div>
      @for (section of sections(); track section.name) {
        <section class="rp-section">
          <h2 class="rp-section-title"><i class="bi" [class]="'bi ' + section.icon"></i> {{ section.name }}</h2>
          <div class="rp-grid">
            @for (report of section.reports; track report.key) {
              <button type="button" class="card rp-card" (click)="open(report.key)">
                <span class="rp-card-ico" aria-hidden="true"><i class="bi" [class]="'bi ' + report.icon"></i></span>
                <span class="rp-card-text">
                  <strong>{{ report.title }}</strong>
                  <small>{{ report.blurb }}</small>
                </span>
                <i class="bi bi-chevron-right rp-card-go" aria-hidden="true"></i>
              </button>
            }
          </div>
        </section>
      } @empty {
        <div class="card empty-state"><p class="muted">No report matches “{{ search }}”.</p></div>
      }
    }

    @if (catalog && chosen) {
      <button type="button" class="btn btn-ghost back-link" (click)="close()"><i class="bi bi-arrow-left"></i> All reports</button>
      <section class="card rp-filter">
        <div class="rp-filter-head">
          <span class="rp-card-ico" aria-hidden="true"><i class="bi" [class]="'bi ' + chosen.icon"></i></span>
          <div>
            <p class="eyebrow">{{ chosen.group }}</p>
            <h2>{{ chosen.title }}</h2>
            <p class="muted">{{ chosen.blurb }}</p>
          </div>
        </div>
        <div class="rp-fields">
          @if (chosen.period === 'month') {
            <label class="field">
              <span>Month</span>
              <input type="month" [(ngModel)]="month" [max]="catalog.today.slice(0, 7)" />
            </label>
            @if (chosen.group === 'Payroll' && catalog.payMonths.length) {
              <div class="rp-quick" role="group" aria-label="Months with slips">
                @for (item of catalog.payMonths.slice(0, 4); track item) {
                  <button type="button" class="rp-chip" [class.is-on]="month === item" (click)="month = item">{{ monthName(item) }}</button>
                }
              </div>
            }
          }
          @if (chosen.period === 'range') {
            <label class="field">
              <span>From</span>
              <input type="date" [(ngModel)]="from" />
            </label>
            <label class="field">
              <span>To</span>
              <input type="date" [(ngModel)]="to" />
            </label>
            <div class="rp-quick" role="group" aria-label="Quick ranges">
              @for (item of presets; track item.key) {
                <button type="button" class="rp-chip" [class.is-on]="preset === item.key" (click)="usePreset(item.key)">{{ item.label }}</button>
              }
            </div>
          }
          @if (chosen.period === 'year') {
            <label class="field">
              <span>Year</span>
              <select [(ngModel)]="year">
                @for (item of years(); track item) { <option [value]="item">{{ item }}</option> }
              </select>
            </label>
          }
          @if (chosen.people) {
            <label class="field">
              <span>Department</span>
              <select [(ngModel)]="department">
                <option value="">Every department</option>
                @for (item of catalog.departments; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
              </select>
            </label>
            @if (catalog.locations.length) {
              <label class="field">
                <span>Location</span>
                <select [(ngModel)]="location">
                  <option value="">Every location</option>
                  @for (item of catalog.locations; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
                </select>
              </label>
            }
          }
          @if (chosen.statuses.length) {
            <label class="field">
              <span>Status</span>
              <select [(ngModel)]="status">
                @for (item of chosen.statuses; track item.key) { <option [value]="item.key">{{ item.label }}</option> }
              </select>
            </label>
          }
        </div>
        <div class="actions rp-run">
          <button type="button" class="btn btn-primary" (click)="run()" [disabled]="busy">
            <i class="bi" [class.bi-play-fill]="!busy" [class.bi-hourglass-split]="busy"></i> {{ busy ? 'Running…' : 'Run report' }}
          </button>
          @if (result) {
            <button type="button" class="btn btn-ghost" (click)="exportCsv()"><i class="bi bi-file-earmark-spreadsheet"></i> Export to Excel (CSV)</button>
            <button type="button" class="btn btn-ghost" (click)="print()"><i class="bi bi-printer"></i> Print or save as PDF</button>
          }
        </div>
      </section>

      @if (result) {
        <div class="rp-meta">
          <span><i class="bi bi-calendar3"></i> {{ result.period }}</span>
          <span><i class="bi bi-diagram-3"></i> {{ result.scope }}</span>
          <span><i class="bi bi-clock"></i> Run {{ ranAt(result.generatedAt) }}</span>
          <span><i class="bi bi-list-ol"></i> {{ result.rows.length }} {{ result.rows.length === 1 ? 'row' : 'rows' }}</span>
        </div>
        @if (result.summary.length) {
          <div class="rp-summary">
            @for (item of result.summary; track item.label) {
              <div class="card rp-tile">
                <span class="muted">{{ item.label }}</span>
                <strong>{{ item.value }}</strong>
              </div>
            }
          </div>
        }
        @if (result.note) { <p class="rp-note"><i class="bi bi-info-circle"></i> {{ result.note }}</p> }
        @if (result.truncated) { <p class="form-error" data-inline-message>Only the first 5,000 rows are shown. Narrow the filters to see the rest.</p> }
        @for (shownResult of [result]; track shownResult.generatedAt) {
          <app-data-table [tableId]="'report-' + shownResult.key" [title]="shownResult.title" empty="No records for these filters." [rows]="shownResult.rows" [columns]="columns" />
        }
        @if (totalItems().length) {
          <section class="card rp-totals">
            <strong>Totals</strong>
            @for (item of totalItems(); track item.label) {
              <span><small class="muted">{{ item.label }}</small> {{ item.value }}</span>
            }
          </section>
        }
      }
    }
    }
  `,
})
export class ReportsComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private watch?: Subscription;

  catalog: Catalog | null = null;
  chosen: ReportItem | null = null;
  result: ReportResult | null = null;
  columns: DataColumn<Row>[] = [];
  error = '';
  busy = false;
  search = '';
  group = '';

  month = '';
  from = '';
  to = '';
  year = '';
  department = '';
  location = '';
  status = '';
  preset = 'month';
  readonly presets = [
    { key: 'month', label: 'This month' },
    { key: 'last', label: 'Last month' },
    { key: 'quarter', label: 'Last 3 months' },
    { key: 'fy', label: 'This financial year' },
  ];

  get canOpen(): boolean {
    return !!this.store.me?.access?.includes('reports');
  }

  async ngOnInit(): Promise<void> {
    if (!this.canOpen) return;
    try {
      this.catalog = await this.api.get<Catalog>('/v1/reports');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Reports could not be loaded.';
      return;
    }
    this.watch = this.route.queryParamMap.subscribe((params) => this.choose(params.get('r') || ''));
  }

  ngOnDestroy(): void {
    this.watch?.unsubscribe();
  }

  groups(): Array<{ name: string; icon: string; count: number }> {
    const counts = new Map<string, number>();
    for (const report of this.catalog?.reports || []) counts.set(report.group, (counts.get(report.group) || 0) + 1);
    return [...counts].map(([name, count]) => ({ name, count, icon: GROUP_ICON[name] || 'bi-folder' }));
  }

  sections(): Array<{ name: string; icon: string; reports: ReportItem[] }> {
    const words = this.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = (this.catalog?.reports || []).filter((report) => {
      if (this.group && report.group !== this.group) return false;
      const text = `${report.title} ${report.blurb} ${report.group}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    return this.groups()
      .map((group) => ({ name: group.name, icon: group.icon, reports: list.filter((report) => report.group === group.name) }))
      .filter((section) => section.reports.length);
  }

  open(key: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { r: key } });
  }

  close(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: {} });
  }

  private choose(key: string): void {
    const report = this.catalog?.reports.find((item) => item.key === key) || null;
    if (report?.key === this.chosen?.key) return;
    this.chosen = report;
    this.result = null;
    this.columns = [];
    if (!report || !this.catalog) return;
    const today = this.catalog.today;
    this.month = report.group === 'Payroll' && this.catalog.payMonths.length ? this.catalog.payMonths[0] : today.slice(0, 7);
    this.year = today.slice(0, 4);
    this.status = report.statuses[0]?.key || '';
    this.usePreset('month');
    void this.run();
  }

  years(): string[] {
    const now = Number((this.catalog?.today || '2026').slice(0, 4));
    return [now + 1, now, now - 1, now - 2, now - 3].map(String);
  }

  monthName(month: string): string {
    const [year, value] = month.split('-');
    return `${MONTHS[Number(value) - 1]} ${year}`;
  }

  usePreset(key: string): void {
    const today = new Date((this.catalog?.today || iso(new Date())) + 'T00:00:00');
    const y = today.getFullYear();
    const m = today.getMonth();
    this.preset = key;
    if (key === 'last') {
      this.from = iso(new Date(y, m - 1, 1));
      this.to = iso(new Date(y, m, 0));
    } else if (key === 'quarter') {
      this.from = iso(new Date(y, m - 2, 1));
      this.to = iso(today);
    } else if (key === 'fy') {
      this.from = iso(new Date(m >= 3 ? y : y - 1, 3, 1));
      this.to = iso(today);
    } else {
      this.from = iso(new Date(y, m, 1));
      this.to = iso(today);
    }
  }

  async run(): Promise<void> {
    if (!this.chosen) return;
    const report = this.chosen;
    const params = new URLSearchParams();
    if (report.period === 'month') params.set('month', this.month);
    if (report.period === 'range') {
      params.set('from', this.from);
      params.set('to', this.to);
    }
    if (report.period === 'year') params.set('year', this.year);
    if (report.people && this.department) params.set('department', this.department);
    if (report.people && this.location) params.set('location', this.location);
    if (this.status) params.set('status', this.status);
    this.busy = true;
    this.error = '';
    try {
      const result = await this.api.get<ReportResult>(`/v1/reports/${encodeURIComponent(report.key)}?${params}`);
      if (this.chosen?.key !== report.key) return;
      this.columns = result.columns.map((column) => ({
        key: column.key,
        label: column.label,
        text: (row: Row) => shown(row[column.key], column.type),
        sort: (row: Row) => (typeof row[column.key] === 'number' ? (row[column.key] as number) : String(row[column.key] ?? '')),
        pill: column.type === 'status',
      }));
      this.result = result;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The report could not be run.';
    } finally {
      this.busy = false;
    }
  }

  totalItems(): Array<{ label: string; value: string }> {
    const totals = this.result?.totals;
    if (!totals || !this.result) return [];
    return this.result.columns.filter((column) => column.key in totals).map((column) => ({ label: column.label, value: shown(totals[column.key], column.type) }));
  }

  ranAt(value: string): string {
    return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  private fileName(ext: string): string {
    const result = this.result!;
    const period = result.period.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return `${result.key}-${period || 'report'}.${ext}`;
  }

  exportCsv(): void {
    const result = this.result;
    if (!result) return;
    const cell = (value: Cell, type: ColumnType): string => {
      let text: string;
      if (value === null || value === undefined) text = '';
      else if (typeof value === 'number') text = type === 'money' ? (value / 100).toFixed(2) : String(value);
      else text = /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const head = result.columns.map((column) => cell(column.label + (column.type === 'money' ? ' (₹)' : column.type === 'percent' ? ' (%)' : ''), 'text'));
    const body = result.rows.map((row) => result.columns.map((column) => cell(row[column.key], column.type)));
    const lines = [head, ...body];
    if (result.totals) lines.push(result.columns.map((column, index) => (column.key in result.totals! ? cell(result.totals![column.key], column.type) : index === 0 ? 'Total' : '')));
    const intro = [[cell(this.store.me?.company.name || '', 'text')], [cell(result.title, 'text')], [cell(result.period + ' · ' + result.scope, 'text')], []];
    const csv = '\uFEFF' + [...intro, ...lines].map((line) => line.join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = this.fileName('csv');
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  print(): void {
    const result = this.result;
    if (!result) return;
    const company = escapeHtml(this.store.me?.company.name || '');
    const right = (type: ColumnType) => (type === 'money' || type === 'number' || type === 'percent' ? ' class="r"' : '');
    const head = result.columns.map((column) => `<th${right(column.type)}>${escapeHtml(column.label)}</th>`).join('');
    const body = result.rows
      .map((row) => '<tr>' + result.columns.map((column) => `<td${right(column.type)}>${escapeHtml(shown(row[column.key], column.type))}</td>`).join('') + '</tr>')
      .join('');
    const foot = result.totals
      ? '<tr class="t">' + result.columns.map((column, index) => `<td${right(column.type)}>${column.key in result.totals! ? escapeHtml(shown(result.totals![column.key], column.type)) : index === 0 ? 'Total' : ''}</td>`).join('') + '</tr>'
      : '';
    const summary = result.summary.map((item) => `<div><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.value)}</b></div>`).join('');
    const wide = result.columns.length > 9;
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(this.fileName('pdf').replace(/\.pdf$/, ''))}</title><style>
      @page { size: A4 ${wide ? 'landscape' : 'portrait'}; margin: 12mm; }
      body { font: 10px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1b2733; margin: 0; }
      header { border-bottom: 3px solid #e8c85c; padding-bottom: 8px; margin-bottom: 10px; }
      header p { margin: 0; color: #5b6b7a; }
      h1 { font-size: 16px; margin: 2px 0; color: #103860; }
      .s { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
      .s div { border: 1px solid #d5dde5; border-radius: 6px; padding: 4px 8px; }
      .s span { color: #5b6b7a; margin-right: 6px; }
      table { width: 100%; border-collapse: collapse; }
      th { background: #103860; color: #fff; text-align: left; font-weight: 600; }
      th, td { padding: 4px 5px; border-bottom: 1px solid #e1e7ed; vertical-align: top; }
      tr:nth-child(even) td { background: #f6f8fa; }
      .r { text-align: right; white-space: nowrap; }
      .t td { font-weight: 700; border-top: 2px solid #103860; background: #fdf7e1; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
      .n { color: #5b6b7a; margin: 8px 0 0; }
    </style></head><body>
      <header><p>${company}</p><h1>${escapeHtml(result.title)}</h1><p>${escapeHtml(result.period)} · ${escapeHtml(result.scope)} · Run ${escapeHtml(this.ranAt(result.generatedAt))}</p></header>
      ${summary ? `<div class="s">${summary}</div>` : ''}
      <table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${result.columns.length}">No records for these filters.</td></tr>`}${foot}</tbody></table>
      ${result.note ? `<p class="n">${escapeHtml(result.note)}</p>` : ''}
    </body></html>`;
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1500);
    }, 200);
  }
}
