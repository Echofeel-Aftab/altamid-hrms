import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { NAV_GROUPS } from '../core/nav';
import { SessionStore } from '../core/session.store';
import { DiagramComponent, label } from '../shared/diagram.component';

interface Field { name: string; type: string; key: string; sealed: boolean }
interface Entity { name: string; domain: string; records: number | null; fields: Field[] }
interface Relation { from: string; to: string; label: string; many: boolean; required: boolean }
interface Rung { key: string; name: string; rank: number; scope: string }
interface Feature { group: string; key: string; label: string; roles: string[] }
interface Headcount { name: string; people: number }
interface SystemMap {
  version: string;
  company: string;
  entities: Entity[];
  relations: Relation[];
  routes: { total: number; open: number; areas: { area: string; count: number; open: number }[] };
  ladder: Rung[];
  features: Feature[];
  org: { people: number; locations: Headcount[]; departments: (Headcount & { teams: Headcount[] })[]; looseTeams: Headcount[]; unplaced: number };
}

type Tab = 'overview' | 'org' | 'access' | 'data' | 'flows' | 'api';

interface Flow { key: string; title: string; hint: string; code: string }

const DOMAIN_ORDER = ['People', 'Organisation', 'Time', 'Pay', 'Hiring', 'Engagement', 'Company and setup', 'Access and audit', 'Other'];

const FLOWS: Flow[] = [
  {
    key: 'leave', title: 'Leave', hint: 'From the request to the calendar. Managers decide for their own reports; HR and the owner decide for everyone.',
    code: `flowchart LR
  a(["Employee applies<br/>type, dates, reason"]) --> p["Pending"]
  p --> n["Approver notified<br/>manager, HR, owner"]
  n --> d{"Decision"}
  d -->|"approve"| ap["Approved<br/>balance used, days marked"]
  d -->|"reject with a note"| rj["Rejected"]
  d -->|"cancel"| cn["Cancelled"]
  ap --> e(["Employee notified"])
  rj --> e
  ap --> cal["Attendance calendar<br/>shows the leave"]`,
  },
  {
    key: 'time', title: 'Attendance', hint: 'Punches come from the web check-in or a reader. Requests fix or explain a day.',
    code: `flowchart LR
  subgraph punch["Daily punch"]
    direction TB
    w["Web check-in<br/>inside the office radius when set"] --> P[("Punch")]
    r["Reader at the gate<br/>fingerprint, face, card"] --> P
  end
  P --> day["Day status<br/>present, late, missed, absent"]
  day --> ex["Exceptions<br/>late, absent, missed punches"]
  ex --> req["Employee request<br/>regularization, on duty,<br/>work from home, extra time"]
  req --> pend["Pending"] --> dec{"Approver decides"}
  dec -->|"approve regularization"| fix["Punches written<br/>source: regularization"]
  dec -->|"approve on duty or WFH"| mark["Day counted as worked"]
  dec -->|"reject or cancel"| keep["Day unchanged"]
  fix --> day
  mark --> day`,
  },
  {
    key: 'pay', title: 'Payroll', hint: 'Every amount is entered by a person. The system stores and shows it; it never calculates tax or net pay.',
    code: `flowchart LR
  ctc["CTC entered by hand<br/>pay structure"] --> slip["Monthly slip entered<br/>amounts typed by payroll"]
  lay["Slip layout<br/>which lines appear"] --> slip
  slip --> my(["My pay<br/>each person sees own slips"])
  f16["Form 16 PDF uploaded"] --> my
  lic{"Licence lease"} -.->|"restrict pauses new runs"| slip
  slip -.-> rule["No tax or net pay<br/>is calculated by the app"]`,
  },
  {
    key: 'hiring', title: 'Hiring', hint: 'One opening reaches every channel. Hired candidates are added to People by hand.',
    code: `flowchart LR
  o1["Opening: draft"] -->|"publish, description 20+ characters"| o2["Opening: open"]
  o2 --> c1["Company website feed"]
  o2 --> c2["Job portals XML feed"]
  o2 --> c3["Career page and job forms"]
  o2 --> c4["Internal jobs and referrals"]
  c1 & c2 & c3 & c4 --> app["Application: new"]
  app --> rv["Reviewing"] --> sl["Shortlisted"] --> iv["Interview"] --> hi["Hired"]
  rv & sl & iv --> rj["Rejected"]
  hi -.->|"HR adds the person"| ppl(["People"])
  o2 -->|"close"| o3["Opening: closed"]`,
  },
  {
    key: 'assets', title: 'Asset lifecycle', hint: 'Every move is written to the asset history. An asset that was ever issued cannot be removed, only retired.',
    code: `stateDiagram-v2
  state "In stock" as InStock
  state "Issued" as Issued
  state "In repair" as InRepair
  state "Retired" as Retired
  state "Lost" as Lost
  [*] --> InStock : added
  InStock --> Issued : issue to an employee
  Issued --> InStock : taken back
  Issued --> InRepair : returned damaged
  Issued --> Lost : marked lost
  InStock --> InRepair : send for repair
  InRepair --> InStock : back in stock
  InStock --> Retired : retire
  InRepair --> Retired : retire
  Retired --> [*]
  Lost --> [*]`,
  },
  {
    key: 'details', title: 'Employee detail changes', hint: 'Everyday details save at once. Pay and identity details wait for review and stay sealed.',
    code: `flowchart LR
  e["Employee edits My details"] --> split{"Which field?"}
  split -->|"photo, address, contacts,<br/>family, nominee"| save["Saved at once"]
  split -->|"PAN, Aadhaar, bank, IFSC,<br/>UAN, ESIC, tax regime"| seal["Sealed pending request"]
  seal --> nt["Owner, HR, payroll notified"]
  nt --> d{"Decision<br/>never by the requester"}
  d -->|"approve"| ap["Values applied<br/>employee notified"]
  d -->|"reject with a note"| rj["Rejected<br/>employee notified"]
  seal -->|"employee cancels"| cn["Cancelled"]`,
  },
  {
    key: 'exit', title: 'Resignation', hint: 'A person cannot decide their own resignation.',
    code: `flowchart LR
  s["Employee sends a resignation<br/>last day and reason"] --> p["Pending"]
  p -->|"employee cancels"| c["Cancelled"]
  p --> d{"Approver decides"}
  d -->|"accept"| a["Accepted<br/>exit date set to the last day"]
  d -->|"decline"| x["Declined"]`,
  },
  {
    key: 'signin', title: 'Sign-in and access', hint: 'Every request is checked on the server. The menu only hides what the server would refuse anyway.',
    code: `flowchart LR
  u["Email and password"] --> lim{"Too many tries?"}
  lim -->|"yes"| pause["Sign-in paused<br/>for a few minutes"]
  lim -->|"no"| chk{"Password matches<br/>and sign-in active?"}
  chk -->|"no"| miss["Refused<br/>failed count raised"]
  chk -->|"yes"| tok["Signed session token<br/>login written to audit"]
  tok --> req["Each API request"]
  req --> guard["Sign-in check"] --> keys["Access keys<br/>role defaults plus grants by<br/>role, department, level, person"]
  keys --> allow["Allowed"]
  keys --> deny["403 with the reason"]
  keys --> menu["Menu shows only<br/>what is allowed"]`,
  },
  {
    key: 'licence', title: 'Licence', hint: 'Only the server talks to Altamid Control. Existing records and published slips always stay readable.',
    code: `sequenceDiagram
  participant B as Browser
  participant A as HRMS API
  participant C as Altamid Control
  A->>C: Ask for a lease with the licence key
  C-->>A: Signed lease, allow or restrict
  A->>A: Store the lease and refresh when stale
  B->>A: Add a person or run payroll
  alt Lease allows, or no key added yet
    A-->>B: Saved
  else Lease restricts
    A-->>B: Paused, with the reason
  end
  Note over B,A: The browser never decides the licence`,
  },
];

@Component({
  selector: 'app-system',
  imports: [FormsModule, DiagramComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-bounding-box-circles"></i></span>
        <p class="eyebrow">Owner</p>
        <h1>System map</h1>
        <p class="muted">How {{ map?.company || 'this HRMS' }} is put together: modules, roles, data, and the way work moves. Drawn from the live system{{ map ? ', version ' + map.version : '' }}.</p>
      </div>
      <button type="button" class="btn btn-ghost" (click)="print()"><i class="bi bi-printer"></i> Print</button>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }

    @if (map) {
      <div class="sys-stats">
        @for (tile of tiles(); track tile.label) {
          <div class="card bento-stat"><span class="bento-ico" [class.is-gold]="tile.gold"><i class="bi" [class]="tile.icon"></i></span><span class="muted">{{ tile.label }}</span><strong>{{ tile.value }}</strong></div>
        }
      </div>

      <nav class="settings-tabs sys-tabs" aria-label="System map sections">
        @for (item of tabs; track item.key) {
          <button type="button" class="settings-tab" [class.is-active]="tab === item.key" (click)="tab = item.key"><i class="bi" [class]="item.icon"></i> {{ item.label }}</button>
        }
      </nav>

      @switch (tab) {
        @case ('overview') {
          <app-diagram title="System architecture" hint="Who uses the HRMS, what sits behind it, and what it talks to." file="hrms-architecture" [code]="architecture" />
          <app-diagram title="Module hierarchy" hint="Every page in the menu, grouped as people see it, with the access each one needs." file="hrms-modules" [code]="modules" />
        }
        @case ('org') {
          <app-diagram title="Organisation structure" hint="Company, locations, departments, and teams with today's headcount. Exited people are left out." file="hrms-organisation" [code]="organisation" />
        }
        @case ('access') {
          <app-diagram title="Role hierarchy" hint="Higher rank sees and decides more. Team roles stay on their own reports." file="hrms-roles" [code]="roles" />
          <section class="card">
            <div class="dt-title"><h2>Who can manage what</h2><p class="muted">Default access by role. On Settings, the owner can also grant any area to a role, department, level, or one person.</p></div>
            <div class="table-responsive">
              <table class="sys-matrix">
                <thead><tr><th>Area</th>@for (role of matrixRoles(); track role.key) { <th>{{ role.name }}</th> }</tr></thead>
                <tbody>
                  @for (item of map.features; track item.key) {
                    <tr>
                      <td><strong>{{ item.label }}</strong><small class="muted">{{ item.group }}</small></td>
                      @for (role of matrixRoles(); track role.key) {
                        <td>@if (item.roles.includes(role.key)) { <i class="bi bi-check-circle-fill sys-yes" aria-label="Yes"></i> } @else { <span class="sys-no" aria-label="No">·</span> }</td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
        @case ('data') {
          <section class="card sys-er-tools">
            <div class="sys-chips" role="group" aria-label="Data area">
              @for (item of domains(); track item.key) {
                <button type="button" class="sys-chip" [class.is-on]="domain === item.key" (click)="setDomain(item.key)">{{ item.key === 'all' ? 'Everything' : item.key }} <small>{{ item.count }}</small></button>
              }
            </div>
            <div class="sys-toggles">
              <label class="switch-line"><input type="checkbox" [(ngModel)]="keysOnly" (ngModelChange)="buildEr()"> Key fields only</label>
              <label class="switch-line"><input type="checkbox" [(ngModel)]="companyLinks" (ngModelChange)="buildEr()"> Show links to Company</label>
            </div>
          </section>
          <app-diagram title="Entity relationship diagram" [hint]="erHint" [file]="'hrms-er-' + domain" [code]="er" />
          <section class="card">
            <div class="dt-title"><h2>Tables</h2><p class="muted">Record counts are for this company only. Sealed fields are encrypted at rest and never shown here.</p></div>
            <div class="table-responsive">
              <table class="sys-matrix sys-tables">
                <thead><tr><th>Table</th><th>Area</th><th>Fields</th><th>Links</th><th>Records</th></tr></thead>
                <tbody>
                  @for (item of erTables(); track item.name) {
                    <tr>
                      <td><strong class="mono">{{ item.name }}</strong></td>
                      <td>{{ item.domain }}</td>
                      <td>{{ item.fields.length }}@if (sealedCount(item)) { <small class="muted"> · {{ sealedCount(item) }} sealed</small> }</td>
                      <td>{{ linkCount(item.name) }}</td>
                      <td>{{ item.records === null ? '—' : item.records.toLocaleString('en-IN') }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </section>
        }
        @case ('flows') {
          <div class="sys-chips sys-flow-chips" role="group" aria-label="Workflow">
            @for (item of flows; track item.key) {
              <button type="button" class="sys-chip" [class.is-on]="flow.key === item.key" (click)="flow = item">{{ item.title }}</button>
            }
          </div>
          <app-diagram [title]="flow.title" [hint]="flow.hint" [file]="'hrms-flow-' + flow.key" [code]="flow.code" />
        }
        @case ('api') {
          <app-diagram title="API areas" hint="Share of routes by area. Public routes serve career pages, job feeds, apply forms, punch readers, and sign-in." file="hrms-api" [code]="apiPie" />
          <section class="card">
            <div class="dt-title"><h2>Routes by area</h2><p class="muted">{{ map.routes.total }} routes in all, {{ map.routes.open }} of them public. Every other route needs a signed-in session.</p></div>
            <ul class="sys-bars">
              @for (row of map.routes.areas; track row.area) {
                <li>
                  <span class="mono">/v1/{{ row.area }}</span>
                  <span class="sys-bar"><span [style.width.%]="(row.count / maxArea()) * 100"></span></span>
                  <strong>{{ row.count }}</strong>
                  @if (row.open) { <small class="pill warn">{{ row.open }} public</small> }
                </li>
              }
            </ul>
          </section>
        }
      }
    } @else if (!error) {
      <section class="card"><p class="muted"><i class="bi bi-hourglass-split"></i> Reading the system…</p></section>
    }
  `,
})
export class SystemComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  readonly flows = FLOWS;
  readonly tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'overview', label: 'Overview', icon: 'bi-diagram-3' },
    { key: 'org', label: 'Organisation', icon: 'bi-building' },
    { key: 'access', label: 'Roles and access', icon: 'bi-shield-lock' },
    { key: 'data', label: 'Data model', icon: 'bi-database' },
    { key: 'flows', label: 'Workflows', icon: 'bi-signpost-split' },
    { key: 'api', label: 'API', icon: 'bi-plug' },
  ];

  map: SystemMap | null = null;
  error = '';
  tab: Tab = 'overview';
  flow: Flow = FLOWS[0];
  domain = 'People';
  keysOnly = true;
  companyLinks = false;
  architecture = '';
  modules = '';
  organisation = '';
  roles = '';
  er = '';
  erHint = '';
  apiPie = '';

  async ngOnInit(): Promise<void> {
    if (this.store.me && this.store.me.role !== 'owner') {
      this.error = 'Only the owner can open the system map.';
      return;
    }
    try {
      this.map = await this.api.get<SystemMap>('/v1/system/map');
      this.build();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not read the system map.';
    }
  }

  tiles(): { label: string; value: string; icon: string; gold?: boolean }[] {
    const map = this.map!;
    const pages = NAV_GROUPS.reduce((sum, group) => sum + group.items.length, 0);
    return [
      { label: 'Modules in the menu', value: String(pages), icon: 'bi-grid-3x3-gap' },
      { label: 'Tables', value: String(map.entities.length), icon: 'bi-database' },
      { label: 'Relationships', value: String(map.relations.length), icon: 'bi-share' },
      { label: 'API routes', value: String(map.routes.total), icon: 'bi-plug' },
      { label: 'Roles', value: String(map.ladder.length), icon: 'bi-person-badge', gold: true },
      { label: 'People today', value: String(map.org.people), icon: 'bi-people' },
    ];
  }

  matrixRoles(): Rung[] {
    const used = new Set(this.map!.features.flatMap((item) => item.roles));
    return this.map!.ladder.filter((rung) => used.has(rung.key));
  }

  domains(): { key: string; count: number }[] {
    const rows = DOMAIN_ORDER.map((key) => ({ key, count: this.map!.entities.filter((item) => item.domain === key).length })).filter((item) => item.count);
    return [...rows, { key: 'all', count: this.map!.entities.length }];
  }

  setDomain(key: string): void {
    this.domain = key;
    this.buildEr();
  }

  erTables(): Entity[] {
    const rows = this.domain === 'all' ? this.map!.entities : this.map!.entities.filter((item) => item.domain === this.domain);
    return [...rows].sort((a, b) => DOMAIN_ORDER.indexOf(a.domain) - DOMAIN_ORDER.indexOf(b.domain) || a.name.localeCompare(b.name));
  }

  sealedCount(item: Entity): number {
    return item.fields.filter((field) => field.sealed).length;
  }

  linkCount(name: string): number {
    return this.map!.relations.filter((item) => item.from === name || item.to === name).length;
  }

  maxArea(): number {
    return Math.max(1, ...this.map!.routes.areas.map((row) => row.count));
  }

  print(): void {
    window.print();
  }

  private build(): void {
    const map = this.map!;
    const areas = map.routes.areas.length;
    this.architecture = `flowchart TB
  subgraph users["People who sign in"]
    direction LR
    emp["Employees"]
    mgr["Managers and team leads"]
    hr["HR, payroll, and accounts"]
    own["Owner"]
  end
  subgraph outside["Outside the sign-in"]
    direction LR
    cand["Candidates"]
    site["Company website"]
    portals["Job portals"]
    readers["Punch readers<br/>fingerprint, face, card"]
  end
  web["HRMS web app<br/>Angular, runs in the browser"]
  subgraph api["HRMS API, NestJS"]
    direction LR
    guard["Sign-in check<br/>signed session token"]
    pub["Public routes<br/>${map.routes.open} without sign-in"]
    gates["Access gates<br/>roles and grants"]
    lic["Licence lease"]
    svc["Business services<br/>${areas} areas, ${map.routes.total} routes"]
  end
  db[("PostgreSQL<br/>${map.entities.length} tables via Prisma")]
  files[("File storage<br/>photos, library, Form 16, brand")]
  mail["SMTP email<br/>only when someone sends"]
  control["Altamid Control<br/>subscription and seats"]
  emp & mgr & hr & own --> web
  web -->|"/v1 with token"| guard
  guard --> gates --> svc
  cand -->|"career page, apply form"| pub
  site -->|"job feed"| pub
  portals -->|"XML feed, applications"| pub
  readers -->|"device token"| pub
  pub --> svc
  lic -.->|"pauses new people and payroll"| svc
  lic <-->|"lease check"| control
  svc --> db
  svc --> files
  svc --> mail`;

    const featureName = new Map(map.features.map((item) => [item.key, item.label]));
    const lines = ['flowchart LR', '  root(["' + label(map.company || 'Altamid HRMS') + '"])'];
    NAV_GROUPS.forEach((group, g) => {
      lines.push(`  g${g}["${label(group.label)}"]`, `  root --> g${g}`);
      group.items.forEach((item, i) => {
        const need = !item.feature ? 'everyone' : item.feature === 'owner' ? 'owner only' : 'needs ' + label(featureName.get(item.feature) || item.feature);
        lines.push(`  g${g}i${i}["${label(item.label)}<br/>${need}"]`, `  g${g} --> g${g}i${i}`);
      });
    });
    this.modules = lines.join('\n');

    const org = ['flowchart TD', `  c(["${label(map.company || 'Company')}<br/>${map.org.people} people"])`];
    if (map.org.locations.length) {
      org.push('  L["Locations"]', '  c --> L');
      map.org.locations.forEach((item, i) => org.push(`  l${i}["${label(item.name)}<br/>${item.people} people"]`, `  L --> l${i}`));
    }
    if (map.org.departments.length) {
      org.push('  D["Departments"]', '  c --> D');
      map.org.departments.forEach((item, i) => {
        org.push(`  d${i}["${label(item.name)}<br/>${item.people} people"]`, `  D --> d${i}`);
        item.teams.forEach((team, t) => org.push(`  d${i}t${t}["Team: ${label(team.name)}<br/>${team.people} people"]`, `  d${i} --> d${i}t${t}`));
      });
    }
    if (map.org.looseTeams.length) {
      org.push('  T["Teams without a department"]', '  c --> T');
      map.org.looseTeams.forEach((team, t) => org.push(`  x${t}["${label(team.name)}<br/>${team.people} people"]`, `  T --> x${t}`));
    }
    if (map.org.unplaced) org.push(`  u["No department yet<br/>${map.org.unplaced} people"]`, '  D --> u');
    this.organisation = org.join('\n');

    const ranked = [...map.ladder].sort((a, b) => b.rank - a.rank);
    const ladder = ['flowchart TB'];
    ranked.forEach((rung) => ladder.push(`  ${this.nodeId(rung.key)}["${label(rung.name)}<br/>rank ${rung.rank}, ${rung.scope === 'team' ? 'own team only' : 'whole company'}"]`));
    ranked.slice(1).forEach((rung, i) => ladder.push(`  ${this.nodeId(ranked[i].key)} --> ${this.nodeId(rung.key)}`));
    this.roles = ladder.join('\n');

    const pie = ['pie showData', '  title Routes by area'];
    map.routes.areas.forEach((row) => pie.push(`  "${label(row.area)}" : ${row.count}`));
    this.apiPie = pie.join('\n');

    this.buildEr();
  }

  buildEr(): void {
    const map = this.map!;
    const inside = new Set(this.erTables().map((item) => item.name));
    const links = map.relations.filter((item) =>
      (inside.has(item.from) || inside.has(item.to)) && (this.companyLinks || (item.from !== 'Company' && item.to !== 'Company')));
    const ghosts = new Set(links.flatMap((item) => [item.from, item.to]).filter((name) => !inside.has(name)));
    const lines = ['erDiagram'];
    for (const entity of map.entities.filter((item) => inside.has(item.name))) {
      const fields = this.keysOnly ? entity.fields.filter((field) => field.key) : entity.fields;
      lines.push(`  ${entity.name} {`);
      for (const field of fields) {
        const notes = [field.type.endsWith('?') ? 'optional' : '', field.sealed ? 'sealed' : ''].filter(Boolean).join(', ');
        const type = field.type.replace(/\?$/, '').replace(/[^A-Za-z0-9_[\]]/g, '');
        lines.push(`    ${type} ${field.name}${field.key ? ' ' + field.key : ''}${notes ? ' "' + notes + '"' : ''}`);
      }
      lines.push('  }');
    }
    for (const item of links) {
      lines.push(`  ${item.from} ${item.required ? '||' : '|o'}--${item.many ? 'o{' : 'o|'} ${item.to} : "${label(item.label)}"`);
    }
    this.er = lines.join('\n');
    const ghostText = ghosts.size ? ` Empty boxes are linked tables from other areas (${ghosts.size}).` : '';
    this.erHint = `${inside.size} tables and ${links.length} links.${this.companyLinks ? '' : ' Every table belongs to one company; those links are hidden unless you turn them on.'}${ghostText}`;
  }

  private nodeId(key: string): string {
    return 'r_' + key.replace(/[^a-z0-9]/gi, '_');
  }
}
