import { Injectable } from '@angular/core';
import { Me } from './models';

@Injectable({ providedIn: 'root' })
export class SessionStore {
  me: Me | null = null;

  clear(): void {
    this.me = null;
  }
}
