import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { dayLabel, errorText } from '../shared/kit';
import { ModalComponent } from '../shared/modal.component';
import { Sweet } from '../shared/sweet';
import { Toast } from '../shared/toast';

interface Cycle { id: string; name: string; startDay: string; endDay: string; phase: 'goals' | 'review' | 'closed'; scale: number; selfReview: boolean; live: boolean }
interface Goal { id: string; title: string; detail: string; weight: number; target: string; progress: number; selfRating: number; selfNote: string; managerRating: number; managerNote: string }
interface Sheet {
  person: { id: string; name: string; code: string; designation: string; manager: string };
  role: 'self' | 'manager' | 'hr';
  goals: Goal[];
  weight: number;
  review: { selfSummary: string; selfRating: number; selfDone: boolean; managerSummary: string; managerRating: number; managerDone: boolean; finalRating: number; finalNote: string; selfScore: number; managerScore: number };
  can: { goals: boolean; progress: boolean; self: boolean; manager: boolean; final: boolean };
}
interface Status { id: string; name: string; code: string; designation: string; goals: number; weight: number; progress: number; selfDone: boolean; managerDone: boolean; rating: number; score: number }
interface View { canRun: boolean; cycles: Cycle[]; cycle: Cycle | null; sheet: Sheet | null; team: Status[]; everyone: Status[] }

const PHASES = [
  { key: 'goals', label: 'Goal setting', icon: 'bi-bullseye' },
  { key: 'review', label: 'Review', icon: 'bi-clipboard2-check' },
  { key: 'closed', label: 'Closed', icon: 'bi-lock' },
] as const;

@Component({
  selector: 'app-performance',
  imports: [FormsModule, ModalComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-graph-up-arrow"></i></span>
        <p class="eyebrow">Talent</p>
        <h1>Performance</h1>
        <p class="lede">Set weighted goals, track progress through the year, then rate yourself and talk it through with your manager.</p>
      </div>
      @if (view?.canRun) { <button type="button" class="btn btn-gold" (click)="editCycle(null)"><i class="bi bi-plus-lg"></i> New review cycle</button> }
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }

    @if (view && !view.cycle) {
      <section class="card empty-state">
        <i class="bi bi-graph-up-arrow"></i>
        <h2>No review cycle yet</h2>
        <p class="muted">{{ view.canRun ? 'Start a cycle, for example “FY 2026-27 annual review”, to open goal setting for everyone.' : 'HR has not started a review cycle yet. You will get a notification when goal setting opens.' }}</p>
      </section>
    }

    @if (view?.cycle; as cycle) {
      <section class="card mx-cycle">
        <div class="mx-cycle-main">
          <label for="pms-cycle" class="sr-only">Review cycle</label>
          <select id="pms-cycle" [ngModel]="cycle.id" (ngModelChange)="pickCycle($event)">
            @for (item of view!.cycles; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
          </select>
          <span class="muted">{{ day(cycle.startDay) }} to {{ day(cycle.endDay) }} · rated 1 to {{ cycle.scale }}</span>
        </div>
        <ol class="mx-phases">
          @for (phase of phases; track phase.key) {
            <li [class.is-now]="cycle.phase === phase.key" [class.is-done]="phaseIndex(cycle.phase) > $index">
              @if (view!.canRun) {
                <button type="button" (click)="setPhase(phase.key)" [disabled]="busy || cycle.phase === phase.key"><i class="bi" [class]="phase.icon"></i> {{ phase.label }}</button>
              } @else {
                <span><i class="bi" [class]="phase.icon"></i> {{ phase.label }}</span>
              }
            </li>
          }
        </ol>
        @if (view!.canRun && cycle.phase !== 'closed') { <button type="button" class="btn btn-ghost btn-sm" (click)="editCycle(cycle)"><i class="bi bi-pencil"></i> Edit</button> }
      </section>

      <div class="seg-mini mx-tabs" role="tablist">
        <button type="button" role="tab" [class.is-active]="tab === 'mine'" (click)="openPerson('')"><i class="bi bi-person"></i> My goals</button>
        @if (view!.team.length) { <button type="button" role="tab" [class.is-active]="tab === 'team'" (click)="tab = 'team'"><i class="bi bi-people"></i> My team · {{ view!.team.length }}</button> }
        @if (view!.canRun) { <button type="button" role="tab" [class.is-active]="tab === 'everyone'" (click)="tab = 'everyone'"><i class="bi bi-buildings"></i> Everyone</button> }
        @if (tab === 'person' && sheet) { <button type="button" role="tab" class="is-active"><i class="bi bi-person-badge"></i> {{ sheet.person.name }}</button> }
      </div>

      @if (tab === 'team' || tab === 'everyone') {
        <section class="card">
          @if (tab === 'everyone') {
            <div class="mx-inline mx-row-end"><input [(ngModel)]="find" placeholder="Find a person" aria-label="Find a person"></div>
          }
          <div class="table-responsive">
            <table>
              <thead><tr><th>Person</th><th>Goals</th><th>Weight</th><th>Progress</th><th>Self review</th><th>Manager review</th><th>Rating</th><th></th></tr></thead>
              <tbody>
                @for (row of statusRows(); track row.id) {
                  <tr>
                    <td><strong>{{ row.name }}</strong><br><small>{{ row.code }}@if (row.designation) { · {{ row.designation }} }</small></td>
                    <td>{{ row.goals }}</td>
                    <td><span class="chip" [class]="'chip ' + (row.weight === 100 ? 'is-ok' : row.goals ? 'is-warn' : '')">{{ row.weight }}%</span></td>
                    <td><div class="progress mx-progress"><span [style.width.%]="row.progress"></span></div><small>{{ row.progress }}%</small></td>
                    <td>@if (row.selfDone) { <i class="bi bi-check-circle-fill mx-ok"></i> } @else { — }</td>
                    <td>@if (row.managerDone) { <i class="bi bi-check-circle-fill mx-ok"></i> } @else { — }</td>
                    <td>{{ row.rating ? row.rating + ' / ' + cycle.scale : '—' }}</td>
                    <td><button type="button" class="btn btn-ghost btn-sm" (click)="openPerson(row.id)">Open</button></td>
                  </tr>
                } @empty { <tr><td colspan="8" class="muted">Nobody here.</td></tr> }
              </tbody>
            </table>
          </div>
        </section>
      }

      @if ((tab === 'mine' || tab === 'person') && sheet; as s) {
        <div class="page-split">
          <div>
            <section class="card">
              <div class="card-head">
                <h2><i class="bi bi-bullseye"></i> {{ s.role === 'self' ? 'My goals' : s.person.name + '’s goals' }}</h2>
                <span class="chip" [class]="'chip ' + (s.weight === 100 ? 'is-ok' : 'is-warn')">Weight {{ s.weight }} of 100</span>
              </div>
              @if (s.weight !== 100 && s.can.goals) { <p class="mx-note"><i class="bi bi-info-circle"></i> Goal weights should add up to 100 so the final score is fair.</p> }
              <div class="mx-goals">
                @for (goal of s.goals; track goal.id) {
                  <article class="mx-goal">
                    <div class="mx-goal-head">
                      <div><strong>{{ goal.title }}</strong>@if (goal.target) { <small><i class="bi bi-flag"></i> {{ goal.target }}</small> }</div>
                      <span class="mx-weight">{{ goal.weight }}%</span>
                    </div>
                    @if (goal.detail) { <p class="muted">{{ goal.detail }}</p> }
                    <div class="mx-goal-progress">
                      @if (s.can.progress) {
                        <input type="range" min="0" max="100" step="5" [(ngModel)]="goal.progress" (change)="saveProgress(goal)" [attr.aria-label]="'Progress on ' + goal.title">
                      } @else {
                        <div class="progress mx-progress"><span [style.width.%]="goal.progress"></span></div>
                      }
                      <b>{{ goal.progress }}%</b>
                    </div>
                    @if (goal.selfRating || goal.managerRating) {
                      <div class="chip-row">
                        @if (goal.selfRating) { <span class="chip is-info">Self {{ goal.selfRating }}/{{ cycle.scale }}</span> }
                        @if (goal.managerRating) { <span class="chip is-ok">Manager {{ goal.managerRating }}/{{ cycle.scale }}</span> }
                      </div>
                    }
                    @if (s.can.goals) {
                      <div class="actions mx-goal-actions">
                        <button type="button" class="btn btn-ghost btn-sm" (click)="editGoal(goal)"><i class="bi bi-pencil"></i> Edit</button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="removeGoal(goal)"><i class="bi bi-trash"></i> Remove</button>
                      </div>
                    }
                  </article>
                } @empty {
                  <p class="muted">No goals yet.@if (s.can.goals) { Add three to six goals that matter most this year. }</p>
                }
              </div>
              @if (s.can.goals && s.goals.length < 12) {
                <div class="actions mx-row-gap"><button type="button" class="btn btn-primary" (click)="editGoal(null)"><i class="bi bi-plus-lg"></i> Add a goal</button></div>
              }
            </section>

            @if (s.can.self || s.can.manager) {
              <section class="card">
                <h2><i class="bi bi-clipboard2-check"></i> {{ s.can.self ? 'My self review' : 'Manager review for ' + s.person.name }}</h2>
                @if (s.can.manager && s.review.selfDone) { <p class="mx-note"><i class="bi bi-person-check"></i> {{ s.person.name.split(' ')[0] }} rated their year {{ s.review.selfRating }}/{{ cycle.scale }}: “{{ s.review.selfSummary }}”</p> }
                @for (goal of s.goals; track goal.id) {
                  <div class="mx-rate">
                    <div><strong>{{ goal.title }}</strong><small>{{ goal.weight }}% · {{ goal.progress }}% done@if (s.can.manager && goal.selfRating) { · self {{ goal.selfRating }} }</small></div>
                    <div class="mx-stars" role="radiogroup" [attr.aria-label]="'Rating for ' + goal.title">
                      @for (n of scale(); track n) {
                        <button type="button" role="radio" [attr.aria-checked]="rate[goal.id].rating === n" [class.is-on]="rate[goal.id].rating >= n" (click)="rate[goal.id].rating = n" [title]="n + ' of ' + cycle.scale"><i class="bi bi-star-fill"></i></button>
                      }
                    </div>
                    <input [(ngModel)]="rate[goal.id].note" maxlength="1000" placeholder="What happened on this goal?" [attr.aria-label]="'Note for ' + goal.title">
                  </div>
                }
                <label>Overall rating</label>
                <div class="mx-stars is-big" role="radiogroup" aria-label="Overall rating">
                  @for (n of scale(); track n) { <button type="button" role="radio" [attr.aria-checked]="overall === n" [class.is-on]="overall >= n" (click)="overall = n"><i class="bi bi-star-fill"></i></button> }
                  <span class="muted">{{ overall ? overall + ' of ' + cycle.scale : 'Not rated' }}</span>
                </div>
                <label for="pms-summary">{{ s.can.self ? 'Summary of my year' : 'Summary for ' + s.person.name.split(' ')[0] }}</label>
                <textarea id="pms-summary" rows="4" maxlength="3000" [(ngModel)]="summary"></textarea>
                <div class="actions mx-row-gap">
                  <button type="button" class="btn btn-ghost" (click)="sendReview(false)" [disabled]="busy"><i class="bi bi-save"></i> Save draft</button>
                  <button type="button" class="btn btn-gold" (click)="sendReview(true)" [disabled]="busy"><i class="bi bi-send"></i> Send review</button>
                </div>
              </section>
            }
          </div>

          <div class="dash-side">
            <section class="card">
              <h2><i class="bi bi-person-badge"></i> {{ s.person.name }}</h2>
              <p class="muted">{{ s.person.code }}@if (s.person.designation) { · {{ s.person.designation }} }@if (s.person.manager) { <br>Reports to {{ s.person.manager }} }</p>
              <div class="mx-scores">
                <div><small>Self score</small><strong>{{ s.review.selfScore || '—' }}</strong></div>
                <div><small>Manager score</small><strong>{{ s.review.managerScore || '—' }}</strong></div>
                <div class="is-final"><small>Final rating</small><strong>{{ s.review.finalRating ? s.review.finalRating + ' / ' + cycle.scale : '—' }}</strong></div>
              </div>
              <ul class="mx-checks">
                <li [class.is-done]="s.goals.length > 0 && s.weight === 100"><i class="bi" [class]="s.goals.length > 0 && s.weight === 100 ? 'bi-check-circle-fill' : 'bi-circle'"></i><span>Goals set</span></li>
                @if (cycle.selfReview) { <li [class.is-done]="s.review.selfDone"><i class="bi" [class]="s.review.selfDone ? 'bi-check-circle-fill' : 'bi-circle'"></i><span>Self review</span></li> }
                <li [class.is-done]="s.review.managerDone"><i class="bi" [class]="s.review.managerDone ? 'bi-check-circle-fill' : 'bi-circle'"></i><span>Manager review</span></li>
                <li [class.is-done]="!!s.review.finalRating"><i class="bi" [class]="s.review.finalRating ? 'bi-check-circle-fill' : 'bi-circle'"></i><span>Final rating</span></li>
              </ul>
            </section>
            @if (s.review.managerSummary && !s.can.manager) {
              <section class="card"><h2><i class="bi bi-chat-quote"></i> From the manager</h2><p>{{ s.review.managerSummary }}</p></section>
            }
            @if (s.review.finalNote) {
              <section class="card"><h2><i class="bi bi-award"></i> Final note</h2><p>{{ s.review.finalNote }}</p></section>
            }
            @if (s.can.final) {
              <section class="card">
                <h2><i class="bi bi-award"></i> Final rating</h2>
                <p class="muted">Calibrated by HR. Closing the cycle uses the manager rating where this is empty.</p>
                <div class="mx-stars is-big" role="radiogroup" aria-label="Final rating">
                  @for (n of scale(); track n) { <button type="button" role="radio" [attr.aria-checked]="final.rating === n" [class.is-on]="final.rating >= n" (click)="final.rating = n"><i class="bi bi-star-fill"></i></button> }
                </div>
                <label for="pms-final-note">Note</label>
                <textarea id="pms-final-note" rows="2" maxlength="1000" [(ngModel)]="final.note"></textarea>
                <div class="actions mx-row-gap"><button type="button" class="btn btn-primary" (click)="saveFinal()" [disabled]="busy || !final.rating"><i class="bi bi-check2"></i> Save final rating</button></div>
              </section>
            }
          </div>
        </div>
      }
    }

    <app-modal [open]="cycleOpen" size="md" [title]="cycleForm.id ? 'Edit review cycle' : 'New review cycle'" subtitle="Everyone gets a notification when the phase changes." icon="bi-graph-up-arrow" tone="navy" (closed)="cycleOpen = false">
      <label for="cy-name">Name</label>
      <input id="cy-name" maxlength="80" [(ngModel)]="cycleForm.name" placeholder="FY 2026-27 annual review">
      <div class="field-grid">
        <div><label for="cy-start">Starts</label><input id="cy-start" type="date" [(ngModel)]="cycleForm.startDay"></div>
        <div><label for="cy-end">Ends</label><input id="cy-end" type="date" [(ngModel)]="cycleForm.endDay"></div>
      </div>
      <label for="cy-scale">Rating scale</label>
      <select id="cy-scale" [(ngModel)]="cycleForm.scale">
        <option [ngValue]="5">1 to 5</option>
        <option [ngValue]="4">1 to 4</option>
        <option [ngValue]="3">1 to 3</option>
      </select>
      <label class="check"><input type="checkbox" [(ngModel)]="cycleForm.selfReview"> People rate themselves before the manager</label>
      <footer modalFooter class="md-foot">
        <button type="button" class="btn btn-ghost" (click)="cycleOpen = false">Cancel</button>
        <button type="button" class="btn btn-gold" (click)="saveCycle()" [disabled]="busy"><i class="bi bi-check2"></i> Save</button>
      </footer>
    </app-modal>

    <app-modal [open]="goalOpen" size="md" [title]="goalForm.id ? 'Edit goal' : 'Add a goal'" [subtitle]="'Weight left: ' + weightLeft() + ' of 100'" icon="bi-bullseye" tone="gold" (closed)="goalOpen = false">
      <label for="gl-title">Goal</label>
      <input id="gl-title" maxlength="160" [(ngModel)]="goalForm.title" placeholder="Grow repeat customers">
      <label for="gl-detail">Details</label>
      <textarea id="gl-detail" rows="3" maxlength="1000" [(ngModel)]="goalForm.detail" placeholder="How you will get there"></textarea>
      <div class="field-grid">
        <div><label for="gl-target">Measure of success</label><input id="gl-target" maxlength="200" [(ngModel)]="goalForm.target" placeholder="30% of orders from repeat buyers"></div>
        <div><label for="gl-weight">Weight (%)</label><input id="gl-weight" type="number" min="0" max="100" [(ngModel)]="goalForm.weight"></div>
      </div>
      <footer modalFooter class="md-foot">
        <button type="button" class="btn btn-ghost" (click)="goalOpen = false">Cancel</button>
        <button type="button" class="btn btn-gold" (click)="saveGoal()" [disabled]="busy"><i class="bi bi-check2"></i> Save goal</button>
      </footer>
    </app-modal>
  `,
})
export class PerformanceComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly toast = inject(Toast);
  readonly phases = PHASES;
  view: View | null = null;
  sheet: Sheet | null = null;
  tab: 'mine' | 'team' | 'everyone' | 'person' = 'mine';
  cycleId = '';
  personId = '';
  find = '';
  rate: Record<string, { rating: number; note: string }> = {};
  overall = 0;
  summary = '';
  final = { rating: 0, note: '' };
  cycleOpen = false;
  cycleForm = { id: '', name: '', startDay: '', endDay: '', scale: 5, selfReview: true };
  goalOpen = false;
  goalForm = { id: '', title: '', detail: '', target: '', weight: 20 };
  busy = false;
  error = '';

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    try {
      const query = new URLSearchParams();
      if (this.cycleId) query.set('cycle', this.cycleId);
      if (this.personId) query.set('person', this.personId);
      this.apply(await this.api.get<View>('/v1/performance' + (query.toString() ? '?' + query : '')));
      this.error = '';
    } catch (error) {
      this.error = errorText(error, 'Could not load performance.');
    }
  }

  day(value: string): string { return dayLabel(value); }
  phaseIndex(phase: string): number { return PHASES.findIndex((item) => item.key === phase); }
  scale(): number[] { return Array.from({ length: this.view?.cycle?.scale || 5 }, (_, index) => index + 1); }
  weightLeft(): number { return 100 - (this.sheet?.goals || []).filter((goal) => goal.id !== this.goalForm.id).reduce((sum, goal) => sum + goal.weight, 0); }

  statusRows(): Status[] {
    const rows = this.tab === 'team' ? this.view?.team || [] : this.view?.everyone || [];
    const find = this.find.trim().toLowerCase();
    return find ? rows.filter((row) => (row.name + ' ' + row.code).toLowerCase().includes(find)) : rows;
  }

  pickCycle(id: string): void {
    this.cycleId = id;
    void this.load();
  }

  openPerson(id: string): void {
    this.personId = id;
    this.tab = id ? 'person' : 'mine';
    void this.load();
  }

  editCycle(cycle: Cycle | null): void {
    const year = new Date().getMonth() >= 3 ? new Date().getFullYear() : new Date().getFullYear() - 1;
    this.cycleForm = cycle
      ? { id: cycle.id, name: cycle.name, startDay: cycle.startDay, endDay: cycle.endDay, scale: cycle.scale, selfReview: cycle.selfReview }
      : { id: '', name: `FY ${year}-${String(year + 1).slice(2)} annual review`, startDay: `${year}-04-01`, endDay: `${year + 1}-03-31`, scale: 5, selfReview: true };
    this.cycleOpen = true;
  }

  async saveCycle(): Promise<void> {
    await this.run(async () => {
      this.apply(await this.api.post<View>('/v1/performance/cycles', this.cycleForm));
      this.cycleId = this.view?.cycle?.id || '';
      this.cycleOpen = false;
      this.toast.success('Review cycle saved.');
    }, 'Could not save the cycle.');
  }

  async setPhase(phase: string): Promise<void> {
    const cycle = this.view?.cycle;
    if (!cycle) return;
    const label = PHASES.find((item) => item.key === phase)?.label || phase;
    if (!(await this.sweet.confirm({ title: `Move to ${label.toLowerCase()}?`, text: phase === 'closed' ? 'Ratings lock and everyone can read their final rating.' : 'Everyone gets a notification.', confirmText: 'Move' }))) return;
    await this.run(async () => {
      this.apply(await this.api.post<View>(`/v1/performance/cycles/${cycle.id}/phase`, { phase }));
      this.toast.success(`${cycle.name} is now in ${label.toLowerCase()}.`);
    }, 'Could not change the phase.');
  }

  editGoal(goal: Goal | null): void {
    this.goalForm = goal
      ? { id: goal.id, title: goal.title, detail: goal.detail, target: goal.target, weight: goal.weight }
      : { id: '', title: '', detail: '', target: '', weight: Math.max(0, Math.min(25, this.weightLeft())) };
    this.goalOpen = true;
  }

  async saveGoal(): Promise<void> {
    await this.run(async () => {
      this.apply(await this.api.post<View>('/v1/performance/goals', { ...this.goalForm, cycleId: this.view?.cycle?.id, employeeId: this.sheet?.person.id }));
      this.goalOpen = false;
      this.toast.success('Goal saved.');
    }, 'Could not save the goal.');
  }

  async removeGoal(goal: Goal): Promise<void> {
    if (!(await this.sweet.confirm({ title: 'Remove this goal?', text: goal.title, confirmText: 'Remove', danger: true }))) return;
    await this.run(async () => this.apply(await this.api.post<View>(`/v1/performance/goals/${goal.id}/delete`)), 'Could not remove the goal.');
  }

  async saveProgress(goal: Goal): Promise<void> {
    await this.run(async () => {
      this.apply(await this.api.post<View>(`/v1/performance/goals/${goal.id}/progress`, { progress: goal.progress }), true);
      this.toast.success(`Progress ${goal.progress}% saved.`);
    }, 'Could not save progress.');
  }

  async sendReview(submit: boolean): Promise<void> {
    const sheet = this.sheet;
    if (!sheet) return;
    if (submit && !(await this.sweet.confirm({ title: 'Send this review?', text: sheet.can.self ? 'Your manager reads it next. You cannot change it after sending.' : `${sheet.person.name} reads it when the cycle closes.`, confirmText: 'Send' }))) return;
    const body = { cycleId: this.view?.cycle?.id, employeeId: sheet.person.id, goals: this.rate, rating: this.overall, summary: this.summary, submit };
    await this.run(async () => {
      this.apply(await this.api.post<View>(sheet.can.self ? '/v1/performance/self' : '/v1/performance/manager', body), !submit);
      this.toast.success(submit ? 'Review sent.' : 'Draft saved.');
    }, 'Could not save the review.');
  }

  async saveFinal(): Promise<void> {
    await this.run(async () => {
      this.apply(await this.api.post<View>('/v1/performance/final', { cycleId: this.view?.cycle?.id, employeeId: this.sheet?.person.id, ...this.final }), true);
      this.toast.success('Final rating saved.');
    }, 'Could not save the final rating.');
  }

  private apply(view: View, keepForm = false): void {
    this.view = view;
    this.sheet = view.sheet;
    if (!view.sheet || keepForm) {
      for (const goal of view.sheet?.goals || []) this.rate[goal.id] ||= { rating: 0, note: '' };
      return;
    }
    const self = view.sheet.can.self;
    this.rate = {};
    for (const goal of view.sheet.goals) this.rate[goal.id] = self ? { rating: goal.selfRating, note: goal.selfNote } : { rating: goal.managerRating, note: goal.managerNote };
    this.overall = self ? view.sheet.review.selfRating : view.sheet.review.managerRating;
    this.summary = self ? view.sheet.review.selfSummary : view.sheet.review.managerSummary;
    this.final = { rating: view.sheet.review.finalRating, note: view.sheet.review.finalNote };
  }

  private async run(task: () => Promise<void>, failText: string): Promise<void> {
    this.busy = true;
    try {
      await task();
    } catch (error) {
      this.toast.error(errorText(error, failText));
    }
    this.busy = false;
  }
}
