import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { DataColumn, DataTableComponent, RowActionsDirective } from '../shared/data-table.component';

type ApprovalKind = 'leave' | 'attendance' | 'resignation' | 'details' | '';
type BoardTab = 'waiting' | 'history';

interface ApprovalField {
  key: string;
  label: string;
  before: string;
  after: string;
}

interface ApprovalRow {
  id: string;
  kind: Exclude<ApprovalKind, ''>;
  kindLabel: string;
  person: string;
  personCode: string;
  employeeId: string;
  title: string;
  when: string;
  meta: string;
  reason: string;
  status: string;
  statusLabel: string;
  stageLabel: string;
  stageSub: string;
  sentAt: string;
  decidedAt: string;
  canDecide: boolean;
  fields: ApprovalField[];
  own: boolean;
}

interface ApprovalsBoard {
  waiting: ApprovalRow[];
  history: ApprovalRow[];
  counts: { waiting: number; leave: number; attendance: number; resignation: number; details: number; history: number };
}

@Component({
  selector: 'app-approvals',
  imports: [DataTableComponent, RowActionsDirective, FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-check2-square"></i></span>
        <p class="eyebrow">My team</p>
        <h1>Approvals</h1>
        <p class="lede">Leave, attendance, resignations, and pay detail changes in one place. Filter by type, then open History for everything you have already decided.</p>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }

    <div class="seg-tabs approvals-tabs" role="tablist" aria-label="Approvals view">
      <button type="button" role="tab" [class.is-on]="tab === 'waiting'" (click)="setTab('waiting')">
        Waiting @if (counts.waiting) { <span class="chip is-warn">{{ counts.waiting }}</span> }
      </button>
      <button type="button" role="tab" [class.is-on]="tab === 'history'" (click)="setTab('history')">
        History @if (counts.history) { <span class="chip">{{ counts.history }}</span> }
      </button>
    </div>

    <app-data-table
      tableId="approvals-board"
      [title]="tab === 'waiting' ? 'Waiting for a decision' : 'Approval history'"
      [hint]="tab === 'waiting' ? 'Approve or reject from the Actions column. Pay detail changes may need a short reject reason.' : 'Decided leave, attendance, resignations, and pay detail changes you can see.'"
      [empty]="tab === 'waiting' ? 'Nothing is waiting right now.' : 'No decided requests yet.'"
      [rows]="visible"
      [columns]="columns"
      [loading]="loading">
      <div tableFilter class="people-filters approvals-filters">
        <label class="sr" for="appr-kind">Type</label>
        <select id="appr-kind" [(ngModel)]="kind" (ngModelChange)="applyFilter()">
          <option value="">All types</option>
          <option value="leave">Leave{{ counts.leave && tab === 'waiting' ? ' (' + counts.leave + ')' : '' }}</option>
          <option value="attendance">Attendance{{ counts.attendance && tab === 'waiting' ? ' (' + counts.attendance + ')' : '' }}</option>
          <option value="resignation">Resignation{{ counts.resignation && tab === 'waiting' ? ' (' + counts.resignation + ')' : '' }}</option>
          <option value="details">Pay details{{ counts.details && tab === 'waiting' ? ' (' + counts.details + ')' : '' }}</option>
        </select>
      </div>
      <ng-template appRowActions let-item>
        @if (item.kind === 'details' && item.fields?.length) {
          <button class="btn btn-ghost btn-sm" type="button" (click)="expanded = item"><i class="bi bi-eye"></i> Changes</button>
        }
        @if (tab === 'waiting' && item.canDecide) {
          @if (item.kind === 'resignation') {
            <button class="btn btn-sm" type="button" [disabled]="busy" (click)="decide(item, 'accepted')">Accept</button>
            <button class="btn btn-ghost btn-sm" type="button" [disabled]="busy" (click)="decide(item, 'declined')">Decline</button>
          } @else if (item.kind === 'details') {
            <button class="btn btn-sm" type="button" [disabled]="busy" (click)="decide(item, 'approved')">Approve</button>
            <button class="btn btn-ghost btn-sm btn-danger" type="button" [disabled]="busy" (click)="decide(item, 'rejected')">Reject</button>
          } @else {
            <button class="btn btn-sm" type="button" [disabled]="busy" (click)="decide(item, 'approved')">Approve</button>
            <button class="btn btn-ghost btn-sm" type="button" [disabled]="busy" (click)="decide(item, 'rejected')">Reject</button>
          }
        } @else if (tab === 'waiting' && item.own) {
          <span class="muted">Needs another approver</span>
        } @else if (tab === 'history') {
          <span class="chip" [class.is-ok]="item.status === 'approved' || item.status === 'accepted'" [class.is-bad]="item.status === 'rejected' || item.status === 'declined'">{{ item.statusLabel }}</span>
        }
      </ng-template>
    </app-data-table>

    @if (expanded?.fields?.length) {
      <section class="card approval-card">
        <div class="card-head">
          <h2><i class="bi bi-bank"></i> {{ expanded!.person }} · pay detail change</h2>
          <button type="button" class="btn btn-ghost btn-sm" (click)="expanded = null"><i class="bi bi-x-lg"></i> Close</button>
        </div>
        <ul class="diff-list">
          @for (row of expanded!.fields; track row.key) {
            <li>
              <span class="diff-key">{{ row.label }}</span>
              <span class="diff-old">{{ row.before }}</span>
              <i class="bi bi-arrow-right" aria-hidden="true"></i>
              <span class="diff-new">{{ row.after }}</span>
            </li>
          }
        </ul>
        @if (tab === 'waiting' && expanded!.canDecide) {
          <label class="dc-note-label" [attr.for]="'note-' + expanded!.id">Reject reason (optional for approve)</label>
          <input class="dc-note" [id]="'note-' + expanded!.id" [name]="'note-' + expanded!.id" [(ngModel)]="notes[expanded!.id]" placeholder="Required when you reject" aria-label="Reject reason">
          <div class="actions">
            <button class="btn btn-sm" type="button" [disabled]="busy" (click)="decide(expanded!, 'approved')">Approve</button>
            <button class="btn btn-ghost btn-sm btn-danger" type="button" [disabled]="busy" (click)="decide(expanded!, 'rejected')">Reject</button>
          </div>
        }
        <p class="muted"><a [routerLink]="'/people/' + expanded!.employeeId">Open profile</a></p>
      </section>
    }
  `,
  styles: [`
    .approvals-tabs { margin: 0 0 16px; }
    .approvals-tabs .chip { margin-left: 6px; }
    .approvals-filters { align-items: center; }
    :host ::ng-deep .dt-wrap + .approval-card { margin-top: 16px; }
    .dc-note-label { display: block; margin: 12px 0 4px; font-size: 12.5px; font-weight: 600; color: var(--muted); }
    .approval-card .actions { margin-top: 12px; }
  `],
})
export class ApprovalsComponent implements OnInit {
  private readonly api = inject(ApiService);
  waiting: ApprovalRow[] = [];
  history: ApprovalRow[] = [];
  visible: ApprovalRow[] = [];
  counts: ApprovalsBoard['counts'] = { waiting: 0, leave: 0, attendance: 0, resignation: 0, details: 0, history: 0 };
  tab: BoardTab = 'waiting';
  kind: ApprovalKind = '';
  error = '';
  loading = true;
  ok = '';
  busy = false;
  notes: Record<string, string> = {};
  expanded: ApprovalRow | null = null;

  readonly columns: DataColumn<ApprovalRow>[] = [
    { key: 'person', label: 'Person', text: (row) => row.person, sub: (row) => row.personCode, person: (row) => ({ code: row.personCode, name: row.person }), link: (row) => '/people/' + row.employeeId },
    { key: 'kind', label: 'Type', text: (row) => row.kindLabel, pill: true },
    { key: 'title', label: 'Request', text: (row) => row.title, sub: (row) => row.meta || '' },
    { key: 'when', label: 'When', text: (row) => row.when },
    { key: 'stage', label: 'Step', text: (row) => row.stageLabel, sub: (row) => row.stageSub, optional: true },
    { key: 'status', label: 'Status', text: (row) => row.statusLabel, pill: true },
    { key: 'reason', label: 'Reason', text: (row) => row.reason || '—', optional: true },
    {
      key: 'decided',
      label: 'Decided',
      text: (row) => row.decidedAt ? this.when(row.decidedAt) : '—',
      optional: true,
      sort: (row) => row.decidedAt || '',
    },
  ];

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  setTab(tab: BoardTab): void {
    this.tab = tab;
    this.applyFilter();
  }

  applyFilter(): void {
    const source = this.tab === 'waiting' ? this.waiting : this.history;
    this.visible = this.kind ? source.filter((row) => row.kind === this.kind) : source;
  }

  when(iso: string): string {
    if (!iso) return '—';
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
  }

  async decide(item: ApprovalRow, decision: string): Promise<void> {
    this.error = '';
    this.ok = '';
    this.busy = true;
    try {
      if (item.kind === 'leave') {
        await this.api.post('/v1/leave/' + item.id + '/decide', { decision });
      } else if (item.kind === 'attendance') {
        await this.api.post('/v1/attendance/requests/' + item.id + '/decide', { decision });
      } else if (item.kind === 'resignation') {
        await this.api.post('/v1/exits/' + item.id + '/decide', { decision });
      } else {
        await this.api.post('/v1/detail-changes/' + item.id + '/decide', { decision, note: this.notes[item.id] || '' });
      }
      this.ok = decision === 'approved' || decision === 'accepted' ? 'Approved.' : decision === 'rejected' || decision === 'declined' ? 'Rejected.' : 'Updated.';
      if (item.kind === 'details' && item.fields?.length) this.expanded = null;
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not update the request.';
    } finally {
      this.busy = false;
    }
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const board = await this.api.get<ApprovalsBoard>('/v1/approvals');
      this.waiting = board.waiting;
      this.history = board.history;
      this.counts = board.counts;
      if (this.expanded) {
        const still = [...this.waiting, ...this.history].find((row) => row.id === this.expanded!.id);
        this.expanded = still?.fields?.length ? still : null;
      }
      this.applyFilter();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load approvals.';
    } finally {
      this.loading = false;
    }
  }
}
