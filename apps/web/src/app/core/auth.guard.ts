import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ApiService } from './api.service';
import { Me } from './models';
import { SessionStore } from './session.store';

async function loadMe(api: ApiService, store: SessionStore): Promise<boolean> {
  if (store.me) return true;
  try {
    store.me = await api.get<Me>('/v1/me');
    const outlets = store.me.outlets;
    if (outlets && api.outlet) {
      const actual = outlets.current ?? 'all';
      if (actual !== api.outlet) api.setOutlet(actual);
    }
    return true;
  } catch {
    api.setToken('');
    store.clear();
    return false;
  }
}

export const authGuard: CanActivateFn = async () => {
  const api = inject(ApiService);
  const store = inject(SessionStore);
  const router = inject(Router);
  if (!api.token) return router.createUrlTree(['/login']);
  if (!(await loadMe(api, store))) return router.createUrlTree(['/login']);
  if ((store.me?.outlets?.list.length || 0) > 1 && !api.outlet) return router.createUrlTree(['/outlet']);
  return true;
};

/** The outlet picker only needs a sign-in. */
export const signedInGuard: CanActivateFn = async () => {
  const api = inject(ApiService);
  const store = inject(SessionStore);
  const router = inject(Router);
  if (!api.token) return router.createUrlTree(['/login']);
  if (!(await loadMe(api, store))) return router.createUrlTree(['/login']);
  return true;
};

export const guestGuard: CanActivateFn = () => {
  const api = inject(ApiService);
  const router = inject(Router);
  if (api.token) return router.createUrlTree(['/']);
  return true;
};
