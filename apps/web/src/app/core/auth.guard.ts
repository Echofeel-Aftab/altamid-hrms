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

/**
 * Soft web gate for Company desks. Pass any of the listed access keys (or `owner`).
 * API hard-403 remains the source of truth.
 */
export function featureGuard(...features: string[]): CanActivateFn {
  return async () => {
    const api = inject(ApiService);
    const store = inject(SessionStore);
    const router = inject(Router);
    if (!api.token) return router.createUrlTree(['/login']);
    if (!(await loadMe(api, store))) return router.createUrlTree(['/login']);
    if ((store.me?.outlets?.list.length || 0) > 1 && !api.outlet) return router.createUrlTree(['/outlet']);
    const access = store.me?.access || [];
    const ok = features.some((feature) => {
      if (feature === 'owner') return store.me?.role === 'owner';
      if (feature === 'settings') return access.includes('settings') || access.includes('access');
      return access.includes(feature);
    });
    return ok ? true : router.createUrlTree(['/']);
  };
}
