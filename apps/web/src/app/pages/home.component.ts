import { PhotoComponent } from '../shared/photo.component';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CelebrateComponent, FreshBadge } from '../shared/celebrate.component';
import { PunchClockComponent } from '../shared/punch-clock.component';
import { AttendanceMonthComponent } from '../shared/attendance-month.component';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { RichEditorComponent, RichViewComponent } from '../shared/rich-editor.component';
import { ModalComponent } from '../shared/modal.component';
import { Toast } from '../shared/toast';
import { Sweet } from '../shared/sweet';
import { ApiService } from '../core/api.service';
import { Announcement, LeaveBalance, PunchState, when } from '../core/models';
import { SessionStore } from '../core/session.store';

type BoxSize = 's' | 'm' | 'l';
interface HomeDay { day: string; status: string; label: string }
interface HomeWidget { key: string; visible: boolean }
interface Joiner { id: string; name: string; designation: string; department: string; joined: string; mine: boolean; wished: boolean }
interface FaqItem { id: string; title: string; body: string; audienceLabel: string }
interface HomeShelf { directory: boolean; canEdit: boolean; handbook: { title: string; version: string } | null; faqs: FaqItem[] }
interface WishEntry { key: string; id: string; kind: string; name: string; sub: string; done: boolean; mark: () => void }
interface WishDraft {
  person: { id: string; name: string; code: string; email: string; role: string; notify: boolean };
  kind: string;
  occasion: string;
  mailbox: boolean;
  subject: string;
  heading: string;
  body: string;
  html: string;
}
interface Wish {
  id: string;
  name: string;
  code: string;
  kind: string;
  label: string;
  when: string;
  day: string;
  years: number;
  mine: boolean;
  sent: boolean;
}
interface HomeJob { id: string; code: string; title: string; internal: boolean; referral: boolean }
interface Colleague { id?: string; name: string; code: string; designation: string; department: string; location: string }
interface HomeBlockState {
  key: string;
  label: string;
  group: string;
  icon: string;
  visible: boolean;
  available: boolean;
  hiddenByMe: boolean;
  board: boolean;
  size: BoxSize;
  sizes: BoxSize[];
}
interface DatedPerson { id: string; code: string; name: string; day: string }
interface TeamToday {
  total: number;
  in: number;
  leave: number;
  notIn: number;
  working: boolean;
  dayNote: string;
  people: Array<{ id: string; code: string; name: string; designation: string; state: 'in' | 'out' | 'away' | 'leave' | 'none' | 'off'; note: string }>;
}
interface CompanyToday { headcount: number; onboarding: number; present: number; leave: number; away: number; notIn: number; joiningSoon: number; working: boolean; dayNote: string }
interface PeopleWatch { probation: DatedPerson[]; leaving: DatedPerson[]; exitRequests: number; onboarding: number; openTasks: number; detailChanges: number }
interface PayrollDesk {
  month: string;
  label: string;
  people: number;
  withCtc: number;
  drafts: number;
  published: number;
  locked: boolean;
  missingBank: number;
  previous: { label: string; published: number; drafts: number; locked: boolean };
}
interface HiringDesk { openJobs: number; fresh: number; waiting: number; shortlisted: number; interview: number; latest: Array<{ id: string; name: string; jobTitle: string; status: string; at: string }> }
interface AssetsDesk {
  stock: number;
  issued: number;
  repair: number;
  lost: number;
  warranty: Array<{ id: string; tag: string; name: string; day: string }>;
  renewals: Array<{ id: string; tag: string; name: string; day: string; overdue: boolean }>;
}
interface MyRequests { pending: number; items: Array<{ link: string; title: string; status: string; at: string }> }
interface Shortcut { link: string; label: string; icon: string }
interface HomePayload {
  greeting: string;
  announcements: Announcement[];
  leave: LeaveBalance[];
  attendance: PunchState | null;
  people: number;
  pending: number;
  widgets: HomeWidget[];
  absent: number;
  month: string;
  today: string;
  days: HomeDay[];
  joiners: Joiner[];
  jobs: HomeJob[];
  celebrations: { mailbox: boolean; note: string; items: Wish[] };
  blocks?: HomeBlockState[];
  columns?: HomeColumns;
  personal?: boolean;
  teamToday?: TeamToday | null;
  companyToday?: CompanyToday | null;
  peopleWatch?: PeopleWatch | null;
  payrollDesk?: PayrollDesk | null;
  hiringDesk?: HiringDesk | null;
  assetsDesk?: AssetsDesk | null;
  myAssets?: Array<{ id: string; tag: string; name: string; kind: string; issuedOn: string }> | null;
  myPay?: { month: string; label: string; net: string; paidDays: number } | null;
  myRequests?: MyRequests | null;
  holidays?: Array<{ day: string; name: string }> | null;
}

const SIZE_LABEL: Record<BoxSize, string> = { s: 'Small', m: 'Half width', l: 'Full width' };
type HomeColumns = 1 | 2 | 3 | 4;
const COLUMN_CHOICES: Array<{ value: HomeColumns; split: string; title: string; bars: number[] }> = [
  { value: 1, split: '12', title: 'One column', bars: [1] },
  { value: 2, split: '6 6', title: 'Two equal columns', bars: [1, 1] },
  { value: 3, split: '4 4 4', title: 'Three equal columns', bars: [1, 1, 1] },
  { value: 4, split: '3 3 3 3', title: 'Four columns', bars: [1, 1, 1, 1] },
];

@Component({
  selector: 'app-home',
  imports: [RouterLink, FormsModule, RichViewComponent, RichEditorComponent, ModalComponent, PunchClockComponent, AttendanceMonthComponent, CelebrateComponent, PhotoComponent],
  template: `
    @if (data) {
      <section class="hb" aria-label="Today">
        <span class="hb-art" aria-hidden="true"><i></i><i></i><i></i></span>
        <div class="hb-main">
          <p class="hb-kicker"><i [class]="'bi ' + dayIcon()"></i> {{ data.greeting }} · {{ todayLabel() }}</p>
          <h1>{{ firstName() }}<span>.</span></h1>
          <p class="hb-lead">{{ heroLead() }}</p>
          <div class="hb-stats">
            @if (canApprovals()) {
              <a routerLink="/approvals" [class.is-hot]="data.pending > 0">
                <i class="bi bi-hourglass-split"></i>
                <strong>{{ data.pending }}</strong><span>Waiting on you</span>
              </a>
            }
            @if (data.attendance) {
              <a routerLink="/attendance">
                <i class="bi bi-calendar-check"></i>
                <strong>{{ tally('present') + tally('onduty') }}</strong><span>Present in {{ monthShort() }}</span>
              </a>
            }
            @if (leaveLeft() !== null) {
              <a routerLink="/leave">
                <i class="bi bi-airplane"></i>
                <strong>{{ leaveLeft() }}</strong><span>Leave days left</span>
              </a>
            }
            @if (data.companyToday; as co) {
              <a [routerLink]="canExceptions() ? '/exceptions' : '/people'">
                <i class="bi bi-people"></i>
                <strong>{{ co.present + co.away }}<em>/{{ co.headcount }}</em></strong><span>Working today</span>
              </a>
            } @else if (data.teamToday) {
              <a routerLink="/team">
                <i class="bi bi-people"></i>
                <strong>{{ data.teamToday.in }}<em>/{{ data.teamToday.total }}</em></strong><span>My team working</span>
              </a>
            }
          </div>
        </div>
        @if (searchOn()) {
          <div class="people-find-wrap">
            <form class="people-find" (ngSubmit)="find()">
              <label for="who" class="sr">Find a colleague</label>
              <i class="bi bi-search"></i>
              <input id="who" name="who" [(ngModel)]="query" placeholder="Find a colleague" autocomplete="off">
              <button class="btn btn-primary" type="submit"><i class="bi bi-search"></i> Search</button>
            </form>
            @if (searched) {
              <div class="people-results">
                @if (short) { <p class="muted">Type at least two letters.</p> }
                @else if (!colleagues.length) { <p class="muted">No one matches that.</p> }
                @for (person of colleagues; track person.code) {
                  <div class="people-hit">
                    <app-photo size="md" [personId]="person.id || ''" [name]="person.name" />
                    <div>
                      <strong>{{ person.name }}</strong>
                      <small>{{ person.designation || 'Team member' }}@if (person.department) { · {{ person.department }} }@if (person.location) { · {{ person.location }} }</small>
                    </div>
                    @if (canOpenPeople && person.id) {
                      <a class="btn btn-ghost btn-sm" [routerLink]="['/people', person.id]"><i class="bi bi-box-arrow-up-right"></i> Open</a>
                    }
                  </div>
                }
              </div>
            }
          </div>
        }
      </section>

      <section class="card home-links" aria-label="Everyday links">
        <h2><i class="bi bi-grid"></i> For you</h2>
        <div class="home-link-grid">
          <a class="home-link" routerLink="/recognition">
            <i class="bi bi-award"></i>
            <span><strong>Rewards and recognition</strong><small>Thank a colleague</small></span>
          </a>
          @if (shelf?.directory !== false && searchOn()) {
            <button type="button" class="home-link" (click)="focusSearch()">
              <i class="bi bi-search"></i>
              <span><strong>Employee search</strong><small>Find a colleague</small></span>
            </button>
          }
          <a class="home-link" routerLink="/news">
            <i class="bi bi-newspaper"></i>
            <span><strong>News and articles</strong><small>Announcements</small></span>
          </a>
          <button type="button" class="home-link" (click)="openFaqs()">
            <i class="bi bi-question-circle"></i>
            <span><strong>FAQs</strong><small>{{ faqCount() }}</small></span>
          </button>
          @if (shelf?.handbook) {
            <button type="button" class="home-link" (click)="openHandbook()">
              <i class="bi bi-journal-bookmark"></i>
              <span><strong>HR handbook</strong><small>Version {{ shelf?.handbook?.version }}</small></span>
            </button>
          } @else if (shelf?.canEdit) {
            <a class="home-link" routerLink="/library">
              <i class="bi bi-journal-bookmark"></i>
              <span><strong>HR handbook</strong><small>Publish the PDF in Library</small></span>
            </a>
          } @else if (shelf) {
            <button type="button" class="home-link" disabled>
              <i class="bi bi-journal-bookmark"></i>
              <span><strong>HR handbook</strong><small>Not published yet</small></span>
            </button>
          }
        </div>
      </section>

      @if (!editing) {
        <div class="home-toolbar">
          @if (layoutNote) { <span [class]="layoutFailed ? 'form-error' : 'form-ok'">{{ layoutNote }}</span> }
          <button type="button" class="btn btn-ghost btn-sm" (click)="startEdit()"><i class="bi bi-grid-3x2-gap"></i> Edit my Home</button>
          @if (canEditLayouts) {
            <a class="btn btn-ghost btn-sm" routerLink="/settings" [queryParams]="{ tab: 'home' }"><i class="bi bi-house-gear"></i> Home layouts for roles and people</a>
          }
        </div>
      } @else {
        <section class="card home-editbar" aria-live="polite">
          <div class="home-editbar-head">
            <div>
              <h2><i class="bi bi-grid-3x2-gap"></i> Arrange my Home</h2>
              <p class="muted">Drag a box by its handle <i class="bi bi-grip-vertical"></i> to move it, or use the arrows. On a keyboard, focus the handle and press the arrow keys. Set the columns, change a box's width, or hide boxes you don't need. Only your Home changes.</p>
            </div>
            <div class="home-editbar-actions">
              <div class="home-cols" role="radiogroup" aria-label="Home columns">
                @for (option of columnChoices; track option.value) {
                  <button type="button" role="radio" [attr.aria-checked]="columns === option.value" [class.is-on]="columns === option.value" (click)="setColumns(option.value)" [title]="option.title">
                    <span class="home-cols-mark" aria-hidden="true">
                      @for (bar of option.bars; track $index) { <i></i> }
                    </span>
                    <span>{{ option.split }}</span>
                  </button>
                }
              </div>
              @if (changed()) { <span class="chip is-warn">Unsaved changes</span> }
              <button type="button" class="btn btn-ghost" (click)="cancelEdit()" [disabled]="busy === 'mine'">Cancel</button>
              <button type="button" class="btn btn-ghost" (click)="resetLayout()" [disabled]="busy === 'mine' || !data.personal" [title]="data.personal ? 'Drop your arrangement and use the company layout' : 'Your Home already uses the company layout'"><i class="bi bi-arrow-counterclockwise"></i> Company default</button>
              <button type="button" class="btn btn-gold" (click)="saveLayout()" [disabled]="busy === 'mine' || !changed()"><i class="bi bi-check2"></i> {{ busy === 'mine' ? 'Saving…' : 'Save my Home' }}</button>
            </div>
          </div>
          <span class="sr" aria-live="assertive">{{ moveNote }}</span>
          @if (searchAvailable()) {
            <label class="home-search-toggle"><input type="checkbox" [checked]="!draftHidden.has('directory')" (change)="toggleSearch()"> Show the "Find a colleague" search at the top</label>
          }
          @if (hiddenBoxes().length) {
            <p class="access-label">Hidden boxes. Select one to add it back</p>
            <div class="home-tray">
              @for (block of hiddenBoxes(); track block.key) {
                <button type="button" class="home-tray-item" (click)="unhide(block.key)"><i [class]="'bi ' + block.icon"></i> {{ block.label }} <i class="bi bi-plus-lg"></i></button>
              }
            </div>
          }
          @if (layoutNote) { <p [class]="layoutFailed ? 'form-error' : 'form-ok'">{{ layoutNote }}</p> }
        </section>
      }

      <div class="home-board" [class.cols-1]="columns === 1" [class.cols-2]="columns === 2" [class.cols-3]="columns === 3" [class.cols-4]="columns === 4" [class.is-editing]="editing" [class.is-dragging]="!!dragKey">
        @for (block of boxes(); track block.key; let index = $index; let last = $last) {
          @if (editing || hasContent(block.key)) {
            <div [class]="'home-box size-' + block.size + (dragKey === block.key ? ' is-dragged' : '')" [attr.data-key]="block.key" (dragover)="dragOver($event, block.key)" (drop)="$event.preventDefault(); stopDrag?.()">
              @if (editing) {
                <div class="home-box-bar">
                  <button type="button" class="home-grip" draggable="true" (dragstart)="dragStart($event, block.key)" (dragend)="stopDrag?.()" (pointerdown)="startDrag($event, block.key)" (keydown)="keyMove($event, block.key)" [attr.aria-label]="'Move ' + block.label + '. Use the arrow keys'" title="Drag to move"><i class="bi bi-grip-vertical"></i></button>
                  <span class="home-box-name"><i [class]="'bi ' + block.icon"></i> {{ block.label }}</span>
                  <span class="home-box-tools">
                    <button type="button" (click)="move(block.key, -1)" [disabled]="index === 0" [attr.aria-label]="'Move ' + block.label + ' earlier'" title="Move earlier"><i class="bi bi-arrow-left"></i></button>
                    <button type="button" (click)="move(block.key, 1)" [disabled]="last" [attr.aria-label]="'Move ' + block.label + ' later'" title="Move later"><i class="bi bi-arrow-right"></i></button>
                    @if (block.sizes.length > 1) {
                      <button type="button" class="home-resize" (click)="resize(block)" [attr.aria-label]="'Width of ' + block.label + ': ' + sizeLabel(block.size) + '. Change'" [title]="'Width: ' + sizeLabel(block.size)"><i [class]="block.size === 'l' ? 'bi bi-arrows-angle-contract' : 'bi bi-arrows-angle-expand'"></i></button>
                    }
                    <button type="button" (click)="hide(block.key)" [attr.aria-label]="'Hide ' + block.label" title="Hide"><i class="bi bi-eye-slash"></i></button>
                  </span>
                </div>
              }
              @if (!hasContent(block.key)) {
                <section class="card home-box-empty">
                  <p class="muted"><i [class]="'bi ' + block.icon"></i> {{ block.label }} is empty right now. It shows once there is something in it.</p>
                </section>
              } @else {
                @switch (block.key) {
                  @case ('punch') {
                    @if (data.attendance) {
                      <app-punch-clock [state]="data.attendance" [compact]="true" (changed)="data.attendance = $event" />
                    } @else {
                      <section class="clock-card is-empty">
                        <span class="bento-ico"><i class="bi bi-person-exclamation"></i></span>
                        <div>
                          <strong>No person record linked</strong>
                          <p class="muted">Check-in starts once HR links this sign-in to a person.</p>
                        </div>
                      </section>
                    }
                  }
                  @case ('approvals') {
                    @if (canApprovals()) {
                      <a class="home-panel" routerLink="/approvals">
                        <div class="home-panel-top">
                          <span class="home-panel-ico"><i class="bi bi-hourglass-split"></i></span>
                          <div>
                            <small>Waiting on you</small>
                            <span class="home-panel-cta">Open approvals <i class="bi bi-arrow-right"></i></span>
                          </div>
                        </div>
                        <div class="home-panel-hero">
                          <strong>{{ data.pending }}</strong>
                          <p>{{ data.pending === 1 ? 'Request needs a decision' : data.pending ? 'Requests need a decision' : 'Nothing waiting right now' }}</p>
                        </div>
                        <div class="home-panel-foot">
                          @if (data.peopleWatch; as watch) {
                            <span><b>{{ watch.exitRequests }}</b> resignations</span>
                            <span><b>{{ watch.detailChanges }}</b> detail changes</span>
                          } @else {
                            <span>Leave, attendance, and resignations</span>
                            <span>{{ data.pending ? 'Review the inbox' : 'You are clear' }}</span>
                          }
                        </div>
                      </a>
                    }
                  }
                  @case ('month-tally') {
                    <a class="home-panel" routerLink="/attendance">
                      <div class="home-panel-top">
                        <span class="home-panel-ico"><i class="bi bi-calendar-check"></i></span>
                        <div>
                          <small>This month · {{ monthShort() }}</small>
                          <span class="home-panel-cta">Open attendance <i class="bi bi-arrow-right"></i></span>
                        </div>
                      </div>
                      <div class="home-panel-hero">
                        <strong>{{ tally('present') + tally('onduty') }}<em> present</em></strong>
                        <p>{{ monthDaysLogged() }} of {{ data.days.length }} working days logged</p>
                      </div>
                      <div class="home-panel-mix" role="img" [attr.aria-label]="monthMixLabel()">
                        @if (monthShare('present')) { <span class="is-present" [style.flex-grow]="monthShare('present')"></span> }
                        @if (monthShare('leave')) { <span class="is-leave" [style.flex-grow]="monthShare('leave')"></span> }
                        @if (monthShare('absent')) { <span class="is-absent" [style.flex-grow]="monthShare('absent')"></span> }
                        @if (monthShare('missed')) { <span class="is-missed" [style.flex-grow]="monthShare('missed')"></span> }
                      </div>
                      <div class="home-panel-foot is-grid">
                        <span><b>{{ tally('present') + tally('onduty') }}</b> present</span>
                        <span><b>{{ tally('leave') }}</b> leave</span>
                        <span><b>{{ tally('absent') }}</b> absent</span>
                        <span><b>{{ tally('missed') }}</b> missed</span>
                      </div>
                    </a>
                  }
                  @case ('my-pay') {
                    <a class="home-panel" routerLink="/pay">
                      <div class="home-panel-top">
                        <span class="home-panel-ico"><i class="bi bi-wallet2"></i></span>
                        <div>
                          <small>Net pay · {{ data.myPay!.label }}</small>
                          <span class="home-panel-cta">Open payslip <i class="bi bi-arrow-right"></i></span>
                        </div>
                      </div>
                      <div class="home-panel-hero">
                        <strong>{{ data.myPay!.net }}</strong>
                        <p>{{ data.myPay!.paidDays }} paid {{ data.myPay!.paidDays === 1 ? 'day' : 'days' }} in this slip</p>
                      </div>
                      <div class="home-panel-foot">
                        <span>Published by payroll</span>
                        <span>View breakup</span>
                      </div>
                    </a>
                  }
                  @case ('company-today') {
                    @let co = data.companyToday!;
                    <section class="card dash-card">
                      <div class="card-head"><h2><i class="bi bi-buildings"></i> Company today</h2><a routerLink="/people">People</a></div>
                      <div class="dash-body">
                      @if (co.dayNote) { <p class="muted">{{ co.dayNote }}</p> }
                      <div class="desk-stats">
                        <a routerLink="/people"><strong>{{ co.headcount }}</strong><span>Headcount</span></a>
                        <a routerLink="/exceptions"><strong>{{ co.present }}</strong><span>Checked in</span></a>
                        <a routerLink="/exceptions"><strong>{{ co.away }}</strong><span>On duty or WFH</span></a>
                        <a routerLink="/exceptions"><strong>{{ co.leave }}</strong><span>On leave</span></a>
                        <a routerLink="/exceptions" [class.is-warn]="co.notIn > 0"><strong>{{ co.notIn }}</strong><span>Not checked in</span></a>
                      </div>
                      <small class="muted">{{ co.onboarding }} onboarding · {{ co.joiningSoon }} joining in the next 30 days</small>
                      </div>
                    </section>
                  }
                  @case ('team-today') {
                    @let team = data.teamToday!;
                    <section class="card dash-card">
                      <div class="card-head"><h2><i class="bi bi-people"></i> My team today</h2><a routerLink="/team">My team</a></div>
                      <div class="dash-body">
                      @if (team.dayNote) { <p class="muted">{{ team.dayNote }}</p> }
                      <div class="chip-row desk-chips">
                        <span class="chip is-ok">{{ team.in }} of {{ team.total }} working</span>
                        <span class="chip is-info">{{ team.leave }} on leave</span>
                        @if (team.working) { <span class="chip" [class.is-warn]="team.notIn > 0">{{ team.notIn }} not checked in</span> }
                      </div>
                      @for (person of team.people; track person.id) {
                        <div class="people-hit">
                          <app-photo size="sm" [personId]="person.id" [name]="person.name" />
                          <div><strong>{{ person.name }}</strong><small>{{ person.designation || person.code }}</small></div>
                          <span [class]="'chip chip-dot desk-state ' + stateClass(person.state)">{{ person.note }}</span>
                        </div>
                      }
                      @if (team.total > team.people.length) { <a class="desk-more" routerLink="/team">{{ team.total - team.people.length }} more in my team</a> }
                      </div>
                    </section>
                  }
                  @case ('payroll-desk') {
                    @let pay = data.payrollDesk!;
                    <section class="card dash-card">
                      <div class="card-head"><h2><i class="bi bi-cash-stack"></i> Payroll · {{ pay.label }}</h2><a routerLink="/payroll">Open payroll</a></div>
                      <div class="dash-body">
                      <div class="desk-stats">
                        <a routerLink="/payroll"><strong>{{ pay.people }}</strong><span>On payroll</span></a>
                        <a routerLink="/payroll" [class.is-warn]="pay.withCtc < pay.people"><strong>{{ pay.people - pay.withCtc }}</strong><span>Without a CTC</span></a>
                        <a routerLink="/payroll"><strong>{{ pay.drafts }}</strong><span>Draft slips</span></a>
                        <a routerLink="/payroll"><strong>{{ pay.published }}</strong><span>Published</span></a>
                        <a routerLink="/people" [class.is-warn]="pay.missingBank > 0"><strong>{{ pay.missingBank }}</strong><span>Missing bank or IFSC</span></a>
                      </div>
                      <small class="muted">
                        {{ pay.locked ? 'This month is locked.' : 'This month is open.' }}
                        {{ pay.previous.label }}: {{ pay.previous.published }} published, {{ pay.previous.drafts }} in draft{{ pay.previous.locked ? ', locked' : ', not locked' }}.
                      </small>
                      </div>
                    </section>
                  }
                  @case ('hiring-desk') {
                    @let hire = data.hiringDesk!;
                    <section class="card dash-card">
                      <div class="card-head"><h2><i class="bi bi-briefcase"></i> Hiring</h2><a routerLink="/hiring/applications">Applications</a></div>
                      <div class="dash-body">
                      <div class="desk-stats">
                        <a routerLink="/hiring"><strong>{{ hire.openJobs }}</strong><span>Open jobs</span></a>
                        <a routerLink="/hiring/applications"><strong>{{ hire.fresh }}</strong><span>New this week</span></a>
                        <a routerLink="/hiring/applications" [class.is-warn]="hire.waiting > 0"><strong>{{ hire.waiting }}</strong><span>To review</span></a>
                        <a routerLink="/hiring/applications"><strong>{{ hire.shortlisted }}</strong><span>Shortlisted</span></a>
                        <a routerLink="/hiring/applications"><strong>{{ hire.interview }}</strong><span>Interview</span></a>
                      </div>
                      @for (row of hire.latest; track row.id) {
                        <a class="job-line" [routerLink]="['/hiring/applications', row.id]"><strong>{{ row.name }}</strong><small>{{ applicationLine(row) }}</small></a>
                      }
                      </div>
                    </section>
                  }
                  @case ('people-watch') {
                    @let watch = data.peopleWatch!;
                    <section class="card dash-card">
                      <div class="card-head"><h2><i class="bi bi-person-lines-fill"></i> People to watch</h2><a routerLink="/people">People</a></div>
                      <div class="dash-body">
                      <div class="desk-stats">
                        <a routerLink="/people"><strong>{{ watch.onboarding }}</strong><span>Onboarding</span></a>
                        <a routerLink="/people" [class.is-warn]="watch.openTasks > 0"><strong>{{ watch.openTasks }}</strong><span>Open joining tasks</span></a>
                        <a routerLink="/approvals" [class.is-warn]="watch.exitRequests > 0"><strong>{{ watch.exitRequests }}</strong><span>Resignations to decide</span></a>
                        <a routerLink="/approvals" [class.is-warn]="watch.detailChanges > 0"><strong>{{ watch.detailChanges }}</strong><span>Detail changes</span></a>
                      </div>
                      @if (watch.probation.length) {
                        <p class="access-label">Probation ends in 30 days</p>
                        @for (row of watch.probation; track row.id) {
                          <a class="job-line" [routerLink]="['/people', row.id]"><strong>{{ row.name }}</strong><small>{{ row.code }} · {{ joinedLabel(row.day) }}</small></a>
                        }
                      }
                      @if (watch.leaving.length) {
                        <p class="access-label">Last day in 30 days</p>
                        @for (row of watch.leaving; track row.id) {
                          <a class="job-line" [routerLink]="['/people', row.id]"><strong>{{ row.name }}</strong><small>{{ row.code }} · {{ joinedLabel(row.day) }}</small></a>
                        }
                      }
                      </div>
                    </section>
                  }
                  @case ('assets-desk') {
                    @let kit = data.assetsDesk!;
                    <section class="card dash-card">
                      <div class="card-head"><h2><i class="bi bi-pc-display"></i> Assets desk</h2><a routerLink="/assets">Assets</a></div>
                      <div class="dash-body">
                      <div class="desk-stats">
                        <a routerLink="/assets"><strong>{{ kit.stock }}</strong><span>In stock</span></a>
                        <a routerLink="/assets"><strong>{{ kit.issued }}</strong><span>Issued</span></a>
                        <a routerLink="/assets" [class.is-warn]="kit.repair > 0"><strong>{{ kit.repair }}</strong><span>In repair</span></a>
                        <a routerLink="/assets" [class.is-warn]="kit.lost > 0"><strong>{{ kit.lost }}</strong><span>Lost</span></a>
                      </div>
                      @if (kit.renewals.length) {
                        <p class="access-label">Licence renewals</p>
                        @for (row of kit.renewals; track row.id) {
                          <a class="job-line" routerLink="/assets"><strong>{{ row.name }}</strong><small>{{ row.tag }} · @if (row.overdue) { <span class="chip is-bad">Overdue {{ joinedLabel(row.day) }}</span> } @else { Renews {{ joinedLabel(row.day) }} }</small></a>
                        }
                      }
                      @if (kit.warranty.length) {
                        <p class="access-label">Warranty ends in 30 days</p>
                        @for (row of kit.warranty; track row.id) {
                          <a class="job-line" routerLink="/assets"><strong>{{ row.name }}</strong><small>{{ row.tag }} · {{ joinedLabel(row.day) }}</small></a>
                        }
                      }
                      @if (!kit.renewals.length && !kit.warranty.length) { <small class="muted">No renewals or warranties ending in the next 30 days.</small> }
                      </div>
                    </section>
                  }
                  @case ('calendar') {
                    <app-attendance-month [compact]="true" [month]="data.month" (changed)="refreshAfterCalendar()" />
                  }
                  @case ('leave') {
                    <section class="card dash-card">
                      <div class="card-head">
                        <h2><i class="bi bi-calendar2-week"></i> Leave left</h2>
                        <a routerLink="/leave"><i class="bi bi-plus-lg"></i> Apply</a>
                      </div>
                      <div class="dash-body">
                      @if (data.leave.length) {
                        @for (item of data.leave; track item.id) {
                          <div class="leave-line">
                            <div><span>{{ item.name }}</span><strong>{{ item.entitled ? item.left : 'Open' }}</strong></div>
                            <span class="balance-meter"><i [style.width.%]="leftShare(item)"></i></span>
                            <small>{{ item.entitled ? item.left + ' of ' + item.entitled + ' left' : 'No yearly limit' }}</small>
                          </div>
                        }
                      } @else {
                        <p class="muted">Leave balances appear once your sign-in is linked to a person.</p>
                      }
                      </div>
                    </section>
                  }
                  @case ('my-requests') {
                    @let mine = data.myRequests!;
                    <section class="card dash-card">
                      <div class="card-head"><h2><i class="bi bi-send"></i> My requests</h2><a routerLink="/requests">All requests</a></div>
                      <div class="dash-body">
                      @if (!mine.items.length) {
                        <p class="muted">Nothing waiting and nothing decided in the last 14 days.</p>
                      } @else {
                        <p class="muted">{{ mine.pending ? mine.pending + ' waiting for a decision' : 'Nothing waiting for a decision' }}</p>
                      }
                      @for (item of mine.items; track item.title + item.at) {
                        <a class="job-line home-request" [routerLink]="item.link">
                          <span><strong>{{ item.title }}</strong><small>{{ posted(item.at) }}</small></span>
                          <span [class]="'chip ' + requestClass(item.status)">{{ requestLabel(item.status) }}</span>
                        </a>
                      }
                      </div>
                    </section>
                  }
                  @case ('shortcuts') {
                    <section class="card dash-card">
                      <h2><i class="bi bi-lightning-charge"></i> Shortcuts</h2>
                      <div class="dash-body">
                      <div class="home-shortcuts">
                        @for (item of shortcuts; track item.link) {
                          <a class="btn btn-ghost btn-sm" [routerLink]="item.link"><i [class]="'bi ' + item.icon"></i> {{ item.label }}</a>
                        }
                      </div>
                      </div>
                    </section>
                  }
                  @case ('my-assets') {
                    <section class="card dash-card">
                      <div class="card-head"><h2><i class="bi bi-laptop"></i> My assets</h2><a routerLink="/profile">My details</a></div>
                      <div class="dash-body">
                      @for (item of data.myAssets; track item.id) {
                        <div class="job-line"><strong>{{ item.name }}</strong><small>{{ item.tag }} · {{ item.kind }}@if (item.issuedOn) { · Issued {{ joinedLabel(item.issuedOn) }} }</small></div>
                      }
                      </div>
                    </section>
                  }
                  @case ('holidays') {
                    <section class="card dash-card">
                      <div class="card-head"><h2><i class="bi bi-balloon"></i> Upcoming holidays</h2><a routerLink="/attendance">Calendar</a></div>
                      <div class="dash-body">
                      @for (item of data.holidays; track item.day) {
                        <div class="job-line"><strong>{{ item.name }}</strong><small>{{ holidayLabel(item.day) }}</small></div>
                      }
                      </div>
                    </section>
                  }
                  @case ('celebrations') {
                    <section class="card dash-card">
                      <h2><i class="bi bi-gift"></i> Birthdays and anniversaries</h2>
                      <div class="dash-body">
                      <p class="muted">{{ data.celebrations.note }}</p>
                      @for (person of data.celebrations.items; track person.id + person.kind + person.day) {
                        <div class="people-hit">
                          <app-photo size="md" [personId]="person.id || ''" [name]="person.name" />
                          <div>
                            <strong>{{ person.name }}</strong>
                            <small>{{ person.label }}@if (person.years) { · {{ person.years }} years } · {{ person.when }}</small>
                          </div>
                          @if (person.mine) {
                            <span class="pill">You</span>
                          } @else if (person.sent) {
                            <span class="pill gold">Sent</span>
                          } @else {
                            <button class="btn btn-gold" type="button" (click)="wishTo(person)"><i class="bi bi-gift"></i> Congrats</button>
                          }
                        </div>
                      }
                      </div>
                    </section>
                  }
                  @case ('joiners') {
                    <section class="card dash-card">
                      <h2><i class="bi bi-person-plus"></i> New joiners</h2>
                      <div class="dash-body">
                      @for (person of data.joiners; track person.id) {
                        <div class="people-hit">
                          <app-photo size="md" [personId]="person.id || ''" [name]="person.name" />
                          <div>
                            <strong>{{ person.name }}</strong>
                            <small>{{ person.designation || person.department || 'Team member' }} · {{ joinedLabel(person.joined) }}</small>
                          </div>
                          @if (person.mine) {
                            <span class="pill">You</span>
                          } @else if (person.wished) {
                            <span class="pill gold">Sent</span>
                          } @else {
                            <button class="btn btn-gold" type="button" (click)="welcome(person)"><i class="bi bi-gift"></i> Congrats</button>
                          }
                        </div>
                      }
                      </div>
                    </section>
                  }
                  @case ('jobs') {
                    <section class="card dash-card">
                      <div class="card-head"><h2><i class="bi bi-door-open"></i> Open inside the company</h2><a routerLink="/jobs">All jobs</a></div>
                      <div class="dash-body">
                      @for (job of data.jobs; track job.id) {
                        <a class="job-line" routerLink="/jobs">
                          <strong>{{ job.title }}</strong>
                          <small>{{ job.code }}@if (job.internal) { · Apply }@if (job.referral) { · Refer }</small>
                        </a>
                      }
                      </div>
                    </section>
                  }
                  @case ('announcements') {
                    <section class="card dash-card dash-news">
                      <div class="card-head">
                        <h2><i class="bi bi-megaphone"></i> Announcements</h2>
                        <a routerLink="/news">View all</a>
                      </div>
                      <div class="dash-body">
                      @if (!data.announcements.length) { <p class="muted">Nothing has been posted yet.</p> }
                      @for (item of data.announcements; track item.id) {
                        <article class="feed-item">
                          <div class="row-between"><h3>{{ item.title }}</h3>@if (item.pinned) { <span class="pill gold">Pinned</span> }</div>
                          <app-rich-view class="rte-clamp" [value]="item.body" />
                          <small>{{ item.authorName }} · {{ posted(item.createdAt) }}</small>
                        </article>
                      }
                      </div>
                    </section>
                  }
                }
              }
            </div>
          }
        }
        @if (editing && !boxes().length) {
          <section class="card home-box-empty size-l"><p class="muted">Every box is hidden. Add some back from the list above.</p></section>
        }
      </div>
      @if (!editing && !visibleCount()) {
        <section class="card"><p class="muted">Your Home has no boxes. Choose <strong>Edit my Home</strong> to add some back.</p></section>
      }
    } @else if (error) {
      <p class="form-error" data-inline-message>{{ error }}</p>
    } @else {
      <p class="muted">Loading your day…</p>
    }
    <app-modal [open]="faqsOpen" size="lg" title="FAQs" subtitle="Answers for your role. Search, then open one." icon="bi-question-circle" tone="navy" (closed)="faqsOpen = false">
      <label class="faq-search" for="faq-q">
        <i class="bi bi-search"></i>
        <input id="faq-q" name="faqQuery" type="search" [(ngModel)]="faqQuery" placeholder="Search your FAQs" autocomplete="off">
      </label>
      @if (!faqList().length) {
        <p class="muted">{{ faqQuery.trim() ? 'Nothing matches that search.' : 'No FAQs for you yet. Owner and HR add them in Library, and can aim each one at employees, managers, payroll, or HR.' }}</p>
      }
      @for (item of faqList(); track item.id) {
        <article class="faq-item" [class.is-open]="faqOpenId === item.id">
          <button type="button" class="faq-q" (click)="faqOpenId = faqOpenId === item.id ? '' : item.id" [attr.aria-expanded]="faqOpenId === item.id">
            <span>{{ item.title }}</span>
            @if (shelf?.canEdit) { <small>{{ item.audienceLabel }}</small> }
            <i class="bi" [class]="faqOpenId === item.id ? 'bi-chevron-up' : 'bi-chevron-down'"></i>
          </button>
          @if (faqOpenId === item.id) {
            <div class="faq-a"><app-rich-view [value]="item.body" /></div>
          }
        </article>
      }
      <footer modalFooter class="md-foot">
        @if (shelf?.canEdit) { <a class="btn btn-ghost" routerLink="/library" (click)="faqsOpen = false"><i class="bi bi-plus-lg"></i> Add an answer</a> }
        <button type="button" class="btn btn-ghost" (click)="faqsOpen = false">Close</button>
      </footer>
    </app-modal>
    @if (fresh.length) { <app-celebrate [badges]="fresh" (closed)="celebrated()" /> }
    <app-modal [open]="wishOpen" size="xl" title="Send wishes" subtitle="Read the message before it goes out. Change anything you like." icon="bi-gift" tone="gold" [flush]="true" (closed)="closeWishes()">
      <div class="wish-modal">
        <nav class="wish-list" aria-label="People to wish">
          @for (entry of wishList; track entry.key) {
            <button type="button" class="wish-person" [class.is-active]="entry.key === wishActive?.key" [attr.aria-current]="entry.key === wishActive?.key ? 'true' : null" (click)="pickWish(entry)">
              <app-photo size="sm" [personId]="entry.id" [name]="entry.name" />
              <span><strong>{{ entry.name }}</strong><small>{{ entry.sub }}</small></span>
              @if (entry.done) { <span class="pill gold">Sent</span> }
            </button>
          }
        </nav>
        <div class="wish-compose">
          @if (draftError) {
            <p class="form-error" data-inline-message>{{ draftError }}</p>
          } @else if (!wishDraft) {
            <p class="muted">Loading the message…</p>
          } @else {
            <header class="wish-to">
              <app-photo size="md" [personId]="wishDraft.person.id" [name]="wishDraft.person.name" />
              <div>
                <strong>{{ wishDraft.person.name }}@if (wishDraft.person.code) { <span class="muted"> ({{ wishDraft.person.code }})</span> }</strong>
                <small>{{ wishDraft.occasion }}@if (wishDraft.person.role) { · {{ wishDraft.person.role }} }</small>
                @if (wishDraft.person.email && wishDraft.mailbox) {
                  <small class="wish-mail"><i class="bi bi-envelope"></i> {{ wishDraft.person.email }}</small>
                } @else if (wishDraft.person.email) {
                  <small class="wish-mail is-off"><i class="bi bi-envelope-slash"></i> No mailbox is set up, so this goes to their notifications only.</small>
                } @else {
                  <small class="wish-mail is-off"><i class="bi bi-bell"></i> No email on file. This goes to their notifications.</small>
                }
              </div>
            </header>
            <div class="wish-tabs" role="tablist">
              <button type="button" role="tab" [class.is-on]="wishTab === 'write'" [attr.aria-selected]="wishTab === 'write'" (click)="wishTab = 'write'"><i class="bi bi-pencil"></i> Write</button>
              <button type="button" role="tab" [class.is-on]="wishTab === 'preview'" [attr.aria-selected]="wishTab === 'preview'" (click)="showPreview()"><i class="bi bi-eye"></i> Preview email</button>
            </div>
            @if (wishTab === 'write') {
              <div class="wish-fields">
                <div>
                  <label for="wish-subject">Subject</label>
                  <input id="wish-subject" name="wishSubject" maxlength="160" [(ngModel)]="wishDraft.subject" [disabled]="wishActive?.done || false">
                </div>
                <div>
                  <label for="wish-heading">Heading</label>
                  <input id="wish-heading" name="wishHeading" maxlength="160" [(ngModel)]="wishDraft.heading" [disabled]="wishActive?.done || false">
                </div>
                <div>
                  <label for="wish-body">Message</label>
                  <app-rich-editor inputId="wish-body" name="wishBody" label="Message" [max]="4000" [minHeight]="200" [(ngModel)]="wishDraft.body" [disabled]="wishActive?.done || false" />
                </div>
              </div>
            } @else {
              <div class="wish-preview">
                @if (previewing) { <p class="muted">Building the preview…</p> }
                <iframe title="Email preview" sandbox="allow-same-origin" [srcdoc]="wishHtml"></iframe>
              </div>
            }
          }
        </div>
      </div>
      <footer modalFooter class="md-foot">
        <button type="button" class="btn btn-ghost" (click)="closeWishes()">Cancel</button>
        @if (wishActive?.done) {
          <span class="pill gold"><i class="bi bi-check2"></i> Already sent</span>
        } @else {
          <button type="button" class="btn btn-gold" [disabled]="!wishDraft || !!busy" (click)="sendWish()"><i class="bi bi-send"></i> {{ busy ? 'Sending…' : 'Send' }}</button>
        }
      </footer>
    </app-modal>
  `,
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  data: HomePayload | null = null;
  error = '';
  query = '';
  searched = false;
  short = false;
  colleagues: Colleague[] = [];
  busy = '';
  wishOpen = false;
  wishList: WishEntry[] = [];
  wishActive: WishEntry | null = null;
  wishDraft: WishDraft | null = null;
  draftError = '';
  wishTab: 'write' | 'preview' = 'write';
  wishHtml: SafeHtml = '';
  previewing = false;
  private readonly drafts = new Map<string, WishDraft>();
  private readonly sanitizer = inject(DomSanitizer);
  private readonly toast = inject(Toast);
  private readonly sweet = inject(Sweet);
  shelf: HomeShelf | null = null;
  faqsOpen = false;
  faqQuery = '';
  faqOpenId = '';
  fresh: FreshBadge[] = [];
  blanks: number[] = [];
  readonly dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  shortcuts: Shortcut[] = [];

  editing = false;
  columns: HomeColumns = 4;
  readonly columnChoices = COLUMN_CHOICES;
  /** Boxes in the order being arranged, hidden ones included so their place is kept. */
  draft: HomeBlockState[] = [];
  draftHidden = new Set<string>();
  layoutNote = '';
  layoutFailed = false;
  dragKey = '';
  moveNote = '';
  private lastOver = '';
  private startedAs = '';
  stopDrag: (() => void) | null = null;
  private readonly warnUnsaved = (event: BeforeUnloadEvent) => {
    if (this.changed()) event.preventDefault();
  };

  get canOpenPeople(): boolean {
    return !!this.store.me?.access?.includes('people');
  }

  get canEditLayouts(): boolean {
    const access = this.store.me?.access || [];
    return access.includes('settings') || access.includes('library');
  }

  async ngOnInit(): Promise<void> {
    window.addEventListener('beforeunload', this.warnUnsaved);
    await this.load();
    this.api.get<{ badges: FreshBadge[] }>('/v1/recognition/fresh').then((result) => (this.fresh = result.badges)).catch(() => undefined);
    void this.loadShelf();
  }

  ngOnDestroy(): void {
    this.stopDrag?.();
    window.removeEventListener('beforeunload', this.warnUnsaved);
  }

  async mayLeave(): Promise<boolean> {
    if (!this.changed()) return true;
    return this.sweet.confirm({
      title: 'Leave without saving?',
      text: 'Your Home arrangement is not saved. Leave without saving?',
      confirmText: 'Leave',
      cancelText: 'Stay',
      danger: true,
    });
  }

  /** True when the arrangement differs from the one the editor opened with. */
  changed(): boolean {
    return this.editing && this.signature() !== this.startedAs;
  }

  private signature(): string {
    return JSON.stringify([this.columns, this.draft.map((block) => block.key + ':' + block.size), [...this.draftHidden].sort()]);
  }

  celebrated(): void {
    this.fresh = [];
    this.api.post('/v1/recognition/seen', {}).catch(() => undefined);
  }

  private async load(): Promise<void> {
    try {
      this.data = await this.api.get<HomePayload>('/v1/home');
      this.columns = this.columnCount(this.data.columns);
      const first = this.data.days[0]?.day;
      this.blanks = [];
      if (first) {
        const sunday = new Date(first + 'T12:00:00+05:30').getUTCDay();
        const lead = (sunday + 6) % 7;
        this.blanks = Array.from({ length: lead }, (_, index) => index);
      }
      this.shortcuts = this.buildShortcuts();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load home.';
    }
  }

  private allBlocks(): HomeBlockState[] {
    return this.data?.blocks || [];
  }

  /** The boxes on the board right now: the draft while arranging, otherwise what this person sees. */
  boxes(): HomeBlockState[] {
    if (this.editing) return this.draft.filter((block) => !this.draftHidden.has(block.key));
    return this.allBlocks().filter((block) => block.board && block.visible);
  }

  visibleCount(): number {
    return this.boxes().filter((block) => this.hasContent(block.key)).length;
  }

  hiddenBoxes(): HomeBlockState[] {
    return this.draft.filter((block) => this.draftHidden.has(block.key));
  }

  shown(key: string): boolean {
    const row = this.data?.widgets.find((item) => item.key === key);
    return row ? row.visible : true;
  }

  searchAvailable(): boolean {
    return this.allBlocks().some((block) => block.key === 'directory' && block.available);
  }

  faqCount(): string {
    const count = this.shelf?.faqs.length || 0;
    return count ? count + (count === 1 ? ' answer' : ' answers') : 'Answers for your role';
  }

  faqList(): FaqItem[] {
    const query = this.faqQuery.trim().toLowerCase();
    const rows = this.shelf?.faqs || [];
    if (!query) return rows;
    return rows.filter((item) => (item.title + ' ' + item.body.replace(/<[^>]+>/g, ' ')).toLowerCase().includes(query));
  }

  openFaqs(): void {
    this.faqQuery = '';
    this.faqOpenId = this.shelf?.faqs[0]?.id || '';
    this.faqsOpen = true;
  }

  focusSearch(): void {
    const input = document.getElementById('who');
    input?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    input?.focus();
  }

  async openHandbook(): Promise<void> {
    try {
      const blob = await this.api.blob('/v1/library/handbook/file');
      await this.sweet.preview({ title: this.shelf?.handbook?.title || 'HR handbook', subtitle: 'Handbook', blob });
    } catch (error) {
      this.toast.error(error instanceof Error ? error.message : 'Could not open the handbook.');
    }
  }

  private async loadShelf(): Promise<void> {
    try {
      this.shelf = await this.api.get<HomeShelf>('/v1/library/shelf');
    } catch {
      this.shelf = { directory: true, canEdit: false, handbook: null, faqs: [] };
    }
  }

  searchOn(): boolean {
    return this.editing ? this.searchAvailable() && !this.draftHidden.has('directory') : this.shown('directory');
  }

  hasContent(key: string): boolean {
    const d = this.data;
    if (!d) return false;
    switch (key) {
      case 'approvals':
        return this.canApprovals();
      case 'month-tally':
      case 'calendar':
        return d.days.length > 0;
      case 'my-pay': return !!d.myPay;
      case 'company-today': return !!d.companyToday;
      case 'team-today': return !!d.teamToday;
      case 'payroll-desk': return !!d.payrollDesk;
      case 'hiring-desk': return !!d.hiringDesk;
      case 'people-watch': return !!d.peopleWatch;
      case 'assets-desk': return !!d.assetsDesk;
      case 'my-requests': return !!d.myRequests;
      case 'shortcuts': return this.shortcuts.length > 0;
      case 'my-assets': return !!d.myAssets?.length;
      case 'holidays': return !!d.holidays?.length;
      case 'celebrations': return d.celebrations.items.length > 0;
      case 'joiners': return d.joiners.length > 0;
      case 'jobs': return d.jobs.length > 0;
      default: return true;
    }
  }

  setColumns(value: HomeColumns): void {
    this.columns = value;
  }

  private columnCount(value: unknown): HomeColumns {
    const count = Number(value);
    return count === 1 || count === 2 || count === 3 || count === 4 ? count : 4;
  }

  startEdit(): void {
    this.layoutNote = '';
    this.columns = this.columnCount(this.data?.columns);
    const blocks = this.allBlocks().filter((block) => block.available);
    this.draft = blocks.filter((block) => block.board).map((block) => ({ ...block }));
    this.draftHidden = new Set(blocks.filter((block) => block.hiddenByMe).map((block) => block.key));
    this.startedAs = this.signature();
    this.moveNote = '';
    this.editing = true;
  }

  cancelEdit(): void {
    this.stopDrag?.();
    this.columns = this.columnCount(this.data?.columns);
    this.editing = false;
    this.layoutNote = '';
  }

  keyMove(event: KeyboardEvent, key: string): void {
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    this.move(key, step);
    const order = this.boxes();
    const at = order.findIndex((block) => block.key === key);
    this.moveNote = order[at].label + ' is now box ' + (at + 1) + ' of ' + order.length + '.';
    setTimeout(() => (document.querySelector('.home-box[data-key="' + key + '"] .home-grip') as HTMLElement | null)?.focus());
  }

  move(key: string, step: number): void {
    const visible = this.boxes().map((block) => block.key);
    const at = visible.indexOf(key);
    const target = visible[at + step];
    if (at < 0 || !target) return;
    this.place(key, target);
  }

  resize(block: HomeBlockState): void {
    const at = block.sizes.indexOf(block.size);
    block.size = block.sizes[(at + 1) % block.sizes.length];
  }

  sizeLabel(size: BoxSize): string {
    if (this.columns === 1 || size === 'l') return 'Full width';
    if (this.columns < 4) return 'One column';
    return SIZE_LABEL[size];
  }

  hide(key: string): void {
    const next = new Set(this.draftHidden);
    next.add(key);
    this.draftHidden = next;
  }

  unhide(key: string): void {
    const next = new Set(this.draftHidden);
    next.delete(key);
    this.draftHidden = next;
  }

  toggleSearch(): void {
    if (this.draftHidden.has('directory')) this.unhide('directory');
    else this.hide('directory');
  }

  /** Moves one box to where another box is, pushing the rest along. */
  private place(key: string, target: string): void {
    const from = this.draft.findIndex((block) => block.key === key);
    const to = this.draft.findIndex((block) => block.key === target);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...this.draft];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    this.draft = next;
  }

  /** Mouse drags use the browser's own drag and drop, which also draws the box under the cursor. */
  dragStart(event: DragEvent, key: string): void {
    this.stopDrag?.();
    this.dragKey = key;
    this.lastOver = '';
    const onEnd = () => this.stopDrag?.();
    window.addEventListener('dragend', onEnd, true);
    window.addEventListener('drop', onEnd, true);
    this.stopDrag = () => {
      window.removeEventListener('dragend', onEnd, true);
      window.removeEventListener('drop', onEnd, true);
      this.dragKey = '';
      this.lastOver = '';
      this.stopDrag = null;
    };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', key);
      const box = (event.target as HTMLElement).closest('[data-key]');
      if (box) event.dataTransfer.setDragImage(box, 24, 24);
    }
  }

  dragOver(event: DragEvent, key: string): void {
    if (!this.editing || !this.dragKey) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    if (key === this.dragKey) {
      this.lastOver = '';
      return;
    }
    if (key === this.lastOver) return;
    this.lastOver = key;
    this.place(this.dragKey, key);
  }

  /** Touch and pen drags follow the finger, since phones don't run the browser's drag and drop well. */
  startDrag(event: PointerEvent, key: string): void {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    this.stopDrag?.();
    this.dragKey = key;
    this.lastOver = '';
    const onMove = (move: PointerEvent) => {
      move.preventDefault();
      if (move.clientY < 90) window.scrollBy(0, -18);
      else if (move.clientY > window.innerHeight - 70) window.scrollBy(0, 18);
      const over = (document.elementFromPoint(move.clientX, move.clientY) as HTMLElement | null)?.closest('[data-key]') as HTMLElement | null;
      const target = over?.dataset['key'] || '';
      if (!target || target === this.dragKey) {
        this.lastOver = '';
        return;
      }
      if (target === this.lastOver) return;
      this.lastOver = target;
      this.place(this.dragKey, target);
    };
    const onEnd = () => this.stopDrag?.();
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    this.stopDrag = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      this.dragKey = '';
      this.lastOver = '';
      this.stopDrag = null;
    };
  }

  async saveLayout(): Promise<void> {
    const sizes: Record<string, BoxSize> = {};
    for (const block of this.draft) sizes[block.key] = block.size;
    const offForNow = this.allBlocks().filter((block) => block.hiddenByMe && !block.available).map((block) => block.key);
    await this.sendLayout({ order: this.draft.map((block) => block.key), hidden: [...this.draftHidden, ...offForNow], sizes, columns: this.columns }, 'Saved. Your Home keeps this arrangement on every device.');
  }

  async resetLayout(): Promise<void> {
    await this.sendLayout({}, 'Your Home is back to the company layout.');
  }

  private async sendLayout(body: object, message: string): Promise<void> {
    this.busy = 'mine';
    this.layoutNote = '';
    try {
      await this.api.post('/v1/home/mine', body);
      await this.load();
      this.editing = false;
      this.layoutFailed = false;
      this.layoutNote = message;
    } catch (error) {
      this.layoutFailed = true;
      this.layoutNote = error instanceof Error ? error.message : 'Could not save your Home.';
    } finally {
      this.busy = '';
    }
  }

  private buildShortcuts(): Shortcut[] {
    const access = this.store.me?.access || [];
    const linked = !!this.store.me?.employeeId || !!this.data?.attendance;
    const all: Array<Shortcut & { show: boolean }> = [
      { link: '/leave', label: 'Apply for leave', icon: 'bi-calendar-plus', show: linked },
      { link: '/requests', label: 'Attendance request', icon: 'bi-clock-history', show: linked },
      { link: '/pay', label: 'My payslips', icon: 'bi-wallet2', show: linked },
      { link: '/profile', label: 'My details', icon: 'bi-person-vcard', show: linked },
      { link: '/approvals', label: 'Approvals', icon: 'bi-check2-square', show: access.includes('approvals') },
      { link: '/exceptions', label: 'Exceptions', icon: 'bi-exclamation-triangle', show: access.includes('exceptions') },
      { link: '/people', label: 'People', icon: 'bi-people', show: access.includes('people') },
      { link: '/payroll', label: 'Run payroll', icon: 'bi-cash-stack', show: access.includes('pay') },
      { link: '/hiring', label: 'Hiring', icon: 'bi-briefcase', show: access.includes('hiring') },
      { link: '/assets', label: 'Assets', icon: 'bi-pc-display', show: access.includes('assets') },
      { link: '/reports', label: 'Reports', icon: 'bi-bar-chart', show: access.includes('reports') },
      { link: '/news', label: 'Post news', icon: 'bi-megaphone', show: access.includes('news') },
      { link: '/settings', label: 'Settings', icon: 'bi-gear', show: access.includes('settings') },
    ];
    return all.filter((item) => item.show).slice(0, 8).map(({ link, label, icon }) => ({ link, label, icon }));
  }

  firstName(): string {
    return (this.store.me?.name || '').split(' ')[0] || 'there';
  }

  todayLabel(): string {
    const day = this.data?.today ? new Date(this.data.today + 'T12:00:00+05:30') : new Date();
    return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }).format(day);
  }

  dayIcon(): string {
    const hour = new Date().getHours();
    return hour < 12 ? 'bi-sunrise' : hour < 17 ? 'bi-sun' : 'bi-moon-stars';
  }

  /** Total days left on leave types that have a yearly limit, or null when there are none. */
  leaveLeft(): number | null {
    const limited = (this.data?.leave || []).filter((item) => item.entitled);
    return limited.length ? limited.reduce((sum, item) => sum + item.left, 0) : null;
  }

  canApprovals(): boolean {
    return !!this.store.me?.access?.includes('approvals');
  }

  canExceptions(): boolean {
    return !!this.store.me?.access?.includes('exceptions');
  }

  heroLead(): string {
    const pending = this.data?.pending || 0;
    if (this.canApprovals() && pending) {
      return `${pending} ${pending === 1 ? 'request is' : 'requests are'} waiting for your decision.`;
    }
    const access = this.store.me?.access || [];
    if (access.includes('pay') && this.data?.payrollDesk) {
      return 'Open Payroll when you are ready to run the month.';
    }
    if (access.includes('people') && this.data?.peopleWatch) {
      return 'Directory and hiring desks are ready when you need them.';
    }
    const punch = this.data?.attendance;
    if (punch && !punch.firstIn) return 'Check in when your day starts, or apply leave if you need time off.';
    if (punch?.state === 'in') return 'You are checked in. Have a productive day.';
    if (this.leaveLeft() !== null) return 'You are all caught up. Leave and requests are a click away.';
    return 'You are all caught up. Have a good day.';
  }

  tally(status: string): number {
    return this.data?.days.filter((day) => day.status === status).length || 0;
  }

  monthShare(status: string): number {
    if (status === 'present') return this.tally('present') + this.tally('onduty');
    return this.tally(status);
  }

  monthDaysLogged(): number {
    return this.monthShare('present') + this.monthShare('leave') + this.monthShare('absent') + this.monthShare('missed');
  }

  monthMixLabel(): string {
    return [
      `${this.monthShare('present')} present`,
      `${this.monthShare('leave')} leave`,
      `${this.monthShare('absent')} absent`,
      `${this.monthShare('missed')} missed`,
    ].join(', ');
  }

  monthLabel(): string {
    if (!this.data?.month) return '';
    const [year, month] = this.data.month.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  monthShort(): string {
    if (!this.data?.month) return '';
    const [year, month] = this.data.month.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' });
  }

  dayNum(day: string): string {
    return String(Number(day.slice(8)));
  }

  refreshAfterCalendar(): void {
    void this.load();
  }

  leftShare(item: LeaveBalance): number {
    if (!item.entitled) return 100;
    return Math.max(0, Math.min(100, (item.left / item.entitled) * 100));
  }

  joinedLabel(day: string): string {
    const date = new Date(day + 'T12:00:00+05:30');
    if (Number.isNaN(date.getTime())) return day;
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
  }

  holidayLabel(day: string): string {
    const date = new Date(day + 'T12:00:00+05:30');
    if (Number.isNaN(date.getTime())) return day;
    return new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(date);
  }

  stateClass(state: string): string {
    return state === 'in' || state === 'out' ? 'is-ok' : state === 'away' || state === 'leave' ? 'is-info' : state === 'none' ? 'is-warn' : '';
  }

  requestClass(status: string): string {
    return status === 'approved' ? 'is-ok' : status === 'rejected' ? 'is-bad' : status === 'pending' ? 'is-warn' : '';
  }

  requestLabel(status: string): string {
    return status === 'pending' ? 'Waiting' : status === 'approved' ? 'Approved' : status === 'rejected' ? 'Declined' : status === 'cancelled' ? 'Cancelled' : status;
  }

  applicationLine(row: { jobTitle: string; status: string; at: string }): string {
    const status = row.status === 'new' ? 'New' : row.status === 'reviewing' ? 'In review' : row.status;
    return [row.jobTitle || 'General application', status, this.posted(row.at)].join(' · ');
  }

  wishTo(person: Wish): void {
    const list = (this.data?.celebrations.items || []).filter((row) => !row.mine).map((row) => ({
      key: row.id + row.kind + row.day,
      id: row.id,
      kind: row.kind,
      name: row.name,
      sub: [row.label, row.years ? row.years + ' years' : '', row.when].filter(Boolean).join(' · '),
      done: row.sent,
      mark: () => { row.sent = true; },
    }));
    this.openWishes(list, person.id + person.kind + person.day);
  }

  welcome(person: Joiner): void {
    const list = (this.data?.joiners || []).filter((row) => !row.mine).map((row) => ({
      key: row.id + 'welcome',
      id: row.id,
      kind: 'welcome',
      name: row.name,
      sub: [row.designation || row.department || 'New joiner', this.joinedLabel(row.joined)].join(' · '),
      done: row.wished,
      mark: () => { row.wished = true; },
    }));
    this.openWishes(list, person.id + 'welcome');
  }

  private openWishes(list: WishEntry[], key: string): void {
    this.wishList = list;
    this.drafts.clear();
    this.wishOpen = true;
    void this.pickWish(list.find((row) => row.key === key) || list[0]);
  }

  closeWishes(): void {
    this.wishOpen = false;
  }

  async pickWish(entry: WishEntry | undefined): Promise<void> {
    if (!entry) return;
    this.wishActive = entry;
    this.wishTab = 'write';
    this.draftError = '';
    const kept = this.drafts.get(entry.key);
    if (kept) { this.wishDraft = kept; return; }
    this.wishDraft = null;
    try {
      const loaded = await this.api.post<WishDraft>('/v1/wishes/draft', { employeeId: entry.id, kind: entry.kind });
      this.drafts.set(entry.key, loaded);
      if (this.wishActive?.key === entry.key) this.wishDraft = loaded;
    } catch (error) {
      if (this.wishActive?.key === entry.key) this.draftError = error instanceof Error ? error.message : 'Could not load the message.';
    }
  }

  async showPreview(): Promise<void> {
    const draft = this.wishDraft;
    const entry = this.wishActive;
    if (!draft || !entry) return;
    this.wishTab = 'preview';
    this.previewing = true;
    try {
      const result = await this.api.post<{ html: string }>('/v1/wishes/preview', this.wishPayload(entry, draft));
      this.wishHtml = this.sanitizer.bypassSecurityTrustHtml(result.html);
    } catch (error) {
      this.wishTab = 'write';
      this.toast.error(error instanceof Error ? error.message : 'Could not build the preview.');
    }
    this.previewing = false;
  }

  async sendWish(): Promise<void> {
    const draft = this.wishDraft;
    const entry = this.wishActive;
    if (!draft || !entry || entry.done) return;
    this.busy = entry.key;
    try {
      const result = await this.api.post<{ message: string; emailed: boolean }>('/v1/wishes', this.wishPayload(entry, draft));
      entry.done = true;
      entry.mark();
      this.toast.success(result.message, `Wish sent to ${draft.person.name}`);
      const next = this.wishList.find((row) => !row.done);
      if (next) void this.pickWish(next);
      else this.closeWishes();
    } catch (error) {
      this.toast.error(error instanceof Error ? error.message : 'Could not send the wish.');
    }
    this.busy = '';
  }

  private wishPayload(entry: WishEntry, draft: WishDraft) {
    return { employeeId: entry.id, kind: entry.kind, subject: draft.subject, heading: draft.heading, body: draft.body };
  }

  async find(): Promise<void> {
    this.searched = true;
    this.short = this.query.trim().length < 2;
    if (this.short) {
      this.colleagues = [];
      return;
    }
    try {
      const data = await this.api.get<{ people: Colleague[] }>('/v1/directory?q=' + encodeURIComponent(this.query.trim()));
      this.colleagues = data.people;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not search.';
    }
  }

  posted(iso: string): string {
    return when(iso);
  }
}
