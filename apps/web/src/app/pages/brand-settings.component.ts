import { NgTemplateOutlet } from '@angular/common';
import { Component, inject, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../core/api.service';
import { applyBrand, applyDriver, BRAND_DEFAULTS, BRAND_GROUPS, BRAND_LABELS, brandPresets, CONTRAST_AGAINST, contrastRatio, derive, readDataUrl } from '../core/brand';
import { BrandView } from '../core/models';
import { SessionStore } from '../core/session.store';

@Component({
  selector: 'app-brand-settings',
  imports: [FormsModule, NgTemplateOutlet],
  template: `
    <form class="card brand-card" (ngSubmit)="save()">
      <h2><i class="bi bi-brush"></i> Brand</h2>
      <p class="muted">Sidebar, browser tab and sign-in mark for this company. Colours are in the next card.</p>
      <div class="brand-lockup">
        <span class="brand-mark"><img [src]="iconPreview || 'brand/logo-icon.png'" alt=""></span>
        <span class="brand-text">
          <strong>{{ name || 'Altamid' }}</strong>
          <span>{{ tagline || 'HRMS & Payroll' }}</span>
        </span>
      </div>
      <div class="split">
        <div>
          <label for="brand-name">Brand name</label>
          <input id="brand-name" name="brandName" [(ngModel)]="name" maxlength="40">
        </div>
        <div>
          <label for="brand-tag">Subtitle</label>
          <input id="brand-tag" name="brandTag" [(ngModel)]="tagline" maxlength="40" placeholder="HRMS & Payroll">
        </div>
      </div>
      <label for="brand-title">Browser tab title</label>
      <input id="brand-title" name="brandTitle" [(ngModel)]="title" maxlength="80" placeholder="Altamid HRMS">
      <label for="brand-web">Brand website</label>
      <input id="brand-web" name="brandWeb" [(ngModel)]="website" placeholder="https://www.yourcompany.com">
      <div class="split">
        <div>
          <label for="brand-icon">App icon</label>
          <input id="brand-icon" type="file" accept="image/png,image/jpeg,image/webp" (change)="upload('icon', $event)">
          <small>Square PNG, JPG or WebP for the sidebar.</small>
        </div>
        <div>
          <label for="brand-logo">Document logo</label>
          @if (logoPreview) { <img class="brand-logo" [src]="logoPreview" alt=""> }
          <input id="brand-logo" type="file" accept="image/png,image/jpeg,image/webp" (change)="upload('logo', $event)">
          <small>Wide logo for payslips and letters.</small>
        </div>
      </div>
      <button class="btn btn-primary" type="submit" [disabled]="busy">Save brand</button>
    </form>

    <form class="card brand-card" (ngSubmit)="save()">
      <h2><i class="bi bi-palette2"></i> Colours</h2>
      <p class="muted">Pick a ready palette or tune each colour. The workspace updates as you change it. Save so everyone in this company sees it. Printed payslips stay on white paper.</p>
      <div class="theme-presets">
        @for (item of presets; track item.id) {
          <button type="button" class="theme-preset" [class.is-on]="preset === item.id" (click)="choosePreset(item.id)">
            <span class="theme-dots"><i [style.background]="item.colors['primary']"></i><i [style.background]="item.colors['accent']"></i></span>
            {{ item.label }}
          </button>
        }
        <button type="button" class="theme-preset" [class.is-on]="preset === 'custom'" (click)="preset = 'custom'">
          <span class="theme-dots"><i [style.background]="colors['primary']"></i><i [style.background]="colors['accent']"></i></span>
          Custom
        </button>
      </div>
      <div class="theme-live-row">
        <div class="theme-live" [style.background]="colors['card']" [style.color]="colors['text']" [style.border-color]="colors['border']">
          <div>
            <p class="eyebrow" [style.color]="colors['primary']">Light preview</p>
            <h3 [style.color]="colors['heading']">Page heading</h3>
            <p [style.color]="colors['text']">Body text, with a <a href="" [style.color]="colors['link']" (click)="$event.preventDefault()">sample link</a>.</p>
          </div>
          <div class="actions">
            <button type="button" class="btn" [style.background]="colors['btn_primary']" [style.border-color]="colors['btn_primary']" [style.color]="colors['btn_primary_text']">Primary</button>
            <button type="button" class="btn" [style.background]="colors['btn_accent']" [style.border-color]="colors['btn_accent']" [style.color]="colors['btn_accent_text']">Accent</button>
            <button type="button" class="btn" [style.background]="colors['card']" [style.border-color]="colors['border']" [style.color]="colors['heading']">Outline</button>
          </div>
        </div>
        <div class="theme-live theme-live-dark" [style.background]="colors['dark_card']" [style.color]="colors['dark_text']" [style.border-color]="colors['dark_border']">
          <div>
            <p class="eyebrow" [style.color]="colors['dark_accent']">Dark preview</p>
            <h3 [style.color]="colors['dark_heading']">Page heading</h3>
            <p [style.color]="colors['dark_text']">Body text, with a <a href="" [style.color]="colors['dark_link']" (click)="$event.preventDefault()">sample link</a>.</p>
          </div>
          <div class="actions">
            <button type="button" class="btn" [style.background]="colors['dark_btn_primary']" [style.border-color]="colors['dark_btn_primary']" [style.color]="colors['dark_btn_primary_text']">Primary</button>
            <button type="button" class="btn" [style.background]="colors['dark_btn_accent']" [style.border-color]="colors['dark_btn_accent']" [style.color]="colors['dark_btn_accent_text']">Accent</button>
            <button type="button" class="btn" [style.background]="colors['dark_card']" [style.border-color]="colors['dark_border']" [style.color]="colors['dark_text']">Outline</button>
          </div>
        </div>
      </div>
      <ng-template #swatch let-key="key">
        <label class="theme-swatch">
          <span>
            {{ label(key) }}
            @if (warn(key)) { <em class="theme-warn">Low contrast</em> }
            @if (hint(key)) { <small>{{ hint(key) }}</small> }
          </span>
          <input type="color" [value]="colors[key]" (input)="paint(key, $any($event.target).value)">
          <input [value]="shown(key)" (input)="typeHex(key, $any($event.target).value)" maxlength="7" spellcheck="false" [attr.aria-label]="label(key) + ' hex'">
        </label>
      </ng-template>
      @for (group of groups; track group.id) {
        @if (group.advanced) {
          <details class="theme-advanced">
            <summary>{{ group.title }}</summary>
            <p class="muted">{{ group.blurb }}</p>
            <div class="theme-grid">
              @for (key of group.keys; track key) {
                <ng-container *ngTemplateOutlet="swatch; context: { key: key }" />
              }
            </div>
          </details>
        } @else {
          <h3 class="theme-group">{{ group.title }}</h3>
          <p class="muted">{{ group.blurb }}</p>
          <div class="theme-grid">
            @for (key of group.keys; track key) {
              <ng-container *ngTemplateOutlet="swatch; context: { key: key }" />
            }
          </div>
        }
      }
      <div class="theme-actions">
        <button class="btn btn-primary" type="submit" [disabled]="busy">Save colours</button>
        <button class="btn btn-ghost" type="button" (click)="match()">Match other colours to primary and accent</button>
        <button class="btn btn-ghost" type="button" (click)="reset()">Reset to Altamid defaults</button>
      </div>
      <p class="muted theme-note">Changing primary or accent updates hover, links, buttons and the dark sidebar, and picks the label colour that reads better. Page backgrounds stay until you match them or edit them. Reset stays on this screen until you save.</p>
    </form>
  `,
})
export class BrandSettingsComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  readonly presets = brandPresets();
  readonly groups = BRAND_GROUPS;
  preset = 'altamid';
  name = '';
  tagline = '';
  title = '';
  website = '';
  colors: Record<string, string> = { ...BRAND_DEFAULTS };
  iconPreview = '';
  logoPreview = '';
  busy = false;
  private saved: BrandView | null = null;
  private drafts: Record<string, string> = {};

  async ngOnInit(): Promise<void> {
    const brand = await this.api.get<BrandView>('/v1/brand');
    this.take(brand);
    if (brand.hasIcon) this.iconPreview = await this.objectUrl('/v1/brand/icon');
    if (brand.hasLogo) this.logoPreview = await this.objectUrl('/v1/brand/logo');
  }

  ngOnDestroy(): void {
    if (this.saved) applyBrand(this.saved.colors);
  }

  label(key: string): string {
    return BRAND_LABELS[key]?.[0] || key;
  }

  hint(key: string): string {
    return BRAND_LABELS[key]?.[1] || '';
  }

  shown(key: string): string {
    return this.drafts[key] ?? this.colors[key];
  }

  warn(key: string): boolean {
    const against = CONTRAST_AGAINST[key];
    if (!against || !this.colors[key] || !this.colors[against]) return false;
    return contrastRatio(this.colors[key], this.colors[against]) < 4.5;
  }

  choosePreset(id: string): void {
    const found = this.presets.find((item) => item.id === id);
    if (!found) return;
    this.preset = id;
    this.colors = { ...found.colors };
    this.drafts = {};
    applyBrand(this.colors);
  }

  typeHex(key: string, value: string): void {
    const raw = value.trim();
    this.drafts = { ...this.drafts, [key]: raw };
    this.paint(key, raw);
  }

  paint(key: string, value: string): void {
    const hex = value.trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) return;
    const next = applyDriver(this.colors, key, hex);
    const drafts = { ...this.drafts };
    for (const name of Object.keys(next)) {
      if (next[name] !== this.colors[name]) delete drafts[name];
    }
    delete drafts[key];
    this.drafts = drafts;
    this.colors = next;
    this.preset = 'custom';
    applyBrand(this.colors);
  }

  match(): void {
    this.colors = derive(this.colors['primary'], this.colors['accent']);
    this.preset = 'custom';
    this.drafts = {};
    applyBrand(this.colors);
  }

  async save(): Promise<void> {
    this.busy = true;
    try {
      const brand = await this.api.post<BrandView>('/v1/brand', {
        preset: this.preset,
        name: this.name,
        tagline: this.tagline,
        title: this.title,
        website: this.website,
        colors: this.colors,
      });
      this.take(brand);
      this.remember(brand);
    } finally {
      this.busy = false;
    }
  }

  reset(): void {
    this.preset = 'altamid';
    this.colors = { ...BRAND_DEFAULTS };
    this.drafts = {};
    applyBrand(this.colors);
  }

  async upload(kind: 'icon' | 'logo', event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.busy = true;
    try {
      const data = await readDataUrl(file);
      const brand = await this.api.post<BrandView>('/v1/brand/' + kind, { data });
      this.remember(brand);
      if (kind === 'icon') this.iconPreview = data;
      else this.logoPreview = data;
    } finally {
      this.busy = false;
    }
  }

  private take(brand: BrandView): void {
    this.saved = brand;
    this.preset = brand.preset || 'altamid';
    this.name = brand.name;
    this.tagline = brand.tagline;
    this.title = brand.title;
    this.website = brand.website;
    this.colors = { ...BRAND_DEFAULTS, ...brand.colors };
    applyBrand(this.colors);
  }

  private remember(brand: BrandView): void {
    if (!this.store.me) return;
    this.store.me = { ...this.store.me, company: { ...this.store.me.company, brand } };
    document.title = brand.title || 'Altamid HRMS';
  }

  private async objectUrl(path: string): Promise<string> {
    try {
      return URL.createObjectURL(await this.api.blob(path));
    } catch {
      return '';
    }
  }
}
