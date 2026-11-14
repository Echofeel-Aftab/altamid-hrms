import { PhotoComponent } from '../shared/photo.component';
import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { ChartPerson } from '../core/models';
import { OrgChartComponent } from '../shared/org-chart.component';

interface TeamPerson extends ChartPerson {
  state: string;
}

interface TeamView {
  people: TeamPerson[];
  waiting: Array<{ id: string; name: string; detail: string; kind: string }>;
  counts: { people: number; in: number; out: number; waiting: number };
}

@Component({
  selector: 'app-team',
  imports: [RouterLink, OrgChartComponent, PhotoComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-diagram-2"></i></span>
        <p class="eyebrow">My team</p>
        <h1>Reporting line</h1>
        <p class="lede">Everyone under you, including the teams of your team leads. You approve only the people who report to you directly.</p>
      </div>
      <a class="btn btn-primary" routerLink="/approvals">Approvals</a>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (view) {
      <div class="headcount">
        <article class="card"><strong>{{ view.counts.people }}</strong><span>People</span></article>
        <article class="card"><strong>{{ view.counts.in }}</strong><span>In today</span></article>
        <article class="card"><strong>{{ view.counts.out }}</strong><span>Out today</span></article>
        <article class="card"><strong>{{ view.counts.waiting }}</strong><span>Waiting on you</span></article>
      </div>
      @if (view.waiting.length) {
        <section class="card">
          <h2><i class="bi bi-hourglass-split"></i> Waiting on you</h2>
          <ul class="plain">
            @for (item of view.waiting; track item.id) {
              <li><span class="li-person"><app-photo size="xs" [name]="item.name" /><span><strong>{{ item.name }}</strong> <span class="muted">{{ item.kind }} · {{ item.detail }}</span></span></span></li>
            }
          </ul>
          <div class="actions"><a class="btn btn-primary" routerLink="/approvals">Open approvals</a></div>
        </section>
      }
      <section class="card">
        <h2><i class="bi bi-diagram-3"></i> The line under you</h2>
        <app-org-chart [people]="view.people" />
      </section>
      <section class="card">
        <h2><i class="bi bi-calendar-check"></i> Today</h2>
        <ul class="plain">
          @for (person of today; track person.id) {
            <li>
              <span class="li-person"><app-photo size="xs" [personId]="person.id" [name]="person.name" /><span><strong>{{ person.name }}</strong> <span class="muted">{{ person.designation || person.code }}</span></span></span>
              <strong class="team-state">{{ person.state === 'in' ? 'In' : person.state === 'exited' ? 'Exited' : 'Out' }}</strong>
            </li>
          }
        </ul>
      </section>
    }
  `,
})
export class TeamComponent implements OnInit {
  private readonly api = inject(ApiService);
  view: TeamView | null = null;
  error = '';

  get today(): TeamPerson[] {
    return [...(this.view?.people || [])].sort((a, b) => a.name.localeCompare(b.name));
  }

  async ngOnInit(): Promise<void> {
    try {
      this.view = await this.api.get<TeamView>('/v1/team');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load your team.';
    }
  }
}
