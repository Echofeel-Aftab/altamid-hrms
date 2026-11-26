import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { bag, fail, optional, text } from './http';
import { AccessService } from './access.service';
import { PrismaService } from './prisma.service';
import { richOf } from './rich';
import { SessionUser } from './session';
import { TtlCache } from './ttl-cache';

/** Features whose audience is set here. Which blocks appear on Home is set in Settings → Home layouts. */
export const HOME_WIDGETS = [
  { key: 'directory', label: 'Find a colleague' },
  { key: 'jobs', label: 'Jobs and referrals' },
  { key: 'library', label: 'Handbook and help' },
] as const;

const AUDIENCES = ['all', 'managers', 'hr', 'off'] as const;
const HELP_AUDIENCES = ['all', 'employee', 'managers', 'staff', 'hr'] as const;

export const DOCUMENT_KINDS = [
  { key: 'offer', label: 'Offer letter', personal: true },
  { key: 'increment', label: 'Increment letter', personal: true },
  { key: 'appointment', label: 'Appointment letter', personal: true },
  { key: 'holiday', label: 'Holiday list', personal: false },
  { key: 'circular', label: 'Circular', personal: false },
  { key: 'handbook', label: 'Handbook', personal: false },
  { key: 'policy', label: 'Policy', personal: false },
  { key: 'form', label: 'Form', personal: false },
  { key: 'other', label: 'Other document', personal: false },
] as const;

const FILE_AUDIENCES = ['all', 'person', 'department', 'location', 'managers', 'hr'] as const;

@Injectable()
export class LibraryService {
  private readonly widgetsCache = new TtlCache<Map<string, string>>(60_000);

  constructor(private readonly prisma: PrismaService, private readonly gates: AccessService) {}

  async widgets(session: SessionUser) {
    const saved = await this.saved(session.companyId);
    const items = [];
    for (const item of HOME_WIDGETS) {
      const audience = saved.get(item.key) || 'all';
      items.push({ key: item.key, label: item.label, audience, visible: await this.allowsAudience(session, audience) });
    }
    return items;
  }

  async saveWidgets(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'library', 'You do not have access to choose who sees the home.');
    const input = bag(body);
    const rows = Array.isArray(input.widgets) ? input.widgets : [];
    for (const item of HOME_WIDGETS) {
      const found = rows.find((row) => row && typeof row === 'object' && (row as { key?: string }).key === item.key) as { audience?: string } | undefined;
      const audience = found?.audience && (AUDIENCES as readonly string[]).includes(found.audience) ? found.audience : 'all';
      await this.prisma.homeWidget.upsert({
        where: { companyId_key: { companyId: session.companyId, key: item.key } },
        create: { companyId: session.companyId, key: item.key, audience },
        update: { audience },
      });
    }
    this.widgetsCache.delete(session.companyId);
    return this.widgets(session);
  }

  async allowsKey(session: SessionUser, key: string): Promise<boolean> {
    const saved = await this.saved(session.companyId);
    return this.allowsAudience(session, saved.get(key) || 'all');
  }

  async view(session: SessionUser) {
    const show = await this.allowsKey(session, 'library');
    const editor = await this.gates.holds(session, 'library');
    const [handbook, help] = await Promise.all([
      this.prisma.libraryDoc.findFirst({ where: { companyId: session.companyId, kind: 'handbook', published: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.libraryDoc.findMany({
        where: { companyId: session.companyId, kind: 'help', ...(editor ? {} : { published: true }) },
        orderBy: { title: 'asc' },
      }),
    ]);
    return {
      canEdit: editor,
      visible: show || editor,
      handbook: handbook && (show || editor) ? this.handbookView(handbook) : null,
      help: (show || editor)
        ? (await Promise.all(help.map(async (row) => ({ row, ok: editor || (row.published && await this.seesHelp(session, row.audience)) }))))
            .filter((item) => item.ok)
            .map(({ row }) => ({
              id: row.id, title: row.title, body: row.body, published: row.published, audience: row.audience, audienceLabel: this.helpLabel(row.audience),
            }))
        : [],
      documents: await this.visibleDocuments(session, editor),
    };
  }

  /** The Home tiles: FAQs this person is allowed to read, and the current handbook. */
  async shelf(session: SessionUser) {
    const [show, editor, directory] = await Promise.all([
      this.allowsKey(session, 'library'),
      this.gates.holds(session, 'library'),
      this.allowsKey(session, 'directory'),
    ]);
    if (!show && !editor) return { directory, canEdit: false, handbook: null, faqs: [] as Array<{ id: string; title: string; body: string; audienceLabel: string }> };
    const [handbook, help] = await Promise.all([
      this.prisma.libraryDoc.findFirst({ where: { companyId: session.companyId, kind: 'handbook', published: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.libraryDoc.findMany({ where: { companyId: session.companyId, kind: 'help', published: true }, orderBy: { title: 'asc' } }),
    ]);
    const faqs = (await Promise.all(help.map(async (row) => ({ row, ok: editor || await this.seesHelp(session, row.audience) }))))
      .filter((item) => item.ok)
      .map(({ row }) => ({ id: row.id, title: row.title, body: row.body, audienceLabel: this.helpLabel(row.audience) }));
    return { directory, canEdit: editor, handbook: handbook ? this.handbookView(handbook) : null, faqs };
  }

  async targets(session: SessionUser) {
    await this.gates.gate(session, 'library', 'You do not have access to manage the library.');
    const [people, departments, locations] = await Promise.all([
      this.prisma.employee.findMany({
        where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.department.findMany({ where: { companyId: session.companyId }, orderBy: { name: 'asc' } }),
      this.prisma.location.findMany({ where: { companyId: session.companyId }, orderBy: { name: 'asc' } }),
    ]);
    return {
      kinds: DOCUMENT_KINDS.map((item) => ({ key: item.key, label: item.label, personal: item.personal })),
      people: people.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}`.trim(), code: row.code })),
      departments: departments.map((row) => ({ id: row.id, name: row.name })),
      locations: locations.map((row) => ({ id: row.id, name: row.name })),
    };
  }

  async saveFile(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'library', 'You do not have access to manage the library.');
    const input = bag(body);
    const kind = this.documentKind(String(input.kind || ''));
    const title = text(input.title, 'Title', 140);
    const share = await this.shareOf(session, kind, input);
    const parsed = this.pdfOf(String(input.data || ''), this.safeName(String(input.fileName || 'document.pdf')));
    const row = await this.prisma.libraryDoc.create({
      data: {
        companyId: session.companyId,
        kind: 'doc:' + kind.key,
        title,
        version: '1',
        fileName: parsed.name,
        published: input.published !== false,
        body: '',
        ...share,
      },
    });
    const dir = join(process.cwd(), 'storage', 'library', session.companyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, row.id + '.pdf'), parsed.bytes);
    return { id: row.id, title: row.title };
  }

  async setFilePublished(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'library', 'You do not have access to manage the library.');
    const input = bag(body);
    const id = text(input.id, 'Document', 40);
    const current = await this.prisma.libraryDoc.findFirst({ where: { id, companyId: session.companyId, kind: { startsWith: 'doc:' } } });
    if (!current) fail(404, 'That document was not found.');
    await this.prisma.libraryDoc.update({ where: { id }, data: { published: input.published !== false } });
    return { ok: true };
  }

  async removeFile(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'library', 'You do not have access to manage the library.');
    const id = text(bag(body).id, 'Document', 40);
    const current = await this.prisma.libraryDoc.findFirst({ where: { id, companyId: session.companyId, kind: { startsWith: 'doc:' } } });
    if (!current) fail(404, 'That document was not found.');
    await this.prisma.libraryDoc.delete({ where: { id } });
    const path = join(process.cwd(), 'storage', 'library', session.companyId, id + '.pdf');
    if (existsSync(path)) unlinkSync(path);
    return { ok: true };
  }

  async file(session: SessionUser, id: string): Promise<{ type: string; bytes: Buffer; name: string } | null> {
    const row = await this.prisma.libraryDoc.findFirst({ where: { id, companyId: session.companyId, kind: { startsWith: 'doc:' } } });
    if (!row) return null;
    const allowed = await this.visibleDocuments(session);
    if (!allowed.some((item) => item.id === row.id)) return null;
    try {
      const bytes = readFileSync(join(process.cwd(), 'storage', 'library', session.companyId, row.id + '.pdf'));
      return { type: 'application/pdf', bytes, name: this.safeName(row.fileName || 'document.pdf') };
    } catch {
      return null;
    }
  }

  async saveHelp(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'library', 'You do not have access to manage the library.');
    const input = bag(body);
    const title = text(input.title, 'Title', 140);
    const articleBody = richOf(input.body, 'Article', 8000, true);
    const published = input.published !== false;
    const audience = this.helpAudience(String(input.audience || 'all'));
    const id = optional(input.id, 40);
    if (id) {
      const current = await this.prisma.libraryDoc.findFirst({ where: { id, companyId: session.companyId, kind: 'help' } });
      if (!current) fail(404, 'That article was not found.');
      const saved = await this.prisma.libraryDoc.update({ where: { id }, data: { title, body: articleBody, published, audience } });
      return { id: saved.id, title: saved.title };
    }
    const saved = await this.prisma.libraryDoc.create({
      data: { companyId: session.companyId, kind: 'help', title, body: articleBody, published, audience },
    });
    return { id: saved.id, title: saved.title };
  }

  async removeHelp(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'library', 'You do not have access to manage the library.');
    const id = text(bag(body).id, 'Article', 40);
    const current = await this.prisma.libraryDoc.findFirst({ where: { id, companyId: session.companyId, kind: 'help' } });
    if (!current) fail(404, 'That article was not found.');
    await this.prisma.libraryDoc.delete({ where: { id } });
    return { ok: true };
  }

  async saveHandbook(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'library', 'You do not have access to manage the library.');
    const input = bag(body);
    const title = text(input.title, 'Title', 140);
    const version = text(input.version, 'Version', 20);
    const parsed = this.pdfOf(String(input.data || ''));
    const row = await this.prisma.libraryDoc.create({
      data: { companyId: session.companyId, kind: 'handbook', title, version, fileName: parsed.name, published: true, body: '' },
    });
    const dir = join(process.cwd(), 'storage', 'library', session.companyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, row.id + '.pdf'), parsed.bytes);
    await this.prisma.libraryDoc.updateMany({
      where: { companyId: session.companyId, kind: 'handbook', published: true, id: { not: row.id } },
      data: { published: false },
    });
    return this.handbookView(row);
  }

  async handbookFile(session: SessionUser): Promise<{ type: string; bytes: Buffer; name: string } | null> {
    const show = await this.allowsKey(session, 'library');
    if (!show && !(await this.gates.holds(session, 'library'))) return null;
    const row = await this.prisma.libraryDoc.findFirst({
      where: { companyId: session.companyId, kind: 'handbook', published: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return null;
    try {
      const bytes = readFileSync(join(process.cwd(), 'storage', 'library', session.companyId, row.id + '.pdf'));
      return { type: 'application/pdf', bytes, name: row.fileName || 'handbook.pdf' };
    } catch {
      return null;
    }
  }

  private handbookView(row: { id: string; title: string; version: string; fileName: string; createdAt: Date }) {
    return { id: row.id, title: row.title, version: row.version, fileName: row.fileName, publishedOn: row.createdAt.toISOString().slice(0, 10) };
  }

  private async visibleDocuments(session: SessionUser, editor = false) {
    const [rows, self, people, departments, locations] = await Promise.all([
      this.prisma.libraryDoc.findMany({ where: { companyId: session.companyId, kind: { startsWith: 'doc:' } }, orderBy: { createdAt: 'desc' } }),
      session.employeeId
        ? this.prisma.employee.findFirst({ where: { id: session.employeeId, companyId: session.companyId }, select: { id: true, departmentId: true, locationId: true } })
        : Promise.resolve(null),
      this.prisma.employee.findMany({ where: { companyId: session.companyId }, select: { id: true, firstName: true, lastName: true } }),
      this.prisma.department.findMany({ where: { companyId: session.companyId }, select: { id: true, name: true } }),
      this.prisma.location.findMany({ where: { companyId: session.companyId }, select: { id: true, name: true } }),
    ]);
    const names = new Map(people.map((row) => [row.id, `${row.firstName} ${row.lastName}`.trim()]));
    const departmentNames = new Map(departments.map((row) => [row.id, row.name]));
    const locationNames = new Map(locations.map((row) => [row.id, row.name]));
    const canEdit = editor || await this.gates.holds(session, 'library');
    const opened = await Promise.all(rows.map(async (row) => ({ row, ok: await this.canOpen(session, self, row, canEdit) })));
    return opened.filter((item) => item.ok).map(({ row }) => {
      const kind = DOCUMENT_KINDS.find((item) => 'doc:' + item.key === row.kind);
      return {
        id: row.id,
        kind: kind?.key || 'other',
        kindLabel: kind?.label || 'Document',
        title: row.title,
        fileName: row.fileName,
        published: row.published,
        mine: !!session.employeeId && row.employeeId === session.employeeId,
        access: this.accessLabel(row, names, departmentNames, locationNames),
        sharedOn: row.createdAt.toISOString().slice(0, 10),
      };
    });
  }

  private async canOpen(session: SessionUser, self: { id: string; departmentId: string | null; locationId: string | null } | null, row: { published: boolean; kind: string; audience: string; employeeId: string; departmentId: string; locationId: string }, editor: boolean): Promise<boolean> {
    if (editor) return true;
    if (!row.published) return false;
    const personal = DOCUMENT_KINDS.find((item) => 'doc:' + item.key === row.kind)?.personal;
    if (personal || row.audience === 'person') return !!self && row.employeeId === self.id;
    if (row.audience === 'hr') return this.gates.holds(session, 'people.edit') || this.gates.holds(session, 'library');
    if (row.audience === 'managers') {
      return session.role === 'manager'
        || (await this.gates.holds(session, 'approvals'))
        || (await this.gates.holds(session, 'people.edit'))
        || (await this.gates.holds(session, 'library'));
    }
    if (row.audience === 'department') return !!self?.departmentId && self.departmentId === row.departmentId;
    if (row.audience === 'location') return !!self?.locationId && self.locationId === row.locationId;
    return row.audience === 'all';
  }

  private accessLabel(row: { published: boolean; audience: string; employeeId: string; departmentId: string; locationId: string }, names: Map<string, string>, departments: Map<string, string>, locations: Map<string, string>): string {
    const who = row.audience === 'person'
      ? (names.get(row.employeeId) || 'One person') + ' only'
      : row.audience === 'department'
        ? (departments.get(row.departmentId) || 'One department') + ' only'
        : row.audience === 'location'
          ? (locations.get(row.locationId) || 'One location') + ' only'
          : row.audience === 'managers'
            ? 'Managers, HR, and the owner'
            : row.audience === 'hr'
              ? 'Owner and HR'
              : 'Everyone';
    return row.published ? who : who + ' · hidden';
  }

  private documentKind(key: string) {
    const kind = DOCUMENT_KINDS.find((item) => item.key === key);
    if (!kind) fail(400, 'Choose the kind of document.');
    return kind;
  }

  private async shareOf(session: SessionUser, kind: { personal: boolean }, input: Record<string, unknown>) {
    let audience = String(input.audience || 'all');
    if (kind.personal) audience = 'person';
    if (!(FILE_AUDIENCES as readonly string[]).includes(audience)) fail(400, 'Choose who can open this document.');
    const employeeId = optional(input.employeeId, 40);
    const departmentId = optional(input.departmentId, 40);
    const locationId = optional(input.locationId, 40);
    if (audience === 'person') {
      const person = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: session.companyId } });
      if (!person) fail(400, 'Choose the person this document is for.');
    }
    if (audience === 'department') {
      const department = await this.prisma.department.findFirst({ where: { id: departmentId, companyId: session.companyId } });
      if (!department) fail(400, 'Choose the department that can open this.');
    }
    if (audience === 'location') {
      const location = await this.prisma.location.findFirst({ where: { id: locationId, companyId: session.companyId } });
      if (!location) fail(400, 'Choose the location that can open this.');
    }
    return {
      audience,
      employeeId: audience === 'person' ? employeeId : '',
      departmentId: audience === 'department' ? departmentId : '',
      locationId: audience === 'location' ? locationId : '',
    };
  }

  private safeName(name: string): string {
    const clean = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    return clean.toLowerCase().endsWith('.pdf') ? clean : (clean || 'document') + '.pdf';
  }

  private pdfOf(data: string, name = 'handbook.pdf'): { name: string; bytes: Buffer } {
    const match = /^data:application\/pdf;base64,([A-Za-z0-9+/=\s]+)$/.exec(data.trim());
    if (!match) fail(400, 'Choose a PDF.');
    const bytes = Buffer.from(match[1].replace(/\s/g, ''), 'base64');
    if (bytes.length < 32 || bytes.length > 8_000_000) fail(400, 'The PDF must be under 8 MB.');
    return { name: this.safeName(name), bytes };
  }

  private helpAudience(value: string): string {
    return (HELP_AUDIENCES as readonly string[]).includes(value) ? value : 'all';
  }

  private helpLabel(audience: string): string {
    if (audience === 'employee') return 'Employees';
    if (audience === 'managers') return 'Managers';
    if (audience === 'staff') return 'Payroll and accounts';
    if (audience === 'hr') return 'Owner and HR';
    return 'Everyone';
  }

  /** Employees read employee answers. Managers, payroll, and HR each read their own, and HR can read every answer. */
  private async seesHelp(session: SessionUser, audience: string): Promise<boolean> {
    const who = audience || 'all';
    if (who === 'all') return true;
    if (await this.gates.holds(session, 'library') || await this.gates.holds(session, 'people.edit')) return true;
    if (who === 'employee') return session.role === 'employee' || session.role === 'manager' || await this.gates.holds(session, 'approvals');
    if (who === 'managers') return session.role === 'manager' || await this.gates.holds(session, 'approvals');
    if (who === 'staff') return await this.gates.holds(session, 'pay') || session.role === 'accountant';
    return false;
  }

  private async allowsAudience(session: SessionUser, audience: string): Promise<boolean> {
    if (audience === 'off') return false;
    if (audience === 'hr') return this.gates.holds(session, 'people.edit') || this.gates.holds(session, 'library');
    if (audience === 'managers') {
      return (await this.gates.holds(session, 'people.edit'))
        || (await this.gates.holds(session, 'library'))
        || (await this.gates.holds(session, 'approvals'))
        || session.role === 'manager';
    }
    return true;
  }

  private async saved(companyId: string): Promise<Map<string, string>> {
    return this.widgetsCache.remember(companyId, async () => {
      const rows = await this.prisma.homeWidget.findMany({ where: { companyId } });
      return new Map(rows.map((row) => [row.key, row.audience]));
    });
  }
}
