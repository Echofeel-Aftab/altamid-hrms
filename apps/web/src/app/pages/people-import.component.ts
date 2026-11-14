import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Sweet } from '../shared/sweet';

interface Preview {
  rows: Array<{ line: number; ok: boolean; error: string; name: string; email: string }>;
  valid: number;
  invalid: number;
  willCreate: { departments: string[]; designations: string[]; locations: string[] };
  imported: number;
}

const COLUMNS: Array<[string, string]> = [
  ['code', 'Employee code'],
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['workerType', 'Worker type'],
  ['department', 'Department'],
  ['designation', 'Designation'],
  ['location', 'Location'],
  ['manager', 'Manager'],
  ['dateOfJoining', 'Date of joining'],
  ['confirmedOn', 'Confirmed on'],
  ['probationEndsOn', 'Probation ends'],
  ['dateOfBirth', 'Date of birth'],
  ['gender', 'Gender'],
  ['address', 'Address'],
  ['emergencyName', 'Emergency contact'],
  ['emergencyPhone', 'Emergency phone'],
  ['pan', 'PAN'],
  ['bankName', 'Bank name'],
  ['bankAccount', 'Bank account'],
  ['ifsc', 'IFSC'],
];

const DATE_KEYS = new Set(['dateOfJoining', 'confirmedOn', 'probationEndsOn', 'dateOfBirth']);

@Component({
  selector: 'app-people-import',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-file-earmark-spreadsheet"></i></span>
        <p class="eyebrow">Directory</p>
        <h1>Import people</h1>
        <p class="muted">Add up to 500 people from a CSV file. Nothing is saved until every row passes the check.</p>
      </div>
      <a class="btn btn-ghost" routerLink="/people"><i class="bi bi-arrow-left"></i> Back to people</a>
    </div>
    @if (error) { <p class="form-error"><i class="bi bi-exclamation-octagon"></i> {{ error }}</p> }

    <section class="card imp-card">
      <h2 class="imp-h"><span class="imp-step">1</span> Fill the template</h2>
      <p class="muted">Keep the header row. First name is the only required column. Dates can be 2026-04-01 or 01/04/2026 (day first). Manager is an employee code or email, from the company or from this file. Codes left blank are issued from Numbering. Probation ends is filled from Rules and automation when blank.</p>
      <div class="actions"><button type="button" class="btn btn-ghost" (click)="template()"><i class="bi bi-download"></i> Download CSV template</button></div>
    </section>

    <section class="card imp-card">
      <h2 class="imp-h"><span class="imp-step">2</span> Choose the file and check it</h2>
      <input type="file" accept=".csv,text/csv" (change)="pick($event)" aria-label="CSV file">
      @if (fileName) { <p class="field-hint">{{ fileName }} · {{ rows.length }} row(s) read</p> }
      <label class="check imp-check">
        <input type="checkbox" name="createMissing" [(ngModel)]="createMissing" (ngModelChange)="preview = null">
        <span><strong>Add missing departments, designations and locations</strong><small>Off rejects rows that name one that does not exist yet.</small></span>
      </label>
      <div class="actions imp-actions">
        <button type="button" class="btn btn-primary" (click)="check()" [disabled]="busy || !rows.length"><i class="bi bi-search"></i> {{ busy && !committing ? 'Checking…' : 'Check rows' }}</button>
      </div>
    </section>

    @if (preview) {
      <section class="card imp-card">
        <h2 class="imp-h"><span class="imp-step">3</span> Review and import</h2>
        <div class="imp-summary">
          <span class="pill ok">{{ preview.valid }} ready</span>
          @if (preview.invalid) { <span class="pill bad">{{ preview.invalid }} with problems</span> }
        </div>
        @if (created()) { <p class="field-hint">Will also add: {{ created() }}</p> }
        @if (preview.invalid) {
          <p class="pm-note"><i class="bi bi-info-circle"></i> Fix the rows below in the file, choose it again and check. Nothing is imported while any row has a problem.</p>
        }
        <div class="table-wrap imp-table">
          <table>
            <thead><tr><th>Line</th><th>Name</th><th>Email</th><th>Result</th></tr></thead>
            <tbody>
              @for (row of shown(); track row.line) {
                <tr>
                  <td>{{ row.line }}</td>
                  <td>{{ row.name || '—' }}</td>
                  <td>{{ row.email || '—' }}</td>
                  <td>@if (row.ok) { <span class="pill ok">Ready</span> } @else { <span class="imp-err">{{ row.error }}</span> }</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        @if (preview.rows.length > shown().length) {
          <p class="field-hint">Showing the {{ shown().length }} rows with problems first. {{ preview.rows.length - shown().length }} more are ready.</p>
        }
        <div class="actions imp-actions">
          <button type="button" class="btn btn-gold" (click)="commit()" [disabled]="busy || preview.invalid > 0 || !preview.valid">
            <i class="bi bi-person-plus"></i> {{ committing ? 'Importing…' : 'Import ' + preview.valid + ' people' }}
          </button>
        </div>
      </section>
    }
  `,
})
export class PeopleImportComponent {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly router = inject(Router);
  rows: Array<Record<string, string>> = [];
  fileName = '';
  createMissing = false;
  preview: Preview | null = null;
  error = '';
  busy = false;
  committing = false;

  template(): void {
    const header = COLUMNS.map(([, label]) => label).join(',');
    const sample = ['', 'Priya', 'Sharma', 'priya@example.com', '+91 98765 43210', 'employee', 'Operations', 'Executive', '', '', '2026-12-01', '', '', '', 'Female', '', '', '', '', '', '', ''].join(',');
    const blob = new Blob(['\ufeff' + header + '\r\n' + sample + '\r\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'people-import-template.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async pick(event: Event): Promise<void> {
    this.error = '';
    this.preview = null;
    this.rows = [];
    const file = (event.target as HTMLInputElement).files?.[0];
    this.fileName = file?.name || '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      this.error = 'Choose a CSV file under 2 MB.';
      return;
    }
    const table = parseCsv((await file.text()).replace(/^\ufeff/, ''));
    if (table.length < 2) {
      this.error = 'The file needs a header row and at least one person.';
      return;
    }
    const lookup = new Map<string, string>();
    for (const [key, label] of COLUMNS) {
      lookup.set(norm(key), key);
      lookup.set(norm(label), key);
    }
    const keys = table[0].map((cell) => lookup.get(norm(cell)) || '');
    if (!keys.includes('firstName')) {
      this.error = 'The header row needs a “First name” column. Download the template to see the columns.';
      return;
    }
    this.rows = table
      .slice(1)
      .filter((cells) => cells.some((cell) => cell.trim()))
      .map((cells) => {
        const row: Record<string, string> = {};
        keys.forEach((key, index) => {
          if (!key) return;
          const value = (cells[index] || '').trim();
          if (value) row[key] = DATE_KEYS.has(key) ? isoDay(value) : value;
        });
        return row;
      });
    if (this.rows.length > 500) this.error = 'Import up to 500 people at a time. Split the file.';
  }

  shown(): Preview['rows'] {
    if (!this.preview) return [];
    const bad = this.preview.rows.filter((row) => !row.ok);
    return bad.length ? [...bad, ...this.preview.rows.filter((row) => row.ok).slice(0, Math.max(0, 50 - bad.length))] : this.preview.rows.slice(0, 100);
  }

  created(): string {
    const made = this.preview?.willCreate;
    if (!made) return '';
    const parts = [
      made.departments.length ? 'departments ' + made.departments.join(', ') : '',
      made.designations.length ? 'designations ' + made.designations.join(', ') : '',
      made.locations.length ? 'locations ' + made.locations.join(', ') : '',
    ].filter(Boolean);
    return parts.join('; ');
  }

  async check(): Promise<void> {
    await this.send(false);
  }

  async commit(): Promise<void> {
    if (!this.preview) return;
    const ok = await this.sweet.confirm({
      title: `Import ${this.preview.valid} people?`,
      text: 'Each person is added as active without a sign-in. You can turn on sign-in from their profile later.',
      confirmText: 'Import',
    });
    if (!ok) return;
    this.committing = true;
    const result = await this.send(true);
    this.committing = false;
    if (result?.imported) {
      await this.sweet.success({ title: `${result.imported} people imported`, text: 'They are now in People.' });
      await this.router.navigateByUrl('/people');
    }
  }

  private async send(commit: boolean): Promise<Preview | null> {
    if (!this.rows.length || this.rows.length > 500) return null;
    this.busy = true;
    this.error = '';
    try {
      const result = await this.api.post<Preview>('/v1/people/import', { rows: this.rows, commit, createMissing: this.createMissing });
      this.preview = result;
      return result;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The file could not be checked.';
      return null;
    } finally {
      this.busy = false;
    }
  }
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isoDay(value: string): string {
  const match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : value;
}

function parseCsv(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
