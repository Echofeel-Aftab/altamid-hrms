import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Person } from '../core/models';
import { AttendanceSettings, OfficePoint, SettingsView, WEEKDAYS } from '../core/settings';

const COUNTRIES = ('AE AF AL AM AO AR AT AU AZ BA BD BE BG BH BN BO BR BT BW BY CA CH CL CM CN CO CR CY CZ DE DK DZ EC EE EG ES ET FI FJ FR GB GE GH GR GT HK HR HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KR KW KZ LA LB LK LT LU LV MA MD MM MN MO MT MU MV MX MY MZ NA NG NL NO NP NZ OM PA PE PG PH PK PL PT PY QA RO RS RU RW SA SC SE SG SI SK SN TH TJ TN TR TT TW TZ UA UG US UY UZ VE VN YE ZA ZM ZW').split(' ');

interface OfficeDraft extends OfficePoint { latText: string; lngText: string; busy: boolean; note: string; ok: boolean }

@Component({
  selector: 'app-settings-attendance',
  imports: [FormsModule, RouterLink],
  template: `
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    <div class="att-stack">
      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-geo-alt"></i></span>
          <div>
            <h2>Where people can check in</h2>
            <p>The server checks the location on every check-in. Check-out is always allowed and records where it happened.</p>
          </div>
        </header>
        <div class="settings-card-body">
          <div class="scope-grid" role="radiogroup" aria-label="Check-in area">
            @for (item of scopes; track item.id) {
              <button type="button" role="radio" class="scope-tile" [class.is-active]="form.scope === item.id" [attr.aria-checked]="form.scope === item.id" (click)="form.scope = item.id">
                <span class="scope-ico"><i [class]="item.icon"></i></span>
                <strong>{{ item.label }}</strong>
                <small>{{ item.hint }}</small>
                <i class="bi bi-check-circle-fill scope-tick" aria-hidden="true"></i>
              </button>
            }
          </div>

          @if (form.scope === 'country') {
            <div class="scope-panel">
              <label for="att-country">Country</label>
              <select id="att-country" name="country" [(ngModel)]="form.country">
                @for (code of countries; track code) { <option [value]="code">{{ countryName(code) }}</option> }
              </select>
              <p class="field-hint">The phone or browser shares its position, and the server looks up the country with OpenStreetMap. If the lookup is down, check-in waits and asks the person to try again.</p>
            </div>
          }

          @if (form.scope === 'offices') {
            <div class="scope-panel">
              <label class="check">
                <input type="checkbox" name="ownOffice" [(ngModel)]="form.ownOffice">
                <span><strong>Only at each person's own office</strong><small>Off lets anyone check in at any office below</small></span>
              </label>
              @if (!offices.length) {
                <p class="banner">No office locations exist yet. <a routerLink="/organisation">Add them in Organisation</a>, then set a check-in point here.</p>
              }
              <div class="office-list">
                @for (office of offices; track office.id) {
                  <article class="office-row">
                    <div class="office-head">
                      <span class="bento-ico" [class.is-ok]="office.lat !== null"><i class="bi bi-building"></i></span>
                      <div>
                        <strong>{{ office.name }}</strong>
                        <small>{{ where(office) }} · {{ office.people }} {{ office.people === 1 ? 'person' : 'people' }}</small>
                      </div>
                      <span class="chip" [class.is-ok]="office.lat !== null" [class.is-warn]="office.lat === null">{{ office.lat !== null ? 'Point set' : 'Not set' }}</span>
                    </div>
                    <div class="office-fields">
                      <div><label [for]="'lat-' + office.id">Latitude</label><input [id]="'lat-' + office.id" [name]="'lat-' + office.id" inputmode="decimal" [(ngModel)]="office.latText" placeholder="12.971599"></div>
                      <div><label [for]="'lng-' + office.id">Longitude</label><input [id]="'lng-' + office.id" [name]="'lng-' + office.id" inputmode="decimal" [(ngModel)]="office.lngText" placeholder="77.594566"></div>
                      <div><label [for]="'rad-' + office.id">Radius (metres)</label><input [id]="'rad-' + office.id" [name]="'rad-' + office.id" type="number" min="50" max="5000" step="10" [(ngModel)]="office.radius"></div>
                    </div>
                    <div class="actions">
                      <button type="button" class="btn btn-ghost btn-sm" [disabled]="office.busy" (click)="here(office)"><i class="bi bi-crosshair"></i> Use my current location</button>
                      @if (office.latText && office.lngText) {
                        <a class="btn btn-ghost btn-sm" [href]="mapLink(office)" target="_blank" rel="noopener"><i class="bi bi-map"></i> Check on map</a>
                      }
                      <button type="button" class="btn btn-primary btn-sm" [disabled]="office.busy" (click)="savePoint(office)"><i class="bi bi-check2"></i> Save point</button>
                      @if (office.lat !== null) {
                        <button type="button" class="btn btn-ghost btn-sm btn-danger" [disabled]="office.busy" (click)="clearPoint(office)">Remove point</button>
                      }
                    </div>
                    @if (office.note) { <p [class]="office.ok ? 'form-ok' : 'form-error'">{{ office.note }}</p> }
                  </article>
                }
              </div>
              <p class="field-hint">Stand inside the office and press “Use my current location”, or paste the coordinates from Google Maps (right-click the building). 150–300 m suits most offices; a large campus may need more.</p>
            </div>
          }

          <div class="form-cols att-extra">
            <label class="check">
              <input type="checkbox" name="geo" [(ngModel)]="form.geo">
              <span><strong>Record location on every check-in</strong><small>Also when anyone may check in from anywhere. The place shows in Who is in.</small></span>
            </label>
            <div>
              <label for="att-free">Can check in from anywhere</label>
              <div class="free-picker">
                @for (id of form.anywhere; track id) {
                  <span class="chip is-info">{{ personName(id) }} <button type="button" class="chip-x" [attr.aria-label]="'Remove ' + personName(id)" (click)="dropFree(id)"><i class="bi bi-x"></i></button></span>
                }
                <select id="att-free" name="free" [ngModel]="''" (ngModelChange)="addFree($event)">
                  <option value="">Add a person — field sales, drivers…</option>
                  @for (person of freeChoices; track person.id) { <option [value]="person.id">{{ person.name }} · {{ person.code }}</option> }
                </select>
              </div>
            </div>
          </div>

          @if (confirming) {
            <section class="approval-card" role="alertdialog" aria-labelledby="att-confirm">
              <div class="approval-head">
                <span class="approval-ico"><i class="bi bi-geo-alt"></i></span>
                <div>
                  <h2 id="att-confirm">Change where people can check in?</h2>
                  <p>From the next check-in, {{ ruleLine }}. People outside it see a clear message and cannot check in until they are inside it.</p>
                </div>
                <span class="chip is-warn">Needs approval</span>
              </div>
              <div class="actions">
                <button type="button" class="btn btn-primary" [disabled]="busy" (click)="save()"><i class="bi bi-check2"></i> {{ busy ? 'Saving…' : 'Approve and save' }}</button>
                <button type="button" class="btn btn-ghost" (click)="confirming = false">Keep editing</button>
              </div>
            </section>
          }
          <div class="settings-savebar">
            <span>{{ ruleLine.charAt(0).toUpperCase() + ruleLine.slice(1) }}.</span>
            <button class="btn btn-gold" type="button" [disabled]="busy" (click)="submit()"><i class="bi bi-check2"></i> Save check-in rules</button>
          </div>
        </div>
      </section>

      <form class="settings-card" (ngSubmit)="submit()">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-clock"></i></span>
          <div>
            <h2>Shift and capture</h2>
            <p>The working day, late grace, and how people record time</p>
          </div>
        </header>
        <div class="settings-card-body">
          <div class="settings-toggle-row">
            <label class="check"><input type="checkbox" name="web" [(ngModel)]="form.web"> Web and phone check-in</label>
            <label class="check"><input type="checkbox" name="biometric" [(ngModel)]="form.biometric"> Biometric readers</label>
            <label class="check"><input type="checkbox" name="selfie" [(ngModel)]="form.selfie"> Selfie with check-in</label>
          </div>
          <p class="muted">Selfie capture is kept as a choice for when it is switched on. It is not collected yet.</p>
          <div class="field-grid">
            <div><label for="shift-start">Shift start</label><input id="shift-start" name="shiftStart" type="time" [(ngModel)]="form.shiftStart"></div>
            <div><label for="shift-end">Shift end</label><input id="shift-end" name="shiftEnd" type="time" [(ngModel)]="form.shiftEnd"></div>
            <div><label for="grace">Late after (grace minutes)</label><input id="grace" name="graceMinutes" type="number" min="0" [(ngModel)]="form.graceMinutes"></div>
            <div><label for="ot">Overtime after minutes</label><input id="ot" name="otAfterMinutes" type="number" min="0" [(ngModel)]="form.otAfterMinutes"></div>
          </div>
          <h3 class="settings-subhead">Weekly off</h3>
          <div class="settings-toggle-row">
            @for (day of days; track day.value) {
              <label class="check">
                <input type="checkbox" [name]="'off-' + day.value" [checked]="form.weekOff.includes(day.value)" (change)="toggle(day.value)">
                {{ day.label }}
              </label>
            }
          </div>
          <div class="settings-savebar">
            <span>Times use Asia/Kolkata, the same clock as check-in. Saves shift, capture and weekly off together with the check-in rules above.</span>
            <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> Save attendance</button>
          </div>
        </div>
      </form>
    </div>
  `,
})
export class SettingsAttendanceComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly days = WEEKDAYS;
  readonly countries = COUNTRIES;
  readonly scopes: Array<{ id: AttendanceSettings['scope']; icon: string; label: string; hint: string }> = [
    { id: 'anywhere', icon: 'bi bi-globe2', label: 'Anywhere in the world', hint: 'No location limit' },
    { id: 'country', icon: 'bi bi-flag', label: 'Within one country', hint: 'Blocks check-in from abroad' },
    { id: 'offices', icon: 'bi bi-building-check', label: 'At office locations', hint: 'Within a radius of the office' },
  ];
  form: AttendanceSettings = {
    web: true, geo: false, selfie: false, biometric: false,
    shiftStart: '09:30', shiftEnd: '18:30', graceMinutes: 10, weekOff: [0], otAfterMinutes: 30,
    scope: 'anywhere', country: 'IN', ownOffice: false, anywhere: [],
  };
  saved = { scope: 'anywhere', country: 'IN', ownOffice: false };
  offices: OfficeDraft[] = [];
  people: Person[] = [];
  confirming = false;
  error = '';
  ok = '';
  busy = false;
  private names = new Intl.DisplayNames(['en'], { type: 'region' });

  get freeChoices(): Person[] {
    return this.people.filter((person) => !this.form.anywhere.includes(person.id));
  }

  get ruleLine(): string {
    if (this.form.scope === 'country') return 'check-in works only within ' + this.countryName(this.form.country);
    if (this.form.scope === 'offices') {
      const set = this.offices.filter((row) => row.lat !== null).length;
      return `check-in works only at ${this.form.ownOffice ? "each person's own office" : 'an office'} (${set} of ${this.offices.length} points set)`;
    }
    return 'check-in works from anywhere';
  }

  async ngOnInit(): Promise<void> {
    try {
      const [view, people] = await Promise.all([
        this.api.get<SettingsView>('/v1/settings'),
        this.api.get<{ people: Person[] }>('/v1/people').catch(() => ({ people: [] as Person[] })),
      ]);
      this.apply(view);
      this.people = people.people.filter((person) => person.status !== 'exited');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load attendance settings.';
    }
  }

  countryName(code: string): string {
    return this.names.of(code) || code;
  }

  personName(id: string): string {
    return this.people.find((person) => person.id === id)?.name || 'Former person';
  }

  addFree(id: string): void {
    if (id && !this.form.anywhere.includes(id)) this.form.anywhere = [...this.form.anywhere, id];
  }

  dropFree(id: string): void {
    this.form.anywhere = this.form.anywhere.filter((item) => item !== id);
  }

  toggle(day: number): void {
    this.form.weekOff = this.form.weekOff.includes(day)
      ? this.form.weekOff.filter((item) => item !== day)
      : [...this.form.weekOff, day].sort();
  }

  where(office: OfficeDraft): string {
    return [office.city, office.state].filter(Boolean).join(', ') || 'No city';
  }

  mapLink(office: OfficeDraft): string {
    const lat = Number(office.latText);
    const lng = Number(office.lngText);
    return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`;
  }

  here(office: OfficeDraft): void {
    office.note = '';
    if (!('geolocation' in navigator)) {
      office.ok = false;
      office.note = 'This browser cannot share location. Paste the coordinates instead.';
      return;
    }
    office.busy = true;
    navigator.geolocation.getCurrentPosition(
      (spot) => {
        office.latText = spot.coords.latitude.toFixed(6);
        office.lngText = spot.coords.longitude.toFixed(6);
        office.busy = false;
        office.ok = true;
        office.note = `Found you to within about ${Math.round(spot.coords.accuracy)} m. Check the map, then save the point.`;
      },
      () => {
        office.busy = false;
        office.ok = false;
        office.note = 'Location was blocked or not found. Allow location in the browser, or paste the coordinates.';
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async savePoint(office: OfficeDraft): Promise<void> {
    await this.point(office, { section: 'geofence', id: office.id, lat: Number(office.latText), lng: Number(office.lngText), radius: Number(office.radius) }, 'Check-in point saved.');
  }

  async clearPoint(office: OfficeDraft): Promise<void> {
    await this.point(office, { section: 'geofence', id: office.id, clear: true }, 'Check-in point removed.');
  }

  submit(): void {
    const changed = this.form.scope !== this.saved.scope
      || (this.form.scope === 'country' && this.form.country !== this.saved.country)
      || (this.form.scope === 'offices' && this.form.ownOffice !== this.saved.ownOffice);
    if (changed && this.form.scope !== 'anywhere') {
      this.confirming = true;
      return;
    }
    void this.save();
  }

  async save(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', {
        section: 'attendance',
        ...this.form,
        graceMinutes: Number(this.form.graceMinutes),
        otAfterMinutes: Number(this.form.otAfterMinutes),
      });
      this.apply(view);
      this.confirming = false;
      this.ok = 'Attendance setup saved.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save.';
    } finally {
      this.busy = false;
    }
  }

  private async point(office: OfficeDraft, body: Record<string, unknown>, message: string): Promise<void> {
    office.busy = true;
    office.note = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', body);
      const fresh = view.offices.find((row) => row.id === office.id);
      if (fresh) Object.assign(office, this.draft(fresh));
      office.ok = true;
      office.note = message;
    } catch (error) {
      office.ok = false;
      office.note = error instanceof Error ? error.message : 'Could not save that point.';
    } finally {
      office.busy = false;
    }
  }

  private apply(view: SettingsView): void {
    const attendance = view.attendance;
    this.form = { ...attendance, weekOff: [...attendance.weekOff], anywhere: [...(attendance.anywhere || [])] };
    this.saved = { scope: attendance.scope, country: attendance.country, ownOffice: attendance.ownOffice };
    this.offices = (view.offices || []).map((row) => this.draft(row));
  }

  private draft(row: OfficePoint): OfficeDraft {
    return { ...row, latText: row.lat === null ? '' : String(row.lat), lngText: row.lng === null ? '' : String(row.lng), busy: false, note: '', ok: false };
  }
}
