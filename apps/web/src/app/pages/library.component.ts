import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { Sweet } from '../shared/sweet';
import { RichEditorComponent, RichViewComponent } from '../shared/rich-editor.component';

interface WidgetRow { key: string; label: string; audience: string; visible: boolean }
interface HelpRow { id: string; title: string; body: string; published: boolean; audience?: string; audienceLabel?: string }
interface Handbook { id: string; title: string; version: string; fileName: string; publishedOn: string }
interface StaffDocument { id: string; kind: string; kindLabel: string; title: string; published: boolean; mine: boolean; access: string; sharedOn: string }
interface DocTargets { people: Array<{ id: string; name: string; code: string }>; departments: Array<{ id: string; name: string }>; locations: Array<{ id: string; name: string }> }

type LibraryTab = 'documents' | 'handbook' | 'help' | 'audience';

@Component({
  selector: 'app-library',
  imports: [FormsModule, RouterLink, RichEditorComponent, RichViewComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-journal-text"></i></span>
        <p class="eyebrow">Company</p>
        <h1>Library</h1>
        <p class="lede">{{ tabLede }}</p>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }

    <div class="seg-tabs page-tabs" role="tablist" aria-label="Library sections">
      <button type="button" role="tab" [attr.aria-selected]="tab === 'documents'" [class.is-on]="tab === 'documents'" (click)="setTab('documents')">
        <i class="bi bi-folder2-open"></i> Documents
        @if (documents.length) { <span class="chip">{{ documents.length }}</span> }
      </button>
      @if (canEdit || visible) {
        <button type="button" role="tab" [attr.aria-selected]="tab === 'handbook'" [class.is-on]="tab === 'handbook'" (click)="setTab('handbook')">
          <i class="bi bi-journal-bookmark"></i> Handbook
        </button>
        <button type="button" role="tab" [attr.aria-selected]="tab === 'help'" [class.is-on]="tab === 'help'" (click)="setTab('help')">
          <i class="bi bi-life-preserver"></i> Help
          @if (help.length) { <span class="chip">{{ help.length }}</span> }
        </button>
      }
      @if (canEdit) {
        <button type="button" role="tab" [attr.aria-selected]="tab === 'audience'" [class.is-on]="tab === 'audience'" (click)="setTab('audience')">
          <i class="bi bi-eye"></i> Audience
        </button>
      }
    </div>

    @if (tab === 'audience' && canEdit) {
      <section class="card">
        <h2><i class="bi bi-eye"></i> Who can use these</h2>
        <p class="muted">Everyone, managers, or only the owner and HR. Hidden turns the feature off. To choose which blocks each role, department, or person sees on Home, open <a routerLink="/settings" [queryParams]="{ tab: 'home' }">Settings → Home layouts</a>.</p>
        <form (ngSubmit)="saveWidgets()">
          @for (item of widgets; track item.key) {
            <div class="split">
              <label [for]="'w-' + item.key">{{ item.label }}</label>
              <select [id]="'w-' + item.key" [name]="item.key" [(ngModel)]="item.audience">
                <option value="all">Everyone</option>
                <option value="managers">Managers, HR, and the owner</option>
                <option value="hr">Owner and HR</option>
                <option value="off">Hidden</option>
              </select>
            </div>
          }
          <div class="actions"><button class="btn btn-primary" type="submit" [disabled]="busy">Save who can see this</button></div>
        </form>
      </section>
    }

    @if (tab === 'handbook') {
      @if (canEdit) {
        <section class="card">
          <h2><i class="bi bi-journal-bookmark"></i> Handbook</h2>
          <p class="muted">One current PDF. Publishing a new file keeps the previous one unpublished.</p>
          <form (ngSubmit)="saveHandbook()">
            <div class="split">
              <div><label for="hb-title">Title</label><input id="hb-title" name="title" [(ngModel)]="title" required></div>
              <div><label for="hb-version">Version</label><input id="hb-version" name="version" [(ngModel)]="version" required></div>
            </div>
            <label for="hb-file">PDF</label>
            <input id="hb-file" name="file" type="file" accept="application/pdf" (change)="pickFile($event)" required>
            <div class="actions"><button class="btn btn-primary" type="submit" [disabled]="busy">Publish handbook</button></div>
          </form>
        </section>
      }
      @if (!canEdit && !visible && !documents.length) {
        <section class="card"><h2><i class="bi bi-collection"></i> Library</h2><p class="muted">The handbook and help articles are turned off for your role.</p></section>
      } @else if (handbook) {
        <section class="card">
          <h2>{{ handbook.title }}</h2>
          <p class="muted">Version {{ handbook.version }} · {{ handbook.publishedOn }}</p>
          <div class="actions"><button type="button" class="btn btn-ghost" (click)="openHandbook()"><i class="bi bi-eye"></i> Open the handbook</button></div>
        </section>
      } @else if (!canEdit && visible) {
        <section class="card"><h2><i class="bi bi-journal-bookmark"></i> Handbook</h2><p class="muted">HR has not published a handbook yet.</p></section>
      }
    }

    @if (tab === 'help' && (canEdit || visible)) {
      @if (canEdit) {
        <section class="card">
          <h2><i class="bi bi-question-circle"></i> Help article</h2>
          <form (ngSubmit)="saveHelp()">
            <label for="help-title">Title</label>
            <input id="help-title" name="helpTitle" [(ngModel)]="helpTitle" required>
            <label for="help-who">Who this answer is for</label>
            <select id="help-who" name="helpAudience" [(ngModel)]="helpAudience">
              <option value="all">Everyone</option>
              <option value="employee">Employees</option>
              <option value="managers">Managers</option>
              <option value="staff">Payroll and accounts</option>
              <option value="hr">Owner and HR</option>
            </select>
            <p class="muted rules-hint">An employee only sees answers for everyone and for employees. Managers, payroll, and HR see the answers for their own work. Owner and HR can read every answer.</p>
            <label for="help-body">Answer</label>
            <app-rich-editor inputId="help-body" name="helpBody" label="Answer" placeholder="Explain the answer. Steps work well as a numbered list." [max]="8000" [(ngModel)]="helpBody" required />
            <div class="actions"><button class="btn btn-primary" type="submit" [disabled]="busy">Publish article</button></div>
          </form>
        </section>
      }
      <section class="card">
        <h2><i class="bi bi-life-preserver"></i> Help</h2>
        @if (!help.length) { <p class="muted">No articles yet.</p> }
        @for (item of help; track item.id) {
          <article class="feed-item">
            <div class="row-between">
              <h3>{{ item.title }}</h3>
              @if (item.audienceLabel) { <span class="pill">{{ item.audienceLabel }}</span> }
              @if (canEdit && !item.published) { <span class="pill">Hidden</span> }
              @if (canEdit) { <button type="button" class="btn btn-ghost btn-sm" (click)="removeHelp(item.id)">Remove</button> }
            </div>
            <app-rich-view [value]="item.body" />
          </article>
        }
      </section>
    }

    @if (tab === 'documents') {
      @if (canEdit) {
        <section class="card">
          <h2><i class="bi bi-share"></i> Share a document</h2>
          <p class="muted">Upload the PDF. A letter is opened only by that person, plus the owner and HR. The portal does not write pay figures into the file.</p>
          <form (ngSubmit)="saveDocument()">
            <div class="split">
              <div>
                <label for="doc-kind">Kind</label>
                <select id="doc-kind" name="docKind" [(ngModel)]="docKind" (ngModelChange)="kindChanged()">
                  @for (item of kinds; track item.key) { <option [value]="item.key">{{ item.label }}</option> }
                </select>
              </div>
              <div>
                <label for="doc-title">Title</label>
                <input id="doc-title" name="docTitle" [(ngModel)]="docTitle" required>
              </div>
            </div>
            @if (!personal) {
              <label for="doc-who">Who can open it</label>
              <select id="doc-who" name="docAudience" [(ngModel)]="docAudience">
                <option value="all">Everyone</option>
                <option value="person">One person</option>
                <option value="department">One department</option>
                <option value="location">One location</option>
                <option value="managers">Managers, HR, and the owner</option>
                <option value="hr">Owner and HR</option>
              </select>
            }
            @if (personal || docAudience === 'person') {
              <label for="doc-person">Person</label>
              <select id="doc-person" name="docPerson" [(ngModel)]="docPerson">
                <option value="">Choose a person</option>
                @for (person of targets.people; track person.id) { <option [value]="person.id">{{ person.name }} · {{ person.code }}</option> }
              </select>
            }
            @if (!personal && docAudience === 'department') {
              <label for="doc-dept">Department</label>
              <select id="doc-dept" name="docDepartment" [(ngModel)]="docDepartment">
                <option value="">Choose a department</option>
                @for (item of targets.departments; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
              </select>
            }
            @if (!personal && docAudience === 'location') {
              <label for="doc-loc">Location</label>
              <select id="doc-loc" name="docLocation" [(ngModel)]="docLocation">
                <option value="">Choose a location</option>
                @for (item of targets.locations; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
              </select>
            }
            <label for="doc-file">PDF</label>
            <input id="doc-file" name="docFile" type="file" accept="application/pdf" (change)="pickDocument($event)" required>
            <div class="actions"><button class="btn btn-primary" type="submit" [disabled]="busy">Share document</button></div>
          </form>
        </section>
      }
      @if (documents.length || canEdit) {
        <section class="card">
          <div class="row-between">
            <h2><i class="bi bi-folder2-open"></i> Documents</h2>
            <label class="sr" for="doc-filter">Show</label>
            <select id="doc-filter" [(ngModel)]="docFilter">
              <option value="">All</option>
              <option value="mine">Addressed to me</option>
              <option value="offer">Offer letters</option>
              <option value="increment">Increment letters</option>
              <option value="holiday">Holiday lists</option>
              <option value="circular">Circulars</option>
              <option value="handbook">Handbooks</option>
              <option value="policy">Policies</option>
            </select>
          </div>
          @if (!shown.length) { <p class="muted">Nothing in this list yet.</p> }
          @for (item of shown; track item.id) {
            <article class="feed-item">
              <div class="row-between">
                <h3>{{ item.title }}</h3>
                <span class="pill">{{ item.kindLabel }}</span>
              </div>
              <p class="muted">{{ item.access }} · {{ item.sharedOn }}</p>
              <div class="actions">
                <button type="button" class="btn btn-ghost" (click)="openDocument(item.id, item.title, item.access)"><i class="bi bi-eye"></i> Preview</button>
                @if (canEdit) {
                  <button type="button" class="btn btn-ghost" (click)="publishDocument(item)">{{ item.published ? 'Hide' : 'Show' }}</button>
                  <button type="button" class="btn btn-ghost" (click)="removeDocument(item.id)">Remove</button>
                }
              </div>
            </article>
          }
        </section>
      } @else if (!canEdit && !visible) {
        <section class="card"><h2><i class="bi bi-collection"></i> Library</h2><p class="muted">The handbook and help articles are turned off for your role.</p></section>
      }
    }
  `,
})
export class LibraryComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly tabKey = 'altamid.library.tab';
  tab: LibraryTab = 'documents';
  canEdit = false;
  visible = true;
  widgets: WidgetRow[] = [];
  handbook: Handbook | null = null;
  help: HelpRow[] = [];
  documents: StaffDocument[] = [];
  docFilter = '';
  docKind = 'circular';
  docTitle = '';
  docAudience = 'all';
  docPerson = '';
  docDepartment = '';
  docLocation = '';
  docData = '';
  docFileName = '';
  targets: DocTargets = { people: [], departments: [], locations: [] };
  readonly kinds = [
    { key: 'offer', label: 'Offer letter', personal: true },
    { key: 'increment', label: 'Increment letter', personal: true },
    { key: 'appointment', label: 'Appointment letter', personal: true },
    { key: 'holiday', label: 'Holiday list', personal: false },
    { key: 'circular', label: 'Circular', personal: false },
    { key: 'handbook', label: 'Handbook', personal: false },
    { key: 'policy', label: 'Policy', personal: false },
    { key: 'form', label: 'Form', personal: false },
    { key: 'other', label: 'Other document', personal: false },
  ];
  title = 'Employee handbook';
  version = '1';
  helpTitle = '';
  helpBody = '';
  helpAudience = 'all';
  fileData = '';
  error = '';

  get personal(): boolean {
    return this.kinds.some((item) => item.key === this.docKind && item.personal);
  }

  get shown(): StaffDocument[] {
    return this.documents.filter((item) => {
      if (this.docFilter === 'mine') return item.mine;
      if (this.docFilter) return item.kind === this.docFilter;
      return true;
    });
  }

  get tabLede(): string {
    const lines: Record<LibraryTab, string> = {
      documents: 'Offer letters, increment letters, holiday lists, circulars, and shared PDFs.',
      handbook: 'The current employee handbook PDF for everyone who can open it.',
      help: 'Answers to common questions, scoped by role.',
      audience: 'Who can see the handbook, help, and other library features.',
    };
    return lines[this.tab];
  }

  setTab(tab: LibraryTab): void {
    if (tab === 'audience' && !this.canEdit) tab = 'documents';
    if ((tab === 'handbook' || tab === 'help') && !this.canEdit && !this.visible) tab = 'documents';
    this.tab = tab;
    try { sessionStorage.setItem(this.tabKey, tab); } catch { /* ignore */ }
  }

  ok = '';
  busy = false;
  async openHandbook(): Promise<void> {
    try {
      const blob = await this.api.blob('/v1/library/handbook/file');
      await this.sweet.preview({ title: 'Employee handbook', subtitle: 'Handbook', blob });
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not open the handbook.';
    }
  }

  async ngOnInit(): Promise<void> {
    try {
      const saved = sessionStorage.getItem(this.tabKey) as LibraryTab | null;
      if (saved && ['documents', 'handbook', 'help', 'audience'].includes(saved)) this.tab = saved;
    } catch { /* ignore */ }
    await this.load();
    this.guardTab();
  }

  private guardTab(): void {
    if (this.tab === 'audience' && !this.canEdit) this.setTab('documents');
    else if ((this.tab === 'handbook' || this.tab === 'help') && !this.canEdit && !this.visible) this.setTab('documents');
  }

  kindChanged(): void {
    if (this.personal) this.docAudience = 'person';
  }

  pickDocument(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.docFileName = file.name;
    const reader = new FileReader();
    reader.onload = () => { this.docData = String(reader.result || ''); };
    reader.readAsDataURL(file);
  }

  async saveDocument(): Promise<void> {
    await this.run('Document shared.', async () => {
      await this.api.post('/v1/library/files', {
        kind: this.docKind,
        title: this.docTitle,
        audience: this.personal ? 'person' : this.docAudience,
        employeeId: this.docPerson,
        departmentId: this.docDepartment,
        locationId: this.docLocation,
        fileName: this.docFileName,
        data: this.docData,
        published: true,
      });
      this.docTitle = '';
      this.docData = '';
      this.docFileName = '';
    });
  }

  async openDocument(id: string, title = 'Document', subtitle = ''): Promise<void> {
    try {
      const blob = await this.api.blob('/v1/library/files/' + id);
      await this.sweet.preview({ title, subtitle, blob });
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not open that document.';
    }
  }

  async publishDocument(item: StaffDocument): Promise<void> {
    await this.run(item.published ? 'Document hidden.' : 'Document shown.', () => this.api.post('/v1/library/files/publish', { id: item.id, published: !item.published }));
  }

  async removeDocument(id: string): Promise<void> {
    const doc = this.documents.find((row) => row.id === id);
    const yes = await this.sweet.confirm({
      title: doc ? `Remove “${doc.title}”?` : 'Remove this document?',
      text: 'People will no longer be able to open it from the library.',
      confirmText: 'Remove',
      danger: true,
    });
    if (!yes) return;
    await this.run('Document removed.', () => this.api.post('/v1/library/files/delete', { id }));
  }

  pickFile(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { this.fileData = String(reader.result || ''); };
    reader.readAsDataURL(file);
  }

  async saveWidgets(): Promise<void> {
    await this.run('Who can use these is saved.', () => this.api.post('/v1/library/widgets', { widgets: this.widgets }));
  }

  async saveHandbook(): Promise<void> {
    await this.run('Handbook published.', () => this.api.post('/v1/library/handbook', { title: this.title, version: this.version, data: this.fileData }));
  }

  async saveHelp(): Promise<void> {
    await this.run('Article published.', async () => {
      await this.api.post('/v1/library/help', { title: this.helpTitle, body: this.helpBody, audience: this.helpAudience, published: true });
      this.helpTitle = '';
      this.helpBody = '';
      this.helpAudience = 'all';
    });
  }

  async removeHelp(id: string): Promise<void> {
    const article = this.help.find((row) => row.id === id);
    const yes = await this.sweet.confirm({
      title: article ? `Remove “${article.title}”?` : 'Remove this article?',
      text: 'This help article is deleted for everyone.',
      confirmText: 'Remove',
      danger: true,
    });
    if (!yes) return;
    await this.run('Article removed.', () => this.api.post('/v1/library/help/delete', { id }));
  }

  private async load(): Promise<void> {
    try {
      const [library, widgets] = await Promise.all([
        this.api.get<{ canEdit: boolean; visible: boolean; handbook: Handbook | null; help: HelpRow[]; documents: StaffDocument[] }>('/v1/library'),
        this.api.get<WidgetRow[]>('/v1/library/widgets'),
      ]);
      this.canEdit = library.canEdit;
      this.visible = library.visible;
      this.handbook = library.handbook;
      this.help = library.help;
      this.documents = library.documents || [];
      this.widgets = widgets;
      if (library.canEdit) this.targets = await this.api.get<DocTargets>('/v1/library/targets');
      if (library.handbook) {
        this.title = library.handbook.title;
        this.version = library.handbook.version;
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load the library.';
    }
  }

  private async run(message: string, work: () => Promise<unknown>): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      await work();
      this.ok = message;
      await this.load();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save.';
    } finally {
      this.busy = false;
    }
  }
}