import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { bankFromIfsc, cleanIfsc } from '../core/bank';
import { I18n } from '../core/i18n';
import { Org, Person } from '../core/models';
import { SessionStore } from '../core/session.store';
import { AccessPanelComponent } from './access-panel.component';
import { squarePhoto } from '../core/photo';
import { PasswordToggleDirective } from '../shared/password-toggle.directive';
import { PhotoComponent } from '../shared/photo.component';

type Draft = Record<string, string | boolean>;
interface Change { key: string; label: string; before: string; after: string }

const LABELS: Record<string, string> = {
  firstName: 'First name', lastName: 'Last name', email: 'Email', phone: 'Phone', workerType: 'Worker type',
  status: 'Status', departmentId: 'Department', designationId: 'Designation', levelId: 'Grade', teamId: 'Team',
  agencyId: 'Agency', clientId: 'Client', locationId: 'Location', managerId: 'Manager', dateOfJoining: 'Joined',
  dateOfExit: 'Left', confirmedOn: 'Confirmed', probationEndsOn: 'Probation ends', gender: 'Gender', dateOfBirth: 'Date of birth',
  maritalStatus: 'Marital status', nationality: 'Nationality', bloodGroup: 'Blood group',
  emergencyName: 'Emergency contact', emergencyPhone: 'Emergency phone', address: 'Address', costCentre: 'Cost centre',
  pan: 'PAN', bankName: 'Bank', bankAccount: 'Account number', ifsc: 'IFSC', signIn: 'Can sign in', role: 'Role',
  password: 'New password', personalEmail: 'Personal email', fatherName: "Father's name", spouseName: "Spouse's name",
  emergencyRelation: 'Emergency relation', city: 'City', state: 'State', pincode: 'PIN code', permanentAddress: 'Permanent address',
  nomineeName: 'Nominee', nomineeRelation: 'Nominee relation', aadhaar: 'Aadhaar', uan: 'UAN', esicNo: 'ESIC number', taxRegime: 'Tax regime',
};
const EXTRA = ['personalEmail', 'fatherName', 'spouseName', 'emergencyRelation', 'city', 'state', 'pincode', 'permanentAddress', 'nomineeName', 'nomineeRelation', 'aadhaar', 'uan', 'esicNo', 'taxRegime'];
const SECRET = new Set(['pan', 'bankAccount', 'ifsc', 'password', 'aadhaar']);

@Component({
  selector: 'app-person',
  imports: [FormsModule, RouterLink, AccessPanelComponent, PhotoComponent, PasswordToggleDirective],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-person-vcard"></i></span>
        <p class="eyebrow">Directory</p>
        <h1>{{ creating ? 'Add a person' : 'Employee profile' }}</h1>
      </div>
      <a class="btn btn-ghost" routerLink="/people"><i class="bi bi-arrow-left"></i> {{ i18n.t('Back to people') }}</a>
    </div>
    @if (error) { <p class="form-error"><i class="bi bi-exclamation-octagon"></i> {{ error }}</p> }
    @if (ok) { <p class="form-ok"><i class="bi bi-check-circle"></i> {{ ok }}</p> }
    @if (creating && prefilled) { <p class="banner"><i class="bi bi-person-check"></i> {{ prefilled }}</p> }

    @if (!creating && person) {
      <section class="p-hero">
        <div class="p-hero-band">
          <div class="p-band-row" aria-label="At a glance">
            @if (person.manager || person.location?.city) {
              <div class="p-band-lead">
                @if (person.manager) {
                  <a class="p-band-item" [routerLink]="['/people', person.manager.id]">
                    <i class="bi bi-diagram-3"></i>
                    <span><small>Reports to</small><strong>{{ person.manager.name }}</strong></span>
                  </a>
                }
                @if (person.location?.city) {
                  <div class="p-band-item">
                    <i class="bi bi-geo-alt"></i>
                    <span><small>Based in</small><strong>{{ person.location?.city }}@if (person.location?.state) {, {{ person.location?.state }}}</strong></span>
                  </div>
                }
              </div>
            }
            @if (todayCell) {
              <a class="p-band-item" routerLink="/attendance" [class.is-live]="todayCell.live">
                <i class="bi" [class]="todayCell.icon"></i>
                <span><small>Today</small><strong>{{ todayCell.label }}</strong></span>
              </a>
            }
            @if (milestone) {
              <div class="p-band-item" [class.is-party]="milestone.days === 0">
                <i class="bi" [class]="milestone.icon"></i>
                <span><small>{{ milestone.label }}</small><strong>{{ milestone.when }}</strong></span>
              </div>
            }
            @if (stage) {
              <div class="p-band-item">
                <i class="bi" [class]="stage.icon"></i>
                <span><small>{{ stage.label }}</small><strong>{{ stage.when }}</strong></span>
              </div>
            }
            @if (privateView && completeness) {
              @if (canEdit && completeness.missing.length) {
                <button type="button" class="p-band-item p-band-meter" (click)="tab = 'edit'" [title]="'Missing: ' + completeness.missing.join(', ')">
                  <i class="bi bi-person-lines-fill"></i>
                  <span><small>Profile {{ completeness.percent }}% complete</small><strong>{{ completeness.missing.length }} {{ completeness.missing.length === 1 ? 'detail' : 'details' }} to add</strong><b><em [style.width.%]="completeness.percent"></em></b></span>
                </button>
              } @else {
                <div class="p-band-item p-band-meter" [title]="completeness.missing.length ? 'Missing: ' + completeness.missing.join(', ') : 'Every detail is filled in'">
                  <i class="bi" [class]="completeness.missing.length ? 'bi-person-lines-fill' : 'bi-patch-check-fill'"></i>
                  <span><small>Profile {{ completeness.percent }}% complete</small><strong>{{ completeness.missing.length ? completeness.missing.length + ' to add' : 'All details in' }}</strong><b><em [style.width.%]="completeness.percent"></em></b></span>
                </div>
              }
            }
          </div>
        </div>
        <div class="p-hero-body">
          <div class="p-avatar-wrap">
            <app-photo [personId]="person.id" [stamp]="person.photo || ''" [name]="person.name" />
            @if (canEdit || mine) {
              <label class="p-avatar-cam" [title]="person.photo ? 'Change photo' : 'Add photo'">
                <i class="bi" [class]="photoBusy ? 'bi-hourglass-split' : 'bi-camera-fill'"></i>
                <span class="sr-only">{{ person.photo ? 'Change photo' : 'Add photo' }}</span>
                <input type="file" accept="image/*" class="sr-only" [disabled]="photoBusy" (change)="pickPhoto($event)">
              </label>
            }
          </div>
          <div class="p-hero-id">
            <h2>{{ person.name }}</h2>
            <p>{{ person.designation?.name || 'Team member' }}@if (person.department) { · {{ person.department.name }} }</p>
            <div class="chip-row">
              <span [class]="'chip chip-dot ' + tone(person.status)">{{ person.status }}</span>
              <span class="chip"><i class="bi bi-hash"></i>{{ person.code }}</span>
              <span class="chip is-cap"><i class="bi bi-briefcase"></i>{{ person.workerType }}</span>
              @if (person.location) { <span class="chip"><i class="bi bi-geo-alt"></i>{{ person.location.name }}</span> }
              @if (person.agency) { <span class="chip is-info"><i class="bi bi-building"></i>Through {{ person.agency.name }}</span> }
              @if (person.client) { <span class="chip is-info"><i class="bi bi-buildings"></i>At {{ person.client.name }}</span> }
            </div>
          </div>
          <div class="p-hero-actions">
            @if (person.email) { <a class="btn btn-ghost" [href]="'mailto:' + person.email"><i class="bi bi-envelope"></i> Email</a> }
            @if (canEdit) {
              <button type="button" class="btn btn-primary" (click)="tab = 'edit'"><i class="bi bi-pencil-square"></i> Edit details</button>
            } @else if (mine) {
              <a class="btn btn-primary" routerLink="/profile" [queryParams]="{ tab: 'details' }"><i class="bi bi-pencil-square"></i> Update my details</a>
            }
          </div>
        </div>
      </section>

      <nav class="seg-tabs" aria-label="Profile sections">
        @for (item of tabs; track item.id) {
          <button type="button" [class.is-on]="tab === item.id" (click)="tab = item.id"><i [class]="item.icon"></i> {{ item.label }}</button>
        }
      </nav>

      @switch (tab) {
        @case ('overview') {
          <div class="bento">
            <article class="bento-stat"><span class="bento-ico"><i class="bi bi-calendar-check"></i></span><small>{{ i18n.t('Joined') }}</small><strong>{{ dayLabel(person.dateOfJoining) }}</strong></article>
            <article class="bento-stat"><span class="bento-ico is-gold"><i class="bi bi-hourglass-split"></i></span><small>{{ i18n.t('Total service') }}</small><strong>{{ person.service || i18n.t('Not added') }}</strong></article>
            <article class="bento-stat"><span class="bento-ico"><i class="bi bi-diagram-3"></i></span><small>{{ i18n.t('Manager') }}</small><strong>{{ person.manager?.name || i18n.t('Not added') }}</strong></article>
            <article class="bento-stat"><span class="bento-ico is-ok"><i class="bi bi-shield-check"></i></span><small>Sign-in</small><strong>{{ person.signIn?.active ? roleName(person.signIn?.role || '') : 'No sign-in' }}</strong></article>

            <section class="card bento-wide">
              <div class="card-head"><h2><i class="bi bi-briefcase"></i> Work</h2><span class="source-chip"><i class="bi bi-database"></i> HR record</span></div>
              <dl class="kv">
                <div><dt>Department</dt><dd>{{ person.department?.name || '—' }}</dd></div>
                <div><dt>Designation</dt><dd>{{ person.designation?.name || '—' }}</dd></div>
                <div><dt>Grade</dt><dd>{{ person.level?.name || '—' }}</dd></div>
                <div><dt>Team</dt><dd>{{ person.team?.name || '—' }}</dd></div>
                <div><dt>Location</dt><dd>{{ person.location?.name || '—' }}</dd></div>
                <div><dt>Cost centre</dt><dd>{{ person.costCentre || '—' }}</dd></div>
                <div><dt>Confirmed</dt><dd>{{ person.confirmedOn ? dayLabel(person.confirmedOn) : '—' }}</dd></div>
                @if (!person.confirmedOn && person.probationEndsOn) { <div><dt>Probation ends</dt><dd>{{ dayLabel(person.probationEndsOn) }}</dd></div> }
                @if (person.dateOfExit) { <div><dt>Left</dt><dd>{{ dayLabel(person.dateOfExit) }}</dd></div> }
              </dl>
            </section>
            <section class="card">
              <div class="card-head"><h2><i class="bi bi-telephone"></i> Contact</h2><span class="source-chip"><i class="bi bi-person"></i> Self + HR</span></div>
              <dl class="kv is-stack">
                <div><dt>Email</dt><dd>{{ person.email || i18n.t('Not added') }}</dd></div>
                <div><dt>Phone</dt><dd>{{ person.phone || i18n.t('Not added') }}</dd></div>
                @if (privateView) {
                  <div><dt>Emergency</dt><dd>{{ person.emergencyName || i18n.t('Not added') }}@if (person.emergencyPhone) { · {{ person.emergencyPhone }} }</dd></div>
                }
              </dl>
            </section>
            @if (tasks.length) {
              <section class="card bento-wide">
                <div class="card-head"><h2><i class="bi bi-list-check"></i> Onboarding</h2><span [class]="'chip ' + (doneCount === tasks.length ? 'is-ok' : 'is-warn')">{{ doneCount }} of {{ tasks.length }} done</span></div>
                <div class="progress"><span [style.width.%]="(doneCount / tasks.length) * 100"></span></div>
                <button type="button" class="btn btn-ghost btn-sm" (click)="tab = 'onboarding'">Open checklist <i class="bi bi-arrow-right"></i></button>
              </section>
            }
          </div>
        }
        @case ('personal') {
          <section class="card">
            <div class="card-head"><h2><i class="bi bi-person-heart"></i> {{ i18n.t('Personal') }}</h2><span class="source-chip"><i class="bi bi-lock"></i> Private to HR and this person</span></div>
            <div class="tile-grid">
              <div class="tile"><small>{{ i18n.t('Date of birth') }}</small><strong>{{ person.dateOfBirth ? dayLabel(person.dateOfBirth) : i18n.t('Not added') }}</strong></div>
              <div class="tile"><small>{{ i18n.t('Gender') }}</small><strong>{{ person.gender || i18n.t('Not added') }}</strong></div>
              <div class="tile"><small>{{ i18n.t('Marital status') }}</small><strong>{{ person.maritalStatus || i18n.t('Not added') }}</strong></div>
              <div class="tile"><small>{{ i18n.t('Nationality') }}</small><strong>{{ person.nationality || i18n.t('Not added') }}</strong></div>
              <div class="tile"><small>{{ i18n.t('Blood group') }}</small><strong>{{ person.bloodGroup || i18n.t('Not added') }}</strong></div>
              <div class="tile"><small>{{ i18n.t("Father's name") }}</small><strong>{{ person.fatherName || i18n.t('Not added') }}</strong></div>
              @if (person.spouseName) { <div class="tile"><small>Spouse's name</small><strong>{{ person.spouseName }}</strong></div> }
              <div class="tile"><small>Personal email</small><strong>{{ person.personalEmail || i18n.t('Not added') }}</strong></div>
            </div>
          </section>
          <section class="card">
            <div class="card-head"><h2><i class="bi bi-geo-alt"></i> Address and contacts</h2><span class="source-chip"><i class="bi bi-person"></i> Kept by the person</span></div>
            <div class="tile-grid">
              <div class="tile"><small>Current address</small><strong>{{ currentAddress || i18n.t('Not added') }}</strong></div>
              <div class="tile"><small>Permanent address</small><strong>{{ person.permanentAddress || i18n.t('Not added') }}</strong></div>
              <div class="tile"><small>Emergency contact</small><strong>{{ person.emergencyName || i18n.t('Not added') }}@if (person.emergencyRelation) { · {{ person.emergencyRelation }} }@if (person.emergencyPhone) { · {{ person.emergencyPhone }} }</strong></div>
              <div class="tile"><small>Nominee</small><strong>{{ person.nomineeName || i18n.t('Not added') }}@if (person.nomineeRelation) { · {{ person.nomineeRelation }} }</strong></div>
            </div>
          </section>
          <section class="card">
            <div class="card-head"><h2><i class="bi bi-bank"></i> Statutory and bank</h2><span class="source-chip"><i class="bi bi-shield-lock"></i> Encrypted</span></div>
            <div class="tile-grid">
              <div class="tile"><small>PAN</small><strong>{{ person.pan || i18n.t('Not added') }}</strong></div>
              <div class="tile"><small>Aadhaar</small><strong>{{ person.aadhaar || i18n.t('Not added') }}</strong></div>
              <div class="tile"><small>UAN</small><strong>{{ person.uan || i18n.t('Not added') }}</strong></div>
              <div class="tile"><small>ESIC number</small><strong>{{ person.esicNo || i18n.t('Not added') }}</strong></div>
              <div class="tile"><small>Bank</small><strong>{{ person.bankName || i18n.t('Not added') }}@if (person.ifsc) { · {{ person.ifsc }} }</strong></div>
              <div class="tile"><small>Account</small><strong>{{ person.bankAccount ? '••••' + person.bankAccount.slice(-4) : i18n.t('Not added') }}</strong></div>
              <div class="tile"><small>Tax regime</small><strong>{{ person.taxRegime === 'new' ? 'New regime' : person.taxRegime === 'old' ? 'Old regime' : 'Not chosen' }}</strong></div>
            </div>
          </section>
        }
        @case ('access') {
          <app-access-panel [employeeId]="person.id" />
        }
        @case ('onboarding') {
          <section class="card">
            <div class="card-head"><h2><i class="bi bi-list-check"></i> {{ i18n.t('Onboarding') }}</h2>
              @if (tasks.length) { <span [class]="'chip ' + (doneCount === tasks.length ? 'is-ok' : 'is-warn')">{{ doneCount }} of {{ tasks.length }} done</span> }
            </div>
            @if (tasks.length) { <div class="progress"><span [style.width.%]="(doneCount / tasks.length) * 100"></span></div> }
            @if (!tasks.length) { <p class="muted">No onboarding tasks yet. They appear when the person is still onboarding.</p> }
            <ol class="tracker">
              @for (task of tasks; track task.id) {
                <li [class.is-done]="task.done">
                  <label class="tracker-step">
                    <input type="checkbox" [checked]="task.done" [disabled]="!canEdit" (change)="toggleTask(task, $any($event.target).checked)">
                    <span class="tracker-dot" aria-hidden="true"><i [class]="task.done ? 'bi bi-check-lg' : 'bi bi-circle'"></i></span>
                    <span class="tracker-title">{{ task.title }}</span>
                  </label>
                  <span [class]="'chip ' + (task.done ? 'is-ok' : '')">{{ task.done ? 'Completed' : 'Pending' }}</span>
                </li>
              }
            </ol>
            @if (canEdit) {
              <form class="org-add" (ngSubmit)="addTask()">
                <input name="task" [(ngModel)]="taskTitle" placeholder="Add a task" aria-label="Onboarding task">
                <button class="btn btn-secondary" type="submit"><i class="bi bi-plus-lg"></i> Add</button>
              </form>
            }
          </section>
        }
      }
    }

    @if (review) {
      <section class="approval-card" role="alertdialog" aria-label="Review changes">
        <div class="approval-head">
          <span class="approval-ico"><i class="bi bi-shield-exclamation"></i></span>
          <div>
            <h2>Review before saving</h2>
            <p>{{ review.length }} {{ review.length === 1 ? 'field changes' : 'fields change' }} on {{ person?.name }}. Nothing is written until you approve.</p>
          </div>
          <span class="chip is-warn">Needs approval</span>
        </div>
        <ul class="diff-list">
          @for (row of review; track row.key) {
            <li>
              <span class="diff-key">{{ row.label }}</span>
              <span class="diff-old">{{ row.before }}</span>
              <i class="bi bi-arrow-right" aria-hidden="true"></i>
              <span class="diff-new">{{ row.after }}</span>
            </li>
          }
        </ul>
        <div class="actions">
          <button type="button" class="btn btn-primary" [disabled]="busy" (click)="approve()"><i class="bi bi-check2"></i> {{ busy ? 'Saving…' : 'Approve and save' }}</button>
          <button type="button" class="btn btn-ghost" (click)="review = null"><i class="bi bi-pencil"></i> Keep editing</button>
          <button type="button" class="btn btn-ghost btn-danger" (click)="discard()"><i class="bi bi-x-lg"></i> Discard changes</button>
        </div>
      </section>
    }

    @if (canEdit && (creating || tab === 'edit')) {
      <form class="form-stack" (ngSubmit)="submit()">
        <section class="form-section">
          <header><span class="bento-ico"><i class="bi bi-person"></i></span><div><h2><i class="bi bi-person-vcard"></i> Identity</h2><p>Name and how to reach them.</p></div></header>
          <div class="form-cols">
            <div><label for="first">First name</label><input id="first" name="first" [(ngModel)]="firstName" required></div>
            <div><label for="last">Last name</label><input id="last" name="last" [(ngModel)]="lastName"></div>
            <div><label for="email">Email</label><input id="email" name="email" type="email" [(ngModel)]="email"></div>
            <div><label for="phone">Phone</label><input id="phone" name="phone" [(ngModel)]="phone"></div>
          </div>
        </section>
        <section class="form-section">
          <header><span class="bento-ico"><i class="bi bi-briefcase"></i></span><div><h2><i class="bi bi-briefcase"></i> Job</h2><p>Where they sit and who they report to.</p></div></header>
          <div class="form-cols">
            <div>
              <label for="worker">Worker type</label>
              <select id="worker" name="worker" [(ngModel)]="workerType">
                <option value="employee">Employee</option>
                <option value="contractor">Contractor</option>
                <option value="intern">Intern</option>
              </select>
            </div>
            <div>
              <label for="status">Status</label>
              <select id="status" name="status" [(ngModel)]="status">
                <option value="onboarding">Onboarding</option>
                <option value="active">Active</option>
                <option value="exited">Exited</option>
              </select>
            </div>
            <div>
              <label for="department">Department</label>
              <select id="department" name="department" [(ngModel)]="departmentId">
                <option value="">None</option>
                @for (item of org?.departments || []; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
              </select>
            </div>
            <div>
              <label for="designation">Designation</label>
              <select id="designation" name="designation" [(ngModel)]="designationId">
                <option value="">None</option>
                @for (item of org?.designations || []; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
              </select>
            </div>
            <div>
              <label for="level">Grade</label>
              <select id="level" name="level" [(ngModel)]="levelId">
                <option value="">No grade</option>
                @for (item of org?.levels || []; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
              </select>
            </div>
            <div>
              <label for="team">Team</label>
              <select id="team" name="team" [(ngModel)]="teamId">
                <option value="">No team</option>
                @for (item of org?.teams || []; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
              </select>
            </div>
            <div>
              <label for="location">Location</label>
              <select id="location" name="location" [(ngModel)]="locationId">
                <option value="">None</option>
                @for (item of org?.locations || []; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
              </select>
            </div>
            <div>
              <label for="manager">Manager</label>
              <select id="manager" name="manager" [(ngModel)]="managerId">
                <option value="">None</option>
                @for (item of managers; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
              </select>
            </div>
            @if (suppliers.length) {
              <div>
                <label for="agency">Employed through agency</label>
                <select id="agency" name="agency" [(ngModel)]="agencyId">
                  <option value="">On our own rolls</option>
                  @for (item of suppliers; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
                </select>
              </div>
            }
            @if (clients.length) {
              <div>
                <label for="client">Working at client</label>
                <select id="client" name="client" [(ngModel)]="clientId">
                  <option value="">Not deployed</option>
                  @for (item of clients; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
                </select>
              </div>
            }
            <div><label for="centre">Cost centre</label><input id="centre" name="centre" [(ngModel)]="costCentre"></div>
          </div>
        </section>
        <section class="form-section">
          <header><span class="bento-ico is-gold"><i class="bi bi-calendar3"></i></span><div><h2><i class="bi bi-calendar-event"></i> Dates</h2><p>Joining, confirmation, and exit.</p></div></header>
          <div class="form-cols is-three">
            <div><label for="joined">Joined</label><input id="joined" name="joined" type="date" [(ngModel)]="dateOfJoining" required></div>
            <div><label for="confirmed">Confirmed</label><input id="confirmed" name="confirmed" type="date" [(ngModel)]="confirmedOn"></div>
            <div><label for="probation-ends">Probation ends</label><input id="probation-ends" name="probationEndsOn" type="date" [(ngModel)]="probationEndsOn"></div>
            <div><label for="left">Left, if exited</label><input id="left" name="left" type="date" [(ngModel)]="dateOfExit"></div>
          </div>
        </section>
        <section class="form-section">
          <header><span class="bento-ico"><i class="bi bi-person-heart"></i></span><div><h2><i class="bi bi-person"></i> Personal</h2><p>Visible to HR and this person only.</p></div></header>
          <div class="form-cols is-three">
            <div><label for="birth">Date of birth</label><input id="birth" name="birth" type="date" [(ngModel)]="dateOfBirth"></div>
            <div>
              <label for="gender">Gender</label>
              <select id="gender" name="gender" [(ngModel)]="gender">
                <option value="">Not added</option><option>Female</option><option>Male</option><option>Other</option>
              </select>
            </div>
            <div>
              <label for="marital">Marital status</label>
              <select id="marital" name="marital" [(ngModel)]="maritalStatus">
                <option value="">Not added</option><option>Single</option><option>Married</option><option>Other</option>
              </select>
            </div>
            <div>
              <label for="blood">Blood group</label>
              <select id="blood" name="blood" [(ngModel)]="bloodGroup">
                <option value="">Not added</option>
                @for (group of bloodGroups; track group) { <option [value]="group">{{ group }}</option> }
              </select>
            </div>
            <div><label for="nation">Nationality</label><input id="nation" name="nation" [(ngModel)]="nationality"></div>
            <div><label for="emergency">Emergency contact</label><input id="emergency" name="emergency" [(ngModel)]="emergencyName"></div>
            <div><label for="emergencyPhone">Emergency phone</label><input id="emergencyPhone" name="emergencyPhone" [(ngModel)]="emergencyPhone"></div>
            <div><label for="emergencyRelation">Relation</label><input id="emergencyRelation" name="emergencyRelation" [(ngModel)]="extra['emergencyRelation']"></div>
            <div><label for="father">Father's name</label><input id="father" name="father" [(ngModel)]="extra['fatherName']"></div>
            <div><label for="spouse">Spouse's name</label><input id="spouse" name="spouse" [(ngModel)]="extra['spouseName']"></div>
            <div><label for="pmail">Personal email</label><input id="pmail" name="pmail" type="email" [(ngModel)]="extra['personalEmail']"></div>
            <div><label for="nominee">Nominee</label><input id="nominee" name="nominee" [(ngModel)]="extra['nomineeName']"></div>
            <div><label for="nomineeRelation">Nominee relation</label><input id="nomineeRelation" name="nomineeRelation" [(ngModel)]="extra['nomineeRelation']"></div>
          </div>
        </section>
        <section class="form-section">
          <header><span class="bento-ico"><i class="bi bi-house"></i></span><div><h2><i class="bi bi-geo-alt"></i> Address</h2><p>The person can keep this up to date from My profile.</p></div></header>
          <div class="form-cols is-three">
            <div class="span-3"><label for="address">Current address</label><input id="address" name="address" [(ngModel)]="address"></div>
            <div><label for="city">City</label><input id="city" name="city" [(ngModel)]="extra['city']"></div>
            <div><label for="state">State</label><input id="state" name="state" [(ngModel)]="extra['state']"></div>
            <div><label for="pin">PIN code</label><input id="pin" name="pin" inputmode="numeric" maxlength="6" [(ngModel)]="extra['pincode']"></div>
            <div class="span-3"><label for="permanent">Permanent address</label><input id="permanent" name="permanent" [(ngModel)]="extra['permanentAddress']"></div>
          </div>
        </section>
        <section class="form-section">
          <header><span class="bento-ico is-ok"><i class="bi bi-lock"></i></span><div><h2><i class="bi bi-credit-card"></i> Pay details</h2><p>Stored encrypted. Shown in full only to HR, payroll, and the person.</p></div><span class="source-chip"><i class="bi bi-shield-lock"></i> Encrypted</span></header>
          <div class="form-cols">
            <div><label for="pan">PAN</label><input id="pan" name="pan" [(ngModel)]="pan" autocomplete="off"></div>
            <div><label for="bankName">Bank</label><input id="bankName" name="bankName" [(ngModel)]="bankName"></div>
            <div><label for="bank">Account number</label><input id="bank" name="bank" [(ngModel)]="bankAccount" autocomplete="off"></div>
            <div><label for="ifsc">IFSC</label><input id="ifsc" name="ifsc" [ngModel]="ifsc" (ngModelChange)="onIfsc($event)" autocomplete="off" maxlength="11" placeholder="HDFC0001234" style="text-transform: uppercase"></div>
            <div><label for="aadhaar">Aadhaar</label><input id="aadhaar" name="aadhaar" [(ngModel)]="extra['aadhaar']" autocomplete="off" inputmode="numeric" maxlength="14"></div>
            <div><label for="uan">UAN</label><input id="uan" name="uan" [(ngModel)]="extra['uan']" inputmode="numeric" maxlength="12"></div>
            <div><label for="esic">ESIC number</label><input id="esic" name="esic" [(ngModel)]="extra['esicNo']" inputmode="numeric" maxlength="17"></div>
            <div>
              <label for="regime">Tax regime</label>
              <select id="regime" name="regime" [(ngModel)]="extra['taxRegime']">
                <option value="">Not chosen</option><option value="new">New regime</option><option value="old">Old regime</option>
              </select>
            </div>
          </div>
        </section>
        <section class="form-section">
          <header><span class="bento-ico"><i class="bi bi-key"></i></span><div><h2><i class="bi bi-key"></i> Sign-in</h2><p>Role sets what they can open. Access adds more.</p></div></header>
          <label class="switch-line"><input class="switch" type="checkbox" name="signIn" [(ngModel)]="signIn"> They can sign in</label>
          @if (signIn) {
            <div class="form-cols">
              <div>
                <label for="role">Role</label>
                <select id="role" name="role" [(ngModel)]="role">
                  @for (item of org?.roles || []; track item.id) {
                    <option [value]="item.id">{{ item.name }} · {{ item.scope === 'team' ? 'own team' : 'company' }}</option>
                  }
                </select>
              </div>
              <div>
                <label for="password">{{ creating ? 'Password' : 'New password, optional' }}</label>
                <input id="password" name="password" type="password" [(ngModel)]="password" [required]="creating && signIn" autocomplete="new-password">
              </div>
            </div>
          }
        </section>
        <div class="form-bar">
          <span class="muted"><i class="bi bi-info-circle"></i> {{ creating ? 'The person is added when you save.' : 'You will review the changes before anything is saved.' }}</span>
          <button class="btn btn-primary" type="submit" [disabled]="busy || !!review">{{ busy ? 'Saving…' : (creating ? 'Add person' : 'Review changes') }}</button>
        </div>
      </form>
    }

  `,
})
export class PersonComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly store = inject(SessionStore);
  private readonly destroyRef = inject(DestroyRef);
  readonly i18n = inject(I18n);
  creating = false;
  canEdit = false;
  tab = 'overview';
  person: Person | null = null;
  tasks: Array<{ id: string; title: string; done: boolean }> = [];
  taskTitle = '';
  org: Org | null = null;
  managers: Array<{ id: string; name: string }> = [];
  firstName = '';
  lastName = '';
  email = '';
  phone = '';
  workerType = 'employee';
  status = 'active';
  departmentId = '';
  designationId = '';
  levelId = '';
  teamId = '';
  agencyId = '';
  clientId = '';
  suppliers: Array<{ id: string; name: string }> = [];
  clients: Array<{ id: string; name: string }> = [];
  locationId = '';
  managerId = '';
  dateOfJoining = '';
  dateOfExit = '';
  confirmedOn = '';
  probationEndsOn = '';
  prefilled = '';
  gender = '';
  dateOfBirth = '';
  maritalStatus = '';
  nationality = '';
  bloodGroup = '';
  emergencyName = '';
  emergencyPhone = '';
  address = '';
  costCentre = '';
  readonly bloodGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
  pan = '';
  bankName = '';
  bankAccount = '';
  ifsc = '';
  signIn = true;
  role = 'employee';
  password = '';
  error = '';
  ok = '';
  busy = false;
  review: Change[] | null = null;
  extra: Record<string, string> = {};
  photoBusy = false;
  todayCell: { label: string; icon: string; live: boolean } | null = null;
  private readonly today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  private baseline: Draft = {};

  get milestone(): { icon: string; label: string; when: string; days: number } | null {
    const person = this.person;
    if (!person || person.dateOfExit) return null;
    const year = Number(this.today.slice(0, 4));
    const next = (mmdd: string) => (`${year}-${mmdd}` >= this.today ? `${year}-${mmdd}` : `${year + 1}-${mmdd}`);
    const options: Array<{ icon: string; label: string; days: number; kind: 'birthday' | 'work' }> = [];
    if (this.privateView && /^\d{4}-\d{2}-\d{2}$/.test(person.dateOfBirth)) {
      options.push({ icon: 'bi-cake2', label: 'Birthday', days: this.gap(this.today, next(person.dateOfBirth.slice(5))), kind: 'birthday' });
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(person.dateOfJoining) && person.dateOfJoining < this.today) {
      const day = next(person.dateOfJoining.slice(5));
      const years = Number(day.slice(0, 4)) - Number(person.dateOfJoining.slice(0, 4));
      if (years > 0) options.push({ icon: 'bi-balloon', label: `${years}-year work anniversary`, days: this.gap(this.today, day), kind: 'work' });
    }
    const soonest = options.sort((left, right) => left.days - right.days)[0];
    if (!soonest || soonest.days > 60) return null;
    if (soonest.days === 0) return { icon: soonest.kind === 'birthday' ? 'bi-cake2-fill' : 'bi-stars', label: soonest.label, when: soonest.kind === 'birthday' ? 'Today, wish them!' : 'Today', days: 0 };
    return { icon: soonest.icon, label: soonest.label, when: soonest.days === 1 ? 'Tomorrow' : `In ${soonest.days} days`, days: soonest.days };
  }

  get stage(): { icon: string; label: string; when: string } | null {
    const person = this.person;
    if (!person) return null;
    if (person.dateOfExit) return { icon: 'bi-box-arrow-right', label: person.dateOfExit > this.today ? 'Last day' : 'Left on', when: this.dayLabel(person.dateOfExit) };
    if (person.dateOfJoining > this.today) return { icon: 'bi-door-open', label: 'Joins', when: this.inDays(person.dateOfJoining) };
    if (person.confirmedOn) return { icon: 'bi-patch-check', label: 'Confirmed', when: this.dayLabel(person.confirmedOn) };
    if (person.probationEndsOn) {
      return person.probationEndsOn >= this.today
        ? { icon: 'bi-hourglass-split', label: 'Probation ends', when: this.inDays(person.probationEndsOn) }
        : { icon: 'bi-exclamation-circle', label: 'Probation ended', when: this.dayLabel(person.probationEndsOn) + ' · not confirmed' };
    }
    return null;
  }

  get completeness(): { percent: number; missing: string[] } | null {
    const person = this.person;
    if (!person) return null;
    const checks: Array<[string, unknown]> = [
      ['Photo', person.photo], ['Phone', person.phone], ['Email', person.email], ['Department', person.department],
      ['Designation', person.designation], ['Location', person.location], ['Manager', person.manager],
      ['Date of birth', person.dateOfBirth], ['Gender', person.gender], ['Emergency contact', person.emergencyName],
      ['Address', person.address], ['PAN', person.pan], ['Bank account', person.bankAccount], ['IFSC', person.ifsc],
    ];
    const missing = checks.filter(([, value]) => !value).map(([label]) => label);
    return { percent: Math.round(((checks.length - missing.length) / checks.length) * 100), missing };
  }

  private gap(from: string, to: string): number {
    return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
  }

  private inDays(day: string): string {
    const days = this.gap(this.today, day);
    return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `${this.dayLabel(day)} · in ${days} days`;
  }

  private async loadToday(person: Person): Promise<void> {
    this.todayCell = null;
    if (person.dateOfExit && person.dateOfExit < this.today) return;
    try {
      const data = await this.api.get<{ people: Array<{ code: string; status: string; label: string }> }>('/v1/attendance/day?day=' + this.today);
      const row = data.people.find((item) => item.code === person.code);
      if (!row) return;
      const icons: Record<string, string> = { present: 'bi-clock-history', leave: 'bi-airplane', onduty: 'bi-briefcase', missed: 'bi-exclamation-triangle', pending: 'bi-hourglass', holiday: 'bi-sun', weekoff: 'bi-cup-hot', absent: 'bi-x-circle' };
      const label = row.label === 'In' ? 'Checked in' : row.label || 'Not checked in yet';
      this.todayCell = { label, icon: icons[row.status] || 'bi-fingerprint', live: row.status === 'present' && row.label === 'In' };
    } catch {
      this.todayCell = null;
    }
  }

  get tabs(): Array<{ id: string; label: string; icon: string }> {
    const list = [{ id: 'overview', label: 'Overview', icon: 'bi bi-grid-1x2' }];
    if (this.privateView) list.push({ id: 'personal', label: 'Personal', icon: 'bi bi-person-heart' });
    list.push({ id: 'access', label: 'Access', icon: 'bi bi-shield-check' });
    if (this.tasks.length || (this.canEdit && this.person?.status === 'onboarding')) list.push({ id: 'onboarding', label: 'Onboarding', icon: 'bi bi-list-check' });
    if (this.canEdit) list.push({ id: 'edit', label: 'Edit details', icon: 'bi bi-pencil-square' });
    return list;
  }

  get initials(): string {
    const name = this.person?.name || '';
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
  }

  get currentAddress(): string {
    const person = this.person;
    if (!person) return '';
    const tail = [person.city, person.state].filter(Boolean).join(', ') + (person.pincode ? ' ' + person.pincode : '');
    return [person.address, tail.trim()].filter(Boolean).join(', ');
  }

  async pickPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.person) return;
    this.photoBusy = true;
    this.error = '';
    try {
      const saved = await this.api.post<{ photo: string }>('/v1/people/' + this.person.id + '/photo', { data: await squarePhoto(file) });
      this.person = { ...this.person, photo: saved.photo };
      this.ok = 'Photo updated.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not upload that photo.';
    } finally {
      this.photoBusy = false;
    }
  }

  get doneCount(): number {
    return this.tasks.filter((task) => task.done).length;
  }

  tone(status: string): string {
    if (status === 'active') return 'is-ok';
    if (status === 'onboarding') return 'is-info';
    return '';
  }

  roleName(id: string): string {
    const named = this.org?.roles?.find((item) => item.id === id)?.name;
    if (named) return named;
    return id ? id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ') : 'Employee';
  }

  async ngOnInit(): Promise<void> {
    this.canEdit = !!this.store.me?.access?.includes('people.edit');
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.creating = id === 'new';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    this.dateOfJoining = today;
    if (this.canEdit) {
      this.org = await this.api.get<Org>('/v1/org');
      try {
        const desk = await this.api.get<{ vendors: Array<{ id: string; name: string; suppliesUs: boolean; weSupply: boolean }> }>('/v1/vendors');
        this.suppliers = desk.vendors.filter((item) => item.suppliesUs);
        this.clients = desk.vendors.filter((item) => item.weSupply);
      } catch {
        this.suppliers = [];
        this.clients = [];
      }
      const listed = await this.api.get<{ people: Person[] }>('/v1/people');
      this.managers = listed.people.filter((item) => item.id !== id).map((item) => ({ id: item.id, name: item.name }));
      if (this.creating && this.org) {
        const city = (this.store.me?.company.city || '').toLowerCase();
        const match = this.org.locations.find((item) => item.city.toLowerCase() === city) || (this.org.locations.length === 1 ? this.org.locations[0] : undefined);
        if (match) this.locationId = match.id;
        const application = this.route.snapshot.queryParamMap.get('application');
        if (application) await this.prefill(application);
      }
    }
    let current = id;
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const next = params.get('id') || '';
      if (next === current || next === 'new') return;
      current = next;
      this.tab = 'overview';
      this.error = '';
      this.ok = '';
      void this.fill(next).then(() => this.loadTasks(next));
    });
    if (!this.creating) {
      await this.fill(id);
      await this.loadTasks(id);
      if (this.route.snapshot.queryParamMap.get('tab') === 'edit') {
        if (this.canEdit) this.tab = 'edit';
        else if (this.mine) await this.router.navigate(['/profile'], { queryParams: { tab: 'details' } });
      }
    }
  }

  /** Uppercases the IFSC and suggests the bank from its first four letters, never over a name typed by hand. */
  onIfsc(value: string): void {
    const previous = bankFromIfsc(this.ifsc);
    this.ifsc = cleanIfsc(value);
    const bank = bankFromIfsc(this.ifsc);
    if (bank && (!this.bankName.trim() || this.bankName === previous)) this.bankName = bank;
  }

  private async prefill(application: string): Promise<void> {
    try {
      const found = await this.api.get<{
        existing: { id: string; code: string } | null;
        firstName: string; lastName: string; email: string; phone: string; city: string;
        designationId: string; departmentId: string; locationId: string; workerType: string; title: string;
        dateOfBirth?: string; gender?: string; maritalStatus?: string; nationality?: string; address?: string;
        state?: string; pincode?: string; expectedCtc?: string;
      }>('/v1/hiring/applications/' + encodeURIComponent(application) + '/prefill');
      if (found.existing) {
        this.error = 'This applicant already has a record, ' + found.existing.code + '. Open it from People instead of adding them again.';
        return;
      }
      this.firstName = found.firstName;
      this.lastName = found.lastName;
      this.email = found.email;
      this.phone = found.phone;
      this.workerType = found.workerType || this.workerType;
      if (found.designationId) this.designationId = found.designationId;
      if (found.departmentId) this.departmentId = found.departmentId;
      if (found.locationId) this.locationId = found.locationId;
      if (found.dateOfBirth) this.dateOfBirth = found.dateOfBirth;
      if (found.gender) this.gender = found.gender;
      if (found.maritalStatus) this.maritalStatus = found.maritalStatus;
      if (found.nationality) this.nationality = found.nationality;
      if (found.address) this.address = found.address;
      if (found.city) this.extra['city'] = found.city;
      if (found.state) this.extra['state'] = found.state;
      if (found.pincode) this.extra['pincode'] = found.pincode;
      this.prefilled = 'Filled from the application for ' + (found.title || 'the opening') + '. Check the joining date, manager and pay details, then save.'
        + (found.expectedCtc ? ' They asked for ' + found.expectedCtc + ' (not saved).' : '');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The application could not be read.';
    }
  }

  private draft(): Draft {
    if (!this.canEdit) {
      return {
        phone: this.phone, maritalStatus: this.maritalStatus, nationality: this.nationality, bloodGroup: this.bloodGroup,
        emergencyName: this.emergencyName, emergencyPhone: this.emergencyPhone, address: this.address,
      };
    }
    return {
      firstName: this.firstName, lastName: this.lastName, email: this.email, phone: this.phone,
      workerType: this.workerType, status: this.status, departmentId: this.departmentId, designationId: this.designationId,
      levelId: this.levelId, teamId: this.teamId, agencyId: this.agencyId, clientId: this.clientId,
      locationId: this.locationId, managerId: this.managerId, dateOfJoining: this.dateOfJoining, dateOfExit: this.dateOfExit,
      confirmedOn: this.confirmedOn, probationEndsOn: this.probationEndsOn, gender: this.gender, dateOfBirth: this.dateOfBirth, maritalStatus: this.maritalStatus,
      nationality: this.nationality, bloodGroup: this.bloodGroup, emergencyName: this.emergencyName,
      emergencyPhone: this.emergencyPhone, address: this.address, costCentre: this.costCentre, pan: this.pan,
      bankName: this.bankName, bankAccount: this.bankAccount, ifsc: this.ifsc, signIn: this.signIn, role: this.role,
      password: this.password, ...this.extra,
    };
  }

  private shown(key: string, value: string | boolean | undefined): string {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (!value) return '—';
    const pools: Record<string, Array<{ id: string; name: string }> | undefined> = {
      departmentId: this.org?.departments, designationId: this.org?.designations, levelId: this.org?.levels,
      teamId: this.org?.teams, locationId: this.org?.locations, managerId: this.managers,
      agencyId: this.suppliers, clientId: this.clients, role: this.org?.roles,
    };
    const pool = pools[key];
    if (pool) return pool.find((item) => item.id === value)?.name || value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return this.dayLabel(value);
    return value;
  }

  submit(): void {
    this.error = '';
    this.ok = '';
    if (this.creating) {
      void this.save();
      return;
    }
    const next = this.draft();
    const changes: Change[] = [];
    for (const key of Object.keys(next)) {
      const before = this.baseline[key] ?? '';
      const after = next[key];
      if (key === 'password' ? !after : before === after) continue;
      changes.push({
        key,
        label: LABELS[key] || key,
        before: SECRET.has(key) ? (before ? 'Saved' : '—') : this.shown(key, before),
        after: SECRET.has(key) ? 'Updated, hidden' : this.shown(key, after),
      });
    }
    if (!changes.length) {
      this.ok = 'Nothing has changed.';
      return;
    }
    this.review = changes;
  }

  async approve(): Promise<void> {
    await this.save();
    if (!this.error) this.review = null;
  }

  discard(): void {
    this.review = null;
    if (this.person) this.apply(this.person);
    this.ok = 'Changes discarded.';
  }

  async save(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    const body = this.draft();
    try {
      if (this.creating) {
        await this.api.post<Person>('/v1/people', body);
        await this.router.navigateByUrl('/people');
        return;
      }
      const id = this.route.snapshot.paramMap.get('id') || '';
      this.person = await this.api.patch<Person>('/v1/people/' + id, body);
      this.apply(this.person);
      this.ok = 'Saved.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save.';
    } finally {
      this.busy = false;
    }
  }

  get mine(): boolean {
    return !!this.person && this.person.id === this.store.me?.employeeId;
  }

  get privateView(): boolean {
    return this.canEdit || this.mine;
  }

  dayLabel(day: string): string {
    if (!day) return 'Not added';
    const when = new Date(day + 'T12:00:00+05:30');
    if (Number.isNaN(when.getTime())) return day;
    return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(when);
  }

  private async loadTasks(id: string): Promise<void> {
    try {
      const data = await this.api.get<{ items: Array<{ id: string; title: string; done: boolean }> }>('/v1/onboarding/' + id);
      this.tasks = data.items;
    } catch {
      this.tasks = [];
    }
  }

  async toggleTask(task: { id: string; done: boolean }, done: boolean): Promise<void> {
    try {
      const saved = await this.api.post<{ id: string; title: string; done: boolean }>('/v1/onboarding/tasks/' + task.id, { done });
      this.tasks = this.tasks.map((item) => item.id === saved.id ? saved : item);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not update that task.';
    }
  }

  async addTask(): Promise<void> {
    if (!this.person) return;
    this.error = '';
    try {
      await this.api.post('/v1/onboarding/' + this.person.id, { title: this.taskTitle });
      this.taskTitle = '';
      await this.loadTasks(this.person.id);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not add that task.';
    }
  }

  private async fill(id: string): Promise<void> {
    try {
      this.person = await this.api.get<Person>('/v1/people/' + id);
      this.apply(this.person);
      void this.loadToday(this.person);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not open this person.';
    }
  }

  private apply(person: Person): void {
    this.firstName = person.firstName;
    this.lastName = person.lastName;
    this.email = person.email;
    this.phone = person.phone;
    this.workerType = person.workerType;
    this.status = person.status;
    this.departmentId = person.department?.id || '';
    this.designationId = person.designation?.id || '';
    this.levelId = person.level?.id || '';
    this.teamId = person.team?.id || '';
    this.agencyId = person.agency?.id || '';
    this.clientId = person.client?.id || '';
    this.locationId = person.location?.id || '';
    this.managerId = person.manager?.id || '';
    this.dateOfJoining = person.dateOfJoining;
    this.dateOfExit = person.dateOfExit;
    this.confirmedOn = person.confirmedOn;
    this.probationEndsOn = person.probationEndsOn || '';
    this.gender = person.gender;
    this.dateOfBirth = person.dateOfBirth;
    this.maritalStatus = person.maritalStatus;
    this.nationality = person.nationality;
    this.bloodGroup = person.bloodGroup;
    this.emergencyName = person.emergencyName;
    this.emergencyPhone = person.emergencyPhone;
    this.address = person.address;
    this.costCentre = person.costCentre;
    this.pan = person.pan;
    this.bankName = person.bankName;
    this.bankAccount = person.bankAccount;
    this.ifsc = person.ifsc;
    this.signIn = !!person.signIn?.active;
    this.role = person.signIn?.role || 'employee';
    this.password = '';
    const source = person as unknown as Record<string, unknown>;
    this.extra = Object.fromEntries(EXTRA.map((key) => [key, String(source[key] ?? '')]));
    this.baseline = this.draft();
  }
}
