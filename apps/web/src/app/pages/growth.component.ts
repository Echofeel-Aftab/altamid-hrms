import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { PhotoComponent } from '../shared/photo.component';

interface GrowthLine { side: string; name: string; amount?: string; rupees: string }
interface GrowthPoint { year: number; label: string; rating: number; joined: boolean; draft: boolean }
interface GrowthYear {
  year: number;
  grade: string;
  rating: number;
  designation: string;
  note: string;
  published: boolean;
  publisher: string;
  annual: string;
  lines: GrowthLine[];
}
interface GrowthPerson {
  id: string;
  name: string;
  code: string;
  photo: string;
  designation: string;
  joined: string;
  workerType: string;
  manager: { id: string; name: string; code: string; photo: string } | null;
}
interface GrowthChoice { id: string; name: string; code: string; mine: boolean }
interface GrowthView {
  person: GrowthPerson | null;
  people: GrowthChoice[];
  canPublish: boolean;
  grades: Array<{ grade: string; rating: number }>;
  suggestedYear: number;
  chart: GrowthPoint[];
  history: GrowthYear[];
  latest: { year: number; grade: string; rating: number } | null;
  current: { effectiveFrom: string; annual: string; lines: GrowthLine[] } | null;
}

interface PlotDot extends GrowthPoint { x: number; y: number }
interface PlotTick { n: number; y: number }
interface Plot { w: number; h: number; left: number; right: number; points: string; dots: PlotDot[]; ticks: PlotTick[] }

@Component({
  selector: 'app-growth',
  imports: [FormsModule, PhotoComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-graph-up-arrow"></i></span>
        <p class="eyebrow">My day</p>
        <h1>My Growth</h1>
        <p class="lede">The career line from the year you joined, and each appraisal your manager or HR has published. A year stays hidden until they publish the grade and the CTC breakup.</p>
      </div>
    </div>

    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (view) {
      @if (view.people.length > 1) {
        <section class="card growth-pick">
          <label for="growth-who">Whose growth</label>
          <select id="growth-who" name="person" [(ngModel)]="personId" (ngModelChange)="load()">
            @for (item of view.people; track item.id) {
              <option [value]="item.id">{{ item.mine ? 'My growth · ' : '' }}{{ item.name }} · {{ item.code }}</option>
            }
          </select>
        </section>
      }

      @if (!view.person) {
        <section class="card">
          <h2><i class="bi bi-person"></i> Choose a person</h2>
          <p class="muted">Pick someone above. HR can publish for anyone. A team lead can publish for the people who report to them.</p>
        </section>
      } @else {
        <section class="card growth-id">
          <div class="growth-who">
            <app-photo [personId]="view.person.id" [stamp]="view.person.photo" [name]="view.person.name" size="md" />
            <div>
              <h2>{{ view.person.name }}</h2>
              <p class="muted">{{ view.person.designation || 'Designation not added' }}</p>
            </div>
          </div>
          <dl class="growth-facts">
            <div><dt>Date of joining</dt><dd>{{ view.person.joined }}</dd></div>
            <div><dt>Employee id</dt><dd>{{ view.person.code }}</dd></div>
            <div><dt>Employee type</dt><dd>{{ view.person.workerType }}</dd></div>
          </dl>
          <div class="growth-boss">
            <span>Reporting manager</span>
            @if (view.person.manager) {
              <div class="growth-boss-person">
                <app-photo [personId]="view.person.manager.id" [stamp]="view.person.manager.photo" [name]="view.person.manager.name" size="sm" />
                <div>
                  <strong>{{ view.person.manager.name }}</strong>
                  <small>{{ view.person.manager.code }}</small>
                </div>
              </div>
            } @else {
              <strong>Not assigned</strong>
            }
          </div>
        </section>

        <section class="card">
          <div class="card-head">
            <h2><i class="bi bi-graph-up-arrow"></i> Career progression</h2>
            <div class="growth-score">
              <span>Performance card</span>
              <strong>{{ view.latest?.rating ?? '—' }}</strong>
              <small>{{ view.latest ? view.latest.grade + ' · ' + view.latest.year : 'Not published yet' }}</small>
            </div>
          </div>
          @if (plot(); as drawn) {
            <div class="growth-plot">
              <svg [attr.viewBox]="'0 0 ' + drawn.w + ' ' + drawn.h" role="img" [attr.aria-label]="chartLabel()">
                @for (tick of drawn.ticks; track tick.n) {
                  <line class="growth-grid" [attr.x1]="drawn.left" [attr.x2]="drawn.w - drawn.right" [attr.y1]="tick.y" [attr.y2]="tick.y" />
                  <text class="growth-axis" [attr.x]="drawn.left - 8" [attr.y]="tick.y + 4" text-anchor="end">{{ tick.n }}</text>
                }
                @if (drawn.dots.length > 1) {
                  <polyline class="growth-line" [attr.points]="drawn.points" />
                }
                @for (dot of drawn.dots; track dot.year) {
                  <text class="growth-tag" [attr.x]="dot.x" [attr.y]="dot.y - 14" text-anchor="middle">{{ dot.label }}</text>
                  <circle class="growth-dot" [class.is-joined]="dot.joined" [class.is-draft]="dot.draft" [attr.cx]="dot.x" [attr.cy]="dot.y" r="8" />
                  <text class="growth-axis" [attr.x]="dot.x" [attr.y]="drawn.h - 8" text-anchor="middle">{{ dot.year }}</text>
                }
              </svg>
            </div>
            <p class="growth-caption">Rating across the financial year. Joined sits at 1 until the first appraisal.</p>
            <p class="growth-legend">
              <i class="is-joined"></i> Joined
              <i></i> Published grade
              @if (view.canPublish) { <i class="is-draft"></i> Draft, hidden from them }
            </p>
          } @else {
            <p class="muted">Add a date of joining, or publish an appraisal, and the chart will draw here.</p>
          }
        </section>

        <section class="card">
          <h2><i class="bi bi-table"></i> Career history</h2>
          @if (!view.history.length) {
            <p class="muted">No appraisal has been published yet. Each year, the team lead or HR records the grade and the CTC breakup.</p>
          } @else {
            <div class="growth-table">
              <table>
                <thead>
                  <tr>
                    <th>Financial year</th>
                    <th>Grade</th>
                    <th>Designation</th>
                    <th>Annual CTC</th>
                    <th>Published by</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of view.history; track row.year) {
                    <tr>
                      <td>{{ row.year }} @if (!row.published) { <span class="pill warn">Draft</span> }</td>
                      <td>{{ row.grade }} <span class="muted">{{ row.rating }}/5</span></td>
                      <td>{{ row.designation || '—' }}</td>
                      <td>{{ row.annual }}</td>
                      <td>{{ row.publisher || '—' }}@if (row.note) { <br><span class="muted">{{ row.note }}</span> }</td>
                      <td class="growth-row-actions">
                        <button type="button" class="btn btn-ghost btn-sm" (click)="toggle(row.year)">{{ openYear === row.year ? 'Hide breakup' : 'CTC breakup' }}</button>
                        @if (view.canPublish) { <button type="button" class="btn btn-ghost btn-sm" (click)="edit(row)">Edit</button> }
                      </td>
                    </tr>
                    @if (openYear === row.year) {
                      <tr class="growth-break">
                        <td colspan="6">
                          @if (!row.lines.length) {
                            <p class="muted">No CTC breakup was entered for this year.</p>
                          } @else {
                            <ul class="pay-lines">
                              @for (line of row.lines; track line.side + line.name) {
                                <li><span>{{ line.name }} <span class="muted">{{ sideLabel(line.side) }}</span></span><strong>{{ line.amount }}</strong></li>
                              }
                              <li class="pay-net"><span>Annual CTC</span><strong>{{ row.annual }}</strong></li>
                            </ul>
                          }
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          }
        </section>

        @if (view.canPublish) {
          <section class="card">
            <h2><i class="bi bi-pencil-square"></i> Publish this appraisal</h2>
            <p class="muted">Save a draft while you work on it. Publish when the grade and the CTC breakup should show on their My Growth. You can publish again later in the same year to correct it.</p>
            @if (formNote) { <p [class]="formFailed ? 'form-error' : 'form-ok'">{{ formNote }}</p> }
            <form (ngSubmit)="save(true)">
              <div class="growth-fields">
                <label for="growth-year">Appraisal year
                  <input id="growth-year" name="year" type="number" [(ngModel)]="year" [min]="1990" [max]="view.suggestedYear + 1" required>
                </label>
                <label for="growth-grade">Grade
                  <select id="growth-grade" name="grade" [(ngModel)]="grade">
                    @for (item of view.grades; track item.grade) {
                      <option [value]="item.grade">{{ item.grade }} · {{ item.rating }}/5</option>
                    }
                  </select>
                </label>
                <label for="growth-title">Designation
                  <input id="growth-title" name="designation" [(ngModel)]="designation" maxlength="80" placeholder="Role at this appraisal">
                </label>
              </div>
              <label for="growth-note">Note</label>
              <textarea id="growth-note" name="note" rows="2" [(ngModel)]="note" maxlength="500" placeholder="What changed this year"></textarea>
              <p class="access-label">CTC breakup for the year. Annual CTC is earnings plus employer contributions.</p>
              <div class="growth-lines">
                @for (line of lines; track $index) {
                  <div class="growth-line-row">
                    <select [name]="'side-' + $index" [(ngModel)]="line.side" aria-label="CTC line type">
                      <option value="earning">Earning</option>
                      <option value="deduction">Deduction</option>
                      <option value="employer">Employer</option>
                    </select>
                    <input [name]="'name-' + $index" [(ngModel)]="line.name" placeholder="Basic" aria-label="CTC line name">
                    <input [name]="'rupees-' + $index" [(ngModel)]="line.rupees" inputmode="decimal" placeholder="Annual rupees" aria-label="Annual rupees">
                    <button type="button" class="btn btn-ghost btn-sm" (click)="removeLine($index)" [disabled]="lines.length === 1" aria-label="Remove line"><i class="bi bi-x-lg"></i></button>
                  </div>
                }
              </div>
              <div class="actions">
                <button type="button" class="btn btn-ghost" (click)="addLine()"><i class="bi bi-plus-lg"></i> Add a line</button>
                <button type="button" class="btn btn-ghost" (click)="copyCtc()" [disabled]="!view.current">Use current CTC</button>
                <button type="button" class="btn btn-ghost" (click)="save(false)" [disabled]="busy">Save draft</button>
                <button type="submit" class="btn btn-gold" [disabled]="busy"><i class="bi bi-check2"></i> {{ busy ? 'Saving…' : 'Publish' }}</button>
                @if (editingYear) {
                  <button type="button" class="btn btn-ghost btn-danger" (click)="removeYear()" [disabled]="busy">Remove {{ editingYear }}</button>
                }
              </div>
              @if (view.current) { <p class="field-hint">Current published CTC is {{ view.current.annual }} from {{ view.current.effectiveFrom }}.</p> }
            </form>
          </section>
        }
      }
    }
  `,
})
export class GrowthComponent implements OnInit {
  private readonly api = inject(ApiService);
  view: GrowthView | null = null;
  error = '';
  formNote = '';
  formFailed = false;
  busy = false;
  personId = '';
  year = new Date().getFullYear();
  grade = 'Great';
  designation = '';
  note = '';
  lines: GrowthLine[] = [{ side: 'earning', name: 'Basic', rupees: '' }];
  openYear = 0;
  editingYear = 0;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.error = '';
    try {
      const query = this.personId ? '?person=' + encodeURIComponent(this.personId) : '';
      const next = await this.api.get<GrowthView>('/v1/growth' + query);
      const switched = !!this.view && this.view.person?.id !== next.person?.id;
      this.view = next;
      if (!this.personId && next.person) this.personId = next.person.id;
      if (!this.editingYear || switched) this.freshForm();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load growth.';
    }
  }

  plot(): Plot | null {
    const points = this.view?.chart || [];
    if (!points.length) return null;
    const w = 760;
    const h = 250;
    const left = 44;
    const right = 72;
    const top = 36;
    const bottom = 32;
    const innerW = w - left - right;
    const innerH = h - top - bottom;
    const dots = points.map((point, index) => {
      const x = points.length === 1 ? left + innerW / 2 : left + (index / (points.length - 1)) * innerW;
      const rating = Math.min(5, Math.max(0, point.rating));
      const y = top + (1 - rating / 5) * innerH;
      return { ...point, x, y };
    });
    return {
      w, h, left, right,
      points: dots.map((dot) => `${dot.x.toFixed(1)},${dot.y.toFixed(1)}`).join(' '),
      dots,
      ticks: [0, 1, 2, 3, 4, 5].map((n) => ({ n, y: top + (1 - n / 5) * innerH })),
    };
  }

  chartLabel(): string {
    return (this.view?.chart || []).map((point) => `${point.year} ${point.label}`).join(', ');
  }

  toggle(year: number): void {
    this.openYear = this.openYear === year ? 0 : year;
  }

  edit(row: GrowthYear): void {
    this.editingYear = row.year;
    this.year = row.year;
    this.grade = row.grade;
    this.designation = row.designation;
    this.note = row.note;
    this.lines = row.lines.length ? row.lines.map((line) => ({ side: line.side, name: line.name, rupees: line.rupees })) : [{ side: 'earning', name: 'Basic', rupees: '' }];
    this.formNote = '';
    this.openYear = row.year;
  }

  addLine(): void {
    this.lines = [...this.lines, { side: 'earning', name: '', rupees: '' }];
  }

  removeLine(index: number): void {
    this.lines = this.lines.filter((_, at) => at !== index);
  }

  copyCtc(): void {
    const current = this.view?.current;
    if (!current?.lines.length) return;
    this.lines = current.lines.map((line) => ({ side: line.side, name: line.name, rupees: line.rupees }));
  }

  async save(publish: boolean): Promise<void> {
    if (!this.view?.person) return;
    this.busy = true;
    this.formNote = '';
    try {
      this.view = await this.api.post<GrowthView>('/v1/growth', {
        employeeId: this.view.person.id,
        year: this.year,
        grade: this.grade,
        designation: this.designation,
        note: this.note,
        lines: this.lines,
        publish,
      });
      this.editingYear = Number(this.year);
      this.openYear = this.editingYear;
      this.formFailed = false;
      this.formNote = publish ? `Published the ${this.year} appraisal.` : `Saved ${this.year} as a draft.`;
    } catch (error) {
      this.formFailed = true;
      this.formNote = error instanceof Error ? error.message : 'Could not save the appraisal.';
    } finally {
      this.busy = false;
    }
  }

  async removeYear(): Promise<void> {
    if (!this.view?.person || !this.editingYear) return;
    if (!window.confirm(`Remove the ${this.editingYear} appraisal? The chart and the CTC breakup for that year go with it.`)) return;
    this.busy = true;
    this.formNote = '';
    try {
      this.view = await this.api.post<GrowthView>('/v1/growth/remove', { employeeId: this.view.person.id, year: this.editingYear });
      this.formFailed = false;
      this.formNote = `Removed the ${this.editingYear} appraisal.`;
      this.freshForm();
    } catch (error) {
      this.formFailed = true;
      this.formNote = error instanceof Error ? error.message : 'Could not remove the appraisal.';
    } finally {
      this.busy = false;
    }
  }

  sideLabel(side: string): string {
    if (side === 'deduction') return 'Deduction';
    if (side === 'employer') return 'Employer';
    return 'Earning';
  }

  private freshForm(): void {
    this.editingYear = 0;
    this.year = this.view?.suggestedYear || new Date().getFullYear();
    this.grade = 'Great';
    this.designation = this.view?.person?.designation || '';
    this.note = '';
    this.lines = [{ side: 'earning', name: 'Basic', rupees: '' }];
    this.openYear = 0;
  }
}
