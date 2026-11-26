import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { bag, fail, optional, text } from './http';
import { LicenceService } from './licence.service';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

export const GROWTH_GRADES = [
  { grade: 'Needs focus', rating: 1 },
  { grade: 'Fair', rating: 2 },
  { grade: 'Good', rating: 3 },
  { grade: 'Great', rating: 4 },
  { grade: 'Outstanding', rating: 5 },
] as const;

const SIDES = ['earning', 'deduction', 'employer'] as const;
type Side = (typeof SIDES)[number];
interface PayLine { side: Side; name: string; paise: number }

const WORKER: Record<string, string> = { employee: 'Full time', contractor: 'Contractor', intern: 'Intern' };

type PersonRow = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  workerType: string;
  status: string;
  dateOfJoining: string;
  managerId: string | null;
  photoAt: Date | null;
  designation: { name: string } | null;
  manager: { id: string; code: string; firstName: string; lastName: string; photoAt: Date | null } | null;
};

@Injectable()
export class GrowthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
    private readonly licence: LicenceService,
  ) {}

  /** The signed-in person's growth, or a person their manager or HR may publish for. */
  async view(session: SessionUser, personId: string) {
    await this.licence.assertFeature(session.companyId, 'performance');
    const people = await this.choices(session);
    const id = personId || session.employeeId || '';
    const suggestedYear = this.yearNow();
    if (!id) {
      return { person: null, people, canPublish: false, grades: GROWTH_GRADES, suggestedYear, chart: [], history: [], latest: null, current: null };
    }
    const person = await this.person(session, id);
    if (!(await this.canSee(session, person))) fail(403, 'You can open your own growth. Your manager or HR can open the people they publish for.');
    const canPublish = await this.canPublish(session, person);
    const rows = await this.prisma.appraisal.findMany({
      where: { companyId: session.companyId, employeeId: person.id, ...(canPublish ? {} : { published: true }) },
      orderBy: { year: 'asc' },
    });
    const publishers = await this.names(session.companyId, rows.map((row) => row.publishedBy));
    const history = rows.map((row) => this.present(row, publishers.get(row.publishedBy) || ''));
    const visible = canPublish ? history : history.filter((row) => row.published);
    const published = history.filter((row) => row.published);
    const latest = published.length ? published[published.length - 1] : null;
    return {
      person: this.card(person),
      people,
      canPublish,
      grades: GROWTH_GRADES,
      suggestedYear,
      chart: this.chart(this.joinedYear(person.dateOfJoining), visible),
      history: [...visible].reverse(),
      latest: latest ? { year: latest.year, grade: latest.grade, rating: latest.rating } : null,
      current: canPublish ? await this.currentCtc(session.companyId, person.id) : null,
    };
  }

  /** The team lead or HR saves a year's grade and CTC breakup. Publish is what the person sees. */
  async save(session: SessionUser, body: unknown) {
    const input = bag(body);
    const person = await this.person(session, text(input.employeeId, 'Person', 40));
    if (!(await this.canPublish(session, person))) fail(403, 'Your manager or HR publishes this appraisal.');
    const year = this.yearOf(input.year);
    const grade = text(input.grade, 'Grade', 40);
    const scale = GROWTH_GRADES.find((item) => item.grade === grade);
    if (!scale) fail(400, 'Choose a grade from the list.');
    const designation = optional(input.designation, 80);
    const note = optional(input.note, 500);
    const publish = input.publish === true || input.publish === 'true';
    const lines = this.linesOf(input.lines, publish);
    await this.prisma.appraisal.upsert({
      where: { companyId_employeeId_year: { companyId: session.companyId, employeeId: person.id, year } },
      create: {
        companyId: session.companyId,
        employeeId: person.id,
        year,
        grade,
        rating: scale.rating,
        designation,
        note,
        linesJson: JSON.stringify(lines),
        published: publish,
        publishedBy: session.id,
      },
      update: { grade, rating: scale.rating, designation, note, linesJson: JSON.stringify(lines), published: publish, publishedBy: session.id },
    });
    if (publish) await this.tell(session, person.id, year, grade, this.annualPaise(lines));
    return this.view(session, person.id);
  }

  async remove(session: SessionUser, body: unknown) {
    const input = bag(body);
    const person = await this.person(session, text(input.employeeId, 'Person', 40));
    if (!(await this.canPublish(session, person))) fail(403, 'Your manager or HR publishes this appraisal.');
    const year = this.yearOf(input.year);
    await this.prisma.appraisal.deleteMany({ where: { companyId: session.companyId, employeeId: person.id, year } });
    return this.view(session, person.id);
  }

  private async choices(session: SessionUser) {
    const desk = (await this.gates.holds(session, 'people.edit')) || (await this.gates.holds(session, 'performance'));
    const where = desk
      ? { companyId: session.companyId, status: { in: ['active', 'onboarding'] } }
      : session.employeeId
        ? { companyId: session.companyId, status: { in: ['active', 'onboarding'] }, OR: [{ id: session.employeeId }, { managerId: session.employeeId }] }
        : { id: '__none__' };
    const rows = await this.prisma.employee.findMany({
      where,
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: { id: true, code: true, firstName: true, lastName: true },
      take: 500,
    });
    return rows.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}`.trim(), code: row.code, mine: row.id === session.employeeId }));
  }

  private async person(session: SessionUser, id: string): Promise<PersonRow> {
    const row = await this.prisma.employee.findFirst({
      where: { id, companyId: session.companyId },
      include: {
        designation: { select: { name: true } },
        manager: { select: { id: true, code: true, firstName: true, lastName: true, photoAt: true } },
      },
    });
    if (!row) fail(404, 'That person was not found.');
    if (row.status !== 'active' && row.status !== 'onboarding' && row.id !== session.employeeId) fail(404, 'That person was not found.');
    return row;
  }

  private async canSee(session: SessionUser, person: { id: string; managerId: string | null }): Promise<boolean> {
    return person.id === session.employeeId || (await this.canPublish(session, person));
  }

  private async canPublish(session: SessionUser, person: { id: string; managerId: string | null }): Promise<boolean> {
    if ((await this.gates.holds(session, 'people.edit')) || (await this.gates.holds(session, 'performance'))) return true;
    return !!session.employeeId && person.managerId === session.employeeId && person.id !== session.employeeId;
  }

  private card(person: PersonRow) {
    const manager = person.manager;
    return {
      id: person.id,
      name: `${person.firstName} ${person.lastName}`.trim(),
      code: person.code,
      photo: person.photoAt ? person.photoAt.toISOString() : '',
      designation: person.designation?.name || '',
      joined: this.longDay(person.dateOfJoining),
      workerType: WORKER[person.workerType] || 'Full time',
      manager: manager
        ? { id: manager.id, name: `${manager.firstName} ${manager.lastName}`.trim(), code: manager.code, photo: manager.photoAt ? manager.photoAt.toISOString() : '' }
        : null,
    };
  }

  private present(row: { year: number; grade: string; rating: number; designation: string; note: string; linesJson: string; published: boolean; updatedAt: Date }, publisher: string) {
    const lines = this.readLines(row.linesJson);
    return {
      year: row.year,
      grade: row.grade,
      rating: row.rating,
      designation: row.designation,
      note: row.note,
      published: row.published,
      publisher,
      at: row.updatedAt.toISOString(),
      annual: this.rupees(this.annualPaise(lines)),
      lines: lines.map((line) => ({ side: line.side, name: line.name, amount: this.rupees(line.paise), rupees: (line.paise / 100).toFixed(2) })),
    };
  }

  private chart(joinedYear: number | null, rows: Array<{ year: number; grade: string; rating: number; published: boolean }>) {
    const points = rows.map((row) => ({ year: row.year, label: row.grade, rating: row.rating, joined: false, draft: !row.published }));
    if (joinedYear && !points.some((point) => point.year === joinedYear)) {
      points.unshift({ year: joinedYear, label: 'Joined', rating: 1, joined: true, draft: false });
    }
    return points.sort((left, right) => left.year - right.year);
  }

  private async currentCtc(companyId: string, employeeId: string) {
    const row = await this.prisma.payStructure.findFirst({
      where: { companyId, employeeId, published: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) return null;
    const lines = this.readLines(row.linesJson);
    return {
      effectiveFrom: row.effectiveFrom,
      annual: this.rupees(this.annualPaise(lines)),
      lines: lines.map((line) => ({ side: line.side, name: line.name, rupees: (line.paise / 100).toFixed(2) })),
    };
  }

  private async names(companyId: string, ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({ where: { companyId, id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((user) => [user.id, user.name]));
  }

  private async tell(session: SessionUser, employeeId: string, year: number, grade: string, annual: number) {
    const user = await this.prisma.user.findFirst({ where: { companyId: session.companyId, employeeId, id: { not: session.id } }, select: { id: true } });
    if (!user) return;
    const title = `Your ${year} appraisal is published`;
    const body = `${grade}. Annual CTC ${this.rupees(annual)}.`;
    await this.prisma.notification.upsert({
      where: { userId_kind_ref: { userId: user.id, kind: 'growth', ref: `${employeeId}:${year}` } },
      create: { companyId: session.companyId, userId: user.id, kind: 'growth', title, body, link: '/growth', ref: `${employeeId}:${year}` },
      update: { title, body, readAt: null },
    }).catch(() => undefined);
  }

  private linesOf(value: unknown, publish: boolean): PayLine[] {
    if (!Array.isArray(value)) return publish ? fail(400, 'Add the CTC breakup before you publish.') : [];
    if (value.length > 24) fail(400, 'Use at most 24 CTC lines.');
    const lines: PayLine[] = [];
    for (const item of value) {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const name = optional(row.name, 80);
      const rupees = String(row.rupees ?? '').trim();
      if (!name && !rupees) continue;
      const side = String(row.side || '');
      if (!SIDES.includes(side as Side)) fail(400, 'Choose earning, deduction, or employer contribution.');
      if (!name) fail(400, 'Name each CTC line.');
      lines.push({ side: side as Side, name, paise: this.paiseOf(rupees) });
    }
    if (publish && !lines.some((line) => line.side === 'earning' && line.paise > 0)) fail(400, 'Add at least one earning before you publish.');
    return lines;
  }

  private readLines(raw: string): PayLine[] {
    try {
      const parsed = JSON.parse(raw || '[]') as Array<{ side?: string; name?: string; paise?: number }>;
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((line) => {
        const side = String(line.side || '');
        const name = String(line.name || '').trim();
        const paise = Number(line.paise);
        if (!SIDES.includes(side as Side) || !name || !Number.isFinite(paise)) return [];
        return [{ side: side as Side, name, paise: Math.round(paise) }];
      });
    } catch {
      return [];
    }
  }

  private annualPaise(lines: PayLine[]): number {
    return lines.filter((line) => line.side !== 'deduction').reduce((sum, line) => sum + line.paise, 0);
  }

  private paiseOf(value: unknown): number {
    const raw = String(value ?? '').trim().replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) fail(400, 'Enter an amount in rupees, with at most two decimal places.');
    const paise = Math.round(Number(raw) * 100);
    if (paise > 10_000_000_000) fail(400, 'That amount is too large.');
    return paise;
  }

  private rupees(paise: number): string {
    const abs = Math.abs(Math.trunc(paise));
    const whole = Math.floor(abs / 100).toLocaleString('en-IN');
    const fraction = String(abs % 100).padStart(2, '0');
    return `₹${whole}.${fraction}`;
  }

  private yearOf(value: unknown): number {
    const year = Number(value);
    const now = this.yearNow();
    if (!Number.isInteger(year) || year < 1990 || year > now + 1) fail(400, 'Choose an appraisal year.');
    return year;
  }

  private yearNow(): number {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: 'numeric' }).format(new Date()));
  }

  private joinedYear(value: string): number | null {
    const match = /^(\d{4})-\d{2}-\d{2}$/.exec(value);
    return match ? Number(match[1]) : null;
  }

  private longDay(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return value || 'Not added';
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
}
