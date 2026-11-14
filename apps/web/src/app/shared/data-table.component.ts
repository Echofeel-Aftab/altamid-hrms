import { NgTemplateOutlet } from '@angular/common';
import { Component, ContentChild, Directive, HostListener, Input, OnInit, TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PhotoComponent } from './photo.component';

export interface DataColumn<T> {
  key: string;
  label: string;
  text: (row: T) => string;
  sub?: (row: T) => string;
  pill?: boolean;
  link?: (row: T) => string;
  optional?: boolean;
  /** Sorts by this value instead of the displayed text. */
  sort?: (row: T) => number | string;
  /** Shows the person's photo before the text. */
  person?: (row: T) => { id?: string; code?: string; name: string };
}

@Directive({ selector: 'ng-template[appRowActions]' })
export class RowActionsDirective<T> {
  constructor(readonly template: TemplateRef<{ $implicit: T }>) {}
}

@Component({
  selector: 'app-data-table',
  imports: [RouterLink, NgTemplateOutlet, FormsModule, PhotoComponent],
  template: `
    <section class="card dt-wrap">
      @if (title || hint) {
        <div class="dt-title">
          @if (title) { <h2>{{ title }}</h2> }
          @if (hint) { <p class="muted">{{ hint }}</p> }
        </div>
      }
      <div class="dt-toolbar">
        <div class="dt-toolbar-left">
          <label class="dt-length">
            Show
            <select [(ngModel)]="perPage" (ngModelChange)="rememberPageSize()" aria-label="Entries per page">
              @for (size of pageSizes; track size) {
                <option [ngValue]="size">{{ size }}</option>
              }
            </select>
            entries
          </label>
        </div>
        <div class="dt-toolbar-right">
          @if (hideable.length) {
            <div class="listing-cols">
              <button type="button" class="btn btn-ghost btn-sm" (click)="$event.stopPropagation(); columnsOpen = !columnsOpen">
                <i class="bi bi-layout-three-columns"></i> Columns
              </button>
              @if (columnsOpen) {
                <div class="listing-cols-menu" (click)="$event.stopPropagation()">
                  <div class="listing-cols-title">Show columns</div>
                  <p class="listing-cols-hint">Turn a column on to show it. Extra details stay off until you choose them. Drag a header to reorder.</p>
                  @for (column of ordered; track column.key) {
                    <label class="listing-cols-item">
                      <input class="switch" type="checkbox" [checked]="isVisible(column.key)" [disabled]="column.key === columns[0].key" (change)="toggleColumn(column.key)">
                      <span>{{ column.label }}</span>
                    </label>
                  }
                  @if (order.length || hidden.size) {
                    <button type="button" class="btn btn-ghost btn-sm listing-cols-reset" (click)="resetColumns()">Reset columns</button>
                  }
                </div>
              }
            </div>
          }
          <label class="dt-search">
            <i class="bi bi-search"></i>
            <input type="search" [value]="query" (input)="setQuery($any($event.target).value)" placeholder="Search this table" aria-label="Search this table">
          </label>
          @if (query || sortKey) {
            <button type="button" class="btn btn-ghost btn-sm" (click)="reset()">Reset</button>
          }
        </div>
      </div>
      <div class="dt-filter">
        <ng-content select="[tableFilter]" />
      </div>
      <div class="table-responsive">
        @if (!filtered.length) {
          <div class="empty-state">
            <i class="bi bi-inbox"></i>
            <strong>{{ query ? 'Nothing matches' : 'Nothing here yet' }}</strong>
            <p>{{ query ? 'Try another search or reset the table.' : empty }}</p>
          </div>
        } @else {
          <table class="table">
            <thead>
              <tr>
                @for (column of shown; track column.key) {
                  <th class="listing-col"
                    draggable="true"
                    [class.is-col-dragging]="dragKey === column.key"
                    [class.is-col-drop-before]="dropKey === column.key && !dropAfter"
                    [class.is-col-drop-after]="dropKey === column.key && dropAfter"
                    (dragstart)="startDrag($event, column.key)"
                    (dragend)="clearDrag()"
                    (dragover)="overDrag($event, column.key)"
                    (drop)="dropDrag($event, column.key)">
                    <span class="listing-col-grip" title="Drag to reorder"><i class="bi bi-grip-vertical"></i></span>
                    <button type="button" class="sort-link" [class.is-active]="sortKey === column.key" (click)="sort(column.key)">
                      {{ column.label }}
                      <i class="bi" [class.bi-arrow-down-up]="sortKey !== column.key" [class.bi-sort-up]="sortKey === column.key && sortDir === 'asc'" [class.bi-sort-down]="sortKey === column.key && sortDir === 'desc'"></i>
                    </button>
                  </th>
                }
                @if (actions) { <th>Actions</th> }
              </tr>
            </thead>
            <tbody>
              @for (row of pageRows; track $index) {
                <tr>
                  @for (column of shown; track column.key) {
                    <td>
                      @if (column.person) {
                        <div class="dt-person">
                          @if (column.person(row).name) { <app-photo size="sm" [personId]="column.person(row).id || ''" [code]="column.person(row).code || ''" [name]="column.person(row).name" /> } @else { <span class="av av-sm av-empty"><i class="bi bi-box-seam"></i></span> }
                          <div>
                            @if (column.link && column.link(row)) { <a [routerLink]="column.link(row)">{{ column.text(row) }}</a> } @else { {{ column.text(row) }} }
                            @if (column.sub) { <span class="cell-sub">{{ column.sub(row) }}</span> }
                          </div>
                        </div>
                      } @else if (column.link && column.link(row)) {
                        <a [routerLink]="column.link(row)">{{ column.text(row) }}</a>
                      } @else if (column.pill) {
                        <span [class]="pill(column.text(row))">{{ column.text(row) }}</span>
                      } @else {
                        {{ column.text(row) }}
                      }
                      @if (column.sub && !column.person) { <span class="cell-sub">{{ column.sub(row) }}</span> }
                    </td>
                  }
                  @if (actions) {
                    <td><div class="row-actions"><ng-container [ngTemplateOutlet]="actions.template" [ngTemplateOutletContext]="{ $implicit: row }" /></div></td>
                  }
                </tr>
              }
            </tbody>
          </table>
        }
      </div>
      <div class="dt-footer">
        <div class="listing-pager-meta">Showing {{ from }} to {{ to }} of {{ filtered.length }} entries</div>
        <nav>
          <ul class="pagination">
            <li class="page-item" [class.disabled]="page <= 1">
              <button type="button" class="page-link" (click)="go(page - 1)" [disabled]="page <= 1">Previous</button>
            </li>
            @for (n of pages; track n) {
              <li class="page-item" [class.active]="n === page">
                <button type="button" class="page-link" (click)="go(n)">{{ n }}</button>
              </li>
            }
            <li class="page-item" [class.disabled]="page >= lastPage">
              <button type="button" class="page-link" (click)="go(page + 1)" [disabled]="page >= lastPage">Next</button>
            </li>
          </ul>
        </nav>
      </div>
    </section>
  `,
})
export class DataTableComponent<T> implements OnInit {
  @HostListener('document:click')
  closeColumns(): void {
    this.columnsOpen = false;
  }
  @Input() rows: T[] = [];
  @Input() columns: DataColumn<T>[] = [];
  @Input() title = '';
  @Input() hint = '';
  @Input() empty = 'No rows yet.';
  @Input() tableId = 'table';
  @ContentChild(RowActionsDirective) actions?: RowActionsDirective<T>;
  readonly pill = pillClass;
  readonly pageSizes = [10, 20, 50, 100];
  query = '';
  perPage = 20;
  page = 1;
  sortKey = '';
  sortDir: 'asc' | 'desc' = 'asc';
  hidden = new Set<string>();
  order: string[] = [];
  columnsOpen = false;
  dragKey = '';
  dropKey = '';
  dropAfter = false;

  get hideable(): DataColumn<T>[] {
    return this.columns.slice(1);
  }

  get ordered(): DataColumn<T>[] {
    if (!this.order.length) return this.columns;
    const byKey = new Map(this.columns.map((column) => [column.key, column]));
    const ranked = this.order.map((key) => byKey.get(key)).filter((column): column is DataColumn<T> => !!column);
    const rest = this.columns.filter((column) => !this.order.includes(column.key));
    return [...ranked, ...rest];
  }

  get shown(): DataColumn<T>[] {
    return this.ordered.filter((column) => this.isVisible(column.key));
  }

  get filtered(): T[] {
    const query = this.query.trim().toLowerCase();
    let list = this.rows || [];
    if (query) {
      list = list.filter((row) =>
        this.columns.some((column) => `${column.text(row)} ${column.sub?.(row) || ''}`.toLowerCase().includes(query)),
      );
    }
    if (this.sortKey) {
      const column = this.columns.find((item) => item.key === this.sortKey);
      if (column) {
        const dir = this.sortDir === 'asc' ? 1 : -1;
        const value = column.sort || column.text;
        list = [...list].sort((a, b) => {
          const x = value(a);
          const y = value(b);
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
          return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' }) * dir;
        });
      }
    }
    return list;
  }

  get lastPage(): number {
    return Math.max(1, Math.ceil(this.filtered.length / this.perPage));
  }

  get pageRows(): T[] {
    const page = Math.min(this.page, this.lastPage);
    const start = (page - 1) * this.perPage;
    return this.filtered.slice(start, start + this.perPage);
  }

  get from(): number {
    return this.filtered.length ? (Math.min(this.page, this.lastPage) - 1) * this.perPage + 1 : 0;
  }

  get to(): number {
    return Math.min(this.filtered.length, Math.min(this.page, this.lastPage) * this.perPage);
  }

  get pages(): number[] {
    const last = this.lastPage;
    const current = Math.min(this.page, last);
    const start = Math.max(1, current - 2);
    const end = Math.min(last, current + 2);
    const pages: number[] = [];
    for (let n = start; n <= end; n += 1) pages.push(n);
    return pages;
  }

  ngOnInit(): void {
    const optional = this.optionalKeys();
    const saved = localStorage.getItem(`altamid_hrms_table_${this.tableId}`);
    if (!saved) {
      this.hidden = new Set(optional);
      return;
    }
    try {
      const state = JSON.parse(saved) as { perPage?: number; hidden?: string[]; order?: string[]; ready?: boolean };
      if (state.perPage && this.pageSizes.includes(state.perPage)) this.perPage = state.perPage;
      this.hidden = new Set(state.hidden || []);
      if (!state.ready) {
        for (const key of optional) this.hidden.add(key);
      }
      this.order = Array.isArray(state.order) ? state.order.filter((key) => this.columns.some((column) => column.key === key)) : [];
    } catch {
      this.hidden = new Set(optional);
    }
  }

  isVisible(key: string): boolean {
    if (!this.columns.length || key === this.columns[0].key) return true;
    return !this.hidden.has(key);
  }

  setQuery(value: string): void {
    this.query = value;
    this.page = 1;
  }

  rememberPageSize(): void {
    this.page = 1;
    this.persist();
  }

  sort(key: string): void {
    if (this.sortKey === key) this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    else {
      this.sortKey = key;
      this.sortDir = 'asc';
    }
  }

  go(page: number): void {
    this.page = Math.min(this.lastPage, Math.max(1, page));
  }

  reset(): void {
    this.query = '';
    this.sortKey = '';
    this.sortDir = 'asc';
    this.page = 1;
  }

  toggleColumn(key: string): void {
    if (this.hidden.has(key)) this.hidden.delete(key);
    else this.hidden.add(key);
    this.hidden = new Set(this.hidden);
    this.persist();
  }

  startDrag(event: DragEvent, key: string): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('button, a, input, select')) {
      event.preventDefault();
      return;
    }
    this.dragKey = key;
    event.dataTransfer?.setData('text/plain', key);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  overDrag(event: DragEvent, key: string): void {
    if (!this.dragKey || this.dragKey === key) {
      this.dropKey = '';
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.dropKey = key;
    this.dropAfter = event.clientX > rect.left + rect.width / 2;
  }

  dropDrag(event: DragEvent, key: string): void {
    event.preventDefault();
    const from = this.dragKey || event.dataTransfer?.getData('text/plain') || '';
    const after = this.dropAfter;
    this.clearDrag();
    if (!from || from === key) return;
    const keys = this.ordered.map((column) => column.key).filter((item) => item !== from);
    const index = keys.indexOf(key);
    if (index < 0) return;
    keys.splice(after ? index + 1 : index, 0, from);
    this.order = keys;
    this.persist();
  }

  clearDrag(): void {
    this.dragKey = '';
    this.dropKey = '';
    this.dropAfter = false;
  }

  resetColumns(): void {
    this.order = [];
    this.hidden = new Set(this.optionalKeys());
    this.persist();
  }

  private optionalKeys(): string[] {
    return this.columns.filter((column) => column.optional).map((column) => column.key);
  }

  private persist(): void {
    localStorage.setItem(
      `altamid_hrms_table_${this.tableId}`,
      JSON.stringify({ perPage: this.perPage, hidden: [...this.hidden], order: this.order, ready: true }),
    );
  }
}

function pillClass(status: string): string {
  const value = status.toLowerCase();
  if (value.startsWith('strong')) return 'pill ok';
  if (value.startsWith('fair')) return 'pill warn';
  if (value.startsWith('low')) return 'pill bad';
  if (value.startsWith('repeat') || value.startsWith('former') || value.startsWith('works here') || value === 'cooling period') return 'pill info';
  if (value.startsWith('rejected before')) return 'pill bad';
  if (['active', 'approved', 'in', 'open', 'hired', 'shortlisted', 'in stock', 'published', 'ready'].includes(value)) return 'pill ok';
  if (['missing', 'no slip'].includes(value)) return 'pill warn';
  if (['issued'].includes(value)) return 'pill info';
  if (['in repair'].includes(value)) return 'pill warn';
  if (['retired', 'lost'].includes(value)) return 'pill bad';
  if (['onboarding', 'pending', 'new', 'reviewing', 'interview', 'draft'].includes(value)) return 'pill warn';
  if (['exited', 'rejected', 'cancelled', 'closed'].includes(value)) return 'pill bad';
  return 'pill';
}
