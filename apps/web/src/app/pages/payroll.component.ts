import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Person } from '../core/models';
import { SessionStore } from '../core/session.store';
import { PayrollMonthComponent } from './payroll-month.component';

interface EditorLine { side: string; name: string; rupees: string; show: boolean }
interface CtcTemplate { id: string; name: string; lines: Array<{ side: string; name: string; percent: number; show: boolean }> }
interface SlipLayout {
  showCode: boolean; showDesignation: boolean; showDepartment: boolean; showLocation: boolean;
  showJoined: boolean; showPaidDays: boolean; showLopDays: boolean; showPan: boolean;
  showBank: boolean; showEmployer: boolean; showNote: boolean;
}
interface PayPack {
  person: { id: string; name: string; code: string };
  layout?: SlipLayout;
  structure: { effectiveFrom: string; published: boolean; annual: string; lines: EditorLine[] } | null;
  slips: Array<{ month: string; label: string; published: boolean; note: string; net: string; paidDays: string; lopDays: string; lines: EditorLine[]; facts: Array<{ label: string; value: string }> }>;
  forms: Array<{ id: string; year: string; published: boolean }>;
}

type PayrollTab = 'board' | 'design' | 'person';
type PersonPayTab = 'ctc' | 'month' | 'form16';

@Component({
  selector: 'app-payroll',
  imports: [FormsModule, PayrollMonthComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-cash-stack"></i></span>
        <p class="eyebrow">Payroll</p>
        <h1>Publish pay</h1>
        <p class="lede">{{ tabLede }}</p>
      </div>
    </div>
    @if (!canOpen) {
      <section class="card"><h2><i class="bi bi-wallet2"></i> Payroll</h2><p class="muted">Payroll is turned off for your role.</p></section>
    } @else {
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }

    <div class="seg-tabs page-tabs" role="tablist" aria-label="Payroll sections">
      <button type="button" role="tab" [attr.aria-selected]="tab === 'board'" [class.is-on]="tab === 'board'" (click)="setTab('board')">
        <i class="bi bi-kanban"></i> Month board
      </button>
      @if (layout) {
        <button type="button" role="tab" [attr.aria-selected]="tab === 'design'" [class.is-on]="tab === 'design'" (click)="setTab('design')">
          <i class="bi bi-receipt"></i> Slip design
        </button>
      }
      <button type="button" role="tab" [attr.aria-selected]="tab === 'person'" [class.is-on]="tab === 'person'" (click)="setTab('person')">
        <i class="bi bi-person"></i> Person
        @if (employeeId) { <span class="chip">{{ pack ? 'Loaded' : 'Picked' }}</span> }
      </button>
    </div>

    @if (tab === 'board') {
      <app-payroll-month (open)="openPerson($event)" (changed)="employeeId && loadPerson()" />
    }

    @if (tab === 'design' && layout) {
      <section class="card">
        <h2><i class="bi bi-receipt"></i> Slip design</h2>
        <p class="muted">These choices apply to every salary slip. A line you leave off one person’s month stays in the net and is hidden on their copy. PAN and the bank account, when included, show only the last four characters.</p>
        <div class="slip-flags">
          @for (item of flags; track item.key) {
            <label class="checkline"><input type="checkbox" [name]="item.key" [(ngModel)]="layout[item.key]"> {{ item.label }}</label>
          }
        </div>
        <div class="actions">
          <button type="button" class="btn btn-primary" (click)="saveLayout()" [disabled]="busy">Save slip design</button>
        </div>
      </section>
    }

    @if (tab === 'person') {
    <section class="card" id="pay-person-card">
      <label for="pay-find">Find a person</label>
      <div class="split">
        <input id="pay-find" name="payFind" [(ngModel)]="finder" placeholder="Name or code" (keyup.enter)="findPeople()">
        <button type="button" class="btn btn-ghost" (click)="findPeople()"><i class="bi bi-search"></i> Search</button>
      </div>
      @if (finderHint) { <p class="muted">{{ finderHint }}</p> }
      <label for="pay-person">Person</label>
      <select id="pay-person" [(ngModel)]="employeeId" (ngModelChange)="loadPerson()">
        <option value="">Choose a person</option>
        @for (person of people; track person.id) { <option [value]="person.id">{{ person.name }} · {{ person.code }}</option> }
      </select>
    </section>
    @if (pack) {
      <div class="seg-mini mx-tabs" role="tablist" aria-label="Person payroll">
        <button type="button" role="tab" [class.is-active]="personTab === 'ctc'" (click)="personTab = 'ctc'"><i class="bi bi-pie-chart"></i> CTC</button>
        <button type="button" role="tab" [class.is-active]="personTab === 'month'" (click)="personTab = 'month'"><i class="bi bi-calendar-month"></i> Salary month</button>
        <button type="button" role="tab" [class.is-active]="personTab === 'form16'" (click)="personTab = 'form16'"><i class="bi bi-file-earmark-text"></i> Form 16</button>
      </div>
      @if (personTab === 'ctc') {
      <section class="card">
        <h2><i class="bi bi-pie-chart"></i> CTC breakup</h2>
        <p class="muted">{{ pack.structure ? 'Annual CTC ' + pack.structure.annual : 'No CTC published yet.' }}</p>
        <div class="ctc-templates" style="margin-bottom: 16px">
          <label for="ctc-template">Start from a template</label>
          <div class="split">
            <select id="ctc-template" name="ctcTemplate" [(ngModel)]="templateId" aria-label="CTC template">
              <option value="">{{ ctcTemplates.length ? 'Choose a template' : 'No templates saved yet' }}</option>
              @for (item of ctcTemplates; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
            </select>
            <input name="templateCtc" [(ngModel)]="templateCtc" inputmode="decimal" placeholder="Annual CTC in rupees" aria-label="Annual CTC for the template">
            <button type="button" class="btn btn-ghost" [disabled]="busy || !templateId || !templateCtc" (click)="applyTemplate()"><i class="bi bi-magic"></i> Fill lines</button>
            <button type="button" class="btn btn-ghost btn-danger" [disabled]="busy || !templateId" (click)="removeTemplate()"><i class="bi bi-trash"></i> Delete</button>
          </div>
          <p class="muted">A template is a share of the annual CTC for each line. Filling lines only fills the form below; nothing is saved until you save the CTC.</p>
        </div>
        <form (ngSubmit)="saveStructure()">
          <label for="ctc-from">Effective from</label>
          <input id="ctc-from" type="date" name="effectiveFrom" [(ngModel)]="effectiveFrom" required>
          @for (line of structureLines; track $index) {
            <div class="pay-editor">
              <select [name]="'ctc-side-' + $index" [(ngModel)]="line.side" aria-label="CTC line type">
                <option value="earning">Earning</option>
                <option value="employer">Employer contribution</option>
              </select>
              <input [name]="'ctc-name-' + $index" [(ngModel)]="line.name" placeholder="Basic" aria-label="CTC line name">
              <input [name]="'ctc-rupees-' + $index" [(ngModel)]="line.rupees" inputmode="decimal" placeholder="Annual rupees" aria-label="Annual rupees">
              <button type="button" class="btn btn-ghost" (click)="structureLines.splice($index, 1)">Remove</button>
            </div>
          }
          <div class="actions">
            <button type="button" class="btn btn-ghost" (click)="structureLines.push({ side: 'earning', name: '', rupees: '', show: true })">Add a line</button>
            <label class="checkline"><input type="checkbox" name="ctcPublish" [(ngModel)]="structurePublished"> Publish for the employee</label>
            <button class="btn btn-primary" type="submit" [disabled]="busy">Save CTC</button>
          </div>
          <label for="ctc-template-name">Save these lines as a template</label>
          <div class="split">
            <input id="ctc-template-name" name="templateName" [(ngModel)]="templateName" maxlength="60" placeholder="Template name, for example Grade 3 staff">
            <button type="button" class="btn btn-ghost" [disabled]="busy || !templateName.trim()" (click)="saveTemplate()"><i class="bi bi-bookmark-plus"></i> Save template</button>
          </div>
        </form>
      </section>
      }
      @if (personTab === 'month') {
      <section class="card">
        <h2><i class="bi bi-calendar-month"></i> Salary month</h2>
        @if (pack.slips.length) {
          <ul class="plain">
            @for (slip of pack.slips; track slip.month) {
              <li><span>{{ slip.label }} · {{ slip.net }}</span><strong>{{ slip.published ? 'Published' : 'Hidden' }}</strong></li>
            }
          </ul>
        }
        <form (ngSubmit)="saveSlip()">
          <label for="slip-month">Month</label>
          <input id="slip-month" type="month" name="month" [(ngModel)]="month" (ngModelChange)="applySlip()" required>
          @if (slipHint) { <p class="muted">{{ slipHint }}</p> }
          @for (line of slipLines; track $index) {
            <div class="pay-editor">
              <select [name]="'slip-side-' + $index" [(ngModel)]="line.side" aria-label="Salary line type">
                <option value="earning">Earning</option>
                <option value="deduction">Deduction</option>
                <option value="employer">Employer contribution</option>
              </select>
              <input [name]="'slip-name-' + $index" [(ngModel)]="line.name" placeholder="Basic" aria-label="Salary line name">
              <input [name]="'slip-rupees-' + $index" [(ngModel)]="line.rupees" inputmode="decimal" placeholder="Rupees" aria-label="Rupees">
              <label class="checkline"><input type="checkbox" [name]="'slip-show-' + $index" [(ngModel)]="line.show"> On slip</label>
              <button type="button" class="btn btn-ghost" (click)="slipLines.splice($index, 1)">Remove</button>
            </div>
          }
          <div class="split">
            <div>
              <label for="paid-days">Paid days</label>
              <input id="paid-days" name="paidDays" [(ngModel)]="paidDays" inputmode="decimal" placeholder="Shown only if the design includes it">
            </div>
            <div>
              <label for="lop-days">Loss of pay days</label>
              <input id="lop-days" name="lopDays" [(ngModel)]="lopDays" inputmode="decimal" placeholder="Shown only if the design includes it">
            </div>
          </div>
          <div class="actions pm-fill">
            <button type="button" class="btn btn-ghost btn-sm" (click)="fillDays()" [disabled]="busy"><i class="bi bi-calendar-check"></i> Fill from attendance</button>
            @if (daysHint) { <span class="muted">{{ daysHint }}</span> }
          </div>
          <label for="slip-note">Note</label>
          <input id="slip-note" name="note" [(ngModel)]="note" placeholder="Optional note on the slip">
          <div class="actions">
            <button type="button" class="btn btn-ghost" (click)="slipLines.push({ side: 'earning', name: '', rupees: '', show: true })">Add a line</button>
            <label class="checkline"><input type="checkbox" name="slipPublish" [(ngModel)]="slipPublished"> Publish for the employee</label>
            <button class="btn btn-primary" type="submit" [disabled]="busy">Save month</button>
          </div>
        </form>
      </section>
      }
      @if (personTab === 'form16') {
      <section class="card">
        <h2><i class="bi bi-file-earmark-text"></i> Form 16</h2>
        @for (form of pack.forms; track form.id) {
          <div class="row-between">
            <span>{{ form.year }} {{ form.published ? '' : '· hidden' }}</span>
            <button type="button" class="btn btn-ghost" (click)="removeForm(form.id)">Remove</button>
          </div>
        }
        <form (ngSubmit)="saveForm()">
          <div class="split">
            <div>
              <label for="form-year">Financial year</label>
              <input id="form-year" name="year" [(ngModel)]="year" placeholder="2025-26" required>
            </div>
            <div>
              <label for="form-file">PDF</label>
              <input id="form-file" type="file" accept="application/pdf" (change)="pickForm($event)">
            </div>
          </div>
          <div class="actions">
            <label class="checkline"><input type="checkbox" name="formPublish" [(ngModel)]="formPublished"> Publish for the employee</label>
            <button class="btn btn-primary" type="submit" [disabled]="busy">Save Form 16</button>
          </div>
        </form>
      </section>
      }
    }
    }
    }
  `,
})
export class PayrollComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly tabKey = 'altamid.payroll.tab';
  tab: PayrollTab = 'board';
  personTab: PersonPayTab = 'ctc';
  people: Person[] = [];
  finder = '';
  finderHint = '';
  employeeId = '';
  pack: PayPack | null = null;
  effectiveFrom = '2026-04-01';
  layout: SlipLayout | null = null;
  readonly flags: Array<{ key: keyof SlipLayout; label: string }> = [
    { key: 'showCode', label: 'Employee code' },
    { key: 'showDesignation', label: 'Designation' },
    { key: 'showDepartment', label: 'Department' },
    { key: 'showLocation', label: 'Workplace' },
    { key: 'showJoined', label: 'Date of joining' },
    { key: 'showPaidDays', label: 'Paid days' },
    { key: 'showLopDays', label: 'Loss of pay days' },
    { key: 'showPan', label: 'PAN, last four only' },
    { key: 'showBank', label: 'Bank account, last four only' },
    { key: 'showEmployer', label: 'Employer contributions' },
    { key: 'showNote', label: 'Note' },
  ];
  structureLines: EditorLine[] = [{ side: 'earning', name: 'Basic', rupees: '', show: true }];
  structurePublished = true;
  ctcTemplates: CtcTemplate[] = [];
  templateId = '';
  templateCtc = '';
  templateName = '';
  month = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()).slice(0, 7);
  slipHint = '';
  daysHint = '';
  slipLines: EditorLine[] = [
    { side: 'earning', name: 'Basic', rupees: '', show: true },
    { side: 'deduction', name: 'Provident fund', rupees: '', show: true },
  ];
  slipPublished = true;
  paidDays = '';
  lopDays = '';
  note = '';
  year = '2025-26';
  formPublished = true;
  formData = '';
  formName = '';
  error = '';
  ok = '';
  busy = false;

  get canOpen(): boolean {
    return !!this.store.me?.access?.includes('pay');
  }

  get tabLede(): string {
    const lines: Record<PayrollTab, string> = {
      board: 'See who is published for each month and open someone to edit their pay.',
      design: 'Choose what every salary slip shows. Amounts are what you enter. PF, ESI, and tax are not calculated here.',
      person: 'Find an employee, set CTC, publish a salary month, and upload Form 16.',
    };
    return lines[this.tab];
  }

  setTab(tab: PayrollTab): void {
    if (tab === 'design' && !this.layout) tab = 'board';
    this.tab = tab;
    try { sessionStorage.setItem(this.tabKey, tab); } catch { /* ignore */ }
  }

  async ngOnInit(): Promise<void> {
    if (!this.canOpen) return;
    try {
      const saved = sessionStorage.getItem(this.tabKey) as PayrollTab | null;
      if (saved && ['board', 'design', 'person'].includes(saved)) this.tab = saved;
    } catch { /* ignore */ }
    try {
      await this.findPeople();
      this.layout = await this.api.get<SlipLayout>('/v1/pay/layout');
      this.ctcTemplates = (await this.api.get<{ templates: CtcTemplate[] }>('/v1/pay/ctc-templates').catch(() => ({ templates: [] }))).templates;
      if (this.tab === 'design' && !this.layout) this.tab = 'board';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load people.';
    }
  }

  async openPerson(id: string): Promise<void> {
    if (!this.people.some((person) => person.id === id)) {
      const one = await this.api.get<Person>('/v1/people/' + id).catch(() => null);
      if (one) this.people = [one, ...this.people];
    }
    this.employeeId = id;
    this.setTab('person');
    await this.loadPerson();
  }

  async fillDays(): Promise<void> {
    if (!this.employeeId) return;
    this.daysHint = '';
    try {
      const days = await this.api.get<{ paidDays: string; lopDays: string; absent: number; unpaid: number; employed: number; tracked: boolean; finished: boolean }>(
        '/v1/payroll/days?employeeId=' + encodeURIComponent(this.employeeId) + '&month=' + encodeURIComponent(this.month),
      );
      if (!days.tracked) {
        this.daysHint = 'No punches, leave or on-duty days are recorded for this month, so nothing was filled. Enter the days by hand.';
        return;
      }
      this.paidDays = days.paidDays;
      this.lopDays = days.lopDays;
      this.daysHint = `${days.employed} days employed, ${days.absent} absent, ${days.unpaid} unpaid leave` + (days.finished ? '.' : '. The month is not over: absence is counted up to today and the rest of the month is assumed paid.') + ' Check before saving.';
    } catch (error) {
      this.daysHint = error instanceof Error ? error.message : 'Attendance could not be read.';
    }
  }

  async findPeople(): Promise<void> {
    const q = this.finder.trim();
    let found: Person[] = [];
    this.finderHint = '';
    try {
      found = (await this.api.get<{ people: Person[] }>('/v1/people' + (q ? '?q=' + encodeURIComponent(q) : ''))).people;
    } catch {
      // Without the People list, fall back to the scoped colleague search (two letters or more). Nothing is scanned on the client.
      if (q.length < 2) {
        this.finderHint = 'Type at least two letters of a name or code, then search.';
      } else {
        found = (await this.api.get<{ people: Array<{ id: string; name: string; code: string }> }>('/v1/directory?q=' + encodeURIComponent(q))).people as unknown as Person[];
      }
    }
    const selected = this.people.find((person) => person.id === this.employeeId);
    this.people = found;
    if (selected && !this.people.some((person) => person.id === selected.id)) this.people = [selected, ...this.people];
  }

  async loadPerson(): Promise<void> {
    this.error = '';
    this.ok = '';
    if (!this.employeeId) { this.pack = null; return; }
    try {
      this.pack = await this.api.get<PayPack>('/v1/pay/' + this.employeeId);
      if (this.pack.layout) this.layout = this.pack.layout;
      if (this.pack.structure) {
        this.effectiveFrom = this.pack.structure.effectiveFrom;
        this.structurePublished = this.pack.structure.published;
        this.structureLines = this.pack.structure.lines.map((line) => ({ side: line.side, name: line.name, rupees: line.rupees, show: true }));
      }
      this.applySlip();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load that pay record.';
    }
  }

  applySlip(): void {
    if (!this.pack) return;
    const exact = this.pack.slips.find((item) => item.month === this.month);
    if (exact) {
      this.slipHint = '';
      this.slipPublished = exact.published;
      this.note = exact.note;
      this.paidDays = exact.paidDays || '';
      this.lopDays = exact.lopDays || '';
      this.slipLines = exact.lines.map((line) => ({ side: line.side, name: line.name, rupees: line.rupees, show: line.show !== false }));
      return;
    }
    const previous = this.pack.slips[0];
    if (previous) {
      this.slipHint = 'Filled from ' + previous.label + '. Nothing is saved until you save this month.';
      this.slipPublished = false;
      this.note = previous.note;
      this.paidDays = previous.paidDays || '';
      this.lopDays = previous.lopDays || '';
      this.slipLines = previous.lines.map((line) => ({ side: line.side, name: line.name, rupees: line.rupees, show: line.show !== false }));
      return;
    }
    if (this.pack.structure?.lines.length) {
      this.slipHint = 'Filled from the CTC as a monthly starting point. Nothing is saved until you save.';
      this.slipPublished = false;
      this.slipLines = this.pack.structure.lines.map((line) => ({ side: line.side === 'employer' ? 'employer' : 'earning', name: line.name, rupees: this.perMonth(line.rupees), show: true }));
    }
  }

  private perMonth(annual: string): string {
    const value = Number(annual);
    if (!Number.isFinite(value)) return '';
    return (Math.round((value / 12) * 100) / 100).toFixed(2);
  }

  pickForm(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.formName = file.name;
    const reader = new FileReader();
    reader.onload = () => { this.formData = String(reader.result || ''); };
    reader.readAsDataURL(file);
  }

  async saveLayout(): Promise<void> {
    if (!this.layout) return;
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      this.layout = await this.api.post<SlipLayout>('/v1/pay/layout', this.layout);
      if (this.employeeId) await this.loadPerson();
      this.ok = 'Slip design saved. It applies to every employee.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save the slip design.';
    } finally {
      this.busy = false;
    }
  }

  async saveStructure(): Promise<void> {
    await this.run('CTC saved.', () => this.api.post('/v1/pay/structure', {
      employeeId: this.employeeId,
      effectiveFrom: this.effectiveFrom,
      published: this.structurePublished,
      lines: this.structureLines,
    }));
  }

  async saveSlip(): Promise<void> {
    await this.run('Salary month saved.', () => this.api.post('/v1/pay/slip', {
      employeeId: this.employeeId,
      month: this.month,
      published: this.slipPublished,
      note: this.note,
      paidDays: this.paidDays,
      lopDays: this.lopDays,
      lines: this.slipLines,
    }));
  }

  async saveForm(): Promise<void> {
    await this.run('Form 16 saved.', () => this.api.post('/v1/pay/form', {
      employeeId: this.employeeId,
      year: this.year,
      published: this.formPublished,
      fileName: this.formName,
      data: this.formData,
    }));
  }

  async removeForm(id: string): Promise<void> {
    await this.run('Form 16 removed.', () => this.api.post('/v1/pay/form/delete', { id }));
  }

  /** Fills the CTC lines from a template. The server works the amounts out; nothing is saved for the person. */
  async applyTemplate(): Promise<void> {
    await this.template(async () => {
      const result = await this.api.post<{ annual: string; lines: EditorLine[] }>('/v1/pay/ctc-templates/apply', { templateId: this.templateId, annualCtc: this.templateCtc });
      this.structureLines = result.lines.map((line) => ({ side: line.side, name: line.name, rupees: line.rupees, show: true }));
      this.ok = 'Filled the lines for ' + result.annual + '. Check them, then save the CTC.';
    });
  }

  /** Turns the lines on screen into shares of their total, so the same split can be reused for another person. */
  async saveTemplate(): Promise<void> {
    await this.template(async () => {
      const lines = this.structureLines.filter((line) => line.name.trim() && Number(line.rupees) > 0);
      const total = lines.reduce((sum, line) => sum + Number(line.rupees), 0);
      if (!lines.length || total <= 0) throw new Error('Fill in the CTC lines with amounts first. A template stores each line as a share of the total.');
      const shares = lines.map((line) => Math.round((Number(line.rupees) / total) * 10000) / 100);
      const drift = Math.round((100 - shares.reduce((sum, value) => sum + value, 0)) * 100) / 100;
      shares[shares.indexOf(Math.max(...shares))] += drift;
      const existing = this.ctcTemplates.find((item) => item.name.toLowerCase() === this.templateName.trim().toLowerCase());
      const result = await this.api.post<{ templates: CtcTemplate[] }>('/v1/pay/ctc-templates', {
        id: existing?.id,
        name: this.templateName.trim(),
        lines: lines.map((line, index) => ({ side: line.side, name: line.name.trim(), percent: shares[index], show: line.show !== false })),
      });
      this.ctcTemplates = result.templates;
      this.templateId = result.templates.find((item) => item.name.toLowerCase() === this.templateName.trim().toLowerCase())?.id || '';
      this.ok = 'Template saved.';
    });
  }

  async removeTemplate(): Promise<void> {
    if (!this.templateId) return;
    await this.template(async () => {
      const result = await this.api.post<{ templates: CtcTemplate[] }>('/v1/pay/ctc-templates/delete', { id: this.templateId });
      this.ctcTemplates = result.templates;
      this.templateId = '';
      this.ok = 'Template removed.';
    });
  }

  private async template(work: () => Promise<void>): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      await work();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not use the template.';
    } finally {
      this.busy = false;
    }
  }

  private async run(message: string, work: () => Promise<unknown>): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      await work();
      this.ok = message;
      await this.loadPerson();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save.';
    } finally {
      this.busy = false;
    }
  }
}
