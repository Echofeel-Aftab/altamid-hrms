import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Org } from '../core/models';
import { SessionStore } from '../core/session.store';
import { OrgChartComponent } from '../shared/org-chart.component';

@Component({
  selector: 'app-organisation',
  imports: [FormsModule, OrgChartComponent],
  template: `
    <div class="page-head"><div><span class="page-mark" aria-hidden="true"><i class="bi bi-diagram-3"></i></span><p class="eyebrow">Structure</p><h1>Organisation</h1><p class="lede">The ladder runs from the owner down to the newest hire. A role decides the privilege. A department grant covers everyone in that department, including IT, admin, and maintenance. Teams sit inside a department. The chart shows the reporting line, up to 400 people at a time.</p></div></div>
    @if (org?.chartLimited) { <p class="banner">This company has more people than the chart can draw at once. Use People search, teams, and the ladder.</p> }
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (org?.counts) {
      <div class="headcount">
        <article class="card"><strong>{{ org?.counts?.active }}</strong><span>Active</span></article>
        <article class="card"><strong>{{ org?.counts?.onboarding }}</strong><span>Onboarding</span></article>
        <article class="card"><strong>{{ org?.counts?.exited }}</strong><span>Exited</span></article>
        <article class="card"><strong>{{ org?.counts?.departments?.length }}</strong><span>Departments</span></article>
      </div>
      <section class="card">
        <h2><i class="bi bi-diagram-2"></i> Reporting line</h2>
        <div class="split-stats">
          <div>
            <h3>By department</h3>
            <ul class="plain">
              @for (row of org?.counts?.departments || []; track row.name) {
                <li><span>{{ row.name }}</span><strong>{{ row.count }}</strong></li>
              }
            </ul>
          </div>
          <div>
            <h3>By location</h3>
            <ul class="plain">
              @for (row of org?.counts?.locations || []; track row.name) {
                <li><span>{{ row.name }}</span><strong>{{ row.count }}</strong></li>
              }
            </ul>
          </div>
        </div>
        <app-org-chart [people]="org?.chart || []" />
      </section>
    }
    <section class="card">
      <h2><i class="bi bi-ladder"></i> Ladder</h2>
      <p class="muted">Higher on the list sits higher in the company. Team scope can approve only their own reports. Company scope, once the permission is turned on in Access, covers the company. A new role starts with no extra permissions.</p>
      <ul class="plain">
        @for (role of org?.roles || []; track role.id) {
          <li><span>{{ role.name }}</span><strong>{{ role.scope === 'team' ? 'Own team' : 'Company' }}</strong></li>
        }
      </ul>
      @if (canEdit) {
        <form class="org-add" (ngSubmit)="addRole()">
          <input name="roleName" [(ngModel)]="roleName" placeholder="Role, such as VP" aria-label="Role name">
          <select name="roleScope" [(ngModel)]="roleScope" aria-label="Role scope">
            <option value="company">Company</option>
            <option value="team">Own team</option>
          </select>
          <button class="btn btn-secondary" type="submit">Add role</button>
        </form>
      }
    </section>
    <div class="org-grid">
      <section class="card">
        <h2><i class="bi bi-diagram-3"></i> Departments</h2>
        <ul class="plain">@for (item of org?.departments || []; track item.id) { <li>{{ item.name }}</li> }</ul>
        @if (canEdit) {
          <form class="org-add" (ngSubmit)="add('departments', department)">
            <label class="sr" for="department">Add a department</label>
            <input id="department" name="department" [(ngModel)]="department" placeholder="New department">
            <button class="btn btn-secondary" type="submit">Add</button>
          </form>
        }
      </section>
      <section class="card">
        <h2><i class="bi bi-person-badge"></i> Designations</h2>
        <ul class="plain">@for (item of org?.designations || []; track item.id) { <li>{{ item.name }}</li> }</ul>
        @if (canEdit) {
          <form class="org-add" (ngSubmit)="add('designations', designation)">
            <label class="sr" for="designation">Add a designation</label>
            <input id="designation" name="designation" [(ngModel)]="designation" placeholder="New designation">
            <button class="btn btn-secondary" type="submit">Add</button>
          </form>
        }
      </section>
      <section class="card">
        <h2><i class="bi bi-geo-alt"></i> Locations</h2>
        <ul class="plain">@for (item of org?.locations || []; track item.id) { <li>{{ item.name }} <span class="muted">{{ item.city }} {{ item.state }}</span></li> }</ul>
        @if (canEdit) {
          <form class="org-add" (ngSubmit)="addLocation()">
            <label class="sr" for="location">Add a location</label>
            <input id="location" name="location" [(ngModel)]="location" placeholder="Name">
            <input name="city" [(ngModel)]="city" placeholder="City" aria-label="City">
            <button class="btn btn-secondary" type="submit">Add</button>
          </form>
        }
      </section>
      <section class="card">
        <h2><i class="bi bi-bar-chart-steps"></i> Grades</h2>
        <p class="muted">A grade is the band, from the junior grades up. Access for a grade is set on that person’s Access panel and applies to everyone on the grade.</p>
        <ul class="plain">@for (item of org?.levels || []; track item.id) { <li><span>{{ item.name }}</span><strong>{{ item.rank }}</strong></li> }</ul>
        @if (!org?.levels?.length) { <p class="muted">No grades yet.</p> }
        @if (canEdit) {
          <form class="org-add" (ngSubmit)="addLevel()">
            <input name="levelName" [(ngModel)]="levelName" placeholder="Grade name" aria-label="Grade name">
            <input name="levelRank" [(ngModel)]="levelRank" inputmode="numeric" placeholder="Rank" aria-label="Rank">
            <button class="btn btn-secondary" type="submit">Add grade</button>
          </form>
        }
      </section>
      <section class="card">
        <h2><i class="bi bi-people"></i> Teams</h2>
        <p class="muted">A department can hold many teams, each with a team lead. Everyone sees their team lead on Reporting line. Privileges stay on the role, the department, and the grade, not on each team.</p>
        <ul class="plain team-list">@for (item of org?.teams || []; track item.id) {
          <li>
            <span><strong>{{ item.name }}</strong><small class="muted">{{ deptName(item.departmentId) }}{{ item.members !== undefined ? ' · ' + item.members + (item.members === 1 ? ' person' : ' people') : '' }}</small></span>
            @if (canEdit) {
              <select [name]="'lead-' + item.id" [ngModel]="item.leadId || ''" (ngModelChange)="setLead(item.id, $event)" aria-label="Team lead">
                <option value="">No team lead</option>
                @for (person of leadChoices(); track person.id) { <option [value]="person.id">{{ person.name }} · {{ person.code }}</option> }
              </select>
            } @else {
              <em class="muted">{{ leadName(item.leadId) || 'No team lead' }}</em>
            }
          </li>
        }</ul>
        @if (!org?.teams?.length) { <p class="muted">No teams yet.</p> }
        @if (canEdit) {
          <form class="org-add" (ngSubmit)="addTeam()">
            <input name="teamName" [(ngModel)]="teamName" placeholder="Team name" aria-label="Team name">
            <select name="teamDept" [(ngModel)]="teamDept" aria-label="Team department">
              <option value="">Department</option>
              @for (item of org?.departments || []; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
            </select>
            <button class="btn btn-secondary" type="submit">Add team</button>
          </form>
        }
      </section>
    </div>
  `,
})
export class OrganisationComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  org: Org | null = null;
  department = '';
  designation = '';
  location = '';
  city = '';
  roleName = '';
  roleScope = 'company';
  levelName = '';
  levelRank = '10';
  teamName = '';
  teamDept = '';
  error = '';

  get canEdit(): boolean {
    return !!this.store.me?.access?.includes('people.edit');
  }

  async ngOnInit(): Promise<void> {
    this.city = this.store.me?.company.city || '';
    await this.load();
  }

  async add(kind: 'departments' | 'designations', name: string): Promise<void> {
    this.error = '';
    try {
      await this.api.post('/v1/' + kind, { name });
      if (kind === 'departments') this.department = '';
      else this.designation = '';
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not add that.';
    }
  }

  async addRole(): Promise<void> {
    this.error = '';
    try {
      await this.api.post('/v1/org/roles', { name: this.roleName, scope: this.roleScope });
      this.roleName = '';
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not add that role.';
    }
  }

  async addLevel(): Promise<void> {
    this.error = '';
    try {
      await this.api.post('/v1/org/levels', { name: this.levelName, rank: Number(this.levelRank) });
      this.levelName = '';
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not add that grade.';
    }
  }

  deptName(id: string): string {
    return this.org?.departments.find((item) => item.id === id)?.name || 'No department';
  }

  leadName(id?: string): string {
    return id ? this.org?.chart.find((item) => item.id === id)?.name || '' : '';
  }

  leadChoices() {
    return (this.org?.chart || []).filter((item) => item.status !== 'exited');
  }

  async setLead(id: string, leadId: string): Promise<void> {
    this.error = '';
    try {
      await this.api.post('/v1/org/teams/' + id + '/lead', { leadId });
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not set that team lead.';
      await this.load();
    }
  }

  async addTeam(): Promise<void> {
    this.error = '';
    try {
      await this.api.post('/v1/org/teams', { name: this.teamName, departmentId: this.teamDept });
      this.teamName = '';
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not add that team.';
    }
  }

  async addLocation(): Promise<void> {
    this.error = '';
    try {
      await this.api.post('/v1/locations', { name: this.location, city: this.city, state: this.store.me?.company.state || '' });
      this.location = '';
      this.city = '';
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not add that location.';
    }
  }

  private async load(): Promise<void> {
    try {
      this.org = await this.api.get<Org>('/v1/org');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load organisation.';
    }
  }
}
