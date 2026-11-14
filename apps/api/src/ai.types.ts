export type AiProvider = 'openai' | 'anthropic' | 'gemini' | 'azure' | 'compatible';

export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google Gemini',
  azure: 'Azure OpenAI',
  compatible: 'OpenAI-compatible',
};

export interface AiAccountStored {
  id: string;
  label: string;
  provider: AiProvider;
  model: string;
  apiKeyEnc: string;
  baseUrl: string;
  enabled: boolean;
}

export interface AiSettings {
  enabled: boolean;
  defaultAccountId: string;
  fallbackOrder: string[];
  accounts: AiAccountStored[];
}

export interface AiAccountView {
  id: string;
  label: string;
  provider: AiProvider;
  providerLabel: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
  default: boolean;
  configured: boolean;
  keyMask: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

export interface ToolSchema {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export function defaultAiSettings(): AiSettings {
  return { enabled: false, defaultAccountId: '', fallbackOrder: [], accounts: [] };
}

export function defaultModel(provider: AiProvider): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o-mini';
    case 'anthropic':
      return 'claude-sonnet-4-20250514';
    case 'gemini':
      return 'gemini-2.0-flash';
    default:
      return '';
  }
}

export function accountReady(row: Pick<AiAccountStored, 'provider' | 'model' | 'apiKeyEnc' | 'baseUrl' | 'enabled'>): boolean {
  if (!row.enabled) return false;
  const key = row.apiKeyEnc;
  const model = row.model.trim();
  const base = row.baseUrl.trim();
  if (row.provider === 'compatible') return base !== '' && model !== '';
  if (row.provider === 'azure') return key !== '' && base !== '' && model !== '';
  if (row.provider === 'gemini') return key !== '' && model !== '';
  return key !== '' && model !== '';
}
