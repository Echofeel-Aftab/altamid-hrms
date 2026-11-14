import { NgTemplateOutlet } from '@angular/common';
import { PhotoComponent } from '../shared/photo.component';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';

interface Grant { feature: string; kind: string; id: string }
interface Feature { key: string; group: string; label: string; hint: string; typical?: string[]; through?: string[] }
interface RoleChip { id: string; label: string; locked: boolean; scope?: string; rank?: number }
interface Named { id: string; name: string }
interface PersonChip { id: string; name: string; code: string; department: string }
interface AccessView {
  features: Feature[];
  roles: RoleChip[];
  departments: Named[];
  levels?: Named[];
  people: PersonChip[];
  grants: Grant[];
}

type AccessMode = 'role' | 'feature';

@Component({
  selector: 'app-settings-access',
  imports: [FormsModule, PhotoComponent, NgTemplateOutlet],
  template: `
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    @if (view) {
      <div class="att-stack access-studio">
        <header class="settings-panel-head">
          <h2><i class="bi bi-shield-lock"></i> Who can manage what</h2>
          <p>Pick a role and turn areas on or off. The owner always keeps everything. Managers and team leads still only act on their own reports. Use Extras on any area for a department, grade, or named person.</p>
        </header>

        <section class="settings-card access-studio-card">
          <div class="access-toolbar">
            <div class="access-mode" role="tablist" aria-label="How to edit access">
              <button type="button" role="tab" [class.is-on]="mode === 'role'" [attr.aria-selected]="mode === 'role'" (click)="setMode('role')">
                <i class="bi bi-people"></i> By role
              </button>
              <button type="button" role="tab" [class.is-on]="mode === 'feature'" [attr.aria-selected]="mode === 'feature'" (click)="setMode('feature')">
                <i class="bi bi-grid-1x2"></i> By area
              </button>
            </div>
            <label class="access-find">
              <i class="bi bi-search" aria-hidden="true"></i>
              <input type="search" [(ngModel)]="query" name="accessQuery" placeholder="Find an area…" autocomplete="off">
            </label>
            @if (dirty) { <span class="pill warn">Unsaved changes</span> }
          </div>

          <div class="access-layout" [class.is-feature]="mode === 'feature'">
            <aside class="access-rail" [attr.aria-label]="mode === 'role' ? 'Roles' : 'Areas'">
              @if (mode === 'role') {
                <p class="access-rail-kicker">Roles</p>
                @for (role of view.roles; track role.id) {
                  <button type="button" class="access-rail-item" [class.is-on]="roleId === role.id" (click)="pickRole(role.id)">
                    <span class="access-rail-ico" [attr.data-tone]="tone(role.id)"><i [class]="roleIcon(role.id)"></i></span>
                    <span class="access-rail-copy">
                      <strong>{{ role.label }}</strong>
                      <small>@if (role.locked) { Always on } @else if (role.scope === 'team') { Own team · {{ roleOnCount(role.id) }} areas } @else { {{ roleOnCount(role.id) }} areas }</small>
                    </span>
                    @if (roleId === role.id) { <i class="bi bi-chevron-right access-rail-caret"></i> }
                  </button>
                }
              } @else {
                <p class="access-rail-kicker">Areas</p>
                @for (group of groups; track group.name) {
                  <p class="access-rail-group">{{ group.name }}</p>
                  @for (feature of group.items; track feature.key) {
                    <button type="button" class="access-rail-item" [class.is-on]="featureKey === feature.key" (click)="pickFeature(feature.key)">
                      <span class="access-rail-copy">
                        <strong>{{ feature.label }}</strong>
                        <small>{{ roleOnCountForFeature(feature.key) }} roles · {{ extraCount(feature.key) }} extras</small>
                      </span>
                      @if (featureKey === feature.key) { <i class="bi bi-chevron-right access-rail-caret"></i> }
                    </button>
                  }
                }
              }
            </aside>

            <div class="access-main">
              @if (mode === 'role' && currentRole; as role) {
                <div class="access-main-head">
                  <div>
                    <p class="access-eyebrow">Editing role</p>
                    <h3>{{ role.label }}</h3>
                    <p class="muted">
                      @if (role.locked) { Owner keeps every area. Other roles are edited here. }
                      @else if (role.scope === 'team') { Team-scoped: approvals and people views stay limited to their reports. }
                      @else { Turn areas on for everyone with this role. }
                    </p>
                  </div>
                  <div class="access-stat">
                    <strong>{{ roleOnCount(role.id) }}</strong>
                    <span>of {{ view.features.length }} on</span>
                  </div>
                </div>

                @for (group of filteredGroups; track group.name) {
                  <section class="access-group">
                    <header class="access-group-head">
                      <h4>{{ group.name }}</h4>
                      <span>{{ groupOnCount(group.items, role.id) }} / {{ group.items.length }}</span>
                    </header>
                    <div class="access-feature-list">
                      @for (feature of group.items; track feature.key) {
                        <article class="access-feature" [class.is-on]="on(feature.key, 'role', role.id)" [class.is-locked]="role.locked">
                          <div class="access-feature-copy">
                            <strong>{{ feature.label }}</strong>
                            <small>{{ feature.hint }}</small>
                            <div class="access-feature-meta">
                              @if (isTypical(feature, role.id)) { <span class="access-chip is-soft">Typical</span> }
                              @if (extraCount(feature.key)) {
                                <span class="access-chip">{{ extraCount(feature.key) }} extra{{ extraCount(feature.key) === 1 ? '' : 's' }}</span>
                              }
                            </div>
                          </div>
                          <div class="access-feature-actions">
                            <button
                              type="button"
                              class="access-switch"
                              [class.is-on]="role.locked || on(feature.key, 'role', role.id)"
                              [disabled]="role.locked"
                              (click)="toggle(feature.key, 'role', role.id)"
                              [attr.aria-pressed]="role.locked || on(feature.key, 'role', role.id)"
                            >
                              <span class="access-switch-knob" aria-hidden="true"></span>
                              <span class="sr">{{ feature.label }}</span>
                              {{ role.locked || on(feature.key, 'role', role.id) ? 'On' : 'Off' }}
                            </button>
                            <button type="button" class="access-more" [class.is-open]="expanded(feature.key)" (click)="toggleMore(feature.key)" [attr.aria-expanded]="expanded(feature.key)">
                              Extras
                            </button>
                          </div>
                          @if (expanded(feature.key)) {
                            <div class="access-extra">
                              <ng-container *ngTemplateOutlet="extras; context: { $implicit: feature }" />
                            </div>
                          }
                        </article>
                      }
                    </div>
                  </section>
                } @empty {
                  <p class="banner muted"><i class="bi bi-search"></i> No areas match “{{ query }}”.</p>
                }
              }

              @if (mode === 'feature' && currentFeature; as feature) {
                <div class="access-main-head">
                  <div>
                    <p class="access-eyebrow">{{ feature.group }}</p>
                    <h3>{{ feature.label }}</h3>
                    <p class="muted">{{ feature.hint }}</p>
                  </div>
                  <div class="access-stat">
                    <strong>{{ roleOnCountForFeature(feature.key) }}</strong>
                    <span>roles on</span>
                  </div>
                </div>

                <section class="access-group">
                  <header class="access-group-head">
                    <h4>Roles with this area</h4>
                    <button type="button" class="access-more" [class.is-open]="expanded(feature.key)" (click)="toggleMore(feature.key)">Extras</button>
                  </header>
                  <div class="access-role-grid">
                    @for (role of view.roles; track role.id) {
                      <button
                        type="button"
                        class="access-role-tile"
                        [class.is-on]="role.locked || on(feature.key, 'role', role.id)"
                        [class.is-typical]="isTypical(feature, role.id)"
                        [disabled]="role.locked"
                        (click)="toggle(feature.key, 'role', role.id)"
                      >
                        <span class="access-rail-ico" [attr.data-tone]="tone(role.id)"><i [class]="roleIcon(role.id)"></i></span>
                        <strong>{{ role.label }}</strong>
                        <small>@if (role.locked) { Always } @else if (on(feature.key, 'role', role.id)) { On } @else { Off }@if (isTypical(feature, role.id) && !role.locked) { · Typical }</small>
                      </button>
                    }
                  </div>
                  @if (expanded(feature.key)) {
                    <div class="access-extra">
                      <ng-container *ngTemplateOutlet="extras; context: { $implicit: feature }" />
                    </div>
                  }
                </section>
              }
            </div>
          </div>

          <div class="settings-inline-save access-save">
            <span class="muted small">@if (dirty) { Changes apply the next time someone opens a page. } @else { No unsaved changes. }</span>
            <button type="button" class="btn btn-gold" (click)="save()" [disabled]="busy || !dirty">
              <i class="bi bi-check2"></i> {{ busy ? 'Saving…' : 'Save access' }}
            </button>
          </div>
        </section>
      </div>

      <ng-template #extras let-feature>
        <p class="access-extra-lead">Also grant this area beyond the role columns — department, grade, or one person.</p>
        @if (view.departments.length) {
          <p class="access-label">Departments</p>
          <div class="note-filters">
            @for (item of view.departments; track item.id) {
              <button type="button" [class.is-on]="on(feature.key, 'department', item.id)" (click)="toggle(feature.key, 'department', item.id)">{{ item.name }}</button>
            }
          </div>
        }
        @if (view.levels?.length) {
          <p class="access-label">Grades</p>
          <div class="note-filters">
            @for (item of view.levels || []; track item.id) {
              <button type="button" [class.is-on]="on(feature.key, 'level', item.id)" (click)="toggle(feature.key, 'level', item.id)">{{ item.name }}</button>
            }
          </div>
        }
        <p class="access-label">A person</p>
        <div class="access-person">
          @for (item of peopleOf(feature.key); track item.id) {
            <button type="button" class="is-on" (click)="toggle(feature.key, 'person', item.id)">
              <app-photo size="xs" [personId]="item.id" [name]="item.name" /> {{ item.name }} <small>{{ item.code }}</small>
            </button>
          }
          <select [ngModel]="pick[feature.key] || ''" (ngModelChange)="pick[feature.key] = $event" [name]="'person-' + feature.key">
            <option value="">Add a person</option>
            @for (item of choices(feature.key); track item.id) {
              <option [value]="item.id">{{ item.name }} · {{ item.code }}</option>
            }
          </select>
          <button type="button" class="btn btn-ghost btn-sm" (click)="addPerson(feature.key)" [disabled]="!pick[feature.key]">Add</button>
        </div>
      </ng-template>
    }
  `,
})
export class AccessSettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  view: AccessView | null = null;
  grants: Grant[] = [];
  snapshot = '';
  pick: Record<string, string> = {};
  more: Record<string, boolean> = {};
  mode: AccessMode = 'role';
  roleId = '';
  featureKey = '';
  query = '';
  error = '';
  ok = '';
  busy = false;

  get dirty(): boolean {
    return this.snapshot !== '' && this.snapshot !== this.state();
  }

  get currentRole(): RoleChip | null {
    return this.view?.roles.find((role) => role.id === this.roleId) || null;
  }

  get currentFeature(): Feature | null {
    return this.view?.features.find((feature) => feature.key === this.featureKey) || null;
  }

  get groups(): Array<{ name: string; items: Feature[] }> {
    return this.groupFeatures(this.view?.features || []);
  }

  get filteredGroups(): Array<{ name: string; items: Feature[] }> {
    const q = this.query.trim().toLowerCase();
    const list = (this.view?.features || []).filter((feature) => {
      if (!q) return true;
      return feature.label.toLowerCase().includes(q) || feature.hint.toLowerCase().includes(q) || feature.group.toLowerCase().includes(q);
    });
    return this.groupFeatures(list);
  }

  async ngOnInit(): Promise<void> {
    try {
      this.view = await this.api.get<AccessView>('/v1/access');
      this.grants = this.view.grants.map((grant) => ({ ...grant }));
      this.roleId = this.view.roles.find((role) => !role.locked)?.id || this.view.roles[0]?.id || '';
      this.featureKey = this.view.features[0]?.key || '';
      this.snapshot = this.state();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load access.';
    }
  }

  setMode(mode: AccessMode): void {
    this.mode = mode;
    this.query = '';
  }

  pickRole(id: string): void {
    this.roleId = id;
    this.query = '';
  }

  pickFeature(key: string): void {
    this.featureKey = key;
  }

  expanded(feature: string): boolean {
    return !!this.more[feature];
  }

  toggleMore(feature: string): void {
    this.more[feature] = !this.more[feature];
  }

  extraCount(feature: string): number {
    return this.grants.filter((grant) => grant.feature === feature && grant.kind !== 'role').length;
  }

  roleOnCount(roleId: string): number {
    if (roleId === 'owner') return this.view?.features.length || 0;
    return (this.view?.features || []).filter((feature) => this.on(feature.key, 'role', roleId)).length;
  }

  roleOnCountForFeature(feature: string): number {
    return (this.view?.roles || []).filter((role) => role.locked || this.on(feature, 'role', role.id)).length;
  }

  groupOnCount(items: Feature[], roleId: string): number {
    if (roleId === 'owner') return items.length;
    return items.filter((feature) => this.on(feature.key, 'role', roleId)).length;
  }

  isTypical(feature: Feature, roleId: string): boolean {
    return (feature.typical || []).includes(roleId);
  }

  on(feature: string, kind: string, id: string): boolean {
    return this.grants.some((grant) => grant.feature === feature && grant.kind === kind && grant.id === id);
  }

  toggle(feature: string, kind: string, id: string): void {
    if (kind === 'role' && id === 'owner') return;
    this.ok = '';
    if (this.on(feature, kind, id)) this.grants = this.grants.filter((grant) => !(grant.feature === feature && grant.kind === kind && grant.id === id));
    else this.grants = [...this.grants, { feature, kind, id }];
  }

  peopleOf(feature: string): PersonChip[] {
    const ids = new Set(this.grants.filter((grant) => grant.feature === feature && grant.kind === 'person').map((grant) => grant.id));
    return (this.view?.people || []).filter((person) => ids.has(person.id));
  }

  choices(feature: string): PersonChip[] {
    const ids = new Set(this.peopleOf(feature).map((person) => person.id));
    return (this.view?.people || []).filter((person) => !ids.has(person.id));
  }

  addPerson(feature: string): void {
    const id = this.pick[feature];
    if (!id) return;
    this.toggle(feature, 'person', id);
    this.pick[feature] = '';
  }

  roleIcon(id: string): string {
    const icons: Record<string, string> = {
      owner: 'bi bi-crown',
      founder: 'bi bi-stars',
      vp: 'bi bi-award',
      director: 'bi bi-briefcase',
      hr: 'bi bi-person-hearts',
      manager: 'bi bi-people',
      payroll: 'bi bi-cash-stack',
      'team-lead': 'bi bi-diagram-3',
      accountant: 'bi bi-calculator',
      it: 'bi bi-pc-display',
      admin: 'bi bi-building-gear',
      maintenance: 'bi bi-tools',
      employee: 'bi bi-person',
    };
    return icons[id] || 'bi bi-person-badge';
  }

  tone(id: string): string {
    const tones: Record<string, string> = {
      owner: 'gold', hr: 'rose', manager: 'sky', payroll: 'mint', 'team-lead': 'violet',
      accountant: 'amber', it: 'slate', admin: 'navy', employee: 'mute',
    };
    return tones[id] || 'navy';
  }

  async save(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      this.view = await this.api.post<AccessView>('/v1/access', { grants: this.grants });
      this.grants = this.view.grants.map((grant) => ({ ...grant }));
      this.snapshot = this.state();
      this.ok = 'Access saved. People see the change the next time they open a page.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save access.';
    } finally {
      this.busy = false;
    }
  }

  private groupFeatures(features: Feature[]): Array<{ name: string; items: Feature[] }> {
    const order: string[] = [];
    const map = new Map<string, Feature[]>();
    for (const feature of features) {
      if (!map.has(feature.group)) {
        map.set(feature.group, []);
        order.push(feature.group);
      }
      map.get(feature.group)!.push(feature);
    }
    return order.map((name) => ({ name, items: map.get(name) || [] }));
  }

  private state(): string {
    return JSON.stringify([...this.grants].sort((a, b) => `${a.feature}:${a.kind}:${a.id}`.localeCompare(`${b.feature}:${b.kind}:${b.id}`)));
  }
}
