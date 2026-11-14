import { Injectable } from '@nestjs/common';
import { ApplicantService } from './applicant.service';
import { AccessService } from './access.service';
import { eachDay, kolkataDayRange, shiftDay, todayInIndia, weekdayOf } from './dates';
import { fail } from './http';
import { LeaveLedger } from './leave-ledger.service';
import { monthCounts } from './attendance-math';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { SettingsService } from './settings.service';

type Period = 'none' | 'month' | 'range' | 'year';
type ColumnType = 'text' | 'number' | 'money' | 'date' | 'status' | 'percent';
type Cell = string | number | null;

export interface Column {
  key: string;
  label: string;
  type: ColumnType;
  total?: boolean;
}

export interface Filters {
  from: string;
  to: string;
  month: string;
  year: string;
  department: string;
  location: string;
  status: string;
}

interface Result {
  columns: Column[];
  rows: Array<Record<string, Cell>>;
  summary?: Array<{ label: string; value: string }>;
  note?: string;
}

interface Definition {
  key: string;
  group: string;
  title: string;
  blurb: string;
  icon: string;
  feature: string;
  period: Period;
  people?: boolean;
  statuses?: Array<{ key: string; label: string }>;
  run: (session: SessionUser, filters: Filters, scope: Set<string> | null) => Promise<Result>;
}

interface PayLine { side: 'earning' | 'deduction' | 'employer'; name: string; paise: number }

const PERSON_STATUS = [
  { key: 'current', label: 'Working now' },
  { key: 'active', label: 'Active' },
  { key: 'onboarding', label: 'Onboarding' },
  { key: 'exited', label: 'Exited' },
  { key: 'all', label: 'Everyone' },
];
const STATUS_LABEL: Record<string, string> = {
  active: 'Active', onboarding: 'Onboarding', exited: 'Exited', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled',
  new: 'New', cooling: 'Cooling period', reviewing: 'Reviewing', shortlisted: 'Shortlisted', interview: 'Interview', hired: 'Hired',
  stock: 'In stock', issued: 'Issued', repair: 'In repair', retired: 'Retired', lost: 'Lost', open: 'Open', closed: 'Closed', draft: 'Draft',
};
const REQUEST_KIND: Record<string, string> = { regularization: 'Regularization', onduty: 'On duty', wfh: 'Work from home', extratime: 'Extra time' };
const MAX_DAYS = 370;

function label(status: string): string {
  return STATUS_LABEL[status] || (status ? status.charAt(0).toUpperCase() + status.slice(1) : '');
}

function pct(part: number, whole: number): number {
  return whole ? Math.round((part / whole) * 1000) / 10 : 0;
}

function lines(raw: string): PayLine[] {
  try {
    const parsed = JSON.parse(raw || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => row as Record<string, unknown>)
      .filter((row) => ['earning', 'deduction', 'employer'].includes(String(row.side)) && Number.isInteger(Number(row.paise)))
      .map((row) => ({ side: row.side as PayLine['side'], name: String(row.name || 'Unnamed').trim().slice(0, 60) || 'Unnamed', paise: Number(row.paise) }));
  } catch {
    return [];
  }
}

function monthLabel(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function monthEnd(month: string): string {
  const [year, value] = month.split('-').map(Number);
  return new Date(Date.UTC(year, value, 0)).toISOString().slice(0, 10);
}

function clock(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function minutesInIndia(date: Date): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  return Number(parts.find((part) => part.type === 'hour')?.value || 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value || 0);
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function dayInIndia(date: Date): string {
  return todayInIndia(date);
}

@Injectable()
export class ReportsService {
  private readonly defs: Definition[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
    private readonly settings: SettingsService,
    private readonly applicants: ApplicantService,
    private readonly ledger: LeaveLedger,
  ) {
    this.defs = this.catalogue();
  }

  async list(session: SessionUser) {
    await this.gates.gate(session, 'reports', 'You do not have access to reports.');
    const held = new Set(await this.gates.keys(session));
    const reports = this.defs.filter((def) => this.allowed(session, held, def));
    const [departments, locations, months] = await Promise.all([
      this.prisma.department.findMany({ where: { companyId: session.companyId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.location.findMany({ where: { companyId: session.companyId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      held.has('pay') || session.role === 'owner'
        ? this.prisma.paySlip.findMany({ where: { companyId: session.companyId }, distinct: ['month'], select: { month: true }, orderBy: { month: 'desc' }, take: 36 })
        : Promise.resolve([]),
    ]);
    return {
      today: todayInIndia(),
      reports: reports.map(({ key, group, title, blurb, icon, period, people, statuses }) => ({ key, group, title, blurb, icon, period, people: Boolean(people), statuses: statuses || [] })),
      departments,
      locations,
      payMonths: months.map((row) => row.month),
    };
  }

  async run(session: SessionUser, key: string, query: Record<string, unknown>) {
    await this.gates.gate(session, 'reports', 'You do not have access to reports.');
    const def = this.defs.find((item) => item.key === key);
    if (!def) fail(404, 'That report was not found.');
    const held = new Set(await this.gates.keys(session));
    if (!this.allowed(session, held, def)) fail(403, 'You do not have access to this report.');
    const filters = this.filters(def, query);
    const span = def.feature === 'owner' ? 'company' : await this.gates.span(session, def.feature);
    const scope = span === 'team' ? await this.teamOf(session) : null;
    const result = await def.run(session, filters, scope);
    await this.prisma.auditEvent.create({
      data: { companyId: session.companyId, actorId: session.id, action: 'report.run', entity: 'report', entityId: def.key, detail: this.periodText(def, filters).slice(0, 120) },
    });
    const totals: Record<string, number> = {};
    for (const column of result.columns.filter((item) => item.total)) {
      totals[column.key] = result.rows.reduce((sum, row) => sum + (typeof row[column.key] === 'number' ? (row[column.key] as number) : 0), 0);
    }
    return {
      key: def.key,
      title: def.title,
      group: def.group,
      period: this.periodText(def, filters),
      filters,
      scope: scope ? 'Your team only' : 'Whole company',
      generatedAt: new Date().toISOString(),
      columns: result.columns,
      rows: result.rows.slice(0, 5000),
      truncated: result.rows.length > 5000,
      totals: Object.keys(totals).length ? totals : null,
      summary: result.summary || [],
      note: result.note || '',
    };
  }

  private allowed(session: SessionUser, held: Set<string>, def: Definition): boolean {
    if (def.feature === 'owner') return session.role === 'owner';
    return session.role === 'owner' || held.has(def.feature);
  }

  private filters(def: Definition, query: Record<string, unknown>): Filters {
    const today = todayInIndia();
    const pick = (value: unknown) => String(value ?? '').trim();
    const day = (value: unknown, fallback: string) => (/^\d{4}-\d{2}-\d{2}$/.test(pick(value)) ? pick(value) : fallback);
    let from = day(query.from, today.slice(0, 8) + '01');
    let to = day(query.to, today);
    if (from > to) [from, to] = [to, from];
    if (eachDay(from, to).length > MAX_DAYS) fail(400, 'Choose a range of up to a year.');
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(pick(query.month)) ? pick(query.month) : today.slice(0, 7);
    const year = /^\d{4}$/.test(pick(query.year)) ? pick(query.year) : today.slice(0, 4);
    const status = pick(query.status).slice(0, 20);
    const allowed = new Set((def.statuses || []).map((item) => item.key));
    return {
      from,
      to,
      month,
      year,
      department: pick(query.department).slice(0, 40),
      location: pick(query.location).slice(0, 40),
      status: allowed.has(status) ? status : def.statuses?.[0]?.key || '',
    };
  }

  private periodText(def: Definition, filters: Filters): string {
    if (def.period === 'month') return monthLabel(filters.month);
    if (def.period === 'year') return 'Calendar year ' + filters.year;
    if (def.period === 'range') return filters.from + ' to ' + filters.to;
    return 'As of ' + todayInIndia();
  }

  private async teamOf(session: SessionUser): Promise<Set<string>> {
    const people = await this.prisma.employee.findMany({ where: { companyId: session.companyId }, select: { id: true, managerId: true } });
    const children = new Map<string, string[]>();
    for (const person of people) {
      if (!person.managerId) continue;
      children.set(person.managerId, [...(children.get(person.managerId) || []), person.id]);
    }
    const mine = new Set<string>();
    const walk = (id: string) => {
      for (const child of children.get(id) || []) {
        if (mine.has(child)) continue;
        mine.add(child);
        walk(child);
      }
    };
    walk(session.employeeId || '');
    return mine;
  }

  private async people(session: SessionUser, filters: Filters, scope: Set<string> | null, status = filters.status) {
    const where: Record<string, unknown> = { companyId: session.companyId };
    if (filters.department) where.departmentId = filters.department;
    if (filters.location) where.locationId = filters.location;
    if (status === 'current') where.status = { in: ['active', 'onboarding'] };
    else if (status && status !== 'all') where.status = status;
    const rows = await this.prisma.employee.findMany({
      where,
      include: { department: true, designation: true, location: true, manager: { select: { firstName: true, lastName: true } }, team: { select: { name: true } }, level: { select: { name: true } } },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    return scope ? rows.filter((row) => scope.has(row.id)) : rows;
  }

  private base(person: { code: string; firstName: string; lastName: string; department: { name: string } | null; designation?: { name: string } | null }) {
    return {
      code: person.code,
      name: `${person.firstName} ${person.lastName}`.trim(),
      department: person.department?.name || '',
      designation: person.designation?.name || '',
    };
  }

  private baseColumns(designation = true): Column[] {
    return [
      { key: 'code', label: 'Code', type: 'text' },
      { key: 'name', label: 'Name', type: 'text' },
      { key: 'department', label: 'Department', type: 'text' },
      ...(designation ? [{ key: 'designation', label: 'Designation', type: 'text' as const }] : []),
    ];
  }

  private catalogue(): Definition[] {
    return [
      // People
      {
        key: 'employee-master', group: 'People', title: 'Employee master', icon: 'bi-person-lines-fill', feature: 'people', period: 'none', people: true, statuses: PERSON_STATUS,
        blurb: 'Everyone with their job, team, manager, joining and contact details. PAN, bank and Aadhaar are never shown.',
        run: async (session, filters, scope) => {
          const rows = await this.people(session, filters, scope);
          return {
            columns: [
              ...this.baseColumns(), { key: 'location', label: 'Location', type: 'text' }, { key: 'team', label: 'Team', type: 'text' },
              { key: 'level', label: 'Level', type: 'text' }, { key: 'manager', label: 'Reports to', type: 'text' }, { key: 'workerType', label: 'Worker type', type: 'text' },
              { key: 'status', label: 'Status', type: 'status' }, { key: 'joined', label: 'Joined', type: 'date' }, { key: 'confirmed', label: 'Confirmed', type: 'date' },
              { key: 'exit', label: 'Exit date', type: 'date' }, { key: 'gender', label: 'Gender', type: 'text' }, { key: 'email', label: 'Work email', type: 'text' },
              { key: 'phone', label: 'Mobile', type: 'text' }, { key: 'city', label: 'City', type: 'text' },
            ],
            rows: rows.map((row) => ({
              ...this.base(row), location: row.location?.name || '', team: row.team?.name || '', level: row.level?.name || '',
              manager: row.manager ? `${row.manager.firstName} ${row.manager.lastName}`.trim() : '', workerType: label(row.workerType),
              status: label(row.status), joined: row.dateOfJoining, confirmed: row.confirmedOn, exit: row.dateOfExit, gender: label(row.gender),
              email: row.email, phone: row.phone, city: row.city,
            })),
            summary: [
              { label: 'People', value: String(rows.length) },
              { label: 'Active', value: String(rows.filter((row) => row.status === 'active').length) },
              { label: 'Onboarding', value: String(rows.filter((row) => row.status === 'onboarding').length) },
              { label: 'Exited', value: String(rows.filter((row) => row.status === 'exited').length) },
            ],
          };
        },
      },
      {
        key: 'headcount', group: 'People', title: 'Headcount by department', icon: 'bi-pie-chart', feature: 'people', period: 'none', people: true,
        blurb: 'People working now in each department, split by location type, gender and worker type.',
        run: async (session, filters, scope) => {
          const rows = await this.people(session, filters, scope, 'current');
          const groups = new Map<string, typeof rows>();
          for (const row of rows) groups.set(row.department?.name || 'No department', [...(groups.get(row.department?.name || 'No department') || []), row]);
          return {
            columns: [
              { key: 'department', label: 'Department', type: 'text' }, { key: 'total', label: 'People', type: 'number', total: true },
              { key: 'active', label: 'Active', type: 'number', total: true }, { key: 'onboarding', label: 'Onboarding', type: 'number', total: true },
              { key: 'male', label: 'Male', type: 'number', total: true }, { key: 'female', label: 'Female', type: 'number', total: true },
              { key: 'otherGender', label: 'Other or not given', type: 'number', total: true }, { key: 'contract', label: 'Not on payroll', type: 'number', total: true },
              { key: 'share', label: 'Share', type: 'percent' },
            ],
            rows: [...groups].sort((a, b) => b[1].length - a[1].length).map(([name, list]) => ({
              department: name, total: list.length,
              active: list.filter((row) => row.status === 'active').length, onboarding: list.filter((row) => row.status === 'onboarding').length,
              male: list.filter((row) => row.gender === 'male').length, female: list.filter((row) => row.gender === 'female').length,
              otherGender: list.filter((row) => row.gender !== 'male' && row.gender !== 'female').length,
              contract: list.filter((row) => row.workerType !== 'employee').length, share: pct(list.length, rows.length),
            })),
            summary: [{ label: 'Working now', value: String(rows.length) }, { label: 'Departments', value: String(groups.size) }],
          };
        },
      },
      {
        key: 'joiners', group: 'People', title: 'New joiners', icon: 'bi-person-plus', feature: 'people', period: 'range', people: true,
        blurb: 'People whose joining date falls in the period.',
        run: async (session, filters, scope) => {
          const rows = (await this.people(session, filters, scope, 'all')).filter((row) => row.dateOfJoining >= filters.from && row.dateOfJoining <= filters.to);
          return {
            columns: [...this.baseColumns(), { key: 'location', label: 'Location', type: 'text' }, { key: 'manager', label: 'Reports to', type: 'text' }, { key: 'joined', label: 'Joined', type: 'date' }, { key: 'status', label: 'Status now', type: 'status' }],
            rows: rows.sort((a, b) => a.dateOfJoining.localeCompare(b.dateOfJoining)).map((row) => ({
              ...this.base(row), location: row.location?.name || '', manager: row.manager ? `${row.manager.firstName} ${row.manager.lastName}`.trim() : '', joined: row.dateOfJoining, status: label(row.status),
            })),
            summary: [{ label: 'Joined', value: String(rows.length) }],
          };
        },
      },
      {
        key: 'leavers', group: 'People', title: 'Exits and attrition', icon: 'bi-box-arrow-right', feature: 'people', period: 'range', people: true,
        blurb: 'People who left in the period, with the reason they gave, and the attrition rate.',
        run: async (session, filters, scope) => {
          const everyone = await this.people(session, filters, scope, 'all');
          const left = everyone.filter((row) => row.dateOfExit && row.dateOfExit >= filters.from && row.dateOfExit <= filters.to);
          const exits = await this.prisma.exitRequest.findMany({ where: { companyId: session.companyId, employeeId: { in: left.map((row) => row.id) } }, orderBy: { createdAt: 'desc' } });
          const reason = new Map<string, string>();
          for (const row of exits) if (!reason.has(row.employeeId)) reason.set(row.employeeId, row.reason);
          const working = (day: string) => everyone.filter((row) => row.dateOfJoining && row.dateOfJoining <= day && (!row.dateOfExit || row.dateOfExit > day)).length;
          const average = (working(filters.from) + working(filters.to)) / 2;
          const tenure = (row: { dateOfJoining: string; dateOfExit: string }) => {
            const months = Math.round((new Date(row.dateOfExit).getTime() - new Date(row.dateOfJoining).getTime()) / (30.44 * 86400000));
            return Number.isFinite(months) && months >= 0 ? months : null;
          };
          return {
            columns: [...this.baseColumns(), { key: 'joined', label: 'Joined', type: 'date' }, { key: 'exit', label: 'Last day', type: 'date' }, { key: 'tenure', label: 'Months served', type: 'number' }, { key: 'reason', label: 'Reason given', type: 'text' }],
            rows: left.sort((a, b) => a.dateOfExit.localeCompare(b.dateOfExit)).map((row) => ({ ...this.base(row), joined: row.dateOfJoining, exit: row.dateOfExit, tenure: tenure(row), reason: reason.get(row.id) || '' })),
            summary: [
              { label: 'Left', value: String(left.length) },
              { label: 'Average headcount', value: String(Math.round(average * 10) / 10) },
              { label: 'Attrition in the period', value: pct(left.length, average) + '%' },
            ],
            note: 'Attrition is people who left divided by the average of the headcount on the first and last day of the period.',
          };
        },
      },
      {
        key: 'celebrations', group: 'People', title: 'Birthdays and work anniversaries', icon: 'bi-cake2', feature: 'people', period: 'month', people: true,
        blurb: 'Who has a birthday or a work anniversary in the month.',
        run: async (session, filters, scope) => {
          const rows = await this.people(session, filters, scope, 'current');
          const mm = filters.month.slice(5, 7);
          const year = Number(filters.month.slice(0, 4));
          const out: Array<Record<string, Cell>> = [];
          for (const row of rows) {
            if (/^\d{4}-\d{2}-\d{2}$/.test(row.dateOfBirth) && row.dateOfBirth.slice(5, 7) === mm) out.push({ ...this.base(row), kind: 'Birthday', day: filters.month + '-' + row.dateOfBirth.slice(8, 10), years: null });
            if (/^\d{4}-\d{2}-\d{2}$/.test(row.dateOfJoining) && row.dateOfJoining.slice(5, 7) === mm && Number(row.dateOfJoining.slice(0, 4)) < year) {
              out.push({ ...this.base(row), kind: 'Work anniversary', day: filters.month + '-' + row.dateOfJoining.slice(8, 10), years: year - Number(row.dateOfJoining.slice(0, 4)) });
            }
          }
          out.sort((a, b) => String(a.day).localeCompare(String(b.day)));
          return {
            columns: [...this.baseColumns(), { key: 'kind', label: 'Occasion', type: 'text' }, { key: 'day', label: 'Day', type: 'date' }, { key: 'years', label: 'Years', type: 'number' }],
            rows: out,
            summary: [{ label: 'Birthdays', value: String(out.filter((row) => row.kind === 'Birthday').length) }, { label: 'Anniversaries', value: String(out.filter((row) => row.kind !== 'Birthday').length) }],
          };
        },
      },
      {
        key: 'profile-gaps', group: 'People', title: 'Missing employee details', icon: 'bi-clipboard-x', feature: 'people', period: 'none', people: true,
        blurb: 'What is still missing on each record, such as date of birth, PAN, bank, UAN or emergency contact. Values are never shown, only whether they are on file.',
        run: async (session, filters, scope) => {
          const rows = await this.people(session, filters, scope, 'current');
          const checks: Array<[string, string, (row: (typeof rows)[number]) => boolean]> = [
            ['dob', 'Date of birth', (row) => Boolean(row.dateOfBirth)], ['pan', 'PAN', (row) => Boolean(row.panEnc)], ['bank', 'Bank account', (row) => Boolean(row.bankEnc && row.ifscEnc)],
            ['uan', 'UAN', (row) => Boolean(row.uan)], ['aadhaar', 'Aadhaar', (row) => Boolean(row.aadhaarEnc)], ['emergency', 'Emergency contact', (row) => Boolean(row.emergencyName && row.emergencyPhone)],
            ['address', 'Address', (row) => Boolean(row.address || row.permanentAddress)], ['photo', 'Photo', (row) => Boolean(row.photoAt)], ['manager', 'Reports to', (row) => Boolean(row.managerId)],
          ];
          const out = rows.map((row) => {
            const done = checks.filter(([, , test]) => test(row)).length;
            return {
              ...this.base(row),
              ...Object.fromEntries(checks.map(([key, , test]) => [key, test(row) ? 'On file' : 'Missing'])),
              complete: pct(done, checks.length),
              missing: checks.filter(([, , test]) => !test(row)).map(([, name]) => name).join(', '),
            };
          }).sort((a, b) => a.complete - b.complete);
          return {
            columns: [...this.baseColumns(false), ...checks.map(([key, name]) => ({ key, label: name, type: 'status' as const })), { key: 'complete', label: 'Complete', type: 'percent' }, { key: 'missing', label: 'Missing', type: 'text' }],
            rows: out,
            summary: [
              { label: 'People checked', value: String(out.length) },
              { label: 'Fully complete', value: String(out.filter((row) => row.complete === 100).length) },
              ...checks.slice(0, 4).map(([, name, test]) => ({ label: 'No ' + name, value: String(rows.filter((row) => !test(row)).length) })),
            ],
          };
        },
      },
      {
        key: 'confirmation', group: 'People', title: 'Probation and confirmation', icon: 'bi-patch-check', feature: 'people', period: 'none', people: true,
        blurb: 'People working now who are not confirmed yet, with how long they have been here.',
        run: async (session, filters, scope) => {
          const today = todayInIndia();
          const rows = (await this.people(session, filters, scope, 'current')).filter((row) => !row.confirmedOn);
          const days = (from: string) => (/^\d{4}-\d{2}-\d{2}$/.test(from) ? Math.max(0, Math.round((new Date(today).getTime() - new Date(from).getTime()) / 86400000)) : null);
          return {
            columns: [...this.baseColumns(), { key: 'manager', label: 'Reports to', type: 'text' }, { key: 'joined', label: 'Joined', type: 'date' }, { key: 'days', label: 'Days since joining', type: 'number' }, { key: 'status', label: 'Status', type: 'status' }],
            rows: rows.map((row) => ({ ...this.base(row), manager: row.manager ? `${row.manager.firstName} ${row.manager.lastName}`.trim() : '', joined: row.dateOfJoining, days: days(row.dateOfJoining), status: label(row.status) }))
              .sort((a, b) => (b.days || 0) - (a.days || 0)),
            summary: [{ label: 'Not confirmed', value: String(rows.length) }, { label: 'Over 180 days', value: String(rows.filter((row) => (days(row.dateOfJoining) || 0) > 180).length) }],
          };
        },
      },

      // Attendance
      {
        key: 'attendance-month', group: 'Attendance', title: 'Monthly attendance summary', icon: 'bi-calendar3', feature: 'exceptions', period: 'month', people: true,
        blurb: 'For each person: working days, present, late, early out, missed check-out, on duty, leave and absent. Uses the same rules as the attendance calendar.',
        run: (session, filters, scope) => this.attendanceMonth(session, filters, scope),
      },
      {
        key: 'late-register', group: 'Attendance', title: 'Late arrivals and early exits', icon: 'bi-alarm', feature: 'exceptions', period: 'range', people: true,
        blurb: 'Every day someone checked in after the grace time or left before the shift ended.',
        run: (session, filters, scope) => this.lateRegister(session, filters, scope),
      },
      {
        key: 'attendance-requests', group: 'Attendance', title: 'Regularization, on duty and work from home', icon: 'bi-geo-alt', feature: 'approvals', period: 'range', people: true,
        statuses: [{ key: 'all', label: 'Every status' }, { key: 'pending', label: 'Pending' }, { key: 'approved', label: 'Approved' }, { key: 'rejected', label: 'Rejected' }],
        blurb: 'Attendance requests raised in the period and what was decided.',
        run: async (session, filters, scope) => {
          const people = await this.people(session, filters, scope, 'all');
          const byId = new Map(people.map((row) => [row.id, row]));
          const rows = await this.prisma.attendanceRequest.findMany({
            where: { companyId: session.companyId, employeeId: { in: [...byId.keys()] }, day: { gte: filters.from, lte: filters.to }, ...(filters.status && filters.status !== 'all' ? { status: filters.status } : {}) },
            orderBy: { day: 'asc' },
          });
          return {
            columns: [...this.baseColumns(false), { key: 'kind', label: 'Request', type: 'text' }, { key: 'day', label: 'Day', type: 'date' }, { key: 'until', label: 'Until', type: 'date' }, { key: 'in', label: 'In', type: 'text' }, { key: 'out', label: 'Out', type: 'text' }, { key: 'place', label: 'Place', type: 'text' }, { key: 'reason', label: 'Reason', type: 'text' }, { key: 'status', label: 'Status', type: 'status' }],
            rows: rows.map((row) => {
              const person = byId.get(row.employeeId)!;
              return { ...this.base(person), kind: REQUEST_KIND[row.kind] || row.kind, day: row.day, until: row.endsOn, in: row.inTime, out: row.outTime, place: row.place, reason: row.reason, status: label(row.status) };
            }),
            summary: ['pending', 'approved', 'rejected'].map((status) => ({ label: label(status), value: String(rows.filter((row) => row.status === status).length) })),
          };
        },
      },

      // Leave
      {
        key: 'leave-register', group: 'Leave', title: 'Leave register', icon: 'bi-calendar2-week', feature: 'approvals', period: 'range', people: true,
        statuses: [{ key: 'all', label: 'Every status' }, { key: 'approved', label: 'Approved' }, { key: 'pending', label: 'Pending' }, { key: 'rejected', label: 'Rejected' }, { key: 'cancelled', label: 'Cancelled' }],
        blurb: 'Every leave request that touches the period, with days, type and decision.',
        run: async (session, filters, scope) => {
          const people = await this.people(session, filters, scope, 'all');
          const byId = new Map(people.map((row) => [row.id, row]));
          const rows = await this.prisma.leaveRequest.findMany({
            where: { companyId: session.companyId, employeeId: { in: [...byId.keys()] }, startsOn: { lte: filters.to }, endsOn: { gte: filters.from }, ...(filters.status && filters.status !== 'all' ? { status: filters.status } : {}) },
            include: { leaveType: true },
            orderBy: { startsOn: 'asc' },
          });
          const charged = (row: { days: number; portion: string }) => (row.portion === 'half' ? 0.5 : row.days);
          return {
            columns: [...this.baseColumns(false), { key: 'type', label: 'Leave type', type: 'text' }, { key: 'paid', label: 'Paid', type: 'text' }, { key: 'from', label: 'From', type: 'date' }, { key: 'to', label: 'To', type: 'date' }, { key: 'days', label: 'Days', type: 'number', total: true }, { key: 'status', label: 'Status', type: 'status' }, { key: 'applied', label: 'Applied', type: 'date' }, { key: 'decided', label: 'Decided', type: 'date' }, { key: 'reason', label: 'Reason', type: 'text' }],
            rows: rows.map((row) => {
              const person = byId.get(row.employeeId)!;
              return { ...this.base(person), type: row.leaveType.name, paid: row.leaveType.paid ? 'Paid' : 'Unpaid', from: row.startsOn, to: row.endsOn, days: charged(row), status: label(row.status), applied: dayInIndia(row.createdAt), decided: row.decidedAt ? dayInIndia(row.decidedAt) : '', reason: row.reason };
            }),
            summary: [
              { label: 'Requests', value: String(rows.length) },
              { label: 'Approved days', value: String(rows.filter((row) => row.status === 'approved').reduce((sum, row) => sum + charged(row), 0)) },
              { label: 'Unpaid approved days', value: String(rows.filter((row) => row.status === 'approved' && !row.leaveType.paid).reduce((sum, row) => sum + charged(row), 0)) },
              { label: 'Waiting for a decision', value: String(rows.filter((row) => row.status === 'pending').length) },
            ],
            note: 'Days are the full request, even when it runs past the period.',
          };
        },
      },
      {
        key: 'leave-balance', group: 'Leave', title: 'Leave balances', icon: 'bi-hourglass-split', feature: 'approvals', period: 'year', people: true,
        blurb: 'Days used and left for each leave type in the calendar year. Same numbers people see on their Leave page.',
        run: async (session, filters, scope) => {
          const people = await this.people(session, filters, scope, 'current');
          const [types, ledger] = await Promise.all([
            this.prisma.leaveType.findMany({ where: { companyId: session.companyId, active: true }, orderBy: { name: 'asc' } }),
            this.ledger.many(session.companyId, people.map((row) => row.id), filters.year),
          ]);
          const limited = (type: { daysPerYear: number; compOff: boolean; carryForwardMax: number }) => type.daysPerYear > 0 || type.compOff || type.carryForwardMax > 0;
          return {
            columns: [
              ...this.baseColumns(false),
              ...types.flatMap((type) => [
                ...(type.carryForwardMax > 0 ? [{ key: type.id + ':carried', label: type.code + ' carried', type: 'number' as const, total: true }] : []),
                ...(type.compOff ? [{ key: type.id + ':earned', label: type.code + ' earned', type: 'number' as const, total: true }] : []),
                { key: type.id + ':used', label: type.code + ' used', type: 'number' as const, total: true },
                ...(limited(type) ? [{ key: type.id + ':left', label: type.code + ' left', type: 'number' as const, total: true }] : []),
              ]),
            ],
            rows: people.map((person) => {
              const mine = ledger.get(person.id) || [];
              return {
                ...this.base(person),
                ...Object.fromEntries(types.flatMap((type) => {
                  const row = mine.find((item) => item.id === type.id);
                  return [
                    ...(type.carryForwardMax > 0 ? [[type.id + ':carried', row?.carried || 0]] : []),
                    ...(type.compOff ? [[type.id + ':earned', row?.earned || 0]] : []),
                    [type.id + ':used', row?.used || 0],
                    ...(limited(type) ? [[type.id + ':left', row?.left || 0]] : []),
                  ];
                })),
              };
            }),
            note: 'Joiners get a pro-rated quota in their first year when that is turned on in Settings. Leave that crosses 31 December is split by working days.',
            summary: types.map((type) => ({ label: type.name, value: type.compOff ? 'Earned from extra time' : type.daysPerYear > 0 ? type.daysPerYear + ' a year' + (type.carryForwardMax > 0 ? ', carry up to ' + type.carryForwardMax : '') : 'No limit' })),
          };
        },
      },

      // Payroll
      {
        key: 'salary-register', group: 'Payroll', title: 'Salary register', icon: 'bi-table', feature: 'pay', period: 'month', people: true,
        blurb: 'Every slip entered for the month: each earning and deduction line, gross, deductions, net pay and employer cost. Only amounts payroll entered are shown.',
        run: (session, filters, scope) => this.salaryRegister(session, filters, scope),
      },
      {
        key: 'pay-department', group: 'Payroll', title: 'Payroll cost by department', icon: 'bi-diagram-3', feature: 'pay', period: 'month', people: true,
        blurb: 'Gross, deductions, net pay and employer cost for the month, added up by department.',
        run: async (session, filters, scope) => {
          const slips = await this.slips(session, filters, scope);
          const groups = new Map<string, { people: number; gross: number; deductions: number; net: number; employer: number }>();
          for (const slip of slips) {
            const name = slip.person.department?.name || 'No department';
            const row = groups.get(name) || { people: 0, gross: 0, deductions: 0, net: 0, employer: 0 };
            row.people += 1; row.gross += slip.gross; row.deductions += slip.deductions; row.net += slip.net; row.employer += slip.employer;
            groups.set(name, row);
          }
          const all = slips.reduce((sum, slip) => sum + slip.gross + slip.employer, 0);
          return {
            columns: [{ key: 'department', label: 'Department', type: 'text' }, { key: 'people', label: 'Slips', type: 'number', total: true }, { key: 'gross', label: 'Gross', type: 'money', total: true }, { key: 'deductions', label: 'Deductions', type: 'money', total: true }, { key: 'net', label: 'Net pay', type: 'money', total: true }, { key: 'employer', label: 'Employer cost', type: 'money', total: true }, { key: 'cost', label: 'Total cost', type: 'money', total: true }, { key: 'share', label: 'Share of cost', type: 'percent' }],
            rows: [...groups].sort((a, b) => b[1].gross - a[1].gross).map(([department, row]) => ({ department, ...row, cost: row.gross + row.employer, share: pct(row.gross + row.employer, all) })),
            summary: [{ label: 'Slips', value: String(slips.length) }],
          };
        },
      },
      {
        key: 'pay-lines', group: 'Payroll', title: 'Deductions and contributions', icon: 'bi-receipt-cutoff', feature: 'pay', period: 'month', people: true,
        blurb: 'Each deduction and employer line on the month’s slips, such as PF, ESI, professional tax or TDS, as payroll named them, with totals.',
        run: async (session, filters, scope) => {
          const slips = await this.slips(session, filters, scope);
          const groups = new Map<string, { side: string; name: string; people: number; total: number }>();
          for (const slip of slips) {
            for (const line of slip.lines) {
              const key = line.side + ':' + line.name.toLowerCase();
              const row = groups.get(key) || { side: line.side, name: line.name, people: 0, total: 0 };
              row.people += 1; row.total += line.paise;
              groups.set(key, row);
            }
          }
          const order = { earning: 0, deduction: 1, employer: 2 } as Record<string, number>;
          return {
            columns: [{ key: 'side', label: 'Kind', type: 'text' }, { key: 'name', label: 'Line', type: 'text' }, { key: 'people', label: 'People', type: 'number' }, { key: 'total', label: 'Total', type: 'money' }],
            rows: [...groups.values()].sort((a, b) => order[a.side] - order[b.side] || b.total - a.total).map((row) => ({ ...row, side: row.side === 'earning' ? 'Earning' : row.side === 'deduction' ? 'Deduction' : 'Employer contribution' })),
            summary: [
              { label: 'Total earnings', value: this.rupees(slips.reduce((sum, slip) => sum + slip.gross, 0)) },
              { label: 'Total deductions', value: this.rupees(slips.reduce((sum, slip) => sum + slip.deductions, 0)) },
              { label: 'Employer contributions', value: this.rupees(slips.reduce((sum, slip) => sum + slip.employer, 0)) },
            ],
            note: 'Lines are grouped by the name payroll gave them. Nothing here is calculated by the HRMS.',
          };
        },
      },
      {
        key: 'pay-trend', group: 'Payroll', title: 'Payroll month by month', icon: 'bi-graph-up', feature: 'pay', period: 'none', people: true,
        blurb: 'The last twelve months of entered slips: people paid, gross, deductions, net pay and employer cost.',
        run: async (session, filters, scope) => {
          const people = await this.people(session, filters, scope, 'all');
          const ids = new Set(people.map((row) => row.id));
          const rows = await this.prisma.paySlip.findMany({ where: { companyId: session.companyId }, orderBy: { month: 'desc' } });
          const groups = new Map<string, { slips: number; published: number; gross: number; deductions: number; net: number; employer: number }>();
          for (const slip of rows.filter((row) => ids.has(row.employeeId))) {
            const list = lines(slip.linesJson);
            const gross = list.filter((line) => line.side === 'earning').reduce((sum, line) => sum + line.paise, 0);
            const deductions = list.filter((line) => line.side === 'deduction').reduce((sum, line) => sum + line.paise, 0);
            const employer = list.filter((line) => line.side === 'employer').reduce((sum, line) => sum + line.paise, 0);
            const row = groups.get(slip.month) || { slips: 0, published: 0, gross: 0, deductions: 0, net: 0, employer: 0 };
            row.slips += 1; row.published += slip.published ? 1 : 0; row.gross += gross; row.deductions += deductions; row.net += gross - deductions; row.employer += employer;
            groups.set(slip.month, row);
          }
          const months = [...groups.keys()].sort().reverse().slice(0, 12);
          return {
            columns: [{ key: 'month', label: 'Month', type: 'text' }, { key: 'slips', label: 'Slips', type: 'number' }, { key: 'published', label: 'Published', type: 'number' }, { key: 'gross', label: 'Gross', type: 'money', total: true }, { key: 'deductions', label: 'Deductions', type: 'money', total: true }, { key: 'net', label: 'Net pay', type: 'money', total: true }, { key: 'employer', label: 'Employer cost', type: 'money', total: true }],
            rows: months.map((month) => ({ month: monthLabel(month), ...groups.get(month)! })),
            summary: [{ label: 'Months with slips', value: String(months.length) }],
          };
        },
      },
      {
        key: 'ctc-register', group: 'Payroll', title: 'CTC register', icon: 'bi-cash-stack', feature: 'pay', period: 'none', people: true, statuses: PERSON_STATUS.slice(0, 1).concat(PERSON_STATUS.slice(4)),
        blurb: 'The latest CTC entered for each person: annual earnings, employer contributions and total CTC, with the date it applies from.',
        run: async (session, filters, scope) => {
          const people = await this.people(session, filters, scope);
          const structures = await this.prisma.payStructure.findMany({ where: { companyId: session.companyId, employeeId: { in: people.map((row) => row.id) } }, orderBy: { effectiveFrom: 'desc' } });
          const latest = new Map<string, (typeof structures)[number]>();
          for (const row of structures) if (!latest.has(row.employeeId)) latest.set(row.employeeId, row);
          const out = people.map((person) => {
            const row = latest.get(person.id);
            const list = row ? lines(row.linesJson) : [];
            const earnings = list.filter((line) => line.side === 'earning').reduce((sum, line) => sum + line.paise, 0);
            const employer = list.filter((line) => line.side === 'employer').reduce((sum, line) => sum + line.paise, 0);
            return { ...this.base(person), joined: person.dateOfJoining, from: row?.effectiveFrom || '', earnings: row ? earnings : null, employer: row ? employer : null, ctc: row ? earnings + employer : null, state: row ? (row.published ? 'Published' : 'Draft') : 'Not entered' };
          });
          return {
            columns: [...this.baseColumns(), { key: 'joined', label: 'Joined', type: 'date' }, { key: 'from', label: 'Applies from', type: 'date' }, { key: 'earnings', label: 'Earnings a year', type: 'money', total: true }, { key: 'employer', label: 'Employer a year', type: 'money', total: true }, { key: 'ctc', label: 'CTC a year', type: 'money', total: true }, { key: 'state', label: 'CTC', type: 'status' }],
            rows: out,
            summary: [{ label: 'People', value: String(out.length) }, { label: 'CTC entered', value: String(out.filter((row) => row.ctc !== null).length) }, { label: 'Not entered', value: String(out.filter((row) => row.ctc === null).length) }],
          };
        },
      },
      {
        key: 'pay-readiness', group: 'Payroll', title: 'Payroll readiness', icon: 'bi-list-check', feature: 'pay', period: 'month', people: true,
        blurb: 'Before you pay: who has no CTC, no slip for the month, or is missing PAN, bank or UAN. Values are never shown.',
        run: async (session, filters, scope) => {
          const end = monthEnd(filters.month);
          const people = (await this.people(session, filters, scope, 'all')).filter((row) => row.dateOfJoining && row.dateOfJoining <= end && (!row.dateOfExit || row.dateOfExit >= filters.month + '-01'));
          const ids = people.map((row) => row.id);
          const [structures, slips] = await Promise.all([
            this.prisma.payStructure.findMany({ where: { companyId: session.companyId, employeeId: { in: ids } }, select: { employeeId: true } }),
            this.prisma.paySlip.findMany({ where: { companyId: session.companyId, month: filters.month, employeeId: { in: ids } }, select: { employeeId: true, published: true } }),
          ]);
          const hasCtc = new Set(structures.map((row) => row.employeeId));
          const slip = new Map(slips.map((row) => [row.employeeId, row.published]));
          const out = people.map((person) => {
            const gaps = [!hasCtc.has(person.id) && 'CTC', !slip.has(person.id) && 'Slip', !person.panEnc && 'PAN', !(person.bankEnc && person.ifscEnc) && 'Bank', !person.uan && 'UAN'].filter(Boolean) as string[];
            return {
              ...this.base(person), status: label(person.status), ctc: hasCtc.has(person.id) ? 'On file' : 'Missing',
              slip: slip.has(person.id) ? (slip.get(person.id) ? 'Published' : 'Draft') : 'Missing',
              pan: person.panEnc ? 'On file' : 'Missing', bank: person.bankEnc && person.ifscEnc ? 'On file' : 'Missing', uan: person.uan ? 'On file' : 'Missing',
              ready: gaps.length ? 'Missing ' + gaps.join(', ') : 'Ready',
            };
          }).sort((a, b) => (a.ready === 'Ready' ? 1 : 0) - (b.ready === 'Ready' ? 1 : 0));
          return {
            columns: [...this.baseColumns(false), { key: 'status', label: 'Status', type: 'status' }, { key: 'ctc', label: 'CTC', type: 'status' }, { key: 'slip', label: 'Slip', type: 'status' }, { key: 'pan', label: 'PAN', type: 'status' }, { key: 'bank', label: 'Bank', type: 'status' }, { key: 'uan', label: 'UAN', type: 'status' }, { key: 'ready', label: 'Ready to pay', type: 'status' }],
            rows: out,
            summary: [
              { label: 'People in the month', value: String(out.length) },
              { label: 'Ready', value: String(out.filter((row) => row.ready === 'Ready').length) },
              { label: 'No slip yet', value: String(out.filter((row) => row.slip === 'Missing').length) },
              { label: 'Draft slips', value: String(out.filter((row) => row.slip === 'Draft').length) },
            ],
          };
        },
      },

      // Hiring
      {
        key: 'applications', group: 'Hiring', title: 'Applications register', icon: 'bi-inboxes', feature: 'hiring', period: 'range',
        statuses: [{ key: 'all', label: 'Every status' }, ...['new', 'cooling', 'reviewing', 'shortlisted', 'interview', 'rejected', 'hired'].map((key) => ({ key, label: label(key) }))],
        blurb: 'Every application received in the period with the job, source, status and the job description match.',
        run: async (session, filters) => {
          const rows = await this.prisma.jobApplication.findMany({
            where: { companyId: session.companyId, createdAt: { gte: kolkataDayRange(filters.from).start, lte: kolkataDayRange(filters.to).end }, ...(filters.status && filters.status !== 'all' ? { status: filters.status } : {}) },
            include: { opening: { select: { title: true, description: true, requirements: true, location: true, workplace: true } } },
            orderBy: { createdAt: 'asc' },
          });
          const note = (raw: string) => { try { const parsed = JSON.parse(raw || '{}') as Record<string, unknown>; return String(parsed.note || parsed.message || ''); } catch { return ''; } };
          const out = rows.map((row) => ({
            received: dayInIndia(row.createdAt), name: row.name, email: row.email, phone: row.phone, city: row.city, job: row.jobTitle || 'General form', code: row.jobCode,
            source: row.source === 'form' ? 'Website form' : row.source === 'website' ? 'Company website' : label(row.source), status: label(row.status),
            score: this.applicants.score(row.opening, row, note(row.answersJson)).score,
          }));
          return {
            columns: [{ key: 'received', label: 'Received', type: 'date' }, { key: 'name', label: 'Candidate', type: 'text' }, { key: 'email', label: 'Email', type: 'text' }, { key: 'phone', label: 'Mobile', type: 'text' }, { key: 'city', label: 'City', type: 'text' }, { key: 'job', label: 'Job', type: 'text' }, { key: 'code', label: 'Job code', type: 'text' }, { key: 'source', label: 'Source', type: 'text' }, { key: 'score', label: 'Match', type: 'percent' }, { key: 'status', label: 'Status', type: 'status' }],
            rows: out,
            summary: [{ label: 'Received', value: String(out.length) }, { label: 'Shortlisted or later', value: String(rows.filter((row) => ['shortlisted', 'interview', 'hired'].includes(row.status)).length) }, { label: 'Hired', value: String(rows.filter((row) => row.status === 'hired').length) }],
          };
        },
      },
      {
        key: 'hiring-funnel', group: 'Hiring', title: 'Hiring funnel by job', icon: 'bi-funnel', feature: 'hiring', period: 'range',
        blurb: 'For each job, how many applications came in during the period and where they are now.',
        run: async (session, filters) => {
          const rows = await this.prisma.jobApplication.findMany({
            where: { companyId: session.companyId, createdAt: { gte: kolkataDayRange(filters.from).start, lte: kolkataDayRange(filters.to).end } },
            select: { jobTitle: true, jobCode: true, status: true, opening: { select: { status: true, seats: true } } },
          });
          const keys = ['new', 'cooling', 'reviewing', 'shortlisted', 'interview', 'rejected', 'hired'];
          const groups = new Map<string, { job: string; code: string; state: string; seats: number | null; counts: Record<string, number> }>();
          for (const row of rows) {
            const id = row.jobCode || 'general';
            const group = groups.get(id) || { job: row.jobTitle || 'General form', code: row.jobCode, state: row.opening ? label(row.opening.status) : '', seats: row.opening?.seats ?? null, counts: Object.fromEntries(keys.map((key) => [key, 0])) };
            group.counts[row.status] = (group.counts[row.status] || 0) + 1;
            groups.set(id, group);
          }
          return {
            columns: [{ key: 'job', label: 'Job', type: 'text' }, { key: 'code', label: 'Code', type: 'text' }, { key: 'state', label: 'Job status', type: 'status' }, { key: 'seats', label: 'Openings', type: 'number' }, { key: 'total', label: 'Received', type: 'number', total: true }, ...keys.map((key) => ({ key, label: label(key), type: 'number' as const, total: true })), { key: 'conversion', label: 'Hired of received', type: 'percent' }],
            rows: [...groups.values()].map((group) => {
              const total = Object.values(group.counts).reduce((sum, value) => sum + value, 0);
              return { job: group.job, code: group.code, state: group.state, seats: group.seats, total, ...group.counts, conversion: pct(group.counts.hired || 0, total) };
            }).sort((a, b) => b.total - a.total),
            summary: [{ label: 'Applications', value: String(rows.length) }, { label: 'Jobs', value: String(groups.size) }],
          };
        },
      },
      {
        key: 'hiring-sources', group: 'Hiring', title: 'Where applicants come from', icon: 'bi-signpost-split', feature: 'hiring', period: 'range',
        blurb: 'Applications by source, such as the website, Naukri or LinkedIn, and how many reached shortlist and hire.',
        run: async (session, filters) => {
          const rows = await this.prisma.jobApplication.findMany({
            where: { companyId: session.companyId, createdAt: { gte: kolkataDayRange(filters.from).start, lte: kolkataDayRange(filters.to).end } },
            select: { source: true, status: true },
          });
          const groups = new Map<string, { total: number; forward: number; hired: number; rejected: number }>();
          for (const row of rows) {
            const name = row.source === 'form' ? 'Website form' : row.source === 'website' ? 'Company website' : label(row.source);
            const group = groups.get(name) || { total: 0, forward: 0, hired: 0, rejected: 0 };
            group.total += 1; group.forward += ['shortlisted', 'interview', 'hired'].includes(row.status) ? 1 : 0; group.hired += row.status === 'hired' ? 1 : 0; group.rejected += row.status === 'rejected' ? 1 : 0;
            groups.set(name, group);
          }
          return {
            columns: [{ key: 'source', label: 'Source', type: 'text' }, { key: 'total', label: 'Received', type: 'number', total: true }, { key: 'forward', label: 'Shortlisted or later', type: 'number', total: true }, { key: 'hired', label: 'Hired', type: 'number', total: true }, { key: 'rejected', label: 'Rejected', type: 'number', total: true }, { key: 'share', label: 'Share', type: 'percent' }, { key: 'rate', label: 'Shortlist rate', type: 'percent' }],
            rows: [...groups].sort((a, b) => b[1].total - a[1].total).map(([source, group]) => ({ source, ...group, share: pct(group.total, rows.length), rate: pct(group.forward, group.total) })),
          };
        },
      },

      // Assets
      {
        key: 'asset-register', group: 'Assets', title: 'Asset register', icon: 'bi-laptop', feature: 'assets', period: 'none',
        statuses: [{ key: 'all', label: 'Every status' }, ...['stock', 'issued', 'repair', 'retired', 'lost'].map((key) => ({ key, label: label(key) }))],
        blurb: 'Every company asset with model, serial number, cost, warranty and who holds it now.',
        run: async (session, filters) => {
          const rows = await this.prisma.asset.findMany({
            where: { companyId: session.companyId, ...(filters.status && filters.status !== 'all' ? { status: filters.status } : {}) },
            include: { employee: { select: { code: true, firstName: true, lastName: true } } },
            orderBy: { tag: 'asc' },
          });
          const today = todayInIndia();
          return {
            columns: [{ key: 'tag', label: 'Tag', type: 'text' }, { key: 'name', label: 'Asset', type: 'text' }, { key: 'kind', label: 'Kind', type: 'text' }, { key: 'brand', label: 'Brand', type: 'text' }, { key: 'model', label: 'Model', type: 'text' }, { key: 'serial', label: 'Serial number', type: 'text' }, { key: 'status', label: 'Status', type: 'status' }, { key: 'condition', label: 'Condition', type: 'text' }, { key: 'holder', label: 'Held by', type: 'text' }, { key: 'issued', label: 'Issued on', type: 'date' }, { key: 'purchased', label: 'Bought on', type: 'date' }, { key: 'cost', label: 'Cost', type: 'money', total: true }, { key: 'warranty', label: 'Warranty until', type: 'date' }, { key: 'vendor', label: 'Vendor', type: 'text' }],
            rows: rows.map((row) => ({
              tag: row.tag, name: row.name, kind: label(row.kind), brand: row.brand, model: row.model, serial: row.serialNo, status: label(row.status), condition: label(row.condition),
              holder: row.employee ? `${row.employee.firstName} ${row.employee.lastName} (${row.employee.code})` : '', issued: row.status === 'issued' ? row.issuedOn : '', purchased: row.purchasedOn,
              cost: row.costPaise || null, warranty: row.warrantyUntil, vendor: row.vendor,
            })),
            summary: [
              { label: 'Assets', value: String(rows.length) },
              { label: 'Issued', value: String(rows.filter((row) => row.status === 'issued').length) },
              { label: 'In stock', value: String(rows.filter((row) => row.status === 'stock').length) },
              { label: 'Warranty ends in 90 days', value: String(rows.filter((row) => row.warrantyUntil && row.warrantyUntil >= today && row.warrantyUntil <= shiftDay(today, 90)).length) },
            ],
          };
        },
      },

      // Company
      {
        key: 'recognition', group: 'Company', title: 'Recognition given', icon: 'bi-award', feature: 'people', period: 'range',
        blurb: 'Badges people gave each other in the period, and who received the most.',
        run: async (session, filters) => {
          const rows = await this.prisma.recognition.findMany({ where: { companyId: session.companyId, createdAt: { gte: kolkataDayRange(filters.from).start, lte: kolkataDayRange(filters.to).end } }, orderBy: { createdAt: 'asc' } });
          const people = await this.prisma.employee.findMany({ where: { companyId: session.companyId, id: { in: [...new Set(rows.flatMap((row) => [row.fromId, row.toId]))] } }, select: { id: true, firstName: true, lastName: true } });
          const name = new Map(people.map((row) => [row.id, `${row.firstName} ${row.lastName}`.trim()]));
          const counts = new Map<string, number>();
          for (const row of rows) counts.set(row.toId, (counts.get(row.toId) || 0) + 1);
          const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, count]) => (name.get(id) || 'Someone') + ' (' + count + ')').join(', ');
          return {
            columns: [{ key: 'day', label: 'Day', type: 'date' }, { key: 'to', label: 'Received by', type: 'text' }, { key: 'from', label: 'Given by', type: 'text' }, { key: 'badge', label: 'Badge', type: 'text' }, { key: 'note', label: 'Note', type: 'text' }],
            rows: rows.map((row) => ({ day: dayInIndia(row.createdAt), to: name.get(row.toId) || '', from: name.get(row.fromId) || '', badge: label(row.badge), note: row.note })),
            summary: [{ label: 'Badges given', value: String(rows.length) }, { label: 'Most recognised', value: top || '—' }],
          };
        },
      },
      {
        key: 'activity', group: 'Company', title: 'Activity log', icon: 'bi-shield-check', feature: 'owner', period: 'range',
        blurb: 'Who changed what in the HRMS during the period. Only the owner can run this.',
        run: async (session, filters) => {
          const rows = await this.prisma.auditEvent.findMany({ where: { companyId: session.companyId, createdAt: { gte: kolkataDayRange(filters.from).start, lte: kolkataDayRange(filters.to).end } }, orderBy: { createdAt: 'desc' }, take: 5000 });
          const users = await this.prisma.user.findMany({ where: { companyId: session.companyId, id: { in: [...new Set(rows.map((row) => row.actorId))] } }, select: { id: true, name: true } });
          const name = new Map(users.map((row) => [row.id, row.name]));
          const when = (date: Date) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(date);
          return {
            columns: [{ key: 'when', label: 'When', type: 'text' }, { key: 'who', label: 'Who', type: 'text' }, { key: 'action', label: 'Action', type: 'text' }, { key: 'entity', label: 'Record', type: 'text' }, { key: 'detail', label: 'Detail', type: 'text' }],
            rows: rows.map((row) => ({ when: when(row.createdAt), who: row.actorId === 'public' ? 'Public form or portal' : name.get(row.actorId) || 'System', action: row.action, entity: row.entity, detail: row.detail })),
            summary: [{ label: 'Events', value: String(rows.length) }],
          };
        },
      },
    ];
  }

  private rupees(paise: number): string {
    return '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private async slips(session: SessionUser, filters: Filters, scope: Set<string> | null) {
    const people = await this.people(session, filters, scope, 'all');
    const byId = new Map(people.map((row) => [row.id, row]));
    const rows = await this.prisma.paySlip.findMany({ where: { companyId: session.companyId, month: filters.month, employeeId: { in: [...byId.keys()] } } });
    return rows.map((slip) => {
      const list = lines(slip.linesJson);
      const gross = list.filter((line) => line.side === 'earning').reduce((sum, line) => sum + line.paise, 0);
      const deductions = list.filter((line) => line.side === 'deduction').reduce((sum, line) => sum + line.paise, 0);
      const employer = list.filter((line) => line.side === 'employer').reduce((sum, line) => sum + line.paise, 0);
      return { slip, person: byId.get(slip.employeeId)!, lines: list, gross, deductions, net: gross - deductions, employer };
    }).sort((a, b) => a.person.code.localeCompare(b.person.code));
  }

  private async salaryRegister(session: SessionUser, filters: Filters, scope: Set<string> | null): Promise<Result> {
    const slips = await this.slips(session, filters, scope);
    const names = (side: PayLine['side']) => {
      const seen = new Map<string, string>();
      for (const slip of slips) for (const line of slip.lines) if (line.side === side && !seen.has(line.name.toLowerCase())) seen.set(line.name.toLowerCase(), line.name);
      return [...seen];
    };
    const earnings = names('earning');
    const deductions = names('deduction');
    const employer = names('employer');
    const col = (side: string, key: string, name: string): Column => ({ key: side + ':' + key, label: name, type: 'money', total: true });
    const rows = slips.map((slip) => {
      const cell: Record<string, Cell> = {
        ...this.base(slip.person), paidDays: slip.slip.paidDays || '', lopDays: slip.slip.lopDays || '', state: slip.slip.published ? 'Published' : 'Draft',
        gross: slip.gross, deductions: slip.deductions, net: slip.net, employer: slip.employer, cost: slip.gross + slip.employer,
      };
      for (const line of slip.lines) {
        const key = line.side + ':' + line.name.toLowerCase();
        cell[key] = ((cell[key] as number) || 0) + line.paise;
      }
      return cell;
    });
    const working = (await this.people(session, filters, scope, 'current')).length;
    return {
      columns: [
        ...this.baseColumns(), { key: 'paidDays', label: 'Paid days', type: 'text' }, { key: 'lopDays', label: 'LOP days', type: 'text' },
        ...earnings.map(([key, name]) => col('earning', key, name)), { key: 'gross', label: 'Gross', type: 'money', total: true },
        ...deductions.map(([key, name]) => col('deduction', key, name)), { key: 'deductions', label: 'Total deductions', type: 'money', total: true },
        { key: 'net', label: 'Net pay', type: 'money', total: true },
        ...employer.map(([key, name]) => col('employer', key, name)), { key: 'employer', label: 'Employer cost', type: 'money', total: true },
        { key: 'cost', label: 'Total cost', type: 'money', total: true }, { key: 'state', label: 'Slip', type: 'status' },
      ],
      rows,
      summary: [
        { label: 'Slips', value: String(slips.length) + ' of ' + working + ' working now' },
        { label: 'Published', value: String(slips.filter((slip) => slip.slip.published).length) },
        { label: 'Gross', value: this.rupees(slips.reduce((sum, slip) => sum + slip.gross, 0)) },
        { label: 'Net pay', value: this.rupees(slips.reduce((sum, slip) => sum + slip.net, 0)) },
      ],
      note: slips.length ? 'Gross is the sum of earning lines and net pay is gross less deduction lines, exactly as payroll entered them.' : 'No slips are entered for this month yet.',
    };
  }

  private async attendanceMonth(session: SessionUser, filters: Filters, scope: Set<string> | null): Promise<Result> {
    const today = todayInIndia();
    const start = filters.month + '-01';
    const last = monthEnd(filters.month);
    if (start > today) return { columns: [], rows: [], note: 'That month has not started yet.' };
    const end = last < today ? last : today;
    const rules = await this.settings.timeRules(session.companyId);
    const people = (await this.people(session, filters, scope, 'all')).filter((row) => row.dateOfJoining && row.dateOfJoining <= end && (!row.dateOfExit || row.dateOfExit >= start));
    const { counts: byPerson } = await monthCounts(this.prisma, rules, session.companyId, filters.month, people);
    const rows = people.map((person) => {
      const { working, present, late, early, missed, onduty, leave, absent } = byPerson.get(person.id)!;
      const counts = { working, present, late, early, missed, onduty, leave, absent };
      return { ...this.base(person), ...counts, rate: pct(counts.present + counts.onduty, counts.working - counts.leave) };
    });
    return {
      columns: [
        ...this.baseColumns(false), { key: 'working', label: 'Working days', type: 'number' }, { key: 'present', label: 'Present', type: 'number', total: true },
        { key: 'late', label: 'Late', type: 'number', total: true }, { key: 'early', label: 'Early out', type: 'number', total: true }, { key: 'missed', label: 'No check-out', type: 'number', total: true },
        { key: 'onduty', label: 'On duty or WFH', type: 'number', total: true }, { key: 'leave', label: 'Leave', type: 'number', total: true }, { key: 'absent', label: 'Absent', type: 'number', total: true },
        { key: 'rate', label: 'Attendance', type: 'percent' },
      ],
      rows,
      summary: [
        { label: 'People', value: String(rows.length) },
        { label: 'Shift', value: rules.shiftStart + '–' + rules.shiftEnd + ', ' + rules.graceMinutes + ' min grace' },
        { label: 'Late arrivals', value: String(rows.reduce((sum, row) => sum + row.late, 0)) },
        { label: 'Absent days', value: String(rows.reduce((sum, row) => sum + row.absent, 0)) },
      ],
      note: end < last ? 'Counted up to today, ' + today + '. Attendance is present and on duty days out of working days not on leave.' : 'Attendance is present and on duty days out of working days not on leave.',
    };
  }

  private async lateRegister(session: SessionUser, filters: Filters, scope: Set<string> | null): Promise<Result> {
    const rules = await this.settings.timeRules(session.companyId);
    const people = await this.people(session, filters, scope, 'all');
    const byId = new Map(people.map((row) => [row.id, row]));
    const punches = await this.prisma.punch.findMany({
      where: { companyId: session.companyId, employeeId: { in: [...byId.keys()] }, punchedAt: { gte: kolkataDayRange(filters.from).start, lte: kolkataDayRange(filters.to).end } },
      orderBy: { punchedAt: 'asc' },
      select: { employeeId: true, kind: true, punchedAt: true, source: true },
    });
    const days = new Map<string, Array<{ kind: string; at: number; source: string }>>();
    for (const punch of punches) {
      const key = punch.employeeId + '|' + dayInIndia(punch.punchedAt);
      days.set(key, [...(days.get(key) || []), { kind: punch.kind, at: minutesInIndia(punch.punchedAt), source: punch.source }]);
    }
    const shiftStart = clock(rules.shiftStart);
    const shiftEnd = clock(rules.shiftEnd);
    const rows: Array<Record<string, Cell>> = [];
    for (const [key, list] of days) {
      const [id, day] = key.split('|');
      const person = byId.get(id);
      if (!person) continue;
      const arrived = list.find((row) => row.kind === 'in');
      const left = [...list].reverse().find((row) => row.kind === 'out');
      const late = arrived && arrived.at > shiftStart + rules.graceMinutes ? arrived.at - shiftStart : 0;
      const early = left && left.at < shiftEnd ? shiftEnd - left.at : 0;
      if (!late && !early) continue;
      rows.push({ ...this.base(person), day, in: arrived ? hhmm(arrived.at) : '', out: left ? hhmm(left.at) : '', late: late || null, early: early || null, source: label(arrived?.source || left?.source || '') });
    }
    rows.sort((a, b) => String(a.day).localeCompare(String(b.day)) || String(a.name).localeCompare(String(b.name)));
    return {
      columns: [...this.baseColumns(false), { key: 'day', label: 'Day', type: 'date' }, { key: 'in', label: 'In', type: 'text' }, { key: 'out', label: 'Out', type: 'text' }, { key: 'late', label: 'Minutes late', type: 'number', total: true }, { key: 'early', label: 'Minutes early', type: 'number', total: true }, { key: 'source', label: 'Punched by', type: 'text' }],
      rows,
      summary: [
        { label: 'Shift', value: rules.shiftStart + '–' + rules.shiftEnd + ', ' + rules.graceMinutes + ' min grace' },
        { label: 'Late arrivals', value: String(rows.filter((row) => row.late).length) },
        { label: 'Early exits', value: String(rows.filter((row) => row.early).length) },
      ],
    };
  }
}
