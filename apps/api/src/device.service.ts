import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { bag, fail, optional, text } from './http';
import { AccessService } from './access.service';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

const KINDS = ['fingerprint', 'face', 'card'] as const;

@Injectable()
export class DeviceService {
  constructor(private readonly prisma: PrismaService, private readonly gates: AccessService) {}

  private badgeReady: Promise<void> | null = null;

  private ensureBadgeColumn(): Promise<void> {
    if (!this.badgeReady) {
      this.badgeReady = (async () => {
        await this.prisma.$executeRawUnsafe(`ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS "deviceCode" TEXT`);
        await this.prisma.$executeRawUnsafe(
          `CREATE UNIQUE INDEX IF NOT EXISTS "Employee_companyId_deviceCode_key" ON "Employee"("companyId", "deviceCode")`,
        ).catch(() => undefined);
      })();
    }
    return this.badgeReady;
  }

  async list(session: SessionUser) {
    await this.requireHr(session);
    await this.ensureBadgeColumn();
    const rows = await this.prisma.attendanceDevice.findMany({ where: { companyId: session.companyId }, orderBy: { name: 'asc' } });
    return rows.map((row) => this.present(row));
  }

  async add(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const input = bag(body);
    const name = text(input.name, 'Reader name', 80);
    const kind = String(input.kind || '');
    if (!(KINDS as readonly string[]).includes(kind)) fail(400, 'Choose a fingerprint, face, or card reader.');
    const location = optional(input.location, 80);
    const token = randomBytes(24).toString('base64url');
    const row = await this.prisma.attendanceDevice.create({
      data: { companyId: session.companyId, name, kind, location, token, active: true },
    });
    return this.present(row);
  }

  async remove(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const id = text(bag(body).id, 'Reader', 40);
    const current = await this.prisma.attendanceDevice.findFirst({ where: { id, companyId: session.companyId } });
    if (!current) fail(404, 'That reader was not found.');
    await this.prisma.attendanceDevice.delete({ where: { id } });
    return { ok: true };
  }

  async live(session: SessionUser) {
    if (!(await this.gates.holds(session, 'attendance.live'))) fail(403, 'You do not have access to the live punch feed.');
    const start = new Date();
    start.setUTCHours(start.getUTCHours() - 18);
    const [rows, devices] = await Promise.all([
      this.prisma.punch.findMany({
        where: { companyId: session.companyId, punchedAt: { gte: start } },
        include: { employee: true },
        orderBy: { punchedAt: 'desc' },
        take: 40,
      }),
      this.prisma.attendanceDevice.findMany({ where: { companyId: session.companyId } }),
    ]);
    const names = new Map(devices.map((row) => [row.id, row.name]));
    return rows.map((row) => ({
      id: row.id,
      name: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
      code: row.employee.code,
      kind: row.kind,
      at: row.punchedAt.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }),
      reader: row.deviceId ? names.get(row.deviceId) || 'Reader' : row.source === 'web' ? 'Portal' : row.source,
    }));
  }

  async ingest(token: string, body: unknown) {
    await this.ensureBadgeColumn();
    const device = await this.prisma.attendanceDevice.findUnique({ where: { token } });
    if (!device || !device.active) fail(401, 'This reader is not connected.');
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const rows = Array.isArray(input.punches) ? input.punches : [input];
    if (!rows.length || rows.length > 100) fail(400, 'Send one punch, or up to 100.');
    const rejected: Array<{ code: string; reason: string }> = [];
    let accepted = 0;
    for (const row of rows) {
      const result = await this.one(device, row);
      if (result.ok) accepted += 1;
      else rejected.push({ code: result.code, reason: result.reason });
    }
    await this.prisma.attendanceDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    return { reader: device.name, accepted, rejected };
  }

  private async one(device: { id: string; companyId: string; name: string }, row: unknown): Promise<{ ok: true } | { ok: false; code: string; reason: string }> {
    const input = row && typeof row === 'object' ? row as Record<string, unknown> : {};
    const code = String(input.code || input.userId || input.empCode || input.badgeId || input.deviceCode || '').trim();
    if (!code) return { ok: false, code: '', reason: 'Employee code or biometric / badge ID is required.' };
    const person = await this.findPerson(device.companyId, code);
    if (!person) return { ok: false, code, reason: 'No person uses that biometric / badge ID or employee code.' };
    if (person.status === 'exited') return { ok: false, code, reason: 'That person has left.' };
    const kind = this.kindOf(String(input.kind || input.status || ''));
    const resolved = kind || await this.infer(device.companyId, person.id);
    const punchedAt = this.when(String(input.at || input.timestamp || input.punchedAt || ''));
    if (!punchedAt) return { ok: false, code, reason: 'The punch time is not a valid date.' };
    const skew = punchedAt.getTime() - Date.now();
    if (skew > 5 * 60 * 1000) return { ok: false, code, reason: 'The punch time is in the future.' };
    if (Date.now() - punchedAt.getTime() > 90 * 24 * 60 * 60 * 1000) return { ok: false, code, reason: 'The punch is older than 90 days.' };
    const duplicate = await this.prisma.punch.findFirst({
      where: {
        companyId: device.companyId,
        employeeId: person.id,
        kind: resolved,
        deviceId: device.id,
        punchedAt: { gte: new Date(punchedAt.getTime() - 45_000), lte: new Date(punchedAt.getTime() + 45_000) },
      },
    });
    if (!duplicate) {
      await this.prisma.punch.create({
        data: {
          companyId: device.companyId,
          employeeId: person.id,
          kind: resolved,
          source: 'device',
          deviceId: device.id,
          note: device.name,
          punchedAt,
        },
      });
    }
    return { ok: true };
  }

  private kindOf(value: string): 'in' | 'out' | '' {
    const raw = value.trim().toLowerCase();
    if (raw === 'in' || raw === '0' || raw === 'checkin' || raw === 'check-in') return 'in';
    if (raw === 'out' || raw === '1' || raw === 'checkout' || raw === 'check-out') return 'out';
    return '';
  }

  private async infer(companyId: string, employeeId: string): Promise<'in' | 'out'> {
    const last = await this.prisma.punch.findFirst({ where: { companyId, employeeId }, orderBy: { punchedAt: 'desc' } });
    return last?.kind === 'in' ? 'out' : 'in';
  }

  private when(value: string): Date | null {
    if (!value.trim()) return new Date();
    const stamp = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : value + '+05:30';
    const date = new Date(stamp);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private async findPerson(companyId: string, code: string) {
    const badge = await this.prisma.employee.findFirst({
      where: { companyId, deviceCode: { equals: code, mode: 'insensitive' } },
    });
    if (badge) return badge;
    return this.prisma.employee.findFirst({
      where: { companyId, code: { equals: code, mode: 'insensitive' } },
    });
  }

  private present(row: { id: string; name: string; kind: string; location: string; token: string; active: boolean; lastSeenAt: Date | null }) {
    const path = '/v1/devices/' + row.token + '/punches';
    const origin = (process.env.PUBLIC_API_URL || process.env.APP_URL || '').replace(/\/$/, '');
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      location: row.location,
      active: row.active,
      path,
      url: origin ? origin + path : path,
      sample: '{ "code": "EMP005", "kind": "in", "at": "2026-11-27T09:32:00+05:30" }',
      hint: 'Point the vendor software or a bridge PC at this URL. Map the machine user id to Biometric / badge ID on the person (or use the EMP code). Altamid does not store fingerprints or faces.',
      lastSeen: row.lastSeenAt ? row.lastSeenAt.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '',
    };
  }

  private async requireHr(session: SessionUser): Promise<void> {
    await this.gates.gate(session, 'attendance.devices', 'You do not have access to punch readers.');
  }
}
