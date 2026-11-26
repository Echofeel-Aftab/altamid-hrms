import { Injectable } from '@nestjs/common';
import { LeaveType } from '@prisma/client';
import { countedDays, shiftDay, todayInIndia } from './dates';
import { fail } from './http';
import { PrismaService } from './prisma.service';
import { PeoplePolicy, SettingsService } from './settings.service';

export interface Balance {
  id: string;
  name: string;
  code: string;
  paid: boolean;
  /** Everything available in the year: the yearly quota (pro-rated for joiners), carried days and comp-off earned. */
  entitled: number;
  quota: number;
  carried: number;
  earned: number;
  used: number;
  left: number;
  limited: boolean;
}

interface Taken {
  employeeId: string;
  leaveTypeId: string;
  startsOn: string;
  endsOn: string;
  days: number;
  portion: string;
}

interface Context {
  types: LeaveType[];
  joined: Map<string, string>;
  taken: Taken[];
  extra: Array<{ employeeId: string; day: string; hours: string }>;
  weekOff: number[];
  holidays: Set<string>;
  policy: PeoplePolicy;
}

const LOOKBACK = 5;

function half(value: number): number {
  return Math.round(value * 2) / 2;
}

@Injectable()
export class LeaveLedger {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async balances(companyId: string, employeeId: string, year: string): Promise<Balance[]> {
    return (await this.many(companyId, [employeeId], year)).get(employeeId) || [];
  }

  async many(companyId: string, employeeIds: string[], year: string): Promise<Map<string, Balance[]>> {
    const context = await this.context(companyId, employeeIds, Number(year));
    const out = new Map<string, Balance[]>();
    for (const id of employeeIds) out.set(id, context.types.map((type) => this.balanceOf(context, id, type, Number(year))));
    return out;
  }

  /** Throws when the request breaks a leave rule or the balance in any year it touches is short. */
  async check(
    companyId: string,
    employee: { id: string; confirmedOn: string; probationEndsOn: string },
    type: LeaveType,
    request: { startsOn: string; endsOn: string; days: number; portion: string },
    applying: boolean,
  ): Promise<void> {
    if (applying) {
      if (type.maxInRow > 0 && request.days > type.maxInRow) fail(400, `${type.name} can be taken for at most ${type.maxInRow} working day(s) in a row.`);
      if (type.noticeDays > 0 && request.startsOn < shiftDay(todayInIndia(), type.noticeDays)) {
        fail(400, `${type.name} needs to be applied for at least ${type.noticeDays} day(s) ahead.`);
      }
      if (type.afterProbation && !employee.confirmedOn && employee.probationEndsOn && request.startsOn <= employee.probationEndsOn) {
        fail(400, `${type.name} can be taken after probation ends on ${employee.probationEndsOn}.`);
      }
    }
    if (!this.limited(type)) return;
    const first = Number(request.startsOn.slice(0, 4));
    const last = Number(request.endsOn.slice(0, 4));
    for (let year = first; year <= last; year++) {
      const context = await this.context(companyId, [employee.id], year);
      const balance = this.balanceOf(context, employee.id, type, year);
      const part = this.charge(request, year, context.weekOff, context.holidays);
      if (balance.left < part) fail(400, `Only ${balance.left} ${type.name.toLowerCase()} day(s) are left in ${year}.`);
    }
  }

  /** Days a request uses inside one calendar year. A request crossing 31 December is split by working days. */
  charge(row: { startsOn: string; endsOn: string; days: number; portion: string }, year: number, weekOff: number[], holidays: Set<string>): number {
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    if (row.endsOn < start || row.startsOn > end) return 0;
    if (row.portion === 'half') return 0.5;
    if (row.startsOn >= start && row.endsOn <= end) return row.days;
    return countedDays(row.startsOn < start ? start : row.startsOn, row.endsOn > end ? end : row.endsOn, weekOff, holidays);
  }

  limited(type: LeaveType): boolean {
    return type.daysPerYear > 0 || type.compOff || type.carryForwardMax > 0;
  }

  private balanceOf(context: Context, employeeId: string, type: LeaveType, year: number): Balance {
    const joined = context.joined.get(employeeId) || '';
    const joinYear = /^\d{4}/.test(joined) ? Number(joined.slice(0, 4)) : year - LOOKBACK;
    const memo = new Map<number, { quota: number; carried: number; earned: number; used: number; left: number }>();
    const yearOf = (y: number): { quota: number; carried: number; earned: number; used: number; left: number } => {
      const cached = memo.get(y);
      if (cached) return cached;
      const quota = this.quota(type, joined, joinYear, y, context.policy);
      const carried = type.carryForwardMax > 0 && y > joinYear && y > year - LOOKBACK
        ? Math.min(type.carryForwardMax, yearOf(y - 1).left)
        : 0;
      const earned = type.compOff ? this.earned(context, employeeId, y) : 0;
      const used = context.taken
        .filter((row) => row.employeeId === employeeId && row.leaveTypeId === type.id)
        .reduce((sum, row) => sum + this.charge(row, y, context.weekOff, context.holidays), 0);
      const value = { quota, carried, earned, used, left: Math.max(0, half(quota + carried + earned - used)) };
      memo.set(y, value);
      return value;
    };
    const now = yearOf(year);
    const limited = this.limited(type);
    return {
      id: type.id,
      name: type.name,
      code: type.code,
      paid: type.paid,
      entitled: limited ? half(now.quota + now.carried + now.earned) : 0,
      quota: now.quota,
      carried: now.carried,
      earned: now.earned,
      used: now.used,
      left: limited ? now.left : 0,
      limited,
    };
  }

  private quota(type: LeaveType, joined: string, joinYear: number, year: number, policy: PeoplePolicy): number {
    if (type.daysPerYear <= 0 || year < joinYear) return 0;
    const full = this.fullQuota(type, joined, joinYear, year, policy);
    if (!policy.monthlyAccrual) return full;
    // Monthly accrual: past years are fully earned, later years nothing yet, this year one twelfth per month.
    const today = todayInIndia();
    const nowYear = Number(today.slice(0, 4));
    if (year < nowYear) return full;
    if (year > nowYear) return 0;
    const nowMonth = Number(today.slice(5, 7));
    let months = nowMonth;
    if (year === joinYear && /^\d{4}-\d{2}-\d{2}$/.test(joined)) {
      months = Math.max(0, nowMonth - Number(joined.slice(5, 7)) + (Number(joined.slice(8, 10)) <= 15 ? 1 : 0));
    }
    return Math.min(full, half((type.daysPerYear * months) / 12));
  }

  private fullQuota(type: LeaveType, joined: string, joinYear: number, year: number, policy: PeoplePolicy): number {
    if (year > joinYear || !policy.prorateLeave || !/^\d{4}-\d{2}-\d{2}$/.test(joined)) return type.daysPerYear;
    const month = Number(joined.slice(5, 7));
    const day = Number(joined.slice(8, 10));
    const months = 12 - month + (day <= 15 ? 1 : 0);
    return half((type.daysPerYear * months) / 12);
  }

  private earned(context: Context, employeeId: string, year: number): number {
    const full = context.policy.compOffFullHours;
    const halfDay = context.policy.compOffHalfHours;
    return context.extra
      .filter((row) => row.employeeId === employeeId && row.day.startsWith(String(year)))
      .reduce((sum, row) => {
        if (context.policy.holidayWorkEarnsCompOff && context.holidays.has(row.day)) {
          return sum + (context.policy.holidayWorkCompOffDays || 1);
        }
        const hours = Number(row.hours) || 0;
        return sum + (hours >= full ? 1 : hours >= halfDay ? 0.5 : 0);
      }, 0);
  }

  private async context(companyId: string, employeeIds: string[], year: number): Promise<Context> {
    const from = `${year - LOOKBACK}-01-01`;
    const to = `${year}-12-31`;
    const [types, people, taken, extra, holidays, rules, policy] = await Promise.all([
      this.prisma.leaveType.findMany({ where: { companyId, active: true }, orderBy: { name: 'asc' } }),
      this.prisma.employee.findMany({ where: { companyId, id: { in: employeeIds } }, select: { id: true, dateOfJoining: true } }),
      this.prisma.leaveRequest.findMany({
        where: { companyId, employeeId: { in: employeeIds }, status: 'approved', startsOn: { lte: to }, endsOn: { gte: from } },
        select: { employeeId: true, leaveTypeId: true, startsOn: true, endsOn: true, days: true, portion: true },
      }),
      this.prisma.attendanceRequest.findMany({
        where: { companyId, employeeId: { in: employeeIds }, kind: 'extratime', status: 'approved', day: { gte: from, lte: to } },
        select: { employeeId: true, day: true, hours: true },
      }),
      this.prisma.holiday.findMany({ where: { companyId, day: { gte: from, lte: `${year + 1}-01-31` } }, select: { day: true } }),
      this.settings.timeRules(companyId),
      this.settings.policy(companyId),
    ]);
    return {
      types,
      joined: new Map(people.map((row) => [row.id, row.dateOfJoining])),
      taken,
      extra,
      weekOff: rules.weekOff,
      holidays: new Set(holidays.map((row) => row.day)),
      policy,
    };
  }
}
