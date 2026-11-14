import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { bag, fail, optional, text } from './http';
import { fullName } from './people-kit';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

const LEVELS = ['low', 'medium', 'high'] as const;
const READINESS = ['now', '1-2 years', '3+ years'] as const;
export interface Successor { employeeId: string; readiness: (typeof READINESS)[number]; note: string }

@Injectable()
export class SuccessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
  ) {}

  async view(session: SessionUser) {
    await this.gates.gate(session, 'succession', 'You do not have access to succession planning.');
    const plans = await this.prisma.successionPlan.findMany({ where: { companyId: session.companyId }, orderBy: [{ updatedAt: 'desc' }] });
    const people = await this.prisma.employee.findMany({ where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } }, include: { designation: true, department: true }, orderBy: { firstName: 'asc' }, take: 2000 });
    const byId = new Map(people.map((person) => [person.id, person]));
    const reviews = await this.prisma.performanceReview.findMany({ where: { companyId: session.companyId, employeeId: { in: people.map((person) => person.id) }, finalRating: { gt: 0 } }, orderBy: { updatedAt: 'desc' } });
    const appraisals = await this.prisma.appraisal.findMany({ where: { companyId: session.companyId, published: true }, orderBy: { year: 'desc' } });
    const card = (id: string) => {
      const person = byId.get(id);
      if (!person) return null;
      return {
        id: person.id,
        name: fullName(person),
        code: person.code,
        designation: person.designation?.name || '',
        department: person.department?.name || '',
        rating: reviews.find((row) => row.employeeId === id)?.finalRating || 0,
        grade: appraisals.find((row) => row.employeeId === id)?.grade || '',
        joined: person.dateOfJoining,
      };
    };
    const rows = plans.map((plan) => {
      const successors = this.successors(plan.successorsJson).map((item) => ({ ...item, person: card(item.employeeId) })).filter((item) => item.person);
      return {
        id: plan.id,
        role: plan.role,
        impact: plan.impact,
        risk: plan.risk,
        note: plan.note,
        incumbent: plan.incumbentId ? card(plan.incumbentId) : null,
        incumbentId: plan.incumbentId,
        successors,
        readyNow: successors.filter((item) => item.readiness === 'now').length,
        updatedAt: plan.updatedAt.toISOString().slice(0, 10),
      };
    });
    return {
      levels: LEVELS,
      readiness: READINESS,
      plans: rows,
      stats: {
        roles: rows.length,
        covered: rows.filter((row) => row.readyNow > 0).length,
        atRisk: rows.filter((row) => row.risk === 'high' && row.readyNow === 0).length,
        bench: new Set(rows.flatMap((row) => row.successors.map((item) => item.employeeId))).size,
      },
      people: people.map((person) => ({ id: person.id, name: fullName(person), code: person.code, designation: person.designation?.name || '' })),
    };
  }

  async save(session: SessionUser, raw: unknown) {
    await this.gates.gate(session, 'succession', 'You do not have access to succession planning.');
    const input = bag(raw);
    const id = optional(input.id, 40);
    const existing = id ? await this.prisma.successionPlan.findFirst({ where: { id, companyId: session.companyId } }) : null;
    if (id && !existing) fail(404, 'That role plan was not found.');
    const incumbentId = optional(input.incumbentId, 40);
    if (incumbentId && !(await this.prisma.employee.findFirst({ where: { id: incumbentId, companyId: session.companyId } }))) fail(404, 'That person was not found.');
    const level = (value: unknown, label: string) => {
      const next = String(value || 'medium');
      if (!LEVELS.includes(next as (typeof LEVELS)[number])) fail(400, `Choose low, medium or high for ${label}.`);
      return next;
    };
    const list = Array.isArray(input.successors) ? input.successors : [];
    if (list.length > 8) fail(400, 'Keep it to 8 successors for one role.');
    const seen = new Set<string>();
    const successors: Successor[] = [];
    for (const item of list) {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const employeeId = text(row.employeeId, 'Successor', 40);
      if (employeeId === incumbentId) fail(400, 'The person in the role cannot also be their own successor.');
      if (seen.has(employeeId)) continue;
      seen.add(employeeId);
      if (!(await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: session.companyId } }))) fail(404, 'A successor was not found.');
      const readiness = String(row.readiness || 'now') as Successor['readiness'];
      if (!READINESS.includes(readiness)) fail(400, 'Choose how soon each successor is ready.');
      successors.push({ employeeId, readiness, note: optional(row.note, 300) });
    }
    const data = {
      role: text(input.role, 'Role', 120),
      incumbentId,
      impact: level(input.impact, 'impact'),
      risk: level(input.risk, 'the risk of losing them'),
      note: optional(input.note, 1000),
      successorsJson: JSON.stringify(successors),
    };
    if (existing) await this.prisma.successionPlan.update({ where: { id: existing.id }, data });
    else await this.prisma.successionPlan.create({ data: { companyId: session.companyId, ...data } });
    return this.view(session);
  }

  async remove(session: SessionUser, id: string) {
    await this.gates.gate(session, 'succession', 'You do not have access to succession planning.');
    const row = await this.prisma.successionPlan.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) fail(404, 'That role plan was not found.');
    await this.prisma.successionPlan.delete({ where: { id } });
    return this.view(session);
  }

  private successors(json: string): Successor[] {
    try {
      const parsed = JSON.parse(json || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
