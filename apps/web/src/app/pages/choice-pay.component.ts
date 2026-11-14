import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { errorText, inr } from '../shared/kit';
import { ModalComponent } from '../shared/modal.component';
import { Sweet } from '../shared/sweet';
import { Toast } from '../shared/toast';

interface FlexComponent { key: string; label: string; hint: string; cap: number; taxFree: boolean }
interface FlexConfig { open: boolean; pool: string; note: string; components: FlexComponent[] }
interface Sheet {
  person: { id: string; name: string; code: string } | null;
  pool: number; poolLines: string[]; values: Record<string, number>; chosen: number; left: number; taxFree: number;
  status: 'none' | 'draft' | 'submitted' | 'approved' | 'returned'; note: string; decidedBy: string;
}
interface Row { employeeId: string; name: string; code: string; department: string; pool: number; chosen: number; status: string; note: string }
interface View { year: string; canDesk: boolean; config: FlexConfig; sheet: Sheet | null; rows: Row[] }

const STATUS: Record<string, { label: string; tone: string }> = {
  none: { label: 'Not started', tone: '' },
  draft: { label: 'Draft', tone: 'is-warn' },
  submitted: { label: 'With payroll', tone: 'is-info' },
  approved: { label: 'Approved', tone: 'is-ok' },
  returned: { label: 'Needs a change', tone: 'is-bad' },
};

@Component({
  selector: 'app-choice-pay',
  imports: [FormsModule, ModalComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-sliders2"></i></span>
        <p class="eyebrow">My pay</p>
        <h1>Choice pay</h1>
        <p class="lede">Split the flexible part of your CTC across allowances like fuel, phone and meals. Under the old tax regime, these are tax free when you give bills.</p>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (view?.canDesk) {
      <div class="seg-mini mx-tabs" role="tablist">
        <button type="button" role="tab" [class.is-active]="tab === 'mine'" (click)="tab = 'mine'"><i class="bi bi-person"></i> My split</button>
        <button type="button" role="tab" [class.is-active]="tab === 'desk'" (click)="tab = 'desk'"><i class="bi bi-clipboard2-check"></i> Payroll desk · {{ waiting() }}</button>
        <button type="button" role="tab" [class.is-active]="tab === 'setup'" (click)="openSetup()"><i class="bi bi-gear"></i> Set up</button>
      </div>
    }

    @if (view && tab === 'mine') {
      @if (!view.sheet || !view.sheet.pool) {
        <section class="card empty-state">
          <i class="bi bi-sliders2"></i>
          <h2>No flexible pay to split</h2>
          <p class="muted">Your CTC has no line matching “{{ view.config.pool }}”. Payroll sets this up in your salary structure.</p>
        </section>
      } @else {
        @if (view.sheet; as s) {
          @if (!view.config.open && s.status !== 'returned' && s.status !== 'approved') { <p class="mx-banner is-warn"><i class="bi bi-lock"></i> Choice pay is closed right now. You can read your split, but not change it.</p> }
          @if (s.status === 'returned') { <p class="mx-banner is-bad"><i class="bi bi-arrow-return-left"></i> Payroll sent it back: {{ s.note }}</p> }
          @if (s.status === 'approved') { <p class="mx-banner is-ok"><i class="bi bi-check-circle"></i> Approved by {{ s.decidedBy }} for FY {{ view.year }}. It counts in your tax estimate.</p> }
          @if (view.config.note) { <p class="mx-note"><i class="bi bi-info-circle"></i> {{ view.config.note }}</p> }
          <div class="page-split">
            <section class="card">
              <div class="card-head"><h2><i class="bi bi-pie-chart"></i> Your split for FY {{ view.year }}</h2><span class="chip" [class]="'chip ' + tone(s.status)">{{ label(s.status) }}</span></div>
              <div class="mx-flex">
                @for (item of view.config.components; track item.key) {
                  <div class="mx-flex-row">
                    <div class="mx-item-text"><strong>{{ item.label }}</strong><small>{{ item.hint }} · up to {{ money(item.cap) }} a year@if (item.taxFree) { · tax free with bills }</small></div>
                    <input type="range" min="0" [max]="maxFor(item)" step="100" [(ngModel)]="values[item.key]" [disabled]="locked(s)" [attr.aria-label]="item.label">
                    <input type="number" min="0" [max]="item.cap" class="mx-num" [(ngModel)]="values[item.key]" [disabled]="locked(s)" [attr.aria-label]="item.label + ' amount'">
                  </div>
                }
              </div>
              @if (!locked(s)) {
                <div class="actions mx-savebar">
                  <button type="button" class="btn btn-ghost" (click)="fillEven()"><i class="bi bi-distribute-horizontal"></i> Use it all</button>
                  <button type="button" class="btn btn-ghost" (click)="save(false)" [disabled]="busy"><i class="bi bi-save"></i> Save draft</button>
                  <button type="button" class="btn btn-gold" (click)="save(true)" [disabled]="busy || chosen() > s.pool"><i class="bi bi-send"></i> Send to payroll</button>
                </div>
              }
            </section>
            <div class="dash-side">
              <section class="card mx-pool">
                <small>Flexible pay a year</small>
                <strong>{{ money(s.pool) }}</strong>
                <p class="muted mx-fine">From {{ s.poolLines.join(', ') }}</p>
                <div class="progress mx-progress" [class.is-over]="chosen() > s.pool"><span [style.width.%]="Math.min(100, s.pool ? chosen() / s.pool * 100 : 0)"></span></div>
                <div class="mx-pool-meta">
                  <div><small>Chosen</small><b>{{ money(chosen()) }}</b></div>
                  <div><small>{{ chosen() > s.pool ? 'Over by' : 'Left as taxable pay' }}</small><b [class.mx-minus]="chosen() > s.pool">{{ money(Math.abs(s.pool - chosen())) }}</b></div>
                  <div><small>Tax free (old regime)</small><b class="mx-ok">{{ money(taxFree()) }}</b></div>
                </div>
                <p class="muted mx-fine">Anything you do not split is paid as taxable allowance.</p>
              </section>
            </div>
          </div>
        }
      }
    }

    @if (view && tab === 'desk' && view.canDesk) {
      <section class="card">
        <div class="mx-inline mx-row-end">
          <select [(ngModel)]="deskFilter" aria-label="Filter by status">
            <option value="">Everyone</option>
            @for (key of statusKeys; track key) { <option [value]="key">{{ label(key) }}</option> }
          </select>
        </div>
        <div class="table-responsive">
          <table>
            <thead><tr><th>Person</th><th>Flexible pay</th><th>Chosen</th><th>Status</th><th></th></tr></thead>
            <tbody>
              @for (row of deskRows(); track row.employeeId) {
                <tr>
                  <td><strong>{{ row.name }}</strong><br><small>{{ row.code }}@if (row.department) { · {{ row.department }} }</small></td>
                  <td>{{ row.pool ? money(row.pool) : '—' }}</td>
                  <td>{{ row.chosen ? money(row.chosen) : '—' }}</td>
                  <td><span class="chip" [class]="'chip ' + tone(row.status)">{{ label(row.status) }}</span></td>
                  <td>@if (row.status !== 'none') { <button type="button" class="btn btn-ghost btn-sm" (click)="review(row)">Review</button> }</td>
                </tr>
              } @empty { <tr><td colspan="5" class="muted">Nobody here.</td></tr> }
            </tbody>
          </table>
        </div>
      </section>
    }

    @if (view && tab === 'setup' && view.canDesk && setup) {
      <section class="card">
        <div class="card-head"><h2><i class="bi bi-gear"></i> Choice pay setup</h2></div>
        <label class="check"><input type="checkbox" [(ngModel)]="setup.open"> Open for people to choose</label>
        <div class="field-grid">
          <div><label for="fx-pool">Words that find the flexible line in a CTC</label><input id="fx-pool" maxlength="200" [(ngModel)]="setup.pool"><small class="muted">Separate with commas. A CTC line whose name contains any of these is split.</small></div>
          <div><label for="fx-note">Note for everyone</label><input id="fx-note" maxlength="400" [(ngModel)]="setup.note" placeholder="Choose by 15 April. Bills are due every quarter."></div>
        </div>
        <div class="table-responsive mx-row-gap">
          <table class="mx-settle">
            <thead><tr><th>Component</th><th>Hint</th><th>Yearly limit</th><th>Tax free</th><th></th></tr></thead>
            <tbody>
              @for (item of setup.components; track $index) {
                <tr>
                  <td><input [(ngModel)]="item.label" maxlength="60" aria-label="Component"></td>
                  <td><input [(ngModel)]="item.hint" maxlength="160" aria-label="Hint"></td>
                  <td><input type="number" min="0" class="mx-num" [(ngModel)]="item.cap" aria-label="Yearly limit"></td>
                  <td><input type="checkbox" [(ngModel)]="item.taxFree" aria-label="Tax free with bills"></td>
                  <td><button type="button" class="mx-x" (click)="setup.components.splice($index, 1)" aria-label="Remove"><i class="bi bi-trash"></i></button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="actions mx-savebar">
          <button type="button" class="btn btn-ghost" (click)="setup.components.push({ key: '', label: 'New component', hint: '', cap: 12000, taxFree: false })"><i class="bi bi-plus-lg"></i> Add a component</button>
          <button type="button" class="btn btn-gold" (click)="saveSetup()" [disabled]="busy"><i class="bi bi-check2"></i> Save setup</button>
        </div>
      </section>
    }

    <app-modal [open]="!!reviewing" size="lg" [title]="reviewing?.person?.name || ''" [subtitle]="reviewing ? 'Flexible pay ' + money(reviewing.pool) + ' · chosen ' + money(reviewing.chosen) : ''" icon="bi-sliders2" tone="gold" (closed)="reviewing = null">
      @if (reviewing && view) {
        <table>
          <tbody>
            @for (item of view.config.components; track item.key) {
              @if (reviewing.values[item.key]) { <tr><td>{{ item.label }}</td><td class="mx-right">{{ money(reviewing.values[item.key]) }}</td></tr> }
            }
            <tr class="mx-total"><td>Left as taxable pay</td><td class="mx-right">{{ money(reviewing.left) }}</td></tr>
          </tbody>
        </table>
        <label for="fx-decide-note">Note</label>
        <input id="fx-decide-note" maxlength="300" [(ngModel)]="decideNote" placeholder="Needed when you send it back">
      }
      <footer modalFooter class="md-foot">
        <button type="button" class="btn btn-ghost" (click)="reviewing = null">Close</button>
        <button type="button" class="btn btn-ghost" (click)="decide('returned')" [disabled]="busy"><i class="bi bi-arrow-return-left"></i> Send back</button>
        <button type="button" class="btn btn-gold" (click)="decide('approved')" [disabled]="busy"><i class="bi bi-check2"></i> Approve</button>
      </footer>
    </app-modal>
  `,
})
export class ChoicePayComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly toast = inject(Toast);
  readonly Math = Math;
  readonly statusKeys = Object.keys(STATUS);
  view: View | null = null;
  tab: 'mine' | 'desk' | 'setup' = 'mine';
  values: Record<string, number> = {};
  deskFilter = '';
  setup: FlexConfig | null = null;
  reviewing: Sheet | null = null;
  decideNote = '';
  busy = false;
  error = '';

  async ngOnInit(): Promise<void> {
    await this.load();
    if (this.view?.canDesk && !this.view.sheet?.pool) this.tab = 'desk';
  }

  async load(): Promise<void> {
    try {
      this.apply(await this.api.get<View>('/v1/flex'));
      this.error = '';
    } catch (error) {
      this.error = errorText(error, 'Could not load choice pay.');
    }
  }

  money(value: number): string { return inr(value); }
  label(status: string): string { return STATUS[status]?.label || status; }
  tone(status: string): string { return STATUS[status]?.tone || ''; }
  waiting(): number { return (this.view?.rows || []).filter((row) => row.status === 'submitted').length; }
  deskRows(): Row[] { return (this.view?.rows || []).filter((row) => !this.deskFilter || row.status === this.deskFilter); }
  chosen(): number { return Object.values(this.values).reduce((sum, value) => sum + (Number(value) || 0), 0); }
  maxFor(item: FlexComponent): number { return Math.min(item.cap || this.view?.sheet?.pool || 0, this.view?.sheet?.pool || 0); }
  locked(sheet: Sheet): boolean { return sheet.status === 'approved' || sheet.status === 'submitted' || (!this.view?.config.open && sheet.status !== 'returned'); }

  taxFree(): number {
    return (this.view?.config.components || []).filter((item) => item.taxFree).reduce((sum, item) => sum + Math.min(item.cap, Number(this.values[item.key]) || 0), 0);
  }

  fillEven(): void {
    const pool = this.view?.sheet?.pool || 0;
    let left = pool;
    for (const item of this.view?.config.components || []) {
      const take = Math.min(item.cap, left);
      this.values[item.key] = take;
      left -= take;
    }
  }

  async save(submit: boolean): Promise<void> {
    if (submit && !(await this.sweet.confirm({ title: 'Send your split to payroll?', text: `${this.money(this.chosen())} across allowances. You cannot change it while payroll checks it.`, confirmText: 'Send' }))) return;
    this.busy = true;
    try {
      this.apply(await this.api.post<View>('/v1/flex/choice', { year: this.view?.year, values: this.values, submit }));
      this.toast.success(submit ? 'Sent to payroll.' : 'Draft saved.');
    } catch (error) {
      this.toast.error(errorText(error, 'Could not save your split.'));
    }
    this.busy = false;
  }

  async review(row: Row): Promise<void> {
    try {
      const view = await this.api.get<View>(`/v1/flex?person=${row.employeeId}&year=${this.view?.year}`);
      this.reviewing = view.sheet;
      this.decideNote = view.sheet?.note || '';
    } catch (error) {
      this.toast.error(errorText(error, 'Could not open the split.'));
    }
  }

  async decide(decision: 'approved' | 'returned'): Promise<void> {
    if (!this.reviewing?.person) return;
    if (decision === 'returned' && !this.decideNote.trim()) { this.toast.warning('Say what needs to change.'); return; }
    this.busy = true;
    try {
      this.apply(await this.api.post<View>('/v1/flex/decide', { year: this.view?.year, employeeId: this.reviewing.person.id, decision, note: this.decideNote }));
      this.toast.success(decision === 'approved' ? 'Approved.' : 'Sent back.');
      this.reviewing = null;
    } catch (error) {
      this.toast.error(errorText(error, 'Could not save the decision.'));
    }
    this.busy = false;
  }

  openSetup(): void {
    this.tab = 'setup';
    if (this.view) this.setup = JSON.parse(JSON.stringify(this.view.config)) as FlexConfig;
  }

  async saveSetup(): Promise<void> {
    if (!this.setup) return;
    this.busy = true;
    try {
      this.apply(await this.api.post<View>('/v1/flex/config', this.setup));
      this.setup = JSON.parse(JSON.stringify(this.view?.config)) as FlexConfig;
      this.toast.success('Choice pay setup saved.');
    } catch (error) {
      this.toast.error(errorText(error, 'Could not save the setup.'));
    }
    this.busy = false;
  }

  private apply(view: View): void {
    this.view = view;
    this.values = {};
    for (const item of view.config.components) this.values[item.key] = view.sheet?.values[item.key] || 0;
  }
}
