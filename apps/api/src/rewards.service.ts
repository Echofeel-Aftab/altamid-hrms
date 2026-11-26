import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { BrandService } from './brand.service';
import { todayInIndia } from './dates';
import { FLEX_DEFAULT, FlexConfig } from './flex';
import { bag, fail, optional, text } from './http';
import { LeaveLedger } from './leave-ledger.service';
import { letterPdf } from './letter-pdf';
import { letterLook, longDate } from './letter-look';
import { LicenceService } from './licence.service';
import { ModuleConfigService } from './module-config.service';
import { currentPay, fullName, inr } from './people-kit';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { financialYear } from './tax';

export interface Benefit { key: string; label: string; hint: string; annual: number; kind: 'insurance' | 'wellness' | 'perk' | 'learning' | 'other' }
export interface RewardsConfig { benefits: Benefit[]; note: string }

const KINDS = ['insurance', 'wellness', 'perk', 'learning', 'other'] as const;
const DEFAULT: RewardsConfig = {
  note: '',
  benefits: [
    { key: 'health', label: 'Group health insurance', hint: 'Cover for you and your family', annual: 0, kind: 'insurance' },
    { key: 'term', label: 'Group term life insurance', hint: 'Life cover paid for by the company', annual: 0, kind: 'insurance' },
  ],
};

@Injectable()
export class RewardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
    private readonly config: ModuleConfigService,
    private readonly ledger: LeaveLedger,
    private readonly brand: BrandService,
    private readonly licence: LicenceService,
  ) {}

  async view(session: SessionUser, personInput = '') {
    await this.licence.assertFeature(session.companyId, 'pay.rewards');
    const desk = await this.gates.holds(session, 'pay.rewards');
    const employeeId = personInput && (desk || await this.gates.holds(session, 'pay')) ? personInput : session.employeeId || '';
    const config = await this.settings(session.companyId);
    const statement = employeeId ? await this.statement(session.companyId, employeeId, config) : null;
    const people = desk
      ? (await this.prisma.employee.findMany({ where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } }, orderBy: { firstName: 'asc' }, take: 1000 })).map((person) => ({ id: person.id, name: fullName(person), code: person.code }))
      : [];
    return { canDesk: desk, config, kinds: KINDS, statement, people };
  }

  async saveConfig(session: SessionUser, raw: unknown) {
    await this.gates.gate(session, 'pay.rewards', 'You do not have access to set up total rewards.');
    const input = bag(raw);
    if (!Array.isArray(input.benefits)) fail(400, 'Add the benefits.');
    if (input.benefits.length > 30) fail(400, 'Use at most 30 benefits.');
    const benefits: Benefit[] = input.benefits.map((item, index) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const label = text(row.label, `Benefit ${index + 1}`, 80);
      const annual = Math.round(Number(String(row.annual ?? '0').replace(/,/g, '')) || 0);
      if (annual < 0 || annual > 100_000_000) fail(400, `${label}: enter the yearly value in rupees.`);
      const kind = KINDS.includes(row.kind as Benefit['kind']) ? row.kind as Benefit['kind'] : 'other';
      return { key: optional(row.key, 30) || 'b' + index + Date.now().toString(36), label, hint: optional(row.hint, 160), annual, kind };
    });
    await this.config.write(session.companyId, 'rewards', { benefits, note: optional(input.note, 600) } satisfies RewardsConfig);
    return this.view(session);
  }

  async pdf(session: SessionUser, personInput = ''): Promise<{ type: string; bytes: Buffer; name: string }> {
    const view = await this.view(session, personInput);
    const statement = view.statement;
    if (!statement) fail(400, 'There is no statement to download.');
    const look = await letterLook(this.prisma, this.brand, session.companyId);
    const rows: Array<{ label: string; value: string; strong?: boolean; group?: boolean }> = [];
    for (const block of statement.blocks) {
      if (!block.lines.length) continue;
      rows.push({ label: block.label, value: inr(block.total), group: true });
      for (const line of block.lines as Array<{ label: string; amount: number; text?: string }>) rows.push({ label: '   ' + line.label, value: line.amount ? inr(line.amount) : line.text || 'Included' });
    }
    rows.push({ label: 'Total rewards for the year', value: inr(statement.total), strong: true });
    const bytes = await letterPdf({
      title: 'Total rewards statement',
      reference: `${statement.person.code}/FY${statement.year}`,
      date: longDate(todayInIndia()),
      to: [statement.person.name, `Employee code ${statement.person.code}`, statement.person.designation].filter(Boolean),
      paragraphs: [
        `Dear ${statement.person.name.split(' ')[0]},`,
        `Your pay is only part of what you receive. This statement brings together your salary, what the company contributes on your behalf, and the benefits you can use, for the financial year ${statement.year}.`,
      ],
      table: { head: ['What you receive', 'Yearly value'], rows },
      after: [statement.note, 'Benefit values are the company’s yearly cost per person and are shown for information. Your salary slips remain the record of what is paid.'].filter(Boolean),
    }, look);
    return { type: 'application/pdf', bytes, name: `total-rewards-${statement.person.code}-${statement.year}.pdf` };
  }

  private async statement(companyId: string, employeeId: string, config: RewardsConfig) {
    const person = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId }, include: { designation: true, department: true } });
    if (!person) fail(404, 'That person was not found.');
    const today = todayInIndia();
    const year = financialYear(today);
    const pay = await currentPay(this.prisma, companyId, employeeId, today);
    const all = await this.prisma.payStructure.findMany({ where: { companyId, employeeId, published: true }, orderBy: { effectiveFrom: 'asc' } });
    const flexConfig = await this.config.read<FlexConfig>(companyId, 'flex', FLEX_DEFAULT);
    const flex = await this.prisma.flexChoice.findUnique({ where: { companyId_employeeId_year: { companyId, employeeId, year } } });
    let flexLines: Array<{ label: string; amount: number }> = [];
    if (flex?.status === 'approved') {
      try {
        const values = JSON.parse(flex.choicesJson) as Record<string, number>;
        flexLines = (flexConfig.components || []).filter((item) => values[item.key]).map((item) => ({ label: item.label, amount: Math.round(values[item.key]) }));
      } catch {
        flexLines = [];
      }
    }
    const balances = await this.ledger.balances(companyId, employeeId, today.slice(0, 4)).catch(() => []);
    const paidLeave = balances.filter((item) => item.paid && item.limited).reduce((sum, item) => sum + item.entitled, 0);
    const dailyPay = pay ? pay.earnings / 365 : 0;
    const recognition = await this.prisma.recognition.count({ where: { companyId, toId: employeeId, createdAt: { gte: new Date(`${year.slice(0, 4)}-04-01T00:00:00+05:30`) } } });
    const cash = pay ? pay.lines.filter((line) => line.side === 'earning').map((line) => ({ label: line.name, amount: line.rupees })) : [];
    const employer = pay ? pay.lines.filter((line) => line.side === 'employer').map((line) => ({ label: line.name, amount: line.rupees })) : [];
    const benefits = config.benefits.map((item) => ({ label: item.label, amount: item.annual, text: item.annual ? '' : 'Included', hint: item.hint, kind: item.kind }));
    const time = paidLeave ? [{ label: `${paidLeave} days of paid leave`, amount: Math.round(paidLeave * dailyPay), text: '' }] : [];
    const blocks = [
      { key: 'cash', label: 'Cash pay', hint: 'Fixed pay in your CTC', lines: cash, total: cash.reduce((sum, line) => sum + line.amount, 0) },
      { key: 'company', label: 'Paid by the company for you', hint: 'Contributions on top of your cash pay, such as PF and gratuity', lines: employer, total: employer.reduce((sum, line) => sum + line.amount, 0) },
      { key: 'benefits', label: 'Benefits', hint: 'Insurance, wellness and perks', lines: benefits, total: benefits.reduce((sum, line) => sum + line.amount, 0) },
      { key: 'time', label: 'Paid time off', hint: 'The value of your paid leave this year', lines: time, total: time.reduce((sum, line) => sum + line.amount, 0) },
    ];
    const total = blocks.filter((block) => block.key !== 'time').reduce((sum, block) => sum + block.total, 0);
    const first = all[0];
    const firstCtc = first ? (JSON.parse(first.linesJson) as Array<{ side: string; paise: number }>).filter((line) => line.side !== 'deduction').reduce((sum, line) => sum + Math.round(line.paise / 100), 0) : 0;
    const ctc = pay ? pay.earnings + pay.employer : 0;
    return {
      year,
      person: { id: person.id, name: fullName(person), code: person.code, designation: person.designation?.name || '', department: person.department?.name || '', joined: person.dateOfJoining },
      ctc,
      effectiveFrom: pay?.effectiveFrom || '',
      blocks,
      total,
      flex: flexLines,
      recognition,
      growth: firstCtc && ctc && all.length > 1 ? { from: firstCtc, since: first.effectiveFrom, percent: Math.round((ctc - firstCtc) / firstCtc * 1000) / 10 } : null,
      note: config.note,
    };
  }

  private async settings(companyId: string): Promise<RewardsConfig> {
    const value = await this.config.read<RewardsConfig>(companyId, 'rewards', DEFAULT);
    return { note: value.note || '', benefits: Array.isArray(value.benefits) ? value.benefits : DEFAULT.benefits };
  }
}
