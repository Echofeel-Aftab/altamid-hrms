import { Injectable } from '@nestjs/common';
import { Company } from '@prisma/client';
import { dataKey, maskSecret, openSecret, seal } from './crypto';
import { fail } from './http';
import { decideAccess, isVerdict, LeaseV1, verdictMessage } from './lease/policy';
import { verifyLeaseSignature } from './lease/verify';
import { currentScope, unscoped } from './outlet-context';
import { PrismaService } from './prisma.service';
import { PRODUCT_CODE, PRODUCT_VERSION } from './version';

const PACKAGE_LABELS: Record<string, string> = {
  'hrms-payroll': 'HRMS & Payroll',
  crm: 'CRM',
};

export interface LicenceView {
  mode: 'setup' | 'allow' | 'restrict';
  reason: string;
  message: string;
  checkedAt: string | null;
  product: string;
  packageLabel: string;
  seats: number;
  seatLimit: number | null;
  termStartsAt: string | null;
  termEndsAt: string | null;
  status: string;
  hasKey: boolean;
  active: boolean;
  keyHint: string;
  bindingHost: string;
  outlets: OutletAllowance;
}

/** How many outlets the subscriptions behind this install pay for. Without outlet subscriptions an install runs one outlet. */
export interface OutletAllowance {
  allowed: number;
  units: Array<{ subscriptionId: string; main: boolean; usable: boolean; verdict: string; termEndsAt: string; seatLimit: number | null; seatsUsed: number | null }>;
}

@Injectable()
export class LicenceService {
  private readonly key = dataKey();

  constructor(private readonly prisma: PrismaService) {}

  async view(companyId: string): Promise<LicenceView> {
    const company = await this.company(companyId);
    return this.toView(company, await this.seats(companyId));
  }

  async assertCanHire(companyId: string): Promise<void> {
    const access = await this.refreshIfStale(companyId);
    if (access.mode === 'restrict') {
      fail(403, 'New people are paused until the Altamid Control subscription is usable again. Existing records stay available.');
    }
    if (await this.outletPaused(companyId, access)) {
      fail(403, 'New people are paused in this outlet until its HRMS subscription is usable again. Existing records stay available.');
    }
  }

  async assertCanRunPayroll(companyId: string): Promise<void> {
    const access = await this.refreshIfStale(companyId);
    if (access.mode === 'restrict') {
      fail(403, 'Payroll runs stay paused until the Altamid Control subscription is usable again. Published slips stay available.');
    }
    if (await this.outletPaused(companyId, access)) {
      fail(403, 'Payroll runs are paused in this outlet until its HRMS subscription is usable again. Published slips stay available.');
    }
  }

  /** Refuses a new outlet once every outlet the subscriptions pay for is open. Returns the subscription the new outlet uses. */
  async assertCanOpenOutlet(companyId: string): Promise<string> {
    const access = await this.refreshIfStale(companyId);
    const open = await this.prisma.outlet.findMany({ where: { companyId, status: 'active' }, select: { subscriptionId: true } });
    const allowed = access.outlets.allowed;
    if (open.length >= allowed) {
      fail(403, allowed > 1
        ? `Your HRMS subscriptions cover ${allowed} outlets and all of them are open. Add another HRMS subscription in Altamid Control to open one more.`
        : 'Your HRMS subscription covers one outlet. Add another HRMS subscription in Altamid Control to open a second outlet.');
    }
    const taken = new Set(open.map((row) => row.subscriptionId));
    const unit = access.outlets.units.find((row) => !row.main && row.usable && !taken.has(row.subscriptionId))
      || access.outlets.units.find((row) => !row.main && !taken.has(row.subscriptionId));
    if (!unit) fail(403, 'Every HRMS outlet subscription is already in use. Add another in Altamid Control to open one more outlet.');
    return unit.subscriptionId;
  }

  private async outletPaused(companyId: string, access: LicenceView): Promise<boolean> {
    const outletId = currentScope()?.current;
    if (!outletId || !access.outlets.units.length) return false;
    const outlet = await this.prisma.outlet.findUnique({ where: { id: outletId }, select: { subscriptionId: true } });
    const unit = access.outlets.units.find((row) => (outlet?.subscriptionId ? row.subscriptionId === outlet.subscriptionId : row.main));
    return unit ? !unit.usable : false;
  }

  async saveAndCheck(companyId: string, licenseKey: string | null, bindingHost: string | null): Promise<LicenceView> {
    const company = await this.company(companyId);
    const data: { licenseKeyEnc?: string; bindingHost?: string; leaseJson?: string; leaseCheckedAt?: null } = {};
    if (licenseKey !== null) {
      data.licenseKeyEnc = licenseKey ? seal(licenseKey.trim(), this.key) : '';
      if (!licenseKey.trim()) {
        data.leaseJson = '';
        data.leaseCheckedAt = null;
      }
    }
    const host = (bindingHost || '').trim() || this.defaultHost() || company.bindingHost || '';
    if (host && (bindingHost || (licenseKey && licenseKey.trim()) || !company.bindingHost)) {
      data.bindingHost = host;
    }
    if (Object.keys(data).length) {
      await this.prisma.company.update({ where: { id: companyId }, data });
    }
    const next = await this.company(companyId);
    if (!next.licenseKeyEnc) return this.toView(next, await this.seats(companyId));
    return this.checkIn(companyId);
  }

  /** Hostname from WEB_ORIGIN so the owner only pastes the license key. */
  private defaultHost(): string {
    const origin = (process.env.WEB_ORIGIN || '').trim().replace(/\/$/, '');
    if (!origin) return '';
    try {
      return new URL(origin).hostname;
    } catch {
      return origin.replace(/^https?:\/\//i, '').split('/')[0] || '';
    }
  }

  /** Checks in with Altamid Control when the stored lease is older than 15 minutes. */
  refresh(companyId: string): Promise<LicenceView> {
    return this.refreshIfStale(companyId);
  }

  private async refreshIfStale(companyId: string): Promise<LicenceView> {
    const company = await this.company(companyId);
    if (!company.licenseKeyEnc) return this.toView(company, await this.seats(companyId));
    const age = company.leaseCheckedAt ? Date.now() - company.leaseCheckedAt.getTime() : Number.POSITIVE_INFINITY;
    if (age > 15 * 60 * 1000) return this.checkIn(companyId);
    return this.toView(company, await this.seats(companyId));
  }

  private async checkIn(companyId: string): Promise<LicenceView> {
    const company = await this.company(companyId);
    const seats = await this.seats(companyId);
    const stored = this.readLease(company.leaseJson);
    let fresh: LeaseV1 | null = null;
    let transportFailed = true;
    try {
      const signed = await this.postCheck(company, seats, await this.outletSeats(companyId, stored));
      const keys = await this.controlKeys();
      const match = keys.find((item) => item.kid === signed.kid) || keys[0];
      if (match && verifyLeaseSignature(signed.lease, signed.signature, match.publicKeyRaw)) {
        fresh = signed.lease;
        transportFailed = false;
        await this.prisma.company.update({
          where: { id: companyId },
          data: { leaseJson: JSON.stringify(fresh), leaseCheckedAt: new Date() },
        });
      }
    } catch {
      transportFailed = true;
    }
    const decision = decideAccess({
      now: Math.floor(Date.now() / 1000),
      transportFailed,
      fresh,
      stored,
    });
    const view = this.toView(await this.company(companyId), seats);
    return {
      ...view,
      mode: decision.access === 'allow' ? 'allow' : 'restrict',
      reason: decision.reason,
      message: this.message(decision.access, decision.reason, transportFailed),
      active: decision.access === 'allow',
      checkedAt: new Date().toISOString(),
    };
  }

  private allowance(lease: LeaseV1 | null): OutletAllowance {
    const outlets = lease?.outlets;
    if (!outlets || !Array.isArray(outlets.units) || !Number.isSafeInteger(outlets.allowed)) return { allowed: 1, units: [] };
    return {
      allowed: Math.max(0, outlets.allowed),
      units: outlets.units.map((unit) => ({
        subscriptionId: String(unit.subscriptionId),
        main: unit.main === true,
        usable: unit.usable === true,
        verdict: String(unit.verdict),
        termEndsAt: String(unit.termEndsAt),
        seatLimit: unit.seatLimit ?? null,
        seatsUsed: unit.seatsUsed ?? null,
      })),
    };
  }

  private message(access: 'allow' | 'restrict', reason: string, transportFailed: boolean): string {
    if (access === 'allow' && reason === 'offline_until') {
      return 'Altamid Control could not be reached. This company stays open until the offline window ends.';
    }
    if (access === 'allow' && isVerdict(reason)) return verdictMessage(reason);
    if (access === 'allow') return 'Subscription is active.';
    if (transportFailed && (reason === 'unreachable' || reason === 'no_lease')) {
      return 'Altamid Control could not be reached, and there is no usable lease stored. New people stay paused until the next successful check-in. Existing records stay available.';
    }
    if (isVerdict(reason)) {
      return verdictMessage(reason) + ' New people and payroll runs stay paused. Existing records stay available.';
    }
    return 'This install is restricted. Existing records stay available.';
  }

  /** Headcount per outlet, keyed by the subscription that opened it, so each subscription's seat limit counts its own people. */
  private async outletSeats(companyId: string, stored: LeaseV1 | null): Promise<Record<string, number> | null> {
    const main = stored?.outlets?.units?.find((unit) => unit.main)?.subscriptionId;
    if (!main) return null;
    const [outlets, groups] = await Promise.all([
      this.prisma.outlet.findMany({ where: { companyId }, select: { id: true, subscriptionId: true } }),
      unscoped(() => this.prisma.employee.groupBy({ by: ['outletId'], where: { companyId, status: { in: ['active', 'onboarding'] } }, _count: { _all: true } })),
    ]);
    const counts: Record<string, number> = { [main]: 0 };
    for (const outlet of outlets) {
      const key = outlet.subscriptionId || main;
      counts[key] = (counts[key] || 0) + (groups.find((row) => row.outletId === outlet.id)?._count._all || 0);
    }
    return counts;
  }

  private async postCheck(company: Company, seats: number, outlets: Record<string, number> | null): Promise<{ kid: string; signature: string; lease: LeaseV1 }> {
    const url = (process.env.CONTROL_URL || 'http://127.0.0.1:4100').replace(/\/$/, '');
    const response = await fetch(url + '/v1/lease/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        product: PRODUCT_CODE,
        license_key: openSecret(company.licenseKeyEnc, this.key),
        instance_id: company.instanceId,
        binding: company.bindingHost || 'localhost',
        runtime: 'node',
        version: PRODUCT_VERSION,
        usage: outlets ? { seats, outlets } : { seats },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error('control');
    const body = (await response.json()) as { ok?: boolean; kid?: string; signature?: string; lease?: LeaseV1 };
    if (!body.ok || !body.lease || !body.signature) throw new Error('control');
    return { kid: String(body.kid || ''), signature: String(body.signature), lease: body.lease };
  }

  private async controlKeys(): Promise<Array<{ kid: string; publicKeyRaw: string }>> {
    const url = (process.env.CONTROL_URL || 'http://127.0.0.1:4100').replace(/\/$/, '');
    const response = await fetch(url + '/v1/keys', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('keys');
    const body = (await response.json()) as { keys?: Array<{ kid?: string; publicKeyRaw?: string }> };
    const keys = (body.keys || [])
      .filter((item) => item.publicKeyRaw)
      .map((item) => ({ kid: String(item.kid || ''), publicKeyRaw: String(item.publicKeyRaw) }));
    if (!keys.length) throw new Error('keys');
    return keys;
  }

  private toView(company: Company, seats: number): LicenceView {
    const hasKey = Boolean(company.licenseKeyEnc);
    const keyHint = hasKey ? maskSecret(openSecret(company.licenseKeyEnc, this.key) || '••••') : '';
    const base = {
      checkedAt: company.leaseCheckedAt?.toISOString() ?? null,
      seats,
      bindingHost: company.bindingHost,
      hasKey,
      keyHint,
    };
    if (!hasKey) {
      return {
        ...base,
        mode: 'setup',
        reason: 'setup',
        message: 'Paste the license key from Altamid Control and choose Activate. Features stay paused until the key is valid.',
        product: PRODUCT_CODE,
        packageLabel: PACKAGE_LABELS[PRODUCT_CODE] || PRODUCT_CODE,
        seatLimit: null,
        termStartsAt: null,
        termEndsAt: null,
        status: '',
        active: false,
        outlets: this.allowance(null),
      };
    }
    const lease = this.readLease(company.leaseJson);
    if (!lease || !isVerdict(lease.verdict)) {
      return {
        ...base,
        mode: 'restrict',
        reason: 'no_lease',
        message: 'Waiting for the first successful check-in with Altamid Control. New people stay paused until then. Existing records stay available.',
        product: PRODUCT_CODE,
        packageLabel: PACKAGE_LABELS[PRODUCT_CODE] || PRODUCT_CODE,
        seatLimit: null,
        termStartsAt: null,
        termEndsAt: null,
        status: '',
        active: false,
        outlets: this.allowance(null),
      };
    }
    const product = lease.product || PRODUCT_CODE;
    return {
      ...base,
      mode: lease.usable ? 'allow' : 'restrict',
      reason: lease.verdict,
      message: lease.usable
        ? verdictMessage(lease.verdict)
        : verdictMessage(lease.verdict) + ' New people and payroll runs stay paused. Existing records stay available.',
      product,
      packageLabel: PACKAGE_LABELS[product] || product,
      seatLimit: lease.seats?.limit ?? null,
      termStartsAt: lease.termStartsAt || null,
      termEndsAt: lease.termEndsAt || null,
      status: lease.status || lease.verdict,
      active: lease.usable === true,
      outlets: this.allowance(lease),
    };
  }

  private readLease(raw: string): LeaseV1 | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as LeaseV1;
      if (!parsed || parsed.v !== 1 || typeof parsed.usable !== 'boolean') return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private seats(companyId: string): Promise<number> {
    return unscoped(() => this.prisma.employee.count({ where: { companyId, status: { in: ['active', 'onboarding'] } } }));
  }

  private async company(companyId: string): Promise<Company> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) fail(404, 'That company was not found.');
    return company;
  }
}
