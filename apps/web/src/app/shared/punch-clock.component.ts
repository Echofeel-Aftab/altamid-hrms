import { Component, EventEmitter, inject, Input, OnDestroy, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { I18n } from '../core/i18n';
import { PunchState } from '../core/models';

const IST = 'Asia/Kolkata';

@Component({
  selector: 'app-punch-clock',
  imports: [FormsModule, RouterLink],
  template: `
    <section class="clock-card" [class.is-in]="state.state === 'in'" [class.is-done]="state.state === 'out' && !!state.firstIn" [attr.aria-label]="i18n.t('Check in')">
      <div class="clock-top">
        <div class="clock-when">
          <small>{{ dayLabel }}</small>
          <span class="clock-status"><i class="clock-dot"></i>{{ status }}</span>
        </div>
        @if (late) { <span class="chip is-warn"><i class="bi bi-alarm"></i> {{ i18n.t('Late by') }} {{ late }}</span> }
        @else if (state.firstIn) { <span class="chip is-ok"><i class="bi bi-check2"></i> {{ i18n.t('On time') }}</span> }
      </div>

      <div class="clock-body">
        <div class="clock-digits" role="timer" [attr.aria-label]="'Worked ' + hh + ' hours ' + mm + ' minutes'">
          <span>{{ hh }}</span><b>:</b><span>{{ mm }}</span><b>:</b><span>{{ ss }}</span>
        </div>
        <div class="clock-action">
          <button type="button" class="clock-btn" [class.is-out]="state.next === 'out'" [disabled]="busy" (click)="punch()">
            <i [class]="busy ? 'bi bi-arrow-repeat clock-spin' : state.next === 'in' ? 'bi bi-box-arrow-in-right' : 'bi bi-box-arrow-right'"></i>
            {{ busy ? (locating ? i18n.t('Finding you…') : i18n.t('Saving…')) : state.next === 'in' ? i18n.t('Check in') : i18n.t('Check out') }}
          </button>
          @if (!compact) {
            <button type="button" class="clock-note-link" (click)="noting = !noting">{{ noting ? i18n.t('Hide note') : i18n.t('Add a note') }}</button>
          }
        </div>
      </div>

      <div class="clock-meter" aria-hidden="true"><i [style.width.%]="share"></i></div>
      <div class="clock-meta">
        <span><i class="bi bi-clock"></i> {{ i18n.t('Shift') }} {{ state.shiftStart }}–{{ state.shiftEnd }}</span>
        <span [class.is-strict]="state.rule.needsLocation"><i [class]="state.rule.needsLocation ? 'bi bi-geo-alt-fill' : 'bi bi-globe2'"></i> {{ state.rule.label === 'Anywhere' ? i18n.t('Anywhere') : state.rule.label }}</span>
        @if (state.firstIn) { <span><i class="bi bi-hourglass-split"></i> {{ remaining }}</span> }
      </div>

      @if (noting && !compact) {
        <div class="clock-note">
          <label for="punch-note" class="sr">{{ i18n.t('Note') }}</label>
          <input id="punch-note" name="note" [(ngModel)]="note" maxlength="200" placeholder="Client visit, working from home…">
        </div>
      }
      @if (state.missedOut) { <p class="clock-alert"><i class="bi bi-exclamation-triangle"></i> Yesterday's check-out was missed. Regularize it from Attendance.</p> }
      @if (error) { <p class="clock-alert is-bad" role="alert"><i class="bi bi-x-octagon"></i> {{ error }}</p> }

      @if (!compact && state.punches.length) {
        <ol class="clock-log" aria-label="Today's check-ins">
          @for (item of state.punches; track item.id) {
            <li [class.is-out]="item.kind === 'out'">
              <span class="clock-log-dot"></span>
              <strong>{{ item.kind === 'in' ? i18n.t('Checked in') : i18n.t('Checked out') }}</strong>
              <time>{{ time(item.punchedAt) }}</time>
              @if (item.zone || item.place) { <span class="source-chip"><i class="bi bi-geo-alt"></i> {{ item.zone === 'Remote' && item.place ? item.place : item.zone || item.place }}</span> }
              @if (item.note) { <small>{{ item.note }}</small> }
            </li>
          }
        </ol>
      }
      @if (compact) {
        <a class="clock-more" routerLink="/attendance">{{ i18n.t('Timeline and requests') }} <i class="bi bi-arrow-right"></i></a>
      }
    </section>
  `,
})
export class PunchClockComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly i18n = inject(I18n);
  @Input({ required: true }) state!: PunchState;
  @Input() compact = false;
  @Output() changed = new EventEmitter<PunchState>();
  now = Date.now();
  busy = false;
  locating = false;
  noting = false;
  note = '';
  error = '';
  private timer = 0;

  ngOnInit(): void {
    this.timer = window.setInterval(() => (this.now = Date.now()), 1000);
  }

  ngOnDestroy(): void {
    window.clearInterval(this.timer);
  }

  get seconds(): number {
    const open = this.state.sessionStart ? Math.max(0, Math.floor((this.now - new Date(this.state.sessionStart).getTime()) / 1000)) : 0;
    return (this.state.workedSeconds || 0) + open;
  }

  get hh(): string { return String(Math.floor(this.seconds / 3600)).padStart(2, '0'); }
  get mm(): string { return String(Math.floor((this.seconds % 3600) / 60)).padStart(2, '0'); }
  get ss(): string { return String(this.seconds % 60).padStart(2, '0'); }

  get shiftSeconds(): number {
    const [sh, sm] = this.state.shiftStart.split(':').map(Number);
    const [eh, em] = this.state.shiftEnd.split(':').map(Number);
    const span = (eh * 60 + em - (sh * 60 + sm)) * 60;
    return span > 0 ? span : 9 * 3600;
  }

  get share(): number {
    return Math.min(100, (this.seconds / this.shiftSeconds) * 100);
  }

  get remaining(): string {
    const left = this.shiftSeconds - this.seconds;
    if (left <= 0) return this.i18n.t('Shift hours complete');
    return `${Math.floor(left / 3600)}h ${String(Math.floor((left % 3600) / 60)).padStart(2, '0')}m ${this.i18n.t('to go')}`;
  }

  get status(): string {
    if (this.state.state === 'in') return this.i18n.t('Checked in at') + ' ' + this.time(this.state.sessionStart || this.state.firstIn);
    if (this.state.lastOut) return this.i18n.t('Checked out at') + ' ' + this.time(this.state.lastOut);
    return this.i18n.t('Yet to check in');
  }

  get late(): string {
    if (!this.state.firstIn) return '';
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: IST, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(this.state.firstIn)).split(':').map(Number);
    const [sh, sm] = this.state.shiftStart.split(':').map(Number);
    const over = parts[0] * 60 + parts[1] - (sh * 60 + sm);
    if (over <= (this.state.graceMinutes || 0)) return '';
    return over >= 60 ? `${Math.floor(over / 60)}h ${over % 60}m` : `${over} min`;
  }

  get dayLabel(): string {
    this.i18n.code();
    return new Intl.DateTimeFormat(this.i18n.locale(), { timeZone: IST, weekday: 'long', day: 'numeric', month: 'short' }).format(new Date(this.now));
  }

  time(iso: string): string {
    if (!iso) return '';
    this.i18n.code();
    return new Intl.DateTimeFormat(this.i18n.locale(), { timeZone: IST, hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso));
  }

  async punch(): Promise<void> {
    this.busy = true;
    this.error = '';
    const body: Record<string, unknown> = { note: this.note };
    try {
      if (this.state.rule.record) {
        this.locating = true;
        try {
          const spot = await this.locate();
          body['lat'] = spot.coords.latitude;
          body['lng'] = spot.coords.longitude;
          body['accuracy'] = Math.round(spot.coords.accuracy);
        } catch (problem) {
          if (this.state.rule.needsLocation && this.state.next === 'in') {
            this.error = this.locationError(problem);
            return;
          }
        } finally {
          this.locating = false;
        }
      }
      const next = await this.api.post<PunchState>('/v1/attendance/punch', body);
      this.state = next;
      this.note = '';
      this.noting = false;
      this.changed.emit(next);
    } catch (problem) {
      this.error = problem instanceof Error ? problem.message : 'Check-in failed.';
    } finally {
      this.busy = false;
      this.locating = false;
    }
  }

  private locate(): Promise<GeolocationPosition> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        reject({ code: 0 });
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }

  private locationError(problem: unknown): string {
    const code = (problem as { code?: number })?.code;
    if (code === 1) return `Location is blocked for this site. Allow location in the browser, then check in again. Check-in rule: ${this.state.rule.label}.`;
    if (code === 3) return 'Finding your location took too long. Move near a window or turn on GPS, then try again.';
    if (code === 0) return 'This browser cannot share location. Use a phone or a browser with location.';
    return 'Your location could not be found. Turn on location services and try again.';
  }
}
