import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { PrismaService } from './prisma.service';
import { plainOf } from './rich';
import { SessionUser } from './session';
import { mayWaitOn, parseFlow, waitsOn } from './approval-flow';

const TIME_NAME: Record<string, string> = {
  regularization: 'Regularization',
  onduty: 'On duty',
  wfh: 'Work from home',
  extratime: 'Extra time',
};

@Injectable()
export class NoticeService {
  constructor(private readonly prisma: PrismaService, private readonly gates: AccessService) {}

  async inbox(session: SessionUser, limit = 8) {
    await this.sync(session);
    const take = Math.min(40, Math.max(1, limit));
    const [unread, rows] = await Promise.all([
      this.prisma.notification.count({ where: { userId: session.id, companyId: session.companyId, readAt: null } }),
      this.prisma.notification.findMany({
        where: { userId: session.id, companyId: session.companyId },
        orderBy: { createdAt: 'desc' },
        take,
      }),
    ]);
    return {
      unread,
      tabs: await this.tabs(session),
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        link: row.link || '/notifications',
        read: !!row.readAt,
        at: this.stamp(row.createdAt),
        filters: this.filtersOf(row.kind),
      })),
    };
  }

  async read(session: SessionUser, id: string) {
    if (id) {
      await this.prisma.notification.updateMany({
        where: { id, userId: session.id, companyId: session.companyId, readAt: null },
        data: { readAt: new Date() },
      });
    } else {
      await this.prisma.notification.updateMany({
        where: { userId: session.id, companyId: session.companyId, readAt: null },
        data: { readAt: new Date() },
      });
    }
    return this.inbox(session, 8);
  }

  private async sync(session: SessionUser) {
    const rows: Array<{ kind: string; title: string; body: string; link: string; ref: string }> = [];
    const span = await this.gates.span(session, 'approvals');
    if (span !== 'none' || session.employeeId) {
      const company = span === 'company';
      const scoped = {
        companyId: session.companyId,
        status: 'pending' as const,
        ...(session.employeeId ? { employeeId: { not: session.employeeId } } : {}),
        ...(company ? {} : mayWaitOn(session)),
      };
      const due = (row: { flowJson: string; employee: { managerId: string | null } }) => company || waitsOn(session, row.flowJson, row.employee.managerId);
      const step = (row: { id: string; flowJson: string }) => {
        const at = parseFlow(row.flowJson)?.at || 0;
        return at ? `${row.id}:${at}` : row.id;
      };
      const [leave, time, exits] = await Promise.all([
        this.prisma.leaveRequest.findMany({ where: scoped, include: { employee: true, leaveType: true }, orderBy: { createdAt: 'desc' }, take: 40 }),
        this.prisma.attendanceRequest.findMany({ where: scoped, include: { employee: true }, orderBy: { createdAt: 'desc' }, take: 40 }),
        this.prisma.exitRequest.findMany({ where: scoped, include: { employee: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
      ]);
      for (const row of leave.filter(due).slice(0, 20)) {
        const name = `${row.employee.firstName} ${row.employee.lastName}`.trim();
        const span = row.startsOn === row.endsOn ? this.day(row.startsOn) : `${this.day(row.startsOn)} – ${this.day(row.endsOn)}`;
        rows.push({ kind: 'leave.pending', ref: step(row), title: 'Leave waiting', body: `${name} · ${row.leaveType.name} · ${span}`, link: '/approvals' });
      }
      for (const row of time.filter(due).slice(0, 20)) {
        const name = `${row.employee.firstName} ${row.employee.lastName}`.trim();
        rows.push({ kind: 'time.pending', ref: step(row), title: `${TIME_NAME[row.kind] || 'Request'} waiting`, body: `${name} · ${this.day(row.day)}`, link: '/approvals' });
      }
      for (const row of exits.filter(due)) {
        const name = `${row.employee.firstName} ${row.employee.lastName}`.trim();
        rows.push({ kind: 'exit.pending', ref: step(row), title: 'Resignation waiting', body: `${name} · last day ${this.day(row.lastDay)}`, link: '/approvals' });
      }
    }
    if (session.employeeId) {
      const [leave, time] = await Promise.all([
        this.prisma.leaveRequest.findMany({
          where: { companyId: session.companyId, employeeId: session.employeeId, status: { in: ['approved', 'rejected'] } },
          include: { leaveType: true },
          orderBy: { createdAt: 'desc' },
          take: 12,
        }),
        this.prisma.attendanceRequest.findMany({
          where: { companyId: session.companyId, employeeId: session.employeeId, status: { in: ['approved', 'rejected'] } },
          orderBy: { createdAt: 'desc' },
          take: 12,
        }),
      ]);
      for (const row of leave) {
        rows.push({
          kind: 'leave.decided',
          ref: row.id,
          title: row.status === 'approved' ? 'Leave approved' : 'Leave declined',
          body: `${row.leaveType.name} · ${this.day(row.startsOn)}`,
          link: '/requests',
        });
      }
      for (const row of time) {
        rows.push({
          kind: 'time.decided',
          ref: row.id,
          title: `${TIME_NAME[row.kind] || 'Request'} ${row.status === 'approved' ? 'approved' : 'declined'}`,
          body: this.day(row.day),
          link: '/requests',
        });
      }
      const exits = await this.prisma.exitRequest.findMany({
        where: { companyId: session.companyId, employeeId: session.employeeId, status: { in: ['accepted', 'declined'] } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      for (const row of exits) {
        rows.push({
          kind: 'exit.decided',
          ref: row.id,
          title: row.status === 'accepted' ? 'Resignation accepted' : 'Resignation declined',
          body: `Last working day ${this.day(row.lastDay)}`,
          link: '/profile',
        });
      }
    }
    const me = session.employeeId
      ? await this.prisma.employee.findFirst({ where: { id: session.employeeId, companyId: session.companyId } })
      : null;
    const news = await this.prisma.announcement.findMany({ where: { companyId: session.companyId }, orderBy: { createdAt: 'desc' }, take: 12 });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const editor = await this.gates.holds(session, 'news');
    for (const row of news) {
      if (row.expiresOn && row.expiresOn < today) continue;
      if (!editor && row.audience === 'department' && me?.departmentId !== row.departmentId) continue;
      if (!editor && row.audience === 'location' && me?.locationId !== row.locationId) continue;
      if (!editor && row.audience !== 'all' && row.audience !== 'department' && row.audience !== 'location') continue;
      rows.push({ kind: 'news', ref: row.id, title: row.title, body: plainOf(row.body).slice(0, 140), link: '/news' });
    }
    if (await this.gates.holds(session, 'hiring')) {
      const applications = await this.prisma.jobApplication.findMany({
        where: { companyId: session.companyId, status: { in: ['new', 'reviewing'] } },
        orderBy: { createdAt: 'desc' },
        take: 12,
      });
      for (const row of applications) {
        rows.push({ kind: 'application', ref: row.id, title: 'New application', body: `${row.name}${row.jobTitle ? ' · ' + row.jobTitle : ''}`, link: '/hiring/applications' });
      }
    }
    if (!rows.length) return;
    const now = Date.now();
    await this.prisma.notification.createMany({
      data: rows.map((row, index) => ({
        companyId: session.companyId,
        userId: session.id,
        ...row,
        createdAt: new Date(now - index * 1000),
      })),
      skipDuplicates: true,
    });
  }

  private async tabs(session: SessionUser): Promise<Array<{ key: string; label: string }>> {
    const tabs = [
      { key: 'leave', label: 'Leave' },
      { key: 'attendance', label: 'Attendance' },
      { key: 'news', label: 'News' },
      { key: 'badge', label: 'Badges' },
    ];
    if (await this.gates.holds(session, 'approvals')) tabs.unshift({ key: 'waiting', label: 'Waiting' });
    if (await this.gates.holds(session, 'hiring')) tabs.push({ key: 'hiring', label: 'Hiring' });
    return tabs;
  }

  private filtersOf(kind: string): string[] {
    if (kind === 'leave.pending') return ['leave', 'waiting'];
    if (kind === 'leave.decided') return ['leave'];
    if (kind === 'time.pending') return ['attendance', 'waiting'];
    if (kind === 'time.decided') return ['attendance'];
    if (kind === 'news') return ['news'];
    if (kind === 'wish' || kind === 'recognition') return ['badge'];
    if (kind === 'application') return ['hiring'];
    if (kind === 'exit.pending') return ['waiting'];
    if (kind === 'exit.decided') return [];
    return [];
  }

  private day(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    return new Date(value + 'T12:00:00+05:30').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  }

  private stamp(date: Date): string {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
  }
}
