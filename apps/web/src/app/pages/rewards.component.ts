import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { dayLabel, errorText, inr } from '../shared/kit';
import { Sweet } from '../shared/sweet';
import { Toast } from '../shared/toast';

type Kind = 'insurance' | 'wellness' | 'perk' | 'learning' | 'other';
interface Benefit { key: string; label: string; hint: string; annual: number; kind: Kind }
interface Config { benefits: Benefit[]; note: string }
interface Line { label: string; amount: number; text?: string; hint?: string; kind?: string }
interface Block { key: string; label: string; hint: string; lines: Line[]; total: number }
interface Statement {
  year: string;
  person: { id: string; name: string; code: string; designation: string; department: string; joined: string };
  ctc: number; effectiveFrom: string; blocks: Block[]; total: number; flex: Array<{ label: string; amount: number }>;
  recognition: number; growth: { from: number; since: string; percent: number } | null; note: string;
}
interface View { canDesk: boolean; config: Config; kinds: Kind[]; statement: Statement | null; people: Array<{ id: string; name: string; code: string }> }

const BLOCK_LOOK: Record<string, { icon: string; tone: string }> = {
  cash: { icon: 'bi-wallet2', tone: 'is-navy' },
  company: { icon: 'bi-building-check', tone: 'is-gold' },
  benefits: { icon: 'bi-heart-pulse', tone: 'is-ok' },
  time: { icon: 'bi-sun', tone: 'is-info' },
};
const KIND_LABEL: Record<Kind, string> = { insurance: 'Insurance', wellness: 'Wellness', perk: 'Perk', learning: 'Learning', other: 'Other' };

@Component({
  selector: 'app-rewards',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-gift"></i></span>
        <p class="eyebrow">My pay</p>
        <h1>Total rewards</h1>
        <p class="lede">Everything you get for your work in one view: cash pay, what the company pays for you, benefits and paid time off.</p>
      </div>
      @if (view?.statement) { <button type="button" class="btn btn-gold" (click)="download()" [disabled]="busy"><i class="bi bi-file-earmark-pdf"></i> Statement PDF</button> }
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (view?.canDesk) {
      <div class="mx-tabs-row">
        <div class="seg-mini mx-tabs" role="tablist">
          <button type="button" role="tab" [class.is-active]="tab === 'statement'" (click)="tab = 'statement'"><i class="bi bi-receipt"></i> Statement</button>
          <button type="button" role="tab" [class.is-active]="tab === 'setup'" (click)="openSetup()"><i class="bi bi-gear"></i> Benefits setup</button>
        </div>
        @if (tab === 'statement') {
          <select [ngModel]="personId" (ngModelChange)="pick($event)" aria-label="Show the statement for">
            <option value="">My statement</option>
            @for (person of view!.people; track person.id) { <option [value]="person.id">{{ person.name }} · {{ person.code }}</option> }
          </select>
        }
      </div>
    }

    @if (view && tab === 'statement') {
      @if (view.statement; as s) {
        <section class="card mx-hero">
          <div>
            <small>Total rewards · FY {{ s.year }}</small>
            <strong>{{ money(s.total) }}</strong>
            <p>{{ s.person.name }} · {{ s.person.designation || 'Team member' }}@if (s.person.department) { · {{ s.person.department }} }</p>
          </div>
          <div class="mx-hero-side">
            <div><small>CTC</small><b>{{ money(s.ctc) }}</b>@if (s.effectiveFrom) { <small>since {{ day(s.effectiveFrom) }}</small> }</div>
            @if (s.growth) { <div><small>Growth</small><b class="mx-up"><i class="bi bi-arrow-up-right"></i> {{ s.growth.percent }}%</b><small>from {{ money(s.growth.from) }} in {{ day(s.growth.since) }}</small></div> }
            <div><small>Recognitions</small><b><i class="bi bi-award"></i> {{ s.recognition }}</b><small>this year</small></div>
          </div>
        </section>
        @if (s.total) {
          <div class="mx-stack" role="img" [attr.aria-label]="stackLabel(s)">
            @for (block of counted(s); track block.key) {
              @if (block.total) { <span [class]="'mx-stack-part ' + look(block.key).tone" [style.flex-grow]="block.total" [title]="block.label + ': ' + money(block.total)"></span> }
            }
          </div>
          <div class="mx-legend">
            @for (block of counted(s); track block.key) {
              @if (block.total) { <span><i [class]="'mx-dot ' + look(block.key).tone"></i> {{ block.label }} · {{ percent(block.total, s.total) }}%</span> }
            }
          </div>
        }
        <div class="mx-blocks">
          @for (block of s.blocks; track block.key) {
            <section class="card mx-block">
              <div class="card-head">
                <h2><span [class]="'mx-block-ico ' + look(block.key).tone"><i class="bi" [class]="look(block.key).icon"></i></span> {{ block.label }}</h2>
                <strong>{{ block.total ? money(block.total) : '' }}</strong>
              </div>
              <p class="muted mx-fine">{{ block.hint }}@if (block.key === 'time') { · shown for information, not added to the total }</p>
              @if (block.lines.length) {
                <ul class="mx-lines">
                  @for (line of block.lines; track $index) {
                    <li><span>{{ line.label }}@if (line.hint) { <small>{{ line.hint }}</small> }</span><b>{{ line.amount ? money(line.amount) : line.text || 'Included' }}</b></li>
                  }
                </ul>
              } @else {
                <p class="muted">Nothing here yet.</p>
              }
              @if (block.key === 'cash' && s.flex.length) {
                <p class="mx-fine muted mx-row-gap"><i class="bi bi-sliders2"></i> Your approved choice pay: {{ flexText(s) }}</p>
              }
            </section>
          }
        </div>
        @if (s.note) { <p class="mx-note"><i class="bi bi-info-circle"></i> {{ s.note }}</p> }
      } @else {
        <section class="card empty-state"><i class="bi bi-gift"></i><h2>No statement yet</h2><p class="muted">Your statement appears once payroll publishes your salary structure.</p></section>
      }
    }

    @if (view && tab === 'setup' && setup) {
      <section class="card">
        <div class="card-head"><h2><i class="bi bi-heart-pulse"></i> Benefits on every statement</h2></div>
        <p class="muted">Add the yearly cost per person. Leave it at 0 to show the benefit as “Included”.</p>
        <div class="table-responsive">
          <table class="mx-settle">
            <thead><tr><th>Benefit</th><th>Hint</th><th>Type</th><th>Yearly value</th><th></th></tr></thead>
            <tbody>
              @for (item of setup.benefits; track $index) {
                <tr>
                  <td><input [(ngModel)]="item.label" maxlength="80" aria-label="Benefit"></td>
                  <td><input [(ngModel)]="item.hint" maxlength="160" aria-label="Hint"></td>
                  <td><select [(ngModel)]="item.kind" aria-label="Type">@for (kind of view.kinds; track kind) { <option [value]="kind">{{ kindLabel(kind) }}</option> }</select></td>
                  <td><input type="number" min="0" class="mx-num" [(ngModel)]="item.annual" aria-label="Yearly value"></td>
                  <td><button type="button" class="mx-x" (click)="setup.benefits.splice($index, 1)" aria-label="Remove"><i class="bi bi-trash"></i></button></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <label for="rw-note">Note at the bottom of every statement</label>
        <textarea id="rw-note" rows="2" maxlength="600" [(ngModel)]="setup.note"></textarea>
        <div class="actions mx-savebar">
          <button type="button" class="btn btn-ghost" (click)="addBenefit()"><i class="bi bi-plus-lg"></i> Add a benefit</button>
          <button type="button" class="btn btn-gold" (click)="saveSetup()" [disabled]="busy"><i class="bi bi-check2"></i> Save</button>
        </div>
      </section>
    }
  `,
})
export class RewardsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly toast = inject(Toast);
  view: View | null = null;
  tab: 'statement' | 'setup' = 'statement';
  personId = '';
  setup: Config | null = null;
  busy = false;
  error = '';

  ngOnInit(): void { void this.load(); }

  async load(): Promise<void> {
    try {
      this.view = await this.api.get<View>('/v1/rewards' + (this.personId ? '?person=' + this.personId : ''));
      this.error = '';
    } catch (error) {
      this.error = errorText(error, 'Could not load total rewards.');
    }
  }

  money(value: number): string { return inr(value); }
  day(value: string): string { return dayLabel(value); }
  look(key: string) { return BLOCK_LOOK[key] || BLOCK_LOOK['cash']; }
  kindLabel(kind: Kind): string { return KIND_LABEL[kind]; }
  counted(s: Statement): Block[] { return s.blocks.filter((block) => block.key !== 'time'); }
  percent(part: number, total: number): number { return total ? Math.round(part / total * 100) : 0; }
  flexText(s: Statement): string { return s.flex.map((line) => `${line.label} ${this.money(line.amount)}`).join(', '); }
  stackLabel(s: Statement): string { return this.counted(s).map((block) => `${block.label} ${this.percent(block.total, s.total)}%`).join(', '); }

  pick(id: string): void {
    this.personId = id;
    void this.load();
  }

  async download(): Promise<void> {
    const s = this.view?.statement;
    if (!s) return;
    this.busy = true;
    try {
      const blob = await this.api.blob('/v1/rewards/pdf' + (this.personId ? '?person=' + this.personId : ''));
      await this.sweet.preview({ title: 'Total rewards statement', subtitle: `${s.person.name} · FY ${s.year}`, blob, fileName: `total-rewards-${s.person.code}-${s.year}.pdf` });
    } catch (error) {
      this.toast.error(errorText(error, 'Could not make the statement.'));
    }
    this.busy = false;
  }

  openSetup(): void {
    this.tab = 'setup';
    if (this.view) this.setup = JSON.parse(JSON.stringify(this.view.config)) as Config;
  }

  addBenefit(): void {
    this.setup?.benefits.push({ key: '', label: 'New benefit', hint: '', annual: 0, kind: 'perk' });
  }

  async saveSetup(): Promise<void> {
    if (!this.setup) return;
    this.busy = true;
    try {
      this.view = await this.api.post<View>('/v1/rewards/config', this.setup);
      this.setup = JSON.parse(JSON.stringify(this.view.config)) as Config;
      this.personId = '';
      this.toast.success('Benefits saved. Every statement shows them now.');
    } catch (error) {
      this.toast.error(errorText(error, 'Could not save the benefits.'));
    }
    this.busy = false;
  }
}
