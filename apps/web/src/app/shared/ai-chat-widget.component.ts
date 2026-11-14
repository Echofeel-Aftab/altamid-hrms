import { Component, ElementRef, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AiStatusService } from '../core/ai-status.service';
import { ApiService } from '../core/api.service';

interface ChatLine {
  role: 'user' | 'assistant';
  content: string;
}

interface Chip {
  id: string;
  label: string;
  prompt: string;
}

interface ConfirmCard {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  hint?: string;
}

interface Boot {
  enabled: boolean;
  ready: boolean;
  chips: Chip[];
  canAct?: boolean;
}

@Component({
  selector: 'app-ai-chat-widget',
  imports: [FormsModule],
  template: `
    <button type="button" class="ai-chat-fab" (click)="toggle()" aria-label="Open assistant">
      <i class="bi bi-stars"></i>
    </button>
    @if (open()) {
      <section class="ai-chat-panel card" aria-label="Assistant">
        <header class="ai-chat-head">
          <div>
            <strong>HRMS assistant</strong>
            <small class="muted">{{ statusLabel() }}</small>
          </div>
          <div class="ai-chat-head-actions">
            @if (chips().length && ready()) {
              <button type="button" class="btn btn-ghost btn-sm" (click)="showChips.set(!showChips())" [attr.aria-expanded]="showChips()">
                <i class="bi bi-lightbulb"></i>
                {{ showChips() ? 'Hide tips' : 'Tips' }}
              </button>
            }
            <button type="button" class="icon-btn" (click)="toggle()" aria-label="Close assistant"><i class="bi bi-x-lg"></i></button>
          </div>
        </header>
        @if (chips().length && ready() && showChips()) {
          <div class="ai-chat-chips" role="list">
            @for (chip of chips(); track chip.id) {
              <button type="button" class="ai-chip" role="listitem" (click)="ask(chip.prompt)" [disabled]="busy()">{{ chip.label }}</button>
            }
          </div>
        }
        <div class="ai-chat-log" #log>
          @for (line of lines(); track $index) {
            <div class="ai-chat-line" [class.is-user]="line.role === 'user'">
              <p>{{ line.content }}</p>
            </div>
          }
          @if (confirm()) {
            <div class="ai-confirm card">
              <strong>{{ confirm()!.summary }}</strong>
              @if (confirm()!.hint) { <p class="muted small">{{ confirm()!.hint }}</p> }
              <div class="ai-confirm-actions">
                <button type="button" class="btn btn-gold btn-sm" (click)="confirmYes()" [disabled]="busy()">Confirm</button>
                <button type="button" class="btn btn-ghost btn-sm" (click)="confirmNo()" [disabled]="busy()">Cancel</button>
              </div>
            </div>
          }
          @if (busy()) { <p class="ai-chat-line muted">Thinking…</p> }
        </div>
        <form class="ai-chat-compose" (ngSubmit)="send()">
          <textarea rows="2" [(ngModel)]="draft" name="draft" placeholder="Ask about rules, people, reports…" [disabled]="busy() || !ready()" (keydown.enter)="onEnter($event)"></textarea>
          <button class="btn btn-gold ai-chat-send" type="submit" [disabled]="busy() || !ready() || !draft.trim()" aria-label="Send">
            <i class="bi bi-send"></i>
          </button>
        </form>
      </section>
    }
  `,
})
export class AiChatWidgetComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly aiStatus = inject(AiStatusService);
  private stopListen: (() => void) | null = null;
  private readonly log = viewChild<ElementRef<HTMLElement>>('log');
  open = signal(false);
  busy = signal(false);
  ready = signal(false);
  enabled = signal(false);
  showChips = signal(true);
  chips = signal<Chip[]>([]);
  confirm = signal<ConfirmCard | null>(null);
  lines = signal<ChatLine[]>([]);
  draft = '';

  async ngOnInit(): Promise<void> {
    await this.refresh(true);
    this.stopListen = this.aiStatus.onChange(() => {
      void this.refresh(true);
    });
  }

  ngOnDestroy(): void {
    this.stopListen?.();
  }

  statusLabel(): string {
    if (this.ready()) return 'Bound to your sign-in and access';
    if (this.enabled()) return 'Add a provider key in Settings → Integrations → AI';
    return 'Turn on in Settings → Integrations → AI';
  }

  async toggle(): Promise<void> {
    const next = !this.open();
    this.open.set(next);
    if (next) await this.refresh(false);
  }

  ask(prompt: string): void {
    if (!this.ready()) return;
    this.showChips.set(false);
    this.draft = prompt;
    void this.send();
  }

  onEnter(event: Event): void {
    const key = event as KeyboardEvent;
    if (key.shiftKey) return;
    key.preventDefault();
    void this.send();
  }

  async send(): Promise<void> {
    const text = this.draft.trim();
    if (!text || this.busy() || !this.ready()) return;
    this.draft = '';
    this.showChips.set(false);
    this.confirm.set(null);
    const history = [...this.lines(), { role: 'user' as const, content: text }];
    this.lines.set(history);
    this.busy.set(true);
    this.scrollLog();
    try {
      const reply = await this.api.post<{ text: string; confirm?: ConfirmCard | null; path?: string; stub?: boolean }>('/v1/ai/chat', {
        pagePath: this.router.url.split('?')[0] || '/',
        messages: history.map((line) => ({ role: line.role, content: line.content })),
      });
      this.lines.set([...history, { role: 'assistant', content: reply.text || 'No reply.' }]);
      if (reply.confirm) this.confirm.set(reply.confirm);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not reach the assistant.';
      this.lines.set([...history, { role: 'assistant', content: message }]);
    } finally {
      this.busy.set(false);
      this.scrollLog();
    }
  }

  private scrollLog(): void {
    queueMicrotask(() => {
      const el = this.log()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async confirmYes(): Promise<void> {
    const card = this.confirm();
    if (!card || this.busy()) return;
    this.busy.set(true);
    try {
      const result = await this.api.post<{ ok: boolean; message: string; path?: string; data?: { url?: string; path?: string } }>('/v1/ai/confirm', {
        tool: card.tool,
        args: card.args,
      });
      this.confirm.set(null);
      const path = result.path || result.data?.url || result.data?.path || '';
      const note = result.message + (path ? ` Opening ${path}.` : '');
      this.lines.set([...this.lines(), { role: 'assistant', content: note }]);
      this.scrollLog();
      if (path) await this.router.navigateByUrl(path);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not confirm.';
      this.lines.set([...this.lines(), { role: 'assistant', content: message }]);
      this.scrollLog();
    } finally {
      this.busy.set(false);
    }
  }

  confirmNo(): void {
    this.confirm.set(null);
    this.lines.set([...this.lines(), { role: 'assistant', content: 'Cancelled. Ask something else whenever you are ready.' }]);
  }

  private async refresh(resetGreeting: boolean): Promise<void> {
    try {
      const boot = await this.api.get<Boot>('/v1/ai/bootstrap');
      this.enabled.set(!!boot.enabled);
      this.ready.set(!!boot.ready);
      this.chips.set(boot.chips || []);
      if (resetGreeting || !this.lines().length) this.lines.set([{ role: 'assistant', content: this.greeting(boot) }]);
    } catch {
      this.enabled.set(false);
      this.ready.set(false);
      this.chips.set([]);
      if (resetGreeting || !this.lines().length) {
        this.lines.set([{ role: 'assistant', content: 'Could not load the assistant. Refresh the page, or check Settings → Integrations → AI.' }]);
      }
    }
  }

  private greeting(boot: Boot): string {
    if (boot.ready) {
      return 'Hi. I can explain HRMS features and company rules, check violations, open screens, and brief reports — only for areas your sign-in can access, and only with people data you are allowed to see.';
    }
    if (boot.enabled) {
      return 'AI is on, but no provider account is ready yet. Under Settings → Integrations → AI, add a key (OpenAI, Claude, Gemini, Azure or compatible) and keep the account enabled.';
    }
    return 'AI is off. An HR admin can enable it under Settings → Integrations → AI and add one or more provider keys with fallback order.';
  }
}
