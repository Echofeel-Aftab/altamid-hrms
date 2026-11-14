import { Injectable } from '@nestjs/common';
import { shiftDay, todayInIndia } from './dates';
import { bag, fail, optional, text } from './http';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

const BADGES = [
  { key: 'thanks', label: 'Thank you' },
  { key: 'star', label: 'Star' },
  { key: 'team', label: 'Team player' },
  { key: 'solver', label: 'Problem solver' },
  { key: 'extra', label: 'Extra mile' },
] as const;

const RANGES = ['week', 'month', 'quarter', 'half', 'year', 'all'] as const;

@Injectable()
export class RecognitionService {
  constructor(private readonly prisma: PrismaService) {}

  async view(session: SessionUser, rangeInput?: string) {
    const range = RANGES.includes(rangeInput as (typeof RANGES)[number]) ? rangeInput || 'month' : 'month';
    const since = this.since(range);
    const rows = await this.prisma.recognition.findMany({
      where: { companyId: session.companyId, ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const people = await this.prisma.employee.findMany({
      where: { companyId: session.companyId },
      select: { id: true, firstName: true, lastName: true, code: true },
    });
    const names = new Map(people.map((person) => [person.id, { name: `${person.firstName} ${person.lastName}`.trim(), code: person.code }]));
    const label = new Map(BADGES.map((badge) => [badge.key, badge.label]));
    const received = new Map<string, number>();
    const given = new Map<string, number>();
    for (const row of rows) {
      received.set(row.toId, (received.get(row.toId) || 0) + 1);
      given.set(row.fromId, (given.get(row.fromId) || 0) + 1);
    }
    const board = (counts: Map<string, number>) => [...counts.entries()]
      .map(([id, count]) => ({ id, name: names.get(id)?.name || 'Former colleague', code: names.get(id)?.code || '', count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
      .slice(0, 5);
    const mine = session.employeeId || '';
    return {
      range,
      badges: BADGES.map((badge) => ({ key: badge.key, label: badge.label })),
      me: { received: received.get(mine) || 0, given: given.get(mine) || 0 },
      feed: rows.slice(0, 30).map((row) => ({
        id: row.id,
        key: row.badge,
        badge: label.get(row.badge as (typeof BADGES)[number]['key']) || row.badge,
        note: row.note,
        from: names.get(row.fromId)?.name || 'A colleague',
        to: names.get(row.toId)?.name || 'A colleague',
        fromId: row.fromId,
        toId: row.toId,
        at: this.stamp(row.createdAt),
      })),
      receivers: board(received),
      givers: board(given),
    };
  }

  async find(session: SessionUser, query: string) {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return { people: [] as Array<{ id: string; name: string; code: string }> };
    const rows = await this.prisma.employee.findMany({
      where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] }, id: { not: session.employeeId || '' } },
      orderBy: { firstName: 'asc' },
      take: 200,
    });
    return {
      people: rows
        .filter((row) => `${row.firstName} ${row.lastName} ${row.code}`.toLowerCase().includes(needle))
        .slice(0, 8)
        .map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}`.trim(), code: row.code })),
    };
  }

  async give(session: SessionUser, raw: unknown) {
    if (!session.employeeId) fail(400, 'Ask HR to connect this sign-in to a person before giving a badge.');
    const input = bag(raw);
    const toId = text(input.employeeId, 'Colleague', 40);
    const badge = text(input.badge, 'Badge', 20);
    const note = optional(input.note, 180);
    if (!BADGES.some((item) => item.key === badge)) fail(400, 'Choose one of the badges.');
    if (toId === session.employeeId) fail(400, 'Give the badge to a colleague.');
    const person = await this.prisma.employee.findFirst({
      where: { id: toId, companyId: session.companyId, status: { in: ['active', 'onboarding'] } },
    });
    if (!person) fail(404, 'That person was not found.');
    const today = todayInIndia();
    const start = new Date(today + 'T00:00:00+05:30');
    const already = await this.prisma.recognition.findFirst({
      where: { companyId: session.companyId, fromId: session.employeeId, toId, badge, createdAt: { gte: start } },
    });
    if (already) fail(400, 'You already gave that badge today.');
    const row = await this.prisma.recognition.create({
      data: { companyId: session.companyId, fromId: session.employeeId, toId, badge, note },
    });
    const user = await this.prisma.user.findFirst({ where: { employeeId: person.id, companyId: session.companyId } });
    const title = BADGES.find((item) => item.key === badge)?.label || 'Badge';
    if (user) {
      await this.prisma.notification.create({
        data: {
          companyId: session.companyId,
          userId: user.id,
          kind: 'recognition',
          title: `${session.name || 'A colleague'} gave you a badge`,
          body: note ? `${title}. ${note}` : title,
          link: '/recognition',
          ref: row.id,
        },
      }).catch(() => undefined);
    }
    return this.view(session, 'month');
  }

  async fresh(session: SessionUser) {
    if (!session.employeeId) return { badges: [] };
    const user = await this.prisma.user.findFirst({ where: { id: session.id, companyId: session.companyId }, select: { badgeSeenAt: true } });
    const floor = new Date(Date.now() - 14 * 86400000);
    const since = user?.badgeSeenAt && user.badgeSeenAt > floor ? user.badgeSeenAt : floor;
    const rows = await this.prisma.recognition.findMany({
      where: { companyId: session.companyId, toId: session.employeeId, createdAt: { gt: since } },
      orderBy: { createdAt: 'desc' },
      take: 12,
    });
    if (!rows.length) return { badges: [] };
    const givers = await this.prisma.employee.findMany({
      where: { companyId: session.companyId, id: { in: [...new Set(rows.map((row) => row.fromId))] } },
      select: { id: true, firstName: true, lastName: true },
    });
    const names = new Map(givers.map((person) => [person.id, `${person.firstName} ${person.lastName}`.trim()]));
    return {
      badges: rows.map((row) => ({
        id: row.id,
        key: row.badge,
        label: BADGES.find((item) => item.key === row.badge)?.label || 'Badge',
        from: names.get(row.fromId) || 'A colleague',
        note: row.note,
        at: this.stamp(row.createdAt),
      })),
    };
  }

  async seen(session: SessionUser) {
    await this.prisma.user.updateMany({ where: { id: session.id, companyId: session.companyId }, data: { badgeSeenAt: new Date() } });
    return { ok: true };
  }

  private since(range: string): Date | null {
    const today = todayInIndia();
    if (range === 'all') return null;
    if (range === 'month') return new Date(today.slice(0, 7) + '-01T00:00:00+05:30');
    if (range === 'year') return new Date(today.slice(0, 4) + '-01-01T00:00:00+05:30');
    const back = range === 'week' ? 6 : range === 'quarter' ? 89 : 181;
    return new Date(shiftDay(today, -back) + 'T00:00:00+05:30');
  }

  private stamp(value: Date): string {
    return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);
  }
}
