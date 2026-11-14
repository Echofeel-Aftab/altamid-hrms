import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessService } from './access.service';
import { dataKey, maskSecret, openSecret, seal } from './crypto';
import { regimeLabel, REVIEW_COLUMNS, REVIEW_FIELDS, SELF_FIELDS } from './details';
import { bag, fail, oneOf, optional } from './http';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

type Payload = Record<string, string>;
type EmployeeRow = Prisma.EmployeeGetPayload<object>;

@Injectable()
export class SelfService {
  private readonly key = dataKey();

  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
  ) {}

  /** Saves a person's own details. Payroll fields become one pending request for HR. */
  async updateMine(session: SessionUser, body: unknown): Promise<{ saved: string[]; sent: string[] }> {
    const current = await this.mine(session);
    const input = bag(body);
    const data: Record<string, string> = {};
    for (const [key, field] of Object.entries(SELF_FIELDS)) {
      if (input[key] === undefined) continue;
      const value = field.read(input[key]);
      if (value !== String((current as Record<string, unknown>)[key] ?? '')) data[key] = value;
    }
    const changes: Payload = {};
    for (const [key, field] of Object.entries(REVIEW_FIELDS)) {
      if (input[key] === undefined) continue;
      const raw = String(input[key] ?? '');
      if (raw.includes('•')) continue;
      const value = field.read(raw);
      if (value !== this.reviewValue(current, key)) changes[key] = value;
    }
    if (Object.keys(data).length) {
      await this.prisma.employee.update({ where: { id: current.id }, data });
      await this.audit(session, 'employee.self', current.id, Object.keys(data).join(','));
    }
    const sent = Object.keys(changes);
    if (sent.length) await this.queueChange(session, current, changes);
    return { saved: Object.keys(data).map((key) => SELF_FIELDS[key].label), sent: sent.map((key) => REVIEW_FIELDS[key].label) };
  }

  /** The person's latest payroll change request, if any. */
  async myChange(session: SessionUser) {
    if (!session.employeeId) return null;
    const row = await this.prisma.detailChange.findFirst({
      where: { companyId: session.companyId, employeeId: session.employeeId },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    if (row.status !== 'pending' && row.decidedAt && Date.now() - row.decidedAt.getTime() > 30 * 86400000) return null;
    const payload = this.open(row.payloadEnc);
    return {
      id: row.id,
      status: row.status,
      note: row.note,
      sentAt: row.updatedAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() || '',
      fields: Object.keys(payload).map((key) => ({ key, label: REVIEW_FIELDS[key]?.label || key, value: this.shown(key, payload[key], false) })),
    };
  }

  async cancelMine(session: SessionUser, id: string) {
    const row = await this.prisma.detailChange.findFirst({ where: { id, companyId: session.companyId, employeeId: session.employeeId || '-', status: 'pending' } });
    if (!row) fail(404, 'That request is not waiting any more.');
    await this.prisma.detailChange.update({ where: { id }, data: { status: 'cancelled', decidedAt: new Date(), decidedBy: session.id } });
    return { ok: true };
  }

  /** Pending requests for HR or payroll to check against the proof. */
  async queue(session: SessionUser) {
    await this.approver(session);
    const rows = await this.prisma.detailChange.findMany({
      where: { companyId: session.companyId, status: 'pending' },
      include: { employee: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return rows.map((row) => {
      const payload = this.open(row.payloadEnc);
      return {
        id: row.id,
        person: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
        code: row.employee.code,
        employeeId: row.employeeId,
        sentAt: row.updatedAt.toISOString(),
        own: row.employeeId === session.employeeId,
        fields: Object.keys(payload).map((key) => ({
          key,
          label: REVIEW_FIELDS[key]?.label || key,
          before: this.shown(key, this.reviewValue(row.employee, key), true),
          after: this.shown(key, payload[key], true),
        })),
      };
    });
  }

  async decide(session: SessionUser, id: string, body: unknown) {
    await this.approver(session);
    const input = bag(body);
    const decision = oneOf(input.decision, ['approved', 'rejected'], 'Decision');
    const note = optional(input.note, 240);
    const row = await this.prisma.detailChange.findFirst({ where: { id, companyId: session.companyId, status: 'pending' }, include: { employee: { include: { user: true } } } });
    if (!row) fail(404, 'That request is not waiting any more.');
    if (row.employeeId === session.employeeId) fail(403, 'Someone else must approve a change to your own pay details.');
    if (decision === 'rejected' && !note) fail(400, 'Add a short reason so they know what to fix.');
    if (decision === 'approved') {
      const payload = this.open(row.payloadEnc);
      const data: Record<string, string> = {};
      for (const [key, value] of Object.entries(payload)) {
        const target = REVIEW_COLUMNS[key];
        if (!target) continue;
        data[target.column] = target.sealed ? seal(value, this.key) : value;
      }
      await this.prisma.employee.update({ where: { id: row.employeeId }, data });
    }
    await this.prisma.detailChange.update({ where: { id }, data: { status: decision, note, decidedBy: session.id, decidedAt: new Date() } });
    await this.audit(session, 'employee.details.' + decision, row.employeeId, row.fields);
    const user = row.employee.user;
    if (user) {
      await this.prisma.notification.createMany({
        data: [{
          companyId: session.companyId,
          userId: user.id,
          kind: 'details',
          title: decision === 'approved' ? 'Your pay details were updated' : 'Your pay details change was not accepted',
          body: decision === 'approved' ? `${session.name} approved the change.` : note,
          link: '/profile?tab=details',
          ref: `${row.id}:${decision}`,
        }],
        skipDuplicates: true,
      });
    }
    return { ok: true };
  }

  async savePhoto(session: SessionUser, id: string, body: unknown) {
    const person = await this.photoTarget(session, id);
    const data = String(bag(body).data || '').trim();
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(data);
    if (!match) fail(400, 'Choose a photo.');
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length < 200 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) fail(400, 'That photo could not be read. Try a JPG or PNG.');
    if (bytes.length > 180_000) fail(400, 'That photo is too large. Try a smaller one.');
    const dir = join(process.cwd(), 'storage', 'photos', session.companyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, person.id + '.jpg'), bytes);
    const at = new Date();
    await this.prisma.employee.update({ where: { id: person.id }, data: { photoAt: at } });
    await this.audit(session, 'employee.photo', person.id);
    return { photo: at.toISOString() };
  }

  async removePhoto(session: SessionUser, id: string) {
    const person = await this.photoTarget(session, id);
    const path = join(process.cwd(), 'storage', 'photos', session.companyId, person.id + '.jpg');
    if (existsSync(path)) unlinkSync(path);
    await this.prisma.employee.update({ where: { id: person.id }, data: { photoAt: null } });
    await this.audit(session, 'employee.photo.remove', person.id);
    return { photo: '' };
  }

  /** Who has a photo, so lists can show it. A name is included only when no one else shares it. */
  async photoBook(session: SessionUser) {
    const rows = await this.prisma.employee.findMany({
      where: { companyId: session.companyId },
      select: { id: true, code: true, firstName: true, lastName: true, photoAt: true },
    });
    const names = new Map<string, number>();
    for (const row of rows) {
      const name = `${row.firstName} ${row.lastName}`.trim().toLowerCase();
      names.set(name, (names.get(name) || 0) + 1);
    }
    return rows.filter((row) => row.photoAt).map((row) => {
      const name = `${row.firstName} ${row.lastName}`.trim();
      return { id: row.id, code: row.code, name: names.get(name.toLowerCase()) === 1 ? name : '', photo: row.photoAt!.toISOString() };
    });
  }

  async photo(session: SessionUser, id: string): Promise<Buffer | null> {
    const person = await this.prisma.employee.findFirst({ where: { id, companyId: session.companyId }, select: { id: true, photoAt: true } });
    if (!person?.photoAt) return null;
    try {
      return readFileSync(join(process.cwd(), 'storage', 'photos', session.companyId, person.id + '.jpg'));
    } catch {
      return null;
    }
  }

  private async photoTarget(session: SessionUser, id: string) {
    const person = await this.prisma.employee.findFirst({ where: { id, companyId: session.companyId }, select: { id: true } });
    if (!person) fail(404, 'That person was not found.');
    if (session.employeeId !== person.id && !(await this.gates.holds(session, 'people.edit'))) fail(403, 'You can change only your own photo.');
    return person;
  }

  private async queueChange(session: SessionUser, current: EmployeeRow, changes: Payload) {
    const pending = await this.prisma.detailChange.findFirst({ where: { companyId: session.companyId, employeeId: current.id, status: 'pending' } });
    const merged = { ...(pending ? this.open(pending.payloadEnc) : {}), ...changes };
    for (const key of Object.keys(merged)) {
      if (merged[key] === this.reviewValue(current, key)) delete merged[key];
    }
    const fields = Object.keys(merged).join(',');
    const payloadEnc = seal(JSON.stringify(merged), this.key);
    const row = pending
      ? await this.prisma.detailChange.update({ where: { id: pending.id }, data: { fields, payloadEnc } })
      : await this.prisma.detailChange.create({ data: { companyId: session.companyId, employeeId: current.id, fields, payloadEnc } });
    await this.audit(session, 'employee.details.request', current.id, fields);
    const reviewers = await this.prisma.user.findMany({
      where: { companyId: session.companyId, active: true, role: { in: ['owner', 'hr', 'payroll'] }, id: { not: session.id } },
      select: { id: true },
    });
    if (reviewers.length) {
      await this.prisma.notification.createMany({
        data: reviewers.map((user) => ({
          companyId: session.companyId,
          userId: user.id,
          kind: 'details',
          title: `${current.firstName} ${current.lastName}`.trim() + ' asked to change pay details',
          body: Object.keys(merged).map((key) => REVIEW_FIELDS[key]?.label || key).join(', '),
          link: '/approvals',
          ref: `${row.id}:${row.updatedAt.getTime()}`,
        })),
        skipDuplicates: true,
      });
    }
  }

  private reviewValue(row: EmployeeRow, key: string): string {
    const target = REVIEW_COLUMNS[key];
    if (!target) return '';
    const stored = String((row as Record<string, unknown>)[target.column] ?? '');
    return target.sealed ? openSecret(stored, this.key) : stored;
  }

  private shown(key: string, value: string, approver: boolean): string {
    if (!value) return '—';
    if (key === 'taxRegime') return regimeLabel(value);
    if (key === 'aadhaar') return approver ? value.replace(/(\d{4})(?=\d)/g, '$1 ') : maskSecret(value);
    if (key === 'bankAccount' && !approver) return maskSecret(value);
    return value;
  }

  private open(payloadEnc: string): Payload {
    try {
      const parsed = JSON.parse(openSecret(payloadEnc, this.key)) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Payload) : {};
    } catch {
      return {};
    }
  }

  private async approver(session: SessionUser) {
    if (!(await this.gates.holds(session, 'people.edit')) && !(await this.gates.holds(session, 'pay'))) {
      fail(403, 'Only HR or payroll can decide pay detail changes.');
    }
  }

  private async mine(session: SessionUser): Promise<EmployeeRow> {
    if (!session.employeeId) fail(400, 'This sign-in is not linked to a person. Ask HR to connect it.');
    const row = await this.prisma.employee.findFirst({ where: { id: session.employeeId, companyId: session.companyId } });
    if (!row) fail(404, 'Your record was not found.');
    return row;
  }

  private async audit(session: SessionUser, action: string, entityId: string, detail = '') {
    await this.prisma.auditEvent.create({ data: { companyId: session.companyId, actorId: session.id, action, entity: 'employee', entityId, detail } });
  }
}
