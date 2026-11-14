import { Component, HostListener, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { errorText } from '../shared/kit';
import { ModalComponent } from '../shared/modal.component';
import { PhotoComponent } from '../shared/photo.component';
import { Sweet } from '../shared/sweet';
import { Toast } from '../shared/toast';

type Status = 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';
type Category = 'leave' | 'attendance' | 'dossier' | 'separation' | 'pay';
type StepState = 'approved' | 'rejected' | 'cancelled' | 'pending' | 'upcoming' | 'skipped';

interface Person { employeeId: string; name: string; designation: string; email: string; phone: string }
interface Step { label: string; state: StepState; people: Person[]; by: string; at: string; note: string; override: boolean }
interface Tx {
  id: string;
  source: string;
  category: Category;
  type: string;
  appliedOn: string;
  summary: string;
  status: Status;
  statusLabel: string;
  pendingWith: string;
  cancel: { url: string; body: Record<string, string> } | null;
  facts: Array<{ label: string; value: string }>;
  reason: string;
  chain: Step[];
}
interface Board { items: Tx[]; categories: Array<{ key: Category; label: string; count: number; pending: number }>; from: string; to: string }

const ICONS: Record<Category, string> = {
  leave: 'bi-calendar2-week',
  attendance: 'bi-clock-history',
  dossier: 'bi-person-vcard',
  separation: 'bi-box-arrow-right',
  pay: 'bi-wallet2',
};
const STATUSES: Array<{ key: Status | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'pending', label: 'Pending' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

@Component({
  selector: 'app-requests',
  imports: [FormsModule, ModalComponent, PhotoComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-inbox"></i></span>
        <p class="eyebrow">My day</p>
        <h1>My transaction history</h1>
        <p class="lede">Everything you have asked for, where it is now, and who approved each step. Cancel while a request is still waiting.</p>
      </div>
    </div>

    <div class="tx-layout">
      <nav class="card tx-side" aria-label="Request types">
        <button type="button" class="tx-cat" [class.is-active]="category === 'all'" (click)="category = 'all'">
          <i class="bi bi-bell" aria-hidden="true"></i><span>All requests</span><b>{{ items.length }}</b>
        </button>
        @for (item of categories; track item.key) {
          <button type="button" class="tx-cat" [class.is-active]="category === item.key" (click)="category = item.key">
            <i class="bi {{ icon(item.key) }}" aria-hidden="true"></i>
            <span>{{ item.label }}</span>
            @if (item.pending) { <em class="tx-cat-wait" [attr.aria-label]="item.pending + ' waiting'">{{ item.pending }}</em> }
            <b>{{ item.count }}</b>
          </button>
        }
      </nav>

      <section class="card tx-main">
        <div class="tx-tools">
          <label class="tx-search">
            <i class="bi bi-search" aria-hidden="true"></i>
            <span class="sr-only">Search</span>
            <input type="search" [(ngModel)]="query" placeholder="Search by type, date, or approver" autocomplete="off">
          </label>
          <div class="seg-mini" role="group" aria-label="Date range">
            <button type="button" [class.is-active]="range === 'this'" (click)="setRange('this')">This year</button>
            <button type="button" [class.is-active]="range === 'last'" (click)="setRange('last')">Last year</button>
            <button type="button" [class.is-active]="range === 'custom'" (click)="setRange('custom')">Custom</button>
          </div>
        </div>
        @if (range === 'custom') {
          <div class="tx-custom">
            <label>From <input type="date" [(ngModel)]="from" [max]="to"></label>
            <label>To <input type="date" [(ngModel)]="to" [min]="from"></label>
            <button type="button" class="btn btn-primary btn-sm" (click)="load()" [disabled]="!from || !to">Show</button>
          </div>
        }

        <div class="seg-mini mx-tabs tx-status" role="tablist" aria-label="Status">
          @for (item of statuses; track item.key) {
            <button type="button" role="tab" [attr.aria-selected]="status === item.key" [class.is-active]="status === item.key" (click)="status = item.key">
              {{ item.label }} <small>{{ countOf(item.key) }}</small>
            </button>
          }
        </div>

        @if (loading) {
          <p class="muted tx-wait"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> Loading your requests…</p>
        } @else if (!shown.length) {
          <div class="empty-state">
            <i class="bi bi-inbox" aria-hidden="true"></i>
            <strong>Nothing here</strong>
            <p>{{ items.length ? 'No request matches these filters.' : 'You have not asked for anything in this period.' }}</p>
          </div>
        } @else {
          <div class="tx-head" aria-hidden="true">
            <span>Applied</span><span>Details</span><span>Pending with</span><span></span>
          </div>
          <ul class="tx-list">
            @for (item of shown; track item.id) {
              <li class="tx-row">
                <div class="tx-date">
                  <strong>{{ day(item.appliedOn) }}</strong>
                  <small>{{ time(item.appliedOn) }}</small>
                </div>
                <div class="tx-detail">
                  <div class="tx-title">
                    <i class="bi {{ icon(item.category) }}" aria-hidden="true"></i>
                    <strong>{{ item.type }}</strong>
                    <span class="chip chip-dot {{ tone(item.status) }}">{{ item.statusLabel }}</span>
                  </div>
                  <p>{{ item.summary }}</p>
                </div>
                <div class="tx-with">
                  @if (waiting(item); as step) {
                    <div class="tx-faces">
                      @for (person of step.people.slice(0, 3); track person.employeeId + person.name) {
                        <app-photo [personId]="person.employeeId" [name]="person.name" size="sm" />
                      }
                    </div>
                    <span>{{ item.pendingWith }}</span>
                  } @else {
                    <span class="muted">—</span>
                  }
                </div>
                <div class="tx-actions">
                  @if (item.cancel) {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="cancel(item)">Cancel</button>
                  }
                  <button type="button" class="btn btn-sm" (click)="open = item">View</button>
                </div>
              </li>
            }
          </ul>
        }
      </section>
    </div>

    <app-modal [open]="!!open" size="lg" [title]="open?.type || ''" [subtitle]="open ? 'Applied on ' + day(open.appliedOn) + ', ' + time(open.appliedOn) : ''" [icon]="open ? icon(open.category) : 'bi-inbox'" [tone]="open ? modalTone(open.status) : 'navy'" (closed)="open = null; card = ''">
      @if (open) {
        <div class="tx-banner {{ tone(open.status) }}">
          <i class="bi {{ statusIcon(open.status) }}" aria-hidden="true"></i>
          <div>
            <strong>{{ open.statusLabel }}</strong>
            <span>{{ open.summary }}</span>
          </div>
        </div>

        <div class="field-grid mx-facts">
          @for (fact of open.facts; track fact.label) {
            <div><small>{{ fact.label }}</small><strong>{{ fact.value }}</strong></div>
          }
        </div>

        @if (open.reason) {
          <div class="mx-panel tx-remarks">
            <h3><i class="bi bi-chat-left-text" aria-hidden="true"></i> Your remarks</h3>
            <p>{{ open.reason }}</p>
          </div>
        }

        <div class="mx-panel">
          <h3><i class="bi bi-diagram-3" aria-hidden="true"></i> Approval process for this {{ open.type.toLowerCase() }}</h3>
          <ol class="tx-chain">
            @for (step of open.chain; track $index) {
              <li class="tx-step is-{{ step.state }}">
                <span class="tx-node" aria-hidden="true"><i class="bi {{ stepIcon(step.state) }}"></i></span>
                <div class="tx-step-body">
                  <div class="tx-step-head">
                    <strong>{{ $index + 1 }}. {{ step.label }}</strong>
                    <span class="chip chip-dot {{ stepTone(step.state) }}">{{ stepLabel(step.state) }}</span>
                    @if (step.override) { <span class="chip is-info" title="Decided by someone with company-wide approval access">Override</span> }
                  </div>
                  <div class="tx-people">
                    @for (person of step.people; track person.employeeId + person.name) {
                      <div class="tx-person" [class.is-open]="card === $index + ':' + person.name">
                        <button type="button" class="tx-person-btn" (click)="toggleCard($index + ':' + person.name)" [attr.aria-expanded]="card === $index + ':' + person.name">
                          <app-photo [personId]="person.employeeId" [name]="person.name" size="md" />
                          <span>{{ person.name }}</span>
                        </button>
                        <div class="tx-card" role="dialog" [attr.aria-label]="person.name">
                          <div class="tx-card-head">
                            <app-photo [personId]="person.employeeId" [name]="person.name" size="md" />
                            <div><strong>{{ person.name }}</strong><small>{{ person.designation || step.label }}</small></div>
                          </div>
                          <dl>
                            <dt>Contact no.</dt>
                            <dd>@if (person.phone) { <a [href]="'tel:' + person.phone.replace(' ', '')">{{ person.phone }}</a> } @else { — }</dd>
                            <dt>Email</dt>
                            <dd>@if (person.email) { <a [href]="'mailto:' + person.email">{{ person.email }}</a> } @else { — }</dd>
                          </dl>
                        </div>
                      </div>
                    } @empty {
                      <span class="muted">No one is set for this step.</span>
                    }
                  </div>
                  @if (step.by || step.at) {
                    <p class="tx-by">
                      {{ step.state === 'rejected' ? 'Declined' : step.state === 'cancelled' ? 'Cancelled' : 'Approved' }}{{ step.by ? ' by ' + step.by : '' }}{{ step.at ? ' on ' + day(step.at) + ', ' + time(step.at) : '' }}
                    </p>
                  }
                  @if (step.note) { <p class="tx-note">“{{ step.note }}”</p> }
                </div>
              </li>
            }
          </ol>
        </div>
      }
      <footer modalFooter class="md-foot">
        @if (open?.cancel) {
          <button type="button" class="btn btn-danger-solid" (click)="cancel(open!)">Cancel request</button>
        }
        <button type="button" class="btn" (click)="open = null; card = ''">Close</button>
      </footer>
    </app-modal>
  `,
})
export class RequestsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly toast = inject(Toast);
  readonly statuses = STATUSES;
  items: Tx[] = [];
  categories: Board['categories'] = [];
  category: Category | 'all' = 'all';
  status: Status | 'all' = 'all';
  range: 'this' | 'last' | 'custom' = 'this';
  from = '';
  to = '';
  query = '';
  loading = true;
  open: Tx | null = null;
  card = '';

  async ngOnInit(): Promise<void> {
    this.setRange('this');
  }

  @HostListener('document:keydown.escape')
  closeCard(): void {
    this.card = '';
  }

  get inCategory(): Tx[] {
    return this.category === 'all' ? this.items : this.items.filter((item) => item.category === this.category);
  }

  get shown(): Tx[] {
    const words = this.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return this.inCategory.filter((item) => {
      if (this.status !== 'all' && item.status !== this.status) return false;
      if (!words.length) return true;
      const hay = [item.type, item.summary, item.statusLabel, item.pendingWith, this.day(item.appliedOn), ...item.facts.map((fact) => fact.value), ...item.chain.flatMap((step) => [step.by, ...step.people.map((person) => person.name)])].join(' ').toLowerCase();
      return words.every((word) => hay.includes(word));
    });
  }

  countOf(key: Status | 'all'): number {
    return key === 'all' ? this.inCategory.length : this.inCategory.filter((item) => item.status === key).length;
  }

  setRange(range: 'this' | 'last' | 'custom'): void {
    this.range = range;
    const year = new Date().getFullYear();
    if (range === 'this') { this.from = `${year}-01-01`; this.to = `${year}-12-31`; }
    if (range === 'last') { this.from = `${year - 1}-01-01`; this.to = `${year - 1}-12-31`; }
    if (range !== 'custom') void this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    try {
      const data = await this.api.get<Board>(`/v1/transactions?from=${this.from}&to=${this.to}`);
      this.items = data.items;
      this.categories = data.categories;
      if (this.open) this.open = this.items.find((item) => item.id === this.open!.id) || null;
    } catch (error) {
      this.toast.error(errorText(error, 'Could not load your requests.'));
    } finally {
      this.loading = false;
    }
  }

  async cancel(item: Tx): Promise<void> {
    if (!item.cancel) return;
    const yes = await this.sweet.confirm({ title: `Cancel this ${item.type.toLowerCase()}?`, text: 'The approvers will no longer see it. You can send a new request later.', confirmText: 'Cancel request', danger: true });
    if (!yes) return;
    try {
      await this.api.post(item.cancel.url, item.cancel.body);
      this.toast.success('Request cancelled.');
      await this.load();
    } catch (error) {
      this.toast.error(errorText(error, 'Could not cancel that request.'));
    }
  }

  toggleCard(key: string): void {
    this.card = this.card === key ? '' : key;
  }

  waiting(item: Tx): Step | null {
    return item.status === 'pending' ? item.chain.find((step) => step.state === 'pending') || null : null;
  }

  icon(category: Category): string {
    return ICONS[category] || 'bi-inbox';
  }

  tone(status: Status): string {
    return status === 'approved' ? 'is-ok' : status === 'pending' ? 'is-warn' : status === 'rejected' ? 'is-bad' : status === 'draft' ? 'is-info' : '';
  }

  modalTone(status: Status): 'ok' | 'warn' | 'bad' | 'info' | 'navy' {
    return status === 'approved' ? 'ok' : status === 'pending' ? 'warn' : status === 'rejected' ? 'bad' : status === 'draft' ? 'info' : 'navy';
  }

  statusIcon(status: Status): string {
    return status === 'approved' ? 'bi-check-circle-fill' : status === 'pending' ? 'bi-hourglass-split' : status === 'rejected' ? 'bi-x-circle-fill' : status === 'draft' ? 'bi-pencil-square' : 'bi-slash-circle';
  }

  stepIcon(state: StepState): string {
    return state === 'approved' ? 'bi-check-lg' : state === 'rejected' ? 'bi-x-lg' : state === 'pending' ? 'bi-hourglass-split' : state === 'cancelled' ? 'bi-slash-lg' : 'bi-dot';
  }

  stepTone(state: StepState): string {
    return state === 'approved' ? 'is-ok' : state === 'pending' ? 'is-warn' : state === 'rejected' ? 'is-bad' : '';
  }

  stepLabel(state: StepState): string {
    return { approved: 'Approved', rejected: 'Declined', cancelled: 'Cancelled', pending: 'Waiting', upcoming: 'Next', skipped: 'Not needed' }[state];
  }

  day(iso: string): string {
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  }

  time(iso: string): string {
    const date = new Date(iso);
    return Number.isFinite(date.getTime()) ? date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
  }
}
