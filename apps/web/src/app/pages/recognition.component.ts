import { PhotoComponent } from '../shared/photo.component';
import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { badgeLook } from '../core/badges';

interface BadgeChoice { key: string; label: string }
interface BoardRow { id: string; name: string; code: string; count: number }
interface FeedRow { id: string; key: string; badge: string; note: string; from: string; to: string; fromId?: string; toId?: string; at: string }
interface RecognitionView {
  range: string;
  badges: BadgeChoice[];
  me: { received: number; given: number };
  feed: FeedRow[];
  receivers: BoardRow[];
  givers: BoardRow[];
}
interface PersonHit { id: string; name: string; code: string }

@Component({
  selector: 'app-recognition',
  imports: [FormsModule, PhotoComponent],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-award"></i></span>
        <p class="eyebrow">People</p>
        <h1>Recognition</h1>
        <p class="lede">Give a colleague a badge for something they did. The feed and the board follow the period you pick.</p>
      </div>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (view) {
      <div class="rec-stats">
        <article class="rec-stat">
          <span class="rec-stat-ico tone-gold"><i class="bi bi-award-fill"></i></span>
          <div><strong>{{ view.me.received }}</strong><small>Badges received</small></div>
        </article>
        <article class="rec-stat">
          <span class="rec-stat-ico tone-rose"><i class="bi bi-send-fill"></i></span>
          <div><strong>{{ view.me.given }}</strong><small>Badges given</small></div>
        </article>
        <article class="rec-stat">
          <span class="rec-stat-ico tone-sky"><i class="bi bi-activity"></i></span>
          <div><strong>{{ view.feed.length }}</strong><small>In this period</small></div>
        </article>
      </div>
      <section class="card">
        <h2><i class="bi bi-award"></i> Give a badge</h2>
        <form (ngSubmit)="give()">
          <label for="who">Colleague</label>
          <div class="rec-who">
            <i class="bi bi-search" aria-hidden="true"></i>
            <input id="who" name="who" [(ngModel)]="query" (ngModelChange)="look()" placeholder="Name or employee code" autocomplete="off">
          </div>
          @if (chosen) { <p class="rec-chosen"><app-photo size="xs" [personId]="chosen.id" [name]="chosen.name" /> Giving this to <strong>{{ chosen.name }}</strong> · {{ chosen.code }}</p> }
          @if (hits.length) {
            <div class="pick-list">
              @for (person of hits; track person.id) {
                <button type="button" (click)="choose(person)"><app-photo size="xs" [personId]="person.id" [name]="person.name" /> {{ person.name }} · {{ person.code }}</button>
              }
            </div>
          }
          <label>Badge</label>
          <div class="rec-badges" role="radiogroup" aria-label="Badge">
            @for (badge of view.badges; track badge.key) {
              <button type="button" role="radio" [attr.aria-checked]="badgeKey === badge.key" [class]="'rec-badge tone-' + badgeOf(badge.key).tone + (badgeKey === badge.key ? ' is-on' : '')" (click)="badgeKey = badge.key">
                <span class="rec-medal"><i class="bi" [class]="badgeOf(badge.key).icon"></i></span>
                <strong>{{ badge.label }}</strong>
                <small>{{ badgeOf(badge.key).line }}</small>
              </button>
            }
          </div>
          <label for="note">Note</label>
          <input id="note" name="note" [(ngModel)]="note" maxlength="180" placeholder="One line on why">
          <div class="actions rec-send">
            <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi" [class]="badgeOf(badgeKey).icon"></i> Give a badge</button>
            @if (sent) {
              <span class="rec-sent" aria-live="polite"><i class="bi bi-check-circle-fill"></i> {{ sent }}</span>
              <span class="rec-pop" aria-hidden="true">@for (n of pops; track n) { <i [attr.style]="'--a:' + n * 30 + 'deg'"></i> }</span>
            }
          </div>
        </form>
      </section>
      <div class="page-split">
        <section class="card">
          <div class="card-head">
            <h2><i class="bi bi-activity"></i> Live feed</h2>
            <select [ngModel]="view.range" (ngModelChange)="load($event)">
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="quarter">This quarter</option>
              <option value="half">This half year</option>
              <option value="year">This year</option>
              <option value="all">All time</option>
            </select>
          </div>
          @if (!view.feed.length) {
            <div class="rec-empty"><i class="bi bi-balloon-heart"></i><p class="muted">No badges in this period yet. Be the first to thank someone.</p></div>
          } @else {
            <div class="rec-feed">
              @for (item of view.feed; track item.id) {
                <article class="rec-item">
                  <span [class]="'badge-dot tone-' + badgeOf(item.key).tone"><i class="bi" [class]="badgeOf(item.key).icon"></i></span>
                  <div>
                    <p><span class="rec-who"><app-photo size="xs" [personId]="item.fromId || ''" [name]="item.from" /><strong>{{ item.from }}</strong></span> gave <span class="rec-who"><app-photo size="xs" [personId]="item.toId || ''" [name]="item.to" /><strong>{{ item.to }}</strong></span> <span [class]="'rec-tag tone-' + badgeOf(item.key).tone">{{ item.badge }}</span></p>
                    @if (item.note) { <p class="rec-note">“{{ item.note }}”</p> }
                    <small><i class="bi bi-clock"></i> {{ item.at }}</small>
                  </div>
                </article>
              }
            </div>
          }
        </section>
        <div class="dash-side">
          <section class="card">
            <h2><i class="bi bi-trophy"></i> Leaderboard</h2>
            <div class="seg-mini rec-seg">
              <button type="button" [class.is-active]="side === 'receivers'" (click)="side = 'receivers'"><i class="bi bi-award"></i> Top receiver</button>
              <button type="button" [class.is-active]="side === 'givers'" (click)="side = 'givers'"><i class="bi bi-send"></i> Top giver</button>
            </div>
            @if (!shownBoard.length) {
              <div class="rec-empty"><i class="bi bi-trophy"></i><p class="muted">No badges in this period yet.</p></div>
            } @else {
              @for (row of shownBoard; track row.id; let index = $index) {
                <div class="fame-row"><span [class]="'fame-rank rank-' + (index + 1)">{{ index + 1 }}</span><app-photo size="sm" [personId]="row.id" [code]="row.code" [name]="row.name" /><div><strong>{{ row.name }}</strong><small class="muted">{{ row.code }}</small></div><span class="rec-count"><i class="bi bi-award-fill"></i> {{ row.count }}</span></div>
              }
            }
          </section>
          <section class="card">
            <h2><i class="bi bi-stars"></i> Wall of fame</h2>
            @if (!view.receivers.length) {
              <div class="rec-empty"><i class="bi bi-stars"></i><p class="muted">The wall fills when badges are given.</p></div>
            } @else {
              <div class="rec-podium">
                @for (row of fame; track row.id; let index = $index) {
                  <div [class]="'rec-podium-step rank-' + (index + 1)">
                    <i class="bi" [class]="index === 0 ? 'bi-trophy-fill' : 'bi-award-fill'"></i>
                    <app-photo size="md" [personId]="row.id" [name]="row.name" />
                    <strong>{{ row.name }}</strong>
                    <small>{{ row.count }} {{ row.count === 1 ? 'badge' : 'badges' }}</small>
                  </div>
                }
              </div>
            }
          </section>
        </div>
      </div>
    }
  `,
})
export class RecognitionComponent implements OnInit {
  private readonly api = inject(ApiService);
  view: RecognitionView | null = null;
  error = '';
  query = '';
  note = '';
  badgeKey = 'thanks';
  busy = false;
  side: 'receivers' | 'givers' = 'receivers';
  hits: PersonHit[] = [];
  chosen: PersonHit | null = null;
  sent = '';
  readonly pops = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  readonly badgeOf = badgeLook;
  private lookToken = 0;
  private sentTimer = 0;

  get shownBoard(): BoardRow[] {
    return this.side === 'givers' ? this.view?.givers || [] : this.view?.receivers || [];
  }

  get fame(): BoardRow[] {
    return (this.view?.receivers || []).slice(0, 3);
  }

  async ngOnInit(): Promise<void> {
    await this.load('month');
  }

  async load(range: string): Promise<void> {
    this.error = '';
    try {
      this.view = await this.api.get<RecognitionView>('/v1/recognition?range=' + range);
      if (this.view.badges[0] && !this.view.badges.some((badge) => badge.key === this.badgeKey)) this.badgeKey = this.view.badges[0].key;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load recognition.';
    }
  }

  async look(): Promise<void> {
    this.chosen = null;
    const token = ++this.lookToken;
    const query = this.query.trim();
    if (query.length < 2) {
      this.hits = [];
      return;
    }
    try {
      const data = await this.api.get<{ people: PersonHit[] }>('/v1/recognition/people?q=' + encodeURIComponent(query));
      if (token === this.lookToken) this.hits = data.people;
    } catch {
      if (token === this.lookToken) this.hits = [];
    }
  }

  choose(person: PersonHit): void {
    this.chosen = person;
    this.query = person.name;
    this.hits = [];
  }

  async give(): Promise<void> {
    if (!this.chosen) {
      this.error = 'Choose a colleague.';
      return;
    }
    this.busy = true;
    this.error = '';
    try {
      const to = this.chosen.name;
      this.view = await this.api.post<RecognitionView>('/v1/recognition', { employeeId: this.chosen.id, badge: this.badgeKey, note: this.note });
      const label = this.view.badges.find((badge) => badge.key === this.badgeKey)?.label || 'Badge';
      this.sent = '';
      window.clearTimeout(this.sentTimer);
      setTimeout(() => (this.sent = `${label} sent to ${to}`));
      this.sentTimer = window.setTimeout(() => (this.sent = ''), 5000);
      this.note = '';
      this.query = '';
      this.chosen = null;
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not give the badge.';
    }
    this.busy = false;
  }
}
