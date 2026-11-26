import { Component, EventEmitter, HostListener, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';

export interface ListingFilterOption {
  value: string;
  label: string;
}

export interface ListingFilterItem {
  key: string;
  /** Short name in the “On the table” pin list, e.g. Types */
  label: string;
  /** Empty-option label on the select, e.g. All types */
  allLabel: string;
  options: ListingFilterOption[];
}

const MAX_PINS = 3;

/**
 * CRM-style listing filters: up to 3 pinned selects on the toolbar,
 * the rest (and pin layout) live in a Filters popover.
 */
@Component({
  selector: 'app-listing-filters',
  imports: [FormsModule],
  template: `
    @for (item of pinnedItems; track item.key) {
      <select
        class="listing-bar-filter"
        [attr.aria-label]="item.label"
        [ngModel]="values[item.key] || ''"
        (ngModelChange)="setBar(item.key, $event)">
        <option value="">{{ item.allLabel }}</option>
        @for (option of item.options; track option.value) {
          <option [value]="option.value">{{ option.label }}</option>
        }
      </select>
    }

    @if (showMenu) {
      <div class="listing-filters" [class.is-open]="open">
        <button
          type="button"
          class="listing-filters-toggle"
          [class.is-active]="activeCount > 0"
          [attr.aria-expanded]="open"
          aria-haspopup="true"
          (click)="toggle($event)">
          <i class="bi bi-funnel" aria-hidden="true"></i>
          <span class="listing-filters-label">Filters</span>
          @if (activeCount > 0) { <span class="listing-filter-count">{{ activeCount }}</span> }
          <i class="bi bi-chevron-down listing-filters-caret" aria-hidden="true"></i>
        </button>
        @if (open) {
          <div class="listing-filters-menu" (click)="$event.stopPropagation()">
            <div class="listing-filters-title">Narrow this list</div>
            <div class="listing-filters-grid">
              @for (item of menuItems; track item.key) {
                <label class="listing-filters-field">
                  <span>{{ item.label }}</span>
                  <select [ngModel]="draft[item.key] || ''" (ngModelChange)="draft[item.key] = $event">
                    <option value="">{{ item.allLabel }}</option>
                    @for (option of item.options; track option.value) {
                      <option [value]="option.value">{{ option.label }}</option>
                    }
                  </select>
                </label>
              }
              @if (!menuItems.length) {
                <p class="listing-filters-hint">Every filter is on the toolbar. Unpin one below to edit it here.</p>
              }
            </div>
            <div class="listing-filters-actions">
              <button type="button" class="btn btn-gold btn-sm" (click)="applyDraft()">Apply</button>
              @if (activeCount > 0) {
                <button type="button" class="btn btn-ghost btn-sm" (click)="clearMenu()">Clear</button>
              }
            </div>
            @if (catalog.length > 1) {
              <div class="listing-filters-pins">
                <div class="listing-filters-title">On the table</div>
                <p class="listing-filters-hint">Tick up to 3 filters to keep on the toolbar. The rest stay in this menu. Saved for your login.</p>
                @for (item of catalog; track item.key) {
                  <label class="listing-filters-pin">
                    <input
                      type="checkbox"
                      [checked]="pins.includes(item.key)"
                      [disabled]="!pins.includes(item.key) && pins.length >= maxPins"
                      (change)="togglePin(item.key, $any($event.target).checked)">
                    <span>{{ item.label }}</span>
                  </label>
                }
                <button type="button" class="btn btn-ghost btn-sm listing-filters-pins-apply" (click)="savePins()">Save layout</button>
              </div>
            }
          </div>
        }
      </div>
    }
  `,
})
export class ListingFiltersComponent implements OnChanges {
  readonly maxPins = MAX_PINS;

  @Input() storageKey = 'listing';
  @Input() catalog: ListingFilterItem[] = [];
  @Input() values: Record<string, string> = {};
  @Output() valuesChange = new EventEmitter<Record<string, string>>();
  @Output() changed = new EventEmitter<void>();

  pins: string[] = [];
  draft: Record<string, string> = {};
  open = false;

  @HostListener('document:click')
  onDocClick(): void {
    this.open = false;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['catalog'] || changes['storageKey']) this.loadPins();
    if (changes['values'] || changes['catalog']) this.syncDraft();
  }

  get pinnedItems(): ListingFilterItem[] {
    return this.pins.map((key) => this.catalog.find((item) => item.key === key)).filter((item): item is ListingFilterItem => !!item);
  }

  get menuItems(): ListingFilterItem[] {
    return this.catalog.filter((item) => !this.pins.includes(item.key));
  }

  get showMenu(): boolean {
    return this.catalog.length > 1 || this.menuItems.length > 0;
  }

  get activeCount(): number {
    return this.catalog.filter((item) => !this.pins.includes(item.key) && !!(this.values[item.key] || '').trim()).length;
  }

  toggle(event: Event): void {
    event.stopPropagation();
    this.open = !this.open;
    if (this.open) this.syncDraft();
  }

  setBar(key: string, value: string): void {
    const next = { ...this.values, [key]: value };
    this.valuesChange.emit(next);
    this.changed.emit();
  }

  applyDraft(): void {
    const next = { ...this.values };
    for (const item of this.menuItems) next[item.key] = this.draft[item.key] || '';
    this.valuesChange.emit(next);
    this.changed.emit();
    this.open = false;
  }

  clearMenu(): void {
    const next = { ...this.values };
    for (const item of this.menuItems) next[item.key] = '';
    this.draft = { ...this.draft, ...Object.fromEntries(this.menuItems.map((item) => [item.key, ''])) };
    this.valuesChange.emit(next);
    this.changed.emit();
  }

  togglePin(key: string, on: boolean): void {
    if (on) {
      if (this.pins.includes(key) || this.pins.length >= MAX_PINS) return;
      this.pins = [...this.pins, key];
    } else {
      this.pins = this.pins.filter((item) => item !== key);
    }
  }

  savePins(): void {
    this.persistPins();
    this.syncDraft();
    this.open = false;
  }

  private loadPins(): void {
    const keys = this.catalog.map((item) => item.key);
    const saved = localStorage.getItem(this.storageKeyFull());
    let pins: string[] = [];
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as { pins?: string[] };
        pins = Array.isArray(parsed.pins) ? parsed.pins.filter((key) => keys.includes(key)) : [];
      } catch {
        pins = [];
      }
    }
    if (!pins.length) pins = keys.slice(0, MAX_PINS);
    this.pins = pins.slice(0, MAX_PINS);
  }

  private persistPins(): void {
    localStorage.setItem(this.storageKeyFull(), JSON.stringify({ pins: this.pins }));
  }

  private storageKeyFull(): string {
    return `altamid_hrms_listing_filters_${this.storageKey || 'listing'}`;
  }

  private syncDraft(): void {
    const draft: Record<string, string> = {};
    for (const item of this.catalog) draft[item.key] = this.values[item.key] || '';
    this.draft = draft;
  }
}
