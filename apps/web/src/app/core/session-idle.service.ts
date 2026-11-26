import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from './api.service';
import { Me } from './models';
import { SessionStore } from './session.store';

const IDLE_MS = 2 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 5 * 60 * 1000;
const ACTIVITY = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'] as const;

/**
 * Keeps the JWT alive while the person is active, and signs them out after 2 hours idle.
 * Also mirrors login/logout across browser tabs via storage + BroadcastChannel.
 */
@Injectable({ providedIn: 'root' })
export class SessionIdleService {
  private readonly api = inject(ApiService);
  private readonly store = inject(SessionStore);
  private readonly router = inject(Router);
  private lastActivity = Date.now();
  private lastTouch = 0;
  private timer = 0;
  private channel: BroadcastChannel | null = null;
  private started = false;

  start(): void {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    this.lastActivity = Date.now();
    for (const name of ACTIVITY) {
      window.addEventListener(name, this.onActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('storage', this.onStorage);
    try {
      this.channel = new BroadcastChannel('altamid-hrms-auth');
      this.channel.onmessage = (event) => this.onBroadcast(event.data);
    } catch {
      this.channel = null;
    }
    this.api.onAuthChange = (token) => this.broadcast(token ? 'login' : 'logout');
    this.timer = window.setInterval(() => void this.tick(), 30_000);
  }

  stop(): void {
    if (!this.started || typeof window === 'undefined') return;
    this.started = false;
    for (const name of ACTIVITY) window.removeEventListener(name, this.onActivity);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('storage', this.onStorage);
    this.channel?.close();
    this.channel = null;
    window.clearInterval(this.timer);
    this.api.onAuthChange = null;
  }

  private readonly onActivity = (): void => {
    this.lastActivity = Date.now();
    void this.maybeTouch();
  };

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'visible') {
      this.lastActivity = Date.now();
      void this.maybeTouch();
    }
  };

  private readonly onStorage = (event: StorageEvent): void => {
    if (event.key !== 'altamid_hrms_token') return;
    if (!event.newValue) this.remoteLogout();
    else if (event.newValue !== this.api.token) this.remoteLogin(event.newValue);
  };

  private onBroadcast(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const msg = data as { type?: string; token?: string };
    if (msg.type === 'logout') this.remoteLogout();
    if (msg.type === 'login' && msg.token && msg.token !== this.api.token) this.remoteLogin(msg.token);
  }

  private broadcast(type: 'login' | 'logout'): void {
    try {
      this.channel?.postMessage({ type, token: type === 'login' ? this.api.token : '' });
    } catch { /* ignore */ }
  }

  private remoteLogin(token: string): void {
    this.api.applyRemoteToken(token);
    this.lastActivity = Date.now();
    this.store.clear();
    void this.api.get<Me>('/v1/me').then((me) => {
      this.store.me = me;
    }).catch(() => undefined);
  }

  private remoteLogout(): void {
    if (!this.api.token && !this.store.me) return;
    this.api.applyRemoteToken('');
    this.store.clear();
    if (!this.router.url.startsWith('/login')) {
      void this.router.navigateByUrl('/login?reason=idle');
    }
  }

  private async tick(): Promise<void> {
    if (!this.api.token) return;
    if (Date.now() - this.lastActivity >= IDLE_MS) {
      await this.idleOut();
      return;
    }
    await this.maybeTouch();
  }

  private async maybeTouch(): Promise<void> {
    if (!this.api.token) return;
    if (Date.now() - this.lastTouch < TOUCH_EVERY_MS) return;
    if (Date.now() - this.lastActivity > TOUCH_EVERY_MS) return;
    this.lastTouch = Date.now();
    try {
      const result = await this.api.post<{ token: string }>('/v1/auth/touch', {});
      if (result?.token) this.api.setToken(result.token, { silent: true });
    } catch {
      /* 401 clears token in ApiService */
    }
  }

  private async idleOut(): Promise<void> {
    try {
      await this.api.post('/v1/auth/logout', {});
    } catch { /* ignore */ }
    this.api.setToken('');
    this.store.clear();
    void this.router.navigateByUrl('/login?reason=idle');
  }
}
