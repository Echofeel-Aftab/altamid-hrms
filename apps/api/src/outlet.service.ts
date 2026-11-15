import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Outlet, User } from '@prisma/client';
import { bag, fail, optional, text } from './http';
import { LicenceService } from './licence.service';
import { OUTLET_MODELS, OutletScope, SHARED_MODELS, unscoped } from './outlet-context';
import { PrismaService } from './prisma.service';
import { ROLES } from './roles';
import { SessionUser } from './session';
import { TtlCache } from './ttl-cache';

const COUNTRIES = ['IN', 'US', 'GB', 'AE', 'SG', 'AU', 'CA', 'DE', 'NL', 'SA', 'QA', 'NP', 'BD', 'LK', 'OTHER'] as const;
const SETUP_PARTS = ['departments', 'locations', 'teams', 'leaveTypes', 'holidays'] as const;

export interface OutletAccess {
  scope: OutletScope;
  outletIds: string[];
  role: string;
  master: boolean;
  country: string;
}

type Delegate = { updateMany(args: unknown): Promise<{ count: number }> };

@Injectable()
export class OutletService implements OnModuleInit {
  private readonly log = new Logger('Outlets');
  private readonly accessCache = new TtlCache<OutletAccess>(30_000);

  constructor(private readonly prisma: PrismaService, private readonly licence: LicenceService) {}

  async onModuleInit(): Promise<void> {
    await this.backfill().catch((error: unknown) => this.log.error('Outlet backfill failed: ' + String(error)));
  }

  /** Every company keeps at least one outlet, and no outlet row is left without one. */
  async backfill(): Promise<void> {
    const companies = await this.prisma.company.findMany({ select: { id: true } });
    for (const company of companies) {
      const head = await this.ensureHead(company.id);
      await unscoped(async () => {
        for (const model of OUTLET_MODELS) {
          if (SHARED_MODELS.has(model)) continue;
          const delegate = (this.prisma as unknown as Record<string, Delegate>)[model.charAt(0).toLowerCase() + model.slice(1)];
          await delegate.updateMany({ where: { companyId: company.id, outletId: null }, data: { outletId: head.id } });
        }
      });
    }
  }

  /** The first outlet. A company that has none gets a Head office, and its owners become masters. */
  async ensureHead(companyId: string): Promise<Outlet> {
    const existing = await this.prisma.outlet.findFirst({ where: { companyId }, orderBy: { createdAt: 'asc' } });
    if (existing) return existing;
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { state: true } });
    const head = await this.prisma.outlet.create({ data: { companyId, name: 'Head office', code: 'HO', country: 'IN', state: company?.state || '' } });
    await this.prisma.user.updateMany({ where: { companyId, role: 'owner' }, data: { master: true } });
    const loose = await this.prisma.user.findMany({ where: { companyId, employeeId: null }, select: { id: true } });
    if (loose.length) await this.prisma.userOutlet.createMany({ data: loose.map((user) => ({ companyId, userId: user.id, outletId: head.id })), skipDuplicates: true });
    return head;
  }

  /** Which outlet a request works in. A master may ask for every outlet with "all". */
  async access(user: User, asked: string): Promise<OutletAccess> {
    const cacheKey = `${user.id}:${asked || ''}:${user.master ? 1 : 0}:${user.role}`;
    return this.accessCache.remember(cacheKey, () => this.resolveAccess(user, asked));
  }

  private async resolveAccess(user: User, asked: string): Promise<OutletAccess> {
    const [outletsRaw, links] = await Promise.all([
      this.prisma.outlet.findMany({ where: { companyId: user.companyId, status: 'active' }, orderBy: { createdAt: 'asc' }, select: { id: true, country: true } }),
      this.prisma.userOutlet.findMany({ where: { userId: user.id }, select: { outletId: true, role: true } }),
    ]);
    let outlets = outletsRaw;
    if (!outlets.length) outlets = [await this.ensureHead(user.companyId)];
    const ids = outlets.map((row) => row.id);
    let mine = ids;
    if (!user.master) {
      const own = user.employeeId ? (await unscoped(() => this.prisma.employee.findUnique({ where: { id: user.employeeId! }, select: { outletId: true } })))?.outletId : null;
      mine = ids.filter((id) => id === own || links.some((link) => link.outletId === id));
      if (!mine.length) mine = [ids[0]];
    }
    let current: string | null = mine.includes(asked) ? asked : mine[0];
    if (user.master && ids.length > 1 && (asked === 'all' || !asked)) current = null;
    const role = (current && !user.master && links.find((link) => link.outletId === current)?.role) || user.role;
    return {
      scope: { companyId: user.companyId, current, visible: current ? [current] : mine, self: user.employeeId },
      outletIds: mine,
      role,
      master: user.master,
      country: current ? outlets.find((row) => row.id === current)?.country || 'IN' : '',
    };
  }

  forgetAccess(userId: string): void {
    // Keys include the outlet header; drop the common ones.
    for (const asked of ['', 'all']) this.accessCache.delete(`${userId}:${asked}:0:`);
  }

  /** Outlets this sign-in can switch between, with how each one's subscription stands. */
  async mine(session: SessionUser) {
    const rows = await this.prisma.outlet.findMany({
      where: { companyId: session.companyId, status: 'active', id: { in: session.outletIds || [] } },
      orderBy: { createdAt: 'asc' },
    });
    const units = (await this.licence.view(session.companyId)).outlets.units;
    return rows.map((row) => {
      const unit = units.find((item) => (row.subscriptionId ? item.subscriptionId === row.subscriptionId : item.main));
      return { id: row.id, name: row.name, code: row.code, country: row.country, city: row.city, payroll: row.country === 'IN', termEndsAt: unit?.termEndsAt || '', usable: unit ? unit.usable : true };
    });
  }

  async list(session: SessionUser) {
    this.requireMaster(session);
    const [rows, people, links, users, licence] = await Promise.all([
      this.prisma.outlet.findMany({ where: { companyId: session.companyId }, orderBy: { createdAt: 'asc' } }),
      unscoped(() => this.prisma.employee.groupBy({ by: ['outletId'], where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } }, _count: { _all: true } })),
      this.prisma.userOutlet.findMany({ where: { companyId: session.companyId } }),
      this.prisma.user.findMany({ where: { companyId: session.companyId, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true, role: true, master: true } }),
      this.licence.view(session.companyId),
    ]);
    const open = rows.filter((row) => row.status === 'active').length;
    return {
      allowed: licence.outlets.allowed,
      open,
      canAdd: open < licence.outlets.allowed,
      countries: COUNTRIES,
      outlets: rows.map((row) => {
        const unit = licence.outlets.units.find((item) => (row.subscriptionId ? item.subscriptionId === row.subscriptionId : item.main));
        return {
          id: row.id,
          name: row.name,
          code: row.code,
          country: row.country,
          state: row.state,
          city: row.city,
          timezone: row.timezone,
          currency: row.currency,
          status: row.status,
          payroll: row.country === 'IN',
          people: people.find((item) => item.outletId === row.id)?._count._all || 0,
          termEndsAt: unit?.termEndsAt || '',
          usable: unit ? unit.usable : true,
          admins: links.filter((link) => link.outletId === row.id).map((link) => ({ userId: link.userId, role: link.role, name: users.find((user) => user.id === link.userId)?.name || '' })),
        };
      }),
      users,
    };
  }

  async create(session: SessionUser, body: unknown) {
    this.requireMaster(session);
    const input = this.fields(bag(body));
    const subscriptionId = await this.licence.assertCanOpenOutlet(session.companyId);
    await this.assertFreeName(session.companyId, input.name, '');
    const outlet = await this.prisma.outlet.create({ data: { companyId: session.companyId, subscriptionId, ...input } });
    await this.audit(session, 'outlet.create', outlet.id, outlet.name);
    return this.list(session);
  }

  async update(session: SessionUser, id: string, body: unknown) {
    this.requireMaster(session);
    const outlet = await this.outletOf(session, id);
    const input = this.fields(bag(body));
    await this.assertFreeName(session.companyId, input.name, outlet.id);
    await this.prisma.outlet.update({ where: { id: outlet.id }, data: input });
    await this.audit(session, 'outlet.update', outlet.id, input.name);
    return this.list(session);
  }

  /** Archiving closes an outlet for new work. Its records stay, and it frees the subscription it used. */
  async setStatus(session: SessionUser, id: string, body: unknown) {
    this.requireMaster(session);
    const outlet = await this.outletOf(session, id);
    const status = bag(body).archived === true ? 'archived' : 'active';
    if (status === outlet.status) return this.list(session);
    if (status === 'archived') {
      const open = await this.prisma.outlet.count({ where: { companyId: session.companyId, status: 'active' } });
      if (open <= 1) fail(400, 'Keep at least one outlet open.');
      const people = await unscoped(() => this.prisma.employee.count({ where: { companyId: session.companyId, outletId: outlet.id, status: { in: ['active', 'onboarding'] } } }));
      if (people) fail(400, `Move or exit the ${people} active ${people === 1 ? 'person' : 'people'} in ${outlet.name} before archiving it.`);
      await this.prisma.outlet.update({ where: { id: outlet.id }, data: { status, subscriptionId: outlet.subscriptionId ? '' : outlet.subscriptionId } });
    } else {
      const subscriptionId = await this.licence.assertCanOpenOutlet(session.companyId);
      const head = await this.ensureHead(session.companyId);
      await this.prisma.outlet.update({ where: { id: outlet.id }, data: { status, subscriptionId: outlet.id === head.id ? '' : subscriptionId } });
    }
    await this.audit(session, status === 'archived' ? 'outlet.archive' : 'outlet.reopen', outlet.id, outlet.name);
    return this.list(session);
  }

  /** Gives a sign-in an outlet, optionally with a different role there. */
  async setMember(session: SessionUser, id: string, body: unknown) {
    this.requireMaster(session);
    const outlet = await this.outletOf(session, id);
    const input = bag(body);
    const userId = text(input.userId, 'Sign-in', 40);
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId: session.companyId } });
    if (!user) fail(404, 'That sign-in was not found.');
    if (input.remove === true) {
      await this.prisma.userOutlet.deleteMany({ where: { userId, outletId: outlet.id } });
    } else {
      const role = optional(input.role, 20);
      if (role && !(ROLES as readonly string[]).includes(role)) fail(400, 'Choose a role from the list.');
      await this.prisma.userOutlet.upsert({
        where: { userId_outletId: { userId, outletId: outlet.id } },
        create: { companyId: session.companyId, userId, outletId: outlet.id, role },
        update: { role },
      });
    }
    await this.audit(session, input.remove === true ? 'outlet.member.remove' : 'outlet.member.set', outlet.id, user.email);
    return this.list(session);
  }

  /** Makes a sign-in a master, who sees every outlet. */
  async setMaster(session: SessionUser, body: unknown) {
    this.requireMaster(session);
    const input = bag(body);
    const userId = text(input.userId, 'Sign-in', 40);
    const user = await this.prisma.user.findFirst({ where: { id: userId, companyId: session.companyId } });
    if (!user) fail(404, 'That sign-in was not found.');
    const master = input.master === true;
    if (!master && user.id === session.id) fail(400, 'You cannot remove your own master access. Ask another master to do it.');
    await this.prisma.user.update({ where: { id: user.id }, data: { master } });
    await this.audit(session, master ? 'outlet.master.grant' : 'outlet.master.revoke', user.id, user.email);
    return this.list(session);
  }

  /** Copies setup lists from one outlet into another. Names already there are left alone. */
  async copySetup(session: SessionUser, id: string, body: unknown) {
    this.requireMaster(session);
    const target = await this.outletOf(session, id);
    const input = bag(body);
    const source = await this.outletOf(session, text(input.from, 'Copy from', 40));
    if (source.id === target.id) fail(400, 'Choose a different outlet to copy from.');
    const parts = Array.isArray(input.parts) ? input.parts.map(String).filter((part) => (SETUP_PARTS as readonly string[]).includes(part)) : [];
    if (!parts.length) fail(400, 'Choose what to copy.');
    const companyId = session.companyId;
    const copied: Record<string, number> = {};
    await unscoped(async () => {
      const from = { companyId, outletId: source.id };
      const into = { companyId, outletId: target.id };
      if (parts.includes('departments')) {
        const have = new Set((await this.prisma.department.findMany({ where: into, select: { name: true } })).map((row) => row.name));
        const rows = (await this.prisma.department.findMany({ where: from })).filter((row) => !have.has(row.name));
        if (rows.length) await this.prisma.department.createMany({ data: rows.map((row) => ({ ...into, name: row.name })) });
        copied.departments = rows.length;
      }
      if (parts.includes('locations')) {
        const have = new Set((await this.prisma.location.findMany({ where: into, select: { name: true } })).map((row) => row.name));
        const rows = (await this.prisma.location.findMany({ where: from })).filter((row) => !have.has(row.name));
        for (const row of rows) {
          const { id: _id, createdAt: _at, ...rest } = row as typeof row & { createdAt?: Date };
          await this.prisma.location.create({ data: { ...rest, ...into } });
        }
        copied.locations = rows.length;
      }
      if (parts.includes('teams')) {
        const have = new Set((await this.prisma.team.findMany({ where: into, select: { name: true } })).map((row) => row.name));
        const rows = (await this.prisma.team.findMany({ where: from })).filter((row) => !have.has(row.name));
        const departments = await this.prisma.department.findMany({ where: { companyId, outletId: { in: [source.id, target.id] } }, select: { id: true, name: true, outletId: true } });
        for (const row of rows) {
          const sourceDept = departments.find((item) => item.id === row.departmentId);
          const targetDept = sourceDept ? departments.find((item) => item.outletId === target.id && item.name === sourceDept.name) : undefined;
          await this.prisma.team.create({ data: { ...into, name: row.name, departmentId: targetDept?.id || '' } });
        }
        copied.teams = rows.length;
      }
      if (parts.includes('leaveTypes')) {
        const have = new Set((await this.prisma.leaveType.findMany({ where: into, select: { code: true } })).map((row) => row.code));
        const rows = (await this.prisma.leaveType.findMany({ where: from })).filter((row) => !have.has(row.code));
        for (const row of rows) {
          const { id: _id, createdAt: _at, ...rest } = row as typeof row & { createdAt?: Date };
          await this.prisma.leaveType.create({ data: { ...rest, ...into } });
        }
        copied.leaveTypes = rows.length;
      }
      if (parts.includes('holidays')) {
        const have = new Set((await this.prisma.holiday.findMany({ where: into, select: { day: true } })).map((row) => row.day));
        const rows = (await this.prisma.holiday.findMany({ where: from })).filter((row) => !have.has(row.day));
        for (const row of rows) {
          const { id: _id, createdAt: _at, ...rest } = row as typeof row & { createdAt?: Date };
          await this.prisma.holiday.create({ data: { ...rest, ...into } });
        }
        copied.holidays = rows.length;
      }
    });
    await this.audit(session, 'outlet.copy', target.id, `${source.name}: ${parts.join(', ')}`);
    return { copied, ...(await this.list(session)) };
  }

  private fields(input: Record<string, unknown>) {
    const country = optional(input.country, 8).toUpperCase() || 'IN';
    if (!(COUNTRIES as readonly string[]).includes(country)) fail(400, 'Choose a country from the list.');
    const currency = optional(input.currency, 3).toUpperCase() || (country === 'IN' ? 'INR' : 'USD');
    if (!/^[A-Z]{3}$/.test(currency)) fail(400, 'Use a three-letter currency code such as INR or USD.');
    const timezone = optional(input.timezone, 60) || (country === 'IN' ? 'Asia/Kolkata' : 'UTC');
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone });
    } catch {
      fail(400, 'Use a time zone name such as Asia/Kolkata or America/New_York.');
    }
    return {
      name: text(input.name, 'Outlet name', 80),
      code: optional(input.code, 8).toUpperCase().replace(/[^A-Z0-9]/g, ''),
      country,
      state: optional(input.state, 60),
      city: optional(input.city, 60),
      timezone,
      currency,
    };
  }

  private async assertFreeName(companyId: string, name: string, except: string): Promise<void> {
    const clash = await this.prisma.outlet.findFirst({ where: { companyId, name: { equals: name, mode: 'insensitive' }, id: { not: except } } });
    if (clash) fail(409, 'Another outlet already uses that name.');
  }

  private async outletOf(session: SessionUser, id: string): Promise<Outlet> {
    const outlet = await this.prisma.outlet.findFirst({ where: { id: String(id || ''), companyId: session.companyId } });
    if (!outlet) fail(404, 'That outlet was not found.');
    return outlet;
  }

  private requireMaster(session: SessionUser): void {
    if (!session.master) fail(403, 'Only a master sign-in can manage outlets.');
  }

  private async audit(session: SessionUser, action: string, entityId: string, detail: string): Promise<void> {
    await this.prisma.auditEvent.create({ data: { companyId: session.companyId, actorId: session.id, action, entity: 'outlet', entityId, detail, outletId: null } });
  }
}
