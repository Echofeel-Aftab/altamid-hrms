import { PhotoComponent } from '../shared/photo.component';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { BoardRow, clock, PunchState } from '../core/models';
import { SessionStore } from '../core/session.store';
import { DataColumn, DataTableComponent } from '../shared/data-table.component';
import { LeaveTypePickComponent } from '../shared/leave-type-pick.component';
import { PunchClockComponent } from '../shared/punch-clock.component';
import { Sweet } from '../shared/sweet';

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
  canEditHolidays: boolean;
  leaveTypes: Array<{ id: string; name: string; entitled: number; left: number }>;
  holidays: Array<{ id: string; day: string; name: string }>;
  days: CalDay[];
}

interface TeamPerson {
  name: string;
  code: string;
  status: string;
  label: string;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
interface ReaderRow { id: string; name: string; kind: string; location: string; path: string; url?: string; sample?: string; hint?: string; lastSeen: string }
interface LiveRow { id: string; name: string; code: string; kind: string; at: string; reader: string }

type DeskTab = 'today' | 'month' | 'team' | 'holidays' | 'devices';

@Component({
  selector: 'app-attendance',
  imports: [FormsModule, DataTableComponent, LeaveTypePickComponent, PunchClockComponent, PhotoComponent],
  template: `
    <div class="page-head att-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-clock"></i></span>
        <p class="eyebrow">Time</p>
        <h1>Attendance</h1>
        <p class="lede">{{ tabLede }}</p>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }

    <div class="seg-tabs att-tabs" role="tablist" aria-label="Attendance sections">
      <button type="button" role="tab" [attr.aria-selected]="tab === 'today'" [class.is-on]="tab === 'today'" (click)="setTab('today')">
        <i class="bi bi-sun"></i> Today
      </button>
      <button type="button" role="tab" [attr.aria-selected]="tab === 'month'" [class.is-on]="tab === 'month'" (click)="setTab('month')">
        <i class="bi bi-calendar3"></i> My month
        @if (picked.length) { <span class="chip is-warn">{{ picked.length }}</span> }
      </button>
      <button type="button" role="tab" [attr.aria-selected]="tab === 'team'" [class.is-on]="tab === 'team'" (click)="setTab('team')">
        <i class="bi bi-people"></i> Who's in
        @if (inNow) { <span class="chip">{{ inNow }}</span> }
      </button>
      <button type="button" role="tab" [attr.aria-selected]="tab === 'holidays'" [class.is-on]="tab === 'holidays'" (click)="setTab('holidays')">
        <i class="bi bi-balloon"></i> Holidays
        @if (calendar?.holidays?.length) { <span class="chip">{{ calendar!.holidays.length }}</span> }
      </button>
      @if (canConnect) {
        <button type="button" role="tab" [attr.aria-selected]="tab === 'devices'" [class.is-on]="tab === 'devices'" (click)="setTab('devices')">
          <i class="bi bi-fingerprint"></i> Devices
          @if (readers.length) { <span class="chip">{{ readers.length }}</span> }
        </button>
      }
    </div>

    @if (tab === 'today') {
      <div class="desk-board att-desk">
        <div class="desk-tile is-hero">
          @if (mine) {
            <app-punch-clock [state]="mine" (changed)="punched($event)" />
          } @else {
            <section class="card clock-card is-empty">
              <strong>No punch clock yet</strong>
              <p class="muted">Ask HR to link this sign-in to a person.</p>
            </section>
          }
        </div>
        <div class="desk-tile">
          <section class="card att-snap">
            <div class="card-head">
              <h2><i class="bi bi-activity"></i> Right now</h2>
              <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('team')">Open board</button>
            </div>
            <div class="att-kpis">
              <button type="button" class="att-kpi" (click)="setTab('team')">
                <strong>{{ inNow }}</strong>
                <span>Checked in</span>
              </button>
              <button type="button" class="att-kpi" (click)="setTab('team')">
                <strong>{{ outNow }}</strong>
                <span>Checked out</span>
              </button>
              <button type="button" class="att-kpi" (click)="setTab('month')">
                <strong>{{ monthPresent }}</strong>
                <span>Present · {{ monthShort }}</span>
              </button>
              <button type="button" class="att-kpi" (click)="setTab('month')">
                <strong>{{ monthAbsent }}</strong>
                <span>Absent · {{ monthShort }}</span>
              </button>
            </div>
            <div class="att-quick">
              <button type="button" class="btn btn-primary btn-sm" (click)="jumpMonth('leave')"><i class="bi bi-calendar-plus"></i> Apply leave</button>
              <button type="button" class="btn btn-secondary btn-sm" (click)="jumpMonth('regularization')"><i class="bi bi-arrow-repeat"></i> Regularize</button>
              <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('month')"><i class="bi bi-calendar3"></i> Open calendar</button>
            </div>
          </section>
        </div>
        <div class="desk-tile">
          <section class="card att-live-card">
            <div class="card-head">
              <h2><i class="bi bi-broadcast"></i> Latest punches</h2>
              @if (canConnect) { <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('devices')">Devices</button> }
            </div>
            @if (!livePreview.length) {
              <p class="muted">No recent punches to show.</p>
            } @else {
              <ul class="att-live">
                @for (row of livePreview; track row.id) {
                  <li>
                    <span class="li-person">
                      <app-photo size="xs" [code]="row.code" [name]="row.name" />
                      <span><strong>{{ row.name }}</strong><small class="muted">{{ row.code }}{{ row.reader ? ' · ' + row.reader : '' }}</small></span>
                    </span>
                    <strong class="att-live-when">{{ row.kind === 'in' ? 'In' : 'Out' }} · {{ row.at }}</strong>
                  </li>
                }
              </ul>
            }
          </section>
        </div>
        <div class="desk-tile">
          <section class="card att-preview">
            <div class="card-head">
              <h2><i class="bi bi-people"></i> Who's in</h2>
              <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('team')">See all</button>
            </div>
            @if (loadingBoard) { <p class="muted">Loading…</p> }
            @else if (!boardPreview.length) { <p class="muted">No one has punched yet today.</p> }
            @else {
              <ul class="att-live">
                @for (row of boardPreview; track row.code) {
                  <li>
                    <span class="li-person">
                      <app-photo size="xs" [code]="row.code" [name]="row.name" />
                      <span><strong>{{ row.name }}</strong><small class="muted">{{ row.code }}</small></span>
                    </span>
                    <span class="pill" [class.is-ok]="row.state === 'in'">{{ row.state === 'in' ? 'In' : 'Out' }}</span>
                  </li>
                }
              </ul>
            }
          </section>
        </div>
      </div>
    }

    @if (tab === 'month' && calendar) {
      <div class="page-split att-month-split">
        <section class="card">
          <div class="cal-head card-head">
            <button type="button" class="btn btn-ghost btn-sm" (click)="move(-1)" aria-label="Previous month"><i class="bi bi-chevron-left"></i></button>
            <h2>{{ monthLabel }}</h2>
            <button type="button" class="btn btn-ghost btn-sm" (click)="move(1)" aria-label="Next month"><i class="bi bi-chevron-right"></i></button>
          </div>
          <p class="muted">Shift {{ calendar.shiftStart }}–{{ calendar.shiftEnd }}. Select one day or several, then use the actions on the right.</p>
          <div class="cal-grid" aria-label="Attendance calendar">
            @for (name of dow; track name) { <div class="cal-dow">{{ name }}</div> }
            @for (blank of blanks; track blank) { <div class="cal-day is-pad"></div> }
            @for (day of calendar.days; track day.day) {
              <button type="button" [class]="'cal-day is-' + day.status + (isPicked(day.day) ? ' is-selected' : '')" [attr.aria-pressed]="isPicked(day.day)" (click)="choose(day)">
                <strong>{{ dateNumber(day.day) }}</strong>
                <small>{{ day.label }}</small>
              </button>
            }
          </div>
          <ul class="cal-legend">
            <li><i class="is-present"></i> Present</li>
            <li><i class="is-missed"></i> Missed</li>
            <li><i class="is-absent"></i> Absent</li>
            <li><i class="is-leave"></i> Leave</li>
            <li><i class="is-onduty"></i> On duty</li>
            <li><i class="is-pending"></i> Waiting</li>
            <li><i class="is-holiday"></i> Holiday</li>
          </ul>
        </section>
        <section class="card day-panel card-scroll-pane">
          @if (!picked.length) {
            <h2><i class="bi bi-calendar-range"></i> Choose days</h2>
            <p class="muted">Past days can be regularized. Future days can be leave, work from home, or on duty.</p>
            @if (todayDay) {
              <button type="button" class="btn btn-secondary btn-sm" (click)="choose(todayDay)">Select today</button>
            }
          } @else {
            <div class="card-head">
              <h2>{{ selectionLabel }}</h2>
              <button type="button" class="btn btn-ghost btn-sm" (click)="clearDays()">Clear</button>
            </div>
            <div class="day-picks">
              @for (day of picked; track day) {
                <button type="button" class="day-pick" (click)="drop(day)">{{ holidayWhen(day) }}</button>
              }
            </div>
            @if (selected) {
              @if (!selected.punches.length) { <p class="muted">No punches on {{ selected.day }}.</p> }
              <ul class="plain-list">
                @for (item of selected.punches; track item.at + item.kind) {
                  <li><strong>{{ item.kind === 'in' ? 'In' : 'Out' }}</strong> {{ item.at }} <span class="muted">{{ item.note }}</span></li>
                }
              </ul>
              @if (selected.request) { <p>{{ requestLine }}</p> }
            }
            @if (store.me?.employeeId) {
              <div class="actions">
                <button type="button" class="btn btn-primary btn-sm" (click)="panel = 'leave'">Apply leave</button>
                @if (pastOnly) {
                  <button type="button" class="btn btn-secondary btn-sm" (click)="panel = 'regularization'">Regularize</button>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="panel = 'extratime'">Extra time</button>
                }
                <button type="button" class="btn btn-ghost btn-sm" (click)="panel = 'wfh'">Work from home</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="panel = 'onduty'">On duty</button>
              </div>
              @if (!pastOnly) { <p class="muted">Regularization and extra time stay off while a future day is selected.</p> }
              @if (pastOnly && holidayPicked) {
                <p class="muted fine">Extra time on a company holiday can earn fixed comp-off days and a payroll pay-multiplier hint when Rules → Holiday work is on.</p>
              }
            }
            @if (panel === 'leave') {
              <form class="day-form" (ngSubmit)="applyLeave()">
                <label for="cal-type">Leave type</label>
                <app-leave-type-pick controlId="cal-type" [types]="calendar.leaveTypes" [(value)]="leaveTypeId"></app-leave-type-pick>
                @if (picked.length === 1) {
                  <label class="check" for="cal-half"><input id="cal-half" name="half" type="checkbox" [(ngModel)]="halfDay"> Half day</label>
                }
                <label for="cal-reason">Reason</label>
                <textarea id="cal-reason" name="reason" rows="2" [(ngModel)]="leaveReason"></textarea>
                <div class="actions"><button class="btn btn-primary" type="submit" [disabled]="busy">{{ submitLabel('Submit leave') }}</button></div>
              </form>
            }
            @if (panel === 'regularization') {
              <form class="day-form" (ngSubmit)="regularize()">
                <div class="split">
                  <div><label for="reg-in">In</label><input id="reg-in" name="inTime" type="time" [(ngModel)]="inTime" required></div>
                  <div><label for="reg-out">Out</label><input id="reg-out" name="outTime" type="time" [(ngModel)]="outTime" required></div>
                </div>
                <label for="reg-reason">Reason</label>
                <textarea id="reg-reason" name="regReason" rows="2" [(ngModel)]="regReason" required></textarea>
                <div class="actions"><button class="btn btn-primary" type="submit" [disabled]="busy">{{ submitLabel('Send for approval') }}</button></div>
              </form>
            }
            @if (panel === 'wfh') {
              <form class="day-form" (ngSubmit)="workFromHome()">
                <div class="split">
                  <div><label for="wfh-in">In</label><input id="wfh-in" name="wfhIn" type="time" [(ngModel)]="inTime" required></div>
                  <div><label for="wfh-out">Out</label><input id="wfh-out" name="wfhOut" type="time" [(ngModel)]="outTime" required></div>
                </div>
                <label for="wfh-reason">Reason</label>
                <textarea id="wfh-reason" name="wfhReason" rows="2" [(ngModel)]="wfhReason" required></textarea>
                <div class="actions"><button class="btn btn-primary" type="submit" [disabled]="busy">{{ submitLabel('Send for approval') }}</button></div>
              </form>
            }
            @if (panel === 'extratime') {
              <form class="day-form" (ngSubmit)="extraTime()">
                <label for="extra-hours">Hours</label>
                <input id="extra-hours" name="hours" type="number" min="0.5" max="12" step="0.5" [(ngModel)]="extraHours" required>
                <label for="extra-reason">Reason</label>
                <textarea id="extra-reason" name="extraReason" rows="2" [(ngModel)]="extraReason" required></textarea>
                <div class="actions"><button class="btn btn-primary" type="submit" [disabled]="busy">{{ submitLabel('Send for approval') }}</button></div>
              </form>
            }
            @if (panel === 'onduty') {
              <form class="day-form" (ngSubmit)="onDuty()">
                <label for="duty-place">Where you will be</label>
                <input id="duty-place" name="place" [(ngModel)]="place" required>
                <label for="duty-reason">Reason</label>
                <textarea id="duty-reason" name="dutyReason" rows="2" [(ngModel)]="dutyReason" required></textarea>
                <div class="actions"><button class="btn btn-primary" type="submit" [disabled]="busy">{{ submitLabel('Send for approval') }}</button></div>
              </form>
            }
            @if (team.length) {
              <div class="team-block">
                <h3>Team on {{ selected?.day }}</h3>
                <ul class="plain">
                  @for (person of team; track person.code) {
                    <li><span class="li-person"><app-photo size="xs" [code]="person.code" [name]="person.name" /><span><strong>{{ person.name }}</strong><span class="muted"> · {{ person.code }} · {{ person.label || 'Scheduled' }}</span></span></span></li>
                  }
                </ul>
              </div>
            }
          }
        </section>
      </div>
    }

    @if (tab === 'team') {
      <app-data-table tableId="who-is-in" title="Who is in" empty="No one has punched yet today." [rows]="board" [columns]="boardColumns" [loading]="loadingBoard" />
    }

    @if (tab === 'holidays' && calendar) {
      <section class="card att-holidays">
        <div class="card-head">
          <h2><i class="bi bi-balloon"></i> Company holidays · {{ calendar.year }}</h2>
        </div>
        <p class="muted">These days are off for everyone. They show on the calendar and are not counted as leave.</p>
        @if (calendar.canEditHolidays) {
          <form class="inline-add" (ngSubmit)="addHoliday()">
            <div><label for="hol-day">Date</label><input id="hol-day" name="holidayDay" type="date" [(ngModel)]="holidayDay" required></div>
            <div><label for="hol-name">Name</label><input id="hol-name" name="holidayName" [(ngModel)]="holidayName" maxlength="80" required></div>
            <button class="btn btn-primary" type="submit" [disabled]="busy">Add holiday</button>
          </form>
        }
        @if (!calendar.holidays.length) { <p class="muted">No company holidays in {{ calendar.year }} yet.</p> }
        <div class="holiday-year">
          @for (group of holidayGroups; track group.key) {
            <section class="holiday-month">
              <h3>{{ group.label }}</h3>
              <ul class="holiday-list">
                @for (item of group.items; track item.id) {
                  <li class="holiday-row">
                    <time class="holiday-date" [attr.datetime]="item.day">
                      <span class="holiday-dow">{{ holidayDow(item.day) }}</span>
                      <span class="holiday-num">{{ dateNumber(item.day) }}</span>
                      <span class="holiday-mon">{{ holidayMon(item.day) }}</span>
                    </time>
                    <div class="holiday-meta">
                      <strong class="holiday-name">{{ item.name }}</strong>
                      <small>For everyone · not leave</small>
                    </div>
                    @if (calendar.canEditHolidays) {
                      <button type="button" class="btn btn-ghost btn-sm holiday-remove" (click)="removeHoliday(item)">Remove</button>
                    }
                  </li>
                }
              </ul>
            </section>
          }
        </div>
      </section>
    }

    @if (tab === 'devices' && canConnect) {
      <div class="desk-board att-devices">
        <div class="desk-tile is-hero">
        <section class="card">
          <h2><i class="bi bi-fingerprint"></i> Readers</h2>
          <p class="muted">There is no database connection string into vendor software. The reader (or a bridge PC / middleware) <strong>POSTs</strong> each punch to the address below. Match the machine user id to <strong>Biometric / badge ID</strong> on the person, or use the EMP code. Altamid does not store the finger, face, or card.</p>
          <form class="reader-add" (ngSubmit)="addReader()">
            <label class="sr" for="reader-name">Reader name</label>
            <input id="reader-name" name="readerName" [(ngModel)]="readerName" placeholder="Gate reader" required>
            <label class="sr" for="reader-kind">Kind</label>
            <select id="reader-kind" name="readerKind" [(ngModel)]="readerKind">
              <option value="fingerprint">Fingerprint</option>
              <option value="face">Face</option>
              <option value="card">Card</option>
            </select>
            <label class="sr" for="reader-place">Location</label>
            <input id="reader-place" name="readerPlace" [(ngModel)]="readerPlace" placeholder="Location">
            <button class="btn btn-secondary" type="submit" [disabled]="busy">Connect</button>
          </form>
          @if (!readers.length) { <p class="muted">No reader is connected yet.</p> }
          <div class="att-reader-grid">
            @for (reader of readers; track reader.id) {
              <article class="feed-item">
                <div class="row-between">
                  <h3>{{ reader.name }}</h3>
                  <span class="pill">{{ reader.kind }}</span>
                </div>
                <p class="muted">{{ reader.location || 'No location' }} · {{ reader.lastSeen ? 'Last punch ' + reader.lastSeen : 'Waiting for the first punch' }}</p>
                <label class="sr" [for]="'reader-url-' + reader.id">Post address</label>
                <input [id]="'reader-url-' + reader.id" [value]="readerUrl(reader)" readonly>
                <p class="muted">{{ reader.hint || 'Configure vendor software or a bridge to HTTP POST here when a punch lands.' }}</p>
                <p class="muted">Sample JSON <span class="mono">{{ reader.sample || samplePunch }}</span></p>
                <p class="muted fine">Also accepted: <span class="mono">userId</span>, <span class="mono">empCode</span>, <span class="mono">badgeId</span>, <span class="mono">deviceCode</span>; times as <span class="mono">at</span> / <span class="mono">timestamp</span> / <span class="mono">punchedAt</span>.</p>
                <div class="actions"><button type="button" class="btn btn-ghost" (click)="removeReader(reader.id)">Remove</button></div>
              </article>
            }
          </div>
        </section>
        </div>
        <div class="desk-tile">
        <section class="card">
          <h2><i class="bi bi-broadcast"></i> Live punches</h2>
          @if (!live.length) { <p class="muted">No punches in the last few hours.</p> }
          <ul class="plain att-live">
            @for (row of live; track row.id) {
              <li><span class="li-person"><app-photo size="xs" [code]="row.code" [name]="row.name" /><span><strong>{{ row.name }}</strong> <span class="muted">{{ row.code }} · {{ row.reader }}</span></span></span><strong>{{ row.kind === 'in' ? 'In' : 'Out' }} · {{ row.at }}</strong></li>
            }
          </ul>
        </section>
        </div>
      </div>
    }
  `,
})
export class AttendanceComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  readonly store = inject(SessionStore);
  readonly dow = DOW;
  tab: DeskTab = 'today';
  mine: PunchState | null = null;
  board: BoardRow[] = [];
  loadingBoard = true;
  calendar: CalendarView | null = null;
  picked: string[] = [];
  selected: CalDay | null = null;
  team: TeamPerson[] = [];
  panel = '';
  month = '';
  blanks: number[] = [];
  leaveTypeId = '';
  leaveReason = '';
  halfDay = false;
  wfhReason = '';
  extraHours = 1;
  extraReason = '';
  inTime = '09:30';
  outTime = '18:30';
  regReason = '';
  place = '';
  dutyReason = '';
  holidayDay = '';
  holidayName = '';
  error = '';
  ok = '';
  busy = false;
  readers: ReaderRow[] = [];
  live: LiveRow[] = [];
  readerName = '';
  readerKind = 'fingerprint';
  readerPlace = '';
  readonly samplePunch = '{ "code": "EMP005", "kind": "in" }';
  private liveTimer = 0;
  private readonly tabKey = 'altamid.attendance.tab';
  readonly boardColumns: DataColumn<BoardRow>[] = [
    { key: 'name', label: 'Person', text: (row) => row.name, person: (row) => ({ code: row.code, name: row.name }) },
    { key: 'code', label: 'Code', text: (row) => row.code },
    { key: 'state', label: 'Now', text: (row) => (row.state === 'in' ? 'In' : 'Out'), pill: true },
    { key: 'at', label: 'Last punch', text: (row) => clock(row.at) },
    { key: 'where', label: 'Where', text: (row) => row.where || '—' },
  ];

  get requestLine(): string {
    const item = this.selected?.request;
    if (!item) return '';
    const names: Record<string, string> = { onduty: 'On duty', wfh: 'Work from home', extratime: 'Extra time', regularization: 'Regularization' };
    const name = names[item.kind] || 'Request';
    const when = item.hours ? ` · ${item.hours} h` : item.inTime ? ` · ${item.inTime}–${item.outTime}` : item.place ? ` · ${item.place}` : '';
    return `${name} is ${item.status}${when}.`;
  }

  get pastOnly(): boolean {
    return !!this.picked.length && this.picked.every((day) => !!this.calendar && day <= this.calendar.today);
  }

  get holidayPicked(): boolean {
    if (!this.calendar?.days?.length || !this.picked.length) return false;
    return this.picked.some((day) => this.calendar!.days.find((row) => row.day === day)?.status === 'holiday');
  }

  get selectionLabel(): string {
    if (this.picked.length === 1) {
      const label = this.selected?.day === this.picked[0] ? this.selected.label : '';
      return this.picked[0] + (label ? ' · ' + label : '');
    }
    return this.picked.length + ' days selected';
  }

  get monthLabel(): string {
    if (!this.calendar) return '';
    const [year, month] = this.calendar.month.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  get monthShort(): string {
    if (!this.calendar) return '';
    const [year, month] = this.calendar.month.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' });
  }

  get canConnect(): boolean {
    return !!this.store.me?.access?.includes('attendance.devices');
  }

  get canLive(): boolean {
    return !!this.store.me?.access?.includes('attendance.live') || this.canConnect;
  }

  get tabLede(): string {
    const lines: Record<DeskTab, string> = {
      today: 'Check in, see who is around, and jump into leave or regularization without scrolling the whole desk.',
      month: 'Select one day or several, then apply leave, regularize, work from home, extra time, or on duty.',
      team: 'Everyone who has punched today, with their last punch and where they checked in.',
      holidays: 'Company holidays for everyone. They show on the calendar and are not counted as leave.',
      devices: 'Connect fingerprint, face, or card readers and watch live punches as they arrive.',
    };
    return lines[this.tab];
  }

  get inNow(): number {
    return this.board.filter((row) => row.state === 'in').length;
  }

  get outNow(): number {
    return this.board.filter((row) => row.state === 'out').length;
  }

  get monthPresent(): number {
    return (this.calendar?.days || []).filter((day) => day.status === 'present').length;
  }

  get monthAbsent(): number {
    return (this.calendar?.days || []).filter((day) => day.status === 'absent' || day.status === 'missed').length;
  }

  get todayDay(): CalDay | null {
    return this.calendar?.days.find((day) => day.day === this.calendar?.today) || null;
  }

  get boardPreview(): BoardRow[] {
    return this.board.slice(0, 6);
  }

  get livePreview(): LiveRow[] {
    if (this.live.length) return this.live.slice(0, 6);
    return this.board.slice(0, 6).map((row, index) => ({
      id: 'board-' + row.code + index,
      name: row.name,
      code: row.code,
      kind: row.state === 'in' ? 'in' : 'out',
      at: clock(row.at),
      reader: row.where || '',
    }));
  }

  setTab(tab: DeskTab): void {
    if (tab === 'devices' && !this.canConnect) tab = 'today';
    this.tab = tab;
    try { sessionStorage.setItem(this.tabKey, tab); } catch { /* ignore */ }
  }

  jumpMonth(action: string): void {
    this.setTab('month');
    if (this.todayDay && !this.picked.length) void this.choose(this.todayDay);
    this.panel = action;
  }

  readerUrl(reader: ReaderRow): string {
    if (reader.url?.startsWith('http')) return reader.url;
    if (typeof location !== 'undefined' && reader.path) return location.origin + reader.path;
    return reader.url || reader.path;
  }

  async ngOnInit(): Promise<void> {
    this.month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 7);
    this.place = this.store.me?.workplace?.location || this.store.me?.company.city || '';
    this.readerPlace = this.store.me?.company.city || '';
    try {
      const saved = sessionStorage.getItem(this.tabKey) as DeskTab | null;
      if (saved && ['today', 'month', 'team', 'holidays', 'devices'].includes(saved)) this.tab = saved;
    } catch { /* ignore */ }
    await Promise.all([this.loadPunch(), this.loadCalendar(), this.loadReaders()]);
    if (this.tab === 'devices' && !this.canConnect) this.tab = 'today';
    if (this.canLive) this.liveTimer = window.setInterval(() => void this.loadLive(), 8000);
  }

  ngOnDestroy(): void {
    if (this.liveTimer) window.clearInterval(this.liveTimer);
  }

  async addReader(): Promise<void> {
    this.error = '';
    this.busy = true;
    try {
      await this.api.post('/v1/attendance/devices', { name: this.readerName, kind: this.readerKind, location: this.readerPlace });
      this.readerName = '';
      this.readerPlace = this.store.me?.company.city || '';
      this.ok = 'Reader connected. Paste its address into the device software.';
      await this.loadReaders();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not connect that reader.';
    } finally {
      this.busy = false;
    }
  }

  async removeReader(id: string): Promise<void> {
    const reader = this.readers.find((row) => row.id === id);
    const yes = await this.sweet.confirm({
      title: reader ? `Remove ${reader.name}?` : 'Remove this reader?',
      text: 'Punches from this device will no longer be accepted until it is connected again.',
      confirmText: 'Remove',
      danger: true,
    });
    if (!yes) return;
    this.error = '';
    try {
      await this.api.post('/v1/attendance/devices/remove', { id });
      await this.loadReaders();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not remove that reader.';
    }
  }

  private async loadReaders(): Promise<void> {
    if (!this.canConnect) return;
    try {
      this.readers = await this.api.get<ReaderRow[]>('/v1/attendance/devices');
      await this.loadLive();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load readers.';
    }
  }

  private async loadLive(): Promise<void> {
    if (!this.canLive) return;
    try {
      this.live = await this.api.get<LiveRow[]>('/v1/attendance/live');
    } catch {
      this.live = [];
    }
  }

  async move(by: number): Promise<void> {
    const [year, month] = this.month.split('-').map(Number);
    const next = new Date(Date.UTC(year, month - 1 + by, 1));
    this.month = next.toISOString().slice(0, 7);
    this.selected = null;
    this.team = [];
    await this.loadCalendar();
  }

  isPicked(day: string): boolean {
    return this.picked.includes(day);
  }

  submitLabel(single: string): string {
    return this.picked.length > 1 ? single + ' · ' + this.picked.length + ' days' : single;
  }

  clearDays(): void {
    this.picked = [];
    this.selected = null;
    this.team = [];
    this.panel = '';
  }

  async drop(day: string): Promise<void> {
    const found = this.calendar?.days.find((item) => item.day === day);
    if (found) {
      await this.choose(found);
      return;
    }
    this.picked = this.picked.filter((item) => item !== day);
    this.selected = this.calendar?.days.find((item) => item.day === this.picked[this.picked.length - 1]) || null;
    await this.loadTeam();
  }

  async choose(day: CalDay): Promise<void> {
    this.panel = '';
    this.ok = '';
    this.error = '';
    if (this.picked.includes(day.day)) this.picked = this.picked.filter((item) => item !== day.day);
    else this.picked = [...this.picked, day.day].sort();
    this.selected = this.picked.includes(day.day) ? day : this.calendar?.days.find((item) => item.day === this.picked[this.picked.length - 1]) || null;
    if (!this.calendar) return;
    if (!this.leaveTypeId && this.calendar.leaveTypes[0]) this.leaveTypeId = this.calendar.leaveTypes[0].id;
    this.inTime = this.calendar.shiftStart;
    this.outTime = this.calendar.shiftEnd;
    await this.loadTeam();
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
      }, days.length === 1 ? 'Leave request sent.' : 'Leave sent for those days.', true);
      return;
    }
    await this.sendSeparateLeave(days);
  }

  async workFromHome(): Promise<void> {
    const body = this.timeBody('wfh', { inTime: this.inTime, outTime: this.outTime, reason: this.wfhReason });
    if (!body) return;
    await this.send('/v1/attendance/requests', body, this.sent('Work from home'), true);
  }

  async extraTime(): Promise<void> {
    const body = this.timeBody('extratime', { hours: this.extraHours, reason: this.extraReason });
    if (!body) return;
    await this.send('/v1/attendance/requests', body, this.sent('Extra time'), true);
  }

  async regularize(): Promise<void> {
    const body = this.timeBody('regularization', { inTime: this.inTime, outTime: this.outTime, reason: this.regReason });
    if (!body) return;
    await this.send('/v1/attendance/requests', body, this.sent('Regularization'), true);
  }

  async onDuty(): Promise<void> {
    const body = this.timeBody('onduty', { place: this.place, reason: this.dutyReason });
    if (!body) return;
    await this.send('/v1/attendance/requests', body, this.sent('On duty'), true);
  }

  async addHoliday(): Promise<void> {
    await this.send('/v1/attendance/holidays', { day: this.holidayDay, name: this.holidayName }, 'Holiday added.');
    this.holidayName = '';
  }

  async removeHoliday(item: { id: string; day: string; name: string }): Promise<void> {
    const when = this.holidayWhen(item.day);
    const yes = await this.sweet.confirm({
      title: `Remove “${item.name}”?`,
      text: `${when} will no longer be a company holiday.`,
      confirmText: 'Remove',
      danger: true,
    });
    if (!yes) return;
    await this.send('/v1/attendance/holidays/delete', { id: item.id }, 'Holiday removed.');
  }

  get holidayGroups(): Array<{ key: string; label: string; items: Array<{ id: string; day: string; name: string }> }> {
    const groups = new Map<string, Array<{ id: string; day: string; name: string }>>();
    for (const item of this.calendar?.holidays || []) {
      const key = item.day.slice(0, 7);
      const bucket = groups.get(key) || [];
      bucket.push(item);
      groups.set(key, bucket);
    }
    return [...groups.entries()].map(([key, items]) => ({
      key,
      label: new Date(key + '-01T00:00:00Z').toLocaleString('en-IN', { month: 'long', timeZone: 'UTC' }),
      items,
    }));
  }

  holidayWhen(day: string): string {
    return new Date(day + 'T12:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  }

  holidayDow(day: string): string {
    return new Date(day + 'T12:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' });
  }

  holidayMon(day: string): string {
    return new Date(day + 'T12:00:00+05:30').toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' });
  }

  dateNumber(day: string): string {
    return String(Number(day.slice(8)));
  }

  async punched(state: PunchState): Promise<void> {
    this.mine = state;
    await Promise.all([this.loadPunch(), this.loadCalendar()]);
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

  private async sendSeparateLeave(days: string[]): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      for (const day of days) {
        await this.api.post('/v1/leave', { leaveTypeId: this.leaveTypeId, startsOn: day, endsOn: day, portion: 'full', reason: this.leaveReason });
      }
      this.ok = 'Leave sent for those days.';
      this.panel = '';
      this.leaveReason = '';
      this.picked = [];
      await this.loadCalendar();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save that.';
      await this.loadCalendar();
    } finally {
      this.busy = false;
    }
  }

  private async send(path: string, body: unknown, message: string, clearPick = false): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      await this.api.post(path, body);
      this.ok = message;
      this.panel = '';
      this.leaveReason = '';
      this.regReason = '';
      this.wfhReason = '';
      this.extraReason = '';
      this.place = '';
      this.dutyReason = '';
      if (clearPick) this.picked = [];
      await this.loadCalendar();
      await this.loadTeam();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save that.';
    } finally {
      this.busy = false;
    }
  }

  private teamToken = 0;

  private async loadTeam(): Promise<void> {
    const role = this.store.me?.role;
    const day = this.selected?.day;
    if (!day || (role !== 'owner' && role !== 'hr' && role !== 'manager')) {
      this.team = [];
      return;
    }
    const token = ++this.teamToken;
    try {
      const data = await this.api.get<{ people: TeamPerson[] }>('/v1/attendance/day?day=' + day);
      if (token !== this.teamToken || this.selected?.day !== day) return;
      this.team = data.people;
    } catch {
      if (token === this.teamToken) this.team = [];
    }
  }

  private async loadPunch(): Promise<void> {
    this.loadingBoard = true;
    try {
      const data = await this.api.get<{ mine: PunchState | null; board: BoardRow[] }>('/v1/attendance');
      this.mine = data.mine;
      this.board = data.board;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load attendance.';
    } finally {
      this.loadingBoard = false;
    }
  }

  private async loadCalendar(): Promise<void> {
    try {
      const data = await this.api.get<CalendarView>('/v1/attendance/calendar?month=' + this.month);
      this.calendar = data;
      const first = data.days[0]?.day || data.month + '-01';
      const sunday = new Date(first + 'T12:00:00+05:30').getUTCDay();
      const lead = (sunday + 6) % 7;
      this.blanks = Array.from({ length: lead }, (_, index) => index);
      if (!this.leaveTypeId && data.leaveTypes[0]) this.leaveTypeId = data.leaveTypes[0].id;
      if (!this.picked.length) {
        const today = data.days.find((day) => day.day === data.today) || null;
        this.selected = today;
        if (today) this.picked = [today.day];
      } else {
        this.selected = data.days.find((day) => day.day === this.selected?.day) || data.days.find((day) => this.picked.includes(day.day)) || null;
      }
      if (this.selected) await this.loadTeam();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load the calendar.';
    }
  }
}
