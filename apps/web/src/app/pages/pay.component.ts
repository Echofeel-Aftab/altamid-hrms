import { Component, inject, OnInit } from '@angular/core';
import { ApiService } from '../core/api.service';
import { Sweet } from '../shared/sweet';

interface PayLine { side: string; name: string; amount: string; show?: boolean }
interface PayFact { label: string; value: string }
interface PayView {
  person: { name: string; code: string } | null;
  structure: { effectiveFrom: string; published: boolean; annual: string; lines: PayLine[] } | null;
  slips: Array<{ id: string; month: string; label: string; published: boolean; note: string; net: string; lines: PayLine[]; facts: PayFact[] }>;
  forms: Array<{ id: string; year: string; published: boolean }>;
}

@Component({
  selector: 'app-pay',
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-wallet2"></i></span>
        <p class="eyebrow">My pay</p>
        <h1>Salary</h1>
        <p class="lede">Your CTC, each published month, and Form 16. These are the figures payroll entered. This screen does not calculate PF, ESI, or tax.</p>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (view) {
      <section class="card">
        <h2><i class="bi bi-pie-chart"></i> CTC breakup</h2>
        @if (!view.structure) {
          <p class="muted">Payroll has not published a CTC yet.</p>
        } @else {
          <p class="muted">From {{ view.structure.effectiveFrom }}</p>
          <ul class="pay-lines">
            @for (line of view.structure.lines; track line.name + line.side) {
              <li><span>{{ line.name }} <span class="muted">{{ sideLabel(line.side) }}</span></span><strong>{{ line.amount }}</strong></li>
            }
            <li class="pay-net"><span>Annual CTC</span><strong>{{ view.structure.annual }}</strong></li>
          </ul>
        }
      </section>
      <section class="card">
        <h2><i class="bi bi-calendar3"></i> Monthly breakup</h2>
        @if (!view.slips.length) {
          <p class="muted">No salary month has been published yet.</p>
        } @else {
          <div class="people-filters">
            @for (slip of view.slips; track slip.id) {
              <button type="button" class="btn" [class.btn-primary]="slip.id === selected" [class.btn-ghost]="slip.id !== selected" (click)="selected = slip.id">{{ slip.label }}</button>
            }
          </div>
          @if (openSlip) {
            <section class="slip">
              <header>
                <div>
                  <strong>{{ openSlip.label }}</strong>
                  <p>{{ view.person?.name }}</p>
                </div>
              </header>
              @if (openSlip.facts.length) {
                <dl class="slip-facts">
                  @for (fact of openSlip.facts; track fact.label) {
                    <div><dt>{{ fact.label }}</dt><dd>{{ fact.value }}</dd></div>
                  }
                </dl>
              }
              @for (group of slipGroups(openSlip.lines); track group.side) {
                <p class="slip-kicker">{{ group.label }}</p>
                <table>
                  <tbody>
                    @for (line of group.lines; track line.name) {
                      <tr><td>{{ line.name }}</td><td class="amount">{{ line.amount }}</td></tr>
                    }
                  </tbody>
                </table>
              }
              <table>
                <tbody><tr class="net"><td>Net pay</td><td class="amount">{{ openSlip.net }}</td></tr></tbody>
              </table>
              @if (openSlip.note) { <p class="muted">{{ openSlip.note }}</p> }
              <p class="muted">Net pay is the earnings minus the deductions payroll entered. A line left off this copy is still part of that net.</p>
            </section>
          }
        }
      </section>
      <section class="card">
        <h2><i class="bi bi-file-earmark-text"></i> Form 16</h2>
        @if (!view.forms.length) { <p class="muted">No Form 16 has been published yet.</p> }
        @for (form of view.forms; track form.id) {
          <div class="row-between">
            <strong>Financial year {{ form.year }}</strong>
            <button type="button" class="btn btn-ghost" (click)="openForm(form.id, form.year)"><i class="bi bi-eye"></i> Preview</button>
          </div>
        }
      </section>
    }
  `,
})
export class PayComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  view: PayView | null = null;
  selected = '';
  error = '';

  get openSlip() {
    return this.view?.slips.find((slip) => slip.id === this.selected) || null;
  }

  slipGroups(lines: PayLine[]): Array<{ side: string; label: string; lines: PayLine[] }> {
    const order = [
      { side: 'earning', label: 'Earnings' },
      { side: 'deduction', label: 'Deductions' },
      { side: 'employer', label: 'Employer contributions' },
    ];
    return order
      .map((group) => ({ ...group, lines: lines.filter((line) => line.side === group.side) }))
      .filter((group) => group.lines.length);
  }

  async ngOnInit(): Promise<void> {
    try {
      this.view = await this.api.get<PayView>('/v1/pay');
      this.selected = this.view.slips[0]?.id || '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load your pay.';
    }
  }

  sideLabel(side: string): string {
    if (side === 'deduction') return 'deduction';
    if (side === 'employer') return 'employer';
    return 'earning';
  }

  async openForm(id: string, year = ''): Promise<void> {
    try {
      const blob = await this.api.blob('/v1/pay/form/' + id);
      await this.sweet.preview({ title: 'Form 16' + (year ? ' · FY ' + year : ''), subtitle: 'Tax certificate', blob, fileName: 'Form16' + (year ? '-' + year : '') + '.pdf' });
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not open that Form 16.';
    }
  }
}
