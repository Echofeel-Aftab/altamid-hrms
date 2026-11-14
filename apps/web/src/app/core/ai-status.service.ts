import { Injectable } from '@angular/core';

/** Lets Settings → Integrations → AI tell the chat widget to reload bootstrap after save. */
@Injectable({ providedIn: 'root' })
export class AiStatusService {
  private generation = 0;
  private listeners = new Set<() => void>();

  bump(): void {
    this.generation += 1;
    for (const listen of this.listeners) listen();
  }

  onChange(listen: () => void): () => void {
    this.listeners.add(listen);
    return () => this.listeners.delete(listen);
  }

  version(): number {
    return this.generation;
  }
}
