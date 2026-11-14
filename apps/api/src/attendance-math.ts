import { eachDay, kolkataDayRange, todayInIndia, weekdayOf } from './dates';
import { PrismaService } from './prisma.service';

export interface MonthCounts {
  working: number;
  present: number;
  late: number;
  early: number;
  missed: number;
  onduty: number;
  leave: number;
  unpaid: number;
  absent: number;
  /** Calendar days in the month the person was employed. */
  employed: number;
}

export interface TimeRules {
  weekOff: number[];
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
}

export function monthEnd(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
}

export function clockMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function minutesInIndia(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Number(parts.find((part) => part.type === 'hour')?.value || 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value || 0);
}

/**
 * Counts each person's month with the same day rules as the attendance calendar.
 * Days after today are not counted as absent.
 */
export async function monthCounts(
  prisma: PrismaService,
  rules: TimeRules,
  companyId: string,
  month: string,
  people: Array<{ id: string; dateOfJoining: string; dateOfExit: string }>,
): Promise<{ counts: Map<string, MonthCounts>; start: string; end: string; last: string; finished: boolean }> {
  const today = todayInIndia();
  const start = month + '-01';
  const last = monthEnd(month);
  const end = last < today ? last : today;
  const counts = new Map<string, MonthCounts>();
  if (start > today) return { counts, start, end: last, last, finished: false };
  const ids = people.map((row) => row.id);
  const range = { start: kolkataDayRange(start).start, end: kolkataDayRange(end).end };
  const [holidays, punches, leaves, requests] = await Promise.all([
    prisma.holiday.findMany({ where: { companyId, day: { gte: start, lte: end } } }),
    prisma.punch.findMany({ where: { companyId, employeeId: { in: ids }, punchedAt: { gte: range.start, lte: range.end } }, orderBy: { punchedAt: 'asc' }, select: { employeeId: true, kind: true, punchedAt: true } }),
    prisma.leaveRequest.findMany({ where: { companyId, employeeId: { in: ids }, status: 'approved', startsOn: { lte: end }, endsOn: { gte: start } }, select: { employeeId: true, startsOn: true, endsOn: true, portion: true, leaveType: { select: { paid: true } } } }),
    prisma.attendanceRequest.findMany({ where: { companyId, employeeId: { in: ids }, status: 'approved', kind: { in: ['onduty', 'wfh'] }, day: { lte: end } }, select: { employeeId: true, kind: true, day: true, endsOn: true } }),
  ]);
  const holiday = new Set(holidays.map((row) => row.day));
  const shiftStart = clockMinutes(rules.shiftStart);
  const shiftEnd = clockMinutes(rules.shiftEnd);
  const punchMap = new Map<string, Array<{ kind: string; at: number }>>();
  for (const punch of punches) {
    const key = punch.employeeId + ':' + todayInIndia(punch.punchedAt);
    punchMap.set(key, [...(punchMap.get(key) || []), { kind: punch.kind, at: minutesInIndia(punch.punchedAt) }]);
  }
  for (const person of people) {
    const row: MonthCounts = { working: 0, present: 0, late: 0, early: 0, missed: 0, onduty: 0, leave: 0, unpaid: 0, absent: 0, employed: 0 };
    for (const day of eachDay(start, last)) {
      if (day < person.dateOfJoining || (person.dateOfExit && day > person.dateOfExit)) continue;
      row.employed += 1;
      if (day > end) continue;
      const off = holiday.has(day) || rules.weekOff.includes(weekdayOf(day));
      const leave = leaves.find((item) => item.employeeId === person.id && item.startsOn <= day && item.endsOn >= day);
      const request = requests.find((item) => item.employeeId === person.id && item.day <= day && (item.endsOn || item.day) >= day);
      const list = punchMap.get(person.id + ':' + day) || [];
      const arrived = list.find((item) => item.kind === 'in');
      const left = [...list].reverse().find((item) => item.kind === 'out');
      if (off && !arrived) continue;
      if (!off) row.working += 1;
      if (leave && !off) {
        const part = leave.portion === 'half' ? 0.5 : 1;
        row.leave += part;
        if (!leave.leaveType.paid) row.unpaid += part;
        if (leave.portion === 'half' && arrived) row.present += 0.5;
      } else if (request?.kind === 'onduty') {
        row.onduty += 1;
      } else if (arrived) {
        row.present += 1;
        if (arrived.at > shiftStart + rules.graceMinutes) row.late += 1;
        if (left && left.at < shiftEnd) row.early += 1;
        if (!left && day < today) row.missed += 1;
      } else if (request?.kind === 'wfh') {
        row.onduty += 1;
      } else if (day < today) {
        row.absent += 1;
      }
    }
    counts.set(person.id, row);
  }
  return { counts, start, end, last, finished: last < today };
}
