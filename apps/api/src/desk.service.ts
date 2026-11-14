import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { shiftDay, todayInIndia } from './dates';
import { bag, fail, optional, text } from './http';
import { AccessService } from './access.service';
import { closeEmployment } from './lifecycle';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { SettingsService } from './settings.service';
import { advanceFlow, buildFlow, mayWaitOn, parseFlow, stageOf, waitsOn } from './approval-flow';
import { notifyPerson } from './people-kit';

const STARTER = [
  'Collect identity and bank details',
  'Issue the ID card',
  'Issue the laptop',
  'Complete induction',
  'Confirm the manager',
];

@Injectable()
export class DeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
    private readonly settings: SettingsService,
  ) {}

  async tasks(session: SessionUser, employeeId: string) {
    const self = session.employeeId === employeeId;
    const editor = await this.gates.holds(session, 'people.edit');
    if (!self && !editor) fail(403, 'You can open only your own onboarding list.');
    const person = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: session.companyId } });
    if (!person) fail(404, 'That person was not found.');
    if (person.status === 'onboarding') {
      const count = await this.prisma.onboardingTask.count({ where: { employeeId } });
      if (!count) {
        await this.prisma.onboardingTask.createMany({
          data: STARTER.map((title) => ({ companyId: session.companyId, employeeId, title })),
        });
      }
    }
    const rows = await this.prisma.onboardingTask.findMany({ where: { companyId: session.companyId, employeeId }, orderBy: { title: 'asc' } });
    return { canEdit: editor, items: rows.map((row) => ({ id: row.id, title: row.title, done: row.done })) };
  }

  async addTask(session: SessionUser, employeeId: string, body: unknown) {
    await this.gates.gate(session, 'people.edit', 'You do not have access to onboarding.');
    const person = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: session.companyId } });
    if (!person) fail(404, 'That person was not found.');
    const row = await this.prisma.onboardingTask.create({
      data: { companyId: session.companyId, employeeId, title: text(bag(body).title, 'Task', 80) },
    });
    return { id: row.id, title: row.title, done: row.done };
  }

  async toggleTask(session: SessionUser, id: string, body: unknown) {
    await this.gates.gate(session, 'people.edit', 'You do not have access to onboarding.');
    const row = await this.prisma.onboardingTask.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) fail(404, 'That task was not found.');
    const done = bag(body).done === true;
    const saved = await this.prisma.onboardingTask.update({ where: { id }, data: { done } });
    return { id: saved.id, title: saved.title, done: saved.done };
  }

  async exits(session: SessionUser) {
    const mine = session.employeeId
      ? await this.prisma.exitRequest.findFirst({ where: { companyId: session.companyId, employeeId: session.employeeId }, orderBy: { createdAt: 'desc' }, include: { employee: true } })
      : null;
    const span = await this.gates.span(session, 'approvals');
    const pending = (await this.prisma.exitRequest.findMany({
      where: {
        companyId: session.companyId,
        status: 'pending',
        ...(session.employeeId ? { employeeId: { not: session.employeeId } } : {}),
        ...(span === 'company' ? {} : mayWaitOn(session)),
      },
      include: { employee: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    })).filter((row) => span === 'company' || waitsOn(session, row.flowJson, row.employee.managerId)).slice(0, 50);
    const noticeDays = (await this.settings.policy(session.companyId)).noticeDays;
    return {
      mine: mine ? this.exit(mine) : null,
      pending: pending.map((row) => this.exit(row)),
      noticeDays,
      suggestedLastDay: shiftDay(todayInIndia(), noticeDays),
    };
  }

  async submitExit(session: SessionUser, body: unknown) {
    if (!session.employeeId) fail(400, 'This sign-in is not linked to a person.');
    const person = await this.prisma.employee.findFirst({ where: { id: session.employeeId, companyId: session.companyId } });
    if (!person || person.status === 'exited') fail(400, 'An exited person cannot send a resignation.');
    const waiting = await this.prisma.exitRequest.findFirst({ where: { companyId: session.companyId, employeeId: session.employeeId, status: 'pending' } });
    if (waiting) fail(409, 'A resignation is already waiting.');
    const input = bag(body);
    const today = todayInIndia();
    const lastDay = input.lastDay ? this.day(input.lastDay) : shiftDay(today, (await this.settings.policy(session.companyId)).noticeDays);
    if (lastDay < today) fail(400, 'The last working day cannot be in the past.');
    if (lastDay > shiftDay(today, 365)) fail(400, 'Choose a last working day within a year.');
    const flow = await buildFlow(this.prisma, session.companyId, session.employeeId, 'resignation');
    const row = await this.prisma.exitRequest.create({
      data: { companyId: session.companyId, employeeId: session.employeeId, lastDay, reason: text(input.reason, 'Reason', 400), flowJson: JSON.stringify(flow) },
      include: { employee: true },
    });
    return this.exit(row);
  }

  async decideExit(session: SessionUser, id: string, body: unknown) {
    const row = await this.prisma.exitRequest.findFirst({ where: { id, companyId: session.companyId, status: 'pending' }, include: { employee: true } });
    if (!row) fail(404, 'That resignation was not found.');
    if (row.employeeId === session.employeeId) fail(403, 'You cannot decide your own resignation.');
    const company = (await this.gates.span(session, 'approvals')) === 'company';
    const mine = waitsOn(session, row.flowJson, row.employee.managerId);
    if (!mine && !company) fail(403, 'This resignation is waiting on someone else.');
    const decision = String(bag(body).decision || '');
    if (decision !== 'accepted' && decision !== 'declined') fail(400, 'Accept or decline the resignation.');
    const note = optional(bag(body).note, 200);
    const step = advanceFlow(row.flowJson, session, decision === 'accepted' ? 'approved' : 'rejected', note, !mine && !!parseFlow(row.flowJson));
    if (!step.done && step.next) {
      const moved = await this.prisma.exitRequest.update({ where: { id }, data: { flowJson: step.json, note }, include: { employee: true } });
      await notifyPerson(this.prisma, session.companyId, row.employeeId, {
        kind: 'approval',
        title: `${session.name} accepted your resignation`,
        body: `It now waits for ${step.next.approvers.map((item) => item.name).join(', ') || step.next.label}.`,
        link: '/requests',
        ref: `flow:mine:${row.id}:${parseFlow(step.json)?.at ?? 1}`,
      });
      return this.exit(moved);
    }
    const saved = await this.prisma.exitRequest.update({
      where: { id },
      data: { status: decision, note, decidedBy: session.name, flowJson: step.json },
      include: { employee: true },
    });
    if (decision === 'accepted') {
      await this.prisma.employee.update({ where: { id: row.employeeId }, data: { dateOfExit: row.lastDay } });
      if (row.lastDay < todayInIndia()) await closeEmployment(this.prisma, session.companyId, row.employeeId, row.lastDay, session.id);
    }
    return this.exit(saved);
  }

  async cancelExit(session: SessionUser, id: string) {
    if (!session.employeeId) fail(403, 'You can cancel only your own resignation.');
    const row = await this.prisma.exitRequest.findFirst({ where: { id, companyId: session.companyId, employeeId: session.employeeId, status: 'pending' } });
    if (!row) fail(404, 'That resignation is not waiting.');
    await this.prisma.exitRequest.update({ where: { id }, data: { status: 'cancelled', flowJson: advanceFlow(row.flowJson, session, 'cancelled', '', false).json } });
    return { ok: true };
  }

  private day(value: unknown): string {
    const day = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(400, 'Choose the last working day.');
    return day;
  }

  private exit(row: { id: string; lastDay: string; reason: string; status: string; note: string; flowJson: string; employee: { firstName: string; lastName: string; code: string } }) {
    return {
      id: row.id,
      person: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
      code: row.employee.code,
      lastDay: row.lastDay,
      reason: row.reason,
      status: row.status,
      note: row.note,
      stage: stageOf(row.flowJson, row.status),
    };
  }
}
