import { Component, EventEmitter, inject, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { DataColumn, DataTableComponent, RowActionsDirective } from '../shared/data-table.component';
import { Sweet } from '../shared/sweet';

interface MonthRow {
  employeeId: string;
  code: string;
  name: string;
  department: string;
  status: string;
  ctc: string;
  slip: { id: string; published: boolean; paidDays: string; lopDays: string; gross: string; net: string } | null;
  suggested: { paidDays: string; lopDays: string; absent: number; unpaid: number; employed: number; tracked: boolean };
  bankReady: boolean;
  payFrom: string;
}

interface MonthBoard {
  month: string;
  label: string;
  finished: boolean;
  locked: { at: string; by: string } | null;
  rows: MonthRow[];
  totals: { people: number; withCtc: number; slips: number; published: number; drafts: number };
  accounts: PayAccount[];
}

interface PayAccount { id: string; label: string; bank: string; mask: string; isDefault: boolean; published: number }

@Component({
  selector: 'app-payroll-month',
  imports: [FormsModule, DataTableComponent, RowActionsDirective],
  template: `
    <section class="card pm-card">
      <div class="pm-head">
        <div>
          <h2><i class="bi bi-calendar2-check"></i> Payroll month</h2>
          <p class="muted">Start every slip from the CTC, check paid and loss of pay days from attendance, publish together, then lock the month and download the bank file.</p>
        </div>
        <label class="pm-month">
          <span>Month</span>
          <input type="month" [(ngModel)]="month" (ngModelChange)="load()" aria-label="Payroll month" />
        </label>
      </div>
      @if (board) {
        <div class="pm-tiles">
          <div class="pm-tile"><span>People</span><strong>{{ board.totals.people }}</strong></div>
          <div class="pm-tile"><span>CTC entered</span><strong>{{ board.totals.withCtc }}</strong></div>
          <div class="pm-tile"><span>Draft slips</span><strong>{{ board.totals.drafts }}</strong></div>
          <div class="pm-tile"><span>Published</span><strong>{{ board.totals.published }}</strong></div>
          <div class="pm-tile" [class.is-locked]="board.locked">
            <span>Month</span>
            <strong>{{ board.locked ? 'Locked' : 'Open' }}</strong>
          </div>
        </div>
        @if (board.locked) {
          <p class="pm-note"><i class="bi bi-lock"></i> Locked by {{ board.locked.by || 'payroll' }} on {{ when(board.locked.at) }}. Slips cannot change until the month is reopened.</p>
        } @else if (!board.finished) {
          <p class="pm-note"><i class="bi bi-info-circle"></i> {{ board.label }} is not over yet. Absence and unpaid leave are counted up to today, and the rest of the month is assumed paid.</p>
        }
        <div class="actions pm-actions">
          @if (!board.locked) {
            <button type="button" class="btn btn-primary" (click)="start()" [disabled]="busy || !startable()">
              <i class="bi bi-magic"></i> Start {{ startable() }} draft slip(s) from CTC
            </button>
            <button type="button" class="btn btn-ghost" (click)="publish()" [disabled]="busy || !board.totals.drafts">
              <i class="bi bi-send-check"></i> Publish {{ board.totals.drafts }} draft(s)
            </button>
            <button type="button" class="btn btn-ghost" (click)="lock(true)" [disabled]="busy || !board.totals.published || board.totals.drafts > 0">
              <i class="bi bi-lock"></i> Lock month
            </button>
          } @else {
            <button type="button" class="btn btn-ghost" (click)="lock(false)" [disabled]="busy"><i class="bi bi-unlock"></i> Reopen month</button>
          }
          @if (board.accounts.length > 1) {
            <select class="pm-account" [(ngModel)]="accountId" aria-label="Pay from">
              @for (account of board.accounts; track account.id) {
                <option [value]="account.id">{{ account.label }} {{ account.mask }} · {{ account.published }} slip(s)</option>
              }
            </select>
          }
          <button type="button" class="btn btn-ghost" (click)="bankFile()" [disabled]="busy || !board.totals.published || (board.accounts.length > 1 && !chosen()?.published)">
            <i class="bi bi-bank"></i> Bank transfer file
          </button>
        </div>
        <app-data-table tableId="payroll-month" title="People in the month" empty="Nobody was employed in this month." [rows]="board.rows" [columns]="columns">
          <ng-template appRowActions let-item>
            <button type="button" class="btn btn-sm" (click)="open.emit(item.employeeId)"><i class="bi bi-pencil-square"></i> Open</button>
          </ng-template>
        </app-data-table>
      }
    </section>
  `,
})
export class PayrollMonthComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  @Output() readonly open = new EventEmitter<string>();
  @Output() readonly changed = new EventEmitter<void>();

  month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 7);
  board: MonthBoard | null = null;
  busy = false;

  readonly columns: DataColumn<MonthRow>[] = [
    { key: 'name', label: 'Person', text: (row) => row.name, sub: (row) => row.code + (row.department ? ' · ' + row.department : '') },
    { key: 'ctc', label: 'Annual CTC', text: (row) => row.ctc || 'Not entered' },
    { key: 'slip', label: 'Slip', pill: true, text: (row) => (row.slip ? (row.slip.published ? 'Published' : 'Draft') : 'No slip') },
    { key: 'net', label: 'Net pay', text: (row) => row.slip?.net || '—' },
    { key: 'days', label: 'Paid / LOP on slip', text: (row) => (row.slip ? `${row.slip.paidDays || '—'} / ${row.slip.lopDays || '—'}` : '—') },
    {
      key: 'suggested',
      label: 'From attendance',
      text: (row) => (row.suggested.tracked ? `${row.suggested.paidDays} paid · ${row.suggested.lopDays} LOP` : 'No attendance recorded'),
      sub: (row) => (row.suggested.tracked ? `${row.suggested.absent} absent, ${row.suggested.unpaid} unpaid leave` : ''),
    },
    { key: 'bank', label: 'Bank', pill: true, text: (row) => (row.bankReady ? 'Ready' : 'Missing') },
    { key: 'payFrom', label: 'Paid from', optional: true, text: (row) => this.board?.accounts.find((account) => account.id === row.payFrom)?.label || '—' },
  ];
  accountId = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  chosen(): PayAccount | undefined {
    return this.board?.accounts.find((account) => account.id === this.accountId);
  }

  startable(): number {
    return this.board ? this.board.rows.filter((row) => !row.slip && row.ctc).length : 0;
  }

  when(value: string): string {
    return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async load(): Promise<void> {
    if (!/^\d{4}-\d{2}$/.test(this.month)) return;
    try {
      this.board = await this.api.get<MonthBoard>('/v1/payroll/month/' + this.month);
      if (!this.board.accounts.some((account) => account.id === this.accountId)) this.accountId = this.board.accounts.find((account) => account.isDefault)?.id || '';
    } catch (error) {
      this.board = null;
      await this.sweet.error({ title: 'Payroll month not loaded', text: this.message(error) });
    }
  }

  async start(): Promise<void> {
    const count = this.startable();
    const ok = await this.sweet.confirm({
      title: `Start ${count} draft slip(s)?`,
      text: 'Each slip starts from the person’s CTC divided by 12, with paid and loss of pay days from attendance. Deductions such as PF, ESI, PT and TDS are not added. Enter them on each slip. Nothing is published.',
      confirmText: 'Start drafts',
    });
    if (!ok) return;
    await this.act(async () => {
      const result = await this.api.post<{ created: number; noCtc: number; month: MonthBoard }>('/v1/payroll/month/start', { month: this.month });
      this.board = result.month;
      await this.sweet.success({ title: `${result.created} draft slip(s) started`, text: result.noCtc ? `${result.noCtc} person(s) have no CTC yet, so no slip was started for them.` : 'Open each person to add deductions, then publish.' });
    });
  }

  async publish(): Promise<void> {
    if (!this.board) return;
    const ok = await this.sweet.confirm({
      title: `Publish ${this.board.totals.drafts} slip(s) for ${this.board.label}?`,
      text: 'Each person will see their slip on My pay. If the payslip email is set to send automatically, it is emailed too.',
      confirmText: 'Publish',
    });
    if (!ok) return;
    await this.act(async () => {
      const result = await this.api.post<{ published: number; emailed: number; month: MonthBoard }>('/v1/payroll/month/publish', { month: this.month });
      this.board = result.month;
      await this.sweet.success({ title: `${result.published} slip(s) published`, text: result.emailed ? `${result.emailed} emailed.` : 'No emails were sent.' });
    });
  }

  async lock(locked: boolean): Promise<void> {
    if (!this.board) return;
    const ok = await this.sweet.confirm(
      locked
        ? { title: `Lock ${this.board.label}?`, text: 'Slips for this month cannot be changed until someone with Payroll desk access reopens it. Reopening is recorded in the activity log.', confirmText: 'Lock month' }
        : { title: `Reopen ${this.board.label}?`, text: 'Slips can be changed again. This is recorded in the activity log.', confirmText: 'Reopen', danger: true },
    );
    if (!ok) return;
    await this.act(async () => {
      this.board = await this.api.post<MonthBoard>('/v1/payroll/month/lock', { month: this.month, locked });
    });
  }

  async bankFile(): Promise<void> {
    await this.act(async () => {
      const blob = await this.api.blob('/v1/payroll/bank-file/' + this.month + (this.accountId ? '?account=' + encodeURIComponent(this.accountId) : ''));
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const account = this.board && this.board.accounts.length > 1 ? this.chosen() : undefined;
      link.download = `salary-${this.month}${account ? '-' + account.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : ''}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, false);
  }

  private async act(work: () => Promise<void>, reload = true): Promise<void> {
    this.busy = true;
    try {
      await work();
      if (reload) this.changed.emit();
    } catch (error) {
      await this.sweet.error({ title: 'That did not work', text: this.message(error) });
    } finally {
      this.busy = false;
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Try again.';
  }
}
