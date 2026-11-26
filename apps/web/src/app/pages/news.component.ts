import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { Announcement, Org, when } from '../core/models';
import { SessionStore } from '../core/session.store';
import { RichEditorComponent, RichViewComponent } from '../shared/rich-editor.component';

type NewsTab = 'feed' | 'post';

@Component({
  selector: 'app-news',
  imports: [FormsModule, RichEditorComponent, RichViewComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-megaphone"></i></span>
        <p class="eyebrow">Company</p>
        <h1>Announcements</h1>
        <p class="lede">{{ tabLede }}</p>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }

    <div class="seg-tabs page-tabs" role="tablist" aria-label="Announcement sections">
      <button type="button" role="tab" [attr.aria-selected]="tab === 'feed'" [class.is-on]="tab === 'feed'" (click)="setTab('feed')">
        <i class="bi bi-collection"></i> Feed
        @if (items.length) { <span class="chip">{{ items.length }}</span> }
      </button>
      @if (canPost) {
        <button type="button" role="tab" [attr.aria-selected]="tab === 'post'" [class.is-on]="tab === 'post'" (click)="setTab('post')">
          <i class="bi bi-megaphone"></i> Post
        </button>
      }
    </div>

    @if (tab === 'post' && canPost) {
      <form class="card form-grid" (ngSubmit)="post()">
        <h2><i class="bi bi-megaphone"></i> Post an announcement</h2>
        <label for="title">Title</label>
        <input id="title" name="title" [(ngModel)]="title" required>
        <label for="body">Message</label>
        <app-rich-editor inputId="body" name="body" label="Message" placeholder="Write the announcement. Use headings, lists, and links." [max]="4000" [(ngModel)]="body" required />
        <div class="split">
          <div>
            <label for="audience">Who sees it</label>
            <select id="audience" name="audience" [(ngModel)]="audience">
              <option value="all">Everyone</option>
              <option value="department">One department</option>
              <option value="location">One location</option>
            </select>
          </div>
          <div>
            <label for="expires">Expires, optional</label>
            <input id="expires" name="expires" type="date" [(ngModel)]="expiresOn">
          </div>
        </div>
        @if (audience === 'department') {
          <label for="department">Department</label>
          <select id="department" name="department" [(ngModel)]="departmentId">
            @for (item of org?.departments || []; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
          </select>
        }
        @if (audience === 'location') {
          <label for="location">Location</label>
          <select id="location" name="location" [(ngModel)]="locationId">
            @for (item of org?.locations || []; track item.id) { <option [value]="item.id">{{ item.name }}</option> }
          </select>
        }
        <label class="check"><input type="checkbox" name="pinned" [(ngModel)]="pinned"> Pin to the top</label>
        <button class="btn btn-primary" type="submit" [disabled]="busy">{{ busy ? 'Posting…' : 'Post' }}</button>
      </form>
    }

    @if (tab === 'feed') {
      @if (!items.length) {
        <section class="card"><p class="muted">No announcements yet.</p></section>
      }
      @for (item of items; track item.id) {
        <article class="card feed-item">
          <div class="row-between">
            <h2>{{ item.title }}</h2>
            @if (item.pinned) { <span class="pill gold">Pinned</span> }
          </div>
          <app-rich-view [value]="item.body" />
          <small>{{ item.authorName }} · {{ posted(item.createdAt) }} · {{ item.audience }}</small>
        </article>
      }
    }
  `,
})
export class NewsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly tabKey = 'altamid.news.tab';
  tab: NewsTab = 'feed';
  items: Announcement[] = [];
  org: Org | null = null;
  title = '';
  body = '';
  audience = 'all';
  departmentId = '';
  locationId = '';
  expiresOn = '';
  pinned = false;
  error = '';
  busy = false;

  get canPost(): boolean {
    return !!this.store.me?.access?.includes('news');
  }

  get tabLede(): string {
    const lines: Record<NewsTab, string> = {
      feed: 'Company announcements for you and your team.',
      post: 'Write a new announcement and choose who can see it.',
    };
    return lines[this.tab];
  }

  setTab(tab: NewsTab): void {
    if (tab === 'post' && !this.canPost) tab = 'feed';
    this.tab = tab;
    try { sessionStorage.setItem(this.tabKey, tab); } catch { /* ignore */ }
  }

  async ngOnInit(): Promise<void> {
    try {
      const saved = sessionStorage.getItem(this.tabKey) as NewsTab | null;
      if (saved && ['feed', 'post'].includes(saved)) this.tab = saved;
    } catch { /* ignore */ }
    if (this.tab === 'post' && !this.canPost) this.tab = 'feed';
    await this.load();
    if (this.canPost) {
      this.org = await this.api.get<Org>('/v1/org');
      this.departmentId = this.org.departments[0]?.id || '';
      this.locationId = this.org.locations[0]?.id || '';
    }
  }

  async post(): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      await this.api.post('/v1/announcements', {
        title: this.title,
        body: this.body,
        audience: this.audience,
        departmentId: this.departmentId,
        locationId: this.locationId,
        expiresOn: this.expiresOn,
        pinned: this.pinned,
      });
      this.title = '';
      this.body = '';
      this.pinned = false;
      await this.load();
      this.setTab('feed');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not post.';
    } finally {
      this.busy = false;
    }
  }

  posted(iso: string): string {
    return when(iso);
  }

  private async load(): Promise<void> {
    try {
      this.items = await this.api.get<Announcement[]>('/v1/announcements');
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load announcements.';
    }
  }
}