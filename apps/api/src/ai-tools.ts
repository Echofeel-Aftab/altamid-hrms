import { Injectable } from '@nestjs/common';
import { AccessService, FEATURES } from './access.service';
import { todayInIndia } from './dates';
import { MANUAL } from './manual';
import { PrismaService } from './prisma.service';
import { ReportsService } from './reports.service';
import { SessionUser } from './session';
import { SettingsService } from './settings.service';
import { WorkplaceService } from './workplace.service';

export type ToolRisk = 'safe' | 'safe_write' | 'confirm';

export interface ToolDef {
  name: string;
  description: string;
  risk: ToolRisk;
  need?: string;
  parameters: Record<string, unknown>;
}

export interface ToolResult {
  ok: boolean;
  message: string;
  data?: unknown;
  confirm?: { tool: string; args: Record<string, unknown>; summary: string; hint?: string };
  path?: string;
}

@Injectable()
export class AiToolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
    private readonly settings: SettingsService,
    private readonly workplace: WorkplaceService,
    private readonly reports: ReportsService,
  ) {}

  async schemasFor(session: SessionUser): Promise<Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }>> {
    const defs = await this.definitions(session);
    return defs.map((item) => ({
      type: 'function' as const,
      function: { name: item.name, description: item.description, parameters: item.parameters },
    }));
  }

  async definitions(session: SessionUser): Promise<ToolDef[]> {
    const keys = new Set(await this.gates.keys(session));
    const all = this.catalog();
    return all.filter((item) => !item.need || keys.has(item.need) || session.role === 'owner');
  }

  async run(session: SessionUser, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const defs = await this.definitions(session);
    const def = defs.find((item) => item.name === name);
    if (!def) return { ok: false, message: 'That action is not available for your access.' };
    if (def.risk === 'confirm') {
      return {
        ok: true,
        message: 'Confirm to continue.',
        confirm: {
          tool: name,
          args,
          summary: this.confirmSummary(name, args),
          hint: 'Nothing is saved until you confirm.',
        },
      };
    }
    return this.execute(session, name, args);
  }

  async executeConfirmed(session: SessionUser, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const defs = await this.definitions(session);
    const def = defs.find((item) => item.name === name);
    if (!def || def.risk !== 'confirm') return { ok: false, message: 'That action cannot be confirmed.' };
    return this.execute(session, name, args);
  }

  private catalog(): ToolDef[] {
    return [
      {
        name: 'list_hrms_map',
        risk: 'safe',
        description: 'List HRMS modules and screens this staff can open, with paths.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'get_manual_section',
        risk: 'safe',
        description: 'Read a user-manual section by id (how a feature works step by step).',
        parameters: {
          type: 'object',
          properties: { id: { type: 'string', description: 'Manual section id, e.g. leave, attendance, pay' } },
          required: ['id'],
        },
      },
      {
        name: 'list_manual_topics',
        risk: 'safe',
        description: 'List manual topic ids and titles available to this sign-in.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'get_company_rules',
        risk: 'safe',
        description: 'Summarise company attendance, leave, statutory and check-in rules.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'check_violations',
        risk: 'safe',
        need: 'exceptions',
        description: 'Scan for attendance exceptions (late/absent/missed punch) and overdue pending approvals. Suggest actions.',
        parameters: {
          type: 'object',
          properties: { day: { type: 'string', description: 'YYYY-MM-DD, default today' } },
        },
      },
      {
        name: 'today_work',
        risk: 'safe',
        description: 'Pending approvals, my requests, and today’s focus items for this staff.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'search_people',
        risk: 'safe',
        need: 'people',
        description: 'Search employees by name, code, email or phone (scoped by access).',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' }, limit: { type: 'integer' } },
          required: ['query'],
        },
      },
      {
        name: 'get_employee',
        risk: 'safe',
        need: 'people',
        description: 'Read one employee profile summary by id or employee code.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            code: { type: 'string' },
          },
        },
      },
      {
        name: 'leave_balances',
        risk: 'safe',
        description: 'Leave balances for self or (with people access) another employee code.',
        parameters: {
          type: 'object',
          properties: { employeeCode: { type: 'string' }, year: { type: 'string' } },
        },
      },
      {
        name: 'report_brief',
        risk: 'safe',
        need: 'reports',
        description: 'Short analytical brief: headcount, pending leave, optional report key sample with suggestions.',
        parameters: {
          type: 'object',
          properties: {
            reportKey: { type: 'string', description: 'Optional reports catalog key' },
            month: { type: 'string', description: 'YYYY-MM' },
          },
        },
      },
      {
        name: 'list_reports',
        risk: 'safe',
        need: 'reports',
        description: 'List report catalog entries this staff can run.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'open_screen',
        risk: 'safe',
        description: 'Return the in-app path for a common action (leave, attendance, pay, directory, reports, settings, approvals).',
        parameters: {
          type: 'object',
          properties: {
            screen: {
              type: 'string',
              enum: ['home', 'leave', 'attendance', 'approvals', 'pay', 'directory', 'reports', 'settings', 'hiring', 'requests', 'exceptions', 'news'],
            },
          },
          required: ['screen'],
        },
      },
      {
        name: 'propose_open_leave',
        risk: 'confirm',
        description: 'Propose opening the leave application screen (staff confirms in chat).',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'propose_open_approvals',
        risk: 'confirm',
        need: 'approvals',
        description: 'Propose opening the approvals queue.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
      },
    ];
  }

  private confirmSummary(name: string, _args: Record<string, unknown>): string {
    if (name === 'propose_open_leave') return 'Open Leave to apply or review balances.';
    if (name === 'propose_open_approvals') return 'Open Approvals to decide pending requests.';
    return 'Confirm this action.';
  }

  private async execute(session: SessionUser, name: string, args: Record<string, unknown>): Promise<ToolResult> {
    switch (name) {
      case 'list_hrms_map':
        return this.listMap(session);
      case 'get_manual_section':
        return this.manualSection(session, String(args.id || ''));
      case 'list_manual_topics':
        return this.manualTopics(session);
      case 'get_company_rules':
        return this.companyRules(session);
      case 'check_violations':
        return this.violations(session, String(args.day || ''));
      case 'today_work':
        return this.todayWork(session);
      case 'search_people':
        return this.searchPeople(session, String(args.query || ''), Number(args.limit || 12));
      case 'get_employee':
        return this.getEmployee(session, String(args.id || ''), String(args.code || ''));
      case 'leave_balances':
        return this.leaveBalances(session, String(args.employeeCode || ''), String(args.year || ''));
      case 'report_brief':
        return this.reportBrief(session, String(args.reportKey || ''), String(args.month || ''));
      case 'list_reports':
        return this.listReports(session);
      case 'open_screen':
        return this.openScreen(session, String(args.screen || 'home'));
      case 'propose_open_leave':
        return { ok: true, message: 'Open Leave.', path: '/leave', data: { url: '/leave' } };
      case 'propose_open_approvals':
        return { ok: true, message: 'Open Approvals.', path: '/approvals', data: { url: '/approvals' } };
      default:
        return { ok: false, message: 'Unknown tool.' };
    }
  }

  private async listMap(session: SessionUser): Promise<ToolResult> {
    const keys = new Set(await this.gates.keys(session));
    const items = FEATURES.filter((item) => keys.has(item.key) || session.role === 'owner').map((item) => ({
      key: item.key,
      label: item.label,
      hint: item.hint,
      group: item.group,
    }));
    return { ok: true, message: `${items.length} areas available.`, data: { items } };
  }

  private async manualTopics(session: SessionUser): Promise<ToolResult> {
    const keys = new Set(await this.gates.keys(session));
    const reader = {
      keys,
      role: session.role,
      owner: session.role === 'owner',
      person: !!session.employeeId,
      master: session.master === true,
      payroll: !session.outletCountry || session.outletCountry === 'IN',
      teamScope: false,
    };
    const topics = MANUAL.filter((section) => !section.when || section.when(reader)).map((section) => ({
      id: section.id,
      title: section.title,
      path: section.path || '',
      group: section.group,
    }));
    return { ok: true, message: `${topics.length} topics.`, data: { topics } };
  }

  private async manualSection(session: SessionUser, id: string): Promise<ToolResult> {
    const section = MANUAL.find((item) => item.id === id || item.title.toLowerCase() === id.toLowerCase());
    if (!section) return { ok: false, message: 'Manual section not found. Call list_manual_topics first.' };
    const keys = new Set(await this.gates.keys(session));
    const reader = {
      keys,
      role: session.role,
      owner: session.role === 'owner',
      person: !!session.employeeId,
      master: session.master === true,
      payroll: true,
      teamScope: false,
    };
    if (section.when && !section.when(reader)) return { ok: false, message: 'That manual section is not available for your access.' };
    return {
      ok: true,
      message: section.title,
      data: {
        id: section.id,
        title: section.title,
        path: section.path || '',
        why: section.why,
        tips: section.tips || [],
        howTo: section.howTo
          .filter((item) => !item.when || item.when(reader))
          .map((item) => ({ title: item.title, body: item.body || '', steps: item.steps || [] })),
      },
      path: section.path || undefined,
    };
  }

  private async companyRules(session: SessionUser): Promise<ToolResult> {
    const [time, checkin, hiring, leaveTypes] = await Promise.all([
      this.settings.timeRules(session.companyId),
      this.settings.checkinPolicy(session.companyId),
      this.settings.hiringRules(session.companyId).catch(() => null),
      this.prisma.leaveType.findMany({
        where: { companyId: session.companyId, active: true, ...(session.outletId ? { outletId: session.outletId } : {}) },
        orderBy: { name: 'asc' },
        take: 40,
      }),
    ]);
    const week = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const attendance = checkin as {
      checkinScope?: string;
      geofenceMetres?: number;
      weekOff?: number[];
      shiftStart?: string;
      shiftEnd?: string;
      graceMinutes?: number;
    };
    return {
      ok: true,
      message: 'Company rules loaded.',
      data: {
        attendance: {
          weekOff: time.weekOff.map((d) => week[d] || String(d)),
          shiftStart: time.shiftStart,
          shiftEnd: time.shiftEnd,
          graceMinutes: time.graceMinutes,
          checkinScope: attendance.checkinScope || '',
          geofenceMetres: attendance.geofenceMetres ?? 0,
        },
        hiring: hiring
          ? { coolingDays: (hiring as { coolingDays?: number }).coolingDays, emailAuto: (hiring as { emailAuto?: boolean }).emailAuto }
          : undefined,
        leaveTypes: leaveTypes.map((row) => ({ name: row.name, code: row.code, daysPerYear: row.daysPerYear, paid: row.paid })),
        suggestions: [
          'Late beyond grace minutes usually shows on Exceptions.',
          'Leave must follow approval flow; balances update when approved.',
          'Week-off and holidays should not count as absent.',
        ],
      },
    };
  }

  private async violations(session: SessionUser, dayInput: string): Promise<ToolResult> {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(dayInput) ? dayInput : todayInIndia();
    let exceptions: Awaited<ReturnType<WorkplaceService['exceptions']>> | null = null;
    try {
      exceptions = await this.workplace.exceptions(session, day);
    } catch {
      exceptions = null;
    }
    const pendingLeave = await this.prisma.leaveRequest.count({ where: { companyId: session.companyId, status: 'pending' } });
    const pendingTime = await this.prisma.attendanceRequest.count({ where: { companyId: session.companyId, status: 'pending' } });
    const counts = exceptions?.counts || { late: 0, absent: 0, waiting: 0, early: 0, open: 0 };
    const rows = Array.isArray(exceptions?.rows) ? (exceptions!.rows as Array<Record<string, unknown>>) : [];
    const sample = rows.slice(0, 12).map((row) => ({
      name: row.name || row.employeeName || row.person || '',
      status: row.status || row.label || '',
      note: row.note || row.detail || '',
    }));
    const suggestions: string[] = [];
    if ((counts.late || 0) > 0) suggestions.push('Review late arrivals on /attendance exceptions; ask managers to coach repeat cases.');
    if ((counts.absent || 0) > 0) suggestions.push('Follow up absents — confirm leave vs unplanned absence.');
    if ((counts.waiting || 0) > 0) suggestions.push('Clear waiting / missed punches via regularization requests.');
    if (pendingLeave + pendingTime > 0) suggestions.push(`Decide ${pendingLeave + pendingTime} pending request(s) on /approvals or /requests.`);
    if (!suggestions.length) suggestions.push('No major attendance issues found for this day. Keep monitoring Exceptions.');
    return {
      ok: true,
      message: `Violations scan for ${day}.`,
      data: {
        day,
        closed: exceptions?.closed || '',
        counts,
        pendingApprovals: { leave: pendingLeave, attendance: pendingTime },
        sample,
        suggestions,
        path: '/attendance',
      },
      path: '/attendance',
    };
  }

  private async todayWork(session: SessionUser): Promise<ToolResult> {
    const mine = session.employeeId
      ? await this.workplace.myRequests(session)
      : { items: [] as Array<Record<string, unknown>> };
    let leaveQueue: unknown[] = [];
    let timeQueue: unknown[] = [];
    try {
      leaveQueue = await this.workplace.leave(session).then((v) => v.queue || []);
    } catch {
      leaveQueue = [];
    }
    try {
      timeQueue = await this.workplace.timeQueue(session);
    } catch {
      timeQueue = [];
    }
    return {
      ok: true,
      message: 'Today’s work.',
      data: {
        myOpenRequests: (mine.items || []).filter((item) => item['status'] === 'pending').slice(0, 10),
        approvalsWaiting: { leave: leaveQueue.length, attendance: timeQueue.length },
        leaveQueue: leaveQueue.slice(0, 8),
        timeQueue: timeQueue.slice(0, 8),
        suggestions: [
          leaveQueue.length || timeQueue.length ? 'Clear approvals first so people are not blocked.' : 'No approvals waiting for you.',
          'Check Exceptions if you manage attendance.',
          'Use /requests for your own history.',
        ],
      },
    };
  }

  private async searchPeople(session: SessionUser, query: string, limit: number): Promise<ToolResult> {
    const q = query.trim();
    if (q.length < 2) return { ok: false, message: 'Type at least 2 characters to search.' };
    const scope = await this.peopleWhere(session);
    if (!scope) return { ok: false, message: 'You do not have access to search people.' };
    const take = Math.min(Math.max(limit || 12, 1), 25);
    const rows = await this.prisma.employee.findMany({
      where: {
        ...scope,
        status: { in: ['active', 'onboarding'] },
        OR: [
          { firstName: { contains: q } },
          { lastName: { contains: q } },
          { code: { contains: q } },
          { email: { contains: q } },
          { phone: { contains: q } },
        ],
      },
      take,
      orderBy: { firstName: 'asc' },
      select: { id: true, code: true, firstName: true, lastName: true, email: true, status: true, department: { select: { name: true } } },
    });
    return {
      ok: true,
      message: `${rows.length} people in your access.`,
      data: {
        people: rows.map((row) => ({
          id: row.id,
          code: row.code,
          name: `${row.firstName} ${row.lastName}`.trim(),
          email: row.email,
          status: row.status,
          department: row.department?.name || '',
          path: `/directory/${row.id}`,
        })),
      },
    };
  }

  private async getEmployee(session: SessionUser, id: string, code: string): Promise<ToolResult> {
    const scope = await this.peopleWhere(session);
    if (!scope) return { ok: false, message: 'You do not have access to people records.' };
    const row = await this.prisma.employee.findFirst({
      where: {
        ...scope,
        ...(id ? { id } : code ? { code } : { id: '__none__' }),
      },
      include: { department: true, designation: true, location: true, manager: { select: { firstName: true, lastName: true, code: true } } },
    });
    if (!row) return { ok: false, message: 'Employee not found in your access.' };
    return {
      ok: true,
      message: 'Employee loaded.',
      path: `/directory/${row.id}`,
      data: {
        id: row.id,
        code: row.code,
        name: `${row.firstName} ${row.lastName}`.trim(),
        email: row.email,
        phone: row.phone,
        status: row.status,
        joinedOn: row.dateOfJoining,
        department: row.department?.name || '',
        designation: row.designation?.name || '',
        location: row.location?.name || '',
        manager: row.manager ? `${row.manager.firstName} ${row.manager.lastName} (${row.manager.code})` : '',
      },
    };
  }

  /** People tools stay inside the same company/outlet/team span as Directory. */
  private async peopleWhere(session: SessionUser): Promise<Record<string, unknown> | null> {
    const span = await this.gates.span(session, 'people');
    if (span === 'none' && session.role !== 'owner') return null;
    const where: Record<string, unknown> = { companyId: session.companyId };
    if (session.outletId) where.outletId = session.outletId;
    if (span === 'team' && session.employeeId) {
      where.OR = [{ id: session.employeeId }, { managerId: session.employeeId }];
    }
    return where;
  }

  private async leaveBalances(session: SessionUser, employeeCode: string, yearInput: string): Promise<ToolResult> {
    const year = /^\d{4}$/.test(yearInput) ? yearInput : todayInIndia().slice(0, 4);
    let employeeId = session.employeeId || '';
    if (employeeCode) {
      const scope = await this.peopleWhere(session);
      if (!scope) return { ok: false, message: 'You can only view your own leave balances.' };
      const person = await this.prisma.employee.findFirst({ where: { ...scope, code: employeeCode } });
      if (!person) return { ok: false, message: 'Employee code not found in your access.' };
      employeeId = person.id;
    }
    if (!employeeId) return { ok: false, message: 'Your sign-in is not linked to a person.' };
    const board = await this.workplace.leave(session);
    if (employeeCode && employeeId !== session.employeeId) {
      const types = await this.prisma.leaveType.findMany({
        where: { companyId: session.companyId, active: true, ...(session.outletId ? { outletId: session.outletId } : {}) },
        take: 30,
      });
      return {
        ok: true,
        message: 'Leave types for that person (open their profile or Leave for full balances).',
        data: { year, employeeCode, types: types.map((t) => ({ name: t.name, code: t.code, daysPerYear: t.daysPerYear })), path: `/directory/${employeeId}` },
        path: `/directory/${employeeId}`,
      };
    }
    return { ok: true, message: 'Leave balances.', data: { year, balances: board.balances, path: '/leave' }, path: '/leave' };
  }

  private async listReports(session: SessionUser): Promise<ToolResult> {
    const list = await this.reports.list(session);
    return { ok: true, message: 'Reports catalog.', data: list, path: '/reports' };
  }

  private async reportBrief(session: SessionUser, reportKey: string, month: string): Promise<ToolResult> {
    const headcount = await this.prisma.employee.groupBy({
      by: ['status'],
      where: { companyId: session.companyId },
      _count: { _all: true },
    });
    const pendingLeave = await this.prisma.leaveRequest.count({ where: { companyId: session.companyId, status: 'pending' } });
    let reportSample: unknown = null;
    if (reportKey) {
      try {
        reportSample = await this.reports.run(session, reportKey, { month: month || todayInIndia().slice(0, 7) });
      } catch (error) {
        reportSample = { error: error instanceof Error ? error.message : 'Could not run report.' };
      }
    }
    const active = headcount.find((row) => row.status === 'active')?._count._all || 0;
    const suggestions = [
      pendingLeave ? `Clear ${pendingLeave} pending leave request(s).` : 'Leave queue looks clear.',
      'Export from /reports for finance or auditors when needed.',
      'Compare exceptions with leave to catch unplanned absences.',
    ];
    return {
      ok: true,
      message: 'Report brief ready.',
      data: {
        headcount: headcount.map((row) => ({ status: row.status, count: row._count._all })),
        active,
        pendingLeave,
        reportKey: reportKey || null,
        reportSample: reportSample && typeof reportSample === 'object'
          ? {
              columns: (reportSample as { columns?: unknown }).columns,
              rowCount: Array.isArray((reportSample as { rows?: unknown[] }).rows) ? (reportSample as { rows: unknown[] }).rows.length : undefined,
              summary: (reportSample as { summary?: unknown }).summary,
              note: (reportSample as { note?: unknown }).note,
            }
          : reportSample,
        suggestions,
        path: '/reports',
      },
      path: '/reports',
    };
  }

  private async openScreen(session: SessionUser, screen: string): Promise<ToolResult> {
    const map: Record<string, { path: string; need?: string }> = {
      home: { path: '/' },
      leave: { path: '/leave' },
      attendance: { path: '/attendance' },
      approvals: { path: '/approvals', need: 'approvals' },
      pay: { path: '/pay', need: 'pay' },
      directory: { path: '/directory', need: 'people' },
      reports: { path: '/reports', need: 'reports' },
      settings: { path: '/settings', need: 'settings' },
      hiring: { path: '/hiring', need: 'hiring' },
      requests: { path: '/requests' },
      exceptions: { path: '/attendance', need: 'exceptions' },
      news: { path: '/news' },
    };
    const target = map[screen] || map.home;
    if (target.need && session.role !== 'owner' && !(await this.gates.holds(session, target.need))) {
      return { ok: false, message: `You do not have access to open ${screen}.` };
    }
    return { ok: true, message: `Open ${screen}.`, path: target.path, data: { path: target.path } };
  }
}
