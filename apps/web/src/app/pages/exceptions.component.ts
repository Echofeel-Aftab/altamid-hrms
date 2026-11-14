import { PhotoComponent } from '../shared/photo.component';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';

interface ExceptionRow {
  id: string;
  name: string;
  code: string;
  department: string;
  flags: string[];
  detail: string;
}

interface ExceptionView {
  day: string;
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  closed: string;
  counts: { late: number; absent: number; waiting: number; early: number; open: number };
  rows: ExceptionRow[];
}

@Component({
  selector: 'app-exceptions',
  imports: [FormsModule, RouterLink, PhotoComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-exclamation-circle"></i></span>
        <p class="eyebrow">Attendance</p>
        <h1>Exceptions</h1>
        <p class="lede">Late arrivals, early exits, and missed punches against the company shift. Approved leave, work from home, on duty, weekly offs, and holidays stay off this list.</p>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (view) {
      <div class="headcount">
        <article class="card"><strong>{{ view.counts.late }}</strong><span>Late</span></article>
        <article class="card"><strong>{{ view.counts.early }}</strong><span>Left early</span></article>
        <article class="card"><strong>{{ view.counts.absent }}</strong><span>No punch</span></article>
        <article class="card"><strong>{{ view.counts.open + view.counts.waiting }}</strong><span>Open or not in</span></article>
      </div>
      <section class="card">
        <form class="people-filters" (ngSubmit)="load()">
          <label class="sr" for="ex-day">Day</label>
          <input id="ex-day" type="date" name="day" [(ngModel)]="day" (ngModelChange)="load()">
          <label class="sr" for="ex-flag">Show</label>
          <select id="ex-flag" name="flag" [(ngModel)]="flag">
            <option value="">All exceptions</option>
            <option value="late">Late</option>
            <option value="early">Left early</option>
            <option value="absent">No punch</option>
            <option value="open">No punch out</option>
            <option value="waiting">Not in yet</option>
          </select>
        </form>
        <p class="muted">Shift {{ view.shiftStart }}–{{ view.shiftEnd }}. A punch is late after {{ view.graceMinutes }} minutes.</p>
        @if (view.closed) {
          <p class="muted">{{ view.closed }}. Nothing is expected.</p>
        } @else if (!shown.length) {
          <p class="muted">No exceptions for this day.</p>
        } @else {
          <ul class="plain">
            @for (row of shown; track row.id) {
              <li>
                <span class="li-person">
                  <app-photo size="sm" [personId]="row.id" [name]="row.name" />
                  <span>
                  <a [routerLink]="'/people/' + row.id"><strong>{{ row.name }}</strong></a>
                  <span class="muted">{{ row.code }}{{ row.department ? ' · ' + row.department : '' }} · {{ row.detail }}</span>
                  </span>
                </span>
                <span class="pill">{{ label(row.flags[0]) }}</span>
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class ExceptionsComponent implements OnInit {
  private readonly api = inject(ApiService);
  view: ExceptionView | null = null;
  day = '';
  flag = '';
  error = '';

  get shown(): ExceptionRow[] {
    const rows = this.view?.rows || [];
    return this.flag ? rows.filter((row) => row.flags.includes(this.flag)) : rows;
  }

  async ngOnInit(): Promise<void> {
    this.day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    await this.load();
  }

  label(flag: string): string {
    const names: Record<string, string> = { late: 'Late', early: 'Left early', absent: 'No punch', open: 'No punch out', waiting: 'Not in yet' };
    return names[flag] || flag;
  }

  async load(): Promise<void> {
    this.error = '';
    try {
      this.view = await this.api.get<ExceptionView>('/v1/attendance/exceptions?day=' + this.day);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load exceptions.';
    }
  }
}
