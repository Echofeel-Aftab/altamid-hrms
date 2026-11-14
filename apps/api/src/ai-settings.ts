import { randomBytes } from 'crypto';
import { maskSecret } from './crypto';
import { accountReady, AI_PROVIDER_LABELS, AiAccountStored, AiProvider, AiSettings, defaultAiSettings, defaultModel } from './ai.types';
import { fail, optional } from './http';

export function readAiSettings(source: Record<string, unknown>): AiSettings {
  const base = defaultAiSettings();
  const row = source.ai;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return base;
  const raw = row as Record<string, unknown>;
  base.enabled = raw.enabled === true;
  base.defaultAccountId = optional(raw.defaultAccountId, 40);
  if (Array.isArray(raw.fallbackOrder)) {
    base.fallbackOrder = [...new Set(raw.fallbackOrder.map((id) => String(id).slice(0, 40)).filter(Boolean))].slice(0, 20);
  }
  if (Array.isArray(raw.accounts)) {
    base.accounts = raw.accounts
      .filter((item) => item && typeof item === 'object')
      .map((item) => readAccount(item as Record<string, unknown>))
      .filter((item) => item.id)
      .slice(0, 12);
  }
  return base;
}

export function presentAiSettings(cfg: AiSettings) {
  return {
    enabled: cfg.enabled,
    defaultAccountId: cfg.defaultAccountId,
    fallbackOrder: cfg.fallbackOrder,
    catalog: AI_PROVIDER_LABELS,
    accounts: cfg.accounts.map((row) => ({
      id: row.id,
      label: row.label,
      provider: row.provider,
      providerLabel: AI_PROVIDER_LABELS[row.provider] || row.provider,
      model: row.model,
      baseUrl: row.baseUrl,
      enabled: row.enabled,
      default: row.id === cfg.defaultAccountId,
      configured: accountReady(row),
      keyMask: row.apiKeyEnc ? maskSecret('saved') : '',
      hasKey: Boolean(row.apiKeyEnc),
    })),
    ready: cfg.enabled && cfg.accounts.some(accountReady),
  };
}

export function upsertAiAccount(cfg: AiSettings, input: Record<string, unknown>, seal: (plain: string) => string): string {
  let id = optional(input.id, 40).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) id = 'ai_' + randomBytes(5).toString('hex');
  const existing = cfg.accounts.find((row) => row.id === id);
  const provider = providerOf(String(input.provider || existing?.provider || 'openai'));
  const sentKey = String(input.apiKey ?? '').trim().replace(/^Bearer\s+/i, '');
  const apiKeyEnc = sentKey ? seal(sentKey) : existing?.apiKeyEnc || '';
  const model = String(input.model ?? existing?.model ?? defaultModel(provider)).trim().slice(0, 120);
  const row: AiAccountStored = {
    id,
    label: String(input.label ?? existing?.label ?? AI_PROVIDER_LABELS[provider]).trim().slice(0, 80) || AI_PROVIDER_LABELS[provider],
    provider,
    model,
    apiKeyEnc,
    baseUrl: String(input.baseUrl ?? existing?.baseUrl ?? '').trim().replace(/\/$/, '').slice(0, 300),
    enabled: accountEnabledOf(input, existing),
  };
  if (row.enabled && !apiKeyEnc && provider !== 'compatible') {
    if (provider === 'azure' || provider === 'openai' || provider === 'gemini' || provider === 'anthropic') {
      fail(400, 'Add an API key before enabling this AI account.');
    }
  }
  const next = cfg.accounts.filter((item) => item.id !== id);
  next.push(row);
  cfg.accounts = next.sort((a, b) => a.label.localeCompare(b.label));
  if (input.makeDefault === true || !cfg.defaultAccountId) cfg.defaultAccountId = id;
  return id;
}

function accountEnabledOf(input: Record<string, unknown>, existing?: AiAccountStored): boolean {
  if (input.accountEnabled !== undefined) return input.accountEnabled === true;
  if (input.enabled !== undefined) return input.enabled === true;
  return existing?.enabled ?? true;
}

export function removeAiAccount(cfg: AiSettings, id: string): void {
  cfg.accounts = cfg.accounts.filter((row) => row.id !== id);
  cfg.fallbackOrder = cfg.fallbackOrder.filter((item) => item !== id);
  if (cfg.defaultAccountId === id) {
    const ready = cfg.accounts.find(accountReady);
    cfg.defaultAccountId = ready?.id || cfg.accounts[0]?.id || '';
  }
}

export function setDefaultAiAccount(cfg: AiSettings, id: string): void {
  if (!cfg.accounts.some((row) => row.id === id)) fail(404, 'That AI account was not found.');
  cfg.defaultAccountId = id;
}

function readAccount(row: Record<string, unknown>): AiAccountStored {
  return {
    id: optional(row.id, 40),
    label: optional(row.label, 80),
    provider: providerOf(String(row.provider || 'openai')),
    model: optional(row.model, 120),
    apiKeyEnc: optional(row.apiKeyEnc, 1200),
    baseUrl: optional(row.baseUrl, 300),
    enabled: row.enabled !== false,
  };
}

function providerOf(value: string): AiProvider {
  const key = value.toLowerCase() as AiProvider;
  return key in AI_PROVIDER_LABELS ? key : 'openai';
}