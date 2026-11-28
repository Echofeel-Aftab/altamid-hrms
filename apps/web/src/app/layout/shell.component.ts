import { PhotoComponent } from '../shared/photo.component';
import { Component, HostListener, OnDestroy, OnInit, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from '../core/api.service';
import { SessionIdleService } from '../core/session-idle.service';
import { SessionStore } from '../core/session.store';
import { I18n } from '../core/i18n';
import { isDarkTheme, setDarkTheme } from '../core/theme';
import { applyDeskPack, deskPack } from '../core/desk-pack';
import { applyBrand } from '../core/brand';
import { NAV_GROUPS, NavGroup, NavItem } from '../core/nav';
import { AiChatWidgetComponent } from '../shared/ai-chat-widget.component';
import { OutletChoice } from '../core/models';

interface NoteItem {
  id: string;
  title: string;
  body: string;
  link: string;
  read: boolean;
  filters: string[];
}

interface NoteTab { key: string; label: string }

const SIDEBAR_KEY = 'altamid_hrms_sidebar';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, PhotoComponent, AiChatWidgetComponent],
  template: `
    <div class="app-shell" [class.nav-open]="open">
      <aside class="sidebar" (mouseover)="showFlyout($event)" (mouseout)="hideFlyout($event)">
        <a class="sidebar-brand" routerLink="/" (click)="open = false" aria-label="Altamid HRMS & Payroll">
          <span class="brand-mark"><img [src]="iconSrc" alt=""></span>
          <span class="brand-text">
            <strong>{{ brandName }}</strong>
            <span>{{ brandTag }}</span>
          </span>
        </a>
        <div class="sidebar-scroll" (mouseenter)="placeThumb($event)">
          <nav class="sidebar-nav" (scroll)="markNavScroll($event)">
            @if (pinnedItems().length) {
              <p class="nav-label nav-label-pinned"><i class="bi bi-pin-angle-fill"></i> {{ i18n.t('Pinned') }}</p>
              @for (item of pinnedItems(); track item.path) {
                <a class="nav-link" [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!item.exact }" [attr.aria-label]="i18n.t(item.label)" (click)="open = false">
                  <i [class]="item.icon"></i><span class="nav-text">{{ i18n.t(item.label) }}</span>
                </a>
              }
            }
            @for (group of visibleGroups(); track group.label) {
              <p class="nav-label">{{ i18n.t(group.label) }}</p>
              @for (item of visibleItems(group); track item.path) {
                <a class="nav-link" [routerLink]="item.path" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: !!item.exact }" [attr.aria-label]="i18n.t(item.label)" (click)="open = false">
                  <i [class]="item.icon"></i><span class="nav-text">{{ i18n.t(item.label) }}</span>
                </a>
              }
            }
          </nav>
          @if (thumbH > 0) {
            <span class="nav-scroll" [style.top.%]="thumbTop" [style.height.%]="thumbH" aria-hidden="true"></span>
          }
        </div>
        <button type="button" class="sidebar-collapse" (click)="toggleSidebar()" [attr.aria-label]="collapsed ? 'Expand sidebar' : 'Collapse sidebar'">
          <svg class="side-ico" viewBox="0 0 24 24" aria-hidden="true">
            <path class="side-ico-panel" d="M9 3.25H6.25a3 3 0 0 0-3 3v11.5a3 3 0 0 0 3 3H9z"></path>
            <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="3"></rect>
            @if (collapsed) { <path d="m13.4 9 3.1 3-3.1 3"></path> } @else { <path d="m16.5 9-3.1 3 3.1 3"></path> }
          </svg>
          <span class="nav-text">{{ i18n.t(collapsed ? 'Expand' : 'Collapse') }}</span>
        </button>
      </aside>
      @if (flyout) {
        <div class="nav-flyout" [style.top.px]="flyoutTop">{{ flyout }}</div>
      }
      <button type="button" class="scrim" aria-label="Close menu" (click)="open = false"></button>
      <div class="workspace">
        <header class="topbar">
          <div class="topbar-left">
            <button type="button" class="icon-btn sidebar-toggle" [class.is-collapsed]="collapsed" (click)="toggleSidebar()" [attr.aria-label]="collapsed ? 'Expand sidebar' : 'Collapse sidebar'">
              <svg class="side-ico" viewBox="0 0 24 24" aria-hidden="true">
                <path class="side-ico-panel" d="M9 3.25H6.25a3 3 0 0 0-3 3v11.5a3 3 0 0 0 3 3H9z"></path>
                <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="3"></rect>
                @if (collapsed) { <path d="m13.4 9 3.1 3-3.1 3"></path> } @else { <path d="m16.5 9-3.1 3 3.1 3"></path> }
              </svg>
            </button>
            <div class="topbar-now">
              <div class="topbar-now-clock">
                <strong>{{ clock }}</strong>
                <span>{{ dateLabel }}</span>
              </div>
              @if (weather) {
                <div class="topbar-now-weather" [attr.title]="weather.label + ' in ' + weather.place">
                  <i [class]="'bi ' + weather.icon"></i>
                  <span>{{ weather.temp }}°</span>
                  <small>{{ weather.place }}</small>
                </div>
              }
            </div>
          </div>
          <form class="topbar-search" [class.is-open]="mobileSearch" role="search" (click)="$event.stopPropagation()" (submit)="$event.preventDefault(); openFirst()">
            <label class="topbar-search-field">
              <i class="bi bi-search" aria-hidden="true"></i>
              <input type="search" [placeholder]="i18n.t('Search anything in HRMS...')" [value]="query" (input)="onSearch($any($event.target).value)" (focus)="searchOpen = query.trim().length > 0" [attr.aria-label]="i18n.t('Search anything in HRMS...')">
            </label>
            @if (searchOpen) {
              <div class="search-results">
                @if (!hits.length) {
                  <div class="search-empty">{{ i18n.t('Nothing matches that search.') }}</div>
                } @else {
                  @for (hit of hits; track hit.label + hit.path) {
                    @if (hit.path) {
                      <a [routerLink]="hit.path" (click)="closeSearch()">
                        <i [class]="hit.icon"></i>
                        <span>{{ i18n.t(hit.label) }}<small>{{ i18n.t(hit.group) }}</small></span>
                      </a>
                    } @else {
                      <div class="search-plain">
                        <i [class]="hit.icon"></i>
                        <span>{{ hit.label }}<small>{{ hit.group }}</small></span>
                      </div>
                    }
                  }
                }
              </div>
            }
          </form>
          <div class="topbar-actions">
            <button type="button" class="icon-btn topbar-search-toggle" (click)="$event.stopPropagation(); toggleMobileSearch()" [attr.aria-expanded]="mobileSearch" [attr.aria-label]="i18n.t('Search anything in HRMS...')" [title]="i18n.t('Search anything in HRMS...')">
              <i class="bi" [class.bi-search]="!mobileSearch" [class.bi-x-lg]="mobileSearch"></i>
            </button>
            <button type="button" class="icon-btn" (click)="$event.stopPropagation(); openLauncher()" [attr.aria-expanded]="launchOpen" [attr.aria-label]="i18n.t('All modules')" [title]="i18n.t('All modules')">
              <i class="bi bi-grid-3x3-gap-fill"></i>
            </button>
            @if (outletChoices.length > 1) {
              <div class="outlet-drop" (click)="$event.stopPropagation()">
                <button type="button" class="outlet-btn" (click)="toggleOutlets()" [attr.aria-expanded]="outletOpen" aria-haspopup="listbox" [attr.aria-label]="'Outlet: ' + outletLabel">
                  <i class="bi" [class.bi-diagram-3]="!store.me?.outlets?.current" [class.bi-building]="!!store.me?.outlets?.current"></i>
                  <span>{{ outletLabel }}</span>
                  <i class="bi bi-chevron-down"></i>
                </button>
                @if (outletOpen) {
                  <div class="outlet-menu" role="listbox" aria-label="Switch outlet">
                    @if (store.me?.outlets?.master) {
                      <button type="button" role="option" [attr.aria-selected]="!store.me?.outlets?.current" [class.is-on]="!store.me?.outlets?.current" (click)="switchOutlet('all')">
                        <i class="bi bi-diagram-3"></i> All outlets
                      </button>
                    }
                    @for (outlet of outletChoices; track outlet.id) {
                      <button type="button" role="option" [attr.aria-selected]="store.me?.outlets?.current === outlet.id" [class.is-on]="store.me?.outlets?.current === outlet.id" (click)="switchOutlet(outlet.id)">
                        <i class="bi bi-building"></i> {{ outlet.name }}
                        @if (!outlet.payroll) { <small>HR only</small> }
                      </button>
                    }
                  </div>
                }
              </div>
            }
            <div class="lang-drop" (click)="$event.stopPropagation()">
              <button type="button" class="icon-btn lang-btn" (click)="toggleLang()" [attr.aria-expanded]="langOpen" [attr.aria-label]="i18n.t('Language')">
                <i class="bi bi-translate"></i>
                <span>{{ i18n.code() }}</span>
              </button>
              @if (langOpen) {
                <div class="lang-menu">
                  @for (lang of i18n.languages; track lang.id) {
                    <button type="button" [class.is-on]="i18n.code() === lang.id" (click)="pickLang(lang.id)">
                      {{ lang.native }}
                      <small>{{ lang.name }}</small>
                    </button>
                  }
                </div>
              }
            </div>
            <button type="button" class="icon-btn" (click)="toggleTheme()" [attr.aria-label]="dark ? 'Switch to light mode' : 'Switch to dark mode'">
              <i class="bi" [class.bi-sun-fill]="dark" [class.bi-moon-stars-fill]="!dark"></i>
            </button>
            <div class="notify-drop" (click)="$event.stopPropagation()">
              <button type="button" class="icon-btn" (click)="toggleNotes()" [attr.aria-expanded]="notesOpen" aria-label="Notifications" title="Notifications">
                <i class="bi bi-bell"></i>
                <span class="notify-count" [class.is-zero]="unread < 1">{{ unread > 9 ? '9+' : unread }}</span>
              </button>
              @if (notesOpen) {
                <div class="notify-menu">
                  <div class="notify-head">
                    <strong>{{ i18n.t('Notifications') }}</strong>
                    <button type="button" class="linkish" (click)="readAll()" [disabled]="unread < 1">{{ i18n.t('Mark all read') }}</button>
                  </div>
                  <div class="notify-tabs">
                    <button type="button" [class.is-on]="noteTab === 'all'" (click)="noteTab = 'all'">{{ i18n.t('All') }}</button>
                    @for (tab of noteTabs; track tab.key) {
                      <button type="button" [class.is-on]="noteTab === tab.key" (click)="noteTab = tab.key">{{ i18n.t(tab.label) }}</button>
                    }
                  </div>
                  <div class="notify-list">
                    @if (!shownNotes.length) {
                      <p class="muted"><i class="bi bi-bell-slash"></i> {{ i18n.t('No pending actions exist for you.') }}</p>
                    } @else {
                      @for (item of shownNotes; track item.id) {
                        <a [routerLink]="item.link" (click)="openNote(item)">
                          <strong [class.is-read]="item.read">{{ item.title }}</strong>
                          <span>{{ item.body }}</span>
                        </a>
                      }
                    }
                  </div>
                  <a class="notify-all" routerLink="/notifications" (click)="notesOpen = false">{{ i18n.t('View all') }}</a>
                </div>
              }
            </div>
            <div class="user-drop">
              <button type="button" class="user-chip" (click)="$event.stopPropagation(); userOpen = !userOpen" [attr.aria-expanded]="userOpen">
                <app-photo size="sm" [personId]="store.me?.employeeId || '' " [name]="store.me?.name || ''" />
                <span>
                  <strong>{{ store.me?.name }}</strong>
                  <small>{{ store.me?.role }} · {{ store.me?.company?.name }}</small>
                </span>
                <i class="bi bi-chevron-down"></i>
              </button>
              @if (userOpen) {
                <div class="user-menu">
                  @if (clock) {
                    <div class="user-menu-meta">
                      <strong>{{ clock }}</strong>
                      <small>{{ dateLabel }}@if (weather) { · {{ weather.temp }}° {{ weather.place }} }</small>
                    </div>
                  }
                  <a routerLink="/profile" (click)="userOpen = false"><i class="bi bi-person"></i> {{ i18n.t('My profile') }}</a>
                  <a routerLink="/requests" (click)="userOpen = false"><i class="bi bi-inbox"></i> {{ i18n.t('My requests') }}</a>
                  <a routerLink="/settings" [queryParams]="{ tab: 'password' }" (click)="userOpen = false"><i class="bi bi-shield-lock"></i> {{ i18n.t('Password') }}</a>
                  <a routerLink="/settings" (click)="userOpen = false"><i class="bi bi-gear"></i> {{ i18n.t('Settings') }}</a>
                  <a routerLink="/manual" (click)="userOpen = false"><i class="bi bi-book"></i> {{ i18n.t('User manual') }}</a>
                  <button type="button" (click)="signOut()"><i class="bi bi-box-arrow-right"></i> {{ i18n.t('Sign out') }}</button>
                </div>
              }
            </div>
          </div>
        </header>
        @if (store.me && store.me.licence.mode !== 'allow') {
          <div class="banner licence-banner" [class.bad]="store.me.licence.mode === 'restrict'">{{ store.me.licence.message }}</div>
        }
        @if (outletNotice) {
          <div class="banner licence-banner" [class.bad]="outletNotice.bad">{{ outletNotice.text }}</div>
        }
        <main class="content">
          <router-outlet />
        </main>
        <footer class="app-footer"><span>Altamid HRMS & Payroll</span><span>{{ planLabel }}</span></footer>
        @if (showAiWidget) { <app-ai-chat-widget /> }
      </div>
    </div>
    @if (launchOpen) {
      <div class="launch-scrim" (click)="launchOpen = false"></div>
      <section class="launch-panel" role="dialog" aria-modal="true" [attr.aria-label]="i18n.t('All modules')" (click)="$event.stopPropagation()">
        <header class="launch-head">
          <div>
            <h2><i class="bi bi-grid-3x3-gap-fill"></i> {{ i18n.t('All modules') }}</h2>
            <p>{{ i18n.t('Pin up to 12 pages to keep them at the top of the menu.') }}</p>
          </div>
          <button type="button" class="icon-btn" (click)="launchOpen = false" aria-label="Close"><i class="bi bi-x-lg"></i></button>
        </header>
        <div class="launch-search">
          <i class="bi bi-search"></i>
          <input #launchInput type="search" [value]="launchQuery" (input)="launchQuery = $any($event.target).value" (keydown.enter)="openFirstModule()" [placeholder]="i18n.t('Find a module')" [attr.aria-label]="i18n.t('Find a module')">
        </div>
        <div class="launch-body">
          @if (!launchQuery.trim() && pinnedItems().length) {
            <p class="launch-label"><i class="bi bi-pin-angle-fill"></i> {{ i18n.t('Pinned modules') }}</p>
            <div class="launch-grid">
              @for (item of pinnedItems(); track item.path) {
                <div class="launch-tile is-pinned">
                  <a [routerLink]="item.path" (click)="launchOpen = false; open = false"><span class="launch-ico"><i [class]="item.icon"></i></span><span>{{ i18n.t(item.label) }}</span></a>
                  <button type="button" class="launch-pin is-on" (click)="togglePin(item)" [attr.aria-label]="'Unpin ' + item.label" title="Unpin"><i class="bi bi-pin-angle-fill"></i></button>
                </div>
              }
            </div>
          }
          @for (group of launchGroups(); track group.label) {
            <p class="launch-label">{{ i18n.t(group.label) }}</p>
            <div class="launch-grid">
              @for (item of group.items; track item.path) {
                <div class="launch-tile" [class.is-pinned]="isPinned(item)">
                  <a [routerLink]="item.path" (click)="launchOpen = false; open = false"><span class="launch-ico"><i [class]="item.icon"></i></span><span>{{ i18n.t(item.label) }}</span></a>
                  <button type="button" class="launch-pin" [class.is-on]="isPinned(item)" (click)="togglePin(item)" [attr.aria-label]="(isPinned(item) ? i18n.t('Unpin') + ' ' : i18n.t('Pin') + ' ') + i18n.t(item.label)" [title]="isPinned(item) ? i18n.t('Unpin') : i18n.t('Pin')"><i class="bi" [class.bi-pin-angle-fill]="isPinned(item)" [class.bi-pin-angle]="!isPinned(item)"></i></button>
                </div>
              }
            </div>
          } @empty {
            <p class="launch-empty">{{ i18n.t('Nothing matches that search.') }}</p>
          }
        </div>
      </section>
    }
  `,
})
export class ShellComponent implements OnInit, OnDestroy {
  readonly store = inject(SessionStore);
  readonly i18n = inject(I18n);
  private readonly api = inject(ApiService);
  private readonly idle = inject(SessionIdleService);
  private readonly router = inject(Router);
  open = false;
  userOpen = false;
  notesOpen = false;
  langOpen = false;
  outletOpen = false;
  unread = 0;
  notes: NoteItem[] = [];
  noteTabs: NoteTab[] = [];
  noteTab = 'all';
  searchOpen = false;
  mobileSearch = false;
  query = '';
  hits: Array<NavItem & { group: string }> = [];
  dark = isDarkTheme();
  collapsed = false;
  clock = '';
  dateLabel = '';
  flyout = '';
  flyoutTop = 0;
  weather: { temp: number; icon: string; label: string; place: string } | null = null;
  private timer = 0;
  private weatherTimer = 0;
  private navScrollTimer = 0;

  private readonly groups: NavGroup[] = NAV_GROUPS;
  pins: string[] = [];
  launchOpen = false;
  launchQuery = '';

  ngOnInit(): void {
    this.idle.start();
    applyDeskPack(deskPack());
    void this.loadPins();
    this.collapsed = localStorage.getItem(SIDEBAR_KEY) === '1' && window.matchMedia('(min-width: 992px)').matches;
    this.applySidebar();
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 1000);
    this.paintBrand();
    void this.loadIcon();
    void this.loadWeather();
    void this.loadNotes();
    this.weatherTimer = window.setInterval(() => void this.loadWeather(), 20 * 60 * 1000);
  }

  ngOnDestroy(): void {
    this.idle.stop();
    window.clearInterval(this.timer);
    window.clearInterval(this.weatherTimer);
    window.clearTimeout(this.navScrollTimer);
  }

  thumbTop = 0;
  thumbH = 0;

  placeThumb(event: Event): void {
    const host = event.currentTarget as HTMLElement;
    const nav = host.classList.contains('sidebar-nav') ? host : host.querySelector<HTMLElement>('.sidebar-nav');
    if (nav) this.syncThumb(nav);
  }

  markNavScroll(event: Event): void {
    const nav = event.target as HTMLElement;
    this.syncThumb(nav);
    nav.classList.add('is-scrolling');
    window.clearTimeout(this.navScrollTimer);
    this.navScrollTimer = window.setTimeout(() => nav.classList.remove('is-scrolling'), 700);
  }

  private syncThumb(nav: HTMLElement): void {
    const scroll = nav.scrollHeight;
    if (scroll <= nav.clientHeight + 1) {
      this.thumbH = 0;
      return;
    }
    this.thumbH = (nav.clientHeight / scroll) * 100;
    this.thumbTop = (nav.scrollTop / scroll) * 100;
  }

  iconSrc = 'brand/logo-icon.png';

  get brandName(): string {
    return this.store.me?.company.brand?.name || 'Altamid';
  }

  get brandTag(): string {
    return this.store.me?.company.brand?.tagline || 'HRMS & Payroll';
  }

  get initial(): string {
    return (this.store.me?.name || 'A').trim().charAt(0).toUpperCase();
  }

  get showAiWidget(): boolean {
    return !!(this.store.me && (this.store.me.access || []).includes('ai'));
  }

  visibleGroups(): NavGroup[] {
    return this.groups.filter((group) => this.visibleItems(group).length > 0);
  }

  visibleItems(group: NavGroup): NavItem[] {
    const access = this.store.me?.access || [];
    return group.items.filter((item) => {
      if (item.path === '/payroll' && this.store.me?.outlets?.payroll === false) return false;
      if (!item.feature) return true;
      if (item.feature === 'owner') return this.store.me?.role === 'owner';
      if (item.feature === 'settings') return access.includes('settings') || access.includes('access');
      return access.includes(item.feature);
    });
  }

  pinnedItems(): NavItem[] {
    const visible = this.visibleGroups().flatMap((group) => this.visibleItems(group));
    return this.pins.map((path) => visible.find((item) => item.path === path)).filter((item): item is NavItem => !!item);
  }

  isPinned(item: NavItem): boolean {
    return this.pins.includes(item.path);
  }

  launchGroups(): NavGroup[] {
    const needle = this.launchQuery.trim().toLowerCase();
    return this.visibleGroups()
      .map((group) => ({
        ...group,
        items: this.visibleItems(group).filter((item) => !needle || this.i18n.t(item.label).toLowerCase().includes(needle) || item.label.toLowerCase().includes(needle) || group.label.toLowerCase().includes(needle)),
      }))
      .filter((group) => group.items.length > 0);
  }

  openLauncher(): void {
    this.closeMenus();
    this.launchQuery = '';
    this.launchOpen = true;
    window.setTimeout(() => document.querySelector<HTMLInputElement>('.launch-search input')?.focus(), 30);
  }

  openFirstModule(): void {
    const first = this.launchGroups()[0]?.items[0];
    if (!first) return;
    this.launchOpen = false;
    void this.router.navigateByUrl(first.path);
  }

  async togglePin(item: NavItem): Promise<void> {
    const before = this.pins;
    if (this.isPinned(item)) this.pins = this.pins.filter((path) => path !== item.path);
    else if (this.pins.length >= 12) return;
    else this.pins = [...this.pins, item.path];
    try {
      this.pins = (await this.api.post<{ pins: string[] }>('/v1/me/pins', { pins: this.pins })).pins;
    } catch {
      this.pins = before;
    }
  }

  @HostListener('document:keydown.escape')
  closeLauncher(): void {
    this.launchOpen = false;
  }

  private async loadPins(): Promise<void> {
    try {
      this.pins = (await this.api.get<{ pins: string[] }>('/v1/me/pins')).pins;
    } catch {
      this.pins = [];
    }
  }

  onSearch(value: string): void {
    this.query = value;
    const needle = value.trim().toLowerCase();
    this.searchOpen = needle.length > 0;
    this.hits = [];
    if (!needle) return;
    for (const group of this.visibleGroups()) {
      for (const item of this.visibleItems(group)) {
        if (item.label.toLowerCase().includes(needle) || group.label.toLowerCase().includes(needle)) {
          this.hits.push({ ...item, group: group.label });
        }
      }
    }
    void this.lookPeople(needle);
  }

  private searchTicket = 0;

  private async lookPeople(needle: string): Promise<void> {
    if (needle.length < 2) return;
    const ticket = ++this.searchTicket;
    try {
      const data = await this.api.get<{ people: Array<{ id: string; name: string; code: string; department: string }> }>('/v1/directory?q=' + encodeURIComponent(needle));
      if (ticket !== this.searchTicket || this.query.trim().toLowerCase() !== needle) return;
      const canOpen = !!this.store.me?.access?.includes('people');
      const people = data.people.map((person) => ({
        path: canOpen ? '/people/' + person.id : '',
        label: person.name + ' · ' + person.code,
        icon: 'bi bi-person',
        group: person.department || 'People',
        exact: false,
      }));
      this.hits = [...this.hits.filter((hit) => hit.icon !== 'bi bi-person'), ...people];
    } catch {
      /* colleague search can be turned off */
    }
  }

  openFirst(): void {
    const hit = this.hits.find((item) => item.path);
    if (!hit) return;
    this.closeSearch();
    void this.router.navigateByUrl(hit.path);
  }

  toggleTheme(): void {
    this.dark = !this.dark;
    setDarkTheme(this.dark);
  }

  toggleSidebar(): void {
    this.flyout = '';
    if (window.matchMedia('(max-width: 991px)').matches) {
      this.open = !this.open;
      return;
    }
    this.collapsed = !this.collapsed;
    localStorage.setItem(SIDEBAR_KEY, this.collapsed ? '1' : '0');
    this.applySidebar();
  }

  showFlyout(event: Event): void {
    if (!this.collapsed || !window.matchMedia('(min-width: 992px)').matches) return;
    const item = (event.target as HTMLElement | null)?.closest?.('.nav-link, .sidebar-collapse, .sidebar-brand') as HTMLElement | null;
    if (!item) {
      this.flyout = '';
      return;
    }
    const label = item.getAttribute('aria-label') || '';
    if (!label) return;
    const box = item.getBoundingClientRect();
    const half = 16;
    const center = box.top + box.height / 2;
    this.flyout = label;
    this.flyoutTop = Math.round(Math.min(window.innerHeight - half - 8, Math.max(half + 8, center)));
  }

  hideFlyout(event: MouseEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && (event.currentTarget as Node).contains(next)) return;
    this.flyout = '';
  }

  async signOut(): Promise<void> {
    try {
      await this.api.post('/v1/auth/logout', {});
    } catch { /* still clear local session */ }
    this.api.setToken('');
    this.store.clear();
    void this.router.navigateByUrl('/login');
  }

  toggleLang(): void {
    this.langOpen = !this.langOpen;
    this.notesOpen = false;
    this.userOpen = false;
    this.outletOpen = false;
  }

  get outletChoices(): OutletChoice[] {
    return this.store.me?.outlets?.list || [];
  }

  get outletLabel(): string {
    const current = this.store.me?.outlets?.current;
    return current ? this.outletChoices.find((row) => row.id === current)?.name || 'Outlet' : 'All outlets';
  }

  /** Warns when the current outlet's subscription is paused or ends within 30 days. */
  get planLabel(): string {
    const licence = this.store.me?.licence as { planName?: string; planCode?: string } | undefined;
    return licence?.planName || licence?.planCode || 'People';
  }

  get outletNotice(): { text: string; bad: boolean } | null {
    const current = this.store.me?.outlets?.current;
    const outlet = current ? this.outletChoices.find((row) => row.id === current) : null;
    if (!outlet || this.store.me?.licence.mode !== 'allow') return null;
    if (!outlet.usable) return { text: `${outlet.name}'s HRMS subscription is paused. New people and payroll runs stay paused here until it is renewed. Existing records stay available.`, bad: true };
    const ends = outlet.termEndsAt ? Date.parse(outlet.termEndsAt) : NaN;
    const days = Math.ceil((ends - Date.now()) / 86400000);
    if (!Number.isFinite(days) || days > 30) return null;
    return { text: `${outlet.name}'s HRMS subscription ends in ${Math.max(days, 0)} day${days === 1 ? '' : 's'}. Renew it in Altamid Control to keep hiring and payroll running here.`, bad: false };
  }

  toggleOutlets(): void {
    this.outletOpen = !this.outletOpen;
    this.langOpen = false;
    this.notesOpen = false;
    this.userOpen = false;
  }

  /** Reloads in the chosen outlet. A record page goes back to its list, as the record may belong to another outlet. */
  switchOutlet(id: string): void {
    this.outletOpen = false;
    if ((this.store.me?.outlets?.current ?? 'all') === id) return;
    this.api.setOutlet(id);
    const section = '/' + (this.router.url.split(/[?#]/)[0].split('/').filter(Boolean)[0] || '');
    window.location.assign(section);
  }

  pickLang(id: string): void {
    this.i18n.choose(id);
    this.langOpen = false;
  }

  toggleNotes(): void {
    this.notesOpen = !this.notesOpen;
    this.langOpen = false;
    this.userOpen = false;
    this.outletOpen = false;
    if (this.notesOpen) void this.loadNotes();
  }

  async openNote(item: NoteItem): Promise<void> {
    this.notesOpen = false;
    if (item.read) return;
    try {
      const data = await this.api.post<{ unread: number; items: NoteItem[] }>('/v1/notifications/read', { id: item.id });
      this.unread = data.unread;
      this.notes = data.items;
    } catch {
      this.unread = Math.max(0, this.unread - 1);
    }
  }

  async readAll(): Promise<void> {
    const data = await this.api.post<{ unread: number; items: NoteItem[] }>('/v1/notifications/read', {});
    this.unread = data.unread;
    this.notes = data.items;
  }

  toggleMobileSearch(): void {
    this.mobileSearch = !this.mobileSearch;
    if (this.mobileSearch) {
      window.setTimeout(() => document.querySelector<HTMLInputElement>('.topbar-search input')?.focus(), 30);
    } else {
      this.searchOpen = false;
    }
  }

  closeSearch(): void {
    this.searchOpen = false;
    this.mobileSearch = false;
    this.query = '';
  }

  @HostListener('document:click')
  closeMenus(): void {
    this.outletOpen = false;
    this.userOpen = false;
    this.notesOpen = false;
    this.langOpen = false;
    this.searchOpen = false;
    this.mobileSearch = false;
  }

  paintBrand(): void {
    const brand = this.store.me?.company.brand;
    if (!brand) return;
    applyBrand(brand.colors);
    document.title = brand.title || 'Altamid HRMS';
  }

  get shownNotes(): NoteItem[] {
    if (this.noteTab === 'all') return this.notes;
    return this.notes.filter((item) => item.filters?.includes(this.noteTab));
  }

  private async loadNotes(): Promise<void> {
    try {
      const data = await this.api.get<{ unread: number; tabs: NoteTab[]; items: NoteItem[] }>('/v1/notifications');
      this.unread = data.unread;
      this.noteTabs = data.tabs || [];
      this.notes = data.items;
      if (this.noteTab !== 'all' && !this.noteTabs.some((tab) => tab.key === this.noteTab)) this.noteTab = 'all';
    } catch {
      this.notes = [];
    }
  }

  private async loadIcon(): Promise<void> {
    if (!this.store.me?.company.brand?.hasIcon) return;
    try {
      const blob = await this.api.blob('/v1/brand/icon');
      this.iconSrc = URL.createObjectURL(blob);
    } catch {
      this.iconSrc = 'brand/logo-icon.png';
    }
  }

  private applySidebar(): void {
    document.documentElement.classList.toggle('sidebar-collapsed', this.collapsed);
  }

  private tick(): void {
    const now = new Date();
    this.clock = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    this.dateLabel = now.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  }

  private async loadWeather(): Promise<void> {
    const city = (this.store.me?.company?.city || 'Kolkata').trim() || 'Kolkata';
    try {
      const geoRes = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&format=json&name=' + encodeURIComponent(city + ', India'));
      const geo = (await geoRes.json()) as { results?: Array<Record<string, unknown>> };
      const hit = geo.results?.[0];
      const lat = Number(hit?.['latitude']);
      const lon = Number(hit?.['longitude']);
      if (!hit || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const forecastRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,weather_code&timezone=Asia%2FKolkata');
      const forecast = (await forecastRes.json()) as { current?: { temperature_2m?: number; weather_code?: number } };
      const current = forecast.current;
      if (!current) return;
      const code = Number(current.weather_code) || 0;
      this.weather = {
        temp: Math.round(Number(current.temperature_2m) || 0),
        icon: weatherIcon(code),
        label: weatherLabel(code),
        place: String(hit['name'] || city),
      };
    } catch {
      // Keep the last reading when the weather service is unreachable.
    }
  }
}

function weatherIcon(code: number): string {
  if (code === 0) return 'bi-sun';
  if (code <= 3) return 'bi-cloud-sun';
  if (code <= 48) return 'bi-cloud-fog2';
  if (code <= 57) return 'bi-cloud-drizzle';
  if (code <= 67) return 'bi-cloud-rain';
  if (code <= 77) return 'bi-snow';
  if (code <= 82) return 'bi-cloud-rain-heavy';
  if (code <= 86) return 'bi-snow';
  return 'bi-cloud-lightning';
}

function weatherLabel(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow';
  return 'Thunderstorm';
}
