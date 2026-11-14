import { Component, Input, OnInit, inject } from '@angular/core';
import { ApiService } from '../core/api.service';

interface AccessItem {
  group: string;
  key: string;
  label: string;
  hint: string;
  fromRole: boolean;
  fromDepartment: boolean;
  fromLevel: boolean;
  personal: boolean;
  held: boolean;
}

interface AccessPanel {
  employeeId: string;
  name: string;
  role: { id: string; label: string; scope?: string };
  department: { id: string; name: string } | null;
  level: { id: string; name: string } | null;
  canEdit: boolean;
  items: AccessItem[];
}

@Component({
  selector: 'app-access-panel',
  template: `
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (panel) {
      <section class="card access-board">
        <h2><i class="bi bi-shield-lock"></i> Access</h2>
        <p class="muted">{{ panel.name }} is {{ panel.role.label }}@if (panel.role.scope === 'team') {, own team only }. A permission is on when the role, {{ panel.department?.name || 'the department' }}@if (panel.level) {, the {{ panel.level.name }} grade }, or this person has it. The role column is changed for the whole rung in Settings → Access.</p>
        @if (ok) { <p class="form-ok">{{ ok }}</p> }
        <div class="access-head">
          <span></span>
          <span>Role</span>
          <span>Department</span>
          <span>Grade</span>
          <span>This person</span>
        </div>
        @for (item of panel.items; track item.key; let index = $index) {
          @if (index === 0 || panel.items[index - 1].group !== item.group) { <h3>{{ item.group }}</h3> }
          <div class="access-row">
            <div>
              <strong>{{ item.label }}</strong>
              <small>{{ item.hint }}</small>
              @if (item.held) { <em>Has this</em> }
            </div>
            <span class="access-mark" [class.is-on]="item.fromRole">{{ item.fromRole ? 'On' : 'Off' }}</span>
            @if (panel.canEdit && panel.department) {
              <button type="button" [class.is-on]="item.fromDepartment" (click)="item.fromDepartment = !item.fromDepartment">{{ item.fromDepartment ? 'On' : 'Off' }}</button>
            } @else {
              <span class="access-mark" [class.is-on]="item.fromDepartment">{{ panel.department ? (item.fromDepartment ? 'On' : 'Off') : '—' }}</span>
            }
            @if (panel.canEdit && panel.level) {
              <button type="button" [class.is-on]="item.fromLevel" (click)="item.fromLevel = !item.fromLevel">{{ item.fromLevel ? 'On' : 'Off' }}</button>
            } @else {
              <span class="access-mark" [class.is-on]="item.fromLevel">{{ panel.level ? (item.fromLevel ? 'On' : 'Off') : '—' }}</span>
            }
            @if (panel.canEdit) {
              <button type="button" [class.is-on]="item.personal" (click)="item.personal = !item.personal">{{ item.personal ? 'On' : 'Off' }}</button>
            } @else {
              <span class="access-mark" [class.is-on]="item.personal">{{ item.personal ? 'On' : 'Off' }}</span>
            }
          </div>
        }
        @if (panel.canEdit) {
          <div class="actions">
            <button type="button" class="btn btn-gold" (click)="save()" [disabled]="busy">{{ busy ? 'Saving…' : 'Save this person’s access' }}</button>
          </div>
        }
      </section>
    }
  `,
})
export class AccessPanelComponent implements OnInit {
  private readonly api = inject(ApiService);
  @Input() employeeId = '';
  panel: AccessPanel | null = null;
  error = '';
  ok = '';
  busy = false;
  async ngOnInit(): Promise<void> {
    try {
      const path = this.employeeId ? '/v1/access/person/' + this.employeeId : '/v1/access/me';
      this.panel = await this.api.get<AccessPanel>(path);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load access.';
    }
  }

  async save(): Promise<void> {
    if (!this.panel) return;
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      this.panel = await this.api.post<AccessPanel>('/v1/access/person', {
        employeeId: this.panel.employeeId,
        personal: this.panel.items.filter((item) => item.personal).map((item) => item.key),
        department: this.panel.items.filter((item) => item.fromDepartment).map((item) => item.key),
        level: this.panel.items.filter((item) => item.fromLevel).map((item) => item.key),
      });
      this.ok = this.panel.department
        ? 'Saved. Department rows apply to everyone in ' + this.panel.department.name + '.'
        : 'Saved for this person.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save access.';
    } finally {
      this.busy = false;
    }
  }
}
