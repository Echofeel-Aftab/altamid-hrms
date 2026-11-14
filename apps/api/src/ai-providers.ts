import { AiProvider, ChatMessage, ToolCall, ToolSchema } from './ai.types';

export interface ProviderAccount {
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export interface ChatResult {
  ok: boolean;
  message: string;
  text: string;
  status?: number;
  retryable?: boolean;
  tool_calls?: ToolCall[];
}

const TIMEOUT_MS = 60000;

async function httpJson(method: string, url: string, headers: Record<string, string>, body?: unknown): Promise<{ code: number; json: unknown; raw: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let json: unknown = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = {};
    }
    return { code: response.status, json, raw };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error';
    return { code: 0, json: {}, raw: message };
  } finally {
    clearTimeout(timer);
  }
}

function errMessage(res: { code: number; json: unknown; raw: string }): string {
  const json = res.json as Record<string, unknown>;
  const error = json.error as Record<string, unknown> | undefined;
  const piece = String(error?.message || json.message || res.raw || '').trim();
  return piece.slice(0, 280);
}

function openAiUrl(account: ProviderAccount, azure: boolean): { url: string; headers: Record<string, string> } {
  if (azure) {
    const base = account.baseUrl.replace(/\/$/, '');
    return {
      url: `${base}/openai/deployments/${encodeURIComponent(account.model)}/chat/completions?api-version=2024-06-01`,
      headers: { 'api-key': account.apiKey, 'Content-Type': 'application/json' },
    };
  }
  if (account.provider === 'compatible') {
    const base = account.baseUrl.replace(/\/$/, '');
    return {
      url: `${base}/chat/completions`,
      headers: { Authorization: `Bearer ${account.apiKey}`, 'Content-Type': 'application/json' },
    };
  }
  return {
    url: 'https://api.openai.com/v1/chat/completions',
    headers: { Authorization: `Bearer ${account.apiKey}`, 'Content-Type': 'application/json' },
  };
}

function retryable(code: number): boolean {
  return code === 0 || code === 429 || code >= 500;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function pingAccount(account: ProviderAccount): Promise<{ ok: boolean; message: string }> {
  const probe = await chatAccount(account, [{ role: 'user', content: 'Reply with the word ok only.' }]);
  if (probe.ok) return { ok: true, message: 'Credentials accepted.' };
  return { ok: false, message: probe.message || 'Connection test failed.' };
}

export async function chatAccount(account: ProviderAccount, messages: ChatMessage[], tools: ToolSchema[] = []): Promise<ChatResult> {
  switch (account.provider) {
    case 'anthropic':
      return chatAnthropic(account, messages, tools);
    case 'gemini':
      return chatGemini(account, messages, tools);
    case 'azure':
      return chatOpenAi(account, messages, tools, true);
    case 'compatible':
      return chatOpenAi(account, messages, tools, false);
    default:
      return chatOpenAi(account, messages, tools, false);
  }
}

async function chatOpenAi(account: ProviderAccount, messages: ChatMessage[], tools: ToolSchema[], azure: boolean): Promise<ChatResult> {
  const { url, headers } = openAiUrl(account, azure);
  const model = azure ? undefined : account.model;
  const body: Record<string, unknown> = {
    messages: messages.map((m) => {
      const row: Record<string, unknown> = { role: m.role, content: m.content };
      if (m.tool_calls) row.tool_calls = m.tool_calls;
      if (m.tool_call_id) row.tool_call_id = m.tool_call_id;
      if (m.name) row.name = m.name;
      return row;
    }),
    temperature: 0.2,
  };
  if (model) body.model = model;
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const res = await httpJson('POST', url, headers, body);
  if (res.code < 200 || res.code >= 300) {
    return { ok: false, message: errMessage(res) || 'Model request failed.', text: '', status: res.code, retryable: retryable(res.code) };
  }
  const json = res.json as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      };
    }>;
  };
  const message = json.choices?.[0]?.message;
  const text = String(message?.content || '').trim();
  const tool_calls: ToolCall[] = (message?.tool_calls || [])
    .filter((call) => call.function?.name)
    .map((call, index) => ({
      id: call.id || `call_${index}`,
      name: String(call.function?.name || ''),
      arguments: parseArgs(String(call.function?.arguments || '{}')),
    }));
  return { ok: text !== '' || tool_calls.length > 0, message: 'ok', text, status: res.code, tool_calls };
}

async function chatAnthropic(account: ProviderAccount, messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult> {
  let system = '';
  const bodyMsgs: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + m.content;
      continue;
    }
    if (m.role === 'tool') {
      bodyMsgs.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.tool_call_id || '', content: m.content }],
      });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const content: Array<Record<string, unknown>> = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      for (const call of m.tool_calls) {
        content.push({ type: 'tool_use', id: call.id, name: call.function.name, input: parseArgs(call.function.arguments) });
      }
      bodyMsgs.push({ role: 'assistant', content });
      continue;
    }
    bodyMsgs.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content });
  }
  const payload: Record<string, unknown> = {
    model: account.model || 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    messages: bodyMsgs,
  };
  if (system) payload.system = system;
  if (tools.length) {
    payload.tools = tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
  }
  const res = await httpJson('POST', 'https://api.anthropic.com/v1/messages', {
    'x-api-key': account.apiKey,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  }, payload);
  if (res.code < 200 || res.code >= 300) {
    return { ok: false, message: errMessage(res) || 'Anthropic request failed.', text: '', status: res.code, retryable: retryable(res.code) };
  }
  const json = res.json as { content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> };
  const blocks = json.content || [];
  const text = blocks.filter((b) => b.type === 'text').map((b) => b.text || '').join('').trim();
  const tool_calls: ToolCall[] = blocks
    .filter((b) => b.type === 'tool_use' && b.name)
    .map((b, index) => ({
      id: b.id || `tool_${index}`,
      name: String(b.name),
      arguments: b.input && typeof b.input === 'object' ? b.input : {},
    }));
  return { ok: text !== '' || tool_calls.length > 0, message: 'ok', text, status: res.code, tool_calls };
}

async function chatGemini(account: ProviderAccount, messages: ChatMessage[], tools: ToolSchema[]): Promise<ChatResult> {
  let system = '';
  const contents: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + m.content;
      continue;
    }
    if (m.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.name || 'tool', response: parseArgs(m.content) } }],
      });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      contents.push({
        role: 'model',
        parts: m.tool_calls.map((call) => ({
          functionCall: { name: call.function.name, args: parseArgs(call.function.arguments) },
        })),
      });
      continue;
    }
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    });
  }
  const model = encodeURIComponent(account.model || 'gemini-2.0-flash');
  const key = encodeURIComponent(account.apiKey);
  const payload: Record<string, unknown> = { contents };
  if (system) payload.systemInstruction = { parts: [{ text: system }] };
  if (tools.length) {
    payload.tools = [{
      functionDeclarations: tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      })),
    }];
  }
  const res = await httpJson(
    'POST',
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    { 'Content-Type': 'application/json' },
    payload,
  );
  if (res.code < 200 || res.code >= 300) {
    return { ok: false, message: errMessage(res) || 'Gemini request failed.', text: '', status: res.code, retryable: retryable(res.code) };
  }
  const json = res.json as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }> } }>;
  };
  const parts = json.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || '').join('').trim();
  const tool_calls: ToolCall[] = parts
    .filter((p) => p.functionCall?.name)
    .map((p, index) => ({
      id: `gemini_${index}`,
      name: String(p.functionCall?.name),
      arguments: p.functionCall?.args && typeof p.functionCall.args === 'object' ? p.functionCall.args : {},
    }));
  return { ok: text !== '' || tool_calls.length > 0, message: 'ok', text, status: res.code, tool_calls };
}
