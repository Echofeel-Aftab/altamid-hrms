import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { dataKey, openSecret } from './crypto';
import { kolkataDayRange, shiftDay, todayInIndia, weekdayOf } from './dates';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { SettingsService } from './settings.service';

const ACTIVE = ['active', 'onboarding'];

function fullName(row: { firstName: string; lastName: string }): string {
  return `${row.firstName} ${row.lastName}`.trim();
}

function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  return sign + '₹' + (Math.abs(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function monthLabel(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number - 1, 1)).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function dayLabel(day: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return day || '';
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date)).toLocaleString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function clockOf(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).format(date);
}

function slipNet(linesJson: string): number {
  try {
    const lines = JSON.parse(linesJson || '[]') as Array<{ side?: string; paise?: number }>;
    if (!Array.isArray(lines)) return 0;
    return lines.reduce((sum, line) => sum + (line.side === 'earning' ? 1 : line.side === 'deduction' ? -1 : 0) * (Number.isFinite(line.paise) ? Number(line.paise) : 0), 0);
  } catch {
    return 0;
  }
}

/** Data for the Home blocks added for each kind of sign-in. Every desk checks Access again before reading. */
@Injectable()
export class HomeBoardService {
  private readonly key = dataKey();

  constructor(private readonly prisma: PrismaService, private readonly gates: AccessService, private readonly settings: SettingsService) {}

  async build(session: SessionUser, show: (key: string) => boolean) {
    const features = ['people', 'people.edit', 'pay', 'hiring', 'assets'] as const;
    const held = new Map<string, boolean>();
    await Promise.all(features.map(async (feature) => held.set(feature, await this.gates.holds(session, feature))));
    const want = async <T>(key: string, feature: string | null, work: () => Promise<T>): Promise<T | null> => {
      if (!show(key)) return null;
      if (feature && !held.get(feature)) return null;
      return work();
    };
    const today = todayInIndia();
    const needFacts = show('team-today') || (show('company-today') && !!held.get('people'));
    const factsPromise = needFacts
      ? this.dayFacts(session.companyId, today)
      : Promise.resolve({ holiday: '', weekOff: false, working: true });
    const [teamToday, companyToday, peopleWatch, payrollDesk, hiringDesk, assetsDesk, myAssets, myPay, myRequests, holidays] = await Promise.all([
      want('team-today', null, () => factsPromise.then((facts) => this.teamToday(session, today, facts))),
      want('company-today', 'people', () => factsPromise.then((facts) => this.companyToday(session, today, facts))),
      want('people-watch', 'people.edit', () => this.peopleWatch(session, today)),
      want('payroll-desk', 'pay', () => this.payrollDesk(session, today)),
      want('hiring-desk', 'hiring', () => this.hiringDesk(session)),
      want('assets-desk', 'assets', () => this.assetsDesk(session, today)),
      want('my-assets', null, () => this.myAssets(session)),
      want('my-pay', 'pay', () => this.myPay(session)),
      want('my-requests', null, () => this.myRequests(session)),
      want('holidays', null, () => this.holidays(session, today)),
    ]);
    return { teamToday, companyToday, peopleWatch, payrollDesk, hiringDesk, assetsDesk, myAssets, myPay, myRequests, holidays };
  }

  private async dayFacts(companyId: string, today: string) {
    const [rules, holiday] = await Promise.all([
      this.settings.timeRules(companyId),
      this.prisma.holiday.findFirst({ where: { companyId, day: today } }),
    ]);
    const weekOff = rules.weekOff.includes(weekdayOf(today));
    return { holiday: holiday?.name || '', weekOff, working: !holiday && !weekOff };
  }

  private async todayStates(companyId: string, ids: string[], today: string) {
    const range = kolkataDayRange(today);
    const [punches, leaves, duty] = await Promise.all([
      this.prisma.punch.findMany({ where: { companyId, employeeId: { in: ids }, punchedAt: { gte: range.start, lte: range.end } }, orderBy: { punchedAt: 'asc' }, select: { employeeId: true, kind: true, punchedAt: true } }),
      this.prisma.leaveRequest.findMany({ where: { companyId, employeeId: { in: ids }, status: 'approved', startsOn: { lte: today }, endsOn: { gte: today } }, select: { employeeId: true, portion: true } }),
      this.prisma.attendanceRequest.findMany({ where: { companyId, employeeId: { in: ids }, status: 'approved', kind: { in: ['onduty', 'wfh'] }, day: { lte: today }, OR: [{ day: today }, { endsOn: { gte: today } }] }, select: { employeeId: true, kind: true } }),
    ]);
    const first = new Map<string, Date>();
    const last = new Map<string, string>();
    for (const punch of punches) {
      if (punch.kind === 'in' && !first.has(punch.employeeId)) first.set(punch.employeeId, punch.punchedAt);
      last.set(punch.employeeId, punch.kind);
    }
    const onLeave = new Map(leaves.map((row) => [row.employeeId, row.portion]));
    const away = new Map(duty.map((row) => [row.employeeId, row.kind === 'wfh' ? 'Working from home' : 'On duty']));
    return { first, last, onLeave, away };
  }

  private async teamToday(session: SessionUser, today: string, facts: Awaited<ReturnType<HomeBoardService['dayFacts']>>) {
    if (!session.employeeId) return null;
    const people = await this.prisma.employee.findMany({
      where: { companyId: session.companyId, status: { in: ACTIVE }, id: { not: session.employeeId }, OR: [{ managerId: session.employeeId }, { team: { leadId: session.employeeId } }] },
      select: { id: true, code: true, firstName: true, lastName: true, designation: { select: { name: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    if (!people.length) return null;
    const { first, last, onLeave, away } = await this.todayStates(session.companyId, people.map((row) => row.id), today);
    const rows = people.map((person) => {
      const arrived = first.get(person.id);
      const portion = onLeave.get(person.id);
      const elsewhere = away.get(person.id);
      let state: 'in' | 'out' | 'away' | 'leave' | 'none' | 'off' = 'none';
      let note = facts.working ? 'Not checked in' : facts.holiday ? 'Holiday' : 'Weekly off';
      if (arrived) {
        state = last.get(person.id) === 'in' ? 'in' : 'out';
        note = state === 'in' ? 'In since ' + clockOf(arrived) : 'Checked out';
      } else if (elsewhere) {
        state = 'away';
        note = elsewhere;
      } else if (portion) {
        state = 'leave';
        note = portion === 'full' ? 'On leave' : 'On half-day leave';
      } else if (!facts.working) {
        state = 'off';
      }
      return { id: person.id, code: person.code, name: fullName(person), designation: person.designation?.name || '', state, note };
    });
    const order = { in: 0, away: 1, out: 2, leave: 3, none: 4, off: 5 };
    rows.sort((left, right) => order[left.state] - order[right.state] || left.name.localeCompare(right.name));
    return {
      total: rows.length,
      in: rows.filter((row) => row.state === 'in' || row.state === 'out' || row.state === 'away').length,
      leave: rows.filter((row) => row.state === 'leave').length,
      notIn: rows.filter((row) => row.state === 'none').length,
      working: facts.working,
      dayNote: facts.holiday ? 'Holiday: ' + facts.holiday : facts.weekOff ? 'Weekly off today' : '',
      people: rows.slice(0, 12),
    };
  }

  private async companyToday(session: SessionUser, today: string, facts: Awaited<ReturnType<HomeBoardService['dayFacts']>>) {
    const people = await this.prisma.employee.findMany({ where: { companyId: session.companyId, status: { in: ACTIVE }, dateOfJoining: { lte: today } }, select: { id: true, status: true } });
    const { first, onLeave, away } = await this.todayStates(session.companyId, people.map((row) => row.id), today);
    const present = people.filter((row) => first.has(row.id)).length;
    const elsewhere = people.filter((row) => !first.has(row.id) && away.has(row.id)).length;
    const leave = people.filter((row) => !first.has(row.id) && !away.has(row.id) && onLeave.has(row.id)).length;
    const joiningSoon = await this.prisma.employee.count({ where: { companyId: session.companyId, status: { in: ACTIVE }, dateOfJoining: { gt: today, lte: shiftDay(today, 30) } } });
    return {
      headcount: people.length,
      onboarding: people.filter((row) => row.status === 'onboarding').length,
      present,
      leave,
      away: elsewhere,
      notIn: facts.working ? Math.max(0, people.length - present - elsewhere - leave) : 0,
      joiningSoon,
      working: facts.working,
      dayNote: facts.holiday ? 'Holiday: ' + facts.holiday : facts.weekOff ? 'Weekly off today' : '',
    };
  }

  private async peopleWatch(session: SessionUser, today: string) {
    const until = shiftDay(today, 30);
    const [probation, exits, leaving, onboarding, openTasks, changes] = await Promise.all([
      this.prisma.employee.findMany({ where: { companyId: session.companyId, status: { in: ACTIVE }, probationEndsOn: { gte: today, lte: until } }, orderBy: { probationEndsOn: 'asc' }, take: 6, select: { id: true, code: true, firstName: true, lastName: true, probationEndsOn: true } }),
      this.prisma.exitRequest.count({ where: { companyId: session.companyId, status: 'pending' } }),
      this.prisma.employee.findMany({ where: { companyId: session.companyId, status: { in: ACTIVE }, dateOfExit: { gte: today, lte: until } }, orderBy: { dateOfExit: 'asc' }, take: 6, select: { id: true, code: true, firstName: true, lastName: true, dateOfExit: true } }),
      this.prisma.employee.count({ where: { companyId: session.companyId, status: 'onboarding' } }),
      this.prisma.onboardingTask.count({ where: { companyId: session.companyId, done: false } }),
      this.prisma.detailChange.count({ where: { companyId: session.companyId, status: 'pending' } }),
    ]);
    return {
      probation: probation.map((row) => ({ id: row.id, code: row.code, name: fullName(row), day: row.probationEndsOn })),
      leaving: leaving.map((row) => ({ id: row.id, code: row.code, name: fullName(row), day: row.dateOfExit })),
      exitRequests: exits,
      onboarding,
      openTasks,
      detailChanges: changes,
    };
  }

  private async payrollDesk(session: SessionUser, today: string) {
    const month = today.slice(0, 7);
    const previous = shiftDay(month + '-01', -1).slice(0, 7);
    const end = shiftDay(shiftDay(month + '-01', 32).slice(0, 7) + '-01', -1);
    const people = await this.prisma.employee.findMany({
      where: { companyId: session.companyId, dateOfJoining: { lte: end }, OR: [{ dateOfExit: '' }, { dateOfExit: { gte: month + '-01' } }] },
      select: { id: true, bankEnc: true, ifscEnc: true },
    });
    const ids = people.map((row) => row.id);
    const [structures, slips, locks, before] = await Promise.all([
      this.prisma.payStructure.findMany({ where: { companyId: session.companyId, employeeId: { in: ids }, effectiveFrom: { lte: end } }, select: { employeeId: true }, distinct: ['employeeId'] }),
      this.prisma.paySlip.findMany({ where: { companyId: session.companyId, month }, select: { published: true } }),
      this.prisma.payMonth.findMany({ where: { companyId: session.companyId, month: { in: [month, previous] } }, select: { month: true } }),
      this.prisma.paySlip.findMany({ where: { companyId: session.companyId, month: previous }, select: { published: true } }),
    ]);
    // Empty ciphertext means missing bank; only decrypt when a value is stored.
    const missingBank = people.filter((row) => {
      if (!row.bankEnc || !row.ifscEnc) return true;
      return !openSecret(row.bankEnc, this.key) || !openSecret(row.ifscEnc, this.key);
    }).length;
    return {
      month,
      label: monthLabel(month),
      people: people.length,
      withCtc: structures.length,
      drafts: slips.filter((row) => !row.published).length,
      published: slips.filter((row) => row.published).length,
      locked: locks.some((row) => row.month === month),
      missingBank,
      previous: { label: monthLabel(previous), published: before.filter((row) => row.published).length, drafts: before.filter((row) => !row.published).length, locked: locks.some((row) => row.month === previous) },
    };
  }

  private async hiringDesk(session: SessionUser) {
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    const [openJobs, fresh, grouped, latest] = await Promise.all([
      this.prisma.opening.count({ where: { companyId: session.companyId, status: 'open' } }),
      this.prisma.jobApplication.count({ where: { companyId: session.companyId, createdAt: { gte: weekAgo } } }),
      this.prisma.jobApplication.groupBy({ by: ['status'], where: { companyId: session.companyId, status: { in: ['new', 'reviewing', 'shortlisted', 'interview'] } }, _count: { _all: true } }),
      this.prisma.jobApplication.findMany({ where: { companyId: session.companyId, status: { in: ['new', 'reviewing'] } }, orderBy: { createdAt: 'desc' }, take: 4, select: { id: true, name: true, jobTitle: true, status: true, createdAt: true } }),
    ]);
    const count = (status: string) => grouped.find((row) => row.status === status)?._count._all || 0;
    return {
      openJobs,
      fresh,
      waiting: count('new') + count('reviewing'),
      shortlisted: count('shortlisted'),
      interview: count('interview'),
      latest: latest.map((row) => ({ id: row.id, name: row.name, jobTitle: row.jobTitle, status: row.status, at: row.createdAt.toISOString() })),
    };
  }

  private async assetsDesk(session: SessionUser, today: string) {
    const until = shiftDay(today, 30);
    const [grouped, warranty, licences] = await Promise.all([
      this.prisma.asset.groupBy({ by: ['status'], where: { companyId: session.companyId }, _count: { _all: true } }),
      this.prisma.asset.findMany({ where: { companyId: session.companyId, status: { notIn: ['retired', 'lost'] }, warrantyUntil: { gte: today, lte: until } }, orderBy: { warrantyUntil: 'asc' }, take: 5, select: { id: true, tag: true, name: true, warrantyUntil: true } }),
      this.prisma.asset.findMany({ where: { companyId: session.companyId, kind: 'licence', status: { notIn: ['retired', 'lost'] } }, select: { id: true, tag: true, name: true, detailsJson: true } }),
    ]);
    const count = (status: string) => grouped.find((row) => row.status === status)?._count._all || 0;
    const renewals = licences
      .map((row) => {
        let day = '';
        try {
          const fields = (JSON.parse(row.detailsJson || '{}') as { fields?: Record<string, unknown> }).fields || {};
          day = typeof fields.renewsOn === 'string' ? fields.renewsOn : '';
        } catch {
          day = '';
        }
        return { id: row.id, tag: row.tag, name: row.name, day };
      })
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.day) && row.day <= until)
      .sort((left, right) => left.day.localeCompare(right.day))
      .slice(0, 5);
    return {
      stock: count('stock'),
      issued: count('issued'),
      repair: count('repair'),
      lost: count('lost'),
      warranty: warranty.map((row) => ({ id: row.id, tag: row.tag, name: row.name, day: row.warrantyUntil })),
      renewals: renewals.map((row) => ({ ...row, overdue: row.day < today })),
    };
  }

  private async myAssets(session: SessionUser) {
    if (!session.employeeId) return null;
    const rows = await this.prisma.asset.findMany({ where: { companyId: session.companyId, employeeId: session.employeeId, status: 'issued' }, orderBy: { issuedOn: 'desc' }, take: 6, select: { id: true, tag: true, name: true, kind: true, issuedOn: true } });
    return rows;
  }

  private async myPay(session: SessionUser) {
    if (!session.employeeId) return null;
    const slip = await this.prisma.paySlip.findFirst({ where: { companyId: session.companyId, employeeId: session.employeeId, published: true }, orderBy: { month: 'desc' } });
    if (!slip) return null;
    return { month: slip.month, label: monthLabel(slip.month), net: rupees(slipNet(slip.linesJson)), paidDays: slip.paidDays };
  }

  private async myRequests(session: SessionUser) {
    if (!session.employeeId) return null;
    const since = new Date(Date.now() - 14 * 86400000);
    const mine = { companyId: session.companyId, employeeId: session.employeeId };
    const recent = { OR: [{ status: 'pending' }, { decidedAt: { gte: since } }] };
    const [leaves, times, changes, exits] = await Promise.all([
      this.prisma.leaveRequest.findMany({ where: { ...mine, ...recent }, orderBy: { createdAt: 'desc' }, take: 5, include: { leaveType: { select: { name: true } } } }),
      this.prisma.attendanceRequest.findMany({ where: { ...mine, ...recent }, orderBy: { createdAt: 'desc' }, take: 5 }),
      this.prisma.detailChange.findMany({ where: { ...mine, OR: [{ status: 'pending' }, { decidedAt: { gte: since } }] }, orderBy: { createdAt: 'desc' }, take: 3 }),
      this.prisma.exitRequest.findMany({ where: { ...mine, status: 'pending' }, take: 1 }),
    ]);
    const timeLabel: Record<string, string> = { regularization: 'Regularization', onduty: 'On duty', wfh: 'Work from home', extratime: 'Extra time' };
    const items = [
      ...leaves.map((row) => ({ link: '/leave', title: (row.leaveType?.name || 'Leave') + ' · ' + dayLabel(row.startsOn) + (row.endsOn !== row.startsOn ? ' to ' + dayLabel(row.endsOn) : ''), status: row.status, at: row.createdAt.toISOString() })),
      ...times.map((row) => ({ link: '/requests', title: (timeLabel[row.kind] || 'Attendance request') + ' · ' + dayLabel(row.day), status: row.status, at: row.createdAt.toISOString() })),
      ...changes.map((row) => ({ link: '/profile', title: 'Change to my details', status: row.status, at: row.createdAt.toISOString() })),
      ...exits.map((row) => ({ link: '/profile', title: 'Resignation · last day ' + dayLabel(row.lastDay), status: row.status, at: row.createdAt.toISOString() })),
    ].sort((left, right) => (left.status === 'pending' ? 0 : 1) - (right.status === 'pending' ? 0 : 1) || right.at.localeCompare(left.at));
    return { pending: items.filter((row) => row.status === 'pending').length, items: items.slice(0, 5) };
  }

  private async holidays(session: SessionUser, today: string) {
    return this.prisma.holiday.findMany({ where: { companyId: session.companyId, day: { gte: today } }, orderBy: { day: 'asc' }, take: 4, select: { day: true, name: true } });
  }
}
