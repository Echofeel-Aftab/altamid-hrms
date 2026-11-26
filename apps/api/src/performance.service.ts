import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { todayInIndia } from './dates';
import { bag, fail, optional, text } from './http';
import { LicenceService } from './licence.service';
import { fullName, notifyPerson } from './people-kit';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

const PHASES = ['goals', 'review', 'closed'] as const;
type Phase = (typeof PHASES)[number];

@Injectable()
export class PerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
    private readonly licence: LicenceService,
  ) {}

  async view(session: SessionUser, cycleInput = '', personInput = '') {
    await this.licence.assertFeature(session.companyId, 'performance');
    const hr = await this.gates.holds(session, 'performance');
    const cycles = await this.prisma.reviewCycle.findMany({ where: { companyId: session.companyId }, orderBy: [{ startDay: 'desc' }, { createdAt: 'desc' }], take: 40 });
    const cycle = cycles.find((row) => row.id === cycleInput) || cycles.find((row) => row.phase !== 'closed') || cycles[0] || null;
    const reports = session.employeeId
      ? await this.prisma.employee.findMany({ where: { companyId: session.companyId, managerId: session.employeeId, status: { in: ['active', 'onboarding'] } }, include: { designation: true }, orderBy: { firstName: 'asc' } })
      : [];
    const base = {
      canRun: hr,
      cycles: cycles.map((row) => this.cycleOut(row)),
      cycle: cycle ? this.cycleOut(cycle) : null,
    };
    if (!cycle) return { ...base, mine: null, team: [], everyone: [], sheet: null };
    const targetId = personInput || session.employeeId || '';
    const sheet = targetId ? await this.sheet(session, cycle, targetId, hr).catch(() => null) : null;
    const status = async (people: Array<{ id: string; firstName: string; lastName: string; code: string; designation?: { name: string } | null; managerId?: string | null }>) => {
      if (!people.length) return [];
      const ids = people.map((row) => row.id);
      const [goals, reviews] = await Promise.all([
        this.prisma.goal.findMany({ where: { companyId: session.companyId, cycleId: cycle.id, employeeId: { in: ids } } }),
        this.prisma.performanceReview.findMany({ where: { companyId: session.companyId, cycleId: cycle.id, employeeId: { in: ids } } }),
      ]);
      return people.map((person) => {
        const own = goals.filter((goal) => goal.employeeId === person.id);
        const review = reviews.find((row) => row.employeeId === person.id);
        return {
          id: person.id,
          name: fullName(person),
          code: person.code,
          designation: person.designation?.name || '',
          goals: own.length,
          weight: own.reduce((sum, goal) => sum + goal.weight, 0),
          progress: own.length ? Math.round(own.reduce((sum, goal) => sum + goal.progress * (goal.weight || 1), 0) / Math.max(1, own.reduce((sum, goal) => sum + (goal.weight || 1), 0))) : 0,
          selfDone: !!review?.selfDoneAt,
          managerDone: !!review?.managerDoneAt,
          rating: review?.finalRating || review?.managerRating || 0,
          score: this.score(own, 'manager'),
        };
      });
    };
    const everyone = hr
      ? await this.prisma.employee.findMany({ where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } }, include: { designation: true }, orderBy: { firstName: 'asc' }, take: 1000 })
      : [];
    return {
      ...base,
      sheet,
      team: await status(reports),
      everyone: await status(everyone),
    };
  }

  async saveCycle(session: SessionUser, raw: unknown) {
    await this.gates.gate(session, 'performance', 'You do not have access to run review cycles.');
    const input = bag(raw);
    const name = text(input.name, 'Cycle name', 80);
    const startDay = this.day(input.startDay, 'Start date');
    const endDay = this.day(input.endDay, 'End date');
    if (endDay < startDay) fail(400, 'The end date must be after the start date.');
    const scale = [3, 4, 5].includes(Number(input.scale)) ? Number(input.scale) : 5;
    const data = { name, startDay, endDay, scale, selfReview: input.selfReview !== false };
    const id = optional(input.id, 40);
    if (id) {
      const row = await this.prisma.reviewCycle.findFirst({ where: { id, companyId: session.companyId } });
      if (!row) fail(404, 'That cycle was not found.');
      if (row.phase === 'closed') fail(409, 'A closed cycle cannot change.');
      await this.prisma.reviewCycle.update({ where: { id }, data });
      return this.view(session, id);
    }
    const row = await this.prisma.reviewCycle.create({ data: { companyId: session.companyId, ...data, createdBy: session.name } });
    return this.view(session, row.id);
  }

  async phase(session: SessionUser, id: string, raw: unknown) {
    await this.gates.gate(session, 'performance', 'You do not have access to run review cycles.');
    const row = await this.prisma.reviewCycle.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) fail(404, 'That cycle was not found.');
    const phase = String(bag(raw).phase || '') as Phase;
    if (!PHASES.includes(phase)) fail(400, 'Choose goals, review or closed.');
    await this.prisma.reviewCycle.update({ where: { id }, data: { phase } });
    if (phase !== row.phase) {
      const people = await this.prisma.employee.findMany({ where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } }, select: { id: true } });
      if (phase === 'closed') {
        const reviews = await this.prisma.performanceReview.findMany({ where: { cycleId: id } });
        for (const review of reviews) {
          if (!review.finalRating && review.managerRating) await this.prisma.performanceReview.update({ where: { id: review.id }, data: { finalRating: review.managerRating } });
        }
      }
      const title = phase === 'goals' ? `${row.name}: set your goals` : phase === 'review' ? `${row.name}: time for your review` : `${row.name} is complete`;
      const body = phase === 'goals' ? 'Add your goals and agree them with your manager.' : phase === 'review' ? 'Rate each goal and write a short summary of your year.' : 'Your final rating is ready to read.';
      for (const person of people) await notifyPerson(this.prisma, session.companyId, person.id, { kind: 'performance', title, body, link: '/performance', ref: `pms:${id}:${phase}:${person.id}` });
    }
    return this.view(session, id);
  }

  async saveGoal(session: SessionUser, raw: unknown) {
    const input = bag(raw);
    const cycle = await this.cycle(session, input.cycleId);
    const goalId = optional(input.id, 40);
    const existing = goalId ? await this.prisma.goal.findFirst({ where: { id: goalId, companyId: session.companyId, cycleId: cycle.id } }) : null;
    if (goalId && !existing) fail(404, 'That goal was not found.');
    const employeeId = existing?.employeeId || optional(input.employeeId, 40) || session.employeeId || '';
    const role = await this.roleFor(session, employeeId);
    if (cycle.phase !== 'goals' && role !== 'hr') fail(423, 'Goals are locked in the review phase. Ask HR to change one.');
    if (cycle.phase === 'closed') fail(409, 'This cycle is closed.');
    const weight = Math.round(Number(input.weight) || 0);
    if (weight < 0 || weight > 100) fail(400, 'Weight is a share of 100.');
    const others = await this.prisma.goal.findMany({ where: { companyId: session.companyId, cycleId: cycle.id, employeeId, ...(goalId ? { id: { not: goalId } } : {}) } });
    if (others.length >= 12 && !goalId) fail(400, 'Keep it to 12 goals or fewer.');
    if (others.reduce((sum, goal) => sum + goal.weight, 0) + weight > 100) fail(400, 'Goal weights add up to more than 100.');
    const data = { title: text(input.title, 'Goal', 160), detail: optional(input.detail, 1000), weight, target: optional(input.target, 200) };
    if (existing) await this.prisma.goal.update({ where: { id: existing.id }, data });
    else await this.prisma.goal.create({ data: { companyId: session.companyId, cycleId: cycle.id, employeeId, ...data } });
    if (role === 'manager' && employeeId !== session.employeeId) {
      await notifyPerson(this.prisma, session.companyId, employeeId, { kind: 'performance', title: 'Your manager updated your goals', body: data.title, link: '/performance', ref: `pms:goal:${employeeId}:${Date.now()}` });
    }
    return this.view(session, cycle.id, employeeId);
  }

  async removeGoal(session: SessionUser, id: string) {
    const goal = await this.prisma.goal.findFirst({ where: { id, companyId: session.companyId } });
    if (!goal) fail(404, 'That goal was not found.');
    const cycle = await this.cycle(session, goal.cycleId);
    const role = await this.roleFor(session, goal.employeeId);
    if (cycle.phase !== 'goals' && role !== 'hr') fail(423, 'Goals are locked in the review phase.');
    await this.prisma.goal.delete({ where: { id } });
    return this.view(session, cycle.id, goal.employeeId);
  }

  async progress(session: SessionUser, id: string, raw: unknown) {
    const goal = await this.prisma.goal.findFirst({ where: { id, companyId: session.companyId } });
    if (!goal) fail(404, 'That goal was not found.');
    const cycle = await this.cycle(session, goal.cycleId);
    if (cycle.phase === 'closed') fail(409, 'This cycle is closed.');
    await this.roleFor(session, goal.employeeId);
    const value = Math.round(Number(bag(raw).progress));
    if (!Number.isFinite(value) || value < 0 || value > 100) fail(400, 'Progress is from 0 to 100.');
    await this.prisma.goal.update({ where: { id }, data: { progress: value } });
    return this.view(session, cycle.id, goal.employeeId);
  }

  async selfReview(session: SessionUser, raw: unknown) {
    if (!session.employeeId) fail(400, 'This sign-in is not linked to a person.');
    const input = bag(raw);
    const cycle = await this.cycle(session, input.cycleId);
    if (cycle.phase !== 'review') fail(423, 'Self reviews open in the review phase.');
    if (!cycle.selfReview) fail(400, 'This cycle has no self review.');
    const review = await this.review(session.companyId, cycle.id, session.employeeId);
    if (review.selfDoneAt) fail(409, 'You have sent your self review.');
    const submit = input.submit === true;
    await this.rateGoals(session, cycle, session.employeeId, input.goals, 'self', submit);
    const rating = this.rating(input.rating, cycle.scale, submit, 'your overall rating');
    const summary = optional(input.summary, 3000);
    if (submit && summary.length < 10) fail(400, 'Write a short summary of your year.');
    await this.prisma.performanceReview.update({ where: { id: review.id }, data: { selfSummary: summary, selfRating: rating, ...(submit ? { selfDoneAt: new Date() } : {}) } });
    if (submit) {
      const person = await this.prisma.employee.findFirst({ where: { id: session.employeeId, companyId: session.companyId } });
      if (person?.managerId) await notifyPerson(this.prisma, session.companyId, person.managerId, { kind: 'performance', title: `${session.name} sent a self review`, body: cycle.name, link: '/performance', ref: `pms:self:${review.id}` });
    }
    return this.view(session, cycle.id);
  }

  async managerReview(session: SessionUser, raw: unknown) {
    const input = bag(raw);
    const cycle = await this.cycle(session, input.cycleId);
    if (cycle.phase !== 'review') fail(423, 'Manager reviews open in the review phase.');
    const employeeId = text(input.employeeId, 'Person', 40);
    const role = await this.roleFor(session, employeeId);
    if (role === 'self') fail(403, 'Your manager reviews you.');
    const review = await this.review(session.companyId, cycle.id, employeeId);
    if (review.managerDoneAt && role !== 'hr') fail(409, 'You have already sent this review.');
    const submit = input.submit === true;
    await this.rateGoals(session, cycle, employeeId, input.goals, 'manager', submit);
    const rating = this.rating(input.rating, cycle.scale, submit, 'the overall rating');
    const summary = optional(input.summary, 3000);
    if (submit && summary.length < 10) fail(400, 'Write a short summary for the person.');
    await this.prisma.performanceReview.update({
      where: { id: review.id },
      data: { managerSummary: summary, managerRating: rating, managerId: session.employeeId || '', ...(submit ? { managerDoneAt: new Date() } : {}) },
    });
    return this.view(session, cycle.id, employeeId);
  }

  async finalRating(session: SessionUser, raw: unknown) {
    await this.gates.gate(session, 'performance', 'You do not have access to set final ratings.');
    const input = bag(raw);
    const cycle = await this.cycle(session, input.cycleId);
    const employeeId = text(input.employeeId, 'Person', 40);
    if (employeeId === session.employeeId) fail(403, 'Someone else sets your own final rating.');
    const review = await this.review(session.companyId, cycle.id, employeeId);
    const rating = this.rating(input.rating, cycle.scale, true, 'the final rating');
    await this.prisma.performanceReview.update({ where: { id: review.id }, data: { finalRating: rating, finalNote: optional(input.note, 1000) } });
    return this.view(session, cycle.id, employeeId);
  }

  private async sheet(session: SessionUser, cycle: { id: string; phase: string; scale: number; selfReview: boolean }, employeeId: string, hr: boolean) {
    const role = await this.roleFor(session, employeeId);
    const person = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: session.companyId }, include: { designation: true, manager: true } });
    if (!person) fail(404, 'That person was not found.');
    const goals = await this.prisma.goal.findMany({ where: { companyId: session.companyId, cycleId: cycle.id, employeeId }, orderBy: { createdAt: 'asc' } });
    const review = await this.prisma.performanceReview.findUnique({ where: { cycleId_employeeId: { cycleId: cycle.id, employeeId } } });
    const self = role === 'self';
    const showManager = !self || cycle.phase === 'closed';
    return {
      person: { id: person.id, name: fullName(person), code: person.code, designation: person.designation?.name || '', manager: person.manager ? fullName(person.manager) : '' },
      role,
      goals: goals.map((goal) => ({
        id: goal.id,
        title: goal.title,
        detail: goal.detail,
        weight: goal.weight,
        target: goal.target,
        progress: goal.progress,
        selfRating: goal.selfRating,
        selfNote: goal.selfNote,
        managerRating: showManager ? goal.managerRating : 0,
        managerNote: showManager ? goal.managerNote : '',
      })),
      weight: goals.reduce((sum, goal) => sum + goal.weight, 0),
      review: {
        selfSummary: review?.selfSummary || '',
        selfRating: review?.selfRating || 0,
        selfDone: !!review?.selfDoneAt,
        managerSummary: showManager ? review?.managerSummary || '' : '',
        managerRating: showManager ? review?.managerRating || 0 : 0,
        managerDone: !!review?.managerDoneAt,
        finalRating: showManager ? review?.finalRating || 0 : 0,
        finalNote: showManager ? review?.finalNote || '' : '',
        selfScore: this.score(goals, 'self'),
        managerScore: showManager ? this.score(goals, 'manager') : 0,
      },
      can: {
        goals: cycle.phase === 'goals' || (hr && cycle.phase !== 'closed'),
        progress: cycle.phase !== 'closed',
        self: self && cycle.selfReview && cycle.phase === 'review' && !review?.selfDoneAt,
        manager: !self && cycle.phase === 'review' && (!review?.managerDoneAt || role === 'hr'),
        final: hr && !self && cycle.phase !== 'goals',
      },
    };
  }

  private async rateGoals(session: SessionUser, cycle: { id: string; scale: number }, employeeId: string, value: unknown, side: 'self' | 'manager', submit: boolean) {
    const given = value && typeof value === 'object' ? value as Record<string, { rating?: unknown; note?: unknown }> : {};
    const goals = await this.prisma.goal.findMany({ where: { companyId: session.companyId, cycleId: cycle.id, employeeId } });
    if (submit && !goals.length) fail(400, 'There are no goals to rate.');
    for (const goal of goals) {
      const entry = given[goal.id] || {};
      const rating = this.rating(entry.rating, cycle.scale, submit, `“${goal.title}”`);
      const note = optional(entry.note, 1000);
      await this.prisma.goal.update({ where: { id: goal.id }, data: side === 'self' ? { selfRating: rating, selfNote: note } : { managerRating: rating, managerNote: note } });
    }
  }

  private score(goals: Array<{ weight: number; selfRating: number; managerRating: number }>, side: 'self' | 'manager'): number {
    const rated = goals.filter((goal) => (side === 'self' ? goal.selfRating : goal.managerRating) > 0);
    if (!rated.length) return 0;
    const weights = rated.reduce((sum, goal) => sum + (goal.weight || 1), 0);
    const total = rated.reduce((sum, goal) => sum + (side === 'self' ? goal.selfRating : goal.managerRating) * (goal.weight || 1), 0);
    return Math.round(total / weights * 10) / 10;
  }

  private rating(value: unknown, scale: number, required: boolean, label: string): number {
    const rating = Math.round(Number(value) || 0);
    if (!rating && !required) return 0;
    if (rating < 1 || rating > scale) fail(400, `Rate ${label} from 1 to ${scale}.`);
    return rating;
  }

  /** self, manager (the person reports to me), or hr. Anyone else is turned away. */
  private async roleFor(session: SessionUser, employeeId: string): Promise<'self' | 'manager' | 'hr'> {
    if (!employeeId) fail(400, 'This sign-in is not linked to a person.');
    if (employeeId === session.employeeId) return 'self';
    const person = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: session.companyId }, select: { managerId: true } });
    if (!person) fail(404, 'That person was not found.');
    if (session.employeeId && person.managerId === session.employeeId) return 'manager';
    if (await this.gates.holds(session, 'performance')) return 'hr';
    fail(403, 'You can open only your own goals and the goals of people who report to you.');
  }

  private async review(companyId: string, cycleId: string, employeeId: string) {
    const found = await this.prisma.performanceReview.findUnique({ where: { cycleId_employeeId: { cycleId, employeeId } } });
    if (found) return found;
    return this.prisma.performanceReview.create({ data: { companyId, cycleId, employeeId } });
  }

  private async cycle(session: SessionUser, value: unknown) {
    const id = text(value, 'Review cycle', 40);
    const row = await this.prisma.reviewCycle.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) fail(404, 'That review cycle was not found.');
    return row;
  }

  private cycleOut(row: { id: string; name: string; startDay: string; endDay: string; phase: string; scale: number; selfReview: boolean }) {
    return { id: row.id, name: row.name, startDay: row.startDay, endDay: row.endDay, phase: row.phase, scale: row.scale, selfReview: row.selfReview, live: row.startDay <= todayInIndia() && row.endDay >= todayInIndia() };
  }

  private day(value: unknown, label: string): string {
    const day = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(400, `Choose the ${label.toLowerCase()}.`);
    return day;
  }
}
