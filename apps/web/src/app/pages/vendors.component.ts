import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { SessionStore } from '../core/session.store';

interface Vendor {
  id: string;
  name: string;
  city: string;
  contactName: string;
  email: string;
  phone: string;
  note: string;
  hireThrough: boolean;
  suppliesUs: boolean;
  weSupply: boolean;
  active: boolean;
}

interface VendorDesk {
  hireViaAgencies: boolean;
  supplyManpower: boolean;
  vendors: Vendor[];
}

type VendorTab = 'list' | 'add';

@Component({
  selector: 'app-vendors',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <span class="page-mark" aria-hidden="true"><i class="bi bi-building"></i></span>
        <p class="eyebrow">Hiring</p>
        <h1>Vendors</h1>
        <p class="lede">{{ tabLede }}</p>
      </div>
      <a class="btn btn-ghost" routerLink="/hiring">Jobs</a>
    </div>
    @if (error) { <p class="form-error">{{ error }}</p> }
    @if (ok) { <p class="form-ok">{{ ok }}</p> }
    @if (desk) {
      <div class="seg-tabs page-tabs" role="tablist" aria-label="Vendor sections">
        <button type="button" role="tab" [attr.aria-selected]="tab === 'list'" [class.is-on]="tab === 'list'" (click)="setTab('list')">
          <i class="bi bi-list-ul"></i> Vendors
          @if (desk.vendors.length) { <span class="chip">{{ desk.vendors.length }}</span> }
        </button>
        <button type="button" role="tab" [attr.aria-selected]="tab === 'add'" [class.is-on]="tab === 'add'" (click)="setTab('add')">
          <i class="bi bi-plus-lg"></i> {{ editing ? 'Edit vendor' : 'Add vendor' }}
        </button>
      </div>

      @if (tab === 'list') {
        <section class="card">
          <h2><i class="bi bi-briefcase"></i> How this company uses agencies</h2>
          <label class="check"><input type="checkbox" name="hire" [(ngModel)]="desk.hireViaAgencies"> We hire through agencies</label>
          <label class="check"><input type="checkbox" name="supply" [(ngModel)]="desk.supplyManpower"> We provide manpower to other companies</label>
          <div class="actions"><button type="button" class="btn btn-secondary" (click)="saveMode()" [disabled]="busy">Save</button></div>
        </section>
        @if (desk.vendors.length) {
          <section class="card">
            <h2><i class="bi bi-building"></i> All vendors</h2>
            @for (vendor of desk.vendors; track vendor.id) {
              <article class="feed-item">
                <div class="row-between">
                  <h3>{{ vendor.name }}</h3>
                  <span class="muted">{{ vendor.city || 'City not added' }}</span>
                </div>
                <p class="muted">@if (vendor.contactName) { {{ vendor.contactName }} · }{{ vendor.email || 'No email' }}@if (vendor.phone) { · {{ vendor.phone }} }</p>
                <p>
                  @if (vendor.hireThrough) { <span class="pill">Hiring through them</span> }
                  @if (vendor.suppliesUs) { <span class="pill">Supplies our people</span> }
                  @if (vendor.weSupply) { <span class="pill">We staff them</span> }
                </p>
                @if (vendor.note) { <p>{{ vendor.note }}</p> }
                <div class="actions">
                  <button type="button" class="btn btn-secondary btn-sm" (click)="edit(vendor)">Edit</button>
                  <button type="button" class="btn btn-ghost btn-sm" (click)="remove(vendor)">Remove</button>
                </div>
              </article>
            }
          </section>
        } @else {
          <section class="card">
            <p class="muted">No vendors yet. Open <button type="button" class="btn btn-ghost btn-sm" (click)="setTab('add')">Add vendor</button> to add one.</p>
          </section>
        }
      }

      @if (tab === 'add') {
        <section class="card">
          <h2>{{ editing ? 'Edit vendor' : 'Add a vendor' }}</h2>
          <form class="form-grid" (ngSubmit)="save()">
            <div class="split">
              <div><label for="vendor-name">Name</label><input id="vendor-name" name="name" [(ngModel)]="name" required></div>
              <div><label for="vendor-city">City</label><input id="vendor-city" name="city" [(ngModel)]="city"></div>
            </div>
            <div class="split">
              <div><label for="vendor-contact">Contact</label><input id="vendor-contact" name="contact" [(ngModel)]="contactName"></div>
              <div><label for="vendor-phone">Phone</label><input id="vendor-phone" name="phone" [(ngModel)]="phone"></div>
            </div>
            <label for="vendor-email">Email</label>
            <input id="vendor-email" name="email" type="email" [(ngModel)]="email">
            <p class="access-label">Options</p>
            <label class="check"><input type="checkbox" name="hireThrough" [(ngModel)]="hireThrough"> We hire candidates through them</label>
            <label class="check"><input type="checkbox" name="suppliesUs" [(ngModel)]="suppliesUs"> They supply outsourced people onto our rolls</label>
            <label class="check"><input type="checkbox" name="weSupply" [(ngModel)]="weSupply"> We provide manpower to them</label>
            <label for="vendor-note">Note</label>
            <textarea id="vendor-note" name="note" rows="2" [(ngModel)]="note"></textarea>
            <div class="actions">
              <button class="btn btn-primary" type="submit" [disabled]="busy">{{ busy ? 'Saving…' : (editing ? 'Save vendor' : 'Add vendor') }}</button>
              @if (editing) { <button type="button" class="btn btn-ghost" (click)="clear()">Cancel</button> }
            </div>
          </form>
        </section>
      }
    }
  `,
})
export class VendorsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly tabKey = 'altamid.vendors.tab';
  tab: VendorTab = 'list';
  desk: VendorDesk | null = null;
  name = '';
  city = '';
  contactName = '';
  email = '';
  phone = '';
  note = '';
  hireThrough = false;
  suppliesUs = false;
  weSupply = false;
  editing = '';
  error = '';
  ok = '';
  busy = false;

  get tabLede(): string {
    const lines: Record<VendorTab, string> = {
      list: 'An agency can send candidates, place outsourced people on your rolls, or take manpower you provide.',
      add: 'Add or edit a vendor and mark which options apply.',
    };
    return lines[this.tab];
  }

  setTab(tab: VendorTab): void {
    this.tab = tab;
    try { sessionStorage.setItem(this.tabKey, tab); } catch { /* ignore */ }
  }

  async ngOnInit(): Promise<void> {
    try {
      const saved = sessionStorage.getItem(this.tabKey) as VendorTab | null;
      if (saved && ['list', 'add'].includes(saved)) this.tab = saved;
    } catch { /* ignore */ }
    await this.load();
  }

  edit(vendor: Vendor): void {
    this.editing = vendor.id;
    this.name = vendor.name;
    this.city = vendor.city;
    this.contactName = vendor.contactName;
    this.email = vendor.email;
    this.phone = vendor.phone;
    this.note = vendor.note;
    this.hireThrough = vendor.hireThrough;
    this.suppliesUs = vendor.suppliesUs;
    this.weSupply = vendor.weSupply;
    this.ok = '';
    this.error = '';
    this.setTab('add');
  }

  clear(): void {
    this.editing = '';
    this.name = '';
    this.city = '';
    this.contactName = '';
    this.email = '';
    this.phone = '';
    this.note = '';
    this.hireThrough = false;
    this.suppliesUs = false;
    this.weSupply = false;
    this.city = this.store.me?.company.city || '';
    this.setTab('list');
  }

  async saveMode(): Promise<void> {
    if (!this.desk) return;
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      this.desk = await this.api.post<VendorDesk>('/v1/vendors/mode', {
        hireViaAgencies: this.desk.hireViaAgencies,
        supplyManpower: this.desk.supplyManpower,
      });
      this.ok = 'Saved how this company uses agencies.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save that.';
    } finally {
      this.busy = false;
    }
  }

  async save(): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    const body = {
      name: this.name,
      city: this.city,
      contactName: this.contactName,
      email: this.email,
      phone: this.phone,
      note: this.note,
      hireThrough: this.hireThrough,
      suppliesUs: this.suppliesUs,
      weSupply: this.weSupply,
    };
    try {
      if (this.editing) await this.api.post('/v1/vendors/' + this.editing, body);
      else await this.api.post('/v1/vendors', body);
      this.clear();
      await this.load();
      this.ok = 'Vendor saved.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save that vendor.';
    } finally {
      this.busy = false;
    }
  }

  async remove(vendor: Vendor): Promise<void> {
    this.error = '';
    this.ok = '';
    try {
      await this.api.post('/v1/vendors/' + vendor.id + '/remove', {});
      if (this.editing === vendor.id) this.clear();
      await this.load();
      this.ok = 'Vendor removed.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not remove that vendor.';
    }
  }

  private async load(): Promise<void> {
    try {
      this.desk = await this.api.get<VendorDesk>('/v1/vendors');
      if (!this.city) this.city = this.store.me?.company.city || '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load vendors.';
    }
  }
}