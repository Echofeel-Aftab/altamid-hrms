import { Component, EventEmitter, inject, Input, OnInit, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Person } from '../core/models';
import { squarePhoto } from '../core/photo';
import { PhotoComponent } from '../shared/photo.component';

interface ChangeView {
  id: string;
  status: string;
  note: string;
  sentAt: string;
  decidedAt: string;
  fields: Array<{ key: string; label: string; value: string }>;
}
interface Diff { key: string; label: string; before: string; after: string; review: boolean }

const SELF: Record<string, string> = {
  phone: 'Phone', personalEmail: 'Personal email', maritalStatus: 'Marital status', bloodGroup: 'Blood group',
  nationality: 'Nationality', fatherName: "Father's name", spouseName: "Spouse's name", address: 'Current address',
  city: 'City', state: 'State', pincode: 'PIN code', permanentAddress: 'Permanent address',
  emergencyName: 'Emergency contact', emergencyRelation: 'Relation', emergencyPhone: 'Emergency phone',
  nomineeName: 'Nominee', nomineeRelation: 'Nominee relation',
};
const REVIEW: Record<string, string> = {
  pan: 'PAN', aadhaar: 'Aadhaar', uan: 'UAN', esicNo: 'ESIC number', bankName: 'Bank', bankAccount: 'Account number',
  ifsc: 'IFSC', taxRegime: 'Tax regime',
};
const CHECKLIST: Array<{ key: string; label: string }> = [
  { key: 'photo', label: 'Photo' }, { key: 'phone', label: 'Phone' }, { key: 'personalEmail', label: 'Personal email' },
  { key: 'bloodGroup', label: 'Blood group' }, { key: 'fatherName', label: "Father's name" },
  { key: 'address', label: 'Current address' }, { key: 'pincode', label: 'PIN code' }, { key: 'permanentAddress', label: 'Permanent address' },
  { key: 'emergencyName', label: 'Emergency contact' }, { key: 'emergencyPhone', label: 'Emergency phone' },
  { key: 'nomineeName', label: 'Nominee' }, { key: 'pan', label: 'PAN' }, { key: 'bankAccount', label: 'Bank account' }, { key: 'ifsc', label: 'IFSC' },
];
const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh',
  'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir',
  'Ladakh', 'Lakshadweep', 'Puducherry',
];

@Component({
  selector: 'app-my-details',
  imports: [FormsModule, PhotoComponent],
  template: `
    @if (error) { <p class="form-error"><i class="bi bi-exclamation-octagon"></i> {{ error }}</p> }
    @if (ok) { <p class="form-ok"><i class="bi bi-check-circle"></i> {{ ok }}</p> }
    @if (person) {
      <section class="card md-meter">
        <div class="md-meter-head">
          <span class="bento-ico is-gold"><i class="bi bi-person-check"></i></span>
          <div>
            <h2>Your profile is {{ percent }}% complete</h2>
            <p class="muted">HR and payroll use these details for letters, PF and ESI forms, and salary credit.</p>
          </div>
          <strong class="md-meter-num">{{ percent }}%</strong>
        </div>
        <div class="progress"><span [style.width.%]="percent"></span></div>
        @if (missing.length) {
          <div class="chip-row">
            <small class="muted">Still to add:</small>
            @for (item of missing; track item) { <span class="chip"><i class="bi bi-plus-circle"></i>{{ item }}</span> }
          </div>
        }
      </section>

      @if (change?.status === 'pending') {
        <section class="md-note is-wait">
          <i class="bi bi-hourglass-split"></i>
          <div>
            <strong>Waiting for HR</strong>
            <p>{{ changeList }}. These stay as they were until HR or payroll checks and approves them.</p>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" (click)="cancelChange()"><i class="bi bi-x-lg"></i> Withdraw</button>
        </section>
      } @else if (change?.status === 'rejected') {
        <section class="md-note is-bad">
          <i class="bi bi-x-octagon"></i>
          <div><strong>HR did not accept your last change</strong><p>{{ change?.note }}</p></div>
        </section>
      } @else if (change?.status === 'approved') {
        <section class="md-note is-good">
          <i class="bi bi-patch-check"></i>
          <div><strong>HR approved your pay details</strong><p>{{ changeList }}.</p></div>
        </section>
      }

      @if (review) {
        <section class="approval-card" role="alertdialog" aria-label="Review changes">
          <div class="approval-head">
            <span class="approval-ico"><i class="bi bi-shield-exclamation"></i></span>
            <div>
              <h2>Review before saving</h2>
              <p>{{ review.length }} {{ review.length === 1 ? 'field changes' : 'fields change' }}.@if (reviewCount) { Fields marked "HR checks" go to HR first. }</p>
            </div>
            <span class="chip is-warn">Needs approval</span>
          </div>
          <ul class="diff-list">
            @for (row of review; track row.key) {
              <li>
                <span class="diff-key">{{ row.label }}@if (row.review) { <span class="chip is-info md-tag">HR checks</span> }</span>
                <span class="diff-old">{{ row.before }}</span>
                <i class="bi bi-arrow-right" aria-hidden="true"></i>
                <span class="diff-new">{{ row.after }}</span>
              </li>
            }
          </ul>
          <div class="actions">
            <button type="button" class="btn btn-primary" [disabled]="busy" (click)="save()"><i class="bi bi-check2"></i> {{ busy ? 'Saving…' : 'Approve and save' }}</button>
            <button type="button" class="btn btn-ghost" (click)="review = null"><i class="bi bi-pencil"></i> Keep editing</button>
            <button type="button" class="btn btn-ghost btn-danger" (click)="discard()"><i class="bi bi-x-lg"></i> Discard changes</button>
          </div>
        </section>
      }

      <form class="form-stack" (ngSubmit)="check()">
        <section class="form-section">
          <header><span class="bento-ico"><i class="bi bi-camera"></i></span><div><h2><i class="bi bi-image"></i> Photo</h2><p>Shown on your profile and dossier. A clear face photo helps colleagues and the ID card.</p></div></header>
          <div class="md-photo">
            <app-photo [personId]="person.id" [stamp]="person.photo || ''" [name]="person.name" />
            <div class="md-photo-actions">
              <label class="btn btn-secondary" [class.is-busy]="photoBusy">
                <i class="bi bi-upload"></i> {{ person.photo ? 'Change photo' : 'Add photo' }}
                <input type="file" accept="image/*" class="sr-only" (change)="pickPhoto($event)" [disabled]="photoBusy">
              </label>
              @if (person.photo) { <button type="button" class="btn btn-ghost btn-danger" [disabled]="photoBusy" (click)="removePhoto()"><i class="bi bi-trash"></i> Remove</button> }
              <small class="muted">JPG or PNG. It is cropped to a square and made small before upload.</small>
            </div>
          </div>
        </section>

        <section class="form-section">
          <header><span class="bento-ico"><i class="bi bi-person"></i></span><div><h2><i class="bi bi-person-vcard"></i> Personal</h2><p>Visible to HR and you only.</p></div></header>
          <div class="md-fixed">
            <span><small>Name</small><strong>{{ person.name }}</strong></span>
            <span><small>Date of birth</small><strong>{{ person.dateOfBirth || 'Not added' }}</strong></span>
            <span><small>Gender</small><strong>{{ person.gender || 'Not added' }}</strong></span>
            <span><small>Work email</small><strong>{{ person.email || 'Not added' }}</strong></span>
            <em class="muted"><i class="bi bi-lock"></i> HR keeps these. Ask HR if one is wrong.</em>
          </div>
          <div class="form-cols is-three">
            <div><label for="md-phone">Mobile</label><input id="md-phone" name="phone" inputmode="tel" [(ngModel)]="form['phone']" placeholder="+91 98765 43210"></div>
            <div><label for="md-pmail">Personal email</label><input id="md-pmail" name="personalEmail" type="email" [(ngModel)]="form['personalEmail']"></div>
            <div>
              <label for="md-blood">Blood group</label>
              <select id="md-blood" name="bloodGroup" [(ngModel)]="form['bloodGroup']">
                <option value="">Not added</option>
                @for (group of bloodGroups; track group) { <option [value]="group">{{ group }}</option> }
              </select>
            </div>
            <div>
              <label for="md-marital">Marital status</label>
              <select id="md-marital" name="maritalStatus" [(ngModel)]="form['maritalStatus']">
                <option value="">Not added</option><option>Single</option><option>Married</option><option>Other</option>
              </select>
            </div>
            <div><label for="md-nation">Nationality</label><input id="md-nation" name="nationality" [(ngModel)]="form['nationality']" placeholder="Indian"></div>
            <div><label for="md-father">Father's name</label><input id="md-father" name="fatherName" [(ngModel)]="form['fatherName']"></div>
            @if (form['maritalStatus'] === 'Married' || form['spouseName']) {
              <div><label for="md-spouse">Spouse's name</label><input id="md-spouse" name="spouseName" [(ngModel)]="form['spouseName']"></div>
            }
          </div>
        </section>

        <section class="form-section">
          <header><span class="bento-ico"><i class="bi bi-house"></i></span><div><h2><i class="bi bi-geo-alt"></i> Address</h2><p>Where you live now, and your permanent address for records.</p></div></header>
          <div class="form-cols is-three">
            <div class="span-3"><label for="md-address">Current address</label><textarea id="md-address" name="address" rows="2" [(ngModel)]="form['address']" placeholder="House, street, area"></textarea></div>
            <div><label for="md-city">City</label><input id="md-city" name="city" [(ngModel)]="form['city']"></div>
            <div>
              <label for="md-state">State</label>
              <input id="md-state" name="state" list="md-states" [(ngModel)]="form['state']">
              <datalist id="md-states">@for (item of states; track item) { <option [value]="item"></option> }</datalist>
            </div>
            <div><label for="md-pin">PIN code</label><input id="md-pin" name="pincode" inputmode="numeric" maxlength="6" [(ngModel)]="form['pincode']"></div>
          </div>
          <label class="switch-line md-same"><input class="switch" type="checkbox" name="same" [(ngModel)]="same" (ngModelChange)="copyAddress()"> Permanent address is the same</label>
          @if (!same) {
            <div><label for="md-perm">Permanent address</label><textarea id="md-perm" name="permanentAddress" rows="2" [(ngModel)]="form['permanentAddress']"></textarea></div>
          }
        </section>

        <section class="form-section">
          <header><span class="bento-ico is-gold"><i class="bi bi-telephone-plus"></i></span><div><h2><i class="bi bi-heart-pulse"></i> Emergency and nominee</h2><p>Who we call in an emergency, and who you nominate for PF and gratuity.</p></div></header>
          <div class="form-cols is-three">
            <div><label for="md-ename">Emergency contact</label><input id="md-ename" name="emergencyName" [(ngModel)]="form['emergencyName']"></div>
            <div><label for="md-erel">Relation</label><input id="md-erel" name="emergencyRelation" list="md-relations" [(ngModel)]="form['emergencyRelation']"></div>
            <div><label for="md-ephone">Emergency phone</label><input id="md-ephone" name="emergencyPhone" inputmode="tel" [(ngModel)]="form['emergencyPhone']"></div>
            <div><label for="md-nname">Nominee</label><input id="md-nname" name="nomineeName" [(ngModel)]="form['nomineeName']"></div>
            <div><label for="md-nrel">Nominee relation</label><input id="md-nrel" name="nomineeRelation" list="md-relations" [(ngModel)]="form['nomineeRelation']"></div>
          </div>
          <datalist id="md-relations">@for (item of relations; track item) { <option [value]="item"></option> }</datalist>
        </section>

        <section class="form-section">
          <header>
            <span class="bento-ico is-ok"><i class="bi bi-bank"></i></span>
            <div><h2><i class="bi bi-wallet2"></i> Statutory and bank</h2><p>Payroll pays salary and files PF, ESI, and TDS with these. A change goes to HR to check before it is used.</p></div>
            <span class="source-chip"><i class="bi bi-shield-lock"></i> Encrypted · HR checks</span>
          </header>
          <div class="form-cols is-three">
            <div><label for="md-pan">PAN</label><input id="md-pan" name="pan" autocomplete="off" maxlength="10" [(ngModel)]="form['pan']" placeholder="ABCDE1234F" (blur)="upper('pan')"></div>
            <div>
              <label for="md-aadhaar">Aadhaar</label>
              <input id="md-aadhaar" name="aadhaar" autocomplete="off" inputmode="numeric" maxlength="14" [(ngModel)]="form['aadhaar']" [placeholder]="aadhaarOnFile ? 'On file ' + aadhaarOnFile + ' · type to replace' : '12 digits'">
            </div>
            <div><label for="md-uan">UAN</label><input id="md-uan" name="uan" inputmode="numeric" maxlength="12" [(ngModel)]="form['uan']" placeholder="12 digits, if you have PF"></div>
            <div><label for="md-esic">ESIC number</label><input id="md-esic" name="esicNo" inputmode="numeric" maxlength="17" [(ngModel)]="form['esicNo']" placeholder="If you are covered"></div>
            <div><label for="md-bank">Bank</label><input id="md-bank" name="bankName" [(ngModel)]="form['bankName']"></div>
            <div><label for="md-account">Account number</label><input id="md-account" name="bankAccount" autocomplete="off" inputmode="numeric" [(ngModel)]="form['bankAccount']"></div>
            <div><label for="md-ifsc">IFSC</label><input id="md-ifsc" name="ifsc" autocomplete="off" maxlength="11" [(ngModel)]="form['ifsc']" placeholder="HDFC0001234" (blur)="upper('ifsc')"></div>
            <div class="span-2">
              <label for="md-regime">Income tax regime</label>
              <select id="md-regime" name="taxRegime" [(ngModel)]="form['taxRegime']">
                <option value="">Not chosen</option>
                <option value="new">New regime</option>
                <option value="old">Old regime</option>
              </select>
              <small class="muted md-hint">Tells payroll which regime you chose for TDS this year. Payroll does the calculation.</small>
            </div>
          </div>
        </section>

        <div class="form-bar">
          <span class="muted"><i class="bi bi-info-circle"></i> You will review the changes before anything is saved.</span>
          <button class="btn btn-primary" type="submit" [disabled]="busy || !!review"><i class="bi bi-eye"></i> Review changes</button>
        </div>
      </form>
    }
  `,
})
export class MyDetailsComponent implements OnInit {
  private readonly api = inject(ApiService);
  @Input() personId = '';
  @Output() photo = new EventEmitter<string>();
  readonly bloodGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
  readonly states = STATES;
  readonly relations = ['Father', 'Mother', 'Spouse', 'Son', 'Daughter', 'Brother', 'Sister', 'Friend'];
  person: Person | null = null;
  change: ChangeView | null = null;
  form: Record<string, string> = {};
  private baseline: Record<string, string> = {};
  review: Diff[] | null = null;
  same = false;
  aadhaarOnFile = '';
  error = '';
  ok = '';
  busy = false;
  photoBusy = false;

  get percent(): number {
    if (!this.person) return 0;
    const done = CHECKLIST.filter((item) => this.filled(item.key)).length;
    return Math.round((done / CHECKLIST.length) * 100);
  }

  get missing(): string[] {
    return CHECKLIST.filter((item) => !this.filled(item.key)).map((item) => item.label);
  }

  get changeList(): string {
    return (this.change?.fields || []).map((item) => item.label + ' ' + item.value).join(', ');
  }

  get reviewCount(): number {
    return (this.review || []).filter((row) => row.review).length;
  }

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  upper(key: string): void {
    this.form[key] = (this.form[key] || '').toUpperCase().trim();
  }

  copyAddress(): void {
    if (this.same) this.form['permanentAddress'] = this.composed();
  }

  check(): void {
    this.error = '';
    this.ok = '';
    if (this.same) this.form['permanentAddress'] = this.composed();
    const rows: Diff[] = [];
    for (const [key, label] of [...Object.entries(SELF), ...Object.entries(REVIEW)]) {
      const before = this.baseline[key] || '';
      const after = (this.form[key] || '').trim();
      if (before === after) continue;
      const review = key in REVIEW;
      const hidden = key === 'aadhaar' || key === 'bankAccount';
      rows.push({
        key,
        label,
        review,
        before: key === 'aadhaar' ? this.aadhaarOnFile || '—' : hidden && before ? '••••' + before.slice(-4) : this.shown(key, before),
        after: hidden && after ? '••••' + after.replace(/\s/g, '').slice(-4) : this.shown(key, after),
      });
    }
    if (!rows.length) {
      this.ok = 'Nothing has changed.';
      return;
    }
    this.review = rows;
  }

  discard(): void {
    this.review = null;
    if (this.person) this.apply(this.person);
    this.ok = 'Changes discarded.';
  }

  async save(): Promise<void> {
    if (!this.review) return;
    this.busy = true;
    this.error = '';
    const body: Record<string, string> = {};
    for (const row of this.review) body[row.key] = (this.form[row.key] || '').trim();
    try {
      const result = await this.api.patch<{ saved: string[]; sent: string[] }>('/v1/profile/details', body);
      const parts: string[] = [];
      if (result.saved.length) parts.push('Saved ' + result.saved.join(', ') + '.');
      if (result.sent.length) parts.push('Sent to HR to check: ' + result.sent.join(', ') + '.');
      this.review = null;
      await this.load();
      this.ok = parts.join(' ') || 'Nothing has changed.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save your details.';
    } finally {
      this.busy = false;
    }
  }

  async cancelChange(): Promise<void> {
    if (!this.change) return;
    this.error = '';
    try {
      await this.api.post('/v1/profile/change/' + this.change.id + '/cancel', {});
      this.change = null;
      this.ok = 'Request withdrawn. Your pay details stay as they were.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not withdraw that.';
    }
  }

  async pickPhoto(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !this.person) return;
    this.photoBusy = true;
    this.error = '';
    this.ok = '';
    try {
      const data = await squarePhoto(file);
      const saved = await this.api.post<{ photo: string }>('/v1/people/' + this.person.id + '/photo', { data });
      this.person = { ...this.person, photo: saved.photo };
      this.photo.emit(saved.photo);
      this.ok = 'Photo updated.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not upload that photo.';
    } finally {
      this.photoBusy = false;
    }
  }

  async removePhoto(): Promise<void> {
    if (!this.person) return;
    this.photoBusy = true;
    this.error = '';
    try {
      await this.api.post('/v1/people/' + this.person.id + '/photo/remove', {});
      this.person = { ...this.person, photo: '' };
      this.photo.emit('');
      this.ok = 'Photo removed.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not remove the photo.';
    } finally {
      this.photoBusy = false;
    }
  }

  private async load(): Promise<void> {
    try {
      const [person, change] = await Promise.all([
        this.api.get<Person>('/v1/people/' + this.personId),
        this.api.get<ChangeView | null>('/v1/profile/change').catch(() => null),
      ]);
      this.person = person;
      this.change = change;
      this.apply(person);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load your details.';
    }
  }

  private apply(person: Person): void {
    const source = person as unknown as Record<string, unknown>;
    const form: Record<string, string> = {};
    for (const key of [...Object.keys(SELF), ...Object.keys(REVIEW)]) form[key] = String(source[key] ?? '');
    this.aadhaarOnFile = form['aadhaar'];
    form['aadhaar'] = '';
    this.form = form;
    this.baseline = { ...form };
    this.same = !!form['permanentAddress'] && form['permanentAddress'] === this.composed();
  }

  private composed(): string {
    const tail = [this.form['city'], this.form['state']].filter(Boolean).join(', ');
    return [this.form['address'], tail + (this.form['pincode'] ? ' ' + this.form['pincode'] : '')].map((part) => (part || '').trim()).filter(Boolean).join(', ');
  }

  private filled(key: string): boolean {
    if (!this.person) return false;
    if (key === 'photo') return !!this.person.photo;
    return !!String((this.person as unknown as Record<string, unknown>)[key] ?? '').trim();
  }

  private shown(key: string, value: string): string {
    if (!value) return '—';
    if (key === 'taxRegime') return value === 'new' ? 'New regime' : value === 'old' ? 'Old regime' : value;
    return value;
  }
}
