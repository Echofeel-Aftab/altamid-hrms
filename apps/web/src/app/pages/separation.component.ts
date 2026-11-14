import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { dayLabel, errorText, inr, saveBlob } from '../shared/kit';
import { ModalComponent } from '../shared/modal.component';
import { Sweet } from '../shared/sweet';
import { Toast } from '../shared/toast';

interface CheckItem { id: string; title: string; owner: string; done: boolean; doneBy: string; doneAt: string; auto?: string }
interface SettleLine { key: string; label: string; side: 'earning' | 'deduction'; amount: number; auto: boolean; note: string }
interface Interview { reasons: string[]; ratings: Record<string, number>; recommend: number; rejoin: string; liked: string; improve: string; at: string; done?: boolean }
interface Row {
  id: string; employeeId: string; name: string; code: string; department: string; designation: string; lastDay: string; status: string;
  stage: 'pending' | 'accepted' | 'closed' | 'other'; initiatedBy: string; waived: boolean; checks: { done: number; total: number };
  interviewDone: boolean; settlement: string; closed: boolean; raisedOn: string;
}
interface Detail extends Omit<Row, 'settlement'> {
  reason: string; note: string; overrideNote: string; originalLastDay: string;
  person: { id: string; name: string; code: string; department: string; designation: string; manager: string; joined: string; status: string };
  notice: { required: number; served: number; shortfall: number; waived: boolean };
  checklist: CheckItem[];
  interview: Interview | null;
  settlement: { lines: SettleLine[]; status: string; payDate: string; note: string; by: string; at: string; net: number } | null;
  suggestion: SettleLine[] | null;
  letters: string[];
  canClose: boolean;
  desk: boolean;
}
interface Board {
  canDesk: boolean; noticeDays: number; suggestedLastDay: string; reasons: string[]; ratings: Array<{ key: string; label: string }>;
  mine: Detail | null; counts: Record<string, number>; rows: Row[]; people: Array<{ id: string; name: string; code: string }>;
}

const LETTERS: Record<string, string> = { relieving: 'Relieving letter', experience: 'Experience letter', settlement: 'Full and final statement' };

@Component({
  selector: 'app-separation',
  imports: [FormsModule, ModalComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-box-arrow-right"></i></span>
        <p class="eyebrow">People</p>
        <h1>Separation</h1>
        <p class="lede">Resignation, notice period, the exit checklist, exit interview, full and final settlement and your relieving letters, in one place.</p>
      </div>
      @if (board?.canDesk && tab === 'desk') { <button type="button" class="btn btn-gold" (click)="startOpen = true"><i class="bi bi-plus-lg"></i> Start an exit</button> }
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (board?.canDesk) {
      <div class="seg-mini mx-tabs" role="tablist">
        <button type="button" role="tab" [class.is-active]="tab === 'mine'" (click)="tab = 'mine'"><i class="bi bi-person"></i> My exit</button>
        <button type="button" role="tab" [class.is-active]="tab === 'desk'" (click)="tab = 'desk'"><i class="bi bi-clipboard2-data"></i> Exits desk</button>
      </div>
    }

    @if (board && tab === 'mine') {
      @if (!board.mine) {
        <section class="card mx-narrow">
          <h2><i class="bi bi-envelope-paper"></i> Resign</h2>
          <p class="muted">Your notice period is {{ board.noticeDays }} days, so your last working day would be {{ day(board.suggestedLastDay) }}. Your manager or HR accepts the resignation.</p>
          <label for="resign-day">Last working day</label>
          <input id="resign-day" type="date" [(ngModel)]="resign.lastDay">
          <label for="resign-reason">Reason</label>
          <textarea id="resign-reason" rows="3" maxlength="400" [(ngModel)]="resign.reason" placeholder="A short reason for HR"></textarea>
          <div class="actions mx-row-gap"><button type="button" class="btn btn-gold" (click)="submitResignation()" [disabled]="busy"><i class="bi bi-send"></i> Send resignation</button></div>
        </section>
      } @else {
        <section class="card">
          <div class="card-head">
            <h2><i class="bi bi-signpost-2"></i> Your exit</h2>
            <span class="chip" [class]="'chip ' + stageTone(board.mine)">{{ stageLabel(board.mine) }}</span>
          </div>
          <ol class="mx-steps">
            @for (step of steps(board.mine); track step.label) {
              <li [class.is-done]="step.done" [class.is-now]="step.now"><span><i class="bi" [class]="step.done ? 'bi-check-lg' : step.icon"></i></span><strong>{{ step.label }}</strong><small>{{ step.text }}</small></li>
            }
          </ol>
          <div class="field-grid mx-facts">
            <div><small>Last working day</small><strong>{{ day(board.mine.lastDay) }}</strong></div>
            <div><small>Notice</small><strong>{{ board.mine.notice.waived ? 'Waived' : board.mine.notice.served + ' of ' + board.mine.notice.required + ' days' }}</strong></div>
          </div>
          @if (board.mine.status === 'pending') {
            <div class="actions mx-row-gap"><button type="button" class="btn btn-ghost" (click)="cancelMine()" [disabled]="busy"><i class="bi bi-x-circle"></i> Take back my resignation</button></div>
          }
        </section>
        @if (board.mine.status === 'accepted') {
          <div class="page-split">
            <div>
              @if (!board.mine.interview) {
                <section class="card">
                  <h2><i class="bi bi-chat-square-heart"></i> Exit interview</h2>
                  <p class="muted">Tell us honestly how it was. Only HR reads this.</p>
                  <label>Why are you leaving? Choose up to five.</label>
                  <div class="chip-row">
                    @for (reason of board.reasons; track reason) {
                      <button type="button" class="chip" [class.is-on]="interview.reasons.includes(reason)" (click)="toggleReason(reason)">{{ reason }}</button>
                    }
                  </div>
                  @for (rating of board.ratings; track rating.key) {
                    <label>{{ rating.label }}</label>
                    <div class="mx-stars" role="radiogroup" [attr.aria-label]="rating.label">
                      @for (n of [1, 2, 3, 4, 5]; track n) {
                        <button type="button" role="radio" [attr.aria-checked]="interview.ratings[rating.key] === n" [class.is-on]="(interview.ratings[rating.key] || 0) >= n" (click)="interview.ratings[rating.key] = n"><i class="bi bi-star-fill"></i></button>
                      }
                    </div>
                  }
                  <label>How likely are you to recommend us as a place to work? (0 to 10)</label>
                  <div class="mx-scale">
                    @for (n of zeroToTen; track n) { <button type="button" [class.is-on]="interview.recommend === n" (click)="interview.recommend = n">{{ n }}</button> }
                  </div>
                  <label>Would you come back one day?</label>
                  <div class="chip-row">
                    @for (option of ['yes', 'maybe', 'no']; track option) { <button type="button" class="chip" [class.is-on]="interview.rejoin === option" (click)="interview.rejoin = option">{{ option === 'yes' ? 'Yes' : option === 'maybe' ? 'Maybe' : 'No' }}</button> }
                  </div>
                  <label for="ix-liked">What did you like most?</label>
                  <textarea id="ix-liked" rows="2" maxlength="1500" [(ngModel)]="interview.liked"></textarea>
                  <label for="ix-improve">What should we do better?</label>
                  <textarea id="ix-improve" rows="2" maxlength="1500" [(ngModel)]="interview.improve"></textarea>
                  <div class="actions mx-row-gap"><button type="button" class="btn btn-gold" (click)="sendInterview()" [disabled]="busy"><i class="bi bi-send"></i> Send</button></div>
                </section>
              } @else {
                <section class="card"><h2><i class="bi bi-chat-square-heart"></i> Exit interview</h2><p class="muted"><i class="bi bi-check-circle-fill mx-ok"></i> Sent. Thank you for your honest feedback.</p></section>
              }
              @if (board.mine.settlement) {
                <section class="card">
                  <div class="card-head"><h2><i class="bi bi-cash-coin"></i> Full and final settlement</h2><strong class="mx-net" [class.is-bad]="board.mine.settlement.net < 0">{{ money(board.mine.settlement.net) }}</strong></div>
                  <table>
                    <tbody>
                      @for (line of board.mine.settlement.lines; track line.key) {
                        <tr><td>{{ line.label }}</td><td class="mx-right" [class.mx-minus]="line.side === 'deduction'">{{ line.side === 'deduction' ? '-' : '' }}{{ money(line.amount) }}</td></tr>
                      }
                    </tbody>
                  </table>
                  <p class="muted mx-fine">Paid on {{ day(board.mine.settlement.payDate) }}.</p>
                </section>
              }
            </div>
            <div class="dash-side">
              <section class="card">
                <h2><i class="bi bi-list-check"></i> Exit checklist</h2>
                <ul class="mx-checks">
                  @for (item of board.mine.checklist; track item.id) {
                    <li [class.is-done]="item.done"><i class="bi" [class]="item.done ? 'bi-check-circle-fill' : 'bi-circle'"></i><span>{{ item.title }}<small>{{ item.owner }}@if (item.done && item.doneAt) { · {{ day(item.doneAt) }} }</small></span></li>
                  }
                </ul>
              </section>
              <section class="card">
                <h2><i class="bi bi-file-earmark-text"></i> Your letters</h2>
                @if (board.mine.letters.length) {
                  <div class="mx-letter-list">
                    @for (kind of board.mine.letters; track kind) { <button type="button" class="btn btn-ghost" (click)="letter(board.mine, kind)"><i class="bi bi-download"></i> {{ letterName(kind) }}</button> }
                  </div>
                } @else {
                  <p class="muted">Your relieving and experience letters open after your last working day.</p>
                }
              </section>
            </div>
          </div>
        }
      }
    }

    @if (board && tab === 'desk' && board.canDesk) {
      <div class="mx-stats">
        @for (stat of deskStats; track stat.key) {
          <button type="button" class="mx-stat" [class.is-on]="deskFilter === stat.key" (click)="deskFilter = deskFilter === stat.key ? '' : stat.key">
            <span class="mx-stat-ico" [class]="'mx-stat-ico ' + stat.tone"><i class="bi" [class]="stat.icon"></i></span>
            <strong>{{ board.counts[stat.key] || 0 }}</strong><small>{{ stat.label }}</small>
          </button>
        }
      </div>
      <section class="card">
        <div class="table-responsive">
          <table>
            <thead><tr><th>Person</th><th>Raised</th><th>Last day</th><th>Stage</th><th>Checklist</th><th>Interview</th><th>Full and final</th><th></th></tr></thead>
            <tbody>
              @for (row of deskRows(); track row.id) {
                <tr>
                  <td><strong>{{ row.name }}</strong><br><small>{{ row.code }}@if (row.designation) { · {{ row.designation }} }@if (row.initiatedBy === 'hr') { · started by HR }</small></td>
                  <td>{{ day(row.raisedOn) }}</td>
                  <td>{{ day(row.lastDay) }}@if (row.waived) { <br><small>Notice waived</small> }</td>
                  <td><span class="chip" [class]="'chip ' + stageTone(row)">{{ stageLabel(row) }}</span></td>
                  <td>@if (row.checks.total) { {{ row.checks.done }}/{{ row.checks.total }} } @else { — }</td>
                  <td>@if (row.interviewDone) { <i class="bi bi-check-circle-fill mx-ok"></i> } @else { — }</td>
                  <td>{{ row.settlement === 'final' ? 'Final' : row.settlement === 'draft' ? 'Draft' : '—' }}</td>
                  <td><button type="button" class="btn btn-ghost btn-sm" (click)="open(row.id)">Open</button></td>
                </tr>
              } @empty { <tr><td colspan="8" class="muted">No exits here.</td></tr> }
            </tbody>
          </table>
        </div>
      </section>
    }

    <app-modal [open]="startOpen" size="md" title="Start an exit" subtitle="For a resignation by email, or when the company ends the employment." icon="bi-box-arrow-right" tone="warn" (closed)="startOpen = false">
      <label for="st-person">Person</label>
      <select id="st-person" [(ngModel)]="start.employeeId">
        <option value="">Choose someone</option>
        @for (person of board?.people || []; track person.id) { <option [value]="person.id">{{ person.name }} · {{ person.code }}</option> }
      </select>
      <label for="st-kind">Type</label>
      <select id="st-kind" [(ngModel)]="start.kind">
        <option value="resigned">Resigned</option>
        <option value="terminated">Ended by the company</option>
        <option value="absconded">Stopped coming to work</option>
      </select>
      <label for="st-day">Last working day</label>
      <input id="st-day" type="date" [(ngModel)]="start.lastDay">
      <label for="st-reason">Reason</label>
      <textarea id="st-reason" rows="2" maxlength="400" [(ngModel)]="start.reason"></textarea>
      <label class="check"><input type="checkbox" [(ngModel)]="start.waive"> Waive the rest of the notice period</label>
      <label for="st-note">Internal note</label>
      <input id="st-note" maxlength="400" [(ngModel)]="start.note">
      <footer modalFooter class="md-foot">
        <button type="button" class="btn btn-ghost" (click)="startOpen = false">Cancel</button>
        <button type="button" class="btn btn-gold" (click)="startExit()" [disabled]="busy"><i class="bi bi-check2"></i> Start the exit</button>
      </footer>
    </app-modal>

    <app-modal [open]="!!detail" size="xl" [title]="detail ? detail.person.name : ''" [subtitle]="detail ? detail.person.code + ' · ' + (detail.person.designation || 'Team member') + (detail.person.manager ? ' · reports to ' + detail.person.manager : '') : ''" icon="bi-box-arrow-right" tone="navy" (closed)="detail = null">
      @if (detail) {
        <div class="field-grid mx-facts">
          <div><small>Stage</small><strong><span class="chip" [class]="'chip ' + stageTone(detail)">{{ stageLabel(detail) }}</span></strong></div>
          <div><small>Last working day</small><strong>{{ day(detail.lastDay) }}@if (detail.originalLastDay && detail.originalLastDay !== detail.lastDay) { <small> (was {{ day(detail.originalLastDay) }})</small> }</strong></div>
          <div><small>Joined</small><strong>{{ day(detail.person.joined) }}</strong></div>
          <div><small>Notice</small><strong>{{ detail.notice.waived ? 'Waived' : detail.notice.served + ' of ' + detail.notice.required + ' days' }}@if (detail.notice.shortfall) { <small> · {{ detail.notice.shortfall }} short</small> }</strong></div>
          <div class="span-2"><small>Reason</small><strong>{{ detail.reason }}</strong></div>
          @if (detail.overrideNote) { <div class="span-2"><small>Changes</small><pre class="mx-history">{{ detail.overrideNote }}</pre></div> }
        </div>

        @if (!detail.closed && (detail.status === 'pending' || detail.status === 'accepted')) {
          <section class="mx-panel">
            <h3><i class="bi bi-pencil-square"></i> Change this exit</h3>
            <div class="chip-row">
              @if (detail.status === 'pending') {
                <button type="button" class="chip" [class.is-on]="change.action === 'accept'" (click)="change.action = 'accept'">Accept</button>
                <button type="button" class="chip" [class.is-on]="change.action === 'decline'" (click)="change.action = 'decline'">Decline</button>
              }
              <button type="button" class="chip" [class.is-on]="change.action === 'change'" (click)="change.action = 'change'">Change the last day or waive notice</button>
              <button type="button" class="chip" [class.is-on]="change.action === 'withdraw'" (click)="change.action = 'withdraw'">Withdraw the exit</button>
            </div>
            @if (change.action === 'change') {
              <div class="field-grid">
                <div><label for="ch-day">New last working day</label><input id="ch-day" type="date" [(ngModel)]="change.lastDay"></div>
                <div><label class="check mx-check"><input type="checkbox" [(ngModel)]="change.waive"> Waive the rest of the notice</label></div>
              </div>
            }
            @if (change.action) {
              <label for="ch-note">Reason for the change</label>
              <input id="ch-note" maxlength="400" [(ngModel)]="change.note" placeholder="Kept in the exit’s history">
              <div class="actions mx-row-gap"><button type="button" class="btn btn-primary" (click)="applyChange()" [disabled]="busy"><i class="bi bi-check2"></i> Apply</button></div>
            }
          </section>
        }

        @if (detail.status === 'accepted') {
          <div class="mx-two">
            <section class="mx-panel">
              <h3><i class="bi bi-list-check"></i> Checklist · {{ doneCount(detail) }}/{{ detail.checklist.length }}</h3>
              <ul class="mx-checks is-edit">
                @for (item of detail.checklist; track item.id) {
                  <li [class.is-done]="item.done">
                    <label class="check"><input type="checkbox" [checked]="item.done" [disabled]="busy || detail.closed || item.auto === 'interview' || item.auto === 'settlement'" (change)="toggle(item, $any($event.target).checked)"> {{ item.title }}</label>
                    <small>{{ item.owner }}@if (item.done && item.doneBy) { · {{ item.doneBy }} }</small>
                  </li>
                }
              </ul>
              @if (!detail.closed) {
                <div class="mx-inline">
                  <input [(ngModel)]="newCheck" maxlength="120" placeholder="Add an item" aria-label="New checklist item">
                  <button type="button" class="btn btn-ghost btn-sm" (click)="addCheck()" [disabled]="!newCheck.trim() || busy"><i class="bi bi-plus-lg"></i> Add</button>
                </div>
              }
            </section>
            <section class="mx-panel">
              <h3><i class="bi bi-chat-square-heart"></i> Exit interview</h3>
              @if (detail.interview) {
                <p><strong>Reasons:</strong> {{ detail.interview.reasons.join(', ') }}</p>
                <div class="mx-mini-bars">
                  @for (rating of board?.ratings || []; track rating.key) {
                    <div><span>{{ rating.label }}</span><div class="mx-bar"><span [style.width.%]="(detail.interview.ratings[rating.key] || 0) * 20"></span></div><b>{{ detail.interview.ratings[rating.key] }}/5</b></div>
                  }
                </div>
                <p><strong>Would recommend:</strong> {{ detail.interview.recommend }}/10 · <strong>Would come back:</strong> {{ detail.interview.rejoin }}</p>
                @if (detail.interview.liked) { <p><strong>Liked:</strong> {{ detail.interview.liked }}</p> }
                @if (detail.interview.improve) { <p><strong>Do better:</strong> {{ detail.interview.improve }}</p> }
              } @else {
                <p class="muted">Not sent yet. The person sees the form on their Separation page.</p>
              }
            </section>
          </div>

          <section class="mx-panel">
            <div class="card-head"><h3><i class="bi bi-cash-coin"></i> Full and final settlement</h3><strong class="mx-net" [class.is-bad]="settleNet() < 0">Net {{ money(settleNet()) }}</strong></div>
            @if (detail.settlement?.status === 'final') {
              <p class="muted">Final, paid on {{ day(detail.settlement?.payDate || '') }} · by {{ detail.settlement?.by }}</p>
            } @else if (detail.suggestion && !detail.settlement) {
              <p class="mx-note"><i class="bi bi-magic"></i> Lines below are worked out from the CTC, the leave balance and the notice served. Check each one.</p>
            }
            <div class="table-responsive">
              <table class="mx-settle">
                <thead><tr><th>Line</th><th>Type</th><th>Amount</th><th></th></tr></thead>
                <tbody>
                  @for (line of settle.lines; track $index) {
                    <tr>
                      <td><input [(ngModel)]="line.label" maxlength="80" [disabled]="settleLocked()" aria-label="Line"><small>{{ line.note }}</small></td>
                      <td><select [(ngModel)]="line.side" [disabled]="settleLocked()" aria-label="Type"><option value="earning">Payable</option><option value="deduction">Recovery</option></select></td>
                      <td><input type="number" min="0" class="mx-num" [(ngModel)]="line.amount" [disabled]="settleLocked()" aria-label="Amount"></td>
                      <td>@if (!settleLocked()) { <button type="button" class="mx-x" (click)="settle.lines.splice($index, 1)" aria-label="Remove line"><i class="bi bi-trash"></i></button> }</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            @if (!settleLocked()) {
              <div class="actions mx-row-gap">
                <button type="button" class="btn btn-ghost btn-sm" (click)="addLine('earning')"><i class="bi bi-plus-lg"></i> Payable line</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="addLine('deduction')"><i class="bi bi-dash-lg"></i> Recovery line</button>
              </div>
              <div class="field-grid">
                <div><label for="fnf-date">Payment date</label><input id="fnf-date" type="date" [(ngModel)]="settle.payDate"></div>
                <div><label for="fnf-note">Note on the statement</label><input id="fnf-note" maxlength="400" [(ngModel)]="settle.note"></div>
              </div>
            }
            <div class="actions mx-row-gap">
              @if (settleLocked()) {
                @if (!detail.closed) { <button type="button" class="btn btn-ghost" (click)="saveSettle(false, true)" [disabled]="busy"><i class="bi bi-unlock"></i> Reopen</button> }
              } @else {
                <button type="button" class="btn btn-ghost" (click)="saveSettle(false)" [disabled]="busy"><i class="bi bi-save"></i> Save draft</button>
                <button type="button" class="btn btn-gold" (click)="saveSettle(true)" [disabled]="busy"><i class="bi bi-lock"></i> Make final</button>
              }
            </div>
          </section>
        }
      }
      <footer modalFooter class="md-foot">
        @if (detail?.letters?.length) {
          @for (kind of detail?.letters || []; track kind) { <button type="button" class="btn btn-ghost" (click)="letter(detail!, kind)"><i class="bi bi-download"></i> {{ letterName(kind) }}</button> }
        }
        <button type="button" class="btn btn-ghost" (click)="detail = null">Close</button>
        @if (detail?.canClose) { <button type="button" class="btn btn-danger-solid" (click)="closeExit()" [disabled]="busy"><i class="bi bi-door-closed"></i> End employment</button> }
      </footer>
    </app-modal>
  `,
})
export class SeparationComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly toast = inject(Toast);
  readonly zeroToTen = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  readonly deskStats = [
    { key: 'pending', label: 'Waiting for a decision', icon: 'bi-hourglass-split', tone: 'is-warn' },
    { key: 'accepted', label: 'Serving notice', icon: 'bi-calendar2-range', tone: 'is-info' },
    { key: 'closed', label: 'Closed', icon: 'bi-door-closed', tone: 'is-ok' },
    { key: 'other', label: 'Declined or withdrawn', icon: 'bi-arrow-counterclockwise', tone: '' },
  ];
  board: Board | null = null;
  tab: 'mine' | 'desk' = 'mine';
  deskFilter = '';
  detail: Detail | null = null;
  startOpen = false;
  start = { employeeId: '', kind: 'resigned', lastDay: '', reason: '', waive: false, note: '' };
  resign = { lastDay: '', reason: '' };
  interview: Interview = { reasons: [], ratings: {}, recommend: -1, rejoin: '', liked: '', improve: '', at: '' };
  change = { action: '', lastDay: '', waive: false, note: '' };
  settle = { lines: [] as SettleLine[], payDate: '', note: '' };
  newCheck = '';
  busy = false;
  error = '';

  async ngOnInit(): Promise<void> {
    await this.load();
    if (this.board?.canDesk && !this.board.mine) this.tab = 'desk';
  }

  async load(): Promise<void> {
    try {
      this.board = await this.api.get<Board>('/v1/separation');
      this.resign.lastDay ||= this.board.suggestedLastDay;
      this.start.lastDay ||= this.board.suggestedLastDay;
      this.error = '';
    } catch (error) {
      this.error = errorText(error, 'Could not load separation.');
    }
  }

  money(value: number): string { return inr(value); }
  day(value: string): string { return dayLabel(value); }
  letterName(kind: string): string { return LETTERS[kind] || kind; }
  doneCount(detail: Detail): number { return detail.checklist.filter((item) => item.done).length; }
  deskRows(): Row[] { return (this.board?.rows || []).filter((row) => !this.deskFilter || row.stage === this.deskFilter); }

  stageLabel(row: Pick<Row, 'closed' | 'status'>): string {
    if (row.closed) return 'Closed';
    if (row.status === 'pending') return 'Waiting for a decision';
    if (row.status === 'accepted') return 'Serving notice';
    return row.status === 'declined' ? 'Declined' : row.status === 'withdrawn' ? 'Withdrawn' : 'Cancelled';
  }

  stageTone(row: Pick<Row, 'closed' | 'status'>): string {
    if (row.closed) return 'is-ok';
    if (row.status === 'pending') return 'is-warn';
    if (row.status === 'accepted') return 'is-info';
    return '';
  }

  steps(row: Detail) {
    const accepted = row.status === 'accepted';
    const checks = row.checklist.filter((item) => !item.auto || item.auto.startsWith('asset')).every((item) => item.done) && row.checklist.length > 0;
    return [
      { label: 'Resigned', text: this.day(row.raisedOn), done: true, now: false, icon: 'bi-envelope' },
      { label: 'Accepted', text: accepted ? 'By ' + (row.status === 'accepted' ? 'HR or your manager' : '') : 'Waiting', done: accepted, now: row.status === 'pending', icon: 'bi-hand-thumbs-up' },
      { label: 'Handover', text: accepted ? `${row.checklist.filter((item) => item.done).length} of ${row.checklist.length} done` : '', done: accepted && checks, now: accepted && !checks, icon: 'bi-list-check' },
      { label: 'Exit interview', text: row.interview ? 'Sent' : accepted ? 'Your turn' : '', done: !!row.interview, now: accepted && !row.interview, icon: 'bi-chat-square-heart' },
      { label: 'Full and final', text: row.settlement ? this.day(row.settlement.payDate) : '', done: !!row.settlement, now: false, icon: 'bi-cash-coin' },
      { label: 'Relieved', text: this.day(row.lastDay), done: row.closed, now: false, icon: 'bi-door-open' },
    ];
  }

  async submitResignation(): Promise<void> {
    if (!this.resign.reason.trim()) { this.toast.warning('Add a short reason.'); return; }
    if (!(await this.sweet.confirm({ title: 'Send your resignation?', text: `Last working day ${this.day(this.resign.lastDay)}. You can take it back while it is waiting.`, confirmText: 'Send', danger: true }))) return;
    this.busy = true;
    try {
      await this.api.post('/v1/exits', this.resign);
      this.toast.success('Your resignation was sent.');
      await this.load();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not send your resignation.'));
    }
    this.busy = false;
  }

  async cancelMine(): Promise<void> {
    if (!this.board?.mine || !(await this.sweet.confirm({ title: 'Take back your resignation?', confirmText: 'Take it back' }))) return;
    this.busy = true;
    try {
      await this.api.post(`/v1/exits/${this.board.mine.id}/cancel`);
      this.toast.success('Your resignation was taken back.');
      await this.load();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not take it back.'));
    }
    this.busy = false;
  }

  toggleReason(reason: string): void {
    const list = this.interview.reasons;
    const index = list.indexOf(reason);
    if (index >= 0) list.splice(index, 1);
    else if (list.length < 5) list.push(reason);
  }

  async sendInterview(): Promise<void> {
    if (!this.board?.mine) return;
    this.busy = true;
    try {
      await this.api.post(`/v1/separation/${this.board.mine.id}/interview`, this.interview);
      this.toast.success('Thank you. Your exit interview was sent.');
      await this.load();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not send the exit interview.'));
    }
    this.busy = false;
  }

  async open(id: string): Promise<void> {
    try {
      this.show(await this.api.get<Detail>('/v1/separation/' + id));
    } catch (error) {
      this.toast.error(errorText(error, 'Could not open that exit.'));
    }
  }

  async startExit(): Promise<void> {
    this.busy = true;
    try {
      const saved = await this.api.post<Detail>('/v1/separation/start', this.start);
      this.startOpen = false;
      this.start = { employeeId: '', kind: 'resigned', lastDay: this.board?.suggestedLastDay || '', reason: '', waive: false, note: '' };
      this.toast.success(`Exit started for ${saved.person.name}.`);
      await this.load();
      this.show(saved);
    } catch (error) {
      this.toast.error(errorText(error, 'Could not start the exit.'));
    }
    this.busy = false;
  }

  async applyChange(): Promise<void> {
    if (!this.detail) return;
    if (!this.change.note.trim()) { this.toast.warning('Give a reason for the change.'); return; }
    this.busy = true;
    try {
      this.show(await this.api.post<Detail>(`/v1/separation/${this.detail.id}/override`, this.change));
      this.toast.success('Exit updated.');
      await this.load();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not change the exit.'));
    }
    this.busy = false;
  }

  async toggle(item: CheckItem, done: boolean): Promise<void> {
    if (!this.detail) return;
    await this.checklist({ itemId: item.id, done });
  }

  async addCheck(): Promise<void> {
    await this.checklist({ add: this.newCheck.trim(), owner: 'HR' });
    this.newCheck = '';
  }

  settleLocked(): boolean { return this.detail?.settlement?.status === 'final'; }
  settleNet(): number { return this.settle.lines.reduce((sum, line) => sum + (line.side === 'earning' ? 1 : -1) * (Number(line.amount) || 0), 0); }
  addLine(side: 'earning' | 'deduction'): void { this.settle.lines.push({ key: 'line' + Date.now(), label: side === 'earning' ? 'Bonus or arrears' : 'Recovery', side, amount: 0, auto: false, note: '' }); }

  async saveSettle(final: boolean, reopen = false): Promise<void> {
    if (!this.detail) return;
    if (final && !(await this.sweet.confirm({ title: 'Make the settlement final?', text: `Net ${this.money(this.settleNet())}. ${this.detail.person.name.split(' ')[0]} is told and can download the statement.`, confirmText: 'Make final' }))) return;
    this.busy = true;
    try {
      this.show(await this.api.post<Detail>(`/v1/separation/${this.detail.id}/settlement`, reopen ? { reopen: true } : { ...this.settle, final }));
      this.toast.success(reopen ? 'Settlement reopened.' : final ? 'Settlement is final.' : 'Draft saved.');
      await this.load();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not save the settlement.'));
    }
    this.busy = false;
  }

  async closeExit(): Promise<void> {
    if (!this.detail || !(await this.sweet.confirm({ title: `End ${this.detail.person.name}’s employment?`, text: 'They become Exited and their sign-in stops working.', confirmText: 'End employment', danger: true }))) return;
    this.busy = true;
    try {
      this.show(await this.api.post<Detail>(`/v1/separation/${this.detail.id}/close`));
      this.toast.success('Employment ended.');
      await this.load();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not close the exit.'));
    }
    this.busy = false;
  }

  async letter(row: Detail, kind: string): Promise<void> {
    try {
      saveBlob(await this.api.blob(`/v1/separation/${row.id}/letter/${kind}`), `${kind}-${row.person.code}.pdf`);
    } catch (error) {
      this.toast.error(errorText(error, 'Could not make that letter.'));
    }
  }

  private async checklist(body: Record<string, unknown>): Promise<void> {
    if (!this.detail) return;
    this.busy = true;
    try {
      this.show(await this.api.post<Detail>(`/v1/separation/${this.detail.id}/checklist`, body), true);
    } catch (error) {
      this.toast.error(errorText(error, 'Could not update the checklist.'));
    }
    this.busy = false;
  }

  private show(detail: Detail, keepSettle = false): void {
    this.detail = detail;
    this.change = { action: '', lastDay: detail.lastDay, waive: detail.notice.waived, note: '' };
    if (!keepSettle) {
      const source = detail.settlement?.lines || detail.suggestion || [];
      this.settle = { lines: source.map((line) => ({ ...line })), payDate: detail.settlement?.payDate || '', note: detail.settlement?.note || '' };
    }
  }
}
