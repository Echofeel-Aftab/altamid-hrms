import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { DataColumn, DataTableComponent, RowActionsDirective } from '../shared/data-table.component';
import { ListingFilterItem, ListingFiltersComponent } from '../shared/listing-filters.component';
import { PhotoComponent } from '../shared/photo.component';
import { ModalComponent } from '../shared/modal.component';
import { PasswordToggleDirective } from '../shared/password-toggle.directive';

interface AssetRow {
  id: string;
  name: string;
  tag: string;
  kind: string;
  kindLabel: string;
  icon: string;
  brand: string;
  model: string;
  serialNo: string;
  specs: string;
  condition: string;
  status: string;
  statusLabel: string;
  issuedOn: string;
  returnedOn: string;
  holder: string;
  code: string;
  inStock: boolean;
  locationId: string;
  location: string;
  purchasedOn: string;
  warrantyUntil: string;
  warrantyState: string;
  cost: string;
  costRupees: string;
  vendor: string;
  invoiceNo: string;
  note: string;
}
interface Kind { key: string; label: string; icon: string; group: string }
interface DetailOption { value: string; label: string; group?: string; brand?: string }
interface DetailField {
  key: string;
  label: string;
  kind: 'text' | 'select' | 'date' | 'number' | 'secret';
  options?: DetailOption[];
  placeholder?: string;
  hint?: string;
  pattern?: string;
  patternMessage?: string;
  upper?: boolean;
  max?: number;
  min?: number;
  maxValue?: number;
  wide?: boolean;
  showIf?: { field: string; equals?: string[]; notEquals?: string[] };
}
interface KindDetails { title: string; lead: string; brands: string[]; fields: DetailField[] }
interface DetailValues { fields: Record<string, string>; secrets: Record<string, string>; summary: string }
interface Stats { total: number; issued: number; stock: number; repair: number; value: string; warranty: number }
interface HistoryRow { id: string; kind: string; day: string; detail: string; by: string }
type Draft = Record<string, string>;

const BLANK: Draft = {
  name: '', tag: '', kind: 'laptop', brand: '', model: '', serialNo: '', specs: '', condition: 'new', purchasedOn: '',
  warrantyUntil: '', costPaise: '', vendor: '', invoiceNo: '', locationId: '', note: '',
};
const EVENT_ICON: Record<string, string> = {
  added: 'bi-plus-circle', issued: 'bi-box-arrow-up-right', returned: 'bi-box-arrow-in-down-left', updated: 'bi-pencil',
  repair: 'bi-wrench-adjustable', stock: 'bi-check2-circle', retired: 'bi-archive', lost: 'bi-question-octagon',
};

@Component({
  selector: 'app-assets',
  imports: [FormsModule, PhotoComponent, DataTableComponent, RowActionsDirective, ModalComponent, PasswordToggleDirective, ListingFiltersComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-laptop"></i></span>
        <p class="eyebrow">Company</p>
        <h1>Assets</h1>
        <p class="lede">{{ manage ? 'Every laptop, phone, card, vehicle, and licence the company owns, who has it, and what it cost.' : 'What the company has issued to you. Look after it and return it when you leave.' }}</p>
      </div>
      @if (manage && !editing) {
        <button type="button" class="btn btn-primary" (click)="startAdd()"><i class="bi bi-plus-lg"></i> Add an asset</button>
      }
    </div>
    @if (error) { <p class="form-error"><i class="bi bi-exclamation-octagon"></i> {{ error }}</p> }
    @if (ok) { <p class="form-ok"><i class="bi bi-check-circle"></i> {{ ok }}</p> }

    @if (manage && stats && !editing) {
      <div class="asset-stats">
        <article class="bento-stat"><span class="bento-ico"><i class="bi bi-boxes"></i></span><small>Total assets</small><strong>{{ stats.total }}</strong></article>
        <article class="bento-stat"><span class="bento-ico is-ok"><i class="bi bi-person-check"></i></span><small>Issued</small><strong>{{ stats.issued }}</strong></article>
        <article class="bento-stat"><span class="bento-ico"><i class="bi bi-box-seam"></i></span><small>In stock</small><strong>{{ stats.stock }}</strong></article>
        <article class="bento-stat"><span class="bento-ico is-gold"><i class="bi bi-wrench-adjustable"></i></span><small>In repair</small><strong>{{ stats.repair }}</strong></article>
        <article class="bento-stat"><span class="bento-ico is-gold"><i class="bi bi-currency-rupee"></i></span><small>Value in use</small><strong>{{ stats.value }}</strong></article>
        <article class="bento-stat"><span class="bento-ico"><i class="bi bi-shield-exclamation"></i></span><small>Warranty ends in 30 days</small><strong>{{ stats.warranty }}</strong></article>
      </div>
    }

    @if (editing) {
      <form class="form-stack" (ngSubmit)="save()">
        <section class="form-section">
          <header><span class="bento-ico"><i class="bi" [class]="kindOf(draft['kind']).icon"></i></span><div><h2>{{ editing === 'new' ? 'Add an asset' : 'Edit ' + draft['tag'] }}</h2><p>What it is and how to recognise it.</p></div></header>
          <div class="form-cols is-three">
            <div>
              <label for="a-kind">Kind</label>
              <select id="a-kind" name="kind" [(ngModel)]="draft['kind']" (ngModelChange)="detailErrors = {}">
                @for (group of groups; track group) {
                  <optgroup [label]="group">
                    @for (item of kindsIn(group); track item.key) { <option [value]="item.key">{{ item.label }}</option> }
                  </optgroup>
                }
              </select>
            </div>
            <div><label for="a-name">Name</label><input id="a-name" name="name" [(ngModel)]="draft['name']" required [placeholder]="isLicence ? 'Microsoft 365 for sales team' : 'Dell Latitude for design team'"></div>
            <div><label for="a-tag">Asset tag</label><input id="a-tag" name="tag" [(ngModel)]="draft['tag']" required [placeholder]="isLicence ? 'LIC-0012' : 'LAP-0042'"></div>
            <div>
              <label for="a-brand">{{ isLicence ? 'Publisher' : 'Brand' }}</label>
              <input id="a-brand" name="brand" [(ngModel)]="draft['brand']" [attr.list]="brandList.length ? 'a-brands' : null" [placeholder]="brandList.length ? brandList.slice(0, 3).join(', ') : isLicence ? 'Filled from the software' : 'Brand or maker'">
              @if (brandList.length) { <datalist id="a-brands">@for (brand of brandList; track brand) { <option [value]="brand"></option> }</datalist> }
            </div>
            <div><label for="a-model">{{ isLicence ? 'Edition or plan' : 'Model number' }}</label><input id="a-model" name="model" [(ngModel)]="draft['model']" [placeholder]="isLicence ? 'Business Standard, annual' : 'Latitude 5440'"></div>
            <div><label for="a-serial">{{ isLicence ? 'Order or licence id' : 'Serial number' }}</label><input id="a-serial" name="serialNo" [(ngModel)]="draft['serialNo']" autocomplete="off" [placeholder]="serialHint"></div>
            <div class="span-3"><label for="a-specs">{{ isLicence ? 'Description' : 'Specs or description' }}</label><input id="a-specs" name="specs" [(ngModel)]="draft['specs']" [placeholder]="isLicence ? 'Who uses it and what for' : 'Anything not covered below'"></div>
          </div>
        </section>
        @if (kindDetails.fields.length) {
          <section class="form-section">
            <header><span class="bento-ico is-gold"><i class="bi" [class]="kindOf(draft['kind']).icon"></i></span><div><h2>{{ kindDetails.title }}</h2><p>{{ kindDetails.lead }}</p></div></header>
            <div class="form-cols is-three">
              @for (field of visibleDetails; track field.key) {
                <div [class.span-3]="field.wide">
                  <label [for]="'d-' + field.key">{{ field.label }}</label>
                  @if (field.kind === 'select') {
                    <select [id]="'d-' + field.key" [name]="'d-' + field.key" [ngModel]="details[field.key] || ''" (ngModelChange)="setDetail(field, $event)" [class.is-invalid]="detailErrors[field.key]">
                      <option value="">Choose…</option>
                      @if (hasGroups(field)) {
                        @for (group of optionGroups(field); track group) {
                          <optgroup [label]="group">
                            @for (option of optionsIn(field, group); track option.value) { <option [value]="option.value">{{ option.label }}</option> }
                          </optgroup>
                        }
                      } @else {
                        @for (option of field.options || []; track option.value) { <option [value]="option.value">{{ option.label }}</option> }
                      }
                    </select>
                  } @else if (field.kind === 'secret') {
                    <input [id]="'d-' + field.key" [name]="'d-' + field.key" type="password" autocomplete="new-password" [(ngModel)]="detailSecrets[field.key]" [placeholder]="savedSecret(field.key) ? 'Saved ' + savedSecret(field.key) + ' — leave blank to keep' : 'XXXXX-XXXXX-XXXXX-XXXXX'">
                  } @else {
                    <input [id]="'d-' + field.key" [name]="'d-' + field.key" [type]="field.kind === 'date' ? 'date' : 'text'" [attr.inputmode]="field.kind === 'number' ? 'decimal' : null" [ngModel]="details[field.key] || ''" (ngModelChange)="setDetail(field, $event)" [placeholder]="field.placeholder || ''" [attr.maxlength]="field.max || null" [class.is-invalid]="detailErrors[field.key]">
                  }
                  @if (detailErrors[field.key]) { <p class="int-error">{{ detailErrors[field.key] }}</p> }
                  @else if (field.hint) { <p class="field-hint">{{ field.hint }}</p> }
                </div>
              }
            </div>
          </section>
        }
        <section class="form-section">
          <header><span class="bento-ico is-gold"><i class="bi bi-receipt"></i></span><div><h2>Purchase and warranty</h2><p>Only people who manage assets see the cost, vendor, and invoice.</p></div></header>
          <div class="form-cols is-three">
            <div><label for="a-bought">Purchase date</label><input id="a-bought" name="purchasedOn" type="date" [max]="today" [(ngModel)]="draft['purchasedOn']"></div>
            <div><label for="a-cost">Cost in rupees</label><input id="a-cost" name="costPaise" inputmode="decimal" [(ngModel)]="draft['costPaise']" placeholder="74,999.00"></div>
            <div><label for="a-warranty">Warranty until</label><input id="a-warranty" name="warrantyUntil" type="date" [(ngModel)]="draft['warrantyUntil']"></div>
            <div><label for="a-vendor">Vendor</label><input id="a-vendor" name="vendor" [(ngModel)]="draft['vendor']" placeholder="Where it was bought"></div>
            <div><label for="a-invoice">Invoice number</label><input id="a-invoice" name="invoiceNo" [(ngModel)]="draft['invoiceNo']"></div>
          </div>
        </section>
        <section class="form-section">
          <header><span class="bento-ico"><i class="bi bi-geo-alt"></i></span><div><h2>Place and condition</h2><p>Where it is kept and the state it is in.</p></div></header>
          <div class="form-cols is-three">
            <div>
              <label for="a-place">Location</label>
              <select id="a-place" name="locationId" [(ngModel)]="draft['locationId']">
                <option value="">Not set</option>
                @for (item of locations; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
              </select>
            </div>
            <div>
              <label for="a-condition">Condition</label>
              <select id="a-condition" name="condition" [(ngModel)]="draft['condition']">
                @for (item of conditions; track item.key) { <option [value]="item.key">{{ item.label }}</option> }
              </select>
            </div>
            <div class="span-3"><label for="a-note">Note</label><textarea id="a-note" name="note" rows="2" [(ngModel)]="draft['note']" placeholder="Accessories included, a scratch on the lid, licence key location"></textarea></div>
          </div>
        </section>
        <div class="form-bar">
          <span class="muted"><i class="bi bi-info-circle"></i> {{ editing === 'new' ? 'It goes into stock. Issue it to someone after you save.' : 'Changes are written to the asset history.' }}</span>
          <div class="actions">
            <button type="button" class="btn btn-ghost" (click)="cancelEdit()">Cancel</button>
            <button class="btn btn-primary" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> {{ busy ? 'Saving…' : editing === 'new' ? 'Add to stock' : 'Save changes' }}</button>
          </div>
        </div>
      </form>
    }

    <app-modal [open]="!!open && !editing" size="xl" [icon]="open?.icon || 'bi-box'" [title]="open?.name || ''" [subtitle]="open ? open.tag + ' · ' + open.kindLabel + (open.location ? ' · ' + open.location : '') : ''" (closed)="close()">
      @if (open) { <div modalHead class="md-head-pill"><span [class]="'pill ' + statusTone(open.status)">{{ open.statusLabel }}</span></div> }
      @if (open) {
        <dl class="kv asset-kv">
          <div><dt>{{ open.kind === 'licence' ? 'Publisher' : 'Brand' }}</dt><dd>{{ open.brand || '—' }}</dd></div>
          <div><dt>{{ open.kind === 'licence' ? 'Edition or plan' : 'Model number' }}</dt><dd>{{ open.model || '—' }}</dd></div>
          <div><dt>{{ open.kind === 'licence' ? 'Order or licence id' : 'Serial number' }}</dt><dd class="mono">{{ open.serialNo || '—' }}</dd></div>
          <div><dt>Condition</dt><dd>{{ conditionLabel(open.condition) }}</dd></div>
          @if (manage) {
            <div><dt>Cost</dt><dd>{{ open.cost || '—' }}</dd></div>
            <div><dt>Purchased</dt><dd>{{ open.purchasedOn ? dayLabel(open.purchasedOn) : '—' }}</dd></div>
            <div><dt>Vendor</dt><dd>{{ open.vendor || '—' }}@if (open.invoiceNo) { · {{ open.invoiceNo }} }</dd></div>
          }
          <div><dt>Warranty</dt><dd>@if (open.warrantyUntil) { <span [class]="'pill ' + warrantyTone(open.warrantyState)">{{ warrantyText(open) }}</span> } @else { — }</dd></div>
          @if (open.specs) { <div class="kv-wide"><dt>Specs</dt><dd>{{ open.specs }}</dd></div> }
          @if (open.note) { <div class="kv-wide"><dt>Note</dt><dd>{{ open.note }}</dd></div> }
        </dl>
        @if (detailRows(open).length) {
          <h3 class="asset-h3"><i class="bi bi-card-list"></i> {{ detailsFor(open.kind).title }}</h3>
          <dl class="kv asset-kv">
            @for (row of detailRows(open); track row.key) {
              <div [class.kv-wide]="row.wide"><dt>{{ row.label }}</dt><dd [class.mono]="row.secret">
                {{ row.value }}
                @if (row.secret) { <button type="button" class="btn btn-ghost btn-sm asset-reveal" [disabled]="busy" (click)="reveal(open, row.key)"><i class="bi" [class]="revealed[open.id + row.key] ? 'bi-clipboard' : 'bi-eye'"></i> {{ revealed[open.id + row.key] ? 'Copy' : 'Reveal' }}</button> }
              </dd></div>
            }
          </dl>
        }

        @if (open.holder) {
          <div class="asset-holder">
            <app-photo size="md" [code]="open.code" [name]="open.holder" />
            <div><strong>{{ open.holder }}</strong><small class="muted">{{ open.code }} · since {{ dayLabel(open.issuedOn) }}</small></div>
          </div>
        }

        @if (manage) {
          @if (open.status === 'stock') {
            <form class="asset-act" (ngSubmit)="assign()">
              <h3><i class="bi bi-box-arrow-up-right"></i> Issue to someone</h3>
              <div class="form-cols is-three">
                <div><label for="i-code">Employee code</label><input id="i-code" name="code" [(ngModel)]="act['code']" (ngModelChange)="lookup()" placeholder="EMP005 or a name" list="i-people" autocomplete="off" required><datalist id="i-people">@for (person of matches; track person.code) { <option [value]="person.code">{{ person.name }}</option> }</datalist>@if (who) { <small class="muted md-hint"><i class="bi bi-person-check"></i> {{ who }}</small> }</div>
                <div><label for="i-day">Issued on</label><input id="i-day" name="day" type="date" [max]="today" [(ngModel)]="act['day']"></div>
                <div>
                  <label for="i-cond">Condition now</label>
                  <select id="i-cond" name="condition" [(ngModel)]="act['condition']">@for (item of conditions; track item.key) { <option [value]="item.key">{{ item.label }}</option> }</select>
                </div>
                <div class="span-3"><label for="i-note">Note</label><input id="i-note" name="note" [(ngModel)]="act['note']" placeholder="Charger and bag included"></div>
              </div>
              <div class="actions"><button class="btn btn-primary" type="submit" [disabled]="busy"><i class="bi bi-box-arrow-up-right"></i> Issue</button></div>
            </form>
          } @else if (open.status === 'issued') {
            <form class="asset-act" (ngSubmit)="giveBack()">
              <h3><i class="bi bi-box-arrow-in-down-left"></i> Take it back</h3>
              <div class="form-cols is-three">
                <div><label for="r-day">Returned on</label><input id="r-day" name="day" type="date" [max]="today" [min]="open.issuedOn" [(ngModel)]="act['day']"></div>
                <div>
                  <label for="r-cond">Condition on return</label>
                  <select id="r-cond" name="condition" [(ngModel)]="act['condition']">@for (item of conditions; track item.key) { <option [value]="item.key">{{ item.label }}</option> }</select>
                  @if (act['condition'] === 'damaged') { <small class="muted md-hint">It will be marked in repair.</small> }
                </div>
                <div><label for="r-note">Note</label><input id="r-note" name="note" [(ngModel)]="act['note']" placeholder="Screen cracked, charger missing"></div>
              </div>
              <div class="actions"><button class="btn btn-secondary" type="submit" [disabled]="busy"><i class="bi bi-box-arrow-in-down-left"></i> Take back</button></div>
            </form>
          }

          @if (confirm) {
            <div class="approval-card">
              <div class="approval-head">
                <span class="approval-ico"><i class="bi bi-shield-exclamation"></i></span>
                <div><h2>{{ confirm.title }}</h2><p>{{ confirm.text }}</p></div>
                <span class="chip is-warn">Needs approval</span>
              </div>
              <input class="dc-note" name="confirm-note" [(ngModel)]="confirmNote" placeholder="Note, optional" aria-label="Note">
              <div class="actions">
                <button type="button" class="btn btn-primary" [disabled]="busy" (click)="runConfirm()"><i class="bi bi-check2"></i> Approve</button>
                <button type="button" class="btn btn-ghost" (click)="confirm = null"><i class="bi bi-x-lg"></i> Cancel</button>
              </div>
            </div>
          } @else {
            <div class="actions asset-more">
              <button type="button" class="btn btn-ghost btn-sm" (click)="startEdit(open)"><i class="bi bi-pencil"></i> Edit details</button>
              @if (open.status === 'stock') { <button type="button" class="btn btn-ghost btn-sm" (click)="ask('repair')"><i class="bi bi-wrench-adjustable"></i> Send for repair</button> }
              @if (open.status === 'repair' || open.status === 'lost' || open.status === 'retired') { <button type="button" class="btn btn-ghost btn-sm" (click)="ask('stock')"><i class="bi bi-check2-circle"></i> Back in stock</button> }
              @if (open.status === 'stock' || open.status === 'repair') { <button type="button" class="btn btn-ghost btn-sm" (click)="ask('retired')"><i class="bi bi-archive"></i> Retire</button> }
              @if (open.status !== 'lost' && open.status !== 'retired') { <button type="button" class="btn btn-ghost btn-sm btn-danger" (click)="ask('lost')"><i class="bi bi-question-octagon"></i> Mark lost</button> }
              @if (open.status !== 'issued' && !wasIssued) { <button type="button" class="btn btn-ghost btn-sm btn-danger" (click)="ask('remove')"><i class="bi bi-trash"></i> Remove</button> }
            </div>
          }
        }

        <h3 class="asset-h3"><i class="bi bi-clock-history"></i> History</h3>
        @if (!history.length) { <p class="muted">No history yet.</p> }
        <ol class="asset-history">
          @for (row of history; track row.id) {
            <li><span class="asset-dot"><i class="bi" [class]="eventIcon(row.kind)"></i></span><div><strong>{{ row.detail }}</strong><small class="muted">{{ dayLabel(row.day) }}@if (row.by) { · {{ row.by }} }</small></div></li>
          }
        </ol>
      }
    </app-modal>

    @if (manage && !editing) {
      <app-data-table tableId="assets" title="Asset register" [rows]="filtered" [columns]="columns" empty="No assets yet. Add the first one to start the register." [loading]="loading">
        <div tableFilter>
          <app-listing-filters
            storageKey="assets"
            [catalog]="filterCatalog"
            [values]="filterValues"
            (valuesChange)="onFilters($event)" />
        </div>
        <ng-template appRowActions let-item>
          <button type="button" class="btn btn-sm" (click)="show(item)"><i class="bi bi-eye"></i> Open</button>
        </ng-template>
      </app-data-table>
    }

    @if (!manage) {
      @if (!items.length && !error) {
        <section class="card"><div class="empty-state"><i class="bi bi-laptop"></i><strong>Nothing is issued to you</strong><p>When the company gives you a laptop, phone, or card, it shows here.</p></div></section>
      }
      <div class="asset-cards">
        @for (item of items; track item.id) {
          <article class="card asset-card">
            <div class="asset-detail-head">
              <span class="asset-ico"><i class="bi" [class]="item.icon"></i></span>
              <div><h2>{{ item.name }}</h2><p class="muted">{{ item.tag }} · {{ item.kindLabel }}</p></div>
            </div>
            <dl class="kv is-stack">
              @if (item.brand || item.model) { <div><dt>Make and model</dt><dd>{{ item.brand }} {{ item.model }}</dd></div> }
              @if (item.serialNo) { <div><dt>Serial number</dt><dd class="mono">{{ item.serialNo }}</dd></div> }
              @if (item.specs) { <div><dt>Specs</dt><dd>{{ item.specs }}</dd></div> }
              @for (row of detailRows(item); track row.key) {
                <div><dt>{{ row.label }}</dt><dd [class.mono]="row.secret">{{ row.value }}@if (row.secret) { <button type="button" class="btn btn-ghost btn-sm asset-reveal" [disabled]="busy" (click)="reveal(item, row.key)"><i class="bi" [class]="revealed[item.id + row.key] ? 'bi-clipboard' : 'bi-eye'"></i> {{ revealed[item.id + row.key] ? 'Copy' : 'Reveal' }}</button> }</dd></div>
              }
              <div><dt>With you since</dt><dd>{{ dayLabel(item.issuedOn) }}</dd></div>
              <div><dt>Condition</dt><dd>{{ conditionLabel(item.condition) }}</dd></div>
              @if (item.warrantyUntil) { <div><dt>Warranty</dt><dd>{{ warrantyText(item) }}</dd></div> }
            </dl>
          </article>
        }
      </div>
    }
  `,
})
export class AssetsComponent implements OnInit {
  private readonly api = inject(ApiService);
  items: AssetRow[] = [];
  kinds: Kind[] = [];
  locations: Array<{ id: string; name: string }> = [];
  stats: Stats | null = null;
  manage = false;
  editing: '' | 'new' | string = '';
  draft: Draft = { ...BLANK };
  open: AssetRow | null = null;
  history: HistoryRow[] = [];
  act: Draft = {};
  who = '';
  matches: Array<{ name: string; code: string; designation?: string }> = [];
  confirm: { action: string; title: string; text: string } | null = null;
  confirmNote = '';
  kindFilter = '';
  statusFilter = '';
  filterValues: Record<string, string> = { kind: '', status: '' };

  get filterCatalog(): ListingFilterItem[] {
    return [
      {
        key: 'kind',
        label: 'Kinds',
        allLabel: 'All kinds',
        options: this.kinds.map((item) => ({ value: item.key, label: item.label })),
      },
      {
        key: 'status',
        label: 'Status',
        allLabel: 'Every status',
        options: [
          { value: 'issued', label: 'Issued' },
          { value: 'stock', label: 'In stock' },
          { value: 'repair', label: 'In repair' },
          { value: 'retired', label: 'Retired' },
          { value: 'lost', label: 'Lost' },
        ],
      },
    ];
  }

  onFilters(values: Record<string, string>): void {
    this.filterValues = values;
    this.kindFilter = values['kind'] || '';
    this.statusFilter = values['status'] || '';
  }
  error = '';
  ok = '';
  loading = true;
  busy = false;
  catalog: Record<string, KindDetails> = {};
  detailValues: Record<string, DetailValues> = {};
  details: Record<string, string> = {};
  detailSecrets: Record<string, string> = {};
  detailErrors: Record<string, string> = {};
  revealed: Record<string, string> = {};
  private autoBrand = '';
  readonly today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  readonly conditions = [
    { key: 'new', label: 'New' }, { key: 'good', label: 'Good' }, { key: 'fair', label: 'Fair, shows wear' }, { key: 'damaged', label: 'Damaged' },
  ];
  readonly columns: DataColumn<AssetRow>[] = [
    { key: 'name', label: 'Asset', text: (row) => row.name, sub: (row) => row.tag + ' · ' + row.kindLabel },
    { key: 'model', label: 'Make and model', text: (row) => [row.brand, row.model].filter(Boolean).join(' ') || '—', sub: (row) => row.serialNo ? 'S/N ' + row.serialNo : '' },
    { key: 'details', label: 'Details', text: (row) => this.detailValues[row.id]?.summary || '—', optional: true },
    { key: 'holder', label: 'With', text: (row) => row.holder || 'Nobody', sub: (row) => row.holder ? row.code + ' · since ' + this.dayLabel(row.issuedOn) : row.location, person: (row) => ({ code: row.code, name: row.holder }) },
    { key: 'status', label: 'Status', text: (row) => row.statusLabel, pill: true },
    { key: 'condition', label: 'Condition', text: (row) => this.conditionLabel(row.condition), optional: true },
    { key: 'cost', label: 'Cost', text: (row) => row.cost || '—', sub: (row) => row.purchasedOn ? this.dayLabel(row.purchasedOn) : '', optional: true },
    { key: 'warranty', label: 'Warranty', text: (row) => row.warrantyUntil ? this.warrantyText(row) : '—', optional: true },
    { key: 'location', label: 'Location', text: (row) => row.location || '—', optional: true },
  ];

  get groups(): string[] {
    return [...new Set(this.kinds.map((item) => item.group))];
  }

  get filtered(): AssetRow[] {
    return this.items.filter((row) => (!this.kindFilter || row.kind === this.kindFilter) && (!this.statusFilter || row.status === this.statusFilter));
  }

  get wasIssued(): boolean {
    return this.history.some((row) => row.kind === 'issued');
  }

  get serialHint(): string {
    const kind = this.draft['kind'];
    if (kind === 'vehicle') return 'Registration or chassis number';
    if (kind === 'phone' || kind === 'tablet') return 'IMEI or serial';
    if (kind === 'sim') return 'SIM number';
    if (kind === 'licence') return 'Order number from the invoice';
    return 'From the label underneath';
  }

  get isLicence(): boolean {
    return this.draft['kind'] === 'licence';
  }

  get kindDetails(): KindDetails {
    return this.detailsFor(this.draft['kind']);
  }

  get brandList(): string[] {
    return this.kindDetails.brands;
  }

  get visibleDetails(): DetailField[] {
    return this.visibleFor(this.draft['kind'], this.details);
  }

  detailsFor(kind: string): KindDetails {
    return this.catalog[kind] || { title: '', lead: '', brands: [], fields: [] };
  }

  hasGroups(field: DetailField): boolean {
    return (field.options || []).some((option) => !!option.group);
  }

  optionGroups(field: DetailField): string[] {
    return [...new Set((field.options || []).map((option) => option.group || 'Other'))];
  }

  optionsIn(field: DetailField, group: string): DetailOption[] {
    return (field.options || []).filter((option) => (option.group || 'Other') === group);
  }

  savedSecret(key: string): string {
    return this.editing && this.editing !== 'new' ? this.detailValues[this.editing]?.secrets[key] || '' : '';
  }

  setDetail(field: DetailField, value: string): void {
    this.details = { ...this.details, [field.key]: value };
    delete this.detailErrors[field.key];
    if (field.key !== 'product') return;
    const option = (field.options || []).find((item) => item.value === value);
    if (!option || option.value === 'other') return;
    const brand = (this.draft['brand'] || '').trim();
    if (option.brand && (!brand || brand === this.autoBrand)) {
      this.draft['brand'] = option.brand;
      this.autoBrand = option.brand;
    }
    if (!(this.draft['name'] || '').trim()) this.draft['name'] = option.label;
  }

  detailRows(row: AssetRow): Array<{ key: string; label: string; value: string; secret: boolean; wide: boolean }> {
    const saved = this.detailValues[row.id];
    if (!saved) return [];
    const rows: Array<{ key: string; label: string; value: string; secret: boolean; wide: boolean }> = [];
    for (const field of this.visibleFor(row.kind, saved.fields)) {
      if (field.kind === 'secret') {
        if (saved.secrets[field.key]) rows.push({ key: field.key, label: field.label, value: this.revealed[row.id + field.key] || saved.secrets[field.key], secret: true, wide: false });
        continue;
      }
      const value = saved.fields[field.key];
      if (!value) continue;
      const shown = field.kind === 'select' ? (field.options || []).find((option) => option.value === value)?.label || value : field.kind === 'date' ? this.dayLabel(value) : value;
      rows.push({ key: field.key, label: field.label, value: shown, secret: false, wide: !!field.wide });
    }
    return rows;
  }

  async reveal(row: AssetRow, key: string): Promise<void> {
    const shown = this.revealed[row.id + key];
    if (shown) {
      try {
        await navigator.clipboard.writeText(shown);
        this.ok = 'Copied.';
      } catch {
        this.error = 'Could not copy. Select the key and copy it by hand.';
      }
      return;
    }
    this.busy = true;
    this.clearNotes();
    try {
      const result = await this.api.post<{ value: string }>('/v1/assets/' + row.id + '/details/reveal', { field: key });
      this.revealed = { ...this.revealed, [row.id + key]: result.value };
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not show that key.';
    } finally {
      this.busy = false;
    }
  }

  private visibleFor(kind: string, values: Record<string, string>): DetailField[] {
    return this.detailsFor(kind).fields.filter((field) => {
      const rule = field.showIf;
      if (!rule) return true;
      const value = values[rule.field] || '';
      if (rule.equals) return rule.equals.includes(value);
      if (rule.notEquals) return !!value && !rule.notEquals.includes(value);
      return true;
    });
  }

  private checkDetails(): boolean {
    const errors: Record<string, string> = {};
    for (const field of this.visibleDetails) {
      if (field.kind === 'secret' || field.kind === 'select') continue;
      let value = (this.details[field.key] || '').trim();
      if (!value) continue;
      if (field.upper) value = value.toUpperCase();
      this.details[field.key] = value;
      if (field.kind === 'number') {
        const amount = Number(value);
        if (!Number.isFinite(amount)) errors[field.key] = field.label + ' must be a number.';
        else if (field.min !== undefined && amount < field.min) errors[field.key] = field.label + ' must be at least ' + field.min + '.';
        else if (field.maxValue !== undefined && amount > field.maxValue) errors[field.key] = field.label + ' must be at most ' + field.maxValue + '.';
      } else if (field.pattern && !new RegExp(field.pattern).test(value)) {
        errors[field.key] = field.patternMessage || field.label + ' does not look right.';
      }
    }
    this.detailErrors = errors;
    return !Object.keys(errors).length;
  }

  private detailBody(): { fields: Record<string, string>; secrets: Record<string, string> } {
    const fields: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const field of this.visibleDetails) {
      if (field.kind === 'secret') {
        const sent = (this.detailSecrets[field.key] || '').trim();
        if (sent) secrets[field.key] = sent;
      } else if ((this.details[field.key] || '').trim()) {
        fields[field.key] = this.details[field.key].trim();
      }
    }
    return { fields, secrets };
  }

  kindsIn(group: string): Kind[] {
    return this.kinds.filter((item) => item.group === group);
  }

  kindOf(key: string): Kind {
    return this.kinds.find((item) => item.key === key) || { key: 'other', label: 'Other', icon: 'bi-box-seam', group: 'Other' };
  }

  conditionLabel(key: string): string {
    return this.conditions.find((item) => item.key === key)?.label || key || '—';
  }

  eventIcon(kind: string): string {
    return EVENT_ICON[kind] || 'bi-dot';
  }

  statusTone(status: string): string {
    return status === 'stock' ? 'ok' : status === 'repair' ? 'warn' : status === 'lost' || status === 'retired' ? 'bad' : '';
  }

  warrantyTone(state: string): string {
    return state === 'valid' ? 'ok' : state === 'soon' ? 'warn' : 'bad';
  }

  warrantyText(row: AssetRow): string {
    const label = this.dayLabel(row.warrantyUntil);
    return row.warrantyState === 'expired' ? 'Ended ' + label : row.warrantyState === 'soon' ? 'Ends ' + label : 'Until ' + label;
  }

  dayLabel(day: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return '—';
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'));
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  startAdd(): void {
    this.open = null;
    this.draft = { ...BLANK };
    this.resetDetails({});
    this.editing = 'new';
    this.clearNotes();
  }

  startEdit(row: AssetRow): void {
    this.draft = {
      name: row.name, tag: row.tag, kind: row.kind, brand: row.brand, model: row.model, serialNo: row.serialNo, specs: row.specs,
      condition: row.condition, purchasedOn: row.purchasedOn, warrantyUntil: row.warrantyUntil, costPaise: row.costRupees,
      vendor: row.vendor, invoiceNo: row.invoiceNo, locationId: row.locationId, note: row.note,
    };
    this.resetDetails(this.detailValues[row.id]?.fields || {});
    this.editing = row.id;
    this.clearNotes();
  }

  cancelEdit(): void {
    this.editing = '';
  }

  async save(): Promise<void> {
    this.clearNotes();
    if (!this.checkDetails()) {
      this.error = 'Fix the highlighted details first.';
      return;
    }
    this.busy = true;
    const details = this.detailBody();
    try {
      if (this.editing === 'new') {
        const created = await this.api.post<{ id: string }>('/v1/assets', this.draft);
        this.editing = created.id;
        await this.api.post('/v1/assets/' + created.id + '/details', details);
        this.ok = `${this.draft['tag'].toUpperCase()} is in stock.`;
        this.editing = '';
        await this.load(created.id);
      } else {
        const id = this.editing;
        await this.api.patch('/v1/assets/' + id, this.draft);
        await this.api.post('/v1/assets/' + id + '/details', details);
        this.ok = 'Saved.';
        this.editing = '';
        await this.load(id);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save that asset.';
    } finally {
      this.busy = false;
    }
  }

  async show(row: AssetRow): Promise<void> {
    this.open = row;
    this.confirm = null;
    this.who = '';
    this.matches = [];
    this.act = { code: '', day: this.today, condition: row.condition === 'damaged' ? 'good' : row.condition, note: '' };
    this.history = [];
    try {
      this.history = await this.api.get<HistoryRow[]>('/v1/assets/' + row.id + '/history');
    } catch {
      this.history = [];
    }
  }

  close(): void {
    this.open = null;
  }

  async lookup(): Promise<void> {
    const code = (this.act['code'] || '').trim();
    if (code.length < 2) { this.who = ''; this.matches = []; return; }
    try {
      // The colleague directory is the scoped search: it follows the role's directory setting, and the server still checks the code on issue.
      const listed = await this.api.get<{ people: Array<{ name: string; code: string; designation?: string }> }>('/v1/directory?q=' + encodeURIComponent(code));
      this.matches = listed.people.slice(0, 8);
      const match = listed.people.find((person) => person.code.toLowerCase() === code.toLowerCase());
      this.who = match ? match.name + (match.designation ? ' · ' + match.designation : '') : '';
    } catch {
      this.who = '';
      this.matches = [];
    }
  }

  async assign(): Promise<void> {
    if (!this.open) return;
    await this.run('/v1/assets/' + this.open.id + '/assign', this.act, 'Issued ' + this.open.tag + '.');
  }

  async giveBack(): Promise<void> {
    if (!this.open) return;
    await this.run('/v1/assets/' + this.open.id + '/return', this.act, 'Taken back ' + this.open.tag + '.');
  }

  ask(action: string): void {
    const tag = this.open?.tag || '';
    const text: Record<string, [string, string]> = {
      repair: ['Send for repair?', `${tag} cannot be issued while it is in repair.`],
      stock: ['Put back in stock?', `${tag} can be issued again.`],
      retired: ['Retire this asset?', `${tag} stays on record with its history, and is left out of the value in use.`],
      lost: ['Mark as lost?', `${tag} is taken off whoever holds it and left out of the value in use. You can put it back in stock if it turns up.`],
      remove: ['Remove this asset?', `${tag} has never been issued, so it is deleted for good.`],
    };
    this.confirm = { action, title: text[action][0], text: text[action][1] };
    this.confirmNote = '';
  }

  async runConfirm(): Promise<void> {
    if (!this.open || !this.confirm) return;
    const { action } = this.confirm;
    if (action === 'remove') {
      const tag = this.open.tag;
      const done = await this.run('/v1/assets/' + this.open.id + '/remove', {}, 'Removed ' + tag + '.', false);
      if (done) this.open = null;
    } else {
      await this.run('/v1/assets/' + this.open.id + '/status', { status: action, note: this.confirmNote }, 'Updated ' + this.open.tag + '.');
    }
    this.confirm = null;
  }

  private async run(path: string, body: unknown, message: string, reopen = true): Promise<boolean> {
    this.busy = true;
    this.clearNotes();
    try {
      await this.api.post(path, body);
      this.ok = message;
      await this.load(reopen ? this.open?.id : '');
      return true;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not update that asset.';
      return false;
    } finally {
      this.busy = false;
    }
  }

  private resetDetails(values: Record<string, string>): void {
    this.details = { ...values };
    this.detailSecrets = {};
    this.detailErrors = {};
    this.autoBrand = '';
  }

  private clearNotes(): void {
    this.error = '';
    this.ok = '';
  }

  private async load(focus = ''): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const data = await this.api.get<{ manage: boolean; kinds: Kind[]; locations: Array<{ id: string; name: string }>; stats: Stats | null; items: AssetRow[] }>('/v1/assets');
      this.manage = data.manage;
      this.kinds = data.kinds;
      this.locations = data.locations;
      this.stats = data.stats;
      this.items = data.items;
      try {
        const extra = await this.api.get<{ catalog: Record<string, KindDetails>; items: Record<string, DetailValues> }>('/v1/assets/details');
        this.catalog = extra.catalog;
        this.detailValues = extra.items;
      } catch {
        this.detailValues = {};
      }
      const row = focus ? this.items.find((item) => item.id === focus) : null;
      if (row) await this.show(row);
      else if (this.open) this.open = this.items.find((item) => item.id === this.open?.id) || null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load assets.';
    } finally {
      this.loading = false;
    }
  }
}
