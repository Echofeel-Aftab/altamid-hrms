import { inject, Injectable } from '@angular/core';
import { ApiService } from './api.service';

interface Entry { id: string; code: string; name: string; photo: string }

/** One list of who has a photo, loaded once and shared by every avatar. */
@Injectable({ providedIn: 'root' })
export class PhotoBook {
  private readonly api = inject(ApiService);
  private loading: Promise<void> | null = null;
  private loadedFor = '';
  private readonly listeners = new Set<() => void>();
  private byId = new Map<string, Entry>();
  private byCode = new Map<string, Entry>();
  private byName = new Map<string, Entry>();
  private urls = new Map<string, Promise<string>>();

  async find(ref: { id?: string; code?: string; name?: string }): Promise<{ id: string; stamp: string } | null> {
    if (this.loadedFor !== this.api.token) {
      this.loadedFor = this.api.token;
      this.loading = null;
      this.urls.clear();
    }
    if (!this.loading) this.loading = this.load();
    await this.loading;
    const entry = (ref.id && this.byId.get(ref.id))
      || (ref.code && this.byCode.get(ref.code.toUpperCase()))
      || (ref.name && this.byName.get(ref.name.trim().toLowerCase()))
      || null;
    return entry ? { id: entry.id, stamp: entry.photo } : null;
  }

  url(id: string, stamp: string): Promise<string> {
    const key = id + ':' + stamp;
    let pending = this.urls.get(key);
    if (!pending) {
      pending = this.api.blob('/v1/people/' + id + '/photo?v=' + encodeURIComponent(stamp)).then((blob) => URL.createObjectURL(blob));
      pending.catch(() => this.urls.delete(key));
      this.urls.set(key, pending);
    }
    return pending;
  }

  listen(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Call after a photo is added or removed so every avatar on screen follows. */
  update(id: string, stamp: string): void {
    const entry = this.byId.get(id);
    if (entry && entry.photo === stamp) return;
    if (!entry && !stamp) return;
    if (entry && !stamp) {
      this.byId.delete(id);
      this.byCode.delete(entry.code.toUpperCase());
      if (entry.name) this.byName.delete(entry.name.toLowerCase());
    } else if (entry) {
      entry.photo = stamp;
    } else {
      this.loading = this.load();
    }
    const done = this.loading || Promise.resolve();
    void done.then(() => this.listeners.forEach((callback) => callback()));
  }

  private async load(): Promise<void> {
    try {
      const rows = await this.api.get<Entry[]>('/v1/photos');
      this.byId = new Map(rows.map((row) => [row.id, row]));
      this.byCode = new Map(rows.map((row) => [row.code.toUpperCase(), row]));
      this.byName = new Map(rows.filter((row) => row.name).map((row) => [row.name.toLowerCase(), row]));
    } catch {
      this.loading = null;
    }
  }
}
