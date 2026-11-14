import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { SessionStore } from '../core/session.store';
import { ModalComponent } from '../shared/modal.component';
import { Sweet } from '../shared/sweet';
import { APPLICATION_STATUSES, scoreLabel } from './applications.component';

interface Segment { t: string; hit: boolean }
interface Point { text: string; status: 'met' | 'partly' | 'missing' | 'unknown'; hits: string[]; miss: string[] }
interface Component_ { key: string; label: string; weight: number; value: number; note: string }
interface HistoryRow { at: string; kind: string; detail: string; by: string; job: string; applicationId: string; current: boolean }

interface Detail {
  id: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  resumeUrl: string;
  portal: string;
  status: string;
  note: string;
  message: string;
  jobTitle: string;
  jobCode: string;
  openingId: string;
  createdAt: string;
  decidedAt: string;
  resumeText: string;
  coolingUntil: string;
  coolingNote: string;
  formName: string;
  answers: Array<{ label: string; value: string }>;
  files?: Array<{ id: string; field: string; name: string; type: string; size: number }>;
  tracking?: Array<{ label: string; value: string }>;
  opening: { id: string; code: string; title: string; department: string; location: string; workplace: string; employment: string; status: string } | null;
  match: { score: number | null; reason: string; components: Component_[]; points: Point[]; matched: string[]; missing: string[] };
  highlights: { resume: Segment[]; message: Segment[] };
  repeat: {
    applications: Array<{ id: string; jobTitle: string; jobCode: string; status: string; statusLabel: string; createdAt: string; on: string[] }>;
    employees: Array<{ id: string; code: string; name: string; status: string; dateOfJoining: string; dateOfExit: string; on: string[] }>;
  };
  cooling: { until: string; untilLabel: string; reason: string; kind: string } | null;
  rules: { rejectDays: number; exitDays: number };
  history: HistoryRow[];
}

const HISTORY_ICON: Record<string, string> = {
  received: 'bi-inbox',
  status: 'bi-arrow-left-right',
  note: 'bi-chat-left-text',
  resume: 'bi-file-earmark-text',
  cooling: 'bi-hourglass-split',
  joined: 'bi-person-check',
  left: 'bi-box-arrow-right',
};

@Component({
  selector: 'app-application',
  imports: [RouterLink, FormsModule, ModalComponent],
  template: `
    <a class="btn btn-ghost back-link" routerLink="/hiring/applications"><i class="bi bi-arrow-left"></i> All applications</a>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (row; as row) {
      <div class="page-head ad-head">
        <div class="ad-who">
          <span class="ad-avatar" aria-hidden="true">{{ initials(row.name) }}</span>
          <div>
            <p class="eyebrow">Application</p>
            <h1>{{ row.name }}</h1>
            <p class="muted">
              @if (row.opening) { <a [routerLink]="'/hiring/' + row.opening.id">{{ row.jobTitle }}</a> · {{ row.jobCode }} } @else { {{ row.jobTitle || 'General form' }} }
              · {{ row.portal }} · {{ when(row.createdAt) }}
            </p>
          </div>
        </div>
        <div class="ad-head-side">
          <span [class]="'pill ' + tone(row.status)">{{ statusLabel(row.status) }}</span>
          <div class="actions">
            @if (row.email) { <a class="btn btn-ghost btn-sm" [href]="'mailto:' + row.email"><i class="bi bi-envelope"></i> Email</a> }
            @if (row.phone) { <a class="btn btn-ghost btn-sm" [href]="'tel:' + row.phone"><i class="bi bi-telephone"></i> Call</a> }
          </div>
        </div>
      </div>

      @if (row.coolingUntil || row.cooling || row.repeat.applications.length || row.repeat.employees.length) {
        <div class="ad-flags">
          @if (row.coolingUntil) {
            <div class="ad-flag is-warn">
              <i class="bi bi-hourglass-split"></i>
              <div><strong>Received inside the reapply gap</strong><span>{{ row.coolingNote }}. They could apply again from {{ day(row.coolingUntil) }}.</span></div>
            </div>
          } @else if (row.cooling) {
            <div class="ad-flag is-warn">
              <i class="bi bi-hourglass-split"></i>
              <div><strong>Inside the reapply gap until {{ row.cooling.untilLabel }}</strong><span>{{ row.cooling.reason }}.</span></div>
            </div>
          }
          @if (row.repeat.applications.length) {
            <div class="ad-flag is-info">
              <i class="bi bi-arrow-repeat"></i>
              <div>
                <strong>Repeat applicant · {{ row.repeat.applications.length + 1 }} applications</strong>
                <span>{{ repeatSummary(row) }}</span>
              </div>
            </div>
          }
          @for (person of row.repeat.employees; track person.id) {
            <div class="ad-flag" [class.is-bad]="person.status === 'exited'" [class.is-info]="person.status !== 'exited'">
              <i class="bi" [class]="person.status === 'exited' ? 'bi-box-arrow-right' : 'bi-person-badge'"></i>
              <div>
                <strong>{{ person.status === 'exited' ? 'Former employee' : 'Already works here' }} · {{ person.code }}</strong>
                <span>{{ person.name }}, joined {{ day(person.dateOfJoining) }}@if (person.dateOfExit) {, left {{ day(person.dateOfExit) }}}. Matched on {{ person.on.join(' and ') }}.</span>
              </div>
            </div>
          }
        </div>
      }

      <div class="ad-grid">
        <div class="ad-main">
          <section class="card ad-match">
            <div class="ad-card-head">
              <h2><i class="bi bi-bullseye"></i> Match with the job description</h2>
              @if (row.opening) { <a class="btn btn-ghost btn-sm" [routerLink]="'/hiring/' + row.opening.id"><i class="bi bi-briefcase"></i> View job</a> }
            </div>
            @if (row.match.score === null) {
              <div class="ad-empty">
                <i class="bi bi-file-earmark-text"></i>
                <p>{{ row.match.reason }}</p>
                @if (row.opening) { <button type="button" class="btn btn-primary btn-sm" (click)="openResume()"><i class="bi bi-clipboard-plus"></i> Paste resume text</button> }
              </div>
            } @else {
              <div class="ad-score">
                <div class="ad-ring" [class]="'ad-ring is-' + band(row.match.score)" [style.--p]="row.match.score">
                  <strong>{{ row.match.score }}<small>%</small></strong>
                  <span>{{ verdict(row.match.score) }}</span>
                </div>
                <div class="ad-parts">
                  @for (part of row.match.components; track part.key) {
                    <div class="ad-part">
                      <div class="ad-part-top"><span>{{ part.label }}</span><strong>{{ part.value }}%</strong></div>
                      <div class="ad-bar"><span [style.width.%]="part.value" [class]="'is-' + band(part.value)"></span></div>
                      <small class="muted">{{ part.note }}</small>
                    </div>
                  }
                </div>
              </div>
            }
            @if (row.match.points.length) {
              <h3 class="ad-h3">Job description points</h3>
              <ul class="ad-points">
                @for (point of row.match.points; track $index) {
                  <li [class]="'is-' + point.status">
                    <i class="bi" [class]="pointIcon(point.status)"></i>
                    <div>
                      <span>{{ point.text }}</span>
                      @if (point.hits.length) {
                        <div class="chip-row">@for (word of point.hits; track word) { <span class="chip ad-hit">{{ word }}</span> }</div>
                      }
                    </div>
                  </li>
                }
              </ul>
            }
            @if (row.match.missing.length) {
              <h3 class="ad-h3">Not found in what they sent</h3>
              <div class="chip-row">@for (word of row.match.missing; track word) { <span class="chip">{{ word }}</span> }</div>
            }
            <p class="muted ad-fine">This is a word match between the job description and what the applicant sent: the resume text, cover note and form answers. It helps you sort, it does not decide. Read the resume before you decide.</p>
          </section>

          <section class="card">
            <div class="ad-card-head">
              <h2><i class="bi bi-file-earmark-person"></i> Resume</h2>
              <div class="actions">
                @if (resumeLink(row)) { <a class="btn btn-ghost btn-sm" [href]="resumeLink(row)" target="_blank" rel="noopener noreferrer"><i class="bi bi-box-arrow-up-right"></i> Open resume link</a> }
                <button type="button" class="btn btn-ghost btn-sm" (click)="openResume()"><i class="bi" [class]="row.resumeText ? 'bi-pencil' : 'bi-clipboard-plus'"></i> {{ row.resumeText ? 'Edit text' : 'Paste resume text' }}</button>
              </div>
            </div>
            @if (row.resumeText) {
              <div class="ad-text">@for (seg of row.highlights.resume; track $index) {@if (seg.hit) {<mark>{{ seg.t }}</mark>} @else {<span>{{ seg.t }}</span>}}</div>
              <p class="muted ad-fine"><mark class="ad-key">Highlighted</mark> words also appear in the job description.</p>
            } @else {
              <p class="muted">@if (resumeLink(row)) { The applicant sent a link. } @else { No resume was sent. } Paste the text from the resume to see it here with the job description words highlighted and to score the match.</p>
            }
          </section>

          @if (row.message || row.answers.length) {
            <section class="card">
              <div class="ad-card-head"><h2><i class="bi bi-chat-square-text"></i> What they told us</h2>@if (row.formName) { <span class="chip">{{ row.formName }}</span> }</div>
              @if (row.message) {
                <h3 class="ad-h3">Cover note</h3>
                <div class="ad-text">@for (seg of row.highlights.message; track $index) {@if (seg.hit) {<mark>{{ seg.t }}</mark>} @else {<span>{{ seg.t }}</span>}}</div>
              }
              @if (row.answers.length) {
                <dl class="kv ad-answers">
                  @for (item of row.answers; track $index) { <div><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div> }
                </dl>
              }
            </section>
          }

          @if (row.files?.length || row.tracking?.length) {
            <section class="card">
              <div class="ad-card-head"><h2><i class="bi bi-paperclip"></i> Files and source</h2></div>
              @if (row.files?.length) {
                <ul class="ad-files">
                  @for (file of row.files; track file.id) {
                    <li>
                      <i class="bi" [class.bi-file-earmark-pdf]="file.type === 'application/pdf'" [class.bi-file-earmark-image]="file.type.startsWith('image/')" [class.bi-file-earmark-word]="file.type.includes('word')"></i>
                      <span><strong>{{ file.name }}</strong><small>{{ size(file.size) }}</small></span>
                      <button type="button" class="btn btn-ghost btn-sm" (click)="openFile(file.id, file.name)">Open</button>
                    </li>
                  }
                </ul>
              }
              @if (row.tracking?.length) {
                <dl class="kv ad-answers">
                  @for (item of row.tracking; track item.label) { <div><dt>{{ item.label }}</dt><dd>{{ item.value }}</dd></div> }
                </dl>
              }
            </section>
          }
        </div>

        <aside class="ad-side">
          <section class="card">
            <h2 class="ad-side-h"><i class="bi bi-pencil-square"></i> Review</h2>
            <form (ngSubmit)="save()">
              <label for="ad-status">Status</label>
              <select id="ad-status" name="status" [(ngModel)]="draftStatus">
                @for (status of statuses; track status.key) { <option [value]="status.key">{{ status.label }}</option> }
              </select>
              <label for="ad-note">Note for HR</label>
              <textarea id="ad-note" name="note" rows="3" maxlength="1000" [(ngModel)]="draftNote" placeholder="Called on Monday, interview on Thursday"></textarea>
              <div class="actions ad-save">
                <button type="submit" class="btn btn-primary" [disabled]="saving || !changed()"><i class="bi bi-check2"></i> {{ saving ? 'Saving…' : 'Save' }}</button>
                @if (row.status !== 'shortlisted' && row.status !== 'hired') { <button type="button" class="btn btn-ghost" [disabled]="saving" (click)="quick('shortlisted')"><i class="bi bi-star"></i> Shortlist</button> }
                @if (row.status !== 'rejected') { <button type="button" class="btn btn-ghost btn-danger" [disabled]="saving" (click)="quick('rejected')"><i class="bi bi-x-circle"></i> Reject</button> }
              </div>
            </form>
            @if (row.status === 'hired' && canAddPeople && !row.repeat.employees.length) {
              <div class="actions ad-save"><a class="btn btn-gold" routerLink="/people/new" [queryParams]="{ application: row.id }"><i class="bi bi-person-plus"></i> Add as employee</a></div>
              <p class="muted ad-fine">Opens Add a person with the name, contact and role filled. Nothing is saved until you save it there.</p>
            } @else {
              <p class="muted ad-fine">Hired people are not added to People automatically. Mark the application hired to add them from here.</p>
            }
          </section>

          <section class="card">
            <h2 class="ad-side-h"><i class="bi bi-person-lines-fill"></i> Contact</h2>
            <dl class="ad-kv">
              <div><dt>Email</dt><dd>@if (row.email) { <a [href]="'mailto:' + row.email">{{ row.email }}</a> } @else { — }</dd></div>
              <div><dt>Mobile</dt><dd>@if (row.phone) { <a [href]="'tel:' + row.phone">{{ row.phone }}</a> } @else { — }</dd></div>
              <div><dt>City</dt><dd>{{ row.city || '—' }}</dd></div>
              <div><dt>Source</dt><dd>{{ row.portal }}</dd></div>
              <div><dt>Received</dt><dd>{{ when(row.createdAt) }}</dd></div>
              @if (row.decidedAt) { <div><dt>Decided</dt><dd>{{ when(row.decidedAt) }}</dd></div> }
            </dl>
          </section>

          <section class="card">
            <h2 class="ad-side-h"><i class="bi bi-people"></i> Seen before</h2>
            @if (!row.repeat.applications.length && !row.repeat.employees.length) {
              <p class="muted">First time. No other application or employee record has this email or mobile number.</p>
            }
            @if (row.repeat.applications.length) {
              <ul class="ad-seen">
                @for (item of row.repeat.applications; track item.id) {
                  <li>
                    <a [routerLink]="'/hiring/applications/' + item.id">
                      <strong>{{ item.jobTitle }}</strong>
                      <small class="muted">{{ when(item.createdAt) }} · matched on {{ item.on.join(', ') }}</small>
                    </a>
                    <span [class]="'pill ' + tone(item.status)">{{ item.statusLabel }}</span>
                  </li>
                }
              </ul>
            }
            @if (onlyName(row)) { <p class="muted ad-fine">Matches on name alone may be a different person with the same name.</p> }
            <p class="muted ad-fine">Reapply gap: @if (row.rules.rejectDays || row.rules.exitDays) { {{ row.rules.rejectDays }} days after a rejection, {{ row.rules.exitDays }} days after leaving. } @else { not set. } <a routerLink="/hiring/applications">Change on Applications</a></p>
          </section>

          <section class="card">
            <h2 class="ad-side-h"><i class="bi bi-clock-history"></i> Applicant history</h2>
            <ol class="ad-history">
              @for (item of row.history; track $index) {
                <li [class.is-other]="!item.current && item.applicationId">
                  <span class="ad-dot"><i class="bi" [class]="historyIcon(item.kind)"></i></span>
                  <div>
                    <strong>{{ item.detail }}</strong>
                    <small class="muted">{{ when(item.at) }}@if (item.by) { · {{ item.by }} }@if (!item.current && item.job) { · {{ item.job }} }</small>
                  </div>
                </li>
              }
            </ol>
          </section>
        </aside>
      </div>

      <app-modal [open]="resumeOpen" size="xl" icon="bi-file-earmark-text" title="Resume text" [subtitle]="row.name + ' · ' + (row.jobTitle || 'General form')" (closed)="resumeOpen = false">
        <p class="muted ad-modal-hint">Open the resume, select all the text, copy it and paste it here. The file itself is not stored. Only this text is kept, for HR.</p>
        <textarea class="ad-paste" rows="16" maxlength="20000" [(ngModel)]="draftResume" aria-label="Resume text" placeholder="Paste the resume text here"></textarea>
        <small class="muted">{{ draftResume.length.toLocaleString('en-IN') }} / 20,000 characters</small>
        <footer modalFooter class="md-foot">
          @if (resumeLink(row)) { <a class="btn btn-ghost md-foot-note" [href]="resumeLink(row)" target="_blank" rel="noopener noreferrer"><i class="bi bi-box-arrow-up-right"></i> Open resume link</a> }
          <button type="button" class="btn btn-ghost" (click)="resumeOpen = false">Cancel</button>
          <button type="button" class="btn btn-primary" [disabled]="saving || draftResume.trim() === row.resumeText" (click)="saveResume()"><i class="bi bi-check2"></i> {{ saving ? 'Saving…' : 'Save and score' }}</button>
        </footer>
      </app-modal>
    } @else if (!error) {
      <p class="muted">Loading the application…</p>
    }
  `,
})
export class ApplicationComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly sweet = inject(Sweet);
  private readonly destroyRef = inject(DestroyRef);
  readonly canAddPeople = !!inject(SessionStore).me?.access?.includes('people.edit');
  readonly statuses = APPLICATION_STATUSES;
  row: Detail | null = null;
  error = '';
  draftStatus = 'new';
  draftNote = '';
  draftResume = '';
  resumeOpen = false;
  saving = false;

  ngOnInit(): void {
    const sub = this.route.paramMap.subscribe((params) => void this.load(params.get('id') || ''));
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }

  async openFile(fileId: string, name: string): Promise<void> {
    if (!this.row) return;
    try {
      const blob = await this.api.blob('/v1/hiring/applications/' + this.row.id + '/files/' + fileId);
      await this.sweet.preview({ title: name, subtitle: this.row.name, blob, fileName: name });
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not open that file.';
    }
  }

  size(bytes: number): string {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  changed(): boolean {
    return !!this.row && (this.draftStatus !== this.row.status || this.draftNote.trim() !== (this.row.note || ''));
  }

  async save(): Promise<void> {
    if (!this.row || !this.changed()) return;
    const body: { status?: string; note?: string } = {};
    if (this.draftStatus !== this.row.status) body.status = this.draftStatus;
    if (this.draftNote.trim() !== (this.row.note || '')) body.note = this.draftNote.trim();
    if (body.status === 'rejected' && !(await this.confirmReject())) return;
    await this.patch(body, 'Saved');
  }

  async quick(status: string): Promise<void> {
    if (!this.row) return;
    if (status === 'rejected' && !(await this.confirmReject())) return;
    const body: { status: string; note?: string } = { status };
    if (this.draftNote.trim() !== (this.row.note || '')) body.note = this.draftNote.trim();
    await this.patch(body, status === 'rejected' ? 'Marked rejected' : 'Shortlisted');
  }

  openResume(): void {
    this.draftResume = this.row?.resumeText || '';
    this.resumeOpen = true;
  }

  async saveResume(): Promise<void> {
    if (!this.row) return;
    const ok = await this.patch({ resumeText: this.draftResume.trim() }, '');
    if (!ok || !this.row) return;
    this.resumeOpen = false;
    const score = this.row.match.score;
    this.sweet.success({
      title: score === null ? 'Resume text saved' : 'Match ' + score + '%',
      text: score === null ? this.row.match.reason : verdictText(score) + ' against ' + (this.row.jobTitle || 'the job') + '.',
      rows: this.row.match.components.map((part) => ({ label: part.label, value: part.value + '%' })),
    });
  }

  statusLabel(key: string): string {
    return APPLICATION_STATUSES.find((item) => item.key === key)?.label || key;
  }

  tone(key: string): string {
    if (key === 'hired' || key === 'shortlisted') return 'ok';
    if (key === 'rejected') return 'bad';
    if (key === 'cooling') return 'info';
    return 'warn';
  }

  band(value: number): string {
    return value >= 70 ? 'ok' : value >= 45 ? 'warn' : 'bad';
  }

  verdict(score: number): string {
    return scoreLabel(score).split(' · ')[0] + ' match';
  }

  pointIcon(status: string): string {
    return status === 'met' ? 'bi-check-circle-fill' : status === 'partly' ? 'bi-circle-half' : status === 'missing' ? 'bi-x-circle' : 'bi-dash-circle';
  }

  historyIcon(kind: string): string {
    return HISTORY_ICON[kind] || 'bi-dot';
  }

  repeatSummary(row: Detail): string {
    const rejected = row.repeat.applications.filter((item) => item.status === 'rejected').length;
    const jobs = [...new Set(row.repeat.applications.map((item) => item.jobTitle))].slice(0, 3).join(', ');
    return 'Also applied for ' + jobs + (rejected ? '. Rejected ' + rejected + (rejected === 1 ? ' time' : ' times') + ' before' : '') + '.';
  }

  onlyName(row: Detail): boolean {
    return row.repeat.applications.some((item) => item.on.length === 1 && item.on[0] === 'name')
      || row.repeat.employees.some((item) => item.on.length === 1 && item.on[0] === 'name');
  }

  initials(name: string): string {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  }

  when(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  }

  day(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return value || '—';
    return new Date(value + 'T12:00:00+05:30').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' });
  }

  resumeLink(row: Detail): string {
    return /^https?:\/\//i.test(row.resumeUrl || '') ? row.resumeUrl : '';
  }

  private async confirmReject(): Promise<boolean> {
    const days = this.row?.rules.rejectDays || 0;
    return this.sweet.confirm({
      title: 'Reject ' + (this.row?.name || 'this applicant') + '?',
      text: days ? 'They will not be considered again for ' + days + ' days. A new application in that gap is marked Cooling period.' : 'There is no reapply gap set, so they can apply again at any time.',
      confirmText: 'Reject',
      danger: true,
    });
  }

  private async patch(body: Record<string, unknown>, done: string): Promise<boolean> {
    if (!this.row) return false;
    this.saving = true;
    try {
      await this.api.patch('/v1/hiring/applications/' + this.row.id, body);
      await this.load(this.row.id);
      if (done) this.sweet.success({ title: done, text: done === 'Saved' || !this.row ? 'Your changes are saved.' : this.row.name + ' is now ' + this.statusLabel(this.row.status).toLowerCase() + '.' });
      return true;
    } catch (error) {
      this.sweet.error({ title: 'Not saved', text: error instanceof Error ? error.message : 'Try again.' });
      return false;
    } finally {
      this.saving = false;
    }
  }

  private async load(id: string): Promise<void> {
    if (!id) return;
    this.error = '';
    try {
      this.row = await this.api.get<Detail>('/v1/hiring/applications/' + encodeURIComponent(id));
      this.draftStatus = this.row.status;
      this.draftNote = this.row.note || '';
    } catch (error) {
      this.row = null;
      this.error = error instanceof Error ? error.message : 'Could not load that application.';
    }
  }
}

function verdictText(score: number): string {
  return score >= 70 ? 'A strong match' : score >= 45 ? 'A fair match' : 'A low match';
}
