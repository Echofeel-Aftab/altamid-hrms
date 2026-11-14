import { Component, inject, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AiStatusService } from '../core/ai-status.service';
import { ApiService } from '../core/api.service';
import { AiAccountView, AiSettingsView, SettingsView } from '../core/settings';
import { Sweet } from '../shared/sweet';

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic (Claude)' },
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'azure', label: 'Azure OpenAI' },
  { id: 'compatible', label: 'OpenAI-compatible' },
];

@Component({
  selector: 'app-settings-ai',
  imports: [FormsModule],
  template: `
    <div class="att-stack">
      <header class="settings-panel-head">
        <h2><i class="bi bi-stars"></i> AI accounts</h2>
        <p>Bring your own keys (OpenAI, Claude, Gemini, Azure, or compatible). Staff chat uses the default, then fallback accounts on timeout or errors. The assistant can explain features, check rules and violations, open screens, and brief reports.</p>
      </header>
      @if (error) { <p class="form-error">{{ error }}</p> }
      @if (ok) { <p class="form-ok">{{ ok }}</p> }
      <section class="settings-card">
        <header class="settings-card-head">
          <span class="settings-icon"><i class="bi bi-robot"></i></span>
          <div>
            <h2>Assistant</h2>
            <p>{{ ready ? 'Ready for staff chat (bottom-right)' : 'Add at least one account' }}</p>
          </div>
          <span class="integration-status" [class.is-on]="enabled" [class.is-off]="!enabled">{{ enabled ? 'On' : 'Off' }}</span>
        </header>
        <div class="settings-card-body">
          <label class="check">
            <input type="checkbox" [(ngModel)]="enabled" name="aiOn" (change)="toggleEnabled()">
            <span><strong>Enable AI assistant</strong><small>Turns the bottom-right chat on for staff who can sign in.</small></span>
          </label>
          @if (accounts.length) {
            <div class="smtp-account-list">
              @for (row of accounts; track row.id) {
                <div class="smtp-account-row" [class.is-off]="!row.enabled">
                  <div>
                    <strong>{{ row.label }}</strong>
                    @if (row.default) { <span class="pill warn">Default</span> }
                    @if (fallbackOrder.includes(row.id)) { <span class="pill">Fallback {{ fallbackOrder.indexOf(row.id) + 1 }}</span> }
                    <div class="muted small">{{ row.providerLabel }} · {{ row.model || 'No model' }} · {{ row.keyMask || 'No key' }}</div>
                  </div>
                  <div class="smtp-account-actions">
                    <button type="button" class="btn btn-ghost btn-sm" (click)="edit(row)">Edit</button>
                    @if (!row.default) { <button type="button" class="btn btn-ghost btn-sm" (click)="setDefault(row)">Default</button> }
                    <button type="button" class="btn btn-ghost btn-sm" (click)="toggleFallback(row)" [disabled]="row.default">{{ fallbackOrder.includes(row.id) ? 'Unfallback' : 'Fallback' }}</button>
                    <button type="button" class="btn btn-ghost btn-sm" (click)="test(row)" [disabled]="busy">Test</button>
                    <button type="button" class="btn btn-ghost btn-sm" (click)="remove(row)">Remove</button>
                  </div>
                </div>
              }
            </div>
            <p class="field-hint">Fallback order: default first, then the accounts marked Fallback (in list order), then any other enabled account.</p>
          }
          <form class="smtp-account-form" (ngSubmit)="saveAccount()">
            <h3>{{ editing ? 'Edit AI account' : 'Add AI account' }}</h3>
            <div class="field-grid">
              <div><label for="ai-label">Label</label><input id="ai-label" name="label" [(ngModel)]="label"></div>
              <div>
                <label for="ai-provider">Provider</label>
                <select id="ai-provider" name="provider" [(ngModel)]="provider">
                  @for (item of providers; track item.id) { <option [value]="item.id">{{ item.label }}</option> }
                </select>
              </div>
              <div><label for="ai-model">Model</label><input id="ai-model" name="model" [(ngModel)]="model" placeholder="gpt-4o-mini"></div>
              @if (provider === 'azure' || provider === 'compatible') {
                <div class="span-2"><label for="ai-base">Base URL</label><input id="ai-base" name="baseUrl" [(ngModel)]="baseUrl" placeholder="https://…"></div>
              }
              <div class="span-2">
                <label for="ai-key">API key</label>
                <input id="ai-key" name="apiKey" type="password" [(ngModel)]="apiKey" [placeholder]="editing ? 'Saved — leave blank to keep' : 'Paste key only'" autocomplete="new-password">
              </div>
            </div>
            <div class="settings-toggle-row">
              <label class="check"><input type="checkbox" name="accountOn" [(ngModel)]="accountOn"> Enabled</label>
              <label class="check"><input type="checkbox" name="defaultOn" [(ngModel)]="defaultOn"> Default account</label>
            </div>
            <div class="settings-inline-save">
              <button class="btn btn-gold" type="submit" [disabled]="busy"><i class="bi bi-check2"></i> {{ editing ? 'Update account' : 'Add account' }}</button>
              @if (editing) { <button class="btn btn-ghost" type="button" (click)="clear()">Cancel edit</button> }
            </div>
          </form>
        </div>
      </section>
    </div>
  `,
})
export class SettingsAiComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly sweet = inject(Sweet);
  private readonly aiStatus = inject(AiStatusService);
  readonly providers = PROVIDERS;
  accounts: AiAccountView[] = [];
  fallbackOrder: string[] = [];
  enabled = false;
  ready = false;
  busy = false;
  error = '';
  ok = '';
  editing = false;
  accountId = '';
  label = '';
  provider = 'openai';
  model = 'gpt-4o-mini';
  baseUrl = '';
  apiKey = '';
  accountOn = true;
  defaultOn = false;

  async ngOnInit(): Promise<void> {
    await this.reload();
  }

  edit(row: AiAccountView): void {
    this.editing = true;
    this.accountId = row.id;
    this.label = row.label;
    this.provider = row.provider;
    this.model = row.model;
    this.baseUrl = row.baseUrl;
    this.apiKey = '';
    this.accountOn = row.enabled;
    this.defaultOn = row.default;
  }

  clear(): void {
    this.editing = false;
    this.accountId = '';
    this.label = '';
    this.provider = 'openai';
    this.model = 'gpt-4o-mini';
    this.baseUrl = '';
    this.apiKey = '';
    this.accountOn = true;
    this.defaultOn = false;
  }

  async saveAccount(): Promise<void> {
    await this.save({
      section: 'ai',
      saveAccount: true,
      id: this.accountId || undefined,
      label: this.label,
      provider: this.provider,
      model: this.model,
      baseUrl: this.baseUrl,
      apiKey: this.apiKey,
      accountEnabled: this.accountOn,
      makeDefault: this.defaultOn || !this.accounts.length,
    });
    this.clear();
  }

  async setDefault(row: AiAccountView): Promise<void> {
    await this.save({ section: 'ai', setDefault: true, id: row.id });
  }

  async remove(row: AiAccountView): Promise<void> {
    const sure = await this.sweet.confirm({ title: 'Remove ' + row.label + '?', confirmText: 'Remove', danger: true });
    if (!sure) return;
    await this.save({ section: 'ai', remove: true, id: row.id });
    if (this.accountId === row.id) this.clear();
  }

  async test(row: AiAccountView): Promise<void> {
    this.busy = true;
    this.error = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', { section: 'test', target: 'ai', id: row.id });
      const note = view.ai?.lastTest;
      if (note?.ok) this.ok = note.message;
      else this.error = note?.message || 'Test failed.';
      this.apply(view.ai);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Test failed.';
    } finally {
      this.busy = false;
    }
  }

  async toggleEnabled(): Promise<void> {
    await this.save({ section: 'ai', enabled: this.enabled });
  }

  async toggleFallback(row: AiAccountView): Promise<void> {
    const next = this.fallbackOrder.includes(row.id)
      ? this.fallbackOrder.filter((id) => id !== row.id)
      : [...this.fallbackOrder, row.id];
    await this.save({ section: 'ai', fallbackOrder: next });
  }

  private async save(body: Record<string, unknown>): Promise<void> {
    this.busy = true;
    this.error = '';
    this.ok = '';
    try {
      const view = await this.api.post<SettingsView>('/v1/settings', body);
      this.apply(view.ai);
      this.aiStatus.bump();
      this.ok = this.ready
        ? 'AI settings saved. The assistant is ready for staff chat (bottom-right).'
        : 'AI settings saved. Add a provider key and keep Enable AI assistant on.';
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not save.';
      await this.reload();
    } finally {
      this.busy = false;
    }
  }

  private async reload(): Promise<void> {
    try {
      const view = await this.api.get<SettingsView>('/v1/settings');
      this.apply(view.ai);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Could not load AI settings.';
    }
  }

  private apply(ai?: AiSettingsView): void {
    if (!ai) return;
    this.accounts = ai.accounts || [];
    this.fallbackOrder = ai.fallbackOrder || [];
    this.enabled = ai.enabled;
    this.ready = ai.ready;
  }
}