import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';

interface OpeningRow { id: string; code: string; title: string; department: string; location: string; internal: boolean; referral: boolean }
interface MineRow { id: string; title: string; code: string; name: string; source: string; status: string }

@Component({
  selector: 'app-jobs',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-briefcase"></i></span>
        <p class="eyebrow">My day</p>
        <h1>Jobs</h1>
        <p class="lede">Roles your company has opened to people who already work here, and roles you can refer someone for.</p>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    @if (!visible) {
      <section class="card"><h2><i class="bi bi-briefcase"></i> Jobs</h2><p class="muted">Jobs inside the company are turned off for your role.</p></section>
    } @else if (!openings.length) {
      <section class="card"><h2><i class="bi bi-briefcase"></i> Nothing open inside the company</h2><p class="muted">When HR marks a job for employees or referrals, it shows here.</p></section>
    }
    @if (visible) {
    @for (job of openings; track job.id) {
      <section class="card">
        <h2>{{ job.title }}</h2>
        <p class="muted">{{ job.code }}@if (job.department) { · {{ job.department }} }@if (job.location) { · {{ job.location }} }</p>
        <div class="actions">
          @if (job.internal) { <button type="button" class="btn btn-primary" [disabled]="busy" (click)="apply(job)">Apply</button> }
          @if (job.referral) { <button type="button" class="btn btn-ghost" (click)="referFor = referFor === job.id ? '' : job.id">Refer someone</button> }
        </div>
        @if (referFor === job.id) {
          <form class="day-form" (ngSubmit)="refer(job)">
            <label [for]="'name-' + job.id">Candidate name</label>
            <input [id]="'name-' + job.id" name="name" [(ngModel)]="name" required>
            <label [for]="'email-' + job.id">Email</label>
            <input [id]="'email-' + job.id" name="email" type="email" [(ngModel)]="email" required>
            <label [for]="'note-' + job.id">Why they fit</label>
            <textarea [id]="'note-' + job.id" name="note" rows="3" [(ngModel)]="note"></textarea>
            <div class="actions"><button class="btn btn-primary" type="submit" [disabled]="busy">Send referral</button></div>
          </form>
        }
      </section>
    }
    }
    @if (visible && mine.length) {
      <section class="card">
        <h2><i class="bi bi-person-check"></i> Yours</h2>
        <ul class="plain">
          @for (item of mine; track item.id) {
            <li><strong>{{ item.title }}</strong> · {{ item.source === 'referral' ? item.name : 'Your application' }} · {{ item.status }}</li>
          }
        </ul>
      </section>
    }
  `,
})
export class JobsComponent implements OnInit {
  private readonly api = inject(ApiService);
  openings: OpeningRow[] = [];
  visible = true;
  mine: MineRow[] = [];
  referFor = '';
  name = '';
  email = '';
  note = '';
  error = '';
  ok = '';
  busy = false;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async apply(job: OpeningRow): Promise<void> {
    await this.run('Application sent to HR.', () => this.api.post('/v1/hiring/internal/' + job.id + '/apply', {}));
  }

  async refer(job: OpeningRow): Promise<void> {
    await this.run('Referral sent to HR.', async () => {
      await this.api.post('/v1/hiring/internal/' + job.id + '/refer', { name: this.name, email: this.email, note: this.note });
      this.name = '';
      this.email = '';
      this.note = '';
      this.referFor = '';
    });
  }

  private async load(): Promise<void> {
    try {
      const data = await this.api.get<{ openings: OpeningRow[]; mine: MineRow[]; visible?: boolean }>('/v1/hiring/internal');
      this.visible = data.visible !== false;
      this.openings = data.openings;
      this.mine = data.mine;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load jobs.';
    }
  }

  private async run(message: string, work: () => Promise<unknown>): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      await work();
      this.ok = message;
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not send that.';
    } finally {
      this.busy = false;
    }
  }
}
