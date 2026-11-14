import { Component, inject, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { I18n } from '../core/i18n';

interface Note {
  id: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  at: string;
  filters: string[];
}

interface NoteTab { key: string; label: string }

@Component({
  selector: 'app-notifications',
  imports: [RouterLink],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-bell"></i></span>
        <p class="eyebrow">Inbox</p>
        <h1>Notifications</h1>
        <p class="lede">Each list follows your role. Waiting and hiring stay with the people who can act on them.</p>
      </div>
      <button type="button" class="btn btn-ghost" (click)="readAll()" [disabled]="!unread">Mark all read</button>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    <div class="note-filters">
      <button type="button" [class.is-on]="tab === 'all'" (click)="tab = 'all'">{{ i18n.t('All') }}</button>
      @for (item of tabs; track item.key) {
        <button type="button" [class.is-on]="tab === item.key" (click)="tab = item.key">{{ i18n.t(item.label) }}</button>
      }
    </div>
    @if (!shown.length && !error) {
      <section class="card"><p class="muted">{{ i18n.t('No pending actions exist for you.') }}</p></section>
    }
    @for (item of shown; track item.id) {
      <a class="card note-row" [class.is-unread]="!item.read" [routerLink]="item.link" (click)="open(item)">
        <strong>{{ item.title }}</strong>
        <span>{{ item.body }}</span>
        <small>{{ item.at }}</small>
      </a>
    }
  `,
})
export class NotificationsComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly i18n = inject(I18n);
  items: Note[] = [];
  tabs: NoteTab[] = [];
  tab = 'all';
  unread = 0;
  error = '';

  get shown(): Note[] {
    if (this.tab === 'all') return this.items;
    return this.items.filter((item) => item.filters?.includes(this.tab));
  }

  async ngOnInit(): Promise<void> {
    try {
      const data = await this.api.get<{ unread: number; tabs: NoteTab[]; items: Note[] }>('/v1/notifications?limit=40');
      this.items = data.items;
      this.tabs = data.tabs || [];
      this.unread = data.unread;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load notifications.';
    }
  }

  async open(item: Note): Promise<void> {
    if (item.read) return;
    item.read = true;
    this.unread = Math.max(0, this.unread - 1);
    try {
      await this.api.post('/v1/notifications/read', { id: item.id });
    } catch {
      item.read = false;
    }
  }

  async readAll(): Promise<void> {
    const data = await this.api.post<{ unread: number; items: Note[] }>('/v1/notifications/read', {});
    this.unread = data.unread;
    const fresh = await this.api.get<{ unread: number; tabs: NoteTab[]; items: Note[] }>('/v1/notifications?limit=40');
    this.items = fresh.items;
    this.unread = fresh.unread;
  }
}
