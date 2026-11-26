import { Component, EventEmitter, Input, OnInit, Output, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { SessionStore } from '../core/session.store';
import { LeaveTypePickComponent } from './leave-type-pick.component';
import { ModalComponent } from './modal.component';
import { Toast } from './toast';

interface CalDay {
  day: string;
  status: string;
  label: string;
  punches: Array<{ kind: string; note: string; at: string }>;
  request: { id: string; kind: string; status: string; inTime: string; outTime: string; hours?: string; place: string; reason: string } | null;
}

interface CalendarView {
  month: string;
  year: string;
  today: string;
  shiftStart: string;
  shiftEnd: string;
  leaveTypes: Array<{ id: string; name: string; entitled: number; left: number }>;
  days: CalDay[];
}

type ActionPanel = 'leave' | 'regularization' | 'extratime' | 'wfh' | 'onduty' | '';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Month calendar with multi-day select and leave / regularize / WFH / on-duty / extra-time actions.
 * Used on Home (compact + modals) and can sit inside Attendance.
 */
@Component({
  selector: 'app-attendance-month',
  imports: [FormsModule, LeaveTypePickComponent, ModalComponent],
  template: `
    <section [class]="compact ? 'att-month is-compact card dash-card' : 'att-month card'">
      <div class="card-head att-month-head">
        <div class="att-month-nav">
          <button type="button" class="btn btn-ghost btn-sm" (click)="move(-1)" aria-label="Previous month"><i class="bi bi-chevron-left"></i></button>
          <h2><i class="bi bi-calendar3"></i> {{ monthLabel }}</h2>
          <button type="button" class="btn btn-ghost btn-sm" (click)="move(1)" aria-label="Next month"><i class="bi bi-chevron-right"></i></button>
        </div>
        @if (!compact) {
          <p class="muted att-month-hint">Shift {{ calendar?.shiftStart || '—' }}–{{ calendar?.shiftEnd || '—' }}. Click days to select; click again to remove.</p>
        }
      </div>

      @if (error) { <p class="form-error">{{ error }}</p> }
      @if (ok) { <p class="form-ok">{{ ok }}</p> }

      @if (calendar) {
        <div class="att-month-body">
          <div class="cal-grid" [class.home-cal]="compact" aria-label="Attendance calendar">
            @for (name of dow; track name) { <div class="cal-dow">{{ name }}</div> }
            @for (blank of blanks; track blank) { <div class="cal-day is-pad"></div> }
            @for (day of calendar.days; track day.day) {
              <button
                type="button"
                [class]="'cal-day is-' + day.status + (isPicked(day.day) ? ' is-selected' : '') + (day.day === calendar.today ? ' is-today' : '')"
                [attr.aria-pressed]="isPicked(day.day)"
                [attr.title]="day.label || day.day"
                (click)="choose(day)">
                <strong>{{ dateNumber(day.day) }}</strong>
                @if (compact) { <i></i> } @else { <small>{{ day.label }}</small> }
              </button>
            }
          </div>
          <ul class="cal-legend">
            <li><i class="is-present"></i> Present</li>
            <li><i class="is-absent"></i> Absent</li>
            <li><i class="is-leave"></i> Leave</li>
            <li><i class="is-holiday"></i> Holiday</li>
            <li><i class="is-pending"></i> Waiting</li>
            @if (!compact) {
              <li><i class="is-missed"></i> Missed</li>
              <li><i class="is-onduty"></i> On duty</li>
            }
          </ul>
        </div>

        <div class="att-month-actions">
          @if (!picked.length) {
            <p class="muted att-month-empty">Select one or more days, then apply leave, regularize, or send another request.</p>
          } @else {
            <div class="att-month-picks">
              <div class="att-month-picks-head">
                <strong>{{ selectionLabel }}</strong>
                <button type="button" class="btn btn-ghost btn-sm" (click)="clearDays()">Clear</button>
              </div>
              <div class="day-picks">
                @for (day of picked; track day) {
                  <button type="button" class="day-pick" (click)="drop(day)">{{ shortDay(day) }}</button>
                }
              </div>
              @if (linked) {
                <div class="actions att-month-btns">
                  <button type="button" class="btn btn-primary btn-sm" (click)="openAction('leave')"><i class="bi bi-calendar-plus"></i> Apply leave</button>
                  @if (pastOnly) {
                    <button type="button" class="btn btn-secondary btn-sm" (click)="openAction('regularization')"><i class="bi bi-arrow-repeat"></i> Regularize</button>
                    <button type="button" class="btn btn-ghost btn-sm" (click)="openAction('extratime')"><i class="bi bi-plus-circle"></i> Extra time</button>
                  }
                  <button type="button" class="btn btn-ghost btn-sm" (click)="openAction('wfh')"><i class="bi bi-house"></i> Work from home</button>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="openAction('onduty')"><i class="bi bi-geo-alt"></i> On duty</button>
                </div>
                @if (!pastOnly) {
                  <p class="muted fine">Regularize and extra time stay off while a future day is selected.</p>
                }
              } @else {
                <p class="muted">Ask HR to link this sign-in to a person before sending requests.</p>
              }
            </div>
          }
        </div>
      } @else if (!error) {
        <p class="muted">Loading calendar…</p>
      }
    </section>

    <app-modal
      [open]="!!panel"
      [title]="modalTitle"
      [subtitle]="selectionLabel"
      [icon]="modalIcon"
      tone="navy"
      size="md"
      (closed)="closeAction()">
      @if (panel === 'leave') {
        <form class="day-form" (ngSubmit)="applyLeave()">
          <label for="am-type">Leave type</label>
          <app-leave-type-pick controlId="am-type" [types]="calendar?.leaveTypes || []" [(value)]="leaveTypeId"></app-leave-type-pick>
          @if (picked.length === 1) {
            <label class="check" for="am-half"><input id="am-half" name="half" type="checkbox" [(ngModel)]="halfDay"> Half day</label>
          }
          <label for="am-reason">Reason</label>
          <textarea id="am-reason" name="reason" rows="3" [(ngModel)]="leaveReason" placeholder="Optional note for the approver"></textarea>
          <div class="actions">
            <button type="button" class="btn btn-ghost" (click)="closeAction()">Cancel</button>
            <button class="btn btn-primary" type="submit" [disabled]="busy">{{ submitLabel('Submit leave') }}</button>
          </div>
        </form>
      }
      @if (panel === 'regularization') {
        <form class="day-form" (ngSubmit)="regularize()">
          <div class="split">
            <div><label for="am-reg-in">In</label><input id="am-reg-in" name="inTime" type="time" [(ngModel)]="inTime" required></div>
            <div><label for="am-reg-out">Out</label><input id="am-reg-out" name="outTime" type="time" [(ngModel)]="outTime" required></div>
          </div>
          <label for="am-reg-reason">Reason</label>
          <textarea id="am-reg-reason" name="regReason" rows="3" [(ngModel)]="regReason" required></textarea>
          <div class="actions">
            <button type="button" class="btn btn-ghost" (click)="closeAction()">Cancel</button>
            <button class="btn btn-primary" type="submit" [disabled]="busy">{{ submitLabel('Send for approval') }}</button>
          </div>
        </form>
      }
      @if (panel === 'wfh') {
        <form class="day-form" (ngSubmit)="workFromHome()">
          <div class="split">
            <div><label for="am-wfh-in">In</label><input id="am-wfh-in" name="wfhIn" type="time" [(ngModel)]="inTime" required></div>
            <div><label for="am-wfh-out">Out</label><input id="am-wfh-out" name="wfhOut" type="time" [(ngModel)]="outTime" required></div>
          </div>
          <label for="am-wfh-reason">Reason</label>
          <textarea id="am-wfh-reason" name="wfhReason" rows="3" [(ngModel)]="wfhReason" required></textarea>
          <div class="actions">
            <button type="button" class="btn btn-ghost" (click)="closeAction()">Cancel</button>
            <button class="btn btn-primary" type="submit" [disabled]="busy">{{ submitLabel('Send for approval') }}</button>
          </div>
        </form>
      }
      @if (panel === 'extratime') {
        <form class="day-form" (ngSubmit)="extraTime()">
          <label for="am-extra-hours">Hours</label>
          <input id="am-extra-hours" name="hours" type="number" min="0.5" max="12" step="0.5" [(ngModel)]="extraHours" required>
          <label for="am-extra-reason">Reason</label>
          <textarea id="am-extra-reason" name="extraReason" rows="3" [(ngModel)]="extraReason" required></textarea>
          <div class="actions">
            <button type="button" class="btn btn-ghost" (click)="closeAction()">Cancel</button>
            <button class="btn btn-primary" type="submit" [disabled]="busy">{{ submitLabel('Send for approval') }}</button>
          </div>
        </form>
      }
      @if (panel === 'onduty') {
        <form class="day-form" (ngSubmit)="onDuty()">
          <label for="am-duty-place">Where you will be</label>
          <input id="am-duty-place" name="place" [(ngModel)]="place" required>
          <label for="am-duty-reason">Reason</label>
          <textarea id="am-duty-reason" name="dutyReason" rows="3" [(ngModel)]="dutyReason" required></textarea>
          <div class="actions">
            <button type="button" class="btn btn-ghost" (click)="closeAction()">Cancel</button>
            <button class="btn btn-primary" type="submit" [disabled]="busy">{{ submitLabel('Send for approval') }}</button>
          </div>
        </form>
      }
    </app-modal>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .att-month { margin: 0; min-width: 0; }
    .att-month.is-compact { height: 100%; display: flex; flex-direction: column; }
    .att-month-head { align-items: flex-start; }
    .att-month-nav { display: flex; align-items: center; gap: 8px; }
    .att-month-nav h2 { margin: 0; display: inline-flex; align-items: center; gap: 8px; }
    .att-month-hint { margin: 6px 0 0; width: 100%; }
    .att-month-body { display: flex; flex-direction: column; gap: 10px; }
    .att-month.is-compact .att-month-body { flex: 1 1 auto; }
    .att-month-actions { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); }
    .att-month-empty { margin: 0; }
    .att-month-picks-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
    .att-month-picks-head strong { color: var(--heading); }
    .att-month-btns { margin-top: 10px; flex-wrap: wrap; }
    .fine { margin: 8px 0 0; font-size: 12px; }
    .day-form .actions { margin-top: 16px; justify-content: flex-end; }
  `],
})
export class AttendanceMonthComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly toast = inject(Toast);

  @Input() compact = false;
  @Input() month = '';
  @Output() changed = new EventEmitter<void>();

  readonly dow = DOW;
  calendar: CalendarView | null = null;
  blanks: number[] = [];
  picked: string[] = [];
  selected: CalDay | null = null;
  panel: ActionPanel = '';
  leaveTypeId = '';
  leaveReason = '';
  halfDay = false;
  inTime = '09:30';
  outTime = '18:30';
  regReason = '';
  wfhReason = '';
  extraHours = 1;
  extraReason = '';
  place = '';
  dutyReason = '';
  busy = false;
  error = '';
  ok = '';

  get linked(): boolean {
    return !!this.store.me?.employeeId;
  }

  get pastOnly(): boolean {
    return !!this.picked.length && this.picked.every((day) => !!this.calendar && day <= this.calendar.today);
  }

  get selectionLabel(): string {
    if (!this.picked.length) return 'No days selected';
    if (this.picked.length === 1) {
      const label = this.selected?.day === this.picked[0] ? this.selected.label : '';
      return this.shortDay(this.picked[0]) + (label ? ' · ' + label : '');
    }
    return this.picked.length + ' days selected';
  }

  get monthLabel(): string {
    if (!this.calendar) return 'Calendar';
    const [year, month] = this.calendar.month.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  get modalTitle(): string {
    const titles: Record<Exclude<ActionPanel, ''>, string> = {
      leave: 'Apply leave',
      regularization: 'Regularize attendance',
      extratime: 'Extra time',
      wfh: 'Work from home',
      onduty: 'On duty',
    };
    return this.panel ? titles[this.panel] : '';
  }

  get modalIcon(): string {
    const icons: Record<Exclude<ActionPanel, ''>, string> = {
      leave: 'bi-calendar-plus',
      regularization: 'bi-arrow-repeat',
      extratime: 'bi-plus-circle',
      wfh: 'bi-house',
      onduty: 'bi-geo-alt',
    };
    return this.panel ? icons[this.panel] : 'bi-calendar3';
  }

  async ngOnInit(): Promise<void> {
    if (!this.month) {
      this.month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 7);
    }
    this.place = this.store.me?.workplace?.location || this.store.me?.company.city || '';
    await this.load();
  }

  isPicked(day: string): boolean {
    return this.picked.includes(day);
  }

  dateNumber(day: string): string {
    return String(Number(day.slice(8)));
  }

  shortDay(day: string): string {
    return new Date(day + 'T12:00:00+05:30').toLocaleDateString('en-IN', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
    });
  }

  submitLabel(single: string): string {
    return this.picked.length > 1 ? single + ' · ' + this.picked.length + ' days' : single;
  }

  async move(by: number): Promise<void> {
    const [year, month] = this.month.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1 + by, 1));
    this.month = next.toISOString().slice(0, 7);
    this.clearDays();
    await this.load();
  }

  clearDays(): void {
    this.picked = [];
    this.selected = null;
    this.panel = '';
    this.ok = '';
  }

  async drop(day: string): Promise<void> {
    const found = this.calendar?.days.find((item) => item.day === day);
    if (found) await this.choose(found);
  }

  async choose(day: CalDay): Promise<void> {
    this.ok = '';
    this.error = '';
    this.panel = '';
    if (this.picked.includes(day.day)) this.picked = this.picked.filter((item) => item !== day.day);
    else this.picked = [...this.picked, day.day].sort();
    this.selected = this.picked.includes(day.day)
      ? day
      : this.calendar?.days.find((item) => item.day === this.picked[this.picked.length - 1]) || null;
    if (!this.calendar) return;
    if (!this.leaveTypeId && this.calendar.leaveTypes[0]) this.leaveTypeId = this.calendar.leaveTypes[0].id;
    this.inTime = this.calendar.shiftStart;
    this.outTime = this.calendar.shiftEnd;
  }

  openAction(kind: Exclude<ActionPanel, ''>): void {
    if (!this.picked.length) return;
    this.panel = kind;
    this.error = '';
    this.ok = '';
    if (this.calendar) {
      this.inTime = this.calendar.shiftStart;
      this.outTime = this.calendar.shiftEnd;
      if (!this.leaveTypeId && this.calendar.leaveTypes[0]) this.leaveTypeId = this.calendar.leaveTypes[0].id;
    }
  }

  closeAction(): void {
    this.panel = '';
  }

  async applyLeave(): Promise<void> {
    const days = [...this.picked].sort();
    if (!days.length) return;
    const together = days.length === 1 || this.runsTogether(days);
    if (together) {
      await this.send('/v1/leave', {
        leaveTypeId: this.leaveTypeId,
        startsOn: days[0],
        endsOn: days[days.length - 1],
        portion: this.halfDay && days.length === 1 ? 'half' : 'full',
        reason: this.leaveReason,
      }, days.length === 1 ? 'Leave request sent.' : 'Leave sent for those days.');
      return;
    }
    this.busy = true;
    this.error = '';
    try {
      for (const day of days) {
        await this.api.post('/v1/leave', {
          leaveTypeId: this.leaveTypeId, startsOn: day, endsOn: day, portion: 'full', reason: this.leaveReason,
        });
      }
      this.finishOk('Leave sent for those days.');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save that.';
      this.toast.error(this.error);
    } finally {
      this.busy = false;
    }
  }

  async regularize(): Promise<void> {
    const body = this.timeBody('regularization', { inTime: this.inTime, outTime: this.outTime, reason: this.regReason });
    if (!body) return;
    await this.send('/v1/attendance/requests', body, this.sent('Regularization'));
  }

  async workFromHome(): Promise<void> {
    const body = this.timeBody('wfh', { inTime: this.inTime, outTime: this.outTime, reason: this.wfhReason });
    if (!body) return;
    await this.send('/v1/attendance/requests', body, this.sent('Work from home'));
  }

  async extraTime(): Promise<void> {
    const body = this.timeBody('extratime', { hours: this.extraHours, reason: this.extraReason });
    if (!body) return;
    await this.send('/v1/attendance/requests', body, this.sent('Extra time'));
  }

  async onDuty(): Promise<void> {
    const body = this.timeBody('onduty', { place: this.place, reason: this.dutyReason });
    if (!body) return;
    await this.send('/v1/attendance/requests', body, this.sent('On duty'));
  }

  private sent(name: string): string {
    return this.picked.length > 1 ? name + ' sent for ' + this.picked.length + ' days.' : name + ' sent for approval.';
  }

  private timeBody(kind: string, extra: Record<string, unknown>): Record<string, unknown> | null {
    const days = [...this.picked].sort();
    if (!days.length) return null;
    return { kind, day: days[0], days, ...extra };
  }

  private runsTogether(days: string[]): boolean {
    for (let index = 1; index < days.length; index += 1) {
      if (this.nextDay(days[index - 1]) !== days[index]) return false;
    }
    return true;
  }

  private nextDay(day: string): string {
    const date = new Date(day + 'T12:00:00+05:30');
    date.setTime(date.getTime() + 24 * 60 * 60 * 1000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
  }

  private async send(path: string, body: unknown, message: string): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      await this.api.post(path, body);
      this.finishOk(message);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save that.';
      this.toast.error(this.error);
    } finally {
      this.busy = false;
    }
  }

  private finishOk(message: string): void {
    this.ok = message;
    this.toast.success(message);
    this.panel = '';
    this.leaveReason = '';
    this.regReason = '';
    this.wfhReason = '';
    this.extraReason = '';
    this.dutyReason = '';
    this.picked = [];
    this.selected = null;
    this.changed.emit();
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const data = await this.api.get<CalendarView>('/v1/attendance/calendar?month=' + this.month);
      this.calendar = data;
      this.error = '';
      const first = data.days[0]?.day || data.month + '-01';
      const sunday = new Date(first + 'T12:00:00+05:30').getUTCDay();
      const lead = (sunday + 6) % 7;
      this.blanks = Array.from({ length: lead }, (_, index) => index);
      if (!this.leaveTypeId && data.leaveTypes[0]) this.leaveTypeId = data.leaveTypes[0].id;
      this.inTime = data.shiftStart;
      this.outTime = data.shiftEnd;
      if (this.picked.length) {
        this.picked = this.picked.filter((day) => data.days.some((item) => item.day === day));
        this.selected = data.days.find((item) => item.day === this.picked[this.picked.length - 1]) || null;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load the calendar.';
      this.calendar = null;
    }
  }
}
