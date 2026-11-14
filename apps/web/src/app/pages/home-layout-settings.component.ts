import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';

type Kind = 'company' | 'role' | 'department' | 'person';
interface LayoutBlock {
  key: string;
  label: string;
  hint: string;
  group: string;
  icon: string;
  needs: string;
  own: '' | 'on' | 'off';
  inherited: 'on' | 'off';
  from: string;
  effective: 'on' | 'off';
  permitted: boolean | null;
}
interface Named { id: string; name: string }
interface SavedLayout { kind: Kind; id: string; name: string; changes: number; updatedAt: string }
interface LayoutView {
  subject: { kind: Kind; id: string; name: string };
  blocks: LayoutBlock[];
  saved: SavedLayout[];
  roles: Named[];
  departments: Named[];
  people: Array<{ id: string; name: string; code: string }>;
}

@Component({
  selector: 'app-settings-home',
  imports: [FormsModule],
  template: `
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    <section class="settings-card">
      <header class="settings-card-head">
        <span class="settings-icon"><i class="bi bi-house-gear"></i></span>
        <div>
          <h2>Who sees what on Home</h2>
          <p>Set blocks for everyone, then change them for a role, a department, or one person. The most specific choice wins: person, then department, then role, then everyone.</p>
        </div>
      </header>
      <div class="settings-card-body">
        <div class="seg-tabs" role="tablist" aria-label="Layout for">
          @for (item of kinds; track item.id) {
            <button type="button" role="tab" [class.is-on]="kind === item.id" [attr.aria-selected]="kind === item.id" (click)="pickKind(item.id)"><i [class]="item.icon"></i> {{ item.label }}</button>
          }
        </div>
        @if (view && kind !== 'company') {
          <div class="field-grid home-layout-pick">
            <div>
              <label for="hl-subject">{{ kind === 'role' ? 'Role' : kind === 'department' ? 'Department' : 'Person' }}</label>
              <select id="hl-subject" name="subject" [ngModel]="subjectId" (ngModelChange)="pickSubject($event)">
                @if (!options().length) { <option value="">{{ kind === 'department' ? 'Add a department first' : 'No one to choose' }}</option> }
                @for (item of options(); track item.id) { <option [value]="item.id">{{ item.name }}</option> }
              </select>
            </div>
          </div>
        }
        @if (view?.saved?.length) {
          <p class="access-label">Saved layouts</p>
          <div class="note-filters">
            @for (item of view!.saved; track item.kind + item.id) {
              <button type="button" [class.is-on]="item.kind === kind && item.id === subjectId" (click)="openSaved(item)">{{ kindLabel(item.kind) }} · {{ item.name }} <small>({{ item.changes }})</small></button>
            }
          </div>
        }
      </div>
    </section>

    @if (loading) { <p class="muted">Loading the layout…</p> }
    @if (view && !loading && (kind === 'company' || subjectId)) {
      @for (group of groups(); track group) {
        <section class="settings-card">
          <header class="settings-card-head"><div><h2>{{ group }}</h2></div></header>
          <div class="settings-card-body home-layout-list">
            @for (block of blocksOf(group); track block.key) {
              <div class="home-layout-row" [class.is-off]="effective(block) === 'off'">
                <span class="bento-ico"><i [class]="'bi ' + block.icon"></i></span>
                <div class="home-layout-text">
                  <strong>{{ block.label }}</strong>
                  <small>{{ block.hint }}</small>
                  @if (meta(block)) { <small class="home-layout-meta">{{ meta(block) }}</small> }
                  @if (block.permitted === false && effective(block) === 'on') {
                    <span class="chip is-warn"><i class="bi bi-lock"></i> {{ subjectName() }} won't see this without {{ needText(block) }}</span>
                  }
                </div>
                <div class="seg-tabs home-layout-seg" role="radiogroup" [attr.aria-label]="block.label">
                  @if (kind !== 'company') {
                    <button type="button" role="radio" [class.is-on]="!draft[block.key]" [attr.aria-checked]="!draft[block.key]" (click)="set(block.key, '')">Inherit · {{ block.inherited === 'on' ? 'shown' : 'hidden' }}</button>
                  }
                  <button type="button" role="radio" [class.is-on]="effective(block) === 'on' && (kind === 'company' || !!draft[block.key])" [attr.aria-checked]="draft[block.key] === 'on'" (click)="set(block.key, 'on')"><i class="bi bi-eye"></i> Show</button>
                  <button type="button" role="radio" [class.is-on]="effective(block) === 'off' && (kind === 'company' || !!draft[block.key])" [attr.aria-checked]="draft[block.key] === 'off'" (click)="set(block.key, 'off')"><i class="bi bi-eye-slash"></i> Hide</button>
                </div>
              </div>
            }
          </div>
        </section>
      }
      <div class="actions">
        <button type="button" class="btn btn-gold" (click)="save()" [disabled]="busy"><i class="bi bi-check2"></i> {{ busy ? 'Saving…' : 'Save layout for ' + subjectName() }}</button>
        @if (kind !== 'company' && hasOwn()) {
          <button type="button" class="btn btn-ghost" (click)="reset()" [disabled]="busy"><i class="bi bi-arrow-counterclockwise"></i> Inherit everything</button>
        }
        @if (kind === 'company') {
          <button type="button" class="btn btn-ghost" (click)="reset()" [disabled]="busy"><i class="bi bi-arrow-counterclockwise"></i> Show every block</button>
        }
      </div>
    }
  `,
})
export class HomeLayoutSettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly kinds: Array<{ id: Kind; label: string; icon: string }> = [
    { id: 'company', label: 'Everyone', icon: 'bi bi-buildings' },
    { id: 'role', label: 'A role', icon: 'bi bi-diagram-3' },
    { id: 'department', label: 'A department', icon: 'bi bi-people' },
    { id: 'person', label: 'A person', icon: 'bi bi-person' },
  ];
  view: LayoutView | null = null;
  kind: Kind = 'company';
  subjectId = '';
  draft: Record<string, 'on' | 'off'> = {};
  loading = false;
  busy = false;
  error = '';
  ok = '';

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  kindLabel(kind: Kind): string {
    return kind === 'company' ? 'Everyone' : kind === 'role' ? 'Role' : kind === 'department' ? 'Department' : 'Person';
  }

  options(): Named[] {
    if (!this.view) return [];
    if (this.kind === 'role') return this.view.roles;
    if (this.kind === 'department') return this.view.departments;
    if (this.kind === 'person') return this.view.people.map((row) => ({ id: row.id, name: row.name + ' · ' + row.code }));
    return [];
  }

  subjectName(): string {
    if (this.kind === 'company') return 'everyone';
    return (this.options().find((row) => row.id === this.subjectId)?.name || '').split(' · ')[0];
  }

  async pickKind(kind: Kind): Promise<void> {
    if (kind === this.kind) return;
    this.kind = kind;
    this.subjectId = kind === 'company' ? '' : this.options()[0]?.id || '';
    await this.load();
  }

  async pickSubject(id: string): Promise<void> {
    this.subjectId = id;
    await this.load();
  }

  async openSaved(item: SavedLayout): Promise<void> {
    this.kind = item.kind;
    this.subjectId = item.id;
    await this.load();
  }

  groups(): string[] {
    return [...new Set((this.view?.blocks || []).map((block) => block.group))];
  }

  blocksOf(group: string): LayoutBlock[] {
    return (this.view?.blocks || []).filter((block) => block.group === group);
  }

  needText(block: LayoutBlock): string {
    if (!block.needs) return 'access';
    if (block.needs.startsWith('A ') || block.needs.startsWith('Direct reports')) return block.needs.charAt(0).toLowerCase() + block.needs.slice(1);
    return block.needs + ' access';
  }

  meta(block: LayoutBlock): string {
    const parts: string[] = [];
    if (block.needs) parts.push('Needs ' + this.needText(block) + '.');
    if (this.kind !== 'company') {
      const state = block.inherited === 'on' ? 'shown' : 'hidden';
      parts.push(block.from === 'Built-in' ? 'Shown by default.' : block.from + ' has it ' + state + '.');
    }
    return parts.join(' ');
  }

  effective(block: LayoutBlock): 'on' | 'off' {
    return this.draft[block.key] || block.inherited;
  }

  hasOwn(): boolean {
    return Object.keys(this.draft).length > 0;
  }

  set(key: string, value: '' | 'on' | 'off'): void {
    this.ok = '';
    const next = { ...this.draft };
    if (!value || (this.kind === 'company' && value === 'on')) delete next[key];
    else next[key] = value;
    this.draft = next;
  }

  async save(): Promise<void> {
    await this.send(this.draft, 'Saved. ' + (this.kind === 'company' ? 'Everyone' : this.subjectName()) + ' sees the change the next time Home opens.');
  }

  async reset(): Promise<void> {
    await this.send({}, this.kind === 'company' ? 'Every block is shown to everyone again, unless a role, department, or person layout hides it.' : this.subjectName() + ' now inherits every block.');
  }

  private async send(blocks: Record<string, 'on' | 'off'>, message: string): Promise<void> {
    if (this.kind !== 'company' && !this.subjectId) {
      this.error = 'Choose who this layout is for.';
      return;
    }
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      this.apply(await this.api.post<LayoutView>('/v1/home/layouts', { kind: this.kind, id: this.subjectId, blocks }));
      this.ok = message;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save the layout.';
    } finally {
      this.busy = false;
    }
  }

  private async load(): Promise<void> {
    this.error = '';
    this.ok = '';
    if (this.kind !== 'company' && !this.subjectId) {
      this.draft = {};
      return;
    }
    this.loading = true;
    try {
      const query = '?kind=' + this.kind + (this.subjectId ? '&id=' + encodeURIComponent(this.subjectId) : '');
      this.apply(await this.api.get<LayoutView>('/v1/home/layouts' + query));
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load the layout.';
    } finally {
      this.loading = false;
    }
  }

  private apply(view: LayoutView): void {
    this.view = view;
    const draft: Record<string, 'on' | 'off'> = {};
    for (const block of view.blocks) if (block.own) draft[block.key] = block.own;
    if (view.subject.kind === 'company') for (const key of Object.keys(draft)) if (draft[key] === 'on') delete draft[key];
    this.draft = draft;
  }
}
