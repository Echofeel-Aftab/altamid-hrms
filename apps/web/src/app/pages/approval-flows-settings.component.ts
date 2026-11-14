import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { errorText } from '../shared/kit';
import { Toast } from '../shared/toast';

interface StepConfig { kind: string; personId?: string }
interface FlowView {
  canEdit: boolean;
  kinds: Array<{ key: string; label: string }>;
  steps: Array<{ key: string; label: string }>;
  flows: Record<string, StepConfig[]>;
  people: Array<{ id: string; name: string; code: string; designation: string }>;
}

const HINTS: Record<string, string> = {
  leave: 'Every leave type.',
  regularization: 'A missed or wrong punch.',
  wfh: 'One request per day.',
  onduty: 'Client visits and travel.',
  extratime: 'Extra hours and comp-off.',
  resignation: 'Sent by the person. HR can still start or close an exit from the exits desk.',
};

/** Who approves each request type, step by step. */
@Component({
  selector: 'app-settings-flows',
  imports: [FormsModule],
  template: `
    @if (view) {
      @if (!view.canEdit) {
        <p class="banner" data-inline-message>You can view these flows. Only people with Settings access can change who approves each request.</p>
      }
      <form class="settings-card" (ngSubmit)="save()">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-diagram-2"></i></span>
          <div>
            <h2>Approval flows</h2>
            <p>Choose who approves each request, in order, up to three steps. A request goes to the next step only after the one before approves it, and a decline at any step ends it. People see each step under My requests.</p>
          </div>
        </header>
        <div class="settings-card-body">
          <p class="field-hint">Tip: pair this with <strong>Settings → Rules</strong> for leave types and reminder hours. Changes apply to <strong>new</strong> requests only.</p>
          <div class="af-list">
            @for (kind of view.kinds; track kind.key) {
              <div class="af-row">
                <strong>{{ kind.label }}<small class="field-hint">{{ hint(kind.key) }}</small></strong>
                <div class="af-steps">
                  @for (step of view.flows[kind.key]; track $index; let last = $last) {
                    <span class="af-step">
                      <b>{{ $index + 1 }}</b>
                      <label class="sr-only" [for]="'af-' + kind.key + '-' + $index">{{ kind.label }} step {{ $index + 1 }}</label>
                      <select [id]="'af-' + kind.key + '-' + $index" [name]="'af-' + kind.key + '-' + $index" [(ngModel)]="step.kind" [disabled]="!view.canEdit">
                        @for (option of view.steps; track option.key) { <option [value]="option.key">{{ option.label }}</option> }
                      </select>
                      @if (step.kind === 'person') {
                        <label class="sr-only" [for]="'af-p-' + kind.key + '-' + $index">Person</label>
                        <select [id]="'af-p-' + kind.key + '-' + $index" [name]="'af-p-' + kind.key + '-' + $index" [(ngModel)]="step.personId" [disabled]="!view.canEdit">
                          <option value="">Choose a person</option>
                          @for (person of view.people; track person.id) { <option [value]="person.id">{{ person.name }} · {{ person.designation || person.code }}</option> }
                        </select>
                      }
                      @if (view.canEdit && view.flows[kind.key].length > 1) {
                        <button type="button" class="btn btn-ghost btn-sm" (click)="remove(kind.key, $index)" [attr.aria-label]="'Remove step ' + ($index + 1)"><i class="bi bi-x-lg"></i></button>
                      }
                    </span>
                    @if (!last) { <i class="bi bi-arrow-right af-arrow" aria-hidden="true"></i> }
                  }
                  @if (view.canEdit && view.flows[kind.key].length < 3) {
                    <button type="button" class="btn btn-ghost btn-sm" (click)="add(kind.key)"><i class="bi bi-plus-lg"></i> Add a step</button>
                  }
                </div>
              </div>
            }
          </div>
          <p class="field-hint">Reporting manager falls back to HR when someone has no manager. Manager's manager is skipped when there is none. HR and Payroll mean everyone with that role in the person's outlet. Owners and anyone with company-wide approvals can still decide at any step, and the request records it as an override. A change applies to new requests; ones already sent keep their steps.</p>
          @if (view.canEdit) {
            <div class="settings-inline-save">
              <button class="btn btn-ghost" type="button" (click)="reset()" [disabled]="busy">Use the defaults</button>
              <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> Save approval flows</button>
            </div>
          }
        </div>
      </form>
    } @else if (failed) {
      <p class="form-error">{{ failed }}</p>
    }
  `,
})
export class ApprovalFlowsSettingsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly toast = inject(Toast);
  view: FlowView | null = null;
  failed = '';
  busy = false;

  async ngOnInit(): Promise<void> {
    try {
      this.view = await this.api.get<FlowView>('/v1/approval-flows');
    } catch (error) {
      this.failed = errorText(error, 'Could not load approval flows.');
    }
  }

  hint(key: string): string {
    return HINTS[key] || '';
  }

  add(kind: string): void {
    this.view?.flows[kind].push({ kind: 'hr' });
  }

  remove(kind: string, index: number): void {
    this.view?.flows[kind].splice(index, 1);
  }

  reset(): void {
    if (!this.view) return;
    for (const kind of this.view.kinds) this.view.flows[kind.key] = kind.key === 'resignation' ? [{ kind: 'manager' }, { kind: 'hr' }] : [{ kind: 'manager' }];
  }

  async save(): Promise<void> {
    if (!this.view) return;
    const missing = this.view.kinds.find((kind) => this.view!.flows[kind.key].some((step) => step.kind === 'person' && !step.personId));
    if (missing) { this.toast.warning(`${missing.label}: choose the person for the named step.`); return; }
    this.busy = true;
    try {
      const flows = Object.fromEntries(Object.entries(this.view.flows).map(([key, steps]) => [key, steps.map((step) => (step.kind === 'person' ? { kind: step.kind, personId: step.personId } : { kind: step.kind }))]));
      this.view = await this.api.post<FlowView>('/v1/approval-flows', { flows });
      this.toast.success('Approval flows saved. New requests follow them.');
    } catch (error) {
      this.toast.error(errorText(error, 'Could not save approval flows.'));
    } finally {
      this.busy = false;
    }
  }
}
