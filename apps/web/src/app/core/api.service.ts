import { Injectable } from '@angular/core';

const TOKEN_KEY = 'altamid_hrms_token';
const OUTLET_KEY = 'altamid_hrms_outlet';
const UNREACHABLE = 'Cannot reach the HRMS server right now. It may be restarting. Refresh in a few seconds.';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  token = '';
  /** The outlet sent with every request, or "all" for a master viewing every outlet. Empty until one is chosen. */
  outlet = '';
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly recent = new Map<string, { at: number; data: unknown }>();

  constructor() {
    this.token = typeof localStorage === 'undefined' ? '' : localStorage.getItem(TOKEN_KEY) || '';
    this.outlet = typeof localStorage === 'undefined' ? '' : localStorage.getItem(OUTLET_KEY) || '';
  }

  setToken(token: string): void {
    this.token = token;
    this.inflight.clear();
    this.recent.clear();
    if (typeof localStorage === 'undefined') return;
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else {
      localStorage.removeItem(TOKEN_KEY);
      this.setOutlet('');
    }
  }

  setOutlet(outlet: string): void {
    this.outlet = outlet;
    this.inflight.clear();
    this.recent.clear();
    if (typeof localStorage === 'undefined') return;
    if (outlet) localStorage.setItem(OUTLET_KEY, outlet);
    else localStorage.removeItem(OUTLET_KEY);
  }

  get<T>(path: string): Promise<T> {
    const key = 'GET:' + this.outlet + ':' + path;
    const cached = this.recent.get(key);
    if (cached && Date.now() - cached.at < 2500) return Promise.resolve(cached.data as T);
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const request = this.send<T>('GET', path).then((data) => {
      this.recent.set(key, { at: Date.now(), data });
      return data;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.send('POST', path, body ?? {});
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.send('PATCH', path, body);
  }

  async blob(path: string): Promise<Blob> {
    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    if (this.outlet) headers['X-Outlet'] = this.outlet;
    const response = await this.reach('GET', path, { headers });
    if (!response.ok) {
      const reason = await response.json().then((body: { message?: unknown }) => (typeof body?.message === 'string' ? body.message : ''), () => '');
      throw new ApiError(reason || 'Could not load that file.', response.status);
    }
    return response.blob();
  }

  private async send<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = 'Bearer ' + this.token;
    if (this.outlet) headers['X-Outlet'] = this.outlet;
    const response = await this.reach(method, path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (response.headers.get('content-type') || '').includes('application/json');
    const data = json ? await response.json().catch(() => ({})) : {};
    if (!response.ok) {
      if (response.status >= 500 && !json) throw new ApiError(UNREACHABLE, response.status);
      const fallback = response.status >= 500
        ? `The server could not finish that (error ${response.status}). Try again. If it keeps happening, tell your admin.`
        : 'That did not work. Check the details and try again.';
      const message = typeof data.message === 'string' ? data.message : fallback;
      if (response.status === 401 && path !== '/v1/auth/login' && path !== '/v1/start') this.setToken('');
      throw new ApiError(message, response.status);
    }
    return data as T;
  }

  /** Reads are retried while the server restarts. Writes are sent once, so nothing is saved twice. */
  private async reach(method: string, path: string, init: RequestInit): Promise<Response> {
    const waits = method === 'GET' ? [800, 2000, 4000] : [];
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(path, init);
        const down = response.status === 502 || response.status === 503 || response.status === 504
          || (response.status === 500 && !(response.headers.get('content-type') || '').includes('application/json'));
        if (!down || attempt >= waits.length) return response;
      } catch {
        if (attempt >= waits.length) throw new ApiError(UNREACHABLE, 0);
      }
      await new Promise((resolve) => setTimeout(resolve, waits[attempt]));
    }
  }
}
