import { Component, HostListener, inject, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { FieldType, FieldWidth, FileKind, FormFieldDef, isChoiceParent, isLayout, LogicOp, needsOptions } from '../core/form-logic';
import { Sweet } from '../shared/sweet';

interface FormSummary {
  id: string;
  name: string;
  slug: string;
  title: string;
  status: string;
  updatedAt: string;
  submissions: number;
  fieldCount: number;
  path: string;
}

interface Aside { kicker: string; title: string; lead: string; steps: Array<{ title: string; body: string }> }

interface FormSettings {
  aside: Aside & { custom: boolean };
  redirectUrl: string;
  notify: string[];
  showLogo: boolean;
}

interface FormDetail extends FormSummary {
  intro: string;
  submitLabel: string;
  thanks: string;
  fields: FormFieldDef[];
  settings: FormSettings;
  standardAside: Aside;
}

interface Template {
  key: string;
  name: string;
  description: string;
  fields: string[];
  group?: 'general' | 'campus' | 'specialist' | 'event';
  icon?: string;
  title?: string;
}

interface SubmissionRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  jobTitle: string;
  source: string;
  files: number;
  createdAt: string;
}

type Device = 'desktop' | 'tablet' | 'mobile';

const TYPE_LABELS: Record<FieldType, string> = {
  text: 'Short text', email: 'Email', tel: 'Phone', url: 'Link', number: 'Number', date: 'Date', textarea: 'Long text',
  select: 'Dropdown', radio: 'Single choice', checkbox: 'Tick box', checklist: 'Tick several', question: 'Question',
  terms: 'Terms to accept', file: 'File upload', heading: 'Heading', paragraph: 'Paragraph',
};

const TYPE_ICONS: Record<FieldType, string> = {
  text: 'bi-input-cursor-text', email: 'bi-envelope', tel: 'bi-telephone', url: 'bi-link-45deg', number: 'bi-123', date: 'bi-calendar3',
  textarea: 'bi-text-paragraph', select: 'bi-menu-button-wide', radio: 'bi-ui-radios', checkbox: 'bi-check2-square', checklist: 'bi-ui-checks',
  question: 'bi-question-circle', terms: 'bi-shield-check', file: 'bi-paperclip', heading: 'bi-type-h2', paragraph: 'bi-justify-left',
};

const PALETTE: Array<{ title: string; types: FieldType[] }> = [
  { title: 'Contact', types: ['text', 'email', 'tel', 'url', 'number', 'date'] },
  { title: 'Answers', types: ['textarea', 'select', 'radio', 'checkbox', 'checklist', 'question'] },
  { title: 'Files and consent', types: ['file', 'terms'] },
  { title: 'Layout', types: ['heading', 'paragraph'] },
];

const WIDTH_LABELS: Record<FieldWidth, string> = {
  full: 'Full width', half: 'Half', third: 'One third', quarter: 'One quarter', wide: 'Wide (70%)', narrow: 'Narrow (30%)',
};

const MAP_LABELS: Record<string, string> = {
  custom: 'Keep as an answer', name: 'Applicant name', email: 'Applicant email', phone: 'Phone number', city: 'City',
  resume: 'Resume', role: 'Job applied for', note: 'Cover note',
};

const KIND_LABELS: Record<FileKind, string> = { pdf: 'PDF', doc: 'Word (.doc, .docx)', image: 'Image (PNG, JPG)' };

const OP_LABELS: Record<LogicOp, string> = { equals: 'is one of', not_equals: 'is not one of', checked: 'is ticked', unchecked: 'is not ticked' };

@Component({
  selector: 'app-settings-forms',
  imports: [FormsModule, RouterLink],
  template: `
    @if (error) { <p class="form-error"><i class="bi bi-exclamation-circle"></i> {{ error }}</p> }
    @if (ok) { <p class="form-ok"><i class="bi bi-check-circle"></i> {{ ok }}</p> }

    @if (!form) {
      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-ui-checks-grid"></i></span>
          <div>
            <h2>Job application forms</h2>
            <p>Pick a premade form, create it in one click, then preview how it looks on the website or in an embed. Applications land in <a routerLink="/hiring/applications">Hiring</a>.</p>
          </div>
        </header>
        <div class="settings-card-body">
          <h3 class="settings-subhead fb-first">Start a new form</h3>
          <div class="fb-template-filters" role="tablist" aria-label="Template groups">
            @for (group of templateGroups; track group.key) {
              <button type="button" class="fb-template-filter" [class.is-active]="templateGroup === group.key" (click)="templateGroup = group.key">{{ group.label }}</button>
            }
          </div>
          <div class="fb-templates">
            @for (item of visibleTemplates; track item.key) {
              <button type="button" class="fb-template" [class.is-picked]="template === item.key" (click)="pickTemplate(item.key)">
                <span class="fb-template-ico"><i class="bi" [class]="item.icon || 'bi-ui-checks'"></i></span>
                <strong>{{ item.name }}</strong>
                <small>{{ item.description }}</small>
                <span>{{ item.fields.length }} fields</span>
              </button>
            }
          </div>
          @if (pickedTemplate; as pack) {
            <div class="fb-template-peek">
              <div>
                <strong>{{ pack.name }}</strong>
                <p>{{ pack.title || pack.name }} — {{ pack.description }}</p>
              </div>
              <ul>
                @for (label of pack.fields; track label) {
                  <li>{{ label }}</li>
                }
              </ul>
            </div>
          }
          <form class="fb-new" (ngSubmit)="create()">
            <div>
              <label for="new-form">Form name</label>
              <input id="new-form" name="formName" [(ngModel)]="formName" maxlength="80" [placeholder]="templateName">
            </div>
            <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-plus-lg"></i> Create form</button>
          </form>
        </div>
      </section>

      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-collection"></i></span>
          <div>
            <h2>Your forms</h2>
            <p>{{ forms.length }} form{{ forms.length === 1 ? '' : 's' }} — preview drafts and published forms as a full page or iframe embed</p>
          </div>
        </header>
        <div class="settings-card-body">
          @if (!forms.length) {
            <p class="muted">No forms yet. Pick a template above to start.</p>
          } @else {
            <table class="seq-table">
              <thead>
                <tr><th>Form</th><th>Status</th><th>Fields</th><th>Applications</th><th>Updated</th><th></th></tr>
              </thead>
              <tbody>
                @for (row of forms; track row.id) {
                  <tr>
                    <td>
                      <strong>{{ row.name }}</strong>
                      <span class="cell-sub">{{ row.path }}</span>
                    </td>
                    <td><span class="pill" [class.ok]="row.status === 'published'" [class.warn]="row.status === 'draft'" [class.bad]="row.status === 'archived'">{{ statusLabel(row.status) }}</span></td>
                    <td>{{ row.fieldCount }}</td>
                    <td>{{ row.submissions }}</td>
                    <td class="muted">{{ day(row.updatedAt) }}</td>
                    <td>
                      <div class="row-actions">
                        <button type="button" class="btn btn-ghost btn-sm" (click)="open(row.id)"><i class="bi bi-pencil"></i> Edit</button>
                        <button type="button" class="btn btn-ghost btn-sm" (click)="duplicate(row.id)" [disabled]="busy"><i class="bi bi-copy"></i> Duplicate</button>
                        @if (row.status !== 'archived') {
                          <button type="button" class="btn btn-ghost btn-sm" (click)="showListPreview(row)"><i class="bi bi-eye"></i> Preview</button>
                          <a class="btn btn-ghost btn-sm" [href]="openHref(row)" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> {{ row.status === 'published' ? 'Open' : 'New tab' }}</a>
                        }
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </section>

      @if (listPreview; as preview) {
        <div class="fb-preview-modal" role="dialog" aria-modal="true" aria-labelledby="fb-preview-title" (click)="closeListPreview()">
          <div class="fb-preview-dialog" (click)="$event.stopPropagation()">
            <header class="fb-preview-head">
              <div>
                <h2 id="fb-preview-title">{{ preview.name }}</h2>
                <p>See how applicants will see this on the website or inside an iframe embed.</p>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" (click)="closeListPreview()" aria-label="Close preview"><i class="bi bi-x-lg"></i></button>
            </header>
            <div class="fb-preview-toolbar">
              <div class="fb-choice" role="radiogroup" aria-label="Preview layout">
                <label class="check"><input type="radio" name="listEmbed" value="form" [(ngModel)]="listEmbedMode"> Form only (iframe)</label>
                <label class="check"><input type="radio" name="listEmbed" value="page" [(ngModel)]="listEmbedMode"> Full website page</label>
              </div>
              <div class="fb-devices" role="group" aria-label="Preview size">
                @for (item of devices; track item.key) {
                  <button type="button" [class.is-active]="listDevice === item.key" (click)="listDevice = item.key"><i class="bi" [class]="item.icon"></i> {{ item.label }}</button>
                }
              </div>
              <a class="btn btn-ghost btn-sm" [href]="listPreviewHref" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> Open in new tab</a>
            </div>
            <div class="fb-live-preview fb-list-preview" [attr.data-device]="listDevice">
              <iframe [src]="listPreviewUrl" [title]="preview.name + ' preview'" loading="lazy"></iframe>
            </div>
            <p class="fb-hint">Form-only matches the embed code on a careers page. Full page matches the public /apply link with the side panel.</p>
          </div>
        </div>
      }
    } @else {
      <div class="fb-top">
        <button type="button" class="btn btn-ghost btn-sm" (click)="close()"><i class="bi bi-arrow-left"></i> All forms</button>
        @if (dirty) { <span class="pill warn">Unsaved changes</span> }
      </div>

      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-ui-checks-grid"></i></span>
          <div>
            <h2>{{ form.name || 'Untitled form' }}</h2>
            <p>{{ form.submissions }} application{{ form.submissions === 1 ? '' : 's' }} · {{ fieldCount }} field{{ fieldCount === 1 ? '' : 's' }}</p>
          </div>
          <span class="pill fb-head-pill" [class.ok]="form.status === 'published'" [class.warn]="form.status === 'draft'" [class.bad]="form.status === 'archived'">{{ statusLabel(form.status) }}</span>
        </header>
        <div class="settings-card-body">
          <div class="field-grid">
            <div><label for="fb-name">Form name</label><input id="fb-name" name="name" [(ngModel)]="form.name" maxlength="80"></div>
            <div>
              <label for="fb-slug">Public address</label>
              <div class="fb-slug"><span>/apply/</span><input id="fb-slug" name="slug" [(ngModel)]="form.slug" maxlength="60" (blur)="form.slug = cleanSlug(form.slug)"></div>
            </div>
            <div>
              <label for="fb-status">Status</label>
              <select id="fb-status" name="status" [(ngModel)]="form.status">
                <option value="draft">Draft: only you can see it</option>
                <option value="published">Published: anyone with the link can apply</option>
                <option value="archived">Archived: closed to new applications</option>
              </select>
            </div>
            <div>
              <label for="fb-url">Public link</label>
              <div class="copy-row">
                <input id="fb-url" [value]="publicUrl" readonly>
                <button type="button" class="btn btn-ghost btn-sm" (click)="copy(publicUrl, 'Link copied.')"><i class="bi bi-clipboard"></i> Copy</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-grid-1x2"></i></span>
          <div>
            <h2>Fields</h2>
            <p>Add fields from the left, arrange them on the canvas, and change the selected field on the right. Full name and email stay on every form.</p>
          </div>
        </header>
        <div class="settings-card-body">
          <div class="fb-builder">
            <aside class="fb-palette" aria-label="Add a field">
              @for (group of palette; track group.title) {
                <p class="fb-label">{{ group.title }}</p>
                <div class="fb-palette-list">
                  @for (type of group.types; track type) {
                    <button type="button" class="fb-add" (click)="addField(type)"><i class="bi" [class]="icon(type)"></i> {{ typeLabel(type) }}</button>
                  }
                </div>
              }
              @if (!hasField('role')) {
                <p class="fb-label">Shortcuts</p>
                <div class="fb-palette-list">
                  <button type="button" class="fb-add" (click)="addJobList()"><i class="bi bi-briefcase"></i> Open jobs list</button>
                </div>
              }
            </aside>

            <div class="fb-canvas-wrap">
              <div class="fb-canvas-bar">
                <div class="fb-builder-tabs" role="tablist" aria-label="Builder view">
                  <button type="button" role="tab" [class.is-active]="builderTab === 'build'" [attr.aria-selected]="builderTab === 'build'" (click)="builderTab = 'build'"><i class="bi bi-grid-1x2"></i> Build</button>
                  <button type="button" role="tab" [class.is-active]="builderTab === 'preview'" [attr.aria-selected]="builderTab === 'preview'" (click)="builderTab = 'preview'"><i class="bi bi-eye"></i> Preview</button>
                </div>
                @if (builderTab === 'preview') {
                  <div class="fb-choice fb-preview-modes" role="radiogroup" aria-label="Preview layout">
                    <label class="check"><input type="radio" name="embedModePreview" value="form" [(ngModel)]="embedMode"> Form only</label>
                    <label class="check"><input type="radio" name="embedModePreview" value="page" [(ngModel)]="embedMode"> Full page</label>
                  </div>
                }
                <div class="fb-devices" role="group" aria-label="Preview size">
                  @for (item of devices; track item.key) {
                    <button type="button" [class.is-active]="device === item.key" (click)="device = item.key" [attr.aria-pressed]="device === item.key"><i class="bi" [class]="item.icon"></i> {{ item.label }}</button>
                  }
                </div>
              </div>
              @if (builderTab === 'preview' && canLivePreview) {
                <div class="fb-live-preview" [attr.data-device]="device">
                  <iframe [src]="livePreviewUrl" [title]="form.name + ' preview'" loading="lazy"></iframe>
                </div>
                <p class="fb-hint">
                  @if (dirty) { Save the form to refresh this preview with your latest fields and wording. }
                  @else if (embedMode === 'form') { Iframe / embed preview — how the form looks inside a website careers page. }
                  @else if (form.status === 'published') { Full website page preview. Applicants use {{ publicUrl }}. }
                  @else { Full website page preview of the saved draft. Publish when you are ready for applicants. }
                </p>
              } @else if (builderTab === 'preview') {
                <p class="banner warn"><i class="bi bi-info-circle"></i> Save the form once to preview it as applicants will see it. Archived forms cannot be previewed until you set them back to draft or published.</p>
              }
              <div class="fb-canvas" [class.is-preview-note]="builderTab === 'preview'" [attr.data-device]="device" [hidden]="builderTab === 'preview' && canLivePreview">
                @for (field of form.fields; track field.key; let index = $index, first = $first, last = $last) {
                  <div class="fb-field" role="button" tabindex="0" [attr.data-width]="field.width" [class.is-selected]="selected === field.key" [class.is-layout]="isLayout(field)" (click)="select(field.key)" (keydown.enter)="select(field.key)">
                    <div class="fb-field-top">
                      <span class="fb-field-title">
                        <i class="bi" [class]="icon(field.type)"></i>
                        <strong>{{ field.label }}</strong>@if (field.required) { <em aria-label="required">*</em> }
                      </span>
                      <span class="fb-field-tools">
                        <button type="button" (click)="move(index, -1, $event)" [disabled]="first" aria-label="Move up"><i class="bi bi-arrow-up"></i></button>
                        <button type="button" (click)="move(index, 1, $event)" [disabled]="last" aria-label="Move down"><i class="bi bi-arrow-down"></i></button>
                        @if (!field.locked) {
                          <button type="button" (click)="duplicateField(index, $event)" aria-label="Copy field"><i class="bi bi-copy"></i></button>
                          <button type="button" class="is-danger" (click)="removeField(index, $event)" aria-label="Remove field"><i class="bi bi-trash"></i></button>
                        }
                      </span>
                    </div>
                    <div class="fb-field-meta">
                      <span>{{ typeLabel(field.type) }}</span>
                      @if (!isLayout(field)) { <span>{{ widthLabel(field.width) }}</span> }
                      @if (field.map && field.map !== 'custom') { <span class="is-map">{{ mapLabel(field.map) }}</span> }
                      @if (field.source === 'jobs') { <span class="is-map">Open jobs</span> }
                      @if (field.showWhen) { <span class="is-logic"><i class="bi bi-diagram-2"></i> Shown when {{ parentLabel(field) }}</span> }
                      @if (field.locked) { <span><i class="bi bi-lock"></i> Always on</span> }
                    </div>
                    @if (!isLayout(field)) { <div class="fb-width-bar"><span></span></div> }
                  </div>
                }
              </div>
            </div>

            <aside class="fb-settings" aria-label="Field settings">
              @if (current; as field) {
                <p class="fb-label">Field settings</p>
                <label for="fs-label">{{ field.type === 'paragraph' ? 'Text' : field.type === 'terms' ? 'What they agree to' : 'Label' }}</label>
                @if (field.type === 'paragraph' || field.type === 'terms' || field.type === 'question') {
                  <textarea id="fs-label" rows="3" [(ngModel)]="field.label" maxlength="300"></textarea>
                } @else {
                  <input id="fs-label" [(ngModel)]="field.label" maxlength="300">
                }

                <label for="fs-type">Type</label>
                <select id="fs-type" [ngModel]="field.type" (ngModelChange)="changeType(field, $event)" [disabled]="!!field.locked">
                  @for (group of palette; track group.title) {
                    <optgroup [label]="group.title">
                      @for (type of group.types; track type) { <option [value]="type">{{ typeLabel(type) }}</option> }
                    </optgroup>
                  }
                </select>

                @if (field.type === 'question') {
                  <label for="fs-mode">Answer with</label>
                  <select id="fs-mode" [(ngModel)]="field.answerMode" (ngModelChange)="ensureOptions(field)">
                    <option value="radio">One choice (buttons)</option>
                    <option value="select">One choice (dropdown)</option>
                    <option value="text">Short text</option>
                    <option value="textarea">Long text</option>
                  </select>
                }

                @if (field.type === 'select' && !field.locked) {
                  <label class="check"><input type="checkbox" [ngModel]="field.source === 'jobs'" (ngModelChange)="setJobs(field, $event)"> Fill with the open jobs</label>
                  @if (field.source === 'jobs') { <p class="fb-hint">Shows the open jobs of this outlet. When none are open, visitors type the job instead.</p> }
                }

                @if (needsOptions(field)) {
                  <label for="fs-options">Choices, one per line</label>
                  <textarea id="fs-options" rows="5" [ngModel]="field.options.join('\\n')" (ngModelChange)="setOptions(field, $event)"></textarea>
                }

                @if (field.type === 'question' && (field.answerMode === 'radio' || field.answerMode === 'select')) {
                  <label class="check"><input type="checkbox" [(ngModel)]="field.allowOther"> Add an "Other" choice with a text box</label>
                }

                @if (hasPlaceholder(field)) {
                  <label for="fs-placeholder">Placeholder</label>
                  <input id="fs-placeholder" [(ngModel)]="field.placeholder" maxlength="300">
                }

                @if (field.type !== 'paragraph') {
                  <label for="fs-help">Help text</label>
                  <input id="fs-help" [(ngModel)]="field.help" maxlength="300" placeholder="Shown under the field">
                }

                @if (field.type === 'file') {
                  <fieldset class="fb-fieldset">
                    <legend>Files allowed</legend>
                    @for (kind of kinds; track kind) {
                      <label class="check"><input type="checkbox" [checked]="field.accept.includes(kind)" (change)="toggleKind(field, kind)"> {{ kindLabel(kind) }}</label>
                    }
                  </fieldset>
                  <label for="fs-max">Most files</label>
                  <input id="fs-max" type="number" min="1" max="5" [(ngModel)]="field.maxFiles">
                  <p class="fb-hint">Each file up to 5 MB, 12 MB in total per application.</p>
                }

                @if (!isLayout(field)) {
                  <label for="fs-width">Width on desktop</label>
                  <select id="fs-width" [(ngModel)]="field.width">
                    @for (width of widths; track width) { <option [value]="width">{{ widthLabel(width) }}</option> }
                  </select>
                  <p class="fb-hint">Phones always show one field per row.</p>

                  @if (!field.locked) {
                    <label for="fs-map">Saves to</label>
                    <select id="fs-map" [ngModel]="field.map || 'custom'" (ngModelChange)="field.map = $event">
                      @for (map of mapsFor(field); track map) { <option [value]="map">{{ mapLabel(map) }}</option> }
                    </select>
                  }

                  <label for="fs-key">Field name</label>
                  <input id="fs-key" [ngModel]="field.key" (change)="rename(field, $any($event.target).value)" [disabled]="!!field.locked" maxlength="32">
                  <p class="fb-hint">Lowercase letters, numbers and underscores. Used in exports.</p>

                  <label class="check"><input type="checkbox" [(ngModel)]="field.required" [disabled]="!!field.locked"> Required</label>
                }

                @if (!field.locked) {
                  <fieldset class="fb-fieldset">
                    <legend>Show this field</legend>
                    <select [ngModel]="field.showWhen?.field || ''" (ngModelChange)="setParent(field, $event)" aria-label="Show when">
                      <option value="">Always</option>
                      @for (parent of parentsFor(field); track parent.key) { <option [value]="parent.key">When "{{ short(parent.label) }}"…</option> }
                    </select>
                    @if (field.showWhen; as rule) {
                      <select [(ngModel)]="rule.op" aria-label="Condition">
                        @for (op of opsFor(rule.field); track op) { <option [value]="op">{{ opLabel(op) }}</option> }
                      </select>
                      @if (rule.op === 'equals' || rule.op === 'not_equals') {
                        @for (option of parentOptions(rule.field); track option) {
                          <label class="check"><input type="checkbox" [checked]="rule.values.includes(option)" (change)="toggleValue(rule, option)"> {{ option }}</label>
                        }
                        @if (!parentOptions(rule.field).length) { <p class="fb-hint">Add choices to that field first.</p> }
                      }
                    }
                  </fieldset>
                }
              } @else {
                <p class="fb-label">Field settings</p>
                <p class="muted">Select a field on the canvas to change it.</p>
              }
            </aside>
          </div>
        </div>
      </section>

      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-layout-text-sidebar"></i></span>
          <div>
            <h2>Page text</h2>
            <p>The heading and button on the form, and the side panel shown on the full page.</p>
          </div>
        </header>
        <div class="settings-card-body">
          <div class="field-grid">
            <div><label for="fb-title">Heading</label><input id="fb-title" [(ngModel)]="form.title" maxlength="120"></div>
            <div><label for="fb-button">Button label</label><input id="fb-button" [(ngModel)]="form.submitLabel" maxlength="40"></div>
            <div class="span-2"><label for="fb-intro">Introduction</label><textarea id="fb-intro" rows="2" [(ngModel)]="form.intro" maxlength="1200"></textarea></div>
          </div>
          <h3 class="settings-subhead">Side panel on the full page</h3>
          <div class="fb-choice" role="radiogroup" aria-label="Side panel text">
            <label class="check"><input type="radio" name="aside" [value]="false" [(ngModel)]="form.settings.aside.custom"> Standard text</label>
            <label class="check"><input type="radio" name="aside" [value]="true" [(ngModel)]="form.settings.aside.custom"> Write my own</label>
          </div>
          @if (form.settings.aside.custom) {
            <div class="field-grid fb-aside">
              <div><label for="as-kicker">Small line above</label><input id="as-kicker" [(ngModel)]="form.settings.aside.kicker" [placeholder]="form.standardAside.kicker" maxlength="80"></div>
              <div><label for="as-title">Heading</label><input id="as-title" [(ngModel)]="form.settings.aside.title" [placeholder]="form.standardAside.title" maxlength="120"></div>
              <div class="span-2"><label for="as-lead">Text</label><textarea id="as-lead" rows="2" [(ngModel)]="form.settings.aside.lead" [placeholder]="form.standardAside.lead" maxlength="400"></textarea></div>
              @for (step of form.settings.aside.steps; track $index; let index = $index) {
                <div><label [for]="'as-step-' + index">Step {{ index + 1 }}</label><input [id]="'as-step-' + index" [(ngModel)]="step.title" [placeholder]="stepHint(index, 'title')" maxlength="80"></div>
                <div><label [for]="'as-body-' + index">Step {{ index + 1 }} text</label><input [id]="'as-body-' + index" [(ngModel)]="step.body" [placeholder]="stepHint(index, 'body')" maxlength="200"></div>
              }
            </div>
            <p class="fb-hint">Empty boxes use the standard text shown in grey.</p>
          } @else {
            <div class="fb-aside-preview">
              <small>{{ form.standardAside.kicker }}</small>
              <strong>{{ form.standardAside.title }}</strong>
              <p>{{ form.standardAside.lead }}</p>
            </div>
          }
        </div>
      </section>

      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-send-check"></i></span>
          <div>
            <h2>After sending</h2>
            <p>What the applicant sees and who hears about it.</p>
          </div>
        </header>
        <div class="settings-card-body">
          <div class="field-grid">
            <div class="span-2"><label for="fb-thanks">Thank-you message</label><input id="fb-thanks" [(ngModel)]="form.thanks" maxlength="600"></div>
            <div><label for="fb-redirect">Or send them to a page</label><input id="fb-redirect" [(ngModel)]="form.settings.redirectUrl" placeholder="https://yourcompany.com/thank-you" maxlength="500"></div>
            <div><label for="fb-notify">Email new applications to</label><input id="fb-notify" [(ngModel)]="notifyText" placeholder="hr@yourcompany.com, lead@yourcompany.com"></div>
          </div>
          <label class="check"><input type="checkbox" [(ngModel)]="form.settings.showLogo"> Show the company logo above the form</label>
        </div>
      </section>

      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-code-slash"></i></span>
          <div>
            <h2>Public link and embed</h2>
            <p>Paste the code into any website: WordPress, Wix, Webflow, Shopify or plain HTML. The form resizes itself and follows the site's light or dark background.</p>
          </div>
        </header>
        <div class="settings-card-body">
          @if (form.status !== 'published') { <p class="banner warn"><i class="bi bi-info-circle"></i> Publish the form before you embed it on a public website. Draft and archived forms stay private; use Preview while you configure.</p> }
          <div class="fb-choice" role="radiogroup" aria-label="Embed type">
            <label class="check"><input type="radio" name="embedMode" value="form" [(ngModel)]="embedMode"> Form only (fits inside your page)</label>
            <label class="check"><input type="radio" name="embedMode" value="page" [(ngModel)]="embedMode"> Full page (form with the side panel)</label>
          </div>
          <label for="fb-embed">Embed code</label>
          <textarea id="fb-embed" class="mono" rows="6" [value]="embedCode" readonly></textarea>
          <div class="settings-inline-save">
            <button type="button" class="btn btn-ghost btn-sm" (click)="copy(embedCode, 'Embed code copied.')"><i class="bi bi-clipboard"></i> Copy embed code</button>
            <a class="btn btn-ghost btn-sm" [href]="staffPreviewHref" target="_blank" rel="noopener"><i class="bi bi-eye"></i> Preview {{ embedMode === 'form' ? 'form only' : 'full page' }}</a>
          </div>
          <p class="fb-hint">Ad and campaign tags on your page (utm_source, gclid, fbclid) are passed into the form, so you can see in Hiring where each applicant came from.</p>
        </div>
      </section>

      <div class="fb-savebar">
        <button class="btn btn-gold" type="button" (click)="save()" [disabled]="busy"><i class="bi bi-check2"></i> {{ busy ? 'Saving…' : 'Save form' }}</button>
        @if (form.status !== 'published') {
          <button class="btn" type="button" (click)="save('published')" [disabled]="busy"><i class="bi bi-globe"></i> Save and publish</button>
        }
        <a class="btn btn-ghost" [href]="openFormHref" target="_blank" rel="noopener"><i class="bi bi-box-arrow-up-right"></i> {{ form.status === 'published' ? 'Open form' : 'Preview form' }}</a>
        <span class="fb-savebar-gap"></span>
        <button class="btn btn-ghost" type="button" (click)="duplicate(form.id)" [disabled]="busy"><i class="bi bi-copy"></i> Duplicate</button>
        <button class="btn btn-ghost" type="button" (click)="remove()" [disabled]="busy"><i class="bi bi-archive"></i> {{ form.submissions ? 'Archive' : 'Delete' }}</button>
      </div>

      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-inboxes"></i></span>
          <div>
            <h2>Applications</h2>
            <p>{{ form.submissions }} received on this form</p>
          </div>
        </header>
        <div class="settings-card-body">
          @if (!rows.length) {
            <p class="muted">No applications yet.</p>
          } @else {
            <table class="seq-table">
              <thead>
                <tr><th>Applicant</th><th>Job</th><th>Came from</th><th>Status</th><th>Received</th></tr>
              </thead>
              <tbody>
                @for (row of rows; track row.id) {
                  <tr>
                    <td>
                      <a [routerLink]="['/hiring/applications', row.id]"><strong>{{ row.name }}</strong></a>
                      <span class="cell-sub">{{ row.email }}@if (row.phone) { · {{ row.phone }} }@if (row.files) { · <i class="bi bi-paperclip"></i> {{ row.files }} }</span>
                    </td>
                    <td>{{ row.jobTitle || '—' }}</td>
                    <td class="muted">{{ row.source }}</td>
                    <td><span class="pill">{{ row.status }}</span></td>
                    <td class="muted">{{ when(row.createdAt) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      </section>
    }
  `,
})
export class SettingsFormsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly sanitizer = inject(DomSanitizer);
  readonly palette = PALETTE;
  readonly widths = Object.keys(WIDTH_LABELS) as FieldWidth[];
  readonly kinds = Object.keys(KIND_LABELS) as FileKind[];
  readonly devices: Array<{ key: Device; label: string; icon: string }> = [
    { key: 'desktop', label: 'Desktop', icon: 'bi-display' },
    { key: 'tablet', label: 'Tablet', icon: 'bi-tablet' },
    { key: 'mobile', label: 'Mobile', icon: 'bi-phone' },
  ];
  readonly isLayout = isLayout;
  readonly needsOptions = needsOptions;
  forms: FormSummary[] = [];
  templates: Template[] = [];
  template = 'standard';
  templateGroup: 'all' | 'general' | 'campus' | 'specialist' | 'event' = 'all';
  readonly templateGroups: Array<{ key: 'all' | 'general' | 'campus' | 'specialist' | 'event'; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'general', label: 'General' },
    { key: 'campus', label: 'Campus' },
    { key: 'specialist', label: 'Specialist' },
    { key: 'event', label: 'Events' },
  ];
  form: FormDetail | null = null;
  rows: SubmissionRow[] = [];
  selected = '';
  device: Device = 'desktop';
  builderTab: 'build' | 'preview' = 'build';
  embedMode: 'form' | 'page' = 'form';
  listPreview: FormSummary | null = null;
  listEmbedMode: 'form' | 'page' = 'form';
  listDevice: Device = 'desktop';
  notifyText = '';
  formName = '';
  error = '';
  ok = '';
  busy = false;
  private snapshot = '';

  get templateName(): string {
    return this.templates.find((item) => item.key === this.template)?.name || 'Careers';
  }

  get visibleTemplates(): Template[] {
    if (this.templateGroup === 'all') return this.templates;
    return this.templates.filter((item) => (item.group || 'general') === this.templateGroup);
  }

  get pickedTemplate(): Template | null {
    return this.templates.find((item) => item.key === this.template) || null;
  }

  get listPreviewHref(): string {
    if (!this.listPreview) return '#';
    if (this.listPreview.status === 'published') {
      return (this.listPreview.path || '/apply/' + this.listPreview.slug) + '?embed=' + (this.listEmbedMode === 'form' ? '1' : 'page');
    }
    return location.origin + '/form-preview/' + this.listPreview.id + '?embed=' + (this.listEmbedMode === 'form' ? '1' : 'page');
  }

  get listPreviewUrl(): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.listPreviewHref);
  }

  get current(): FormFieldDef | null {
    return this.form?.fields.find((field) => field.key === this.selected) || null;
  }

  get fieldCount(): number {
    return this.form ? this.form.fields.filter((field) => !isLayout(field)).length : 0;
  }

  get dirty(): boolean {
    return !!this.form && this.state() !== this.snapshot;
  }

  get publicUrl(): string {
    return this.form ? location.origin + '/apply/' + this.form.slug : '';
  }

  get embedPreview(): string {
    return this.publicUrl + '?embed=' + (this.embedMode === 'form' ? '1' : 'page');
  }

  /** Full-page open/preview link for the save bar. */
  get openFormHref(): string {
    if (!this.form) return '#';
    if (this.form.status === 'published') return this.form.path || '/apply/' + this.form.slug;
    return '/form-preview/' + this.form.id;
  }

  /** Embed-style staff preview — works for draft and published (saved) forms. */
  get staffPreviewHref(): string {
    if (!this.form) return '#';
    if (this.form.status === 'published') return this.embedPreview;
    return location.origin + '/form-preview/' + this.form.id + '?embed=' + (this.embedMode === 'form' ? '1' : 'page');
  }

  /** Saved draft or published form can load a full applicant preview. */
  get canLivePreview(): boolean {
    if (!this.form || this.form.status === 'archived') return false;
    return !!this.form.id && !!this.cleanSlug(this.form.slug);
  }

  get livePreviewUrl(): SafeResourceUrl {
    const href = this.form?.status === 'published'
      ? this.embedPreview
      : location.origin + '/form-preview/' + this.form!.id + '?embed=' + (this.embedMode === 'form' ? '1' : 'page');
    return this.sanitizer.bypassSecurityTrustResourceUrl(href);
  }

  openHref(row: FormSummary): string {
    if (row.status === 'published') return row.path;
    return '/form-preview/' + row.id;
  }

  pickTemplate(key: string): void {
    this.template = key;
    if (!this.formName.trim()) this.formName = this.templates.find((item) => item.key === key)?.name || '';
  }

  showListPreview(row: FormSummary): void {
    this.listPreview = row;
    this.listEmbedMode = 'form';
    this.listDevice = 'desktop';
  }

  closeListPreview(): void {
    this.listPreview = null;
  }

  /** Same message protocol as the Altamid CRM embed, with HRMS names so both can sit on one site. */
  get embedCode(): string {
    if (!this.form) return '';
    const id = 'altamid-hrms-' + this.form.slug;
    const src = this.embedPreview;
    const title = this.form.name.replace(/[<>"&]/g, '');
    const frame = this.embedMode === 'form'
      ? `<iframe id="${id}" src="${src}" title="${title}" style="width:100%;max-width:100%;min-width:0;height:640px;border:0;overflow:hidden;background:transparent;display:block" allowtransparency="true" loading="lazy"></iframe>`
      : `<iframe id="${id}" src="${src}" title="${title}" style="width:100%;min-height:900px;border:0;overflow:hidden;display:block" loading="lazy"></iframe>`;
    const script = '<script>(function(){var f=document.getElementById(' + JSON.stringify(id) + ');if(!f)return;'
      + 'var keys=["utm_source","utm_medium","utm_campaign","utm_content","utm_term","gclid","gbraid","wbraid","fbclid"];'
      + 'function safe(v){v=String(v||"").trim();return /^[A-Za-z0-9._:\\-]{1,160}$/.test(v)?v:"";}'
      + 'try{var q=new URLSearchParams(location.search);var s=new URL(f.src,location.href);var ch=false;keys.forEach(function(k){var v=safe(q.get(k));if(v&&!s.searchParams.get(k)){s.searchParams.set(k,v);ch=true;}});'
      + 'if(!s.searchParams.get("landing_page")){s.searchParams.set("landing_page",location.href.split("#")[0].slice(0,500));ch=true;}if(ch)f.src=s.toString();}catch(e){}'
      + 'var origin="";try{origin=new URL(f.src,location.href).origin;}catch(e){}'
      + 'window.addEventListener("message",function(e){if(e.source!==f.contentWindow||!e.data||e.data.source!=="altamid-hrms-form")return;'
      + 'if(e.data.type==="resize"&&e.data.height){f.style.height=Math.max(160,Math.ceil(e.data.height))+"px";}'
      + 'if(e.data.type==="scroll"){var r=f.getBoundingClientRect();if(r.top<0||r.top>innerHeight)window.scrollTo({top:scrollY+r.top-24,behavior:"smooth"});}'
      + 'if(e.data.type==="redirect"&&/^https:\\/\\//.test(String(e.data.url||""))){location.href=e.data.url;}});'
      + 'function dark(){var el=f.parentElement;while(el){var m=/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?/.exec(getComputedStyle(el).backgroundColor||"");'
      + 'if(m){var a=m[4]===undefined?1:parseFloat(m[4]);if(a>=0.35)return (0.2126*m[1]+0.7152*m[2]+0.0722*m[3])/255<0.5;}el=el.parentElement;}return false;}'
      + 'function theme(){if(f.contentWindow&&origin)f.contentWindow.postMessage({source:"altamid-hrms-host",type:"theme",dark:dark()},origin);}'
      + 'f.addEventListener("load",theme);setInterval(theme,2000);'
      + 'window.addEventListener("resize",function(){if(f.contentWindow&&origin)f.contentWindow.postMessage({source:"altamid-hrms-host",type:"ping"},origin);});'
      + '})();</' + 'script>';
    return frame + '\n' + script;
  }

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  @HostListener('window:beforeunload', ['$event'])
  guard(event: BeforeUnloadEvent): void {
    if (this.dirty) event.preventDefault();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.listPreview) this.closeListPreview();
  }

  async create(): Promise<void> {
    this.busy = true;
    this.clear();
    try {
      const form = await this.api.post<FormDetail>('/v1/forms', { name: this.formName.trim() || this.templateName, template: this.template });
      this.formName = '';
      this.load(form, []);
      this.ok = 'Form created. Change the fields, then publish it.';
    } catch (error) {
      this.error = this.message(error, 'Could not create the form.');
    } finally {
      this.busy = false;
    }
  }

  async open(id: string): Promise<void> {
    this.clear();
    try {
      const [form, pack] = await Promise.all([
        this.api.get<FormDetail>('/v1/forms/' + id),
        this.api.get<{ rows: SubmissionRow[] }>('/v1/forms/' + id + '/submissions'),
      ]);
      this.load(form, pack.rows);
    } catch (error) {
      this.error = this.message(error, 'Could not open that form.');
    }
  }

  async close(): Promise<void> {
    if (this.dirty && !(await this.sweet.confirm({ title: 'Leave without saving?', text: 'Your changes to this form will be lost.', confirmText: 'Leave', danger: true }))) return;
    this.form = null;
    this.rows = [];
    this.selected = '';
    this.clear();
    await this.reload();
  }

  async duplicate(id: string): Promise<void> {
    if (this.form && this.dirty && !(await this.sweet.confirm({ title: 'Duplicate without saving?', text: 'The copy is made from the last saved version.', confirmText: 'Duplicate' }))) return;
    this.busy = true;
    this.clear();
    try {
      const copy = await this.api.post<FormDetail>('/v1/forms/' + id + '/duplicate', {});
      this.load(copy, []);
      this.ok = 'Copy created as a draft. Rename it and change what you need.';
    } catch (error) {
      this.error = this.message(error, 'Could not copy that form.');
    } finally {
      this.busy = false;
    }
  }

  select(key: string): void {
    this.selected = key;
  }

  addField(type: FieldType): void {
    if (!this.form) return;
    const field = this.blank(type);
    const at = this.form.fields.findIndex((item) => item.key === this.selected);
    const fields = [...this.form.fields];
    fields.splice(at < 0 ? fields.length : at + 1, 0, field);
    this.form.fields = fields;
    this.selected = field.key;
  }

  addJobList(): void {
    this.addField('select');
    const field = this.current;
    if (!field) return;
    field.label = 'Job you are applying for';
    field.source = 'jobs';
    field.options = [];
    field.map = 'role';
    field.required = true;
  }

  duplicateField(index: number, event: Event): void {
    event.stopPropagation();
    if (!this.form) return;
    const source = this.form.fields[index];
    const copy: FormFieldDef = { ...structuredClone(source), key: this.uniqueKey(source.key), locked: false, map: 'custom', label: source.label + ' (copy)' };
    const fields = [...this.form.fields];
    fields.splice(index + 1, 0, copy);
    this.form.fields = fields;
    this.selected = copy.key;
  }

  move(index: number, step: number, event: Event): void {
    event.stopPropagation();
    if (!this.form) return;
    const to = index + step;
    if (to < 0 || to >= this.form.fields.length) return;
    const fields = [...this.form.fields];
    [fields[index], fields[to]] = [fields[to], fields[index]];
    this.form.fields = fields;
  }

  removeField(index: number, event: Event): void {
    event.stopPropagation();
    if (!this.form) return;
    const gone = this.form.fields[index];
    this.form.fields = this.form.fields.filter((_, item) => item !== index);
    for (const field of this.form.fields) if (field.showWhen?.field === gone.key) field.showWhen = null;
    if (this.selected === gone.key) this.selected = this.form.fields[Math.min(index, this.form.fields.length - 1)]?.key || '';
  }

  changeType(field: FormFieldDef, type: FieldType): void {
    field.type = type;
    if (type !== 'select') field.source = '';
    if (isLayout(field)) {
      field.required = false;
      field.map = 'custom';
      field.width = 'full';
    }
    if (type === 'file') {
      if (!field.accept.length) field.accept = ['pdf', 'doc'];
      if (!field.maxFiles) field.maxFiles = 1;
    } else {
      field.accept = [];
      field.maxFiles = 0;
    }
    if (field.map === 'resume' && type !== 'file' && type !== 'url') field.map = 'custom';
    this.ensureOptions(field);
    this.dropBrokenRules();
  }

  ensureOptions(field: FormFieldDef): void {
    if (needsOptions(field) && field.options.length < 2) field.options = field.options.length ? [...field.options, 'Option 2'] : ['Option 1', 'Option 2'];
  }

  setJobs(field: FormFieldDef, on: boolean): void {
    field.source = on ? 'jobs' : '';
    if (on && (!field.map || field.map === 'custom') && !this.hasField('role')) field.map = 'role';
    this.ensureOptions(field);
  }

  setOptions(field: FormFieldDef, value: string): void {
    field.options = value.split('\n').map((item) => item.trim()).filter(Boolean).slice(0, 40);
  }

  toggleKind(field: FormFieldDef, kind: FileKind): void {
    const next = field.accept.includes(kind) ? field.accept.filter((item) => item !== kind) : [...field.accept, kind];
    field.accept = next.length ? next : [kind];
  }

  rename(field: FormFieldDef, value: string): void {
    const wanted = value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
    if (!this.form || !wanted || wanted === field.key) return;
    if (this.form.fields.some((item) => item.key === wanted)) {
      this.error = `Another field already uses the name "${wanted}".`;
      return;
    }
    for (const item of this.form.fields) if (item.showWhen?.field === field.key) item.showWhen.field = wanted;
    if (this.selected === field.key) this.selected = wanted;
    field.key = wanted;
  }

  parentsFor(field: FormFieldDef): FormFieldDef[] {
    if (!this.form) return [];
    return this.form.fields.filter((item) => item.key !== field.key && isChoiceParent(item) && !this.dependsOn(item, field.key));
  }

  setParent(field: FormFieldDef, key: string): void {
    if (!key) {
      field.showWhen = null;
      return;
    }
    const ops = this.opsFor(key);
    field.showWhen = { field: key, op: ops[0], values: [] };
  }

  opsFor(key: string): LogicOp[] {
    const parent = this.form?.fields.find((item) => item.key === key);
    if (!parent) return ['equals'];
    return parent.type === 'checkbox' || parent.type === 'terms' ? ['checked', 'unchecked'] : ['equals', 'not_equals'];
  }

  parentOptions(key: string): string[] {
    const parent = this.form?.fields.find((item) => item.key === key);
    if (!parent) return [];
    return parent.source === 'jobs' ? [] : parent.options;
  }

  toggleValue(rule: { values: string[] }, option: string): void {
    rule.values = rule.values.includes(option) ? rule.values.filter((item) => item !== option) : [...rule.values, option];
  }

  parentLabel(field: FormFieldDef): string {
    const rule = field.showWhen;
    const parent = rule ? this.form?.fields.find((item) => item.key === rule.field) : null;
    if (!rule || !parent) return '';
    if (rule.op === 'checked' || rule.op === 'unchecked') return `"${this.short(parent.label)}" ${OP_LABELS[rule.op]}`;
    return `"${this.short(parent.label)}" ${OP_LABELS[rule.op]} ${rule.values.length ? rule.values.join(', ') : 'any answer'}`;
  }

  mapsFor(field: FormFieldDef): string[] {
    const taken = new Set((this.form?.fields || []).filter((item) => item.key !== field.key).map((item) => item.map || 'custom'));
    return ['custom', 'phone', 'city', 'resume', 'role', 'note'].filter((map) => map === 'custom' || map === field.map || !taken.has(map))
      .filter((map) => map !== 'resume' || field.type === 'file' || field.type === 'url');
  }

  hasField(map: string): boolean {
    return !!this.form?.fields.some((field) => field.map === map);
  }

  hasPlaceholder(field: FormFieldDef): boolean {
    return ['text', 'email', 'tel', 'url', 'number', 'textarea', 'select'].includes(field.type)
      || (field.type === 'question' && field.answerMode !== 'radio');
  }

  async save(status?: string): Promise<void> {
    if (!this.form) return;
    this.busy = true;
    this.clear();
    try {
      const saved = await this.api.patch<FormDetail>('/v1/forms/' + this.form.id, {
        name: this.form.name,
        slug: this.cleanSlug(this.form.slug),
        title: this.form.title,
        intro: this.form.intro,
        submitLabel: this.form.submitLabel,
        thanks: this.form.thanks,
        status: status || this.form.status,
        fields: this.form.fields,
        settings: { ...this.form.settings, notify: this.notifyText },
      });
      const keep = this.selected;
      this.load(saved, this.rows);
      this.selected = saved.fields.some((field) => field.key === keep) ? keep : this.selected;
      this.ok = saved.status === 'published' ? 'Form saved and published.' : 'Form saved.';
    } catch (error) {
      this.error = this.message(error, 'Could not save the form.');
    } finally {
      this.busy = false;
    }
  }

  async remove(): Promise<void> {
    if (!this.form) return;
    const archive = this.form.submissions > 0;
    const yes = await this.sweet.confirm({
      title: archive ? 'Archive this form?' : 'Delete this form?',
      text: archive ? 'It stops taking applications. The applications it already has stay in Hiring.' : 'It has no applications, so it is removed for good.',
      confirmText: archive ? 'Archive' : 'Delete',
      danger: true,
    });
    if (!yes) return;
    this.busy = true;
    this.clear();
    try {
      const result = await this.api.post<{ message: string }>('/v1/forms/' + this.form.id + '/delete', {});
      this.form = null;
      this.rows = [];
      this.ok = result.message;
      await this.reload();
    } catch (error) {
      this.error = this.message(error, 'Could not remove the form.');
    } finally {
      this.busy = false;
    }
  }

  async copy(value: string, done: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.ok = done;
      this.error = '';
    } catch {
      this.error = 'Select the text and copy it with Ctrl+C.';
    }
  }

  cleanSlug(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  }

  statusLabel(status: string): string {
    return status === 'published' ? 'Published' : status === 'archived' ? 'Archived' : 'Draft';
  }

  typeLabel(type: FieldType): string { return TYPE_LABELS[type] || type; }
  icon(type: FieldType): string { return TYPE_ICONS[type] || 'bi-input-cursor'; }
  widthLabel(width: FieldWidth): string { return WIDTH_LABELS[width] || width; }
  mapLabel(map: string): string { return MAP_LABELS[map] || map; }
  kindLabel(kind: FileKind): string { return KIND_LABELS[kind]; }
  opLabel(op: LogicOp): string { return OP_LABELS[op]; }
  stepHint(index: number, part: 'title' | 'body'): string {
    const step = this.form?.standardAside.steps[index] as { title: string; body: string } | undefined;
    return step ? step[part] : '';
  }

  short(label: string): string { return label.length > 40 ? label.slice(0, 38) + '…' : label; }

  when(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  day(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private load(form: FormDetail, rows: SubmissionRow[]): void {
    while (form.settings.aside.steps.length < 3) form.settings.aside.steps.push({ title: '', body: '' });
    this.form = form;
    this.rows = rows;
    this.notifyText = form.settings.notify.join(', ');
    if (!form.fields.some((field) => field.key === this.selected)) this.selected = form.fields[0]?.key || '';
    this.snapshot = this.state();
  }

  private state(): string {
    if (!this.form) return '';
    const { name, slug, title, intro, submitLabel, thanks, status, fields, settings } = this.form;
    return JSON.stringify({ name, slug, title, intro, submitLabel, thanks, status, fields, settings, notify: this.notifyText });
  }

  private blank(type: FieldType): FormFieldDef {
    const label = type === 'heading' ? 'Section heading' : type === 'paragraph' ? 'A short note for applicants.' : type === 'terms' ? 'I agree to the terms' : type === 'file' ? 'Attach a file' : 'New ' + TYPE_LABELS[type].toLowerCase();
    const field: FormFieldDef = {
      key: this.uniqueKey(type === 'heading' || type === 'paragraph' ? type : 'field'),
      label, type, required: false, locked: false, options: [], placeholder: '', help: '',
      width: 'full', map: 'custom', source: '', answerMode: 'radio', allowOther: false, showWhen: null,
      accept: type === 'file' ? ['pdf', 'doc'] : [], maxFiles: type === 'file' ? 1 : 0,
    };
    this.ensureOptions(field);
    return field;
  }

  private uniqueKey(base: string): string {
    const root = base.replace(/_\d+$/, '').slice(0, 26) || 'field';
    const taken = new Set((this.form?.fields || []).map((field) => field.key));
    for (let n = 1; n < 500; n += 1) {
      const key = root + '_' + n;
      if (!taken.has(key)) return key;
    }
    return root + '_' + Date.now().toString(36);
  }

  private dependsOn(field: FormFieldDef, key: string, depth = 0): boolean {
    if (!field.showWhen || depth > 10) return false;
    if (field.showWhen.field === key) return true;
    const parent = this.form?.fields.find((item) => item.key === field.showWhen!.field);
    return parent ? this.dependsOn(parent, key, depth + 1) : false;
  }

  private dropBrokenRules(): void {
    if (!this.form) return;
    for (const field of this.form.fields) {
      const parent = field.showWhen ? this.form.fields.find((item) => item.key === field.showWhen!.field) : null;
      if (field.showWhen && (!parent || !isChoiceParent(parent))) field.showWhen = null;
      else if (field.showWhen && parent && !this.opsFor(parent.key).includes(field.showWhen.op)) field.showWhen = { field: parent.key, op: this.opsFor(parent.key)[0], values: [] };
    }
  }

  private clear(): void {
    this.error = '';
    this.ok = '';
  }

  private message(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
  }

  private async reload(): Promise<void> {
    try {
      const pack = await this.api.get<{ forms: FormSummary[]; templates: Template[] }>('/v1/forms');
      this.forms = pack.forms;
      this.templates = pack.templates;
    } catch (error) {
      this.error = this.message(error, 'Could not load forms.');
    }
  }
}
