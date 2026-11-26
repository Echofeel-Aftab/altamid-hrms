import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Sweet } from '../shared/sweet';

interface Policy {
  probationMonths: number;
  noticeDays: number;
  prorateLeave: boolean;
  compOffFullHours: number;
  compOffHalfHours: number;
  holidayWorkEarnsCompOff: boolean;
  holidayWorkCompOffDays: number;
  holidayWorkPayMultiplier: number;
  autoExit: boolean;
  monthlyAccrual: boolean;
  reminders: {
    probation: boolean; approvals: boolean; approvalHours: number; checkout: boolean; warranty: boolean; celebrations: boolean;
    hiringSla: boolean; hiringSlaDays: number; latePunch: boolean;
  };
}

interface OnboardingPack {
  templates: Array<{ id: string; name: string; roles: string[]; departments: string[]; tasks: string[] }>;
  starter: string[];
  roles: Array<{ id: string; name: string }>;
  departments: string[];
}

interface ChecklistDraft { id: string; name: string; roles: string[]; departments: string[]; tasks: string }

interface RunSummary {
  day: string;
  manual: boolean;
  exits: number;
  probation: number;
  approvals: number;
  checkout: number;
  warranty: number;
  emails: number;
  accrual?: number;
  hiring?: number;
  latePunch?: number;
  notes: string[];
}

interface AutomationView {
  policy: Policy;
  runs: Array<{ at: string; manual: boolean; summary: RunSummary | null }>;
}

interface LeaveType {
  id: string;
  name: string;
  code: string;
  paid: boolean;
  daysPerYear: number;
  active: boolean;
  carryForwardMax: number;
  maxInRow: number;
  noticeDays: number;
  afterProbation: boolean;
  compOff: boolean;
  requests: number;
}

interface HiringRules {
  rejectDays: number;
  exitDays: number;
  tellApplicant: boolean;
  message: string;
  emailAuto: boolean;
  mailbox: boolean;
}

const blankType = (): LeaveType => ({
  id: '',
  name: '',
  code: '',
  paid: true,
  daysPerYear: 12,
  active: true,
  carryForwardMax: 0,
  maxInRow: 0,
  noticeDays: 0,
  afterProbation: false,
  compOff: false,
  requests: 0,
});

@Component({
  selector: 'app-settings-rules',
  imports: [FormsModule],
  template: `
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    @if (policy) {
      <div class="att-stack">
        <p class="field-hint">People defaults and daily jobs share one save. Leave types and hiring gaps save on their own cards. Who approves each request is under <strong>Settings → Approvals</strong>.</p>
        <form class="settings-card" (ngSubmit)="savePolicy()">
          <header class="settings-card-head">
            <span class="settings-icon"><i class="bi bi-person-check"></i></span>
            <div>
              <h2>People rules &amp; daily automation</h2>
              <p>Defaults when someone joins or resigns, plus the once-a-day jobs. Each person's dates can still be changed on their profile.</p>
            </div>
          </header>
          <div class="settings-card-body">
            <h3 class="rule-sub">People defaults</h3>
            <div class="field-grid">
              <div>
                <label for="rule-probation">Probation (months)</label>
                <input id="rule-probation" name="probationMonths" type="number" min="0" max="24" [(ngModel)]="policy.probationMonths">
                <p class="field-hint">0 means new joiners start confirmed.</p>
              </div>
              <div>
                <label for="rule-notice">Notice period (days)</label>
                <input id="rule-notice" name="noticeDays" type="number" min="0" max="180" [(ngModel)]="policy.noticeDays">
                <p class="field-hint">Suggested last day when someone resigns.</p>
              </div>
              <div>
                <label for="rule-full">Comp-off: hours for a full day</label>
                <input id="rule-full" name="compOffFullHours" type="number" min="1" max="12" [(ngModel)]="policy.compOffFullHours">
              </div>
              <div>
                <label for="rule-half">Comp-off: hours for a half day</label>
                <input id="rule-half" name="compOffHalfHours" type="number" min="1" max="12" [(ngModel)]="policy.compOffHalfHours">
              </div>
            </div>
            <h3 class="rule-sub">Holiday work</h3>
            <label class="check">
              <input type="checkbox" name="holidayWorkEarnsCompOff" [(ngModel)]="policy.holidayWorkEarnsCompOff">
              <span><strong>Holiday work earns comp-off</strong><small>Approved extra time on a company holiday credits fixed comp-off days instead of the hour thresholds above.</small></span>
            </label>
            <div class="field-grid">
              <div>
                <label for="rule-hol-days">Comp-off days per holiday worked</label>
                <select id="rule-hol-days" name="holidayWorkCompOffDays" [(ngModel)]="policy.holidayWorkCompOffDays">
                  <option [ngValue]="0.5">Half day (0.5)</option>
                  <option [ngValue]="1">Full day (1)</option>
                </select>
              </div>
              <div>
                <label for="rule-hol-pay">Holiday pay multiplier (payroll hint)</label>
                <select id="rule-hol-pay" name="holidayWorkPayMultiplier" [(ngModel)]="policy.holidayWorkPayMultiplier">
                  <option [ngValue]="1">1× (normal)</option>
                  <option [ngValue]="1.5">1.5×</option>
                  <option [ngValue]="2">2× (double)</option>
                </select>
                <p class="field-hint">Shown on the payroll month as a reminder. Slips stay manual.</p>
              </div>
            </div>
            <label class="check">
              <input type="checkbox" name="prorateLeave" [(ngModel)]="policy.prorateLeave">
              <span><strong>Pro-rate leave in the joining year</strong><small>Someone joining in July gets about half the yearly quota. Joining on or before the 15th counts that month.</small></span>
            </label>
            <label class="check">
              <input type="checkbox" name="monthlyAccrual" [(ngModel)]="policy.monthlyAccrual">
              <span><strong>Earn leave month by month</strong><small>Off: the whole year's quota is available from January. On: each month adds one twelfth, and people are told when it lands. Balances are worked out from this rule, so switching it off restores the full year.</small></span>
            </label>
            <h3 class="rule-sub">Daily jobs</h3>
            <p class="muted small">Reminders appear under notifications. Emails go only for templates set to send automatically under Templates + Email.</p>
            <div class="rule-checks">
              <label class="check">
                <input type="checkbox" name="autoExit" [(ngModel)]="policy.autoExit">
                <span><strong>Close employment after the last day</strong><small>Marks the person exited, turns off their sign-in and tells HR about assets still issued.</small></span>
              </label>
              <label class="check">
                <input type="checkbox" name="rProbation" [(ngModel)]="policy.reminders.probation">
                <span><strong>Probation ending</strong><small>Tells the manager and HR 15 days before, and again if it has passed without confirmation.</small></span>
              </label>
              <label class="check">
                <input type="checkbox" name="rApprovals" [(ngModel)]="policy.reminders.approvals">
                <span><strong>Requests waiting for approval</strong><small>Reminds the approver, then the manager's manager after twice the wait. Flow steps come from Approvals.</small></span>
              </label>
              @if (policy.reminders.approvals) {
                <div class="rule-inline">
                  <label for="rule-hours">Remind after (hours)</label>
                  <input id="rule-hours" name="approvalHours" type="number" min="4" max="720" [(ngModel)]="policy.reminders.approvalHours">
                </div>
              }
              <label class="check">
                <input type="checkbox" name="rCheckout" [(ngModel)]="policy.reminders.checkout">
                <span><strong>Missed check-out</strong><small>Asks the person to request a correction for yesterday.</small></span>
              </label>
              <label class="check">
                <input type="checkbox" name="rLatePunch" [(ngModel)]="policy.reminders.latePunch">
                <span><strong>Missed and late punches, last three working days</strong><small>Tells each person about their own days, their manager once a day, and anyone with company-wide Exceptions. Days with leave, on duty, work from home or a regularization are skipped.</small></span>
              </label>
              <label class="check">
                <input type="checkbox" name="rHiringSla" [(ngModel)]="policy.reminders.hiringSla">
                <span><strong>Applications waiting too long</strong><small>A weekly nudge to people with Hiring when a new or reviewing application has not moved.</small></span>
              </label>
              @if (policy.reminders.hiringSla) {
                <div class="rule-inline">
                  <label for="rule-sla">Nudge after (days)</label>
                  <input id="rule-sla" name="hiringSlaDays" type="number" min="1" max="90" [(ngModel)]="policy.reminders.hiringSlaDays">
                </div>
              }
              <label class="check">
                <input type="checkbox" name="rWarranty" [(ngModel)]="policy.reminders.warranty">
                <span><strong>Asset warranty ending</strong><small>30 days before the warranty ends.</small></span>
              </label>
              <label class="check">
                <input type="checkbox" name="rCelebrations" [(ngModel)]="policy.reminders.celebrations">
                <span><strong>Birthday and work anniversary emails</strong><small>Sent only if those templates are set to send automatically and email is set up.</small></span>
              </label>
            </div>
            <div class="settings-inline-save">
              <button class="btn btn-ghost" type="button" (click)="runNow()" [disabled]="busy"><i class="bi bi-play-circle"></i> Run now</button>
              <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> Save people &amp; automation</button>
            </div>
            <h3 class="rule-sub">Recent runs</h3>
            @if (runs.length) {
              <ul class="rule-runs">
                @for (run of runs; track run.at) {
                  <li>
                    <strong>{{ when(run.at) }}</strong>
                    <span class="chip">{{ run.manual ? 'Run by hand' : 'Daily' }}</span>
                    <small>{{ describe(run.summary) }}</small>
                  </li>
                }
              </ul>
            } @else {
              <p class="muted">No runs yet. The first runs about a minute after the server starts.</p>
            }
          </div>
        </form>

        @if (hiring) {
          <form class="settings-card" (ngSubmit)="saveHiring()">
            <header class="settings-card-head">
              <span class="settings-icon"><i class="bi bi-briefcase"></i></span>
              <div>
                <h2>Hiring re-apply rules</h2>
                <p>How long before someone can apply again after a rejection or after leaving the company. The cooling email template is under Templates.</p>
              </div>
            </header>
            <div class="settings-card-body">
              <div class="field-grid">
                <div>
                  <label for="hire-reject">Gap after a rejection (days)</label>
                  <input id="hire-reject" name="rejectDays" type="number" min="0" max="1095" [(ngModel)]="hiring.rejectDays">
                  <p class="field-hint">0 means no gap.</p>
                </div>
                <div>
                  <label for="hire-exit">Gap after someone leaves (days)</label>
                  <input id="hire-exit" name="exitDays" type="number" min="0" max="1095" [(ngModel)]="hiring.exitDays">
                </div>
              </div>
              <label class="check">
                <input type="checkbox" name="tellApplicant" [(ngModel)]="hiring.tellApplicant">
                <span><strong>Show the cooling reply on the public form</strong><small>Also emails them when the cooling template and SMTP are ready. Mailbox: {{ hiring.mailbox ? 'ready' : 'not set' }} · Auto email: {{ hiring.emailAuto ? 'on' : 'off' }}</small></span>
              </label>
              <div>
                <label for="hire-msg">Message (keep {{ '{{date}}' }})</label>
                <textarea id="hire-msg" name="message" rows="3" [(ngModel)]="hiring.message"></textarea>
              </div>
              <div class="settings-inline-save">
                <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> Save hiring rules</button>
              </div>
            </div>
          </form>
        }

        @if (onboarding) {
          <form class="settings-card" (ngSubmit)="saveOnboarding()">
            <header class="settings-card-head">
              <span class="settings-icon"><i class="bi bi-list-check"></i></span>
              <div>
                <h2>Onboarding checklists</h2>
                <p>The tasks a new joiner starts with. The best match by role and department is used; with no match, the standard five tasks are used. Existing checklists are not changed.</p>
              </div>
            </header>
            <div class="settings-card-body">
              <p class="muted small">Standard tasks: {{ onboarding.starter.join(' · ') }}.</p>
              @for (item of checklists; track $index) {
                <fieldset class="rule-editor">
                  <div class="field-grid">
                    <div>
                      <label [for]="'ob-name-' + $index">Checklist name</label>
                      <input [id]="'ob-name-' + $index" [name]="'obName' + $index" [(ngModel)]="item.name" maxlength="60" placeholder="Sales joiners">
                    </div>
                    <div>
                      <label [for]="'ob-roles-' + $index">Roles (none means any)</label>
                      <select [id]="'ob-roles-' + $index" [name]="'obRoles' + $index" multiple [(ngModel)]="item.roles">
                        @for (role of onboarding.roles; track role.id) { <option [value]="role.id">{{ role.name }}</option> }
                      </select>
                    </div>
                    <div>
                      <label [for]="'ob-depts-' + $index">Departments (none means any)</label>
                      <select [id]="'ob-depts-' + $index" [name]="'obDepts' + $index" multiple [(ngModel)]="item.departments">
                        @for (name of onboarding.departments; track name) { <option [value]="name">{{ name }}</option> }
                      </select>
                    </div>
                  </div>
                  <label [for]="'ob-tasks-' + $index">Tasks, one per line</label>
                  <textarea [id]="'ob-tasks-' + $index" [name]="'obTasks' + $index" rows="5" [(ngModel)]="item.tasks" placeholder="Collect identity and bank details"></textarea>
                  <div class="settings-inline-save">
                    <button type="button" class="btn btn-ghost btn-danger" (click)="checklists.splice($index, 1)"><i class="bi bi-trash"></i> Remove checklist</button>
                  </div>
                </fieldset>
              }
              <div class="settings-inline-save">
                <button type="button" class="btn btn-ghost" (click)="addChecklist()" [disabled]="checklists.length >= 12"><i class="bi bi-plus-lg"></i> Add a checklist</button>
                <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> Save checklists</button>
              </div>
            </div>
          </form>
        }

        <section class="settings-card">
          <header class="settings-card-head">
            <span class="settings-icon"><i class="bi bi-calendar2-heart"></i></span>
            <div>
              <h2>Leave types</h2>
              <p>The server checks these rules when someone applies and again when a request is approved.</p>
            </div>
          </header>
          <div class="settings-card-body">
            @if (packMissing.length) {
              <p class="muted">Missing from the common pack: {{ packMissing.join(', ') }}.</p>
              <div class="settings-inline-save" style="margin-bottom: 12px">
                <button type="button" class="btn btn-secondary" (click)="addPack()" [disabled]="busy">
                  <i class="bi bi-collection"></i> Add missing leave types
                </button>
              </div>
            }
            <div class="rule-types">
              @for (item of types; track item.id) {
                <button type="button" class="rule-type" [class.is-active]="draft.id === item.id" [class.is-off]="!item.active" (click)="edit(item)">
                  <span class="rule-code">{{ item.code }}</span>
                  <span>
                    <strong>{{ item.name }}</strong>
                    <small>{{ summary(item) }}</small>
                  </span>
                </button>
              }
              <button type="button" class="rule-type rule-add" [class.is-active]="!draft.id" (click)="edit(null)">
                <span class="rule-code"><i class="bi bi-plus-lg"></i></span>
                <span><strong>New leave type</strong><small>Add a type such as maternity or comp-off</small></span>
              </button>
            </div>
            <form class="rule-editor" (ngSubmit)="saveType()">
              <h3 class="rule-sub">{{ draft.id ? 'Edit ' + draft.name : 'New leave type' }}</h3>
              <div class="field-grid">
                <div><label for="lt-name">Name</label><input id="lt-name" name="name" [(ngModel)]="draft.name" maxlength="40" placeholder="Casual leave"></div>
                <div><label for="lt-code">Code</label><input id="lt-code" name="code" [(ngModel)]="draft.code" maxlength="6" placeholder="CL" (ngModelChange)="draft.code = $event.toUpperCase()"></div>
                @if (!draft.compOff) {
                  <div>
                    <label for="lt-days">Days a year</label>
                    <input id="lt-days" name="daysPerYear" type="number" min="0" max="60" [(ngModel)]="draft.daysPerYear">
                    <p class="field-hint">0 means no limit, such as unpaid leave.</p>
                  </div>
                  <div>
                    <label for="lt-carry">Carry forward up to (days)</label>
                    <input id="lt-carry" name="carryForwardMax" type="number" min="0" max="60" [(ngModel)]="draft.carryForwardMax">
                    <p class="field-hint">Unused days moved into next year.</p>
                  </div>
                }
                <div>
                  <label for="lt-row">Most days in one request</label>
                  <input id="lt-row" name="maxInRow" type="number" min="0" max="60" [(ngModel)]="draft.maxInRow">
                  <p class="field-hint">0 means no limit.</p>
                </div>
                <div>
                  <label for="lt-notice">Apply at least (days ahead)</label>
                  <input id="lt-notice" name="noticeDays" type="number" min="0" max="90" [(ngModel)]="draft.noticeDays">
                  <p class="field-hint">0 allows same-day requests.</p>
                </div>
              </div>
              <div class="rule-checks">
                <label class="check"><input type="checkbox" name="paid" [(ngModel)]="draft.paid"><span><strong>Paid leave</strong><small>Off counts the days as loss of pay in the payroll month.</small></span></label>
                <label class="check"><input type="checkbox" name="afterProbation" [(ngModel)]="draft.afterProbation"><span><strong>Only after probation</strong><small>People on probation cannot apply for this type.</small></span></label>
                <label class="check"><input type="checkbox" name="compOff" [(ngModel)]="draft.compOff"><span><strong>Comp-off</strong><small>Days are earned from approved extra-time requests, {{ policy.compOffFullHours }} hours for a full day and {{ policy.compOffHalfHours }} for a half day.</small></span></label>
                <label class="check"><input type="checkbox" name="active" [(ngModel)]="draft.active"><span><strong>Active</strong><small>Off hides it from new requests. Past requests stay.</small></span></label>
              </div>
              <div class="settings-inline-save">
                @if (draft.id) { <button class="btn btn-ghost" type="button" (click)="edit(null)">Cancel</button> }
                <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> {{ draft.id ? 'Save leave type' : 'Add leave type' }}</button>
              </div>
            </form>
          </div>
        </section>
      </div>
    }
  `,
})
export class SettingsRulesComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  policy: Policy | null = null;
  hiring: HiringRules | null = null;
  onboarding: OnboardingPack | null = null;
  checklists: ChecklistDraft[] = [];
  runs: AutomationView['runs'] = [];
  types: LeaveType[] = [];
  packMissing: string[] = [];
  draft: LeaveType = blankType();
  error = '';
  ok = '';
  busy = false;

  async ngOnInit(): Promise<void> {
    try {
      const [view, leave, hiring, onboarding] = await Promise.all([
        this.api.get<AutomationView>('/v1/automation'),
        this.api.get<{ items: LeaveType[]; packMissing?: string[] }>('/v1/leave/types'),
        this.api.get<HiringRules>('/v1/hiring/rules').catch(() => null),
        this.api.get<OnboardingPack>('/v1/onboarding/templates').catch(() => null),
      ]);
      this.apply(view);
      this.types = leave.items;
      this.packMissing = leave.packMissing || [];
      this.hiring = hiring;
      this.applyOnboarding(onboarding);
    } catch (error) {
      this.error = this.message(error);
    }
  }

  async addPack(): Promise<void> {
    await this.act(async () => {
      const result = await this.api.post<{ items: LeaveType[]; packMissing?: string[] }>('/v1/leave/types/pack', {});
      this.types = result.items;
      this.packMissing = result.packMissing || [];
      this.ok = this.packMissing.length ? 'Some leave types were added.' : 'Common leave types are ready (comp-off, maternity, paternity, bereavement, optional).';
    });
  }

  edit(item: LeaveType | null): void {
    this.draft = item ? { ...item } : blankType();
    this.ok = '';
    this.error = '';
  }

  summary(item: LeaveType): string {
    const parts = [item.compOff ? 'Earned from extra time' : item.daysPerYear ? `${item.daysPerYear} days a year` : 'No yearly limit'];
    if (item.carryForwardMax) parts.push(`carry ${item.carryForwardMax}`);
    if (item.maxInRow) parts.push(`max ${item.maxInRow} in a row`);
    if (item.noticeDays) parts.push(`${item.noticeDays} days notice`);
    if (item.afterProbation) parts.push('after probation');
    if (!item.paid) parts.push('unpaid');
    if (!item.active) parts.push('off');
    return parts.join(' · ');
  }

  when(value: string): string {
    return new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  describe(summary: RunSummary | null): string {
    if (!summary) return 'Running or no detail saved.';
    const parts: string[] = [];
    if (summary.exits) parts.push(`${summary.exits} employment(s) closed`);
    if (summary.probation) parts.push(`${summary.probation} probation reminder(s)`);
    if (summary.approvals) parts.push(`${summary.approvals} approval reminder(s)`);
    if (summary.checkout) parts.push(`${summary.checkout} missed check-out(s)`);
    if (summary.warranty) parts.push(`${summary.warranty} warranty alert(s)`);
    if (summary.accrual) parts.push(`${summary.accrual} told about this month's leave credit`);
    if (summary.hiring) parts.push(`${summary.hiring} application(s) waiting too long`);
    if (summary.latePunch) parts.push(`${summary.latePunch} missed or late punch(es)`);
    if (summary.emails) parts.push(`${summary.emails} email(s)`);
    const text = parts.length ? parts.join(', ') : 'Nothing needed attention';
    return summary.notes?.length ? `${text}. ${summary.notes.join(' ')}` : text + '.';
  }

  async savePolicy(): Promise<void> {
    if (!this.policy) return;
    await this.act(async () => {
      this.apply(await this.api.post<AutomationView>('/v1/automation/policy', this.policy));
      this.ok = 'People rules and automation saved.';
    });
  }

  addChecklist(): void {
    this.checklists.push({ id: '', name: '', roles: [], departments: [], tasks: this.onboarding?.starter.join('\n') || '' });
  }

  async saveOnboarding(): Promise<void> {
    await this.act(async () => {
      const result = await this.api.post<OnboardingPack>('/v1/onboarding/templates', {
        templates: this.checklists.map((item) => ({
          id: item.id || undefined,
          name: item.name.trim(),
          roles: item.roles,
          departments: item.departments,
          tasks: item.tasks.split('\n').map((task) => task.trim()).filter(Boolean),
        })),
      });
      this.applyOnboarding(result);
      this.ok = 'Onboarding checklists saved. New joiners get the best match.';
    });
  }

  async saveHiring(): Promise<void> {
    if (!this.hiring) return;
    await this.act(async () => {
      this.hiring = await this.api.post<HiringRules>('/v1/hiring/rules', {
        rejectDays: Number(this.hiring!.rejectDays) || 0,
        exitDays: Number(this.hiring!.exitDays) || 0,
        tellApplicant: this.hiring!.tellApplicant,
        message: this.hiring!.message,
      });
      this.ok = 'Hiring re-apply rules saved.';
    });
  }

  async runNow(): Promise<void> {
    const go = await this.sweet.confirm({
      title: 'Run the daily jobs now?',
      text: 'Closes employment for anyone past their last day and sends the reminders that are on. Reminders already sent today are not repeated.',
      confirmText: 'Run now',
    });
    if (!go) return;
    await this.act(async () => {
      const result = await this.api.post<AutomationView & { summary: RunSummary }>('/v1/automation/run', {});
      this.apply(result);
      this.ok = 'Done. ' + this.describe(result.summary);
    });
  }

  async saveType(): Promise<void> {
    const draft = this.draft;
    await this.act(async () => {
      const body = {
        id: draft.id || undefined,
        name: draft.name.trim(),
        code: draft.code.trim(),
        paid: draft.paid,
        daysPerYear: Number(draft.daysPerYear) || 0,
        active: draft.active,
        carryForwardMax: Number(draft.carryForwardMax) || 0,
        maxInRow: Number(draft.maxInRow) || 0,
        noticeDays: Number(draft.noticeDays) || 0,
        afterProbation: draft.afterProbation,
        compOff: draft.compOff,
      };
      const result = await this.api.post<{ items: LeaveType[]; packMissing?: string[] }>('/v1/leave/types', body);
      this.types = result.items;
      this.packMissing = result.packMissing || [];
      const saved = this.types.find((item) => item.code === body.code);
      this.draft = saved ? { ...saved } : blankType();
      this.ok = `${body.name} saved.`;
    });
  }

  private applyOnboarding(pack: OnboardingPack | null): void {
    this.onboarding = pack;
    this.checklists = (pack?.templates || []).map((item) => ({ id: item.id, name: item.name, roles: [...item.roles], departments: [...item.departments], tasks: item.tasks.join('\n') }));
  }

  private apply(view: AutomationView): void {
    const policy = view.policy;
    this.policy = {
      ...policy,
      holidayWorkEarnsCompOff: policy.holidayWorkEarnsCompOff !== false,
      holidayWorkCompOffDays: policy.holidayWorkCompOffDays === 0.5 ? 0.5 : 1,
      holidayWorkPayMultiplier: [1, 1.5, 2].includes(Number(policy.holidayWorkPayMultiplier)) ? Number(policy.holidayWorkPayMultiplier) : 2,
      reminders: { ...policy.reminders },
    };
    this.runs = view.runs;
  }

  private async act(work: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      await work();
    } catch (error) {
      this.error = this.message(error);
    } finally {
      this.busy = false;
    }
  }

  private message(error: unknown): string {
    return error instanceof Error ? error.message : 'Try again.';
  }
}
