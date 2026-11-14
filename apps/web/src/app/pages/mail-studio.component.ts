import { Component, ElementRef, inject, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ApiService } from '../core/api.service';
import { SessionStore } from '../core/session.store';
import { MailCatalogItem, MailDesign, MailGroup, MailKey, MailLayout, MailPreview, MailTemplate, SettingsView, TemplateSettings } from '../core/settings';
import { RichEditorComponent } from '../shared/rich-editor.component';

const ICONS: Record<MailKey, string> = {
  payslip: 'bi bi-receipt',
  leave: 'bi bi-calendar2-check',
  announcement: 'bi bi-megaphone',
  birthday: 'bi bi-cake2',
  anniversary: 'bi bi-award',
  welcome: 'bi bi-door-open',
  cooling: 'bi bi-hourglass-split',
  exit: 'bi bi-box-arrow-right',
  onboarding: 'bi bi-person-plus',
  attendance: 'bi bi-clock-history',
  password: 'bi bi-key',
  interview: 'bi bi-people',
  reimbursement: 'bi bi-wallet2',
  recognition: 'bi bi-stars',
  document: 'bi bi-file-earmark-text',
  offer: 'bi bi-briefcase',
  rejection: 'bi bi-envelope-x',
  probation: 'bi bi-flag',
  overtime: 'bi bi-stopwatch',
  tax: 'bi bi-calculator',
  reminder: 'bi bi-bell',
  asset: 'bi bi-laptop',
};

const TOKEN_LABELS: Record<string, string> = {
  name: 'First name', month: 'Month', net: 'Net pay', company: 'Company', type: 'Type', from: 'From', to: 'To',
  days: 'Days', status: 'Decision', title: 'Title', body: 'Announcement text', sender: 'Sender', years: 'Years',
  job: 'Job', date: 'Can apply from', lastDay: 'Last working day', startDate: 'Start date', manager: 'Manager',
  day: 'Day', link: 'Reset link', when: 'When', where: 'Where', interviewer: 'Interviewer', amount: 'Amount',
  category: 'Category', reason: 'Reason', document: 'Document', location: 'Location', endDate: 'End date',
  hours: 'Hours', approver: 'Approver', deadline: 'Deadline', year: 'Year', item: 'Item', count: 'Count',
  asset: 'Asset', serial: 'Serial', issued: 'Issued on', code: 'Employee code', department: 'Department',
  designation: 'Designation', outlet: 'Outlet', website: 'Website', phone: 'Phone', email: 'Email',
  city: 'City', address: 'Address',
};

const HEADER_TOKENS = ['company', 'year', 'website', 'phone', 'email', 'city', 'address'] as const;

const COLOUR_SETS: Array<{ id: string; label: string; accent: string; secondary: string }> = [
  { id: 'navy', label: 'Navy & gold', accent: '#103860', secondary: '#e8c85c' },
  { id: 'teal', label: 'Teal', accent: '#0f766e', secondary: '#5eead4' },
  { id: 'forest', label: 'Forest', accent: '#166534', secondary: '#86efac' },
  { id: 'wine', label: 'Wine', accent: '#9f1239', secondary: '#fda4af' },
  { id: 'slate', label: 'Slate', accent: '#334155', secondary: '#94a3b8' },
  { id: 'indigo', label: 'Indigo', accent: '#3730a3', secondary: '#a5b4fc' },
  { id: 'amber', label: 'Amber', accent: '#b45309', secondary: '#fcd34d' },
  { id: 'ocean', label: 'Ocean', accent: '#0369a1', secondary: '#7dd3fc' },
];

const GROUP_LABELS: Record<MailGroup | 'all', string> = {
  all: 'All',
  pay: 'Pay',
  time: 'Time',
  people: 'People',
  hiring: 'Hiring',
  system: 'System',
};

@Component({
  selector: 'app-settings-templates',
  imports: [FormsModule, RichEditorComponent],
  template: `
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    @if (form) {
      <div class="mail-filter" role="tablist" aria-label="Template groups">
        @for (group of groups; track group) {
          <button type="button" class="mail-filter-btn" [class.is-active]="filter === group" (click)="filter = group">{{ groupLabel(group) }}</button>
        }
      </div>
      <div class="mail-picker" role="tablist" aria-label="Email templates">
        @for (item of visibleCatalog; track item.key) {
          <button type="button" role="tab" class="mail-pick" [class.is-active]="key === item.key" [attr.aria-selected]="key === item.key" (click)="pick(item.key)">
            <span class="mail-pick-ico"><i [class]="icon(item.key)"></i></span>
            <span class="mail-pick-text">
              <strong>{{ item.label }}</strong>
              <small>{{ item.hint }}</small>
            </span>
            @if (item.automatic) {
              <span class="chip" [class.is-ok]="form.items[item.key].auto">{{ form.items[item.key].auto ? 'Auto on' : 'Auto off' }}</span>
            } @else {
              <span class="chip is-info">One click</span>
            }
          </button>
        }
      </div>

      <div class="mail-studio">
        <div class="mail-studio-edit" (focusin)="remember($event)" (focusout)="keepRange($event)">
          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon"><i [class]="icon(key)"></i></span>
              <div>
                <h2>{{ item.label }} email</h2>
                <p>{{ item.hint }. Click a token to place it where your cursor is.</p>
              </div>
            </header>
            <div class="settings-card-body">
              <p class="settings-subhead">Dynamic fields</p>
              <div class="mail-tokens" aria-label="Tokens">
                @for (token of item.tokens; track token) {
                  <button type="button" class="mail-token" (mousedown)="$event.preventDefault(); grab()" (click)="insert(token)" [title]="'Insert ' + tokenLabel(token)">
                    <code>{{ '{{' + token + '}}' }}</code><span>{{ tokenLabel(token) }}</span>
                  </button>
                }
              </div>
              <div class="form-cols">
                <div>
                  <label for="mail-subject">Subject line</label>
                  <input id="mail-subject" name="subject" maxlength="160" [(ngModel)]="template.subject" (ngModelChange)="changed()">
                </div>
                <div>
                  <label for="mail-preheader">Inbox preview line</label>
                  <input id="mail-preheader" name="preheader" maxlength="200" placeholder="Shown after the subject in Gmail and Outlook" [(ngModel)]="template.preheader" (ngModelChange)="changed()">
                </div>
              </div>
              <label for="mail-heading">Heading</label>
              <input id="mail-heading" name="heading" maxlength="160" [(ngModel)]="template.heading" (ngModelChange)="changed()">
              <label for="mail-body">Message</label>
              <app-rich-editor inputId="mail-body" label="Message" [max]="4000" [minHeight]="180" [(ngModel)]="template.body" (ngModelChange)="changed()" />
              <div class="form-cols">
                <div>
                  <label for="mail-button">Button label</label>
                  <input id="mail-button" name="button" maxlength="40" placeholder="Leave blank for no button" [(ngModel)]="template.button" (ngModelChange)="changed()">
                  <p class="field-hint">The button opens the matching page in the HRMS.</p>
                </div>
                @if (item.automatic) {
                  <div class="mail-auto">
                    <label class="check">
                      <input type="checkbox" name="auto" [(ngModel)]="template.auto">
                      <span><strong>Send automatically</strong><small>{{ autoHint }}</small></span>
                    </label>
                  </div>
                }
              </div>
            </div>
          </section>

          <section class="settings-card">
            <header class="settings-card-head">
              <span class="settings-icon"><i class="bi bi-palette2"></i></span>
              <div>
                <h2>Email design</h2>
                <p>Shared by every email — layout, colours, header, and footer</p>
              </div>
            </header>
            <div class="settings-card-body">
              <p class="settings-subhead">Layout</p>
              <div class="mail-layouts" role="radiogroup" aria-label="Layout">
                @for (layout of layouts; track layout.id) {
                  <button type="button" role="radio" class="mail-layout" [class.is-active]="form.design.layout === layout.id" [attr.aria-checked]="form.design.layout === layout.id" (click)="setLayout(layout.id)">
                    <span class="mail-thumb" [attr.data-layout]="layout.id" [style.--mail-accent]="accentShown">
                      <span class="mail-thumb-head"></span>
                      <span class="mail-thumb-line is-wide"></span>
                      <span class="mail-thumb-line"></span>
                      <span class="mail-thumb-line is-short"></span>
                      <span class="mail-thumb-btn"></span>
                    </span>
                    <strong>{{ layout.label }}</strong>
                    <small>{{ layout.hint }}</small>
                  </button>
                }
              </div>

              <p class="settings-subhead">Colour combinations</p>
              <div class="mail-colour-sets" role="list">
                @for (set of colourSets; track set.id) {
                  <button type="button" class="mail-colour-set" [class.is-active]="form.design.accent === set.accent && form.design.secondary === set.secondary" (click)="applyColours(set.accent, set.secondary)" [title]="set.label">
                    <span class="mail-colour-swatch" [style.background]="set.accent"></span>
                    <span class="mail-colour-swatch is-trim" [style.background]="set.secondary"></span>
                    <span>{{ set.label }}</span>
                  </button>
                }
                <button type="button" class="mail-colour-set" [class.is-active]="!form.design.accent" (click)="applyColours('', '')" title="Use brand colour from Appearance">
                  <span class="mail-colour-swatch" [style.background]="brandAccent"></span>
                  <span class="mail-colour-swatch is-trim" style="background:#e2e8f0"></span>
                  <span>Brand</span>
                </button>
              </div>
              <div class="form-cols">
                <div>
                  <label for="mail-accent">Accent colour</label>
                  <div class="mail-colour">
                    <input type="color" id="mail-accent" name="accent" [ngModel]="accentShown" (ngModelChange)="form.design.accent = $event; changed()">
                    <input type="text" name="accentHex" maxlength="7" aria-label="Accent colour hex" [ngModel]="form.design.accent" (ngModelChange)="form.design.accent = $event; changed()" placeholder="Brand colour">
                  </div>
                </div>
                <div>
                  <label for="mail-secondary">Header trim colour</label>
                  <div class="mail-colour">
                    <input type="color" id="mail-secondary" name="secondary" [ngModel]="secondaryShown" (ngModelChange)="form.design.secondary = $event; changed()">
                    <input type="text" name="secondaryHex" maxlength="7" aria-label="Trim colour hex" [ngModel]="form.design.secondary" (ngModelChange)="form.design.secondary = $event; changed()" placeholder="Optional">
                    <button type="button" class="btn btn-ghost btn-sm" [disabled]="!form.design.secondary" (click)="form.design.secondary = ''; changed()">Clear</button>
                  </div>
                </div>
              </div>
              <div class="mail-switches mail-switches-row">
                <label class="check"><input type="checkbox" name="tinted" [(ngModel)]="form.design.tinted" (ngModelChange)="changed()"> <span><strong>Tinted background</strong><small>Soft wash of the accent</small></span></label>
                <label class="check"><input type="checkbox" name="rounded" [(ngModel)]="form.design.rounded" (ngModelChange)="changed()"> <span><strong>Rounded corners</strong><small>Card and button</small></span></label>
                <label class="check"><input type="checkbox" name="logo" [(ngModel)]="form.design.showLogo" (ngModelChange)="changed()"> <span><strong>Company logo</strong><small>Initials when no logo</small></span></label>
              </div>

              <p class="settings-subhead">Custom header</p>
              <label class="check" style="margin-bottom:10px">
                <input type="checkbox" name="showHeaderText" [(ngModel)]="form.design.showHeaderText" (ngModelChange)="changed()">
                <span><strong>Show header title and tagline</strong><small>Appears beside or under the logo</small></span>
              </label>
              <div class="mail-tokens" aria-label="Header tokens">
                @for (token of headerTokens; track token) {
                  <button type="button" class="mail-token" (mousedown)="$event.preventDefault(); grab()" (click)="insert(token)" [title]="'Insert ' + tokenLabel(token)">
                    <code>{{ '{{' + token + '}}' }}</code><span>{{ tokenLabel(token) }}</span>
                  </button>
                }
              </div>
              <div class="form-cols">
                <div>
                  <label for="mail-header-title">Header title</label>
                  <input id="mail-header-title" name="headerTitle" maxlength="120" [attr.placeholder]="'e.g. {{company}} or People & Pay'" [(ngModel)]="form.design.headerTitle" (ngModelChange)="changed()">
                </div>
                <div>
                  <label for="mail-header-tag">Header tagline</label>
                  <input id="mail-header-tag" name="headerTagline" maxlength="160" [attr.placeholder]="'e.g. {{city}} · {{year}}'" [(ngModel)]="form.design.headerTagline" (ngModelChange)="changed()">
                </div>
              </div>
              <p class="field-hint">Click a header token, then click into the title or tagline to insert it. Leave blank to show only the logo or company mark.</p>

              <p class="settings-subhead">Sign-off and footer</p>
              <div class="form-cols">
                <div>
                  <label for="mail-signoff">Sign-off</label>
                  <textarea id="mail-signoff" name="signoff" rows="2" maxlength="200" [(ngModel)]="form.design.signoff" (ngModelChange)="changed()"></textarea>
                </div>
                <div>
                  <label for="mail-footer">Footer</label>
                  <textarea id="mail-footer" name="footer" rows="2" maxlength="300" [(ngModel)]="form.design.footer" (ngModelChange)="changed()"></textarea>
                </div>
              </div>
              <label for="mail-footer-note">Footer note</label>
              <textarea id="mail-footer-note" name="footerNote" rows="2" maxlength="300" [attr.placeholder]="'Optional second line — address, legal, or {{phone}}'" [(ngModel)]="form.design.footerNote" (ngModelChange)="changed()"></textarea>
              <label class="check" style="margin-top:12px">
                <input type="checkbox" name="showWebsite" [(ngModel)]="form.design.showWebsite" (ngModelChange)="changed()">
                <span><strong>Show website in footer</strong><small>From company profile</small></span>
              </label>
            </div>
          </section>

          <div class="form-bar">
            <span class="muted"><i class="bi bi-info-circle"></i> Saving changes the copy only. Nothing is sent.</span>
            <div class="form-bar-actions">
              <button type="button" class="btn btn-ghost" [disabled]="busy || testing" (click)="confirming = true"><i class="bi bi-send"></i> Send test to me</button>
              <button type="button" class="btn btn-gold" [disabled]="busy" (click)="save()"><i class="bi bi-check2"></i> {{ busy ? 'Saving…' : 'Save templates' }}</button>
            </div>
          </div>
          @if (confirming) {
            <section class="approval-card" role="alertdialog" aria-labelledby="mail-test-title">
              <div class="approval-head">
                <span class="approval-ico"><i class="bi bi-envelope-exclamation"></i></span>
                <div>
                  <h2 id="mail-test-title">Send a test email?</h2>
                  <p>One {{ item.label.toLowerCase() }} email goes to <strong>{{ email }}</strong> through your company mailbox. Sample values are used, and nobody else receives it.</p>
                </div>
                <span class="chip is-warn">Needs approval</span>
              </div>
              <div class="actions">
                <button type="button" class="btn btn-primary" [disabled]="testing" (click)="test()"><i class="bi bi-check2"></i> {{ testing ? 'Sending…' : 'Approve and send' }}</button>
                <button type="button" class="btn btn-ghost" [disabled]="testing" (click)="confirming = false">Cancel</button>
              </div>
            </section>
          }
          @if (testNote) {
            <p [class]="testNote.ok ? 'form-ok' : 'form-error'">{{ testNote.message }}</p>
          }
        </div>

        <aside class="mail-preview" aria-label="Preview">
          <div class="mail-preview-bar">
            <span class="mail-preview-title"><i class="bi bi-eye"></i> Live preview <span class="source-chip">Sample values</span></span>
            <div class="seg-mini" role="group" aria-label="Preview size">
              <button type="button" [class.is-active]="device === 'desktop'" (click)="device = 'desktop'; fit()"><i class="bi bi-display"></i> Desktop</button>
              <button type="button" [class.is-active]="device === 'phone'" (click)="device = 'phone'; fit()"><i class="bi bi-phone"></i> Phone</button>
              <button type="button" [class.is-active]="device === 'text'" (click)="device = 'text'"><i class="bi bi-text-left"></i> Text</button>
            </div>
          </div>
          <div class="mail-inbox">
            <span class="mail-inbox-avatar">{{ initials }}</span>
            <div class="mail-inbox-text">
              <div class="mail-inbox-top"><strong>{{ companyName }}</strong><small>now</small></div>
              <div class="mail-inbox-line"><strong>{{ preview?.subject || template.subject }}</strong><span> — {{ preview?.preheader || template.preheader }}</span></div>
            </div>
          </div>
          @if (previewError) { <p class="form-error" data-inline-message>{{ previewError }}</p> }
          @if (device === 'text') {
            <pre class="mail-text">{{ preview?.text }}</pre>
          } @else {
            <div class="mail-stage" [class.is-phone]="device === 'phone'" #stage>
              <div class="mail-device" [style.height.px]="frameHeight * scale" [style.width.px]="frameWidth * scale">
                <iframe #frame title="Email preview" sandbox="allow-same-origin" [srcdoc]="srcdoc" (load)="measure()"
                  [style.width.px]="frameWidth" [style.height.px]="frameHeight" [style.transform]="'scale(' + scale + ')'"></iframe>
              </div>
              @if (loading) { <span class="mail-stage-busy"><i class="bi bi-arrow-repeat"></i> Updating</span> }
            </div>
          }
        </aside>
      </div>
    }
  `,
})
export class SettingsTemplatesComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly store = inject(SessionStore);
  @ViewChild('stage') stage?: ElementRef<HTMLElement>;
  @ViewChild('frame') frame?: ElementRef<HTMLIFrameElement>;
  readonly layouts: Array<{ id: MailLayout; label: string; hint: string }> = [
    { id: 'banner', label: 'Banner', hint: 'Colour band with the logo' },
    { id: 'card', label: 'Card', hint: 'Centred, accent top edge' },
    { id: 'minimal', label: 'Minimal', hint: 'Plain letter style' },
  ];
  readonly colourSets = COLOUR_SETS;
  readonly headerTokens = HEADER_TOKENS;
  readonly groups: Array<MailGroup | 'all'> = ['all', 'pay', 'time', 'people', 'hiring', 'system'];
  filter: MailGroup | 'all' = 'all';
  form: TemplateSettings | null = null;
  key: MailKey = 'payslip';
  private last: HTMLElement | null = null;
  private range: Range | null = null;
  device: 'desktop' | 'phone' | 'text' = 'desktop';
  preview: MailPreview | null = null;
  srcdoc: SafeHtml = '';
  previewError = '';
  loading = false;
  frameHeight = 640;
  scale = 1;
  error = '';
  ok = '';
  busy = false;
  testing = false;
  confirming = false;
  testNote: { ok: boolean; message: string } | null = null;
  companyName = '';
  brandAccent = '#103860';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private observer: ResizeObserver | null = null;

  get item(): MailCatalogItem {
    return this.form!.catalog.find((row) => row.key === this.key)!;
  }

  get template(): MailTemplate {
    return this.form!.items[this.key];
  }

  get visibleCatalog(): MailCatalogItem[] {
    const rows = this.form?.catalog || [];
    if (this.filter === 'all') return rows;
    return rows.filter((row) => (row.group || 'people') === this.filter);
  }

  get frameWidth(): number {
    return this.device === 'phone' ? 375 : 680;
  }

  get email(): string {
    return this.store.me?.email || 'your sign-in email';
  }

  get initials(): string {
    return this.companyName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'HR';
  }

  get accentShown(): string {
    return /^#[0-9a-f]{6}$/i.test(this.form?.design.accent || '') ? this.form!.design.accent : this.brandAccent;
  }

  get secondaryShown(): string {
    return /^#[0-9a-f]{6}$/i.test(this.form?.design.secondary || '') ? this.form!.design.secondary : '#e8c85c';
  }

  get autoHint(): string {
    if (this.key === 'payslip') return 'Emailed when their slip is published';
    if (this.key === 'leave') return 'Emailed when leave is approved or rejected';
    if (this.key === 'announcement') return 'Emailed to the audience when it is posted';
    if (this.key === 'attendance' || this.key === 'overtime') return 'Emailed when the request is decided';
    if (this.key === 'reimbursement') return 'Emailed when a claim is decided or paid';
    if (this.key === 'probation') return 'Emailed when probation is ending soon';
    if (this.key === 'tax') return 'Emailed as a declaration reminder';
    if (this.key === 'reminder') return 'Emailed for pending approvals';
    if (this.key === 'password') return 'Emailed when someone requests a reset';
    if (this.key === 'cooling') return 'Emailed when the cooling rule blocks an apply';
    return 'Emailed when this event happens';
  }

  async ngOnInit(): Promise<void> {
    try {
      const view = await this.api.get<SettingsView>('/v1/settings');
      this.companyName = view.company.name;
      this.brandAccent = getComputedStyle(document.documentElement).getPropertyValue('--navy-800').trim() || '#103860';
      this.form = this.normalize(view.templates);
      if (!this.form.catalog.some((row) => row.key === this.key)) this.key = this.form.catalog[0]?.key || 'payslip';
      this.refresh();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load the templates.';
    }
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.observer?.disconnect();
  }

  groupLabel(group: MailGroup | 'all'): string {
    return GROUP_LABELS[group];
  }

  icon(key: MailKey): string {
    return ICONS[key] || 'bi bi-envelope';
  }

  tokenLabel(token: string): string {
    return TOKEN_LABELS[token] || token;
  }

  pick(key: MailKey): void {
    this.key = key;
    this.last = null;
    this.confirming = false;
    this.testNote = null;
    this.refresh();
  }

  setLayout(layout: MailLayout): void {
    this.form!.design.layout = layout;
    this.changed();
  }

  applyColours(accent: string, secondary: string): void {
    this.form!.design.accent = accent;
    this.form!.design.secondary = secondary;
    this.changed();
  }

  remember(event: FocusEvent): void {
    const el = event.target as HTMLElement;
    if (el.isContentEditable || (el instanceof HTMLInputElement && el.type === 'text') || el instanceof HTMLTextAreaElement) this.last = el;
  }

  keepRange(event: FocusEvent): void {
    const el = event.target as HTMLElement;
    const selection = window.getSelection();
    if (el.isContentEditable && selection?.rangeCount) this.range = selection.getRangeAt(0).cloneRange();
  }

  grab(): void {
    const active = document.activeElement as HTMLElement | null;
    if (!active?.closest('.mail-studio-edit')) return;
    const editor = active.closest<HTMLElement>('[contenteditable="true"]');
    if (editor) {
      this.last = editor;
      const selection = window.getSelection();
      if (selection?.rangeCount) this.range = selection.getRangeAt(0).cloneRange();
    } else if ((active instanceof HTMLInputElement && active.type === 'text') || active instanceof HTMLTextAreaElement) {
      this.last = active;
    }
  }

  insert(token: string): void {
    const text = '{{' + token + '}}';
    const el = this.last;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      el.focus();
      el.setRangeText(text, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      this.syncField(el);
      this.changed();
      return;
    }
    if (el?.isConnected && el.isContentEditable) {
      el.focus();
      const selection = window.getSelection();
      if (this.range && selection && el.contains(this.range.startContainer)) {
        selection.removeAllRanges();
        selection.addRange(this.range);
      }
      if (document.execCommand('insertText', false, text)) {
        this.changed();
        return;
      }
    }
    this.template.body = (this.template.body || '') + '<p>' + text + '</p>';
    this.changed();
  }

  changed(): void {
    this.ok = '';
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), 350);
  }

  async refresh(): Promise<void> {
    if (!this.form) return;
    const seq = ++this.seq;
    this.loading = true;
    try {
      const result = await this.api.post<MailPreview>('/v1/settings/mail/preview', { key: this.key, template: this.template, design: this.form.design });
      if (seq !== this.seq) return;
      this.preview = result;
      this.previewError = '';
      this.srcdoc = this.sanitizer.bypassSecurityTrustHtml(result.html);
    } catch (error) {
      if (seq === this.seq) this.previewError = error instanceof Error ? error.message : 'The preview could not be built.';
    } finally {
      if (seq === this.seq) this.loading = false;
    }
  }

  measure(): void {
    this.fit();
    if (!this.observer && this.stage) {
      this.observer = new ResizeObserver(() => this.fit());
      this.observer.observe(this.stage.nativeElement);
    }
  }

  fit(): void {
    setTimeout(() => {
      const width = this.stage?.nativeElement.clientWidth || this.frameWidth;
      const room = this.device === 'phone' ? width - 24 : width;
      this.scale = Math.min(1, room / this.frameWidth);
      const body = this.frame?.nativeElement.contentDocument?.body;
      if (body) this.frameHeight = Math.max(420, body.scrollHeight);
    });
  }

  async save(): Promise<void> {
    if (!this.form) return;
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', { section: 'templates', design: this.form.design, items: this.form.items });
      this.form = this.normalize(view.templates);
      this.ok = 'Templates saved. Nothing was sent.';
      this.refresh();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save.';
    } finally {
      this.busy = false;
    }
  }

  async test(): Promise<void> {
    if (!this.form) return;
    this.testing = true;
    this.testNote = null;
    try {
      this.testNote = await this.api.post<{ ok: boolean; message: string }>('/v1/settings/mail/test', { key: this.key, template: this.template, design: this.form.design });
      this.confirming = false;
    } catch (error) {
      this.testNote = { ok: false, message: error instanceof Error ? error.message : 'The test could not be sent.' };
    } finally {
      this.testing = false;
    }
  }

  private syncField(el: HTMLInputElement | HTMLTextAreaElement): void {
    if (!this.form) return;
    const name = el.getAttribute('name') || '';
    const design = this.form.design as unknown as Record<string, string>;
    if (name in design && typeof design[name] === 'string') design[name] = el.value;
    const copy = this.template as unknown as Record<string, string>;
    if (name in copy && typeof copy[name] === 'string') copy[name] = el.value;
  }

  private normalize(templates: TemplateSettings): TemplateSettings {
    const design: MailDesign = {
      layout: templates.design?.layout || 'banner',
      accent: templates.design?.accent || '',
      secondary: templates.design?.secondary || '',
      tinted: templates.design?.tinted !== false,
      rounded: templates.design?.rounded !== false,
      showLogo: templates.design?.showLogo !== false,
      headerTitle: templates.design?.headerTitle || '',
      headerTagline: templates.design?.headerTagline || '',
      showHeaderText: templates.design?.showHeaderText !== false,
      signoff: templates.design?.signoff || '',
      footer: templates.design?.footer || '',
      footerNote: templates.design?.footerNote || '',
      showWebsite: templates.design?.showWebsite !== false,
    };
    return { ...templates, design, items: templates.items || {} as TemplateSettings['items'], catalog: templates.catalog || [] };
  }
}
