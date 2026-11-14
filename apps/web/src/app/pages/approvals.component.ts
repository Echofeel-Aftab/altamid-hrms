import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { FlowStage, LeaveRequest } from '../core/models';
import { DataColumn, DataTableComponent, RowActionsDirective } from '../shared/data-table.component';

interface DetailChange {
  id: string;
  person: string;
  code: string;
  employeeId: string;
  sentAt: string;
  own: boolean;
  fields: Array<{ key: string; label: string; before: string; after: string }>;
}

interface TimeRequest {
  id: string;
  person: string;
  personCode: string;
  type: string;
  day: string;
  endsOn: string;
  inTime: string;
  outTime: string;
  place: string;
  hours: string;
  reason: string;
  stage?: FlowStage | null;
}

interface ExitRow { id: string; person: string; code: string; lastDay: string; reason: string; stage?: FlowStage | null }

const stageText = (stage?: FlowStage | null): string => (stage ? (stage.of > 1 ? `Step ${stage.step} of ${stage.of}` : 'Single step') : 'Reporting manager');
const stageSub = (stage?: FlowStage | null): string => (stage ? stage.label : '');

@Component({
  selector: 'app-approvals',
  imports: [DataTableComponent, RowActionsDirective, FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-check2-square"></i></span>
        <p class="eyebrow">My team</p>
        <h1>Approvals</h1>
        <p class="lede">Leave is decided first. Attendance covers a missed punch, work from home, extra time, or a day on duty.</p>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (details !== null) {
      <section class="card">
        <div class="card-head"><h2><i class="bi bi-bank"></i> Pay detail changes</h2><span [class]="'chip ' + (details.length ? 'is-warn' : 'is-ok')">{{ details.length ? details.length + ' waiting' : 'All clear' }}</span></div>
        <p class="muted">PAN, Aadhaar, UAN, ESIC, bank, and tax regime changes people sent from My profile. Check them against the proof, such as a cancelled cheque, before approving. Nothing changes until you approve.</p>
        @if (!details.length) { <p class="muted"><i class="bi bi-check2-circle"></i> No change is waiting.</p> }
        <div class="dc-list">
          @for (item of details; track item.id) {
            <div class="approval-card">
              <div class="approval-head">
                <span class="approval-ico"><i class="bi bi-person-gear"></i></span>
                <div><h2><a [routerLink]="'/people/' + item.employeeId">{{ item.person }}</a> · {{ item.code }}</h2><p>Sent {{ when(item.sentAt) }}</p></div>
                <span class="chip is-warn">Needs approval</span>
              </div>
              <ul class="diff-list">
                @for (row of item.fields; track row.key) {
                  <li><span class="diff-key">{{ row.label }}</span><span class="diff-old">{{ row.before }}</span><i class="bi bi-arrow-right" aria-hidden="true"></i><span class="diff-new">{{ row.after }}</span></li>
                }
              </ul>
              @if (item.own) {
                <p class="muted"><i class="bi bi-info-circle"></i> This is your own change. Someone else in HR or payroll approves it.</p>
              } @else {
                <input class="dc-note" [name]="'note-' + item.id" [(ngModel)]="notes[item.id]" placeholder="Reason, needed to reject" aria-label="Reason">
                <div class="actions">
                  <button type="button" class="btn btn-primary" [disabled]="busy" (click)="decideDetails(item, 'approved')"><i class="bi bi-check2"></i> Approve</button>
                  <button type="button" class="btn btn-ghost btn-danger" [disabled]="busy" (click)="decideDetails(item, 'rejected')"><i class="bi bi-x-lg"></i> Reject</button>
                </div>
              }
            </div>
          }
        </div>
      </section>
    }
    <app-data-table tableId="approvals" title="Leave" empty="No leave is waiting." [rows]="queue" [columns]="columns">
      <ng-template appRowActions let-item>
        <button class="btn btn-sm" type="button" (click)="decide(item, 'approved')">Approve</button>
        <button class="btn btn-ghost btn-sm" type="button" (click)="decide(item, 'rejected')">Reject</button>
      </ng-template>
    </app-data-table>
    <app-data-table tableId="time-approvals" title="Attendance" empty="No time request is waiting." [rows]="time" [columns]="timeColumns">
      <ng-template appRowActions let-item>
        <button class="btn btn-sm" type="button" (click)="decideTime(item, 'approved')">Approve</button>
        <button class="btn btn-ghost btn-sm" type="button" (click)="decideTime(item, 'rejected')">Reject</button>
      </ng-template>
    </app-data-table>
    <app-data-table tableId="exit-approvals" title="Resignation" empty="No resignation is waiting." [rows]="exits" [columns]="exitColumns">
      <ng-template appRowActions let-item>
        <button class="btn btn-sm" type="button" (click)="decideExit(item, 'accepted')">Accept</button>
        <button class="btn btn-ghost btn-sm" type="button" (click)="decideExit(item, 'declined')">Decline</button>
      </ng-template>
    </app-data-table>
  `,
})
export class ApprovalsComponent implements OnInit {
  private readonly api = inject(ApiService);
  queue: LeaveRequest[] = [];
  time: TimeRequest[] = [];
  exits: ExitRow[] = [];
  error = '';
  details: DetailChange[] | null = null;
  notes: Record<string, string> = {};
  busy = false;
  readonly columns: DataColumn<LeaveRequest>[] = [
    { key: 'person', label: 'Person', text: (row) => row.person, sub: (row) => row.personCode, person: (row) => ({ code: row.personCode, name: row.person }) },
    { key: 'type', label: 'Type', text: (row) => row.type },
    { key: 'from', label: 'From', text: (row) => row.startsOn },
    { key: 'to', label: 'To', text: (row) => row.endsOn },
    { key: 'days', label: 'Days', text: (row) => String(row.days) },
    { key: 'stage', label: 'Step', text: (row) => stageText(row.stage), sub: (row) => stageSub(row.stage) },
    { key: 'reason', label: 'Reason', text: (row) => row.reason || '—', optional: true },
  ];
  readonly timeColumns: DataColumn<TimeRequest>[] = [
    { key: 'person', label: 'Person', text: (row) => row.person, sub: (row) => row.personCode, person: (row) => ({ code: row.personCode, name: row.person }) },
    { key: 'type', label: 'Request', text: (row) => row.type },
    { key: 'day', label: 'Day', text: (row) => row.endsOn && row.endsOn !== row.day ? row.day + ' – ' + row.endsOn : row.day },
    { key: 'time', label: 'Time', text: (row) => row.hours ? row.hours + ' h' : row.inTime ? row.inTime + '–' + row.outTime : row.place || '—' },
    { key: 'stage', label: 'Step', text: (row) => stageText(row.stage), sub: (row) => stageSub(row.stage) },
    { key: 'reason', label: 'Reason', text: (row) => row.reason || '—' },
  ];
  readonly exitColumns: DataColumn<ExitRow>[] = [
    { key: 'person', label: 'Person', text: (row) => row.person, sub: (row) => row.code, person: (row) => ({ code: row.code, name: row.person }) },
    { key: 'day', label: 'Last day', text: (row) => row.lastDay },
    { key: 'stage', label: 'Step', text: (row) => stageText(row.stage), sub: (row) => stageSub(row.stage) },
    { key: 'reason', label: 'Reason', text: (row) => row.reason },
  ];

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async decide(item: LeaveRequest, decision: 'approved' | 'rejected'): Promise<void> {
    await this.post('/v1/leave/' + item.id + '/decide', decision);
  }

  async decideExit(item: { id: string }, decision: 'accepted' | 'declined'): Promise<void> {
    this.error = '';
    try {
      await this.api.post('/v1/exits/' + item.id + '/decide', { decision });
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not update the resignation.';
    }
  }
  async decideTime(item: TimeRequest, decision: 'approved' | 'rejected'): Promise<void> {
    await this.post('/v1/attendance/requests/' + item.id + '/decide', decision);
  }

  when(iso: string): string {
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
  }

  async decideDetails(item: DetailChange, decision: 'approved' | 'rejected'): Promise<void> {
    this.error = '';
    this.busy = true;
    try {
      await this.api.post('/v1/detail-changes/' + item.id + '/decide', { decision, note: this.notes[item.id] || '' });
      this.details = await this.api.get<DetailChange[]>('/v1/detail-changes');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not decide that change.';
    } finally {
      this.busy = false;
    }
  }

  private async post(path: string, decision: 'approved' | 'rejected'): Promise<void> {
    this.error = '';
    try {
      await this.api.post(path, { decision });
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not update the request.';
    }
  }

  private async load(): Promise<void> {
    this.api.get<DetailChange[]>('/v1/detail-changes').then((rows) => (this.details = rows)).catch(() => (this.details = null));
    try {
      const [leave, time, exits] = await Promise.all([
        this.api.get<{ queue: LeaveRequest[] }>('/v1/leave'),
        this.api.get<TimeRequest[]>('/v1/attendance/queue'),
        this.api.get<{ pending: ExitRow[] }>('/v1/exits'),
      ]);
      this.queue = leave.queue;
      this.time = time;
      this.exits = exits.pending;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load approvals.';
    }
  }
}
