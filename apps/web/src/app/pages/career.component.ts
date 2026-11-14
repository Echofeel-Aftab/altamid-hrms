import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RichViewComponent } from '../shared/rich-editor.component';
import { ActivatedRoute } from '@angular/router';
import { ApiService } from '../core/api.service';
import { applyTheme, isDarkTheme } from '../core/theme';

interface CareerJob {
  company: string;
  code: string;
  title: string;
  department: string;
  location: string;
  workplace: string;
  employment: string;
  seats: number;
  description: string;
  requirements: string;
  salaryNote: string;
  closed: boolean;
}

@Component({
  selector: 'app-career',
  imports: [FormsModule, RichViewComponent],
  template: `
    <main class="apply-page">
      <section class="apply-card">
        @if (missing) {
          <h1>This job is not available</h1>
          <p>It is not open, or the address is wrong.</p>
        } @else if (thanks) {
          <p class="eyebrow">Application received</p>
          <h1>{{ thanks }}</h1>
        } @else if (job) {
          <p class="eyebrow">{{ job.company }}</p>
          <h1>{{ job.title }}</h1>
          <p class="muted">{{ job.code }} · {{ job.employment }} · {{ job.workplace }}@if (job.location) { · {{ job.location }} }@if (job.department) { · {{ job.department }} }</p>
          @if (job.closed) {
            <p>This job is closed. HR is not taking new applications.</p>
          } @else {
            @if (job.description) { <app-rich-view class="career-copy" [value]="job.description" /> }
            @if (job.requirements) { <h2><i class="bi bi-search"></i> What we are looking for</h2><app-rich-view class="career-copy" [value]="job.requirements" /> }
            @if (job.salaryNote) { <p>{{ job.salaryNote }}</p> }
            @if (error) { <p class="form-error">{{ error }}</p> }
            <form (ngSubmit)="submit()">
              <label for="career-name">Full name *</label>
              <input id="career-name" name="name" [(ngModel)]="name" required>
              <label for="career-email">Email *</label>
              <input id="career-email" name="email" type="email" [(ngModel)]="email" required>
              <label for="career-phone">Phone</label>
              <input id="career-phone" name="phone" [(ngModel)]="phone">
              <label for="career-city">City</label>
              <input id="career-city" name="city" [(ngModel)]="city">
              <label for="career-resume">Resume link</label>
              <input id="career-resume" name="resume" [(ngModel)]="resume" placeholder="https://">
              <label for="career-note">Note</label>
              <textarea id="career-note" name="note" rows="4" [(ngModel)]="note"></textarea>
              <button class="btn btn-gold" type="submit" [disabled]="busy">{{ busy ? 'Sending…' : 'Submit application' }}</button>
            </form>
          }
        }
      </section>
    </main>
  `,
})
export class CareerComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  job: CareerJob | null = null;
  name = '';
  email = '';
  phone = '';
  city = '';
  resume = '';
  note = '';
  thanks = '';
  error = '';
  missing = false;
  busy = false;

  async ngOnInit(): Promise<void> {
    applyTheme(isDarkTheme());
    const company = this.route.snapshot.paramMap.get('company') || '';
    const code = this.route.snapshot.paramMap.get('code') || '';
    try {
      this.job = await this.api.get<CareerJob>('/v1/careers/' + encodeURIComponent(company) + '/' + encodeURIComponent(code));
      document.title = this.job.title + ' · ' + this.job.company;
    } catch {
      this.missing = true;
      document.title = 'Job application';
    }
  }

  async submit(): Promise<void> {
    if (!this.job) return;
    this.busy = true;
    this.error = '';
    const company = this.route.snapshot.paramMap.get('company') || '';
    const code = this.route.snapshot.paramMap.get('code') || '';
    const from = this.route.snapshot.queryParamMap.get('from') || 'website';
    try {
      const result = await this.api.post<{ thanks: string }>('/v1/careers/' + encodeURIComponent(company) + '/' + encodeURIComponent(code) + '?from=' + encodeURIComponent(from), {
        name: this.name,
        email: this.email,
        phone: this.phone,
        city: this.city,
        resume: this.resume,
        note: this.note,
      });
      this.thanks = result.thanks;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not send the application.';
    } finally {
      this.busy = false;
    }
  }
}
