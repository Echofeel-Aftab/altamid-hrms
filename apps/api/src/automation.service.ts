import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AccessService } from './access.service';
import { kolkataDayRange, shiftDay, todayInIndia } from './dates';
import { fail } from './http';
import { LicenceService } from './licence.service';
import { closeEmployment } from './lifecycle';
import { parseFlow } from './approval-flow';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { PeoplePolicy, SettingsService } from './settings.service';

const TICK_MS = 15 * 60 * 1000;

export interface RunSummary {
  day: string;
  manual: boolean;
  exits: number;
  probation: number;
  approvals: number;
  checkout: number;
  warranty: number;
  emails: number;
  notes: string[];
}

interface Notice {
  userId: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  ref: string;
}

function prettyDay(day: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : day;
}

function fullName(row: { firstName: string; lastName: string }): string {
  return `${row.firstName} ${row.lastName}`.trim();
}

@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Automation');
  private timer: NodeJS.Timeout | null = null;
  private first: NodeJS.Timeout | null = null;
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly gates: AccessService,
    private readonly licence: LicenceService,
  ) {}

  onModuleInit(): void {
    if (process.env.HRMS_AUTOMATION === 'off') return;
    this.first = setTimeout(() => void this.tick(), 60 * 1000);
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.first) clearTimeout(this.first);
    if (this.timer) clearInterval(this.timer);
  }

  /** Runs each company's daily jobs once per Indian calendar day. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const companies = await this.prisma.company.findMany({ select: { id: true } });
      for (const company of companies) {
        await this.licence.refresh(company.id).catch((error: unknown) => this.log.warn(`Licence check-in failed for ${company.id}: ${error instanceof Error ? error.message : error}`));
        try {
          await this.daily(company.id, false);
        } catch (error) {
          this.log.warn(`Daily jobs failed for ${company.id}: ${error instanceof Error ? error.message : error}`);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  async view(session: SessionUser) {
    await this.gates.gate(session, 'settings', 'You do not have access to automation.');
    const [policy, runs] = await Promise.all([
      this.settings.policy(session.companyId),
      this.prisma.automationLog.findMany({ where: { companyId: session.companyId, job: { in: ['daily', 'manual'] } }, orderBy: { createdAt: 'desc' }, take: 14 }),
    ]);
    return {
      policy,
      runs: runs.map((row) => ({ at: row.createdAt.toISOString(), manual: row.job === 'manual', summary: this.parse(row.detail) })),
    };
  }

  async savePolicy(session: SessionUser, body: unknown) {
    await this.settings.savePolicy(session, body);
    return this.view(session);
  }

  async runNow(session: SessionUser) {
    await this.gates.gate(session, 'settings', 'You do not have access to automation.');
    const summary = await this.daily(session.companyId, true, session.id);
    if (!summary) fail(409, 'The daily jobs are already running. Try again in a minute.');
    return { summary, ...(await this.view(session)) };
  }

  async daily(companyId: string, manual: boolean, actorId = 'automation'): Promise<RunSummary | null> {
    const day = todayInIndia();
    const ref = manual ? `${day}:${Date.now()}` : day;
    try {
      await this.prisma.automationLog.create({ data: { companyId, job: manual ? 'manual' : 'daily', ref, detail: '' } });
    } catch (error) {
      if (this.duplicate(error)) return null;
      throw error;
    }
    const policy = await this.settings.policy(companyId);
    const summary: RunSummary = { day, manual, exits: 0, probation: 0, approvals: 0, checkout: 0, warranty: 0, emails: 0, notes: [] };
    const holders = new Map<string, Promise<string[]>>();
    const holdersOf = (feature: string) => {
      if (!holders.has(feature)) holders.set(feature, this.holders(companyId, feature));
      return holders.get(feature)!;
    };
    const jobs: Array<[string, () => Promise<void>]> = [
      ['exits', async () => { if (policy.autoExit) summary.exits = await this.exits(companyId, day, actorId, holdersOf); }],
      ['probation', async () => { if (policy.reminders.probation) summary.probation = await this.probation(companyId, day, holdersOf); }],
      ['approvals', async () => { if (policy.reminders.approvals) summary.approvals = await this.approvals(companyId, policy, holdersOf); }],
      ['checkout', async () => { if (policy.reminders.checkout) summary.checkout = await this.checkout(companyId, day); }],
      ['warranty', async () => { if (policy.reminders.warranty) summary.warranty = await this.warranty(companyId, day, holdersOf); }],
      ['celebrations', async () => { if (policy.reminders.celebrations) summary.emails = await this.celebrations(companyId, day); }],
    ];
    for (const [name, job] of jobs) {
      try {
        await job();
      } catch (error) {
        summary.notes.push(`${name}: ${error instanceof Error ? error.message : 'failed'}`);
      }
    }
    await this.prisma.automationLog.update({
      where: { companyId_job_ref: { companyId, job: manual ? 'manual' : 'daily', ref } },
      data: { detail: JSON.stringify(summary) },
    });
    return summary;
  }

  /** Closes employment the day after the last working day, and tells HR about assets still issued. */
  private async exits(companyId: string, day: string, actorId: string, holdersOf: (feature: string) => Promise<string[]>): Promise<number> {
    const due = await this.prisma.employee.findMany({
      where: { companyId, status: { in: ['active', 'onboarding'] }, dateOfExit: { not: '', lt: day } },
      include: { assets: { where: { status: 'issued' }, select: { id: true } } },
    });
    let closed = 0;
    const notices: Notice[] = [];
    for (const person of due) {
      const result = await closeEmployment(this.prisma, companyId, person.id, person.dateOfExit, actorId);
      if (!result.closed) continue;
      closed++;
      for (const userId of await holdersOf('people.edit')) {
        notices.push({
          userId,
          kind: 'automation',
          title: `${fullName(person)} has exited`,
          body: `Their last working day was ${prettyDay(person.dateOfExit)}. The sign-in is turned off.`,
          link: `/people/${person.id}`,
          ref: `exit:${person.id}`,
        });
      }
      if (person.assets.length) {
        for (const userId of await holdersOf('assets')) {
          notices.push({
            userId,
            kind: 'automation',
            title: `${fullName(person)} left with ${person.assets.length} asset(s) still issued`,
            body: 'Collect them and mark them returned in Assets.',
            link: '/assets',
            ref: `exit-assets:${person.id}`,
          });
        }
      }
    }
    await this.notify(companyId, notices);
    return closed;
  }

  private async probation(companyId: string, day: string, holdersOf: (feature: string) => Promise<string[]>): Promise<number> {
    const soon = shiftDay(day, 15);
    const people = await this.prisma.employee.findMany({
      where: { companyId, status: { in: ['active', 'onboarding'] }, confirmedOn: '', probationEndsOn: { not: '', lte: soon } },
      include: { manager: { include: { user: true } } },
    });
    const notices: Notice[] = [];
    for (const person of people) {
      const over = person.probationEndsOn < day;
      const to = new Set(await holdersOf('people.edit'));
      if (person.manager?.user?.active) to.add(person.manager.user.id);
      for (const userId of to) {
        notices.push({
          userId,
          kind: 'automation',
          title: over ? `${fullName(person)}'s probation is over` : `${fullName(person)}'s probation ends ${prettyDay(person.probationEndsOn)}`,
          body: over ? 'Confirm them or extend the probation date in People.' : 'Review their work and confirm them, or extend the probation date in People.',
          link: `/people/${person.id}`,
          ref: `probation:${person.id}:${person.probationEndsOn}:${over ? 'over' : 'soon'}`,
        });
      }
    }
    await this.notify(companyId, notices);
    return people.length;
  }

  /** Reminds the approver once, then escalates to the next manager up at twice the wait. */
  private async approvals(companyId: string, policy: PeoplePolicy, holdersOf: (feature: string) => Promise<string[]>): Promise<number> {
    const hours = policy.reminders.approvalHours;
    const cutoff = new Date(Date.now() - hours * 3600 * 1000);
    const include = { employee: { include: { manager: { include: { user: true, manager: { include: { user: true } } } } } } };
    const [leave, time] = await Promise.all([
      this.prisma.leaveRequest.findMany({ where: { companyId, status: 'pending', createdAt: { lt: cutoff } }, include }),
      this.prisma.attendanceRequest.findMany({ where: { companyId, status: 'pending', createdAt: { lt: cutoff } }, include }),
    ]);
    const company = await holdersOf('approvals:company');
    const notices: Notice[] = [];
    const rows = [
      ...leave.map((row) => ({ id: row.id, createdAt: row.createdAt, flowJson: row.flowJson, employee: row.employee, what: 'leave request', link: '/approvals' })),
      ...time.map((row) => ({ id: row.id, createdAt: row.createdAt, flowJson: row.flowJson, employee: row.employee, what: 'attendance request', link: '/approvals' })),
    ];
    for (const row of rows) {
      const flow = parseFlow(row.flowJson);
      const step = flow?.steps[flow.at];
      const since = flow?.history.length ? Date.parse(flow.history[flow.history.length - 1].at) : row.createdAt.getTime();
      const waited = Math.floor((Date.now() - since) / 3600000);
      if (waited < hours) continue;
      const tag = flow?.at ? `${row.id}:s${flow.at}` : row.id;
      const manager = row.employee.manager?.user?.active ? row.employee.manager.user.id : '';
      let first = manager ? [manager] : company.filter((id) => id !== row.employee.id);
      if (step) {
        const ids = step.approvers.map((item) => item.userId).filter(Boolean);
        if (ids.length) first = ids;
      }
      for (const userId of first) {
        notices.push({
          userId,
          kind: 'automation',
          title: `${fullName(row.employee)}'s ${row.what} is waiting`,
          body: `It has been waiting about ${waited} hours${step ? ` at ${step.label}` : ''}.`,
          link: row.link,
          ref: `approval:${tag}:1`,
        });
      }
      const above = row.employee.manager?.manager?.user;
      if (waited >= hours * 2 && above?.active && (!step || step.kind === 'manager') && !first.includes(above.id)) {
        notices.push({
          userId: above.id,
          kind: 'automation',
          title: `Escalated: ${fullName(row.employee)}'s ${row.what}`,
          body: `${row.employee.manager ? fullName(row.employee.manager) : 'The manager'} has not decided it in ${waited} hours.`,
          link: row.link,
          ref: `approval:${tag}:2`,
        });
      }
    }
    await this.notify(companyId, notices);
    return rows.length;
  }

  private async checkout(companyId: string, day: string): Promise<number> {
    const yesterday = shiftDay(day, -1);
    const range = kolkataDayRange(yesterday);
    const punches = await this.prisma.punch.findMany({
      where: { companyId, punchedAt: { gte: range.start, lt: range.end } },
      orderBy: { punchedAt: 'asc' },
      select: { employeeId: true, kind: true },
    });
    const last = new Map<string, string>();
    for (const row of punches) last.set(row.employeeId, row.kind);
    const open = [...last].filter(([, kind]) => kind === 'in').map(([id]) => id);
    if (!open.length) return 0;
    const users = await this.prisma.user.findMany({ where: { companyId, active: true, employeeId: { in: open } }, select: { id: true } });
    await this.notify(companyId, users.map((user) => ({
      userId: user.id,
      kind: 'automation',
      title: `You did not check out on ${prettyDay(yesterday)}`,
      body: 'Raise a regularization with your out time so the day is counted correctly.',
      link: '/requests',
      ref: `checkout:${yesterday}`,
    })));
    return open.length;
  }

  private async warranty(companyId: string, day: string, holdersOf: (feature: string) => Promise<string[]>): Promise<number> {
    const assets = await this.prisma.asset.findMany({
      where: { companyId, status: { notIn: ['retired', 'lost'] }, warrantyUntil: { gte: day, lte: shiftDay(day, 30) } },
      select: { id: true, name: true, tag: true, warrantyUntil: true },
    });
    const to = await holdersOf('assets');
    await this.notify(companyId, assets.flatMap((asset) => to.map((userId) => ({
      userId,
      kind: 'automation',
      title: `Warranty ends ${prettyDay(asset.warrantyUntil)}: ${asset.name} (${asset.tag})`,
      body: 'Renew it or plan a replacement.',
      link: '/assets',
      ref: `warranty:${asset.id}:${asset.warrantyUntil}`,
    }))));
    return assets.length;
  }

  /** Sends birthday and work anniversary emails only when the template is set to send automatically. */
  private async celebrations(companyId: string, day: string): Promise<number> {
    const monthDay = day.slice(4);
    const year = Number(day.slice(0, 4));
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    const people = await this.prisma.employee.findMany({
      where: {
        companyId,
        status: { in: ['active', 'onboarding'] },
        OR: [{ dateOfBirth: { endsWith: monthDay } }, { dateOfJoining: { endsWith: monthDay } }],
      },
      select: { id: true, firstName: true, email: true, dateOfBirth: true, dateOfJoining: true },
    });
    let sent = 0;
    for (const person of people) {
      if (!person.email.includes('@')) continue;
      const kinds: Array<{ key: 'birthday' | 'anniversary'; years: number }> = [];
      if (person.dateOfBirth.endsWith(monthDay)) kinds.push({ key: 'birthday', years: 0 });
      const joined = Number(person.dateOfJoining.slice(0, 4));
      if (person.dateOfJoining.endsWith(monthDay) && joined < year) kinds.push({ key: 'anniversary', years: year - joined });
      for (const kind of kinds) {
        const ref = `${person.id}:${year}`;
        if (await this.prisma.automationLog.findUnique({ where: { companyId_job_ref: { companyId, job: kind.key, ref } } })) continue;
        const result = await this.settings.sendTemplate(companyId, kind.key, [person.email], {
          name: person.firstName,
          sender: company?.name || 'Your team',
          years: String(kind.years),
        });
        if (!result.emailed) continue;
        sent++;
        await this.prisma.automationLog.create({ data: { companyId, job: kind.key, ref, detail: '' } }).catch(() => undefined);
      }
    }
    return sent;
  }

  /** Users who hold a feature. A ':company' suffix keeps only company-wide holders, not team managers. */
  private async holders(companyId: string, wanted: string): Promise<string[]> {
    const [feature, reach] = wanted.split(':');
    const users = await this.prisma.user.findMany({ where: { companyId, active: true }, select: { id: true, role: true, name: true, email: true, employeeId: true } });
    const out: string[] = [];
    for (const user of users) {
      const session: SessionUser = { id: user.id, companyId, role: user.role, name: user.name, email: user.email, employeeId: user.employeeId };
      const span = await this.gates.span(session, feature);
      if (reach === 'company' ? span === 'company' : span !== 'none') out.push(user.id);
    }
    return out;
  }

  private async notify(companyId: string, notices: Notice[]): Promise<void> {
    if (!notices.length) return;
    await this.prisma.notification.createMany({
      data: notices.map((row) => ({ companyId, ...row })),
      skipDuplicates: true,
    });
  }

  private parse(detail: string): RunSummary | null {
    try {
      return detail ? (JSON.parse(detail) as RunSummary) : null;
    } catch {
      return null;
    }
  }

  private duplicate(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'P2002';
  }
}
