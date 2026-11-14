import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { buildSystemPrompt, chipsForAccess } from './ai-context';
import { chatAccount, pingAccount, ProviderAccount } from './ai-providers';
import { accountReady, AiSettings, ChatMessage } from './ai.types';
import { AiToolsService } from './ai-tools';
import { openSecret } from './crypto';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { SettingsService } from './settings.service';

@Injectable()
export class AiService {
  constructor(
    private readonly settings: SettingsService,
    private readonly tools: AiToolsService,
    private readonly gates: AccessService,
    private readonly prisma: PrismaService,
  ) {}

  async bootstrap(session: SessionUser) {
    const cfg = await this.settings.aiConfig(session.companyId);
    const ready = cfg.enabled && cfg.accounts.some(accountReady);
    const keys = await this.gates.keys(session);
    return {
      enabled: cfg.enabled,
      ready,
      chips: ready ? chipsForAccess(keys, session.role) : [],
      canAct: session.role === 'owner' || (await this.gates.holds(session, 'people.edit')) || (await this.gates.holds(session, 'approvals')),
    };
  }

  async chatForStaff(
    session: SessionUser,
    history: ChatMessage[],
    pagePath = '',
  ): Promise<{ text: string; accountId: string; stub: boolean; confirm: unknown; trace: Array<{ name: string; ok: boolean; message: string }>; path?: string }> {
    const cfg = await this.settings.aiConfig(session.companyId);
    if (!cfg.enabled) {
      return {
        text: 'AI is turned off in Settings → AI. Ask HR to enable the assistant and paste a provider key.',
        accountId: '',
        stub: true,
        confirm: null,
        trace: [],
      };
    }
    if (!cfg.accounts.some(accountReady)) {
      return {
        text: 'AI is on, but no provider account is ready. Under Settings → AI, add an API key and keep that account enabled.',
        accountId: '',
        stub: true,
        confirm: null,
        trace: [],
      };
    }
    const company = await this.prisma.company.findUnique({ where: { id: session.companyId }, select: { name: true } });
    const keys = await this.gates.keys(session);
    let rulesSummary = '';
    try {
      const time = await this.settings.timeRules(session.companyId);
      const week = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      rulesSummary = `Shift ${time.shiftStart}–${time.shiftEnd}, grace ${time.graceMinutes} min, week off: ${time.weekOff.map((d) => week[d]).join(', ') || 'none'}.`;
    } catch {
      rulesSummary = '';
    }
    const system = buildSystemPrompt(session, {
      path: pagePath.slice(0, 200),
      companyName: company?.name || 'Company',
      keys,
      rulesSummary,
    });
    const userTurns = history
      .filter((row) => row.role === 'user' || row.role === 'assistant')
      .slice(-16)
      .map((row) => ({ role: row.role, content: row.content.slice(0, 6000) } as ChatMessage));
    const messages: ChatMessage[] = [{ role: 'system', content: system }, ...userTurns];
    const tools = await this.tools.schemasFor(session);
    const order = this.tryOrder(cfg);
    let lastMessage = 'No AI account is ready.';
    for (const id of order) {
      const row = cfg.accounts.find((item) => item.id === id);
      if (!row || !accountReady(row)) continue;
      const provider: ProviderAccount = {
        provider: row.provider,
        model: row.model,
        apiKey: openSecret(row.apiKeyEnc, this.settings.dataKeyBuffer()),
        baseUrl: row.baseUrl,
      };
      const result = await this.orchestrate(session, provider, messages, tools);
      if (result.ok) {
        return {
          text: result.text,
          accountId: row.id,
          stub: false,
          confirm: result.confirm,
          trace: result.trace,
          path: result.path,
        };
      }
      lastMessage = result.message || lastMessage;
      if (!result.retryable) break;
    }
    return { text: lastMessage, accountId: '', stub: true, confirm: null, trace: [] };
  }

  async confirmAction(session: SessionUser, tool: string, args: Record<string, unknown>) {
    return this.tools.executeConfirmed(session, tool, args);
  }

  async testAccount(companyId: string, accountId: string): Promise<{ ok: boolean; message: string }> {
    const cfg = await this.settings.aiConfig(companyId);
    const row = cfg.accounts.find((item) => item.id === accountId);
    if (!row || !accountReady(row)) return { ok: false, message: 'Save a provider, API key and model first.' };
    const provider: ProviderAccount = {
      provider: row.provider,
      model: row.model,
      apiKey: openSecret(row.apiKeyEnc, this.settings.dataKeyBuffer()),
      baseUrl: row.baseUrl,
    };
    return pingAccount(provider);
  }

  private async orchestrate(
    session: SessionUser,
    provider: ProviderAccount,
    seed: ChatMessage[],
    tools: Awaited<ReturnType<AiToolsService['schemasFor']>>,
  ): Promise<{ ok: boolean; text: string; message: string; retryable?: boolean; confirm: unknown; trace: Array<{ name: string; ok: boolean; message: string }>; path?: string }> {
    const messages = [...seed];
    const trace: Array<{ name: string; ok: boolean; message: string }> = [];
    let confirm: unknown = null;
    let path: string | undefined;
    let last = await chatAccount(provider, messages, tools);
    if (!last.ok && !(last.tool_calls || []).length) {
      return { ok: false, text: '', message: last.message, retryable: last.retryable, confirm: null, trace };
    }
    for (let round = 0; round < 6; round++) {
      const calls = last.tool_calls || [];
      if (!calls.length) {
        const text = last.text.trim() || 'I looked that up but have nothing further to add.';
        return { ok: true, text, message: 'ok', confirm, trace, path };
      }
      messages.push({
        role: 'assistant',
        content: last.text || '',
        tool_calls: calls.map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) },
        })),
      });
      for (const call of calls) {
        const result = await this.tools.run(session, call.name, call.arguments || {});
        trace.push({ name: call.name, ok: result.ok, message: result.message });
        if (result.confirm) confirm = result.confirm;
        if (result.path) path = result.path;
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: JSON.stringify(result),
        });
      }
      if (confirm) {
        return {
          ok: true,
          text: 'I can do this, but I need you to confirm first.',
          message: 'ok',
          confirm,
          trace,
          path,
        };
      }
      last = await chatAccount(provider, messages, tools);
      if (!last.ok && !(last.tool_calls || []).length) {
        return { ok: false, text: '', message: last.message, retryable: last.retryable, confirm, trace, path };
      }
    }
    return {
      ok: true,
      text: last.text.trim() || 'I reached the tool limit for this turn. Ask a narrower question.',
      message: 'ok',
      confirm,
      trace,
      path,
    };
  }

  private tryOrder(cfg: AiSettings): string[] {
    const ids = new Set<string>();
    const out: string[] = [];
    const add = (id: string) => {
      if (id && !ids.has(id)) {
        ids.add(id);
        out.push(id);
      }
    };
    add(cfg.defaultAccountId);
    for (const id of cfg.fallbackOrder) add(id);
    for (const row of cfg.accounts) if (row.enabled) add(row.id);
    return out;
  }
}
