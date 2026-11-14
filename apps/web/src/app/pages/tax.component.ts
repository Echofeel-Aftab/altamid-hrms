import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { SessionStore } from '../core/session.store';
import { dayLabel, errorText, inr, readFile } from '../shared/kit';
import { ModalComponent } from '../shared/modal.component';
import { Sweet } from '../shared/sweet';
import { Toast } from '../shared/toast';

interface TaxItem { key: string; section: string; label: string; hint: string; group?: string; cap?: number; income?: boolean; paid?: boolean; both?: boolean; proof: boolean }
interface Line { label: string; amount: number; note?: string }
interface Regime {
  regime: 'old' | 'new';
  income: number; exemptions: Line[]; standard: number; deductions: Line[]; taxable: number;
  slabTax: number; rebate: number; surcharge: number; cess: number; total: number;
  slabs: Array<{ from: number; to: number | null; rate: number; tax: number }>;
  paidSoFar: number; earlier: number; left: number; monthly: number;
}
interface Estimate { old: Regime; new: Regime; better: 'old' | 'new'; saving: number; monthsLeft: number; summary: string }
interface Rent { monthly: number; months: number; metro: boolean; landlord: string; landlordPan: string; city: string }
interface Proof { id: string; item: string; fileName: string; mime: string; size: number; status: string; at: string }
interface Sheet {
  year: string;
  years: string[];
  window: { declare: boolean; proofs: boolean; note: string; closesOn: string };
  desk: boolean;
  person: { id: string; name: string; code: string; department: string; designation: string; age: number; regimeOnFile: string };
  salary: { effectiveFrom: string; gross: number; basic: number; hra: number; lta: number; flexExempt: number } | null;
  items: TaxItem[];
  declaration: { exists: boolean; status: string; regime: 'old' | 'new'; note: string; values: Record<string, number>; approved: Record<string, number>; parentsSenior: boolean; rent: Rent; submittedAt: string; verifiedAt: string; verifiedBy: string };
  proofs: Proof[];
  estimate: Estimate;
}
interface DeskRow { employeeId: string; name: string; code: string; department: string; regime: string; status: string; declared: number; approved: number | null; proofs: number; pending: number; submittedAt: string }
interface Desk { year: string; years: string[]; window: Sheet['window']; counts: Record<string, number>; rows: DeskRow[] }

const STATUS: Record<string, { label: string; tone: string; icon: string }> = {
  none: { label: 'Not started', tone: '', icon: 'bi-circle' },
  draft: { label: 'Draft', tone: 'is-info', icon: 'bi-pencil' },
  submitted: { label: 'Waiting for payroll', tone: 'is-warn', icon: 'bi-hourglass-split' },
  returned: { label: 'Sent back', tone: 'is-bad', icon: 'bi-arrow-counterclockwise' },
  verified: { label: 'Approved', tone: 'is-ok', icon: 'bi-patch-check' },
};

@Component({
  selector: 'app-tax',
  imports: [FormsModule, ModalComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-calculator"></i></span>
        <p class="eyebrow">Pay</p>
        <h1>Tax and investments</h1>
        <p class="lede">Declare your tax-saving investments, add proofs, and see which regime costs you less. Payroll uses the approved figures to deduct tax each month.</p>
      </div>
      <div class="actions">
        <label class="sr-only" for="tax-year">Financial year</label>
        <select id="tax-year" [ngModel]="year" (ngModelChange)="changeYear($event)">
          @for (item of sheet?.years || []; track item) { <option [value]="item">FY {{ item }}</option> }
        </select>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    <div class="seg-mini mx-tabs" role="tablist">
      <button type="button" role="tab" [class.is-active]="tab === 'declare'" (click)="tab = 'declare'"><i class="bi bi-journal-check"></i> My declaration</button>
      <button type="button" role="tab" [class.is-active]="tab === 'simulate'" (click)="openSimulator()"><i class="bi bi-sliders"></i> Tax simulator</button>
      @if (canDesk) { <button type="button" role="tab" [class.is-active]="tab === 'desk'" (click)="openDesk()"><i class="bi bi-clipboard2-check"></i> Payroll desk</button> }
    </div>

    @if (tab === 'declare') {
      @if (!sheet) {
        <p class="muted">Loading your declaration…</p>
      } @else {
        <div class="mx-banner" [class]="'mx-banner ' + statusOf(sheet.declaration.status).tone">
          <i class="bi" [class]="statusOf(sheet.declaration.status).icon"></i>
          <div>
            <strong>{{ statusOf(sheet.declaration.status).label }}@if (sheet.declaration.status === 'verified' && sheet.declaration.verifiedBy) { by {{ sheet.declaration.verifiedBy }} on {{ day(sheet.declaration.verifiedAt) }} }</strong>
            <small>
              @if (sheet.declaration.status === 'returned') { {{ sheet.declaration.note || 'Payroll asked for a change.' }} }
              @else if (sheet.declaration.status === 'submitted') { Sent on {{ day(sheet.declaration.submittedAt) }}. You can still add proofs. }
              @else if (sheet.declaration.status === 'verified') { Tax is deducted on the approved amounts. }
              @else if (!sheet.window.declare) { The declaration window is closed. {{ sheet.window.note }} }
              @else { Fill in what you plan to invest this year. {{ sheet.window.closesOn ? 'The window closes on ' + day(sheet.window.closesOn) + '.' : '' }} {{ sheet.window.note }} }
            </small>
          </div>
        </div>
        @if (!sheet.salary) {
          <p class="mx-note"><i class="bi bi-info-circle"></i> Payroll has not published your CTC yet, so the estimate below starts from zero. Use the simulator to try figures.</p>
        }
        <section class="card">
          <div class="card-head"><h2><i class="bi bi-signpost-split"></i> Choose your tax regime</h2><span class="muted">{{ sheet.estimate.summary }}</span></div>
          <div class="mx-regimes">
            @for (key of regimeKeys; track key) {
              <label class="mx-regime" [class.is-on]="draft.regime === key" [class.is-best]="sheet.estimate.better === key">
                <input type="radio" name="regime" [value]="key" [(ngModel)]="draft.regime" [disabled]="locked">
                <span class="mx-regime-head"><strong>{{ key === 'new' ? 'New regime' : 'Old regime' }}</strong>@if (sheet.estimate.better === key) { <span class="chip is-ok"><i class="bi bi-stars"></i> Saves you more</span> }</span>
                <span class="mx-regime-total">{{ money(estimateOf(key).total) }}<small> tax for the year</small></span>
                <span class="mx-regime-meta">Taxable {{ money(estimateOf(key).taxable) }} · About {{ money(estimateOf(key).monthly) }} a month for {{ sheet.estimate.monthsLeft }} month(s)</span>
                <small class="muted">{{ key === 'new' ? 'Lower rates and a ₹75,000 standard deduction. Most deductions do not apply.' : 'HRA, 80C, 80D, home loan and the other deductions below apply.' }}</small>
              </label>
            }
          </div>
          @if (draft.regime === 'new') { <p class="mx-note"><i class="bi bi-lightbulb"></i> Under the new regime only other income and an earlier employer’s salary count. You can still fill in the rest to compare.</p> }
        </section>

        <section class="card">
          <div class="card-head"><h2><i class="bi bi-house-door"></i> Rent you pay (HRA)</h2>@if (sheet.salary?.hra) { <span class="muted">HRA in your CTC: {{ money(sheet.salary?.hra || 0) }}</span> }</div>
          <div class="field-grid">
            <div><label for="rent-monthly">Monthly rent</label><input id="rent-monthly" type="number" min="0" step="100" [(ngModel)]="draft.rent.monthly" (ngModelChange)="changed()" [disabled]="locked"></div>
            <div><label for="rent-months">Months paid this year</label><input id="rent-months" type="number" min="0" max="12" [(ngModel)]="draft.rent.months" (ngModelChange)="changed()" [disabled]="locked"></div>
            <div><label for="rent-city">City</label><input id="rent-city" maxlength="60" [(ngModel)]="draft.rent.city" [disabled]="locked"></div>
            <div><label for="rent-landlord">Landlord’s name</label><input id="rent-landlord" maxlength="120" [(ngModel)]="draft.rent.landlord" [disabled]="locked"></div>
            <div><label for="rent-pan">Landlord’s PAN</label><input id="rent-pan" maxlength="10" [(ngModel)]="draft.rent.landlordPan" placeholder="Needed above ₹1 lakh a year" [disabled]="locked"></div>
            <div><label class="check mx-check"><input type="checkbox" [(ngModel)]="draft.rent.metro" (ngModelChange)="changed()" [disabled]="locked"> Delhi, Mumbai, Kolkata or Chennai (50% of basic)</label></div>
          </div>
        </section>

        @for (group of groups; track group.key) {
          <section class="card">
            <div class="card-head">
              <h2><i class="bi" [class]="group.icon"></i> {{ group.label }}</h2>
              @if (group.key === '80C') { <span class="muted">{{ money(sum80c()) }} of ₹1,50,000</span> }
            </div>
            @if (group.key === '80C') { <div class="progress mx-cap"><span [style.width.%]="min(100, sum80c() / 1500)"></span></div> }
            @if (group.key === 'health') { <label class="check mx-check"><input type="checkbox" [(ngModel)]="draft.parentsSenior" (ngModelChange)="changed()" [disabled]="locked"> A parent is 60 or older</label> }
            <div class="mx-items">
              @for (item of itemsOf(group.key); track item.key) {
                <div class="mx-item">
                  <div class="mx-item-text">
                    <strong>{{ item.label }}</strong>
                    <small>{{ item.section }} · {{ item.hint }}</small>
                    @if (proofsOf(item.key).length) {
                      <div class="mx-proofs">
                        @for (proof of proofsOf(item.key); track proof.id) {
                          <span class="chip" [class]="'chip ' + proofTone(proof.status)">
                            <button type="button" class="mx-link" (click)="viewProof(proof)"><i class="bi bi-paperclip"></i> {{ proof.fileName }}</button>
                            @if (proof.status !== 'accepted' && !sheet.desk) { <button type="button" class="mx-x" (click)="removeProof(proof)" [attr.aria-label]="'Remove ' + proof.fileName"><i class="bi bi-x"></i></button> }
                          </span>
                        }
                      </div>
                    }
                  </div>
                  <div class="mx-item-input">
                    <input type="number" min="0" step="1" [attr.aria-label]="item.label" [(ngModel)]="draft.values[item.key]" (ngModelChange)="changed()" [disabled]="locked" placeholder="0">
                    @if (sheet.declaration.status === 'verified' && !item.income && !item.paid) { <small>Approved {{ money(sheet.declaration.approved[item.key] || 0) }}</small> }
                    @if (item.proof && sheet.declaration.exists && sheet.declaration.status !== 'verified') {
                      <label class="btn btn-ghost btn-sm mx-upload">
                        <i class="bi bi-upload"></i> Proof
                        <input type="file" accept="application/pdf,image/png,image/jpeg" (change)="upload(item, $event)" hidden>
                      </label>
                    }
                  </div>
                </div>
              }
            </div>
          </section>
        }

        <div class="mx-savebar">
          <span class="muted">@if (!sheet.declaration.exists) { Save once to start adding proofs. } @else { Proofs are PDF, JPG or PNG, up to 5 MB each. }</span>
          <div class="actions">
            <button type="button" class="btn btn-ghost" (click)="save(false)" [disabled]="busy || locked"><i class="bi bi-save"></i> Save draft</button>
            <button type="button" class="btn btn-gold" (click)="save(true)" [disabled]="busy || locked"><i class="bi bi-send"></i> {{ sheet.declaration.status === 'submitted' ? 'Send again' : 'Send to payroll' }}</button>
          </div>
        </div>
      }
    }

    @if (tab === 'simulate') {
      <div class="page-split">
        <section class="card">
          <h2><i class="bi bi-sliders"></i> Try your figures</h2>
          <p class="muted">Nothing here is saved. It starts from your CTC and what you have declared.</p>
          <div class="field-grid">
            <div><label for="sim-gross">Yearly salary (gross)</label><input id="sim-gross" type="number" min="0" [(ngModel)]="sim.gross" (ngModelChange)="simulate()"></div>
            <div><label for="sim-age">Your age on 31 March</label><input id="sim-age" type="number" min="18" max="100" [(ngModel)]="sim.age" (ngModelChange)="simulate()"></div>
            <div><label for="sim-basic">Yearly basic</label><input id="sim-basic" type="number" min="0" [(ngModel)]="sim.basic" (ngModelChange)="simulate()"></div>
            <div><label for="sim-hra">Yearly HRA</label><input id="sim-hra" type="number" min="0" [(ngModel)]="sim.hra" (ngModelChange)="simulate()"></div>
            <div><label for="sim-rent">Monthly rent</label><input id="sim-rent" type="number" min="0" [(ngModel)]="sim.rent" (ngModelChange)="simulate()"></div>
            <div><label class="check mx-check"><input type="checkbox" [(ngModel)]="sim.metro" (ngModelChange)="simulate()"> Metro city</label></div>
            @for (item of quick; track item.key) {
              <div><label [for]="'sim-' + item.key">{{ item.label }}</label><input [id]="'sim-' + item.key" type="number" min="0" [(ngModel)]="sim.values[item.key]" (ngModelChange)="simulate()"></div>
            }
          </div>
        </section>
        <section class="card">
          <h2><i class="bi bi-bar-chart-steps"></i> Old against new</h2>
          @if (simResult) {
            <p class="mx-verdict" [class.is-new]="simResult.better === 'new'"><i class="bi bi-stars"></i> {{ simResult.summary }}</p>
            <div class="mx-bars">
              @for (key of regimeKeys; track key) {
                <div class="mx-bar-row">
                  <span>{{ key === 'new' ? 'New' : 'Old' }}</span>
                  <div class="mx-bar"><span [class.is-best]="simResult.better === key" [style.width.%]="barWidth(simOf(key).total)"></span></div>
                  <strong>{{ money(simOf(key).total) }}</strong>
                </div>
              }
            </div>
            <div class="table-responsive">
              <table class="mx-compare">
                <thead><tr><th></th><th>Old</th><th>New</th></tr></thead>
                <tbody>
                  <tr><td>Income</td><td>{{ money(simResult.old.income) }}</td><td>{{ money(simResult.new.income) }}</td></tr>
                  <tr><td>Exemptions</td><td>{{ money(total(simResult.old.exemptions)) }}</td><td>{{ money(total(simResult.new.exemptions)) }}</td></tr>
                  <tr><td>Standard deduction</td><td>{{ money(simResult.old.standard) }}</td><td>{{ money(simResult.new.standard) }}</td></tr>
                  <tr><td>Deductions</td><td>{{ money(total(simResult.old.deductions)) }}</td><td>{{ money(total(simResult.new.deductions)) }}</td></tr>
                  <tr class="is-strong"><td>Taxable income</td><td>{{ money(simResult.old.taxable) }}</td><td>{{ money(simResult.new.taxable) }}</td></tr>
                  <tr><td>Tax on slabs</td><td>{{ money(simResult.old.slabTax) }}</td><td>{{ money(simResult.new.slabTax) }}</td></tr>
                  <tr><td>Rebate (87A)</td><td>-{{ money(simResult.old.rebate) }}</td><td>-{{ money(simResult.new.rebate) }}</td></tr>
                  <tr><td>Surcharge</td><td>{{ money(simResult.old.surcharge) }}</td><td>{{ money(simResult.new.surcharge) }}</td></tr>
                  <tr><td>Health and education cess</td><td>{{ money(simResult.old.cess) }}</td><td>{{ money(simResult.new.cess) }}</td></tr>
                  <tr class="is-total"><td>Tax for the year</td><td>{{ money(simResult.old.total) }}</td><td>{{ money(simResult.new.total) }}</td></tr>
                  <tr><td>Each month for {{ simResult.monthsLeft }} month(s)</td><td>{{ money(simResult.old.monthly) }}</td><td>{{ money(simResult.new.monthly) }}</td></tr>
                </tbody>
              </table>
            </div>
            <p class="muted mx-fine">An estimate under the Finance Act 2025 rules. Payroll’s monthly deduction and your return may differ.</p>
          } @else {
            <p class="muted">Working it out…</p>
          }
        </section>
      </div>
    }

    @if (tab === 'desk' && canDesk) {
      @if (desk) {
        <section class="card">
          <div class="card-head"><h2><i class="bi bi-door-open"></i> Declaration window</h2></div>
          <div class="field-grid">
            <label class="check"><input type="checkbox" class="switch" [(ngModel)]="windowDraft.declare"> People can declare and change investments</label>
            <label class="check"><input type="checkbox" class="switch" [(ngModel)]="windowDraft.proofs"> People can add proofs</label>
            <div><label for="win-close">Closes on</label><input id="win-close" type="date" [(ngModel)]="windowDraft.closesOn"></div>
            <div><label for="win-note">Note for everyone</label><input id="win-note" maxlength="300" [(ngModel)]="windowDraft.note" placeholder="Send proofs by 15 January"></div>
          </div>
          <div class="actions mx-row-gap"><button type="button" class="btn btn-primary" (click)="saveWindow()" [disabled]="busy"><i class="bi bi-check2"></i> Save window</button></div>
        </section>
        <section class="card">
          <div class="card-head">
            <h2><i class="bi bi-people"></i> Declarations for FY {{ desk.year }}</h2>
            <div class="chip-row">
              @for (key of deskKeys; track key) {
                <button type="button" class="chip" [class.is-on]="deskFilter === key" (click)="deskFilter = key">{{ key ? statusOf(key).label : 'Everyone' }} · {{ key ? desk.counts[key] || 0 : desk.rows.length }}</button>
              }
            </div>
          </div>
          <div class="table-responsive">
            <table>
              <thead><tr><th>Person</th><th>Regime</th><th>Status</th><th>Declared</th><th>Approved</th><th>Proofs</th><th></th></tr></thead>
              <tbody>
                @for (row of deskRows(); track row.employeeId) {
                  <tr>
                    <td><strong>{{ row.name }}</strong><br><small>{{ row.code }}@if (row.department) { · {{ row.department }} }</small></td>
                    <td>{{ row.regime ? (row.regime === 'old' ? 'Old' : 'New') : '—' }}</td>
                    <td><span class="chip" [class]="'chip ' + statusOf(row.status).tone">{{ statusOf(row.status).label }}</span></td>
                    <td>{{ money(row.declared) }}</td>
                    <td>{{ row.approved === null ? '—' : money(row.approved) }}</td>
                    <td>{{ row.proofs }}@if (row.pending) { <span class="chip is-warn">{{ row.pending }} to check</span> }</td>
                    <td><button type="button" class="btn btn-ghost btn-sm" (click)="openReview(row)" [disabled]="row.status === 'none'">Open</button></td>
                  </tr>
                } @empty {
                  <tr><td colspan="7" class="muted">Nobody here.</td></tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      } @else {
        <p class="muted">Loading the desk…</p>
      }
    }

    <app-modal [open]="!!review" size="xl" [title]="review ? review.person.name + ' · FY ' + review.year : ''" [subtitle]="review ? review.person.code + (review.person.designation ? ' · ' + review.person.designation : '') + ' · ' + (review.declaration.regime === 'old' ? 'Old regime' : 'New regime') : ''" icon="bi-clipboard2-check" tone="navy" (closed)="review = null">
      @if (review) {
        <div class="mx-banner" [class]="'mx-banner ' + statusOf(review.declaration.status).tone">
          <i class="bi" [class]="statusOf(review.declaration.status).icon"></i>
          <div><strong>{{ statusOf(review.declaration.status).label }}</strong><small>{{ review.estimate.summary }} Estimated tax on what was declared: {{ money(review.estimate[review.declaration.regime].total) }}.</small></div>
        </div>
        @if (review.declaration.rent.monthly) {
          <p class="mx-note"><i class="bi bi-house-door"></i> Rent {{ money(review.declaration.rent.monthly) }} a month for {{ review.declaration.rent.months }} month(s)@if (review.declaration.rent.city) { in {{ review.declaration.rent.city }} }@if (review.declaration.rent.metro) { (metro) }. Landlord {{ review.declaration.rent.landlord || '—' }} · PAN {{ review.declaration.rent.landlordPan || '—' }}</p>
        }
        <div class="table-responsive">
          <table>
            <thead><tr><th>Item</th><th>Declared</th><th>Approve</th><th>Proofs</th></tr></thead>
            <tbody>
              @for (item of reviewItems(); track item.key) {
                <tr>
                  <td><strong>{{ item.label }}</strong><br><small>{{ item.section }}</small></td>
                  <td>{{ money(review.declaration.values[item.key] || 0) }}</td>
                  <td><input type="number" min="0" class="mx-num" [max]="review.declaration.values[item.key] || 0" [(ngModel)]="approve[item.key]" [attr.aria-label]="'Approved ' + item.label"></td>
                  <td>
                    @for (proof of reviewProofs(item.key); track proof.id) {
                      <div class="mx-proof-row">
                        <button type="button" class="mx-link" (click)="viewProof(proof)"><i class="bi bi-paperclip"></i> {{ proof.fileName }}</button>
                        <select [(ngModel)]="proofDecisions[proof.id]" [attr.aria-label]="'Decision for ' + proof.fileName">
                          <option value="pending">To check</option>
                          <option value="accepted">Accepted</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      </div>
                    } @empty { <small class="muted">{{ item.proof ? 'No proof yet' : 'No proof needed' }}</small> }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <label for="review-note">Note to {{ review.person.name.split(' ')[0] }}</label>
        <textarea id="review-note" rows="2" maxlength="400" [(ngModel)]="reviewNote" placeholder="Needed when you send it back"></textarea>
      }
      <footer modalFooter class="md-foot">
        <button type="button" class="btn btn-ghost" (click)="review = null">Close</button>
        @if (review?.declaration?.status === 'verified') {
          <button type="button" class="btn btn-ghost" (click)="decide('reopen')" [disabled]="busy"><i class="bi bi-unlock"></i> Reopen</button>
        } @else {
          <button type="button" class="btn btn-ghost" (click)="decide('returned')" [disabled]="busy"><i class="bi bi-arrow-counterclockwise"></i> Send back</button>
          <button type="button" class="btn btn-gold" (click)="decide('verified')" [disabled]="busy"><i class="bi bi-patch-check"></i> Approve</button>
        }
      </footer>
    </app-modal>
  `,
})
export class TaxComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly sweet = inject(Sweet);
  private readonly toast = inject(Toast);
  readonly regimeKeys: Array<'new' | 'old'> = ['new', 'old'];
  readonly deskKeys = ['', 'submitted', 'returned', 'verified', 'draft', 'none'];
  readonly groups = [
    { key: '80C', label: 'Section 80C, up to ₹1.5 lakh', icon: 'bi-piggy-bank' },
    { key: 'health', label: 'Health, loans and other deductions', icon: 'bi-heart-pulse' },
    { key: 'income', label: 'Other income and an earlier employer', icon: 'bi-briefcase' },
  ];
  tab: 'declare' | 'simulate' | 'desk' = 'declare';
  year = '';
  sheet: Sheet | null = null;
  draft = { regime: 'new' as 'old' | 'new', values: {} as Record<string, number | null>, parentsSenior: false, rent: { monthly: 0, months: 12, metro: false, landlord: '', landlordPan: '', city: '' } as Rent };
  sim = { gross: 0, basic: 0, hra: 0, age: 30, rent: 0, metro: false, values: {} as Record<string, number | null> };
  simResult: Estimate | null = null;
  desk: Desk | null = null;
  deskFilter = '';
  windowDraft = { declare: true, proofs: false, note: '', closesOn: '' };
  review: Sheet | null = null;
  approve: Record<string, number | null> = {};
  proofDecisions: Record<string, string> = {};
  reviewNote = '';
  busy = false;
  error = '';
  private timer = 0;
  private simTimer = 0;

  get canDesk(): boolean { return (this.store.me?.access || []).includes('pay.tax'); }
  get locked(): boolean { return !this.sheet || this.sheet.declaration.status === 'verified' || (!this.sheet.window.declare && this.sheet.declaration.status !== 'returned'); }
  get quick(): TaxItem[] {
    const keys = ['c_ppf', 'c_elss', 'nps_own', 'd_self', 'd_parents', 'home_interest', 'other_income'];
    return (this.sheet?.items || []).filter((item) => keys.includes(item.key));
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  ngOnDestroy(): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.simTimer);
  }

  async load(): Promise<void> {
    try {
      this.sheet = await this.api.get<Sheet>('/v1/tax' + (this.year ? '?year=' + this.year : ''));
      this.year = this.sheet.year;
      this.fill(this.sheet);
      this.error = '';
    } catch (error) {
      this.error = errorText(error, 'Could not load your tax declaration.');
    }
  }

  async changeYear(year: string): Promise<void> {
    this.year = year;
    await this.load();
    if (this.tab === 'desk') await this.openDesk();
    if (this.tab === 'simulate') this.openSimulator();
  }

  statusOf(status: string) { return STATUS[status] || STATUS['none']; }
  money(value: number): string { return inr(value); }
  day(value: string): string { return dayLabel(value); }
  min(a: number, b: number): number { return Math.min(a, b); }
  total(lines: Line[]): number { return lines.reduce((sum, line) => sum + line.amount, 0); }
  estimateOf(key: 'old' | 'new'): Regime { return this.sheet!.estimate[key]; }
  simOf(key: 'old' | 'new'): Regime { return this.simResult![key]; }
  proofsOf(key: string): Proof[] { return (this.sheet?.proofs || []).filter((proof) => proof.item === key); }
  reviewProofs(key: string): Proof[] { return (this.review?.proofs || []).filter((proof) => proof.item === key); }
  proofTone(status: string): string { return status === 'accepted' ? 'is-ok' : status === 'rejected' ? 'is-bad' : 'is-info'; }
  barWidth(value: number): number {
    const top = Math.max(this.simResult?.old.total || 0, this.simResult?.new.total || 0, 1);
    return Math.max(2, value / top * 100);
  }

  itemsOf(group: string): TaxItem[] {
    const items = this.sheet?.items || [];
    if (group === '80C') return items.filter((item) => item.group === '80C');
    if (group === 'income') return items.filter((item) => item.income || item.paid);
    return items.filter((item) => !item.group && !item.income && !item.paid);
  }

  reviewItems(): TaxItem[] {
    return (this.review?.items || []).filter((item) => (this.review?.declaration.values[item.key] || 0) > 0 || this.reviewProofs(item.key).length);
  }

  sum80c(): number {
    return this.itemsOf('80C').reduce((sum, item) => sum + (Number(this.draft.values[item.key]) || 0), 0);
  }

  changed(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.refreshEstimate(), 450);
  }

  async save(submit: boolean): Promise<void> {
    if (submit && !(await this.sweet.confirm({ title: 'Send your declaration to payroll?', text: `You chose the ${this.draft.regime} regime. Payroll checks the amounts and your proofs before approving.`, confirmText: 'Send' }))) return;
    this.busy = true;
    try {
      this.sheet = await this.api.post<Sheet>('/v1/tax/declaration', { year: this.year, regime: this.draft.regime, values: this.clean(this.draft.values), parentsSenior: this.draft.parentsSenior, rent: this.draft.rent, submit });
      this.fill(this.sheet);
      this.toast.success(submit ? 'Your declaration is with payroll.' : 'Draft saved.');
    } catch (error) {
      this.toast.error(errorText(error, 'Could not save your declaration.'));
    }
    this.busy = false;
  }

  async upload(item: TaxItem, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 5_000_000) { this.toast.error('Choose a file under 5 MB.'); return; }
    this.busy = true;
    try {
      this.sheet = await this.api.post<Sheet>('/v1/tax/proof', { year: this.year, item: item.key, fileName: file.name, data: await readFile(file) });
      this.fill(this.sheet, true);
      this.toast.success(`Proof added for ${item.label}.`);
    } catch (error) {
      this.toast.error(errorText(error, 'Could not add that proof.'));
    }
    this.busy = false;
  }

  async removeProof(proof: Proof): Promise<void> {
    if (!(await this.sweet.confirm({ title: 'Remove this proof?', text: proof.fileName, confirmText: 'Remove', danger: true }))) return;
    try {
      this.sheet = await this.api.post<Sheet>('/v1/tax/proof/delete', { id: proof.id });
      this.fill(this.sheet, true);
    } catch (error) {
      this.toast.error(errorText(error, 'Could not remove that proof.'));
    }
  }

  async viewProof(proof: Proof): Promise<void> {
    try {
      const blob = await this.api.blob('/v1/tax/proof/' + proof.id);
      await this.sweet.preview({ title: proof.fileName, subtitle: 'Investment proof', blob, fileName: proof.fileName });
    } catch (error) {
      this.toast.error(errorText(error, 'Could not open that proof.'));
    }
  }

  openSimulator(): void {
    this.tab = 'simulate';
    const salary = this.sheet?.salary;
    this.sim = {
      gross: salary?.gross || 0,
      basic: salary?.basic || 0,
      hra: salary?.hra || 0,
      age: this.sheet?.person.age || 30,
      rent: this.draft.rent.monthly || 0,
      metro: this.draft.rent.metro,
      values: { ...this.draft.values },
    };
    this.simulate();
  }

  simulate(): void {
    window.clearTimeout(this.simTimer);
    this.simTimer = window.setTimeout(async () => {
      try {
        this.simResult = await this.api.post<Estimate>('/v1/tax/simulate', {
          year: this.year,
          gross: this.sim.gross, basic: this.sim.basic, hra: this.sim.hra, age: this.sim.age,
          values: this.clean(this.sim.values),
          rent: { monthly: this.sim.rent || 0, months: 12, metro: this.sim.metro },
          parentsSenior: this.draft.parentsSenior,
        });
      } catch (error) {
        this.toast.error(errorText(error, 'Could not work out the tax.'));
      }
    }, 300);
  }

  async openDesk(): Promise<void> {
    this.tab = 'desk';
    try {
      this.desk = await this.api.get<Desk>('/v1/tax/desk?year=' + this.year);
      this.windowDraft = { ...this.desk.window };
    } catch (error) {
      this.toast.error(errorText(error, 'Could not load the desk.'));
    }
  }

  deskRows(): DeskRow[] {
    return (this.desk?.rows || []).filter((row) => !this.deskFilter || row.status === this.deskFilter);
  }

  async saveWindow(): Promise<void> {
    this.busy = true;
    try {
      await this.api.post('/v1/tax/window', this.windowDraft);
      this.toast.success('Declaration window saved.');
      await this.load();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not save the window.'));
    }
    this.busy = false;
  }

  async openReview(row: DeskRow): Promise<void> {
    try {
      this.review = await this.api.get<Sheet>(`/v1/tax/desk/${row.employeeId}?year=${this.year}`);
      this.prepareReview(this.review);
    } catch (error) {
      this.toast.error(errorText(error, 'Could not open that declaration.'));
    }
  }

  async decide(decision: 'verified' | 'returned' | 'reopen'): Promise<void> {
    if (!this.review) return;
    if (decision === 'returned' && !this.reviewNote.trim()) { this.toast.warning('Write a note saying what needs fixing.'); return; }
    this.busy = true;
    try {
      const saved = await this.api.post<Sheet>('/v1/tax/verify', { employeeId: this.review.person.id, year: this.year, decision, note: this.reviewNote, approved: this.clean(this.approve), proofs: this.proofDecisions });
      this.toast.success(decision === 'verified' ? `Approved for ${saved.person.name}.` : decision === 'returned' ? 'Sent back with your note.' : 'Reopened for changes.');
      this.review = null;
      await this.openDesk();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not save the decision.'));
    }
    this.busy = false;
  }

  private prepareReview(sheet: Sheet): void {
    const verified = sheet.declaration.status === 'verified';
    this.approve = {};
    for (const item of sheet.items) {
      const declared = sheet.declaration.values[item.key] || 0;
      if (declared) this.approve[item.key] = verified ? sheet.declaration.approved[item.key] ?? declared : declared;
    }
    this.proofDecisions = Object.fromEntries(sheet.proofs.map((proof) => [proof.id, proof.status]));
    this.reviewNote = sheet.declaration.note || '';
  }

  private fill(sheet: Sheet, keepEdits = false): void {
    if (keepEdits) return;
    this.draft = {
      regime: sheet.declaration.regime,
      values: { ...sheet.declaration.values },
      parentsSenior: sheet.declaration.parentsSenior,
      rent: { ...sheet.declaration.rent },
    };
  }

  private async refreshEstimate(): Promise<void> {
    if (!this.sheet) return;
    try {
      const salary = this.sheet.salary;
      this.sheet = {
        ...this.sheet,
        estimate: await this.api.post<Estimate>('/v1/tax/simulate', {
          year: this.year,
          gross: salary?.gross || 0, basic: salary?.basic || 0, hra: salary?.hra || 0, age: this.sheet.person.age,
          values: this.clean(this.draft.values), rent: this.draft.rent, parentsSenior: this.draft.parentsSenior,
        }),
      };
    } catch {
      /* the estimate keeps its last figures */
    }
  }

  private clean(values: Record<string, number | null | undefined>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(values)) if (value !== null && value !== undefined && Number(value) > 0) out[key] = Math.round(Number(value));
    return out;
  }
}
