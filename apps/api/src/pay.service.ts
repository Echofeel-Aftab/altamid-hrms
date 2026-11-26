import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { dataKey, maskSecret, openSecret } from './crypto';
import { bag, fail, optional, text } from './http';
import { AccessService } from './access.service';
import { monthCounts, MonthCounts, monthEnd } from './attendance-math';
import { LicenceService } from './licence.service';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { SettingsService } from './settings.service';

interface PayLine {
  side: 'earning' | 'deduction' | 'employer';
  name: string;
  paise: number;
  show: boolean;
}

const LAYOUT_FLAGS = [
  'showCode', 'showDesignation', 'showDepartment', 'showLocation', 'showJoined',
  'showPaidDays', 'showLopDays', 'showPan', 'showBank', 'showEmployer', 'showNote',
] as const;

@Injectable()
export class PayService {
  private readonly key = dataKey();

  constructor(
    private readonly prisma: PrismaService,
    private readonly licence: LicenceService,
    private readonly gates: AccessService,
    private readonly settings: SettingsService,
  ) {}

  async layout(session: SessionUser) {
    await this.gates.gate(session, 'pay.slip', 'You do not have access to the salary slip.');
    return this.presentLayout(await this.readyLayout(session.companyId));
  }

  async saveLayout(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'pay.slip', 'You do not have access to the salary slip.');
    const input = bag(body);
    const data: Record<string, boolean> = {};
    for (const flag of LAYOUT_FLAGS) data[flag] = input[flag] === true || input[flag] === 'true';
    const current = await this.readyLayout(session.companyId);
    const saved = await this.prisma.payLayout.update({ where: { id: current.id }, data });
    return this.presentLayout(saved);
  }

  async mine(session: SessionUser) {
    await this.licence.assertFeature(session.companyId, 'pay');
    if (!session.employeeId) return { person: null, structure: null, slips: [], forms: [] };
    return this.forEmployee(session, session.employeeId);
  }

  async forEmployee(session: SessionUser, employeeId: string) {
    await this.licence.assertFeature(session.companyId, 'pay');
    const self = session.employeeId === employeeId;
    const desk = await this.gates.holds(session, 'pay') || await this.gates.holds(session, 'pay.structure') || await this.gates.holds(session, 'pay.slip') || await this.gates.holds(session, 'pay.form');
    if (!self && !desk) fail(403, 'You can open only your own pay.');
    const person = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: session.companyId } });
    if (!person) fail(404, 'That person was not found.');
    const [structures, slips, forms] = await Promise.all([
      this.prisma.payStructure.findMany({ where: { companyId: session.companyId, employeeId }, orderBy: { effectiveFrom: 'desc' } }),
      this.prisma.paySlip.findMany({ where: { companyId: session.companyId, employeeId }, orderBy: { month: 'desc' } }),
      this.prisma.taxForm.findMany({ where: { companyId: session.companyId, employeeId }, orderBy: { year: 'desc' } }),
    ]);
    const showDrafts = desk;
    const layout = await this.readyLayout(session.companyId);
    const visibleStructures = structures.filter((row) => showDrafts || row.published);
    const full = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId: session.companyId },
      include: { department: true, designation: true, location: true },
    });
    return {
      person: { id: person.id, name: `${person.firstName} ${person.lastName}`.trim(), code: person.code },
      layout: desk ? this.presentLayout(layout) : undefined,
      structure: visibleStructures[0] ? this.presentStructure(visibleStructures[0]) : null,
      slips: slips.filter((row) => showDrafts || row.published).map((row) => this.presentSlip(row, desk, layout, full)),
      forms: forms.filter((row) => showDrafts || row.published).map((row) => ({
        id: row.id,
        year: row.year,
        fileName: row.fileName,
        published: row.published,
      })),
    };
  }

  async saveStructure(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'pay.structure', 'You do not have access to enter CTC.');
    this.payOutlet(session);
    await this.licence.assertCanRunPayroll(session.companyId);
    const input = bag(body);
    const employeeId = await this.employeeId(session, input.employeeId);
    const effectiveFrom = text(input.effectiveFrom, 'Effective from', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) fail(400, 'Use a date for when this CTC starts.');
    const lines = this.linesOf(input.lines, ['earning', 'employer']);
    const published = input.published !== false;
    const current = await this.prisma.payStructure.findFirst({
      where: { companyId: session.companyId, employeeId, effectiveFrom },
    });
    const data = { published, linesJson: JSON.stringify(lines) };
    const saved = current
      ? await this.prisma.payStructure.update({ where: { id: current.id }, data })
      : await this.prisma.payStructure.create({ data: { companyId: session.companyId, employeeId, effectiveFrom, ...data } });
    await this.audit(session, 'pay.structure', saved.id, employeeId);
    return this.presentStructure(saved);
  }

  /** Percent-of-CTC line templates. They hold shares only; applying one never saves anything for a person. */
  async ctcTemplates(session: SessionUser) {
    await this.gates.gate(session, 'pay.structure', 'You do not have access to enter CTC.');
    return { templates: await this.settings.ctcTemplates(session.companyId) };
  }

  async saveCtcTemplate(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'pay.structure', 'You do not have access to enter CTC.');
    const input = bag(body);
    const name = text(input.name, 'Template name', 60);
    if (!Array.isArray(input.lines) || !input.lines.length) fail(400, 'Add at least one line to the template.');
    if (input.lines.length > 24) fail(400, 'Use at most 24 lines.');
    const lines = input.lines.map((item) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const side = String(row.side || '');
      if (side !== 'earning' && side !== 'employer') fail(400, 'Choose earning or employer contribution.');
      const percent = Math.round(Number(String(row.percent ?? '').replace(/,/g, '')) * 100) / 100;
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) fail(400, 'Each line is a percent of CTC, above 0 and up to 100.');
      return { side: side as 'earning' | 'employer', name: text(row.name, 'Line', 80), percent, show: row.show === undefined ? true : row.show === true || row.show === 'true' };
    });
    const total = lines.reduce((sum, line) => sum + line.percent, 0);
    if (total > 100.005) fail(400, 'The lines add up to ' + total.toFixed(2) + '%. Keep the total at 100% or less.');
    const current = await this.settings.ctcTemplates(session.companyId);
    const id = String(input.id || '').trim();
    const existing = id ? current.find((row) => row.id === id) : undefined;
    if (id && !existing) fail(404, 'That template was not found.');
    if (current.some((row) => row.id !== existing?.id && row.name.toLowerCase() === name.toLowerCase())) fail(409, 'A template with that name already exists.');
    if (!existing && current.length >= 12) fail(400, 'Keep to 12 templates or fewer. Remove one first.');
    const saved = { id: existing?.id || randomBytes(8).toString('hex'), name, lines };
    const next = existing ? current.map((row) => (row.id === saved.id ? saved : row)) : [...current, saved];
    await this.settings.saveCtcTemplates(session.companyId, next);
    await this.audit(session, 'pay.ctc-template', saved.id, name);
    return { templates: next };
  }

  async removeCtcTemplate(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'pay.structure', 'You do not have access to enter CTC.');
    const id = text(bag(body).id, 'Template', 40);
    const current = await this.settings.ctcTemplates(session.companyId);
    const next = current.filter((row) => row.id !== id);
    if (next.length === current.length) fail(404, 'That template was not found.');
    await this.settings.saveCtcTemplates(session.companyId, next);
    await this.audit(session, 'pay.ctc-template.remove', id, '');
    return { templates: next };
  }

  /** Works out the lines for an annual CTC. Nothing is saved; the editor still saves it through the CTC form. */
  async applyCtcTemplate(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'pay.structure', 'You do not have access to enter CTC.');
    const input = bag(body);
    const template = (await this.settings.ctcTemplates(session.companyId)).find((row) => row.id === String(input.templateId || ''));
    if (!template) fail(404, 'That template was not found.');
    const total = this.paiseOf(input.annualCtc);
    if (total <= 0) fail(400, 'Enter the annual CTC in rupees.');
    const paise = template.lines.map((line) => Math.round((total * line.percent) / 100));
    const percent = template.lines.reduce((sum, line) => sum + line.percent, 0);
    // A template that adds to 100% must add back to the CTC to the paisa, so the rounding goes on the biggest line.
    if (Math.abs(percent - 100) < 0.005) {
      const big = paise.indexOf(Math.max(...paise));
      paise[big] += total - paise.reduce((sum, value) => sum + value, 0);
    }
    return {
      annual: this.rupees(paise.reduce((sum, value) => sum + value, 0)),
      percent: Math.round(percent * 100) / 100,
      lines: template.lines.map((line, index) => ({ side: line.side, name: line.name, show: line.show, rupees: (paise[index] / 100).toFixed(2) })),
    };
  }

  async saveSlip(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'pay.slip', 'You do not have access to the salary slip.');
    this.payOutlet(session);
    await this.licence.assertCanRunPayroll(session.companyId);
    const input = bag(body);
    const employeeId = await this.employeeId(session, input.employeeId);
    const month = text(input.month, 'Month', 7);
    if (!/^\d{4}-\d{2}$/.test(month)) fail(400, 'Choose the salary month.');
    await this.assertOpen(session.companyId, month);
    const lines = this.linesOf(input.lines, ['earning', 'deduction', 'employer']);
    const published = input.published !== false;
    const note = optional(input.note, 240);
    const paidDays = this.daysOf(input.paidDays, 'Paid days');
    const lopDays = this.daysOf(input.lopDays, 'Loss of pay days');
    const before = await this.prisma.paySlip.findUnique({ where: { companyId_employeeId_month: { companyId: session.companyId, employeeId, month } } });
    const saved = await this.prisma.paySlip.upsert({
      where: { companyId_employeeId_month: { companyId: session.companyId, employeeId, month } },
      create: { companyId: session.companyId, employeeId, month, published, note, paidDays, lopDays, linesJson: JSON.stringify(lines) },
      update: { published, note, paidDays, lopDays, linesJson: JSON.stringify(lines) },
    });
    await this.audit(session, 'pay.slip', saved.id, month);
    const layout = await this.readyLayout(session.companyId);
    const full = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId: session.companyId },
      include: { department: true, designation: true, location: true },
    });
    const slip = this.presentSlip(saved, true, layout, full);
    if (saved.published && !before?.published && full?.email) {
      void this.settings.sendTemplate(session.companyId, 'payslip', [full.email], { name: full.firstName, month: slip.label, net: slip.net }).catch(() => undefined);
    }
    return slip;
  }

  async saveForm(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'pay.form', 'You do not have access to Form 16.');
    this.payOutlet(session);
    await this.licence.assertCanRunPayroll(session.companyId);
    const input = bag(body);
    const employeeId = await this.employeeId(session, input.employeeId);
    const year = text(input.year, 'Financial year', 7);
    if (!/^\d{4}-\d{2}$/.test(year)) fail(400, 'Use a financial year such as 2025-26.');
    const start = Number(year.slice(0, 4));
    if (Number(year.slice(5)) !== (start + 1) % 100) fail(400, 'Use a financial year such as 2025-26.');
    const parsed = this.pdfOf(String(input.data || ''), String(input.fileName || 'form16.pdf'));
    const published = input.published !== false;
    const saved = await this.prisma.taxForm.upsert({
      where: { companyId_employeeId_year: { companyId: session.companyId, employeeId, year } },
      create: { companyId: session.companyId, employeeId, year, fileName: parsed.name, published },
      update: { fileName: parsed.name, published },
    });
    const dir = join(process.cwd(), 'storage', 'pay', session.companyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, saved.id + '.pdf'), parsed.bytes);
    await this.audit(session, 'pay.form16', saved.id, year);
    return { id: saved.id, year: saved.year, published: saved.published };
  }

  async removeForm(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'pay.form', 'You do not have access to Form 16.');
    this.payOutlet(session);
    await this.licence.assertCanRunPayroll(session.companyId);
    const id = text(bag(body).id, 'Form 16', 40);
    const current = await this.prisma.taxForm.findFirst({ where: { id, companyId: session.companyId } });
    if (!current) fail(404, 'That Form 16 was not found.');
    await this.prisma.taxForm.delete({ where: { id } });
    const path = join(process.cwd(), 'storage', 'pay', session.companyId, id + '.pdf');
    if (existsSync(path)) unlinkSync(path);
    return { ok: true };
  }

  async formFile(session: SessionUser, id: string): Promise<{ type: string; bytes: Buffer; name: string } | null> {
    const row = await this.prisma.taxForm.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) return null;
    const self = session.employeeId === row.employeeId;
    const desk = await this.gates.holds(session, 'pay') || await this.gates.holds(session, 'pay.form');
    if (!self && !desk) return null;
    if (!row.published && !desk) return null;
    try {
      const bytes = readFileSync(join(process.cwd(), 'storage', 'pay', session.companyId, row.id + '.pdf'));
      return { type: 'application/pdf', bytes, name: row.fileName || 'form16.pdf' };
    } catch {
      return null;
    }
  }

  /** The month at a glance: who has a CTC, who has a slip, and paid and loss of pay days counted from attendance. */
  async month(session: SessionUser, month: string) {
    await this.requirePayroll(session);
    const value = this.monthOf(month);
    const { people, counts, finished } = await this.monthPeople(session.companyId, value);
    const start = value + '-01';
    const end = monthEnd(value);
    const [structures, slips, lock, holidays, holidayWork, policy] = await Promise.all([
      this.prisma.payStructure.findMany({ where: { companyId: session.companyId, employeeId: { in: people.map((row) => row.id) }, effectiveFrom: { lte: monthEnd(value) } }, orderBy: { effectiveFrom: 'desc' } }),
      this.prisma.paySlip.findMany({ where: { companyId: session.companyId, month: value } }),
      this.prisma.payMonth.findFirst({ where: { companyId: session.companyId, month: value } }),
      this.prisma.holiday.findMany({ where: { companyId: session.companyId, day: { gte: start, lte: end } }, select: { day: true } }),
      this.prisma.attendanceRequest.findMany({
        where: {
          companyId: session.companyId,
          kind: 'extratime',
          status: 'approved',
          day: { gte: start, lte: end },
          employeeId: { in: people.map((row) => row.id) },
        },
        select: { employeeId: true, day: true, hours: true },
      }),
      this.settings.policy(session.companyId),
    ]);
    const holidayDays = new Set(holidays.map((row) => row.day));
    const holidayByPerson = new Map<string, number>();
    for (const row of holidayWork) {
      if (!holidayDays.has(row.day)) continue;
      holidayByPerson.set(row.employeeId, (holidayByPerson.get(row.employeeId) || 0) + 1);
    }
    const accounts = await this.settings.salaryAccounts(session.companyId);
    const multiplier = policy.holidayWorkPayMultiplier || 1;
    const rows = people.map((person) => {
      const structure = structures.find((row) => row.employeeId === person.id);
      const slip = slips.find((row) => row.employeeId === person.id);
      const days = this.suggestDays(counts.get(person.id));
      const lines = slip ? this.readLines(slip.linesJson) : [];
      const gross = lines.filter((line) => line.side === 'earning').reduce((sum, line) => sum + line.paise, 0);
      const deductions = lines.filter((line) => line.side === 'deduction').reduce((sum, line) => sum + line.paise, 0);
      const holidayWorkDays = holidayByPerson.get(person.id) || 0;
      return {
        employeeId: person.id,
        code: person.code,
        name: `${person.firstName} ${person.lastName}`.trim(),
        department: person.department?.name || '',
        status: person.status,
        ctc: structure ? this.rupees(this.readLines(structure.linesJson).filter((line) => line.side !== 'deduction').reduce((sum, line) => sum + line.paise, 0)) : '',
        slip: slip ? { id: slip.id, published: slip.published, paidDays: slip.paidDays, lopDays: slip.lopDays, gross: this.rupees(gross), net: this.rupees(gross - deductions) } : null,
        suggested: days,
        holidayWork: holidayWorkDays
          ? {
              days: holidayWorkDays,
              multiplier,
              hint: `Holiday work ×${multiplier} — add an earning line for ${holidayWorkDays} day(s)`,
            }
          : null,
        bankReady: Boolean(openSecret(person.bankEnc, this.key) && openSecret(person.ifscEnc, this.key)),
        payFrom: this.payerOf(accounts, person.locationId)?.id || '',
      };
    });
    return {
      month: value,
      label: this.monthLabel(value),
      finished,
      holidayPayMultiplier: multiplier,
      locked: lock ? { at: lock.lockedAt.toISOString(), by: lock.lockedBy } : null,
      rows,
      accounts: accounts.map((row) => ({
        id: row.id,
        label: row.label,
        bank: row.bank,
        mask: maskSecret(row.account),
        isDefault: row.isDefault,
        published: rows.filter((item) => item.payFrom === row.id && item.slip?.published).length,
      })),
      totals: {
        people: rows.length,
        withCtc: rows.filter((row) => row.ctc).length,
        slips: rows.filter((row) => row.slip).length,
        published: rows.filter((row) => row.slip?.published).length,
        drafts: rows.filter((row) => row.slip && !row.slip.published).length,
      },
    };
  }

  /** Paid and loss of pay days for one person, counted from attendance and unpaid leave. */
  async days(session: SessionUser, employeeId: string, month: string) {
    await this.gates.gate(session, 'pay.slip', 'You do not have access to the salary slip.');
    const value = this.monthOf(month);
    const { counts, people, finished } = await this.monthPeople(session.companyId, value, employeeId);
    if (!people.length) fail(404, 'That person was not employed in that month.');
    return { ...this.suggestDays(counts.get(employeeId)), finished };
  }

  /** Creates draft slips from each person's CTC. Amounts are the CTC lines divided by 12; nothing statutory is calculated. */
  async startMonth(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'pay.slip', 'You do not have access to the salary slip.');
    this.payOutlet(session);
    await this.licence.assertCanRunPayroll(session.companyId);
    const input = bag(body);
    const value = this.monthOf(input.month);
    await this.assertOpen(session.companyId, value);
    const wanted = Array.isArray(input.employeeIds) ? new Set(input.employeeIds.map(String)) : null;
    const { people, counts } = await this.monthPeople(session.companyId, value);
    const existing = new Set((await this.prisma.paySlip.findMany({ where: { companyId: session.companyId, month: value }, select: { employeeId: true } })).map((row) => row.employeeId));
    const structures = await this.prisma.payStructure.findMany({ where: { companyId: session.companyId, effectiveFrom: { lte: monthEnd(value) } }, orderBy: { effectiveFrom: 'desc' } });
    let created = 0;
    let noCtc = 0;
    for (const person of people) {
      if (existing.has(person.id) || (wanted && !wanted.has(person.id))) continue;
      const structure = structures.find((row) => row.employeeId === person.id);
      if (!structure) {
        noCtc++;
        continue;
      }
      const lines = this.readLines(structure.linesJson)
        .filter((line) => line.side !== 'deduction')
        .map((line) => ({ ...line, paise: Math.round(line.paise / 12) }));
      const days = this.suggestDays(counts.get(person.id));
      await this.prisma.paySlip.create({
        data: { companyId: session.companyId, employeeId: person.id, month: value, published: false, note: '', paidDays: days.paidDays, lopDays: days.lopDays, linesJson: JSON.stringify(lines) },
      });
      created++;
    }
    await this.audit(session, 'pay.month.start', value, `${created} draft slip(s)`);
    return { created, noCtc, skipped: existing.size, month: await this.month(session, value) };
  }

  async publishMonth(session: SessionUser, body: unknown) {
    await this.requirePayroll(session);
    this.payOutlet(session);
    await this.licence.assertCanRunPayroll(session.companyId);
    const value = this.monthOf(bag(body).month);
    await this.assertOpen(session.companyId, value);
    const drafts = await this.prisma.paySlip.findMany({ where: { companyId: session.companyId, month: value, published: false } });
    const layout = await this.readyLayout(session.companyId);
    let emailed = 0;
    for (const draft of drafts) {
      const saved = await this.prisma.paySlip.update({ where: { id: draft.id }, data: { published: true } });
      const person = await this.prisma.employee.findFirst({ where: { id: saved.employeeId, companyId: session.companyId }, include: { department: true, designation: true, location: true } });
      if (person?.email) {
        const slip = this.presentSlip(saved, true, layout, person);
        const sent = await this.settings.sendTemplate(session.companyId, 'payslip', [person.email], { name: person.firstName, month: slip.label, net: slip.net }).catch(() => ({ emailed: false }));
        if (sent.emailed) emailed++;
      }
    }
    await this.audit(session, 'pay.month.publish', value, `${drafts.length} slip(s)`);
    return { published: drafts.length, emailed, month: await this.month(session, value) };
  }

  async lockMonth(session: SessionUser, body: unknown) {
    await this.requirePayroll(session);
    const input = bag(body);
    const value = this.monthOf(input.month);
    if (input.locked === false) {
      await this.prisma.payMonth.deleteMany({ where: { companyId: session.companyId, month: value } });
      await this.audit(session, 'pay.month.reopen', value, optional(input.reason, 200));
    } else {
      const drafts = await this.prisma.paySlip.count({ where: { companyId: session.companyId, month: value, published: false } });
      if (drafts) fail(400, `Publish or remove the ${drafts} draft slip(s) before locking the month.`);
      if (!(await this.prisma.payMonth.findFirst({ where: { companyId: session.companyId, month: value } }))) {
        await this.prisma.payMonth.create({ data: { companyId: session.companyId, month: value, lockedBy: session.name } });
      }
      await this.audit(session, 'pay.month.lock', value, '');
    }
    return this.month(session, value);
  }

  /** A bank upload sheet built from published slips: account, IFSC and the net pay payroll entered. */
  async bankFile(session: SessionUser, month: string, accountId = ''): Promise<{ name: string; csv: string }> {
    await this.requirePayroll(session);
    const value = this.monthOf(month);
    const published = await this.prisma.paySlip.findMany({ where: { companyId: session.companyId, month: value, published: true } });
    if (!published.length) fail(400, 'Publish the month’s slips before making the bank file.');
    const people = await this.prisma.employee.findMany({ where: { companyId: session.companyId, id: { in: published.map((row) => row.employeeId) } } });
    const accounts = await this.settings.salaryAccounts(session.companyId);
    const debit = accountId ? accounts.find((row) => row.id === accountId) : accounts.find((row) => row.isDefault);
    if (accountId && !debit) fail(404, 'That salary account is switched off or was removed. Choose another in Settings → General → Salary accounts.');
    const slips = debit
      ? published.filter((slip) => this.payerOf(accounts, people.find((row) => row.id === slip.employeeId)?.locationId)?.id === debit.id)
      : published;
    if (!slips.length) fail(400, 'Nobody with a published slip is paid from ' + debit?.label + ' this month.');
    const company = await this.prisma.company.findUnique({ where: { id: session.companyId }, select: { name: true } });
    const cell = (text: string) => {
      const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
      return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const options = await this.settings.bankFileOptions(session.companyId);
    const [year, monthNumber] = value.split('-').map(Number);
    const shortMonth = new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    const narration = options.narration.replace(/\{month\}/g, shortMonth).slice(0, 30);
    const ownBank = ((debit?.ifsc || '').slice(0, 4) || options.prefix).toUpperCase();
    const lines = [['Employee code', 'Beneficiary name', 'Account number', 'IFSC', 'Amount', 'Payment mode', 'Debit account', 'Client code', 'Narration', 'Email', 'Note'].join(',')];
    let missing = 0;
    for (const slip of slips) {
      const person = people.find((row) => row.id === slip.employeeId);
      if (!person) continue;
      const items = this.readLines(slip.linesJson);
      const net = items.filter((line) => line.side === 'earning').reduce((sum, line) => sum + line.paise, 0) - items.filter((line) => line.side === 'deduction').reduce((sum, line) => sum + line.paise, 0);
      const account = openSecret(person.bankEnc, this.key);
      const ifsc = openSecret(person.ifscEnc, this.key);
      if (!account || !ifsc) missing++;
      const sameBank = Boolean(ownBank && ifsc && ifsc.slice(0, 4).toUpperCase() === ownBank);
      const mode = options.mode === 'auto' ? (sameBank ? 'IFT' : net >= 20000000 ? 'RTGS' : 'NEFT') : options.mode;
      const notes = [
        !account || !ifsc ? 'Bank details missing' : '',
        net <= 0 ? 'Net pay is zero or less' : '',
        mode === 'IMPS' && net > 50000000 ? 'Above the ₹5 lakh IMPS limit' : '',
        mode === 'RTGS' && net > 0 && net < 20000000 ? 'Below the ₹2 lakh RTGS minimum' : '',
      ].filter(Boolean);
      lines.push([
        cell(person.code),
        cell(`${person.firstName} ${person.lastName}`.trim()),
        cell(account),
        cell(ifsc),
        (net / 100).toFixed(2),
        mode,
        cell(debit?.account || ''),
        cell(options.clientCode),
        cell(narration),
        cell(person.email),
        cell(notes.join('; ')),
      ].join(','));
    }
    await this.audit(session, 'pay.bankfile', value, `${slips.length} row(s), ${missing} missing bank details${debit ? ', from ' + debit.label : ''}`);
    const slugOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const suffix = debit && accounts.length > 1 ? '-' + slugOf(debit.label) : '';
    return { name: `${slugOf(company?.name || 'company')}-salary-${value}${suffix}.csv`, csv: '\uFEFF' + lines.join('\r\n') };
  }

  /** The account that pays a person: the one tied to their location, otherwise the default. */
  private payerOf<T extends { isDefault: boolean; locationIds: string[] }>(accounts: T[], locationId: string | null | undefined): T | undefined {
    return (locationId ? accounts.find((row) => row.locationIds.includes(locationId)) : undefined) || accounts.find((row) => row.isDefault);
  }

  private async monthPeople(companyId: string, month: string, employeeId?: string) {
    const start = month + '-01';
    const end = monthEnd(month);
    const people = await this.prisma.employee.findMany({
      where: { companyId, dateOfJoining: { lte: end }, OR: [{ dateOfExit: '' }, { dateOfExit: { gte: start } }], ...(employeeId ? { id: employeeId } : {}) },
      include: { department: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const rules = await this.settings.timeRules(companyId);
    const { counts, finished } = await monthCounts(this.prisma, rules, companyId, month, people);
    return { people, counts, finished };
  }

  /**
   * Paid days are calendar days employed less loss of pay; loss of pay is absent days plus approved unpaid leave.
   * With no punch, leave or on-duty record at all in the month nothing is suggested, so a company that does not
   * track attendance never gets every slip cut to zero.
   */
  private suggestDays(counts: MonthCounts | undefined): { paidDays: string; lopDays: string; absent: number; unpaid: number; employed: number; tracked: boolean } {
    if (!counts) return { paidDays: '', lopDays: '', absent: 0, unpaid: 0, employed: 0, tracked: false };
    const tracked = counts.present + counts.onduty + counts.leave > 0;
    if (!tracked) return { paidDays: '', lopDays: '', absent: counts.absent, unpaid: counts.unpaid, employed: counts.employed, tracked };
    const lop = Math.min(counts.employed, counts.absent + counts.unpaid);
    const fmt = (value: number) => String(Math.round(value * 10) / 10);
    return { paidDays: fmt(counts.employed - lop), lopDays: fmt(lop), absent: counts.absent, unpaid: counts.unpaid, employed: counts.employed, tracked };
  }

  private async assertOpen(companyId: string, month: string): Promise<void> {
    const lock = await this.prisma.payMonth.findFirst({ where: { companyId, month } });
    if (lock) fail(423, `${this.monthLabel(month)} is locked. Reopen it in Payroll to change slips.`);
  }

  private monthOf(value: unknown): string {
    const month = String(value ?? '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(400, 'Choose the salary month.');
    return month;
  }

  private monthLabel(month: string): string {
    const [year, value] = month.split('-').map(Number);
    return new Date(Date.UTC(year, value - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  private async requirePayroll(session: SessionUser): Promise<void> {
    await this.gates.gate(session, 'pay', 'You do not have access to publish pay.');
    this.payOutlet(session);
  }

  private payOutlet(session: SessionUser): void {
    if (session.outletId === null && (session.outletIds?.length || 0) > 1) fail(400, 'Each outlet runs its own payroll. Choose an outlet at the top of the screen first.');
    if (session.outletCountry && session.outletCountry !== 'IN') fail(403, 'Payroll runs only for outlets in India. This outlet uses the HR features without payroll.');
  }

  private async employeeId(session: SessionUser, value: unknown): Promise<string> {
    const id = text(value, 'Person', 40);
    const person = await this.prisma.employee.findFirst({ where: { id, companyId: session.companyId } });
    if (!person) fail(404, 'That person was not found.');
    return person.id;
  }

  private linesOf(value: unknown, allowed: PayLine['side'][]): PayLine[] {
    if (!Array.isArray(value) || !value.length) fail(400, 'Add at least one pay line.');
    if (value.length > 24) fail(400, 'Use at most 24 lines.');
    return value.map((item) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const side = String(row.side || '');
      if (!allowed.includes(side as PayLine['side'])) fail(400, 'Choose earning, deduction, or employer contribution.');
      const name = text(row.name, 'Line', 80);
      const show = row.show === undefined ? true : row.show === true || row.show === 'true';
      return { side: side as PayLine['side'], name, paise: this.paiseOf(row.rupees), show };
    });
  }

  private daysOf(value: unknown, label: string): string {
    const cleaned = optional(value, 5);
    if (!cleaned) return '';
    if (!/^\d{1,2}(\.\d)?$/.test(cleaned) || Number(cleaned) > 31) fail(400, `${label} must be a number of days, up to 31.`);
    return cleaned;
  }

  private paiseOf(value: unknown): number {
    const raw = String(value ?? '').trim().replace(/,/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) fail(400, 'Enter an amount in rupees, with at most two decimal places.');
    const paise = Math.round(Number(raw) * 100);
    if (paise > 10_000_000_000) fail(400, 'That amount is too large.');
    return paise;
  }

  private presentStructure(row: { id: string; effectiveFrom: string; published: boolean; linesJson: string }) {
    const lines = this.readLines(row.linesJson);
    const annual = lines.filter((line) => line.side !== 'deduction').reduce((sum, line) => sum + line.paise, 0);
    return {
      id: row.id,
      effectiveFrom: row.effectiveFrom,
      published: row.published,
      annual: this.rupees(annual),
      lines: lines.map((line) => ({ side: line.side, name: line.name, show: line.show !== false, amount: this.rupees(line.paise), rupees: (line.paise / 100).toFixed(2) })),
    };
  }

  private presentSlip(
    row: { id: string; month: string; published: boolean; note: string; paidDays: string; lopDays: string; linesJson: string },
    desk: boolean,
    layout: { showCode: boolean; showDesignation: boolean; showDepartment: boolean; showLocation: boolean; showJoined: boolean; showPaidDays: boolean; showLopDays: boolean; showPan: boolean; showBank: boolean; showEmployer: boolean; showNote: boolean },
    person: { code: string; dateOfJoining: string; panEnc: string; bankEnc: string; department: { name: string } | null; designation: { name: string } | null; location: { name: string } | null } | null,
  ) {
    const lines = this.readLines(row.linesJson);
    const earnings = lines.filter((line) => line.side === 'earning').reduce((sum, line) => sum + line.paise, 0);
    const deductions = lines.filter((line) => line.side === 'deduction').reduce((sum, line) => sum + line.paise, 0);
    const visible = lines.filter((line) => line.show !== false && (layout.showEmployer || line.side !== 'employer'));
    const [year, month] = row.month.split('-').map(Number);
    const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const shown = desk ? lines : visible;
    return {
      id: row.id,
      month: row.month,
      label,
      published: row.published,
      note: desk || layout.showNote ? row.note : '',
      paidDays: row.paidDays,
      lopDays: row.lopDays,
      net: this.rupees(earnings - deductions),
      hidden: desk ? lines.length - visible.length : 0,
      facts: this.facts(layout, person, row.paidDays, row.lopDays),
      lines: shown.map((line) => ({ side: line.side, name: line.name, show: line.show !== false, amount: this.rupees(line.paise), rupees: (line.paise / 100).toFixed(2) })),
    };
  }

  private facts(
    layout: { showCode: boolean; showDesignation: boolean; showDepartment: boolean; showLocation: boolean; showJoined: boolean; showPaidDays: boolean; showLopDays: boolean; showPan: boolean; showBank: boolean },
    person: { code: string; dateOfJoining: string; panEnc: string; bankEnc: string; department: { name: string } | null; designation: { name: string } | null; location: { name: string } | null } | null,
    paidDays: string,
    lopDays: string,
  ): Array<{ label: string; value: string }> {
    if (!person) return [];
    const rows: Array<{ label: string; value: string }> = [];
    const add = (on: boolean, label: string, value: string) => { if (on && value) rows.push({ label, value }); };
    add(layout.showCode, 'Employee code', person.code);
    add(layout.showDesignation, 'Designation', person.designation?.name || '');
    add(layout.showDepartment, 'Department', person.department?.name || '');
    add(layout.showLocation, 'Workplace', person.location?.name || '');
    add(layout.showJoined, 'Date of joining', person.dateOfJoining);
    add(layout.showPaidDays, 'Paid days', paidDays);
    add(layout.showLopDays, 'Loss of pay', lopDays);
    add(layout.showPan, 'PAN', maskSecret(openSecret(person.panEnc, this.key)));
    add(layout.showBank, 'Bank account', maskSecret(openSecret(person.bankEnc, this.key)));
    return rows;
  }

  private presentLayout(row: { [key: string]: boolean | string }) {
    const flags: Record<string, boolean> = {};
    for (const flag of LAYOUT_FLAGS) flags[flag] = row[flag] !== false;
    return flags;
  }

  private async readyLayout(companyId: string) {
    const found = await this.prisma.payLayout.findUnique({ where: { companyId } });
    if (found) return found;
    return this.prisma.payLayout.create({ data: { companyId } });
  }

  private readLines(raw: string): PayLine[] {
    try {
      const parsed = JSON.parse(raw) as PayLine[];
      return Array.isArray(parsed) ? parsed.map((line) => ({ ...line, show: line.show !== false })) : [];
    } catch {
      return [];
    }
  }

  private rupees(paise: number): string {
    const sign = paise < 0 ? '-' : '';
    const abs = Math.abs(Math.trunc(paise));
    const whole = Math.floor(abs / 100).toLocaleString('en-IN');
    const fraction = String(abs % 100).padStart(2, '0');
    return `${sign}₹${whole}.${fraction}`;
  }

  private pdfOf(data: string, name: string): { name: string; bytes: Buffer } {
    const match = /^data:application\/pdf;base64,([A-Za-z0-9+/=\s]+)$/.exec(data.trim());
    if (!match) fail(400, 'Choose a PDF.');
    const bytes = Buffer.from(match[1].replace(/\s/g, ''), 'base64');
    if (bytes.length < 32 || bytes.length > 8_000_000) fail(400, 'The PDF must be under 8 MB.');
    const clean = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
    return { name: clean.toLowerCase().endsWith('.pdf') ? clean : (clean || 'form16') + '.pdf', bytes };
  }

  private async audit(session: SessionUser, action: string, entityId: string, detail: string): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { companyId: session.companyId, actorId: session.id, action, entity: 'pay', entityId, detail },
    });
  }
}
