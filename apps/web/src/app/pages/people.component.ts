import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Person } from '../core/models';
import { SessionStore } from '../core/session.store';
import { DataColumn, DataTableComponent } from '../shared/data-table.component';
import { ListingFilterItem, ListingFiltersComponent } from '../shared/listing-filters.component';

@Component({
  selector: 'app-people',
  imports: [FormsModule, RouterLink, DataTableComponent, ListingFiltersComponent],
  template: `
    <div class="page-head">
      <div><span class="page-mark" aria-hidden="true"><i class="bi bi-people"></i></span><p class="eyebrow">Directory</p><h1>People</h1><p class="muted">The first 100 records load. Search to find anyone in a larger company.</p></div>
      @if (canOpen && canEdit) { <div class="actions"><a class="btn btn-ghost" routerLink="/people/import"><i class="bi bi-file-earmark-arrow-up"></i> Import</a><a class="btn btn-primary" routerLink="/people/new"><i class="bi bi-person-plus"></i> Add a person</a></div> }
    </div>
    @if (!canOpen) {
      <section class="card"><h2><i class="bi bi-people"></i> People</h2><p class="muted">The company directory is turned off for your role.</p></section>
    } @else {
    @if (error) { <p class="form-error">{{ error }}</p> }
    <app-data-table tableId="people" empty="No one matches that filter." [rows]="people" [columns]="columns" [loading]="loading">
      <div tableFilter class="people-toolbar-filters">
        <label class="sr" for="people-q">Directory search</label>
        <input id="people-q" class="listing-bar-filter is-search" [(ngModel)]="query" placeholder="Name, code, or department" (keyup.enter)="load()">
        <button class="btn btn-ghost btn-sm" type="button" (click)="load()"><i class="bi bi-search"></i> Search</button>
        <app-listing-filters
          storageKey="people"
          [catalog]="filterCatalog"
          [values]="filterValues"
          (valuesChange)="onFilters($event)"
          (changed)="load()" />
      </div>
    </app-data-table>
    }
  `,
})
export class PeopleComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  people: Person[] = [];
  departments: string[] = [];
  department = '';
  query = '';
  status = '';
  filterValues: Record<string, string> = { department: '', status: '' };
  error = '';
  loading = true;

  get filterCatalog(): ListingFilterItem[] {
    return [
      {
        key: 'department',
        label: 'Departments',
        allLabel: 'All departments',
        options: this.departments.map((name) => ({ value: name, label: name })),
      },
      {
        key: 'status',
        label: 'Status',
        allLabel: 'All statuses',
        options: [
          { value: 'active', label: 'Active' },
          { value: 'onboarding', label: 'Onboarding' },
          { value: 'exited', label: 'Exited' },
        ],
      },
    ];
  }

  onFilters(values: Record<string, string>): void {
    this.filterValues = values;
    this.department = values['department'] || '';
    this.status = values['status'] || '';
  }

  readonly columns: DataColumn<Person>[] = [
    { key: 'name', label: 'Person', text: (row) => row.name, sub: (row) => row.workerType, link: (row) => '/people/' + row.id, person: (row) => ({ id: row.id, name: row.name }) },
    { key: 'code', label: 'Code', text: (row) => row.code },
    { key: 'role', label: 'Role', text: (row) => row.designation?.name || '—' },
    { key: 'department', label: 'Department', text: (row) => row.department?.name || '—' },
    { key: 'status', label: 'Status', text: (row) => row.status, pill: true },
    { key: 'email', label: 'Email', text: (row) => row.email || '—', optional: true },
    { key: 'phone', label: 'Phone', text: (row) => row.phone || '—', optional: true },
    { key: 'location', label: 'Location', text: (row) => row.location?.name || '—', optional: true },
    { key: 'manager', label: 'Manager', text: (row) => row.manager?.name || '—', optional: true },
    { key: 'joined', label: 'Joined', text: (row) => row.dateOfJoining || '—', optional: true },
  ];

  get canOpen(): boolean {
    return !!this.store.me?.access?.includes('people');
  }

  get canEdit(): boolean {
    return !!this.store.me?.access?.includes('people.edit');
  }

  async ngOnInit(): Promise<void> {
    if (!this.canOpen) {
      this.loading = false;
      return;
    }
    await this.load();
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const params = new URLSearchParams();
      if (this.query.trim()) params.set('q', this.query.trim());
      if (this.department) params.set('department', this.department);
      if (this.status) params.set('status', this.status);
      const suffix = params.toString() ? '?' + params.toString() : '';
      const data = await this.api.get<{ people: Person[]; departments: string[] }>('/v1/people' + suffix);
      this.people = data.people;
      this.departments = data.departments;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load people.';
    } finally {
      this.loading = false;
    }
  }
}
