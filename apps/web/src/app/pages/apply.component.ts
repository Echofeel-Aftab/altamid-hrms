import { Component, ElementRef, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ApiError, ApiService } from '../core/api.service';
import { applyBrand } from '../core/brand';
import { ACCEPT_ATTR, FormFieldDef, isLayout, isShown, isTicked, OTHER_VALUE } from '../core/form-logic';

interface ApplyForm {
  company: string;
  companyId: string;
  title: string;
  intro: string;
  submitLabel: string;
  colors: Record<string, string>;
  logo: string;
  aside: { kicker: string; title: string; lead: string; steps: Array<{ title: string; body: string }> };
  fields: FormFieldDef[];
  slug?: string;
  status?: string;
  preview?: boolean;
}

interface PickedFile { name: string; size: number; data: string }

type Mode = 'standalone' | 'form' | 'page';

const MAX_FILE = 5 * 1024 * 1024;
const MAX_TOTAL = 12 * 1024 * 1024;
const TRACKING = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'browser_event_id', 'landing_page'];
const EXT: Record<string, string[]> = { pdf: ['pdf'], doc: ['doc', 'docx'], image: ['png', 'jpg', 'jpeg'] };

@Component({
  selector: 'app-apply',
  imports: [FormsModule],
  template: `
    <main class="apply-page" [class.is-form-only]="mode === 'form'" [class.is-embedded]="mode !== 'standalone'">
      @if (missing) {
        <section class="apply-card apply-empty">
          <h1>This form is not available</h1>
          <p class="muted">{{ missingReason || 'The company has not published it, or the address is wrong.' }}</p>
        </section>
      } @else if (form) {
        <div class="apply-layout" [class.has-aside]="mode !== 'form'">
          @if (mode !== 'form') {
            <aside class="apply-aside">
              @if (form.logo) { <img class="apply-logo" [src]="form.logo" [alt]="form.company"> }
              <p class="apply-kicker">{{ form.aside.kicker }}</p>
              <h2>{{ form.aside.title }}</h2>
              <p>{{ form.aside.lead }}</p>
              <ol class="apply-steps">
                @for (step of form.aside.steps; track $index; let index = $index) {
                  <li><span>{{ index + 1 }}</span><div><strong>{{ step.title }}</strong><small>{{ step.body }}</small></div></li>
                }
              </ol>
            </aside>
          }

          <section class="apply-card">
            @if (thanks) {
              <div class="apply-done" role="status">
                <span class="apply-done-icon"><i class="bi bi-check-lg"></i></span>
                <h1>Application received</h1>
                <p>{{ thanks }}</p>
              </div>
            } @else {
              @if (staffPreview) {
                <p class="apply-preview-banner" role="status">
                  <i class="bi bi-eye"></i>
                  @if (form.status === 'published') {
                    Staff preview of the live form. Test submissions go to Hiring.
                  } @else {
                    Staff preview — applicants see this only after you publish. Submissions stay off until then.
                  }
                </p>
              }
              @if (mode === 'form' && form.logo) { <img class="apply-logo is-small" [src]="form.logo" [alt]="form.company"> }
              @if (mode === 'standalone' || mode === 'form') { <p class="apply-company">{{ form.company }}</p> }
              <h1>{{ form.title }}</h1>
              @if (form.intro) { <p class="apply-intro">{{ form.intro }}</p> }
              @if (error) { <p class="form-error" role="alert"><i class="bi bi-exclamation-circle"></i> {{ error }}</p> }
              <form class="apply-grid" (ngSubmit)="submit()" novalidate>
                <input class="apply-trap" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" [(ngModel)]="trap">
                @for (field of visible; track field.key) {
                  <div class="apply-cell" [attr.data-width]="field.width" [class.has-error]="!!problems[field.key]" [id]="'cell-' + field.key" (input)="settle(field.key)" (change)="settle(field.key)">
                    @switch (field.type) {
                      @case ('heading') { <h2 class="apply-section">{{ field.label }}</h2> }
                      @case ('paragraph') { <p class="apply-note">{{ field.label }}</p> }
                      @case ('checkbox') {
                        <label class="check apply-check"><input type="checkbox" [name]="field.key" [(ngModel)]="answers[field.key]"> <span>{{ field.label }}@if (field.required) { <em>*</em> }</span></label>
                      }
                      @case ('terms') {
                        <label class="check apply-check apply-terms"><input type="checkbox" [name]="field.key" [(ngModel)]="answers[field.key]"> <span>{{ field.label }}@if (field.required) { <em>*</em> }</span></label>
                      }
                      @default {
                        <label [for]="'f-' + field.key">{{ field.label }}@if (field.required) { <em>*</em> }</label>
                        @switch (control(field)) {
                          @case ('textarea') {
                            <textarea [id]="'f-' + field.key" [name]="field.key" rows="4" [placeholder]="field.placeholder" [(ngModel)]="answers[field.key]"></textarea>
                          }
                          @case ('select') {
                            <select [id]="'f-' + field.key" [name]="field.key" [(ngModel)]="answers[field.key]">
                              <option value="">{{ field.placeholder || 'Choose' }}</option>
                              @for (option of field.options; track option) { <option [value]="option">{{ option }}</option> }
                              @if (field.allowOther) { <option [value]="other">Other</option> }
                            </select>
                          }
                          @case ('radio') {
                            <div class="apply-options" role="radiogroup" [attr.aria-label]="field.label">
                              @for (option of field.options; track option) {
                                <label class="apply-option"><input type="radio" [name]="field.key" [value]="option" [(ngModel)]="answers[field.key]"> <span>{{ option }}</span></label>
                              }
                              @if (field.allowOther) {
                                <label class="apply-option"><input type="radio" [name]="field.key" [value]="other" [(ngModel)]="answers[field.key]"> <span>Other</span></label>
                              }
                            </div>
                          }
                          @case ('checklist') {
                            <div class="apply-options" role="group" [attr.aria-label]="field.label">
                              @for (option of field.options; track option) {
                                <label class="apply-option"><input type="checkbox" [checked]="listHas(field.key, option)" (change)="toggleList(field.key, option)"> <span>{{ option }}</span></label>
                              }
                            </div>
                          }
                          @case ('file') {
                            <div class="apply-file">
                              <label class="btn btn-ghost btn-sm apply-file-pick">
                                <i class="bi bi-upload"></i> {{ (files[field.key] || []).length ? 'Add another' : 'Choose file' }}
                                <input type="file" [id]="'f-' + field.key" [accept]="acceptOf(field)" [multiple]="field.maxFiles > 1" (change)="pick(field, $event)" [disabled]="(files[field.key] || []).length >= field.maxFiles">
                              </label>
                              @for (file of files[field.key] || []; track $index; let index = $index) {
                                <span class="apply-file-chip"><i class="bi bi-file-earmark"></i> {{ file.name }} <small>{{ size(file.size) }}</small>
                                  <button type="button" (click)="unpick(field.key, index)" [attr.aria-label]="'Remove ' + file.name"><i class="bi bi-x"></i></button>
                                </span>
                              }
                            </div>
                          }
                          @default {
                            <input [id]="'f-' + field.key" [name]="field.key" [type]="inputType(field)" [placeholder]="field.placeholder" [autocomplete]="autocomplete(field)" [(ngModel)]="answers[field.key]">
                          }
                        }
                        @if (answers[field.key] === other) {
                          <input class="apply-other" [name]="field.key + '-other'" [(ngModel)]="others[field.key]" placeholder="Type your answer" [attr.aria-label]="field.label + ': other'">
                        }
                      }
                    }
                    @if (field.help && field.type !== 'paragraph' && field.type !== 'heading') { <small class="apply-help">{{ field.help }}</small> }
                    @if (problems[field.key]) { <small class="apply-problem">{{ problems[field.key] }}</small> }
                  </div>
                }
                <div class="apply-cell apply-submit" data-width="full">
                  <button class="btn btn-gold" type="submit" [disabled]="busy">@if (busy) { <i class="bi bi-hourglass-split"></i> Sending… } @else { {{ form.submitLabel }} }</button>
                </div>
              </form>
            }
          </section>
        </div>
      } @else {
        <p class="apply-loading muted">Loading the form…</p>
      }
    </main>
  `,
})
export class ApplyComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject(ElementRef<HTMLElement>);
  readonly other = OTHER_VALUE;
  form: ApplyForm | null = null;
  mode: Mode = 'standalone';
  answers: Record<string, unknown> = {};
  others: Record<string, string> = {};
  files: Record<string, PickedFile[]> = {};
  problems: Record<string, string> = {};
  trap = '';
  thanks = '';
  error = '';
  missing = false;
  missingReason = '';
  staffPreview = false;
  busy = false;
  private applySlug = '';
  private observer: ResizeObserver | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly onMessage = (event: MessageEvent) => this.hostMessage(event);

  get visible(): FormFieldDef[] {
    const fields = this.form?.fields || [];
    return fields.filter((field) => isShown(fields, field, this.answers));
  }

  async ngOnInit(): Promise<void> {
    const embed = this.route.snapshot.queryParamMap.get('embed');
    this.mode = embed === '1' || embed === 'form' ? 'form' : embed === 'page' ? 'page' : 'standalone';
    if (this.mode !== 'standalone') this.startEmbed();
    const previewId = this.route.snapshot.paramMap.get('id') || '';
    const slug = this.route.snapshot.paramMap.get('slug') || '';
    this.staffPreview = !!previewId;
    this.applySlug = slug;
    try {
      this.form = previewId
        ? await this.api.get<ApplyForm>('/v1/forms/' + encodeURIComponent(previewId) + '/preview')
        : await this.api.get<ApplyForm>('/v1/apply/' + encodeURIComponent(slug));
      if (this.form.slug) this.applySlug = this.form.slug;
      applyBrand(this.form.colors);
      document.title = (this.staffPreview ? 'Preview · ' : '') + this.form.title + ' · ' + this.form.company;
      for (const field of this.form.fields) {
        if (field.type === 'checklist') this.answers[field.key] = [];
        else if (field.type === 'checkbox' || field.type === 'terms') this.answers[field.key] = false;
        else if (!isLayout(field) && field.type !== 'file') this.answers[field.key] = '';
      }
    } catch (error) {
      this.missing = true;
      this.missingReason = error instanceof ApiError ? error.message : '';
      document.title = 'Application form';
    }
    this.notify();
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    if (this.timer) clearInterval(this.timer);
    window.removeEventListener('message', this.onMessage);
    document.documentElement.classList.remove('is-embed');
  }

  control(field: FormFieldDef): string {
    if (field.type === 'textarea') return 'textarea';
    if (field.type === 'select') return field.options.length ? 'select' : 'text';
    if (field.type === 'radio' || field.type === 'checklist' || field.type === 'file') return field.type;
    if (field.type === 'question') return field.answerMode;
    return 'text';
  }

  inputType(field: FormFieldDef): string {
    return ['email', 'tel', 'url', 'number', 'date'].includes(field.type) ? field.type : 'text';
  }

  autocomplete(field: FormFieldDef): string {
    if (field.key === 'name') return 'name';
    if (field.type === 'email') return 'email';
    if (field.type === 'tel') return 'tel';
    if (field.map === 'city') return 'address-level2';
    return 'off';
  }

  acceptOf(field: FormFieldDef): string {
    return field.accept.map((kind) => ACCEPT_ATTR[kind]).join(',');
  }

  listHas(key: string, option: string): boolean {
    const list = this.answers[key];
    return Array.isArray(list) && list.includes(option);
  }

  toggleList(key: string, option: string): void {
    const list = Array.isArray(this.answers[key]) ? (this.answers[key] as string[]) : [];
    this.answers[key] = list.includes(option) ? list.filter((item) => item !== option) : [...list, option];
  }

  async pick(field: FormFieldDef, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const chosen = Array.from(input.files || []);
    input.value = '';
    const list = [...(this.files[field.key] || [])];
    delete this.problems[field.key];
    for (const file of chosen) {
      if (list.length >= field.maxFiles) {
        this.problems[field.key] = `Attach up to ${field.maxFiles} file${field.maxFiles === 1 ? '' : 's'}.`;
        break;
      }
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (!field.accept.some((kind) => EXT[kind]?.includes(ext))) {
        this.problems[field.key] = `${file.name} is not a ${field.accept.map((kind) => kind.toUpperCase()).join(' or ')} file.`;
        continue;
      }
      if (file.size > MAX_FILE) {
        this.problems[field.key] = `${file.name} is larger than 5 MB.`;
        continue;
      }
      if (this.totalBytes() + file.size > MAX_TOTAL) {
        this.problems[field.key] = 'The files are too large together. Keep them under 12 MB in total.';
        continue;
      }
      try {
        list.push({ name: file.name, size: file.size, data: await this.read(file) });
        this.files[field.key] = [...list];
      } catch {
        this.problems[field.key] = `${file.name} could not be read. Choose it again.`;
      }
    }
    this.notify();
  }

  settle(key: string): void {
    if (!this.problems[key] || this.control(this.form?.fields.find((field) => field.key === key) as FormFieldDef) === 'file') return;
    delete this.problems[key];
    if (!Object.keys(this.problems).length) this.error = '';
  }

  unpick(key: string, index: number): void {
    this.files[key] = (this.files[key] || []).filter((_, item) => item !== index);
    this.notify();
  }

  size(bytes: number): string {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB';
  }

  async submit(): Promise<void> {
    if (!this.form || this.busy) return;
    this.error = '';
    this.problems = this.check();
    const first = Object.keys(this.problems)[0];
    if (first) {
      this.error = 'Check the highlighted fields.';
      this.reveal(first);
      return;
    }
    if (this.staffPreview && this.form.status !== 'published') {
      this.error = 'Publish the form (Save and publish) before applicants — or you — can send a real application.';
      this.reveal('');
      return;
    }
    const slug = this.applySlug || this.form.slug || this.route.snapshot.paramMap.get('slug') || '';
    if (!slug) {
      this.error = 'This form has no public address yet. Save it first.';
      this.reveal('');
      return;
    }
    const shown = new Set(this.visible.map((field) => field.key));
    const answers = Object.fromEntries(Object.entries(this.answers).filter(([key]) => shown.has(key)));
    const files = Object.fromEntries(Object.entries(this.files).filter(([key]) => shown.has(key)).map(([key, list]) => [key, list.map(({ name, data }) => ({ name, data }))]));
    this.busy = true;
    try {
      const result = await this.api.post<{ thanks: string; redirectUrl: string }>('/v1/apply/' + encodeURIComponent(slug), {
        answers, other: this.others, files, website: this.trap, tracking: this.tracking(),
      });
      if (result.redirectUrl && /^https:\/\//i.test(result.redirectUrl)) {
        if (this.mode === 'standalone') {
          location.href = result.redirectUrl;
          return;
        }
        this.post({ type: 'redirect', url: result.redirectUrl });
      }
      this.thanks = result.thanks;
      this.reveal('');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not send the application. Try again.';
      this.reveal('');
    } finally {
      this.busy = false;
      this.notify();
    }
  }

  private check(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const field of this.visible) {
      if (isLayout(field)) continue;
      const value = this.answers[field.key];
      const text = typeof value === 'string' ? value.trim() : '';
      const label = field.label.length > 60 ? 'This answer' : field.label;
      if (field.type === 'file') {
        if (field.required && !(this.files[field.key] || []).length) out[field.key] = 'Attach a file.';
        continue;
      }
      if (field.type === 'checkbox' || field.type === 'terms') {
        if (field.required && !isTicked(value)) out[field.key] = field.type === 'terms' ? 'Tick this to send the form.' : 'Tick this to continue.';
        continue;
      }
      if (field.type === 'checklist') {
        if (field.required && !(Array.isArray(value) && value.length)) out[field.key] = 'Choose at least one.';
        continue;
      }
      if (field.required && !text) {
        out[field.key] = `${label} is required.`;
        continue;
      }
      if (!text) continue;
      if (text === OTHER_VALUE && !(this.others[field.key] || '').trim()) out[field.key] = 'Type your answer.';
      else if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) out[field.key] = 'Enter a valid email address.';
      else if (field.type === 'tel' && !/^\+?[0-9][0-9\s().-]{5,22}$/.test(text)) out[field.key] = 'Enter a valid phone number.';
      else if (field.type === 'url' && !/^https?:\/\/\S+$/i.test(text)) out[field.key] = 'Start the link with https://';
    }
    return out;
  }

  private tracking(): Record<string, string> {
    const query = this.route.snapshot.queryParamMap;
    const out: Record<string, string> = {};
    for (const key of TRACKING) {
      const value = query.get(key);
      if (value) out[key] = value.slice(0, 500);
    }
    if (this.mode === 'standalone') {
      out['landing_page'] = location.href.split('#')[0].slice(0, 500);
      if (document.referrer && !document.referrer.startsWith(location.origin)) out['referrer'] = document.referrer.slice(0, 500);
    } else {
      out['embed'] = this.mode;
      if (!out['landing_page'] && document.referrer) out['landing_page'] = document.referrer.slice(0, 500);
    }
    return out;
  }

  private totalBytes(): number {
    return Object.values(this.files).flat().reduce((sum, file) => sum + file.size, 0);
  }

  private read(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('unreadable'));
      reader.readAsDataURL(file);
    });
  }

  private reveal(key: string): void {
    setTimeout(() => {
      const target = key ? document.getElementById('cell-' + key) : this.host.nativeElement.querySelector('.apply-card');
      if (this.mode === 'standalone') target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else this.post({ type: 'scroll' });
      (target?.querySelector('input, select, textarea') as HTMLElement | null)?.focus({ preventScroll: true });
      this.notify();
    });
  }

  private startEmbed(): void {
    document.documentElement.classList.add('is-embed');
    document.documentElement.classList.remove('theme-dark');
    window.addEventListener('message', this.onMessage);
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.notify());
      this.observer.observe(this.host.nativeElement);
    }
    this.timer = setInterval(() => this.notify(), 1200);
  }

  private hostMessage(event: MessageEvent): void {
    const data = event.data as { source?: string; type?: string; dark?: boolean } | null;
    if (event.source !== window.parent || !data || data.source !== 'altamid-hrms-host') return;
    if (data.type === 'theme') document.documentElement.classList.toggle('theme-dark', !!data.dark);
    this.notify();
  }

  private notify(): void {
    if (this.mode === 'standalone') return;
    requestAnimationFrame(() => {
      const main = this.host.nativeElement.querySelector('.apply-page') as HTMLElement | null;
      const height = Math.ceil(main ? main.getBoundingClientRect().height : document.documentElement.scrollHeight);
      this.post({ type: 'resize', height });
    });
  }

  private post(message: Record<string, unknown>): void {
    if (window.parent === window) return;
    try {
      window.parent.postMessage({ source: 'altamid-hrms-form', ...message }, '*');
    } catch {
      /* the host page went away */
    }
  }
}
