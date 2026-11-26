import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { LeaveBalance, LeaveRequest, LeaveType } from '../core/models';
import { SessionStore } from '../core/session.store';
import { DataColumn, DataTableComponent, RowActionsDirective } from '../shared/data-table.component';
import { LeavePick, LeaveTypePickComponent } from '../shared/leave-type-pick.component';

type LeaveTab = 'balances' | 'apply' | 'requests';

@Component({
  selector: 'app-leave',
  imports: [FormsModule, DataTableComponent, RowActionsDirective, LeaveTypePickComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-calendar2-week"></i></span>
        <p class="eyebrow">Time off</p>
        <h1>Leave</h1>
        <p class="lede">{{ tabLede }}</p>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }

    <div class="seg-tabs page-tabs" role="tablist" aria-label="Leave sections">
      <button type="button" role="tab" [attr.aria-selected]="tab === 'balances'" [class.is-on]="tab === 'balances'" (click)="setTab('balances')">
        <i class="bi bi-pie-chart"></i> Balances
        @if (balances.length) { <span class="chip">{{ balances.length }}</span> }
      </button>
      <button type="button" role="tab" [attr.aria-selected]="tab === 'apply'" [class.is-on]="tab === 'apply'" (click)="setTab('apply')">
        <i class="bi bi-send"></i> Apply
      </button>
      <button type="button" role="tab" [attr.aria-selected]="tab === 'requests'" [class.is-on]="tab === 'requests'" (click)="setTab('requests')">
        <i class="bi bi-inbox"></i> Your requests
        @if (mine.length) { <span class="chip">{{ mine.length }}</span> }
      </button>
    </div>

    @if (tab === 'balances') {
      @if (balances.length) {
        <div class="balance-board">
          @for (item of balances; track item.id) {
            <article class="balance-tile">
              <p>{{ item.name }}</p>
              <strong>{{ counted(item) ? item.left : 'Open' }}</strong>
              <small>{{ counted(item) ? 'days left this year' : 'no yearly limit' }}</small>
              @if (counted(item)) {
                <span class="balance-meter" [attr.aria-label]="item.left + ' of ' + item.entitled + ' left'"><i [style.width.%]="leftShare(item)"></i></span>
                <small>{{ item.used }} used of {{ item.entitled }}</small>
                @if (item.carried || item.earned) {
                  <small class="balance-split">{{ split(item) }}</small>
                }
              }
            </article>
          }
        </div>
      } @else {
        <p class="muted">No leave balances to show yet.</p>
      }
    }

    @if (tab === 'apply') {
      @if (store.me?.employeeId) {
        <div class="page-split">
          <form class="card form-grid" (ngSubmit)="apply()">
            <h2><i class="bi bi-send"></i> Apply</h2>
            <label for="type">Type</label>
            <app-leave-type-pick controlId="type" [types]="leaveChoices" [(value)]="leaveTypeId"></app-leave-type-pick>
            <label class="check" for="half"><input id="half" name="half" type="checkbox" [(ngModel)]="halfDay" (ngModelChange)="onHalf($event)"> Half day, one working day</label>
            <div class="split">
              <div><label for="start">From</label><input id="start" name="start" type="date" [(ngModel)]="startsOn" required></div>
              <div><label for="end">To</label><input id="end" name="end" type="date" [(ngModel)]="endsOn" required></div>
            </div>
            <label for="reason">Reason</label>
            <textarea id="reason" name="reason" rows="3" [(ngModel)]="reason"></textarea>
            <button class="btn btn-primary" type="submit" [disabled]="busy"><i class="bi bi-send"></i> {{ busy ? 'Sending…' : 'Submit request' }}</button>
          </form>
          <aside class="card">
            <h2><i class="bi bi-signpost-split"></i> What happens next</h2>
            <ol class="steps">
              <li class="now"><span>1</span><div><strong>You send the dates</strong><p>Only working days are counted.</p></div></li>
              <li><span>2</span><div><strong>A manager or HR decides</strong><p>You can cancel while it is still waiting.</p></div></li>
              <li><span>3</span><div><strong>The calendar updates</strong><p>Approved days show as leave. Pending days show as waiting.</p></div></li>
            </ol>
          </aside>
        </div>
      } @else {
        <p class="muted">Ask HR to link this sign-in to a person before you can apply for leave.</p>
      }
    }

    @if (tab === 'requests') {
      <app-data-table tableId="my-leave" title="Your requests" empty="No requests yet." [rows]="mine" [columns]="requestColumns" [loading]="loading">
        <ng-template appRowActions let-item>
          @if (item.status === 'pending') {
            <button class="btn btn-ghost btn-sm" type="button" (click)="cancel(item)">Cancel</button>
          }
        </ng-template>
      </app-data-table>
    }
  `,
})
export class LeaveComponent implements OnInit {
  readonly store = inject(SessionStore);
  private readonly api = inject(ApiService);
  private readonly tabKey = 'altamid.leave.tab';
  tab: LeaveTab = 'balances';
  balances: LeaveBalance[] = [];
  types: LeaveType[] = [];
  mine: LeaveRequest[] = [];
  readonly requestColumns: DataColumn<LeaveRequest>[] = [
    { key: 'type', label: 'Type', text: (row) => row.type },
    { key: 'from', label: 'From', text: (row) => row.startsOn },
    { key: 'to', label: 'To', text: (row) => row.endsOn },
    { key: 'days', label: 'Days', text: (row) => String(row.days) },
    { key: 'status', label: 'Status', text: (row) => row.status, pill: true },
    { key: 'reason', label: 'Reason', text: (row) => row.reason || '—', optional: true },
  ];
  leaveTypeId = '';
  halfDay = false;
  startsOn = '';
  endsOn = '';
  reason = '';
  error = '';
  ok = '';
  loading = true;
  busy = false;

  get tabLede(): string {
    const lines: Record<LeaveTab, string> = {
      balances: 'Days left this year for each leave type. Weekly offs and company holidays are not counted.',
      apply: 'Pick dates and send a request. A manager or HR still needs to approve it.',
      requests: 'Everything you have sent. You can cancel while a request is still waiting.',
    };
    return lines[this.tab];
  }

  setTab(tab: LeaveTab): void {
    this.tab = tab;
    try { sessionStorage.setItem(this.tabKey, tab); } catch { /* ignore */ }
  }

  onHalf(half: boolean): void {
    if (half) this.endsOn = this.startsOn;
  }

  leftShare(item: LeaveBalance): number {
    if (!item.entitled) return item.limited ? 0 : 100;
    return Math.max(0, Math.min(100, Math.round((item.left / item.entitled) * 100)));
  }

  counted(item: LeaveBalance): boolean {
    return item.limited ?? !!item.entitled;
  }

  split(item: LeaveBalance): string {
    const parts: string[] = [];
    if (item.quota) parts.push(item.quota + ' this year');
    if (item.carried) parts.push(item.carried + ' carried forward');
    if (item.earned) parts.push(item.earned + ' earned from extra time');
    return parts.join(' + ');
  }

  get leaveChoices(): LeavePick[] {
    return this.types.map((type) => {
      const balance = this.balances.find((item) => item.id === type.id);
      return { id: type.id, name: type.name, entitled: balance?.entitled ?? type.daysPerYear, left: balance?.left ?? type.daysPerYear, limited: balance?.limited };
    });
  }

  async ngOnInit(): Promise<void> {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    this.startsOn = today;
    this.endsOn = today;
    try {
      const saved = sessionStorage.getItem(this.tabKey) as LeaveTab | null;
      if (saved && ['balances', 'apply', 'requests'].includes(saved)) this.tab = saved;
    } catch { /* ignore */ }
    if (!sessionStorage.getItem(this.tabKey)) {
      this.tab = this.store.me?.employeeId ? 'apply' : 'balances';
    }
    await this.load();
  }

  async apply(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const endsOn = this.halfDay ? this.startsOn : this.endsOn;
      await this.api.post('/v1/leave', { leaveTypeId: this.leaveTypeId, startsOn: this.startsOn, endsOn, portion: this.halfDay ? 'half' : 'full', reason: this.reason });
      this.reason = '';
      this.ok = 'Request sent to your manager.';
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not apply.';
    } finally {
      this.busy = false;
    }
  }

  async cancel(item: LeaveRequest): Promise<void> {
    this.error = '';
    try {
      await this.api.post('/v1/leave/' + item.id + '/decide', { decision: 'cancelled' });
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not cancel.';
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const data = await this.api.get<{ balances: LeaveBalance[]; types: LeaveType[]; mine: LeaveRequest[] }>('/v1/leave');
      this.balances = data.balances;
      this.types = data.types;
      this.mine = data.mine;
      if (!this.leaveTypeId && data.types[0]) this.leaveTypeId = data.types[0].id;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load leave.';
    } finally {
      this.loading = false;
    }
  }
}