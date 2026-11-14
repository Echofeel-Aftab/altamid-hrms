import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { errorText } from '../shared/kit';
import { ModalComponent } from '../shared/modal.component';
import { Sweet } from '../shared/sweet';
import { Toast } from '../shared/toast';

type Level = 'low' | 'medium' | 'high';
type Readiness = 'now' | '1-2 years' | '3+ years';
interface Card { id: string; name: string; code: string; designation: string; department: string; rating: number; grade: string; joined: string }
interface Plan {
  id: string; role: string; impact: Level; risk: Level; note: string; incumbent: Card | null; incumbentId: string;
  successors: Array<{ employeeId: string; readiness: Readiness; note: string; person: Card }>; readyNow: number; updatedAt: string;
}
interface View { levels: Level[]; readiness: Readiness[]; plans: Plan[]; stats: { roles: number; covered: number; atRisk: number; bench: number }; people: Array<{ id: string; name: string; code: string; designation: string }> }
interface Form { id: string; role: string; incumbentId: string; impact: Level; risk: Level; note: string; successors: Array<{ employeeId: string; readiness: Readiness; note: string }> }

const LEVEL_LABEL: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High' };
const READY_LABEL: Record<Readiness, string> = { now: 'Ready now', '1-2 years': 'Ready in 1 to 2 years', '3+ years': 'Ready in 3+ years' };
const READY_TONE: Record<Readiness, string> = { now: 'is-ok', '1-2 years': 'is-info', '3+ years': 'is-warn' };

@Component({
  selector: 'app-succession',
  imports: [FormsModule, ModalComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-diagram-3"></i></span>
        <p class="eyebrow">Company</p>
        <h1>Succession planning</h1>
        <p class="lede">Name the roles you cannot afford to leave empty, who could step in, and how soon they will be ready.</p>
      </div>
      <button type="button" class="btn btn-gold" (click)="edit(null)"><i class="bi bi-plus-lg"></i> Add a key role</button>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }

    @if (view) {
      <div class="mx-stats">
        <div class="mx-stat"><span class="mx-stat-ico is-info"><i class="bi bi-briefcase"></i></span><strong>{{ view.stats.roles }}</strong><small>Key roles</small></div>
        <div class="mx-stat"><span class="mx-stat-ico is-ok"><i class="bi bi-shield-check"></i></span><strong>{{ view.stats.covered }}</strong><small>Have a ready-now successor</small></div>
        <div class="mx-stat"><span class="mx-stat-ico is-bad"><i class="bi bi-exclamation-triangle"></i></span><strong>{{ view.stats.atRisk }}</strong><small>High risk, nobody ready</small></div>
        <div class="mx-stat"><span class="mx-stat-ico is-warn"><i class="bi bi-people"></i></span><strong>{{ view.stats.bench }}</strong><small>People on the bench</small></div>
      </div>

      @if (!view.plans.length) {
        <section class="card empty-state">
          <i class="bi bi-diagram-3"></i>
          <h2>No key roles yet</h2>
          <p class="muted">Start with the three or four roles that would hurt most if the person left tomorrow.</p>
        </section>
      } @else {
        <section class="card">
          <div class="card-head"><h2><i class="bi bi-grid-3x3"></i> Risk and impact</h2><small class="muted">Top right needs a successor first</small></div>
          <div class="mx-matrix">
            <span class="mx-matrix-y">Impact if they leave</span>
            @for (impact of ['high', 'medium', 'low']; track impact) {
              <span class="mx-matrix-label">{{ levelLabel($any(impact)) }}</span>
              @for (risk of ['low', 'medium', 'high']; track risk) {
                <div class="mx-cell" [class]="'mx-cell is-' + heat($any(impact), $any(risk))">
                  @for (plan of cell($any(impact), $any(risk)); track plan.id) {
                    <button type="button" class="mx-cell-role" [class.is-ready]="plan.readyNow > 0" (click)="edit(plan)" [title]="plan.readyNow ? 'Has a ready-now successor' : 'Nobody ready now'">{{ plan.role }}</button>
                  }
                </div>
              }
            }
            <span></span>
            @for (risk of ['low', 'medium', 'high']; track risk) { <span class="mx-matrix-label is-x">{{ levelLabel($any(risk)) }}</span> }
            <span></span><span class="mx-matrix-x">Risk of losing them</span>
          </div>
        </section>

        <div class="mx-cards">
          @for (plan of view.plans; track plan.id) {
            <article class="card mx-plan">
              <div class="card-head">
                <h2><i class="bi bi-briefcase"></i> {{ plan.role }}</h2>
                <button type="button" class="btn btn-ghost btn-sm" (click)="edit(plan)"><i class="bi bi-pencil"></i> Edit</button>
              </div>
              <div class="chip-row">
                <span class="chip" [class]="'chip ' + levelTone(plan.impact)">Impact {{ levelLabel(plan.impact) }}</span>
                <span class="chip" [class]="'chip ' + levelTone(plan.risk)">Risk {{ levelLabel(plan.risk) }}</span>
                @if (!plan.readyNow) { <span class="chip is-bad"><i class="bi bi-exclamation-triangle"></i> Nobody ready now</span> }
              </div>
              <div class="mx-holder">
                <small>In the role</small>
                @if (plan.incumbent; as person) {
                  <div><strong>{{ person.name }}</strong><span class="muted">{{ person.designation }}@if (person.rating) { · rated {{ person.rating }} }@if (person.grade) { · grade {{ person.grade }} }</span></div>
                } @else { <div class="muted">Empty</div> }
              </div>
              <ul class="mx-bench">
                @for (item of plan.successors; track item.employeeId) {
                  <li>
                    <span class="mx-avatar" aria-hidden="true">{{ initials(item.person.name) }}</span>
                    <span><strong>{{ item.person.name }}</strong><small>{{ item.person.designation || item.person.code }}@if (item.person.rating) { · rated {{ item.person.rating }} }@if (item.note) { · {{ item.note }} }</small></span>
                    <span class="chip" [class]="'chip ' + readyTone(item.readiness)">{{ readyLabel(item.readiness) }}</span>
                  </li>
                } @empty { <li class="muted">No successors named yet.</li> }
              </ul>
              @if (plan.note) { <p class="muted mx-fine">{{ plan.note }}</p> }
            </article>
          }
        </div>
      }
    }

    <app-modal [open]="!!form" size="lg" [title]="form?.id ? 'Edit key role' : 'Add a key role'" subtitle="Only people with succession access can see this." icon="bi-diagram-3" tone="navy" (closed)="form = null">
      @if (form && view) {
        <div class="field-grid">
          <div><label for="sc-role">Role</label><input id="sc-role" maxlength="120" [(ngModel)]="form.role" placeholder="Head of sales"></div>
          <div>
            <label for="sc-holder">Person in the role now</label>
            <select id="sc-holder" [(ngModel)]="form.incumbentId">
              <option value="">Empty</option>
              @for (person of view.people; track person.id) { <option [value]="person.id">{{ person.name }} · {{ person.designation || person.code }}</option> }
            </select>
          </div>
          <div>
            <label>Impact if they leave</label>
            <div class="seg-mini">@for (level of view.levels; track level) { <button type="button" [class.is-active]="form.impact === level" (click)="form.impact = level">{{ levelLabel(level) }}</button> }</div>
          </div>
          <div>
            <label>Risk of losing them</label>
            <div class="seg-mini">@for (level of view.levels; track level) { <button type="button" [class.is-active]="form.risk === level" (click)="form.risk = level">{{ levelLabel(level) }}</button> }</div>
          </div>
        </div>
        <h3 class="mx-row-gap">Successors · {{ form.successors.length }}</h3>
        <ul class="mx-builder">
          @for (item of form.successors; track $index) {
            <li class="mx-builder-row">
              <select [(ngModel)]="item.employeeId" aria-label="Successor">
                <option value="">Choose someone</option>
                @for (person of view.people; track person.id) { @if (person.id !== form.incumbentId) { <option [value]="person.id">{{ person.name }} · {{ person.designation || person.code }}</option> } }
              </select>
              <select [(ngModel)]="item.readiness" aria-label="Readiness">@for (ready of view.readiness; track ready) { <option [value]="ready">{{ readyLabel(ready) }}</option> }</select>
              <input [(ngModel)]="item.note" maxlength="300" placeholder="What they still need" aria-label="Development note">
              <button type="button" class="mx-x" (click)="form.successors.splice($index, 1)" aria-label="Remove successor"><i class="bi bi-trash"></i></button>
            </li>
          }
        </ul>
        @if (form.successors.length < 8) { <button type="button" class="btn btn-ghost btn-sm" (click)="form.successors.push({ employeeId: '', readiness: '1-2 years', note: '' })"><i class="bi bi-person-plus"></i> Add a successor</button> }
        <label for="sc-note">Notes</label>
        <textarea id="sc-note" rows="2" maxlength="1000" [(ngModel)]="form.note" placeholder="Knowledge to hand over, training planned"></textarea>
      }
      <footer modalFooter class="md-foot">
        @if (form?.id) { <button type="button" class="btn btn-ghost" (click)="remove()" [disabled]="busy"><i class="bi bi-trash"></i> Remove role</button> }
        <button type="button" class="btn btn-ghost" (click)="form = null">Cancel</button>
        <button type="button" class="btn btn-gold" (click)="save()" [disabled]="busy"><i class="bi bi-check2"></i> Save</button>
      </footer>
    </app-modal>
  `,
})
export class SuccessionComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly toast = inject(Toast);
  view: View | null = null;
  form: Form | null = null;
  busy = false;
  error = '';

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    try {
      this.view = await this.api.get<View>('/v1/succession');
      this.error = '';
    } catch (error) {
      this.error = errorText(error, 'Could not load succession planning.');
    }
  }

  levelLabel(level: Level): string { return LEVEL_LABEL[level]; }
  levelTone(level: Level): string { return level === 'high' ? 'is-bad' : level === 'medium' ? 'is-warn' : 'is-ok'; }
  readyLabel(ready: Readiness): string { return READY_LABEL[ready]; }
  readyTone(ready: Readiness): string { return READY_TONE[ready]; }
  cell(impact: Level, risk: Level): Plan[] { return (this.view?.plans || []).filter((plan) => plan.impact === impact && plan.risk === risk); }
  initials(name: string): string { return name.split(' ').filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }

  heat(impact: Level, risk: Level): string {
    const score = ['low', 'medium', 'high'].indexOf(impact) + ['low', 'medium', 'high'].indexOf(risk);
    return score >= 3 ? 'hot' : score === 2 ? 'warm' : 'cool';
  }

  edit(plan: Plan | null): void {
    this.form = plan
      ? { id: plan.id, role: plan.role, incumbentId: plan.incumbentId, impact: plan.impact, risk: plan.risk, note: plan.note, successors: plan.successors.map(({ employeeId, readiness, note }) => ({ employeeId, readiness, note })) }
      : { id: '', role: '', incumbentId: '', impact: 'high', risk: 'medium', note: '', successors: [] };
  }

  async save(): Promise<void> {
    if (!this.form) return;
    this.busy = true;
    try {
      this.view = await this.api.post<View>('/v1/succession', { ...this.form, successors: this.form.successors.filter((item) => item.employeeId) });
      this.form = null;
      this.toast.success('Key role saved.');
    } catch (error) {
      this.toast.error(errorText(error, 'Could not save the role.'));
    }
    this.busy = false;
  }

  async remove(): Promise<void> {
    if (!this.form?.id || !(await this.sweet.confirm({ title: `Remove “${this.form.role}”?`, confirmText: 'Remove', danger: true }))) return;
    this.busy = true;
    try {
      this.view = await this.api.post<View>(`/v1/succession/${this.form.id}/delete`);
      this.form = null;
      this.toast.success('Key role removed.');
    } catch (error) {
      this.toast.error(errorText(error, 'Could not remove the role.'));
    }
    this.busy = false;
  }
}
