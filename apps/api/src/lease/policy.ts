/**
 * Normative lease types and the access decision every Altamid product must port.
 * Products ignore fields they do not know. They never invent a second rule.
 */

export const CONTRACT_VERSION = 1 as const;

export const USABLE_VERDICTS = ['trialing', 'active', 'grace', 'past_due'] as const;

export const VERDICTS = [
  'trialing',
  'active',
  'grace',
  'past_due',
  'not_started',
  'suspended',
  'expired',
  'revoked',
  'cancelled',
  'unknown_key',
  'unknown_product',
  'product_mismatch',
  'binding_mismatch',
  'binding_unbound',
  'instance_limit',
  'seats_exceeded',
  'update_required',
  'unlicensed',
  'invalid_request',
] as const;

export type Verdict = (typeof VERDICTS)[number];

export type StoredStatus =
  | 'trialing'
  | 'active'
  | 'grace'
  | 'past_due'
  | 'suspended'
  | 'expired'
  | 'revoked'
  | 'cancelled';

export type EffectiveStatus = StoredStatus | 'not_started';

export interface LeaseCommand {
  id: string;
  type: string;
  payload: Record<string, string | number | boolean | null>;
}

/** One subscription that opens one outlet (branch) inside a single install. */
export interface LeaseOutlet {
  subscriptionId: string;
  main: boolean;
  verdict: Verdict;
  usable: boolean;
  termEndsAt: string;
  seatLimit: number | null;
  seatsUsed: number | null;
}

export interface LeaseV1 {
  v: 1;
  product: string;
  subscriptionId: string;
  licenseKeyId: string;
  instanceId: string;
  verdict: Verdict;
  usable: boolean;
  status: string;
  termStartsAt: string;
  termEndsAt: string;
  graceDays: number;
  leaseExpiresAt: string;
  offline: { trust: 'until'; until: string };
  seats: {
    unit: string;
    limit: number | null;
    used: number | null;
    overLimit: boolean;
    enforced: boolean;
  };
  entitlements: {
    mode: 'all' | 'list';
    features: string[];
    limits: Record<string, number>;
  };
  binding: {
    kind: 'host' | 'device' | 'tenant';
    policy: 'any' | 'bind_first' | 'allowlist';
    value: string;
    allowed: string[];
  };
  release: {
    channel: string;
    latest: string | null;
    pinned: string | null;
    minimum: string | null;
    mustUpdate: boolean;
    blocking: boolean;
    hasPackage: boolean;
  };
  commands: LeaseCommand[];
  outlets?: { allowed: number; units: LeaseOutlet[] };
  message: string;
  iat: number;
  exp: number;
}

export interface AccessInput {
  now: number;
  transportFailed: boolean;
  fresh: LeaseV1 | null;
  stored: LeaseV1 | null;
}

export interface AccessDecision {
  access: 'allow' | 'restrict';
  source: 'fresh' | 'stored' | 'none';
  reason: string;
}

const MESSAGES: Record<Verdict, string> = {
  trialing: 'Trial is active.',
  active: 'Subscription is active.',
  grace: 'Subscription is in the grace window.',
  past_due: 'Payment is past due. Access continues through the grace window.',
  not_started: 'This subscription has not started yet.',
  suspended: 'Altamid has suspended this subscription.',
  expired: 'This subscription has expired.',
  revoked: 'This license has been revoked.',
  cancelled: 'This subscription is cancelled.',
  unknown_key: 'This license key is not issued.',
  unknown_product: 'This product code is not in Altamid Control.',
  product_mismatch: 'This license key belongs to a different Altamid product.',
  binding_mismatch: 'This install does not match the bound host or device.',
  binding_unbound: 'Send the host or device id before this install can run.',
  instance_limit: 'This subscription has reached its install limit.',
  seats_exceeded: 'This install is over its seat limit.',
  update_required: 'This install must move to the required version before it can run.',
  unlicensed: 'No license key was provided.',
  invalid_request: 'The check-in could not be read.',
};

export function verdictMessage(verdict: Verdict): string {
  return MESSAGES[verdict];
}

export function isVerdict(value: string): value is Verdict {
  return (VERDICTS as readonly string[]).includes(value);
}

export function utcDayStart(day: string): number {
  return Date.parse(day + 'T00:00:00Z');
}

export function utcDayEnd(day: string): number {
  return Date.parse(day + 'T23:59:59Z');
}

export function instantIso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function effectiveStatus(
  status: StoredStatus,
  startsAt: string,
  endsAt: string,
  graceDays: number,
  nowMs: number,
): EffectiveStatus {
  if (status === 'suspended' || status === 'revoked' || status === 'cancelled') {
    return status;
  }
  const start = utcDayStart(startsAt);
  const end = utcDayEnd(endsAt);
  if (nowMs < start) {
    return 'not_started';
  }
  if (nowMs <= end) {
    if (status === 'past_due') return 'past_due';
    if (status === 'trialing') return 'trialing';
    return 'active';
  }
  const graceEnd = end + Math.max(0, graceDays) * 86400000;
  if (nowMs <= graceEnd) {
    if (status === 'past_due') return 'past_due';
    return 'grace';
  }
  return 'expired';
}

export function isSemver(value: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(value);
}

export function compareSemver(a: string, b: string): number {
  const left = a.split('.').map((part) => Number(part));
  const right = b.split('.').map((part) => Number(part));
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

export function normalizeBinding(kind: 'host' | 'device' | 'tenant', value: string): string {
  const trimmed = value.trim();
  if (kind === 'device') return trimmed;
  return trimmed.toLowerCase().replace(/\.$/, '');
}

export interface AssembleInput {
  now: number;
  product: string;
  subscriptionId: string;
  licenseKeyId: string;
  instanceId: string;
  verdict: Verdict;
  status: string;
  termStartsAt: string;
  termEndsAt: string;
  graceDays: number;
  seatUnit: string;
  seatLimit: number | null;
  seatsUsed: number | null;
  enforceSeats: boolean;
  entitlementsMode: 'all' | 'list';
  features: string[];
  limits: Record<string, number>;
  bindingKind: 'host' | 'device' | 'tenant';
  bindingPolicy: 'any' | 'bind_first' | 'allowlist';
  bindingValue: string;
  allowed: string[];
  channel: string;
  latest: string | null;
  pinned: string | null;
  minimum: string | null;
  hasPackage: boolean;
  blockOutdated: boolean;
  reportedVersion: string;
  commands: LeaseCommand[];
  message?: string;
}

export function assembleLease(input: AssembleInput): LeaseV1 {
  let verdict = input.verdict;
  let usable = (USABLE_VERDICTS as readonly string[]).includes(verdict);
  const overLimit =
    input.seatLimit !== null && input.seatsUsed !== null && input.seatsUsed > input.seatLimit;
  if (usable && overLimit && input.enforceSeats) {
    verdict = 'seats_exceeded';
    usable = false;
  }

  const target = input.pinned || input.latest;
  let mustUpdate = false;
  if (input.reportedVersion && target) {
    if (isSemver(input.reportedVersion) && isSemver(target)) {
      mustUpdate = input.pinned
        ? compareSemver(input.reportedVersion, input.pinned) !== 0
        : compareSemver(input.reportedVersion, target) < 0;
    } else if (input.pinned && input.reportedVersion !== input.pinned) {
      mustUpdate = true;
    }
  }
  if (usable && input.blockOutdated && mustUpdate) {
    verdict = 'update_required';
    usable = false;
  }

  const startMs = utcDayStart(input.termStartsAt || '1970-01-01');
  const endMs = utcDayEnd(input.termEndsAt || '1970-01-01');
  const graceMs = endMs + Math.max(0, input.graceDays) * 86400000;
  const exp = input.now + 7 * 86400;

  return {
    v: 1,
    product: input.product,
    subscriptionId: input.subscriptionId,
    licenseKeyId: input.licenseKeyId,
    instanceId: input.instanceId,
    verdict,
    usable,
    status: input.status,
    termStartsAt: instantIso(startMs),
    termEndsAt: instantIso(endMs),
    graceDays: input.graceDays,
    leaseExpiresAt: instantIso(exp * 1000),
    offline: { trust: 'until', until: instantIso(usable ? graceMs : endMs) },
    seats: {
      unit: input.seatUnit,
      limit: input.seatLimit,
      used: input.seatsUsed,
      overLimit,
      enforced: input.enforceSeats,
    },
    entitlements: {
      mode: input.entitlementsMode,
      features: input.features,
      limits: input.limits,
    },
    binding: {
      kind: input.bindingKind,
      policy: input.bindingPolicy,
      value: input.bindingValue,
      allowed: input.allowed,
    },
    release: {
      channel: input.channel,
      latest: input.latest,
      pinned: input.pinned,
      minimum: input.minimum,
      mustUpdate,
      blocking: input.blockOutdated,
      hasPackage: input.hasPackage,
    },
    commands: input.commands,
    message: input.message || verdictMessage(verdict),
    iat: input.now,
    exp,
  };
}

/**
 * Caller verifies the signature first.
 * A failed signature is reported as transportFailed with fresh = null.
 * HTTP errors, timeouts, and rate limits are transportFailed as well.
 * Only a verified fresh lease may restrict a product immediately.
 */
export function decideAccess(input: AccessInput): AccessDecision {
  if (!input.transportFailed && input.fresh) {
    if (input.fresh.v !== 1 || typeof input.fresh.usable !== 'boolean') {
      return { access: 'restrict', source: 'fresh', reason: 'lease_not_understood' };
    }
    return {
      access: input.fresh.usable ? 'allow' : 'restrict',
      source: 'fresh',
      reason: input.fresh.verdict,
    };
  }

  const stored = input.stored;
  if (input.transportFailed && stored && stored.v === 1 && stored.usable === true) {
    const until = Date.parse(stored.offline?.until ?? '');
    if (Number.isFinite(until) && input.now * 1000 <= until) {
      return { access: 'allow', source: 'stored', reason: 'offline_until' };
    }
    return { access: 'restrict', source: 'stored', reason: 'offline_elapsed' };
  }

  return {
    access: 'restrict',
    source: 'none',
    reason: input.transportFailed ? 'unreachable' : 'no_lease',
  };
}
