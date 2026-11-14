import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { todayInIndia } from './dates';
import { FLEX_DEFAULT, FlexComponent, FlexConfig, poolMatcher } from './flex';
import { bag, fail, optional, text } from './http';
import { ModuleConfigService } from './module-config.service';
import { currentPay, fullName, inr, notifyPerson } from './people-kit';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { financialYear, isYear } from './tax';

@Injectable()
export class FlexService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
    private readonly config: ModuleConfigService,
  ) {}

  async view(session: SessionUser, yearInput?: string, personInput = '') {
    const year = this.yearOf(yearInput);
    const desk = await this.gates.holds(session, 'pay.flex');
    const config = await this.settings(session.companyId);
    const employeeId = personInput && desk ? personInput : session.employeeId || '';
    const sheet = employeeId ? await this.sheet(session.companyId, employeeId, year, config) : null;
    let rows: Array<Record<string, unknown>> = [];
    if (desk) {
      const people = await this.prisma.employee.findMany({ where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } }, include: { department: true }, orderBy: { firstName: 'asc' }, take: 1000 });
      const choices = await this.prisma.flexChoice.findMany({ where: { companyId: session.companyId, year } });
      const match = poolMatcher(config);
      const today = todayInIndia();
      rows = [];
      for (const person of people) {
        const pay = await currentPay(this.prisma, session.companyId, person.id, today);
        const pool = pay ? pay.lines.filter((line) => line.side === 'earning' && match(line.name)).reduce((sum, line) => sum + line.rupees, 0) : 0;
        const choice = choices.find((row) => row.employeeId === person.id);
        const values = this.values(choice?.choicesJson);
        rows.push({
          employeeId: person.id,
          name: fullName(person),
          code: person.code,
          department: person.department?.name || '',
          pool,
          chosen: Object.values(values).reduce((sum, value) => sum + value, 0),
          status: choice?.status || 'none',
          note: choice?.note || '',
        });
      }
    }
    return { year, canDesk: desk, config, sheet, rows };
  }

  async choose(session: SessionUser, raw: unknown) {
    if (!session.employeeId) fail(400, 'This sign-in is not linked to a person.');
    const input = bag(raw);
    const year = this.yearOf(input.year);
    const config = await this.settings(session.companyId);
    const current = await this.prisma.flexChoice.findUnique({ where: { companyId_employeeId_year: { companyId: session.companyId, employeeId: session.employeeId, year } } });
    if (current?.status === 'approved') fail(409, 'Payroll has approved your split. Ask them to reopen it.');
    if (!config.open && current?.status !== 'returned') fail(423, 'Choice pay is closed right now.');
    const sheet = await this.sheet(session.companyId, session.employeeId, year, config);
    if (!sheet.pool) fail(400, 'Your CTC has no flexible part to split. Ask payroll.');
    const values = this.valuesOf(input.values, config.components);
    const chosen = Object.values(values).reduce((sum, value) => sum + value, 0);
    if (chosen > sheet.pool) fail(400, `You chose ${inr(chosen)}, which is more than your flexible pay of ${inr(sheet.pool)}.`);
    const submit = input.submit === true;
    const data = { choicesJson: JSON.stringify(values), status: submit ? 'submitted' : current?.status === 'returned' ? 'returned' : 'draft' };
    if (current) await this.prisma.flexChoice.update({ where: { id: current.id }, data });
    else await this.prisma.flexChoice.create({ data: { companyId: session.companyId, employeeId: session.employeeId, year, ...data } });
    return this.view(session, year);
  }

  async decide(session: SessionUser, raw: unknown) {
    await this.gates.gate(session, 'pay.flex', 'You do not have access to approve choice pay.');
    const input = bag(raw);
    const year = this.yearOf(input.year);
    const employeeId = text(input.employeeId, 'Person', 40);
    if (employeeId === session.employeeId) fail(403, 'Someone else approves your own split.');
    const row = await this.prisma.flexChoice.findUnique({ where: { companyId_employeeId_year: { companyId: session.companyId, employeeId, year } } });
    if (!row) fail(404, 'This person has not chosen a split.');
    const decision = String(input.decision || '');
    if (!['approved', 'returned'].includes(decision)) fail(400, 'Approve or send it back.');
    const note = optional(input.note, 300);
    if (decision === 'returned' && !note) fail(400, 'Say what needs to change.');
    await this.prisma.flexChoice.update({ where: { id: row.id }, data: { status: decision, note, decidedBy: session.name } });
    await notifyPerson(this.prisma, session.companyId, employeeId, {
      kind: 'flex',
      title: decision === 'approved' ? `Your choice pay for FY ${year} is approved` : `Your choice pay for FY ${year} needs a change`,
      body: note || 'It now shows on your total rewards and in the tax estimate.',
      link: '/choice-pay',
      ref: `flex:${row.id}:${decision}:${Date.now()}`,
    });
    return this.view(session, year);
  }

  async saveConfig(session: SessionUser, raw: unknown) {
    await this.gates.gate(session, 'pay.flex', 'You do not have access to set up choice pay.');
    const input = bag(raw);
    if (!Array.isArray(input.components)) fail(400, 'Add the components.');
    if (input.components.length > 20) fail(400, 'Use at most 20 components.');
    const seen = new Set<string>();
    const components: FlexComponent[] = input.components.map((item, index) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const label = text(row.label, `Component ${index + 1}`, 60);
      let key = optional(row.key, 30) || label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'item' + index;
      while (seen.has(key)) key += '-' + index;
      seen.add(key);
      const cap = Math.round(Number(String(row.cap ?? '').replace(/,/g, '')));
      if (!Number.isFinite(cap) || cap < 0 || cap > 10_000_000) fail(400, `${label}: enter a yearly limit in rupees.`);
      return { key, label, hint: optional(row.hint, 160), cap, taxFree: row.taxFree === true };
    });
    const value: FlexConfig = { open: input.open === true, pool: optional(input.pool, 200) || FLEX_DEFAULT.pool, note: optional(input.note, 400), components };
    await this.config.write(session.companyId, 'flex', value);
    return this.view(session);
  }

  private async sheet(companyId: string, employeeId: string, year: string, config: FlexConfig) {
    const pay = await currentPay(this.prisma, companyId, employeeId, todayInIndia());
    const match = poolMatcher(config);
    const lines = pay ? pay.lines.filter((line) => line.side === 'earning' && match(line.name)) : [];
    const pool = lines.reduce((sum, line) => sum + line.rupees, 0);
    const row = await this.prisma.flexChoice.findUnique({ where: { companyId_employeeId_year: { companyId, employeeId, year } } });
    const values = this.values(row?.choicesJson);
    const chosen = Object.values(values).reduce((sum, value) => sum + value, 0);
    const taxFree = config.components.filter((item) => item.taxFree).reduce((sum, item) => sum + Math.min(item.cap, values[item.key] || 0), 0);
    const person = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId } });
    return {
      person: person ? { id: person.id, name: fullName(person), code: person.code } : null,
      pool,
      poolLines: lines.map((line) => line.name),
      values,
      chosen,
      left: Math.max(0, pool - chosen),
      taxFree,
      status: row?.status || 'none',
      note: row?.note || '',
      decidedBy: row?.decidedBy || '',
    };
  }

  private async settings(companyId: string): Promise<FlexConfig> {
    const value = await this.config.read<FlexConfig>(companyId, 'flex', FLEX_DEFAULT);
    return { ...value, components: Array.isArray(value.components) ? value.components : FLEX_DEFAULT.components };
  }

  private valuesOf(value: unknown, components: FlexComponent[]): Record<string, number> {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const out: Record<string, number> = {};
    for (const item of components) {
      const amount = Math.round(Number(String(raw[item.key] ?? '0').replace(/,/g, '')) || 0);
      if (amount < 0) fail(400, `${item.label} cannot be negative.`);
      if (item.cap && amount > item.cap) fail(400, `${item.label} is limited to ${inr(item.cap)} a year.`);
      if (amount) out[item.key] = amount;
    }
    return out;
  }

  private values(json?: string): Record<string, number> {
    try {
      const parsed = JSON.parse(json || '{}') as Record<string, number>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private yearOf(value: unknown): string {
    const year = String(value || '').trim() || financialYear(todayInIndia());
    if (!isYear(year)) fail(400, 'Use a financial year such as 2026-27.');
    return year;
  }
}
