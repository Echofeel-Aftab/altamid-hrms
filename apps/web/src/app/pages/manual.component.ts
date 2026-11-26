import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';

interface ManualView {
  company: string;
  preparedFor: string;
  roleLabel: string;
  forRole: string | null;
  generatedAt: string;
  index: Array<{ group: string; items: Array<{ id: string; title: string }> }>;
  sections: Array<{
    id: string;
    group: string;
    title: string;
    path: string;
    menu: string;
    why: string;
    example: string;
    tips: string[];
    howTo: Array<{ title: string; body: string; steps: string[] }>;
  }>;
  roles: Array<{ id: string; label: string }>;
}

type Section = ManualView['sections'][number];

const GROUP_ICONS: Record<string, string> = {
  'Start here': 'bi-flag',
  'My day': 'bi-sun',
  'My team': 'bi-people',
  Company: 'bi-buildings',
  Pay: 'bi-wallet2',
  Hiring: 'bi-briefcase',
  Setup: 'bi-gear',
};

@Component({
  selector: 'app-manual',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-book"></i></span>
        <p class="eyebrow">Help</p>
        <h1>User manual</h1>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-ghost" (click)="print()" [disabled]="!view"><i class="bi bi-printer"></i> Print</button>
        <button type="button" class="btn btn-primary" (click)="download()" [disabled]="!view || busy"><i class="bi" [class]="busy ? 'bi-hourglass-split' : 'bi-download'"></i> Download PDF</button>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }

    @if (view) {
      <section class="um-hero">
        <div>
          <p class="um-kicker">{{ view.roleLabel }} edition · {{ view.company }}</p>
          <h2>{{ view.forRole ? 'Manual for the ' + view.roleLabel + ' role' : 'Your guide to ' + view.company + ' HRMS' }}</h2>
          <p>{{ view.forRole ? 'This preview shows what everyone in this role can open, before any department, grade or personal access.' : 'Written for ' + view.preparedFor + '. It lists only the screens and actions your access allows, so anything you cannot open is left out on purpose.' }}</p>
        </div>
        <dl class="um-facts">
          <div><dt>Topics</dt><dd>{{ view.sections.length }}</dd></div>
          <div><dt>Areas</dt><dd>{{ view.index.length }}</dd></div>
          <div><dt>Updated</dt><dd>{{ view.generatedAt }}</dd></div>
        </dl>
      </section>

      @if (view.roles.length) {
        <section class="card um-role">
          <div class="um-role-copy">
            <h2><i class="bi bi-person-badge"></i> Manual for a role</h2>
            <p class="muted">Preview or download the manual someone in a role gets, to hand to new joiners.</p>
          </div>
          <div class="um-role-pick">
            <label class="sr-only" for="um-role">Role</label>
            <select id="um-role" [(ngModel)]="role" (ngModelChange)="load()">
              <option value="">My own manual</option>
              @for (item of view.roles; track item.id) { <option [value]="item.id">{{ item.label }}</option> }
            </select>
          </div>
        </section>
      }

      @if (view.index.length > 1) {
        <div class="seg-tabs page-tabs" role="tablist" aria-label="Manual areas">
          @for (block of view.index; track block.group) {
            <button type="button" role="tab" [attr.aria-selected]="tab === block.group" [class.is-on]="tab === block.group" (click)="setTab(block.group)">
              <i class="bi" [class]="icon(block.group)"></i> {{ block.group }}
              @if (visibleIn(block.group).length) { <span class="chip">{{ visibleIn(block.group).length }}</span> }
            </button>
          }
        </div>
      }

      <div class="um-layout">
        <aside class="um-toc">
          <div class="um-search">
            <i class="bi bi-search" aria-hidden="true"></i>
            <input type="search" [(ngModel)]="query" placeholder="Search the manual" aria-label="Search the manual">
          </div>
          <nav aria-label="Manual index">
            @for (block of view.index; track block.group) {
              @if (block.group === tab && visibleIn(block.group).length) {
                <div class="um-toc-group">
                  <h3><i class="bi" [class]="icon(block.group)"></i> {{ block.group }}</h3>
                  <ul>
                    @for (item of visibleIn(block.group); track item.id) {
                      <li><a [href]="'#um-' + item.id" [class.is-on]="active === item.id" (click)="jump($event, item.id)">{{ item.title }}</a></li>
                    }
                  </ul>
                </div>
              }
            }
          </nav>
        </aside>

        <div class="um-body">
          @for (block of view.index; track block.group) {
            @if (block.group === tab && visibleIn(block.group).length) {
              <h2 class="um-group"><i class="bi" [class]="icon(block.group)"></i> {{ block.group }}</h2>
              @for (section of visibleIn(block.group); track section.id) {
                <article class="card um-section" [id]="'um-' + section.id">
                  <header class="um-section-head">
                    <div>
                      <h3>{{ section.title }}</h3>
                      @if (section.menu) { <p class="um-where"><i class="bi bi-signpost-split"></i> {{ section.menu }}</p> }
                    </div>
                    @if (section.path && section.path !== '/login' && !view.forRole) {
                      <a class="btn btn-ghost btn-sm" [routerLink]="section.path">Open <i class="bi bi-arrow-right"></i></a>
                    }
                  </header>
                  <p class="um-why">{{ section.why }}</p>
                  @if (section.example) {
                    <div class="um-example"><strong>Example</strong><p>{{ section.example }}</p></div>
                  }
                  @for (item of section.howTo; track item.title) {
                    <div class="um-howto">
                      <h4>{{ item.title }}</h4>
                      @if (item.body) { <p>{{ item.body }}</p> }
                      @if (item.steps.length) {
                        <ol>
                          @for (step of item.steps; track $index) { <li>{{ step }}</li> }
                        </ol>
                      }
                    </div>
                  }
                  @if (section.tips.length) {
                    <div class="um-tips">
                      <strong><i class="bi bi-lightbulb"></i> Good to know</strong>
                      <ul>
                        @for (tip of section.tips; track $index) { <li>{{ tip }}</li> }
                      </ul>
                    </div>
                  }
                </article>
              }
            }
          }
          @if (!visibleIn(tab).length) {
            <section class="card"><p class="muted">@if (query) { Nothing in {{ tab }} matches "{{ query }}". } @else { No topics in this area for your access. }</p></section>
          }
        </div>
      </div>
    } @else if (!error) {
      <p class="muted">Preparing your manual…</p>
    }
  `,
})
export class ManualComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly tabKey = 'altamid.manual.tab';
  view: ManualView | null = null;
  role = '';
  query = '';
  active = '';
  tab = '';
  error = '';
  busy = false;

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  setTab(group: string): void {
    this.tab = group;
    try { sessionStorage.setItem(this.tabKey, group); } catch { /* ignore */ }
  }

  async load(): Promise<void> {
    this.error = '';
    try {
      this.view = await this.api.get<ManualView>('/v1/manual' + (this.role ? '?role=' + encodeURIComponent(this.role) : ''));
      this.syncTab();
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The manual could not be prepared.';
    }
  }

  private syncTab(): void {
    const groups = this.view?.index.map((block) => block.group) || [];
    if (!groups.length) {
      this.tab = '';
      return;
    }
    try {
      const saved = sessionStorage.getItem(this.tabKey);
      if (saved && groups.includes(saved)) this.tab = saved;
      else this.tab = groups[0];
    } catch {
      this.tab = groups[0];
    }
  }

  icon(group: string): string {
    return GROUP_ICONS[group] || 'bi-bookmark';
  }

  matches(): Section[] {
    const sections = this.view?.sections || [];
    const needle = this.query.trim().toLowerCase();
    if (!needle) return sections;
    return sections.filter((section) =>
      [section.title, section.menu, section.why, section.example, ...section.tips, ...section.howTo.flatMap((item) => [item.title, item.body, ...item.steps])]
        .some((text) => text.toLowerCase().includes(needle)),
    );
  }

  visibleIn(group: string): Section[] {
    return this.matches().filter((section) => section.group === group);
  }

  jump(event: Event, id: string): void {
    event.preventDefault();
    this.active = id;
    document.getElementById('um-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  print(): void {
    this.query = '';
    setTimeout(() => window.print(), 50);
  }

  async download(): Promise<void> {
    if (!this.view) return;
    this.busy = true;
    try {
      const blob = await this.api.blob('/v1/manual/pdf' + (this.role ? '?role=' + encodeURIComponent(this.role) : ''));
      const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hrms';
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${slug(this.view.company)}-user-manual-${slug(this.view.roleLabel)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 4000);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'The PDF could not be prepared.';
    } finally {
      this.busy = false;
    }
  }
}
