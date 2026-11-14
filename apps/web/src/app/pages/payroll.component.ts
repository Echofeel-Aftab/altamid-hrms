import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Person } from '../core/models';
import { PayrollMonthComponent } from './payroll-month.component';

interface EditorLine { side: string; name: string; rupees: string; show: boolean }
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

@Component({
  selector: 'app-payroll',
  imports: [FormsModule, PayrollMonthComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-cash-stack"></i></span>
        <p class="eyebrow">Payroll</p>
        <h1>Publish pay</h1>
        <p class="lede">Design the salary by hand, then choose what the employee’s slip includes. Amounts are what you enter. PF, ESI, and tax are not calculated here.</p>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    <app-payroll-month (open)="openPerson($event)" (changed)="employeeId && loadPerson()" />
    @if (layout) {
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
    <section class="card" id="pay-person-card">
      <label for="pay-find">Find a person</label>
      <div class="split">
        <input id="pay-find" name="payFind" [(ngModel)]="finder" placeholder="Name or code" (keyup.enter)="findPeople()">
        <button type="button" class="btn btn-ghost" (click)="findPeople()"><i class="bi bi-search"></i> Search</button>
      </div>
      <label for="pay-person">Person</label>
      <select id="pay-person" [(ngModel)]="employeeId" (ngModelChange)="loadPerson()">
        <option value="">Choose a person</option>
        @for (person of people; track person.id) { <option [value]="person.id">{{ person.name }} · {{ person.code }}</option> }
      </select>
    </section>
    @if (pack) {
      <section class="card">
        <h2><i class="bi bi-pie-chart"></i> CTC breakup</h2>
        <p class="muted">{{ pack.structure ? 'Annual CTC ' + pack.structure.annual : 'No CTC published yet.' }}</p>
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
        </form>
      </section>
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
  `,
})
export class PayrollComponent implements OnInit {
  private readonly api = inject(ApiService);
  people: Person[] = [];
  finder = '';
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

  async ngOnInit(): Promise<void> {
    try {
      await this.findPeople();
      this.layout = await this.api.get<SlipLayout>('/v1/pay/layout');
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
    await this.loadPerson();
    setTimeout(() => document.getElementById('pay-person-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
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
    const listed = await this.api.get<{ people: Person[] }>('/v1/people' + (q ? '?q=' + encodeURIComponent(q) : ''));
    const selected = this.people.find((person) => person.id === this.employeeId);
    this.people = listed.people;
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
