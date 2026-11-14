import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { advanceFlow } from './approval-flow';
import { BrandService } from './brand.service';
import { shiftDay, todayInIndia } from './dates';
import { bag, fail, optional, text } from './http';
import { LeaveLedger } from './leave-ledger.service';
import { letterPdf } from './letter-pdf';
import { letterLook, longDate } from './letter-look';
import { closeEmployment } from './lifecycle';
import { currentPay, fullName, inr, notifyPerson } from './people-kit';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { SettingsService } from './settings.service';

export interface CheckItem { id: string; title: string; owner: string; done: boolean; doneBy: string; doneAt: string; auto?: string }
export interface SettleLine { key: string; label: string; side: 'earning' | 'deduction'; amount: number; auto: boolean; note: string }
export interface Settlement { lines: SettleLine[]; status: 'draft' | 'final'; payDate: string; note: string; by: string; at: string }

export const EXIT_REASONS = ['Better pay', 'Career growth', 'The role or the work', 'My manager', 'Work-life balance', 'Relocation', 'Higher studies', 'Health or family', 'Started my own work', 'Other'];
export const EXIT_RATINGS = [
  { key: 'role', label: 'The role and the work' },
  { key: 'manager', label: 'Support from my manager' },
  { key: 'team', label: 'My team' },
  { key: 'growth', label: 'Learning and growth' },
  { key: 'pay', label: 'Pay and benefits' },
  { key: 'culture', label: 'Culture and how we work' },
];

const OPEN = ['pending', 'accepted'];

/** Days from one date to another, counting both, or 0 when the second is earlier or a date is missing. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(from + 'T00:00:00Z');
  const end = Date.parse(to + 'T00:00:00Z');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 86400000) + 1;
}

@Injectable()
export class SeparationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
    private readonly settings: SettingsService,
    private readonly ledger: LeaveLedger,
    private readonly brand: BrandService,
  ) {}

  async board(session: SessionUser, status = '') {
    const desk = await this.gates.holds(session, 'exits');
    const policy = await this.settings.policy(session.companyId);
    const mine = session.employeeId
      ? await this.prisma.exitRequest.findFirst({
        where: { companyId: session.companyId, employeeId: session.employeeId, status: { notIn: ['cancelled', 'withdrawn', 'declined'] } },
        orderBy: { createdAt: 'desc' },
      })
      : null;
    let rows: Array<ReturnType<SeparationService['row']>> = [];
    let counts = { pending: 0, accepted: 0, closed: 0, other: 0 };
    if (desk) {
      const found = await this.prisma.exitRequest.findMany({
        where: { companyId: session.companyId, createdAt: { gte: new Date(Date.now() - 540 * 86400000) } },
        include: { employee: { include: { department: true, designation: true } } },
        orderBy: { createdAt: 'desc' },
        take: 300,
      });
      const all = found.map((row) => this.row(row));
      counts = {
        pending: all.filter((row) => row.stage === 'pending').length,
        accepted: all.filter((row) => row.stage === 'accepted').length,
        closed: all.filter((row) => row.stage === 'closed').length,
        other: all.filter((row) => row.stage === 'other').length,
      };
      rows = status ? all.filter((row) => row.stage === status) : all;
    }
    const people = desk
      ? (await this.prisma.employee.findMany({ where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } }, orderBy: { firstName: 'asc' }, take: 1000 }))
        .map((person) => ({ id: person.id, name: fullName(person), code: person.code }))
      : [];
    return {
      canDesk: desk,
      noticeDays: policy.noticeDays,
      suggestedLastDay: shiftDay(todayInIndia(), policy.noticeDays),
      reasons: EXIT_REASONS,
      ratings: EXIT_RATINGS,
      mine: mine ? await this.detail(session, mine.id, false) : null,
      counts,
      rows,
      people,
    };
  }

  async one(session: SessionUser, id: string) {
    const row = await this.prisma.exitRequest.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) fail(404, 'That exit was not found.');
    const desk = await this.gates.holds(session, 'exits');
    if (!desk && row.employeeId !== session.employeeId) fail(403, 'You can open only your own exit.');
    return this.detail(session, id, desk && row.employeeId !== session.employeeId);
  }

  /** HR starts an exit for someone, for example when the person resigned by email or the company ends the employment. */
  async start(session: SessionUser, raw: unknown) {
    await this.gates.gate(session, 'exits', 'You do not have access to the exits desk.');
    const input = bag(raw);
    const employeeId = text(input.employeeId, 'Person', 40);
    const person = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: session.companyId }, include: { user: true } });
    if (!person || person.status === 'exited') fail(404, 'Choose someone who still works here.');
    if (person.id === session.employeeId) fail(400, 'Someone else starts your own exit.');
    if (person.user?.role === 'owner') fail(400, 'The owner’s exit is handled in People.');
    const open = await this.prisma.exitRequest.findFirst({ where: { companyId: session.companyId, employeeId, status: { in: OPEN }, closedAt: null } });
    if (open) fail(409, 'This person already has an open exit. Open it to make changes.');
    const lastDay = this.day(input.lastDay);
    if (lastDay < shiftDay(todayInIndia(), -90)) fail(400, 'The last day can be at most 90 days back.');
    const kind = String(input.kind || 'resigned');
    const reason = text(input.reason, 'Reason', 400);
    const row = await this.prisma.exitRequest.create({
      data: {
        companyId: session.companyId,
        employeeId,
        lastDay,
        originalLastDay: lastDay,
        reason: kind === 'terminated' ? `Ended by the company: ${reason}` : kind === 'absconded' ? `Stopped coming to work: ${reason}` : reason,
        status: 'accepted',
        initiatedBy: 'hr',
        noticeWaived: input.waive === true,
        overrideNote: optional(input.note, 400),
        decidedBy: session.name,
      },
    });
    await this.prisma.employee.update({ where: { id: employeeId }, data: { dateOfExit: lastDay } });
    await this.ensureChecklist(session.companyId, row.id);
    await notifyPerson(this.prisma, session.companyId, employeeId, { kind: 'exit', title: 'Your exit has been recorded', body: `Last working day ${longDate(lastDay)}.`, link: '/separation', ref: `exit:${row.id}:start` });
    await this.audit(session, 'exit.start', row.id, `${employeeId} last day ${lastDay}`);
    return this.detail(session, row.id, true);
  }

  async override(session: SessionUser, id: string, raw: unknown) {
    await this.gates.gate(session, 'exits', 'You do not have access to the exits desk.');
    const row = await this.prisma.exitRequest.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) fail(404, 'That exit was not found.');
    if (row.employeeId === session.employeeId) fail(403, 'Someone else changes your own exit.');
    if (row.closedAt) fail(409, 'This exit is closed.');
    const input = bag(raw);
    const action = String(input.action || '');
    const note = text(input.note, 'Reason for the change', 400);
    const stamp = `${longDate(todayInIndia())} · ${session.name}: ${note}`;
    const history = [row.overrideNote, stamp].filter(Boolean).join('\n').slice(-2000);
    if (action === 'change') {
      if (!OPEN.includes(row.status)) fail(400, 'Only a waiting or accepted exit can change.');
      const lastDay = this.day(input.lastDay);
      const waive = input.waive === true;
      await this.prisma.exitRequest.update({
        where: { id },
        data: { lastDay, noticeWaived: waive, overrideNote: history, originalLastDay: row.originalLastDay || row.lastDay },
      });
      if (row.status === 'accepted') await this.prisma.employee.update({ where: { id: row.employeeId }, data: { dateOfExit: lastDay } });
      await notifyPerson(this.prisma, session.companyId, row.employeeId, { kind: 'exit', title: 'Your last working day changed', body: `It is now ${longDate(lastDay)}${waive ? ', and the rest of the notice is waived' : ''}. ${note}`, link: '/separation', ref: `exit:${id}:change:${Date.now()}` });
    } else if (action === 'accept' || action === 'decline') {
      if (row.status !== 'pending') fail(400, 'Only a waiting resignation can be accepted or declined.');
      await this.prisma.exitRequest.update({ where: { id }, data: { status: action === 'accept' ? 'accepted' : 'declined', note, decidedBy: session.name, overrideNote: history, flowJson: advanceFlow(row.flowJson, session, action === 'accept' ? 'approved' : 'rejected', note, true).json } });
      if (action === 'accept') {
        await this.prisma.employee.update({ where: { id: row.employeeId }, data: { dateOfExit: row.lastDay } });
        await this.ensureChecklist(session.companyId, id);
      }
      await notifyPerson(this.prisma, session.companyId, row.employeeId, { kind: 'exit', title: action === 'accept' ? 'Resignation accepted' : 'Resignation declined', body: note, link: '/separation', ref: `exit:${id}:${action}` });
    } else if (action === 'withdraw') {
      if (!OPEN.includes(row.status)) fail(400, 'This exit is not open.');
      await this.prisma.exitRequest.update({ where: { id }, data: { status: 'withdrawn', overrideNote: history } });
      await this.prisma.employee.update({ where: { id: row.employeeId }, data: { dateOfExit: '' } });
      await notifyPerson(this.prisma, session.companyId, row.employeeId, { kind: 'exit', title: 'Your exit was withdrawn', body: note, link: '/separation', ref: `exit:${id}:withdraw` });
    } else {
      fail(400, 'Choose what to change.');
    }
    await this.audit(session, 'exit.' + action, id, note);
    return this.detail(session, id, true);
  }

  async checklist(session: SessionUser, id: string, raw: unknown) {
    await this.gates.gate(session, 'exits', 'You do not have access to the exits desk.');
    const row = await this.prisma.exitRequest.findFirst({ where: { id, companyId: session.companyId } });
    if (!row || row.status !== 'accepted') fail(404, 'The checklist opens once the exit is accepted.');
    const items = await this.ensureChecklist(session.companyId, id);
    const input = bag(raw);
    if (input.add !== undefined) {
      if (items.length >= 40) fail(400, 'Use at most 40 checklist items.');
      items.push({ id: 'c' + Date.now().toString(36), title: text(input.add, 'Item', 120), owner: optional(input.owner, 30) || 'HR', done: false, doneBy: '', doneAt: '' });
    } else if (input.remove !== undefined) {
      const index = items.findIndex((item) => item.id === String(input.remove));
      if (index < 0) fail(404, 'That item was not found.');
      if (items[index].auto) fail(400, 'This item ticks itself and stays on the list.');
      items.splice(index, 1);
    } else {
      const item = items.find((entry) => entry.id === String(input.itemId || ''));
      if (!item) fail(404, 'That item was not found.');
      if (item.auto === 'interview' || item.auto === 'settlement') fail(400, 'This item ticks itself when that step is done.');
      item.done = input.done === true;
      item.doneBy = item.done ? session.name : '';
      item.doneAt = item.done ? todayInIndia() : '';
      if (item.auto?.startsWith('asset:') && item.done) {
        const assetId = item.auto.slice(6);
        await this.prisma.asset.updateMany({ where: { id: assetId, companyId: session.companyId, employeeId: row.employeeId }, data: { employeeId: null, status: 'stock', returnedOn: todayInIndia() } });
      }
    }
    await this.prisma.exitRequest.update({ where: { id }, data: { checklistJson: JSON.stringify(items) } });
    return this.detail(session, id, true);
  }

  async interview(session: SessionUser, id: string, raw: unknown) {
    const row = await this.prisma.exitRequest.findFirst({ where: { id, companyId: session.companyId } });
    if (!row || row.employeeId !== session.employeeId) fail(404, 'That exit was not found.');
    if (row.status !== 'accepted') fail(400, 'The exit interview opens once your resignation is accepted.');
    if (row.interviewJson) fail(409, 'You have already sent your exit interview. Thank you.');
    const input = bag(raw);
    const reasons = Array.isArray(input.reasons) ? input.reasons.map(String).filter((item) => EXIT_REASONS.includes(item)).slice(0, 5) : [];
    if (!reasons.length) fail(400, 'Choose at least one reason for leaving.');
    const ratings: Record<string, number> = {};
    const given = input.ratings && typeof input.ratings === 'object' ? input.ratings as Record<string, unknown> : {};
    for (const item of EXIT_RATINGS) {
      const value = Math.round(Number(given[item.key]) || 0);
      if (value < 1 || value > 5) fail(400, `Rate “${item.label}” from 1 to 5.`);
      ratings[item.key] = value;
    }
    const recommend = Math.round(Number(input.recommend));
    if (!Number.isFinite(recommend) || recommend < 0 || recommend > 10) fail(400, 'Choose how likely you are to recommend us, from 0 to 10.');
    const rejoin = ['yes', 'maybe', 'no'].includes(String(input.rejoin)) ? String(input.rejoin) : '';
    if (!rejoin) fail(400, 'Say whether you would come back.');
    const answers = { reasons, ratings, recommend, rejoin, liked: optional(input.liked, 1500), improve: optional(input.improve, 1500), at: todayInIndia() };
    await this.prisma.exitRequest.update({ where: { id }, data: { interviewJson: JSON.stringify(answers) } });
    await this.tick(session.companyId, id, 'interview', session.name);
    return this.detail(session, id, false);
  }

  async settle(session: SessionUser, id: string, raw: unknown) {
    await this.gates.gate(session, 'exits', 'You do not have access to the exits desk.');
    const row = await this.prisma.exitRequest.findFirst({ where: { id, companyId: session.companyId } });
    if (!row || row.status !== 'accepted') fail(404, 'Full and final opens once the exit is accepted.');
    const current = this.settlementOf(row.settlementJson);
    if (current?.status === 'final' && bag(raw).reopen !== true) fail(409, 'The settlement is final. Reopen it to change it.');
    const input = bag(raw);
    if (input.reopen === true) {
      await this.prisma.exitRequest.update({ where: { id }, data: { settlementJson: JSON.stringify({ ...current, status: 'draft' }), settledAt: null } });
      await this.untick(session.companyId, id, 'settlement');
      return this.detail(session, id, true);
    }
    if (!Array.isArray(input.lines) || !input.lines.length) fail(400, 'Add at least one line.');
    if (input.lines.length > 30) fail(400, 'Use at most 30 lines.');
    const lines: SettleLine[] = input.lines.map((value, index) => {
      const item = value && typeof value === 'object' ? value as Record<string, unknown> : {};
      const amount = Math.round(Number(String(item.amount ?? '').replace(/,/g, '')));
      if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) fail(400, `Line ${index + 1}: enter an amount in rupees.`);
      return {
        key: optional(item.key, 30) || 'line' + index,
        label: text(item.label, `Line ${index + 1}`, 80),
        side: item.side === 'deduction' ? 'deduction' : 'earning',
        amount,
        auto: item.auto === true,
        note: optional(item.note, 160),
      };
    });
    const final = input.final === true;
    const payDate = optional(input.payDate, 10);
    if (payDate && !/^\d{4}-\d{2}-\d{2}$/.test(payDate)) fail(400, 'Choose the payment date.');
    if (final && !payDate) fail(400, 'Choose the date the settlement is paid.');
    const settlement: Settlement = { lines, status: final ? 'final' : 'draft', payDate, note: optional(input.note, 400), by: session.name, at: todayInIndia() };
    await this.prisma.exitRequest.update({ where: { id }, data: { settlementJson: JSON.stringify(settlement), settledAt: final ? new Date() : null } });
    if (final) {
      await this.tick(session.companyId, id, 'settlement', session.name);
      const net = this.net(lines);
      await notifyPerson(this.prisma, session.companyId, row.employeeId, { kind: 'exit', title: 'Your full and final settlement is ready', body: `${net >= 0 ? 'Payable to you' : 'Recoverable'}: ${inr(Math.abs(net))}, on ${longDate(payDate)}.`, link: '/separation', ref: `exit:${id}:settle:${Date.now()}` });
    }
    await this.audit(session, final ? 'exit.settle' : 'exit.settle.draft', id, String(this.net(lines)));
    return this.detail(session, id, true);
  }

  /** Ends the employment: the person becomes Exited and their sign-in stops working. */
  async close(session: SessionUser, id: string) {
    await this.gates.gate(session, 'exits', 'You do not have access to the exits desk.');
    const row = await this.prisma.exitRequest.findFirst({ where: { id, companyId: session.companyId } });
    if (!row || row.status !== 'accepted') fail(404, 'Only an accepted exit can be closed.');
    if (row.closedAt) fail(409, 'This exit is already closed.');
    if (row.lastDay > todayInIndia()) fail(400, `Close the exit on or after the last working day, ${longDate(row.lastDay)}.`);
    const result = await closeEmployment(this.prisma, session.companyId, row.employeeId, row.lastDay, session.id);
    if (!result.closed && result.reason !== 'Already exited.') fail(400, result.reason);
    await this.prisma.exitRequest.update({ where: { id }, data: { closedAt: new Date() } });
    await this.audit(session, 'exit.close', id, row.lastDay);
    return this.detail(session, id, true);
  }

  async letter(session: SessionUser, id: string, kind: string): Promise<{ type: string; bytes: Buffer; name: string }> {
    const row = await this.prisma.exitRequest.findFirst({ where: { id, companyId: session.companyId }, include: { employee: { include: { designation: true, department: true } } } });
    if (!row) fail(404, 'That exit was not found.');
    const desk = await this.gates.holds(session, 'exits');
    if (!desk && row.employeeId !== session.employeeId) fail(403, 'You can download only your own letters.');
    if (row.status !== 'accepted') fail(400, 'Letters are ready once the exit is accepted.');
    const person = row.employee;
    const name = fullName(person);
    const role = person.designation?.name || 'Team member';
    const look = await letterLook(this.prisma, this.brand, session.companyId);
    const today = longDate(todayInIndia());
    const ref = `${person.code}/${row.lastDay.slice(0, 4)}`;
    const sign = { name: row.decidedBy || 'Human Resources', title: 'Human Resources' };
    const to = [name, `Employee code ${person.code}`, role];
    let bytes: Buffer;
    let file: string;
    if (kind === 'relieving' || kind === 'experience') {
      if (!desk && !row.closedAt && row.lastDay > todayInIndia()) fail(400, `Your letters open after your last working day, ${longDate(row.lastDay)}.`);
      const pronoun = person.gender === 'female' ? ['her', 'She'] : person.gender === 'male' ? ['his', 'He'] : ['their', 'They'];
      bytes = await letterPdf(kind === 'relieving'
        ? {
          title: 'Relieving letter',
          reference: ref,
          date: today,
          to,
          paragraphs: [
            `Dear ${person.firstName},`,
            `This is to confirm that your resignation has been accepted and you are relieved from your duties with ${look.legalName || look.company} at the close of business on ${longDate(row.lastDay)}.`,
            `You worked with us as ${role}${person.department ? ' in ' + person.department.name : ''} from ${longDate(person.dateOfJoining)} to ${longDate(row.lastDay)}.`,
            'We confirm that you have handed over your responsibilities and company property, and your dues will be settled as per the full and final settlement.',
            'We thank you for your contribution and wish you success in the future.',
          ],
          sign,
        }
        : {
          title: 'Experience letter',
          reference: ref,
          date: today,
          paragraphs: [
            'To whom it may concern,',
            `This is to certify that ${name} (employee code ${person.code}) worked with ${look.legalName || look.company} from ${longDate(person.dateOfJoining)} to ${longDate(row.lastDay)}.`,
            `At the time of leaving, ${pronoun[0]} designation was ${role}${person.department ? ' in the ' + person.department.name + ' department' : ''}.`,
            `During ${pronoun[0]} time with us we found ${name.split(' ')[0]} sincere and hardworking. ${pronoun[1]} leave${pronoun[1] === 'They' ? '' : 's'} with our good wishes.`,
          ],
          sign,
        }, look);
      file = `${kind}-letter-${person.code}.pdf`;
    } else if (kind === 'settlement') {
      const settlement = this.settlementOf(row.settlementJson);
      if (!settlement || (settlement.status !== 'final' && !desk)) fail(400, 'The settlement is not final yet.');
      const earnings = settlement.lines.filter((line) => line.side === 'earning');
      const deductions = settlement.lines.filter((line) => line.side === 'deduction');
      const net = this.net(settlement.lines);
      bytes = await letterPdf({
        title: 'Full and final settlement',
        reference: ref,
        date: today,
        to,
        paragraphs: [`Settlement of dues for ${name}, last working day ${longDate(row.lastDay)}${settlement.payDate ? ', paid on ' + longDate(settlement.payDate) : ''}.`],
        table: {
          head: ['Item', 'Amount'],
          rows: [
            { label: 'Payable', value: '', group: true },
            ...earnings.map((line) => ({ label: line.label, value: inr(line.amount) })),
            { label: 'Total payable', value: inr(earnings.reduce((sum, line) => sum + line.amount, 0)), strong: true },
            { label: 'Recoveries', value: '', group: true },
            ...deductions.map((line) => ({ label: line.label, value: inr(line.amount) })),
            { label: 'Total recoveries', value: inr(deductions.reduce((sum, line) => sum + line.amount, 0)), strong: true },
            { label: net >= 0 ? 'Net payable to the employee' : 'Net recoverable from the employee', value: inr(Math.abs(net)), strong: true },
          ],
        },
        after: [settlement.note, settlement.status === 'final' ? '' : 'DRAFT: this settlement is not final.'].filter(Boolean),
        sign: { name: settlement.by || sign.name, title: 'Payroll and HR' },
      }, look);
      file = `full-and-final-${person.code}.pdf`;
    } else {
      fail(404, 'That letter was not found.');
    }
    return { type: 'application/pdf', bytes, name: file };
  }

  private async detail(session: SessionUser, id: string, desk: boolean) {
    const row = await this.prisma.exitRequest.findFirst({ where: { id, companyId: session.companyId }, include: { employee: { include: { department: true, designation: true, manager: true } } } });
    if (!row) fail(404, 'That exit was not found.');
    const checklist = row.status === 'accepted' ? await this.ensureChecklist(session.companyId, id) : [];
    const settlement = this.settlementOf(row.settlementJson);
    const policy = await this.settings.policy(session.companyId);
    const served = daysBetween(row.createdAt.toISOString().slice(0, 10), row.lastDay);
    const today = todayInIndia();
    const lettersOpen = row.status === 'accepted' && (desk || !!row.closedAt || row.lastDay <= today);
    return {
      ...this.row(row),
      reason: row.reason,
      note: row.note,
      overrideNote: desk ? row.overrideNote : '',
      originalLastDay: row.originalLastDay,
      person: {
        id: row.employee.id,
        name: fullName(row.employee),
        code: row.employee.code,
        department: row.employee.department?.name || '',
        designation: row.employee.designation?.name || '',
        manager: row.employee.manager ? fullName(row.employee.manager) : '',
        joined: row.employee.dateOfJoining,
        status: row.employee.status,
      },
      notice: { required: policy.noticeDays, served: Math.max(0, served), shortfall: row.noticeWaived ? 0 : Math.max(0, policy.noticeDays - served), waived: row.noticeWaived },
      checklist,
      interview: row.interviewJson ? (desk || row.employeeId === session.employeeId ? JSON.parse(row.interviewJson) : { done: true }) : null,
      settlement: settlement && (desk || settlement.status === 'final') ? { ...settlement, net: this.net(settlement.lines) } : null,
      suggestion: desk && row.status === 'accepted' && (!settlement || settlement.status === 'draft') ? await this.suggest(session.companyId, row) : null,
      letters: lettersOpen ? ['relieving', 'experience', ...(settlement && (desk || settlement.status === 'final') ? ['settlement'] : [])] : [],
      canClose: desk && row.status === 'accepted' && !row.closedAt && row.lastDay <= today,
      desk,
    };
  }

  private row(row: { id: string; lastDay: string; status: string; initiatedBy: string; noticeWaived: boolean; checklistJson: string; interviewJson: string; settlementJson: string; closedAt: Date | null; createdAt: Date; employee: { id: string; firstName: string; lastName: string; code: string; department?: { name: string } | null; designation?: { name: string } | null } }) {
    let checks: CheckItem[] = [];
    try {
      checks = JSON.parse(row.checklistJson || '[]');
    } catch {
      checks = [];
    }
    const settlement = this.settlementOf(row.settlementJson);
    const stage = row.closedAt ? 'closed' : row.status === 'pending' ? 'pending' : row.status === 'accepted' ? 'accepted' : 'other';
    return {
      id: row.id,
      employeeId: row.employee.id,
      name: fullName(row.employee),
      code: row.employee.code,
      department: row.employee.department?.name || '',
      designation: row.employee.designation?.name || '',
      lastDay: row.lastDay,
      status: row.status,
      stage,
      initiatedBy: row.initiatedBy,
      waived: row.noticeWaived,
      checks: { done: checks.filter((item) => item.done).length, total: checks.length },
      interviewDone: !!row.interviewJson,
      settlement: settlement?.status || 'none',
      closed: !!row.closedAt,
      raisedOn: row.createdAt.toISOString().slice(0, 10),
    };
  }

  private async ensureChecklist(companyId: string, id: string): Promise<CheckItem[]> {
    const row = await this.prisma.exitRequest.findFirst({ where: { id, companyId } });
    if (!row) return [];
    let items: CheckItem[] = [];
    try {
      items = JSON.parse(row.checklistJson || '[]');
    } catch {
      items = [];
    }
    if (items.length) return items;
    const assets = await this.prisma.asset.findMany({ where: { companyId, employeeId: row.employeeId } });
    const base = (key: string, title: string, owner: string, auto?: string): CheckItem => ({ id: key, title, owner, done: false, doneBy: '', doneAt: '', ...(auto ? { auto } : {}) });
    items = [
      base('handover', 'Hand over work and documents to the manager', 'Manager'),
      ...assets.map((asset) => base('asset-' + asset.id, `Return ${asset.name}${asset.tag ? ' (' + asset.tag + ')' : ''}`, 'IT', 'asset:' + asset.id)),
      base('idcard', 'Return the ID card and access card', 'Admin'),
      base('access', 'Turn off email and system access', 'IT'),
      base('dues', 'Clear advances, loans and expense claims', 'Finance'),
      base('interview', 'Exit interview', 'Employee', 'interview'),
      base('settlement', 'Full and final settlement', 'Payroll', 'settlement'),
      base('letters', 'Hand over the relieving and experience letters', 'HR'),
    ];
    if (row.interviewJson) items = items.map((item) => item.auto === 'interview' ? { ...item, done: true, doneBy: 'Employee', doneAt: todayInIndia() } : item);
    await this.prisma.exitRequest.update({ where: { id }, data: { checklistJson: JSON.stringify(items) } });
    return items;
  }

  private async tick(companyId: string, id: string, auto: string, by: string) {
    const items = await this.ensureChecklist(companyId, id);
    const next = items.map((item) => item.auto === auto ? { ...item, done: true, doneBy: by, doneAt: todayInIndia() } : item);
    await this.prisma.exitRequest.update({ where: { id }, data: { checklistJson: JSON.stringify(next) } });
  }

  private async untick(companyId: string, id: string, auto: string) {
    const items = await this.ensureChecklist(companyId, id);
    const next = items.map((item) => item.auto === auto ? { ...item, done: false, doneBy: '', doneAt: '' } : item);
    await this.prisma.exitRequest.update({ where: { id }, data: { checklistJson: JSON.stringify(next) } });
  }

  /** A starting settlement from the CTC, leave balance and notice served. HR checks and edits every line. */
  private async suggest(companyId: string, row: { employeeId: string; lastDay: string; createdAt: Date; noticeWaived: boolean }): Promise<SettleLine[]> {
    const person = await this.prisma.employee.findFirst({ where: { id: row.employeeId, companyId } });
    const pay = await currentPay(this.prisma, companyId, row.employeeId, row.lastDay);
    const policy = await this.settings.policy(companyId);
    const lines: SettleLine[] = [];
    if (!pay || !person) return lines;
    const monthlyGross = pay.earnings / 12;
    const monthlyBasic = (pay.basic || pay.earnings * 0.5) / 12;
    const [y, m, d] = row.lastDay.split('-').map(Number);
    const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const month = row.lastDay.slice(0, 7);
    const slip = await this.prisma.paySlip.findFirst({ where: { companyId, employeeId: row.employeeId, month, published: true } });
    if (!slip) {
      const start = person.dateOfJoining.slice(0, 7) === month ? Number(person.dateOfJoining.slice(8, 10)) : 1;
      const days = Math.max(0, d - start + 1);
      lines.push({ key: 'salary', label: `Salary for ${days} day(s) of ${new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })}`, side: 'earning', amount: Math.round(monthlyGross / dim * days), auto: true, note: 'Monthly gross ÷ days in the month × days worked' });
    }
    const balances = await this.ledger.balances(companyId, row.employeeId, row.lastDay.slice(0, 4)).catch(() => []);
    const earned = balances.filter((item) => item.paid && item.limited && /earned|privilege|annual|\bel\b|\bpl\b/i.test(item.name + ' ' + item.code));
    const encash = earned.reduce((sum, item) => sum + Math.max(0, item.left), 0);
    if (encash > 0) lines.push({ key: 'encash', label: `Leave encashment, ${encash} day(s)`, side: 'earning', amount: Math.round(monthlyBasic / 30 * encash), auto: true, note: 'Monthly basic ÷ 30 × days left' });
    const years = daysBetween(person.dateOfJoining, row.lastDay) / 365.25;
    if (years >= 4.66) {
      const counted = Math.floor(years) + (years % 1 >= 0.5 ? 1 : 0);
      lines.push({ key: 'gratuity', label: `Gratuity, ${counted} year(s) of service`, side: 'earning', amount: Math.min(2_000_000, Math.round(monthlyBasic * 15 / 26 * counted)), auto: true, note: '15 ÷ 26 × last monthly basic × years, up to ₹20 lakh' });
    }
    const served = daysBetween(row.createdAt.toISOString().slice(0, 10), row.lastDay);
    const short = row.noticeWaived ? 0 : Math.max(0, policy.noticeDays - served);
    if (short > 0) lines.push({ key: 'notice', label: `Notice period shortfall, ${short} day(s)`, side: 'deduction', amount: Math.round(monthlyGross / 30 * short), auto: true, note: 'Monthly gross ÷ 30 × days short. Waive the notice to drop this.' });
    return lines;
  }

  private settlementOf(json: string): Settlement | null {
    if (!json) return null;
    try {
      return JSON.parse(json) as Settlement;
    } catch {
      return null;
    }
  }

  private net(lines: SettleLine[]): number {
    return lines.reduce((sum, line) => sum + (line.side === 'earning' ? line.amount : -line.amount), 0);
  }

  private day(value: unknown): string {
    const day = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(400, 'Choose the last working day.');
    if (day > shiftDay(todayInIndia(), 365)) fail(400, 'Choose a last working day within a year.');
    return day;
  }

  private async audit(session: SessionUser, action: string, entityId: string, detail: string): Promise<void> {
    await this.prisma.auditEvent.create({ data: { companyId: session.companyId, actorId: session.id, action, entity: 'exit', entityId, detail: detail.slice(0, 400) } }).catch(() => undefined);
  }
}
