import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { dayLabel, errorText } from '../shared/kit';
import { ModalComponent } from '../shared/modal.component';
import { Sweet } from '../shared/sweet';
import { Toast } from '../shared/toast';

type QuestionType = 'rating' | 'nps' | 'choice' | 'multi' | 'yesno' | 'text';
interface Question { id: string; type: QuestionType; text: string; options: string[]; required: boolean }
interface Summary { id: string; title: string; intro: string; anonymous: boolean; status: 'draft' | 'open' | 'closed'; closesOn: string; count: number; createdBy: string; createdAt: string; taken?: boolean; answers?: number }
interface Full extends Summary { questions: Question[]; audience: { departments: string[] }; taken: boolean; canRun: boolean }
interface ListView { canRun: boolean; forMe: Summary[]; all: Summary[]; departments: Array<{ id: string; name: string }>; anonFloor: number }
interface ResultQuestion extends Question { answered: number; average?: number; nps?: number | null; spread?: Array<{ label: string; count: number }>; texts?: Array<{ text: string; by: string }> }
interface Results extends Summary { invited: number; answers: number; rate: number; hidden: boolean; anonFloor: number; questions: ResultQuestion[] }
interface Draft { id: string; title: string; intro: string; anonymous: boolean; closesOn: string; departments: string[]; questions: Array<Question & { optionsText: string }> }

const TYPES: Array<{ key: QuestionType; label: string; icon: string }> = [
  { key: 'rating', label: 'Rating 1 to 5', icon: 'bi-star' },
  { key: 'nps', label: 'Score 0 to 10', icon: 'bi-speedometer2' },
  { key: 'choice', label: 'Pick one', icon: 'bi-ui-radios' },
  { key: 'multi', label: 'Pick several', icon: 'bi-ui-checks' },
  { key: 'yesno', label: 'Yes or no', icon: 'bi-toggle-on' },
  { key: 'text', label: 'Written answer', icon: 'bi-textarea-t' },
];

const PULSE: Array<[QuestionType, string, string[]]> = [
  ['rating', 'How happy are you at work these days?', []],
  ['rating', 'I have what I need to do my job well.', []],
  ['rating', 'My manager supports me.', []],
  ['nps', 'How likely are you to recommend us as a place to work?', []],
  ['choice', 'How is your workload?', ['Too little', 'About right', 'A bit too much', 'Far too much']],
  ['text', 'What is one thing we should change?', []],
];

@Component({
  selector: 'app-surveys',
  imports: [FormsModule, ModalComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-clipboard2-pulse"></i></span>
        <p class="eyebrow">Talent</p>
        <h1>Surveys</h1>
        <p class="lede">Quick pulse checks and engagement surveys. Anonymous surveys never store who answered.</p>
      </div>
      @if (list?.canRun) { <button type="button" class="btn btn-gold" (click)="newSurvey()"><i class="bi bi-plus-lg"></i> New survey</button> }
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (list?.canRun) {
      <div class="seg-mini mx-tabs" role="tablist">
        <button type="button" role="tab" [class.is-active]="tab === 'mine'" (click)="tab = 'mine'"><i class="bi bi-inbox"></i> For me · {{ list!.forMe.length }}</button>
        <button type="button" role="tab" [class.is-active]="tab === 'manage'" (click)="tab = 'manage'"><i class="bi bi-sliders"></i> Manage · {{ list!.all.length }}</button>
      </div>
    }

    @if (list && tab === 'mine') {
      <div class="mx-cards">
        @for (survey of list.forMe; track survey.id) {
          <article class="card mx-survey" [class.is-done]="survey.taken">
            <div class="card-head">
              <h2><i class="bi" [class]="survey.taken ? 'bi-check-circle-fill mx-ok' : 'bi-clipboard2-pulse'"></i> {{ survey.title }}</h2>
              @if (survey.anonymous) { <span class="chip is-info"><i class="bi bi-incognito"></i> Anonymous</span> }
            </div>
            @if (survey.intro) { <p class="muted">{{ survey.intro }}</p> }
            <p class="mx-fine muted">{{ survey.count }} question{{ survey.count === 1 ? '' : 's' }}@if (survey.closesOn) { · closes {{ day(survey.closesOn) }} }</p>
            <div class="actions mx-row-gap">
              @if (survey.taken) { <span class="chip is-ok">Answered. Thank you</span> }
              @else { <button type="button" class="btn btn-gold" (click)="take(survey.id)"><i class="bi bi-pencil-square"></i> Answer</button> }
            </div>
          </article>
        } @empty {
          <section class="card empty-state"><i class="bi bi-clipboard2-check"></i><h2>No open surveys</h2><p class="muted">When HR opens a survey for you, it appears here and you get a notification.</p></section>
        }
      </div>
    }

    @if (list && tab === 'manage') {
      <section class="card">
        <div class="table-responsive">
          <table>
            <thead><tr><th>Survey</th><th>Status</th><th>Questions</th><th>Answers</th><th>Closes</th><th></th></tr></thead>
            <tbody>
              @for (survey of list.all; track survey.id) {
                <tr>
                  <td><strong>{{ survey.title }}</strong><br><small>{{ survey.anonymous ? 'Anonymous' : 'Named' }} · by {{ survey.createdBy }} · {{ day(survey.createdAt) }}</small></td>
                  <td><span class="chip" [class]="'chip ' + (survey.status === 'open' ? 'is-ok' : survey.status === 'draft' ? 'is-warn' : '')">{{ statusLabel(survey.status) }}</span></td>
                  <td>{{ survey.count }}</td>
                  <td>{{ survey.answers || 0 }}</td>
                  <td>{{ survey.closesOn ? day(survey.closesOn) : '—' }}</td>
                  <td class="mx-row-actions">
                    @if (survey.status === 'draft') {
                      <button type="button" class="btn btn-ghost btn-sm" (click)="edit(survey.id)"><i class="bi bi-pencil"></i> Edit</button>
                      <button type="button" class="btn btn-primary btn-sm" (click)="setStatus(survey, 'open')"><i class="bi bi-send"></i> Open</button>
                    } @else {
                      <button type="button" class="btn btn-ghost btn-sm" (click)="showResults(survey.id)"><i class="bi bi-bar-chart"></i> Results</button>
                      @if (survey.status === 'open') { <button type="button" class="btn btn-ghost btn-sm" (click)="setStatus(survey, 'closed')"><i class="bi bi-stop-circle"></i> Close</button> }
                      @else { <button type="button" class="btn btn-ghost btn-sm" (click)="setStatus(survey, 'open')"><i class="bi bi-play-circle"></i> Reopen</button> }
                    }
                    <button type="button" class="btn btn-ghost btn-sm" (click)="copy(survey.id)" title="Copy into a new draft"><i class="bi bi-copy"></i></button>
                    @if (!survey.answers) { <button type="button" class="btn btn-ghost btn-sm" (click)="remove(survey)" title="Delete"><i class="bi bi-trash"></i></button> }
                  </td>
                </tr>
              } @empty { <tr><td colspan="6" class="muted">No surveys yet. Start with the pulse template in New survey.</td></tr> }
            </tbody>
          </table>
        </div>
      </section>
    }

    <app-modal [open]="!!answering" size="lg" [title]="answering?.title || ''" [subtitle]="answering?.anonymous ? 'Anonymous: your name is not saved with your answers.' : 'Your name is saved with your answers.'" icon="bi-clipboard2-pulse" tone="gold" (closed)="answering = null">
      @if (answering) {
        @if (answering.intro) { <p class="muted">{{ answering.intro }}</p> }
        <ol class="mx-questions">
          @for (question of answering.questions; track question.id) {
            <li>
              <p class="mx-q">{{ question.text }}@if (question.required) { <span class="mx-req" aria-label="required">*</span> }</p>
              @switch (question.type) {
                @case ('rating') {
                  <div class="mx-stars is-big" role="radiogroup" [attr.aria-label]="question.text">
                    @for (n of [1, 2, 3, 4, 5]; track n) { <button type="button" role="radio" [attr.aria-checked]="given[question.id] === n" [class.is-on]="$any(given[question.id]) >= n" (click)="given[question.id] = n"><i class="bi bi-star-fill"></i></button> }
                  </div>
                }
                @case ('nps') {
                  <div class="mx-scale">
                    @for (n of zeroToTen; track n) { <button type="button" [class.is-on]="given[question.id] === n" (click)="given[question.id] = n">{{ n }}</button> }
                  </div>
                  <div class="mx-scale-ends"><small>Not likely</small><small>Very likely</small></div>
                }
                @case ('yesno') {
                  <div class="chip-row">
                    @for (option of ['Yes', 'No']; track option) { <button type="button" class="chip" [class.is-on]="given[question.id] === option" (click)="given[question.id] = option">{{ option }}</button> }
                  </div>
                }
                @case ('choice') {
                  <div class="chip-row">
                    @for (option of question.options; track option) { <button type="button" class="chip" [class.is-on]="given[question.id] === option" (click)="given[question.id] = option">{{ option }}</button> }
                  </div>
                }
                @case ('multi') {
                  <div class="chip-row">
                    @for (option of question.options; track option) { <button type="button" class="chip" [class.is-on]="picked(question.id, option)" (click)="togglePick(question.id, option)"><i class="bi" [class]="picked(question.id, option) ? 'bi-check-square' : 'bi-square'"></i> {{ option }}</button> }
                  </div>
                }
                @default {
                  <textarea rows="3" maxlength="2000" [(ngModel)]="given[question.id]" [attr.aria-label]="question.text"></textarea>
                }
              }
            </li>
          }
        </ol>
      }
      <footer modalFooter class="md-foot">
        <button type="button" class="btn btn-ghost" (click)="answering = null">Later</button>
        <button type="button" class="btn btn-gold" (click)="sendAnswers()" [disabled]="busy"><i class="bi bi-send"></i> Send answers</button>
      </footer>
    </app-modal>

    <app-modal [open]="!!draft" size="xl" [title]="draft?.id ? 'Edit survey' : 'New survey'" subtitle="It stays a draft until you open it. Opening it notifies everyone it is for." icon="bi-clipboard2-pulse" tone="navy" (closed)="draft = null">
      @if (draft) {
        <div class="field-grid">
          <div class="span-2"><label for="sv-title">Title</label><input id="sv-title" maxlength="120" [(ngModel)]="draft.title" placeholder="Quarterly pulse"></div>
          <div class="span-2"><label for="sv-intro">Introduction</label><textarea id="sv-intro" rows="2" maxlength="1000" [(ngModel)]="draft.intro" placeholder="Why we are asking, and what happens with the answers"></textarea></div>
          <div><label for="sv-closes">Closes on</label><input id="sv-closes" type="date" [(ngModel)]="draft.closesOn"></div>
          <div><label class="check mx-check"><input type="checkbox" [(ngModel)]="draft.anonymous"> Anonymous (results show after {{ list?.anonFloor || 3 }} answers)</label></div>
        </div>
        <label>Who is it for?</label>
        <div class="chip-row">
          <button type="button" class="chip" [class.is-on]="!draft.departments.length" (click)="draft.departments = []">Everyone</button>
          @for (department of list?.departments || []; track department.id) {
            <button type="button" class="chip" [class.is-on]="draft.departments.includes(department.id)" (click)="toggleDepartment(department.id)">{{ department.name }}</button>
          }
        </div>
        <div class="card-head mx-row-gap">
          <h3>Questions · {{ draft.questions.length }}</h3>
          @if (!draft.questions.length) { <button type="button" class="btn btn-ghost btn-sm" (click)="usePulse()"><i class="bi bi-magic"></i> Use the pulse template</button> }
        </div>
        <ol class="mx-builder">
          @for (question of draft.questions; track question.id; let i = $index) {
            <li>
              <div class="mx-builder-row">
                <span class="mx-num-badge">{{ i + 1 }}</span>
                <input [(ngModel)]="question.text" maxlength="300" placeholder="Question" [attr.aria-label]="'Question ' + (i + 1)">
                <select [(ngModel)]="question.type" [attr.aria-label]="'Type of question ' + (i + 1)">
                  @for (type of types; track type.key) { <option [value]="type.key">{{ type.label }}</option> }
                </select>
                <button type="button" class="mx-x" (click)="move(i, -1)" [disabled]="i === 0" aria-label="Move up"><i class="bi bi-arrow-up"></i></button>
                <button type="button" class="mx-x" (click)="move(i, 1)" [disabled]="i === draft.questions.length - 1" aria-label="Move down"><i class="bi bi-arrow-down"></i></button>
                <button type="button" class="mx-x" (click)="draft.questions.splice(i, 1)" aria-label="Remove question"><i class="bi bi-trash"></i></button>
              </div>
              @if (question.type === 'choice' || question.type === 'multi') {
                <textarea rows="3" [(ngModel)]="question.optionsText" placeholder="One option on each line" aria-label="Options"></textarea>
              }
              <label class="check"><input type="checkbox" [(ngModel)]="question.required"> Required</label>
            </li>
          }
        </ol>
        <div class="chip-row mx-row-gap">
          @for (type of types; track type.key) { <button type="button" class="chip" (click)="addQuestion(type.key)"><i class="bi" [class]="type.icon"></i> {{ type.label }}</button> }
        </div>
      }
      <footer modalFooter class="md-foot">
        <button type="button" class="btn btn-ghost" (click)="draft = null">Cancel</button>
        <button type="button" class="btn btn-primary" (click)="saveDraft(false)" [disabled]="busy"><i class="bi bi-save"></i> Save draft</button>
        <button type="button" class="btn btn-gold" (click)="saveDraft(true)" [disabled]="busy"><i class="bi bi-send"></i> Save and open</button>
      </footer>
    </app-modal>

    <app-modal [open]="!!results" size="xl" [title]="results?.title || ''" [subtitle]="results ? results.answers + ' of ' + results.invited + ' answered (' + results.rate + '%)' + (results.anonymous ? ' · anonymous' : '') : ''" icon="bi-bar-chart" tone="info" (closed)="results = null">
      @if (results) {
        <div class="progress mx-progress mx-row-gap"><span [style.width.%]="results.rate"></span></div>
        @if (results.hidden) {
          <p class="mx-note"><i class="bi bi-incognito"></i> Results show once {{ results.anonFloor }} people have answered, so nobody can be picked out. {{ results.answers }} so far.</p>
        } @else {
          <div class="mx-results">
            @for (question of results.questions; track question.id; let i = $index) {
              <section class="mx-panel">
                <div class="card-head">
                  <h3>{{ i + 1 }}. {{ question.text }}</h3>
                  @if (question.type === 'nps' && question.nps !== null && question.nps !== undefined) { <span class="chip" [class]="'chip ' + (question.nps >= 30 ? 'is-ok' : question.nps >= 0 ? 'is-warn' : 'is-bad')">eNPS {{ question.nps }}</span> }
                  @else if (question.type === 'rating') { <span class="chip is-info">Average {{ question.average }} / 5</span> }
                </div>
                <p class="mx-fine muted">{{ question.answered }} answer{{ question.answered === 1 ? '' : 's' }}</p>
                @if (question.spread) {
                  <div class="mx-bars">
                    @for (bar of question.spread; track bar.label) {
                      <div class="mx-bar-row"><span>{{ bar.label }}</span><div class="mx-bar"><span [style.width.%]="share(bar.count, question)"></span></div><b>{{ bar.count }}</b></div>
                    }
                  </div>
                }
                @if (question.texts) {
                  <ul class="mx-quotes">
                    @for (item of question.texts; track $index) { <li>“{{ item.text }}”@if (item.by) { <small> · {{ item.by }}</small> }</li> } @empty { <li class="muted">No written answers.</li> }
                  </ul>
                }
              </section>
            }
          </div>
        }
      }
      <footer modalFooter class="md-foot"><button type="button" class="btn btn-ghost" (click)="results = null">Close</button></footer>
    </app-modal>
  `,
})
export class SurveysComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly toast = inject(Toast);
  readonly types = TYPES;
  readonly zeroToTen = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  list: ListView | null = null;
  tab: 'mine' | 'manage' = 'mine';
  answering: Full | null = null;
  given: Record<string, unknown> = {};
  draft: Draft | null = null;
  results: Results | null = null;
  busy = false;
  error = '';

  async ngOnInit(): Promise<void> {
    await this.load();
    if (this.list?.canRun && !this.list.forMe.some((survey) => !survey.taken)) this.tab = 'manage';
  }

  async load(): Promise<void> {
    try {
      this.list = await this.api.get<ListView>('/v1/surveys');
      this.error = '';
    } catch (error) {
      this.error = errorText(error, 'Could not load surveys.');
    }
  }

  day(value: string): string { return dayLabel(value); }
  statusLabel(status: string): string { return status === 'open' ? 'Open' : status === 'draft' ? 'Draft' : 'Closed'; }
  share(count: number, question: ResultQuestion): number { return question.answered ? Math.round(count / question.answered * 100) : 0; }
  picked(id: string, option: string): boolean { return Array.isArray(this.given[id]) && (this.given[id] as string[]).includes(option); }

  togglePick(id: string, option: string): void {
    const list = Array.isArray(this.given[id]) ? [...(this.given[id] as string[])] : [];
    const index = list.indexOf(option);
    if (index >= 0) list.splice(index, 1);
    else list.push(option);
    this.given[id] = list;
  }

  async take(id: string): Promise<void> {
    try {
      this.answering = await this.api.get<Full>('/v1/surveys/' + id);
      this.given = {};
    } catch (error) {
      this.toast.error(errorText(error, 'Could not open the survey.'));
    }
  }

  async sendAnswers(): Promise<void> {
    if (!this.answering) return;
    const missing = this.answering.questions.find((question) => question.required && this.blank(this.given[question.id]));
    if (missing) { this.toast.warning(`Answer “${missing.text}”.`); return; }
    this.busy = true;
    try {
      const done = await this.api.post<{ message: string }>(`/v1/surveys/${this.answering.id}/answer`, { answers: this.given });
      this.answering = null;
      this.toast.success(done.message);
      await this.load();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not send your answers.'));
    }
    this.busy = false;
  }

  newSurvey(): void {
    this.draft = { id: '', title: '', intro: '', anonymous: true, closesOn: '', departments: [], questions: [] };
  }

  async edit(id: string): Promise<void> {
    const full = await this.fetch(id);
    if (full) this.draft = this.toDraft(full, full.id);
  }

  async copy(id: string): Promise<void> {
    const full = await this.fetch(id);
    if (full) this.draft = { ...this.toDraft(full, ''), title: `${full.title} (copy)`.slice(0, 120), closesOn: '' };
  }

  usePulse(): void {
    if (!this.draft) return;
    this.draft.title ||= 'Pulse check';
    this.draft.questions = PULSE.map(([type, text, options]) => this.question(type, text, options));
  }

  addQuestion(type: QuestionType): void {
    if (!this.draft) return;
    this.draft.questions.push(this.question(type, '', type === 'choice' || type === 'multi' ? ['Option 1', 'Option 2'] : []));
  }

  move(index: number, step: number): void {
    const list = this.draft?.questions;
    if (!list) return;
    const [item] = list.splice(index, 1);
    list.splice(index + step, 0, item);
  }

  toggleDepartment(id: string): void {
    if (!this.draft) return;
    const list = this.draft.departments;
    const index = list.indexOf(id);
    if (index >= 0) list.splice(index, 1);
    else list.push(id);
  }

  async saveDraft(open: boolean): Promise<void> {
    const draft = this.draft;
    if (!draft) return;
    const body = {
      ...draft,
      questions: draft.questions.map(({ optionsText, ...question }) => ({ ...question, options: optionsText.split('\n').map((line) => line.trim()).filter(Boolean) })),
    };
    this.busy = true;
    try {
      const saved = await this.api.post<Full>('/v1/surveys', body);
      if (open) await this.api.post(`/v1/surveys/${saved.id}/status`, { status: 'open' });
      this.draft = null;
      this.toast.success(open ? 'Survey is open. Everyone it is for was told.' : 'Draft saved.');
      await this.load();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not save the survey.'));
    }
    this.busy = false;
  }

  async setStatus(survey: Summary, status: 'open' | 'closed'): Promise<void> {
    const text = status === 'open' ? (survey.status === 'draft' ? 'Everyone it is for gets a notification.' : 'People who have not answered can answer again.') : 'Nobody can answer after this.';
    if (!(await this.sweet.confirm({ title: `${status === 'open' ? 'Open' : 'Close'} “${survey.title}”?`, text, confirmText: status === 'open' ? 'Open' : 'Close' }))) return;
    try {
      await this.api.post(`/v1/surveys/${survey.id}/status`, { status });
      this.toast.success(status === 'open' ? 'Survey opened.' : 'Survey closed.');
      await this.load();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not change the survey.'));
    }
  }

  async remove(survey: Summary): Promise<void> {
    if (!(await this.sweet.confirm({ title: `Delete “${survey.title}”?`, confirmText: 'Delete', danger: true }))) return;
    try {
      await this.api.post(`/v1/surveys/${survey.id}/delete`);
      this.toast.success('Survey deleted.');
      await this.load();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not delete the survey.'));
    }
  }

  async showResults(id: string): Promise<void> {
    try {
      this.results = await this.api.get<Results>(`/v1/surveys/${id}/results`);
    } catch (error) {
      this.toast.error(errorText(error, 'Could not load the results.'));
    }
  }

  private async fetch(id: string): Promise<Full | null> {
    try {
      return await this.api.get<Full>('/v1/surveys/' + id);
    } catch (error) {
      this.toast.error(errorText(error, 'Could not open the survey.'));
      return null;
    }
  }

  private toDraft(full: Full, id: string): Draft {
    return {
      id,
      title: full.title,
      intro: full.intro,
      anonymous: full.anonymous,
      closesOn: full.closesOn,
      departments: [...full.audience.departments],
      questions: full.questions.map((question) => ({ ...question, id: id ? question.id : this.newId(), optionsText: question.options.join('\n') })),
    };
  }

  private question(type: QuestionType, text: string, options: string[]): Question & { optionsText: string } {
    return { id: this.newId(), type, text, options, required: type !== 'text', optionsText: options.join('\n') };
  }

  private newId(): string { return 'q' + Math.random().toString(36).slice(2, 9); }
  private blank(value: unknown): boolean { return value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length); }
}
