import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { todayInIndia } from './dates';
import { FLEX_DEFAULT, FlexConfig } from './flex';
import { bag, fail, optional, text } from './http';
import { ModuleConfigService } from './module-config.service';
import { ageOn, currentPay, fullName, inr, notifyPerson, uploadOf } from './people-kit';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { computeTax, financialYear, isYear, RegimeResult, TAX_ITEMS, TaxInput, yearRange } from './tax';

export interface TaxWindow { declare: boolean; proofs: boolean; note: string; closesOn: string }
export interface Stored { values: Record<string, number>; approved: Record<string, number>; parentsSenior: boolean }
export interface Rent { monthly: number; months: number; metro: boolean; landlord: string; landlordPan: string; city: string }

const WINDOW_DEFAULT: TaxWindow = { declare: true, proofs: false, note: '', closesOn: '' };
const RENT_DEFAULT: Rent = { monthly: 0, months: 12, metro: false, landlord: '', landlordPan: '', city: '' };
const PROOF_LIMIT = 5_000_000;

@Injectable()
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
    private readonly config: ModuleConfigService,
  ) {}

  async mine(session: SessionUser, yearInput?: string) {
    if (!session.employeeId) fail(400, 'This sign-in is not linked to a person, so there is no tax to declare.');
    return this.sheet(session, session.employeeId, this.yearOf(yearInput), false);
  }

  /** What tax would be under each regime for figures the person types, without saving anything. */
  async simulate(session: SessionUser, raw: unknown) {
    const input = bag(raw);
    const year = this.yearOf(input.year);
    const base = session.employeeId ? await this.inputFor(session.companyId, session.employeeId, year) : null;
    const numberOf = (value: unknown, fallback: number) => {
      const parsed = Math.round(Number(String(value ?? '').replace(/,/g, '')));
      return Number.isFinite(parsed) && parsed >= 0 && String(value ?? '').trim() !== '' ? Math.min(parsed, 1_000_000_000) : fallback;
    };
    const rent = this.rentOf(input.rent);
    const tax: TaxInput = {
      gross: numberOf(input.gross, base?.input.gross || 0),
      basic: numberOf(input.basic, base?.input.basic || 0),
      hra: numberOf(input.hra, base?.input.hra || 0),
      lta: base?.input.lta || 0,
      age: numberOf(input.age, base?.input.age || 30),
      values: this.valuesOf(input.values),
      rentAnnual: rent.monthly * rent.months,
      metro: rent.metro,
      parentsSenior: input.parentsSenior === true,
      flexExempt: base?.input.flexExempt || 0,
    };
    return this.compare(tax, base?.paidSoFar || 0, year);
  }

  async save(session: SessionUser, raw: unknown) {
    if (!session.employeeId) fail(400, 'This sign-in is not linked to a person.');
    const input = bag(raw);
    const year = this.yearOf(input.year);
    const window = await this.window(session.companyId);
    const current = await this.prisma.taxDeclaration.findUnique({ where: { companyId_employeeId_year: { companyId: session.companyId, employeeId: session.employeeId, year } } });
    if (current?.status === 'verified') fail(409, 'Payroll has already checked this declaration. Ask them to reopen it.');
    if (!window.declare && current?.status !== 'returned') fail(423, 'The declaration window is closed. Payroll opens it at the start of the year.');
    const regime = input.regime === 'old' ? 'old' : 'new';
    const stored: Stored = { values: this.valuesOf(input.values), approved: this.stored(current?.itemsJson).approved, parentsSenior: input.parentsSenior === true };
    const rent = this.rentOf(input.rent);
    if (rent.monthly * rent.months > 100_000 && !rent.landlordPan) fail(400, 'Rent above ₹1 lakh a year needs the landlord’s PAN.');
    if (rent.landlordPan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(rent.landlordPan)) fail(400, 'Enter the landlord’s PAN as 10 characters, such as ABCDE1234F.');
    const submit = input.submit === true;
    const data = {
      regime,
      itemsJson: JSON.stringify(stored),
      rentJson: JSON.stringify(rent),
      status: submit ? 'submitted' : (current?.status === 'returned' ? 'returned' : 'draft'),
      ...(submit ? { submittedAt: new Date() } : {}),
    };
    if (current) await this.prisma.taxDeclaration.update({ where: { id: current.id }, data });
    else await this.prisma.taxDeclaration.create({ data: { companyId: session.companyId, employeeId: session.employeeId, year, ...data } });
    return this.sheet(session, session.employeeId, year, false);
  }

  async addProof(session: SessionUser, raw: unknown) {
    if (!session.employeeId) fail(400, 'This sign-in is not linked to a person.');
    const input = bag(raw);
    const year = this.yearOf(input.year);
    const item = TAX_ITEMS.find((row) => row.key === String(input.item || ''));
    if (!item) fail(400, 'Choose what this proof is for.');
    const window = await this.window(session.companyId);
    const declaration = await this.prisma.taxDeclaration.findUnique({ where: { companyId_employeeId_year: { companyId: session.companyId, employeeId: session.employeeId, year } } });
    if (!declaration) fail(400, 'Save your declaration first, then add proofs.');
    if (!window.proofs && !window.declare && declaration.status !== 'returned') fail(423, 'Proofs are not being collected right now.');
    if (declaration.status === 'verified') fail(409, 'Payroll has already checked this declaration.');
    const file = uploadOf(input.data, input.fileName, PROOF_LIMIT);
    if (!file) fail(400, 'Choose a PDF, JPG or PNG under 5 MB.');
    const count = await this.prisma.taxProof.count({ where: { declarationId: declaration.id } });
    if (count >= 40) fail(400, 'You can add up to 40 proofs. Combine pages into one PDF.');
    const row = await this.prisma.taxProof.create({
      data: { companyId: session.companyId, employeeId: session.employeeId, declarationId: declaration.id, item: item.key, fileName: file.name, mime: file.mime, size: file.bytes.length },
    });
    const dir = this.dir(session.companyId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${row.id}.${file.ext}`), file.bytes);
    return this.sheet(session, session.employeeId, year, false);
  }

  async removeProof(session: SessionUser, raw: unknown) {
    const id = text(bag(raw).id, 'Proof', 40);
    const row = await this.prisma.taxProof.findFirst({ where: { id, companyId: session.companyId } });
    if (!row || row.employeeId !== session.employeeId) fail(404, 'That proof was not found.');
    if (row.status === 'accepted') fail(409, 'Payroll has accepted this proof, so it stays.');
    await this.prisma.taxProof.delete({ where: { id } });
    const path = this.proofPath(session.companyId, row.id, row.mime);
    if (existsSync(path)) unlinkSync(path);
    const declaration = await this.prisma.taxDeclaration.findFirst({ where: { id: row.declarationId } });
    return this.sheet(session, row.employeeId, declaration?.year || financialYear(todayInIndia()), false);
  }

  async proofFile(session: SessionUser, id: string): Promise<{ type: string; bytes: Buffer; name: string } | null> {
    const row = await this.prisma.taxProof.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) return null;
    if (row.employeeId !== session.employeeId && !(await this.gates.holds(session, 'pay.tax'))) return null;
    try {
      return { type: row.mime, bytes: readFileSync(this.proofPath(session.companyId, row.id, row.mime)), name: row.fileName };
    } catch {
      return null;
    }
  }

  async desk(session: SessionUser, yearInput?: string, status = '') {
    await this.gates.gate(session, 'pay.tax', 'You do not have access to tax declarations.');
    const year = this.yearOf(yearInput);
    const people = await this.prisma.employee.findMany({
      where: { companyId: session.companyId, status: { in: ['active', 'onboarding', 'notice'] } },
      include: { department: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });
    const rows = await this.prisma.taxDeclaration.findMany({ where: { companyId: session.companyId, year } });
    const proofs = await this.prisma.taxProof.findMany({ where: { companyId: session.companyId, declarationId: { in: rows.map((row) => row.id) } }, select: { declarationId: true, status: true } });
    const list = people.map((person) => {
      const row = rows.find((item) => item.employeeId === person.id);
      const stored = this.stored(row?.itemsJson);
      const declared = this.declaredTotal(stored.values);
      const mine = proofs.filter((proof) => proof.declarationId === row?.id);
      return {
        employeeId: person.id,
        name: fullName(person),
        code: person.code,
        department: person.department?.name || '',
        regime: row?.regime || person.taxRegime || '',
        status: row?.status || 'none',
        declared,
        approved: row?.status === 'verified' ? this.declaredTotal(stored.approved) : null,
        proofs: mine.length,
        pending: mine.filter((proof) => proof.status === 'pending').length,
        submittedAt: row?.submittedAt ? row.submittedAt.toISOString() : '',
      };
    });
    const counts = {
      none: list.filter((row) => row.status === 'none').length,
      draft: list.filter((row) => row.status === 'draft').length,
      submitted: list.filter((row) => row.status === 'submitted').length,
      returned: list.filter((row) => row.status === 'returned').length,
      verified: list.filter((row) => row.status === 'verified').length,
    };
    return {
      year,
      years: this.years(),
      window: await this.window(session.companyId),
      counts,
      rows: status ? list.filter((row) => row.status === status) : list,
    };
  }

  async deskOne(session: SessionUser, employeeId: string, yearInput?: string) {
    await this.gates.gate(session, 'pay.tax', 'You do not have access to tax declarations.');
    return this.sheet(session, employeeId, this.yearOf(yearInput), true);
  }

  async verify(session: SessionUser, raw: unknown) {
    await this.gates.gate(session, 'pay.tax', 'You do not have access to tax declarations.');
    const input = bag(raw);
    const employeeId = text(input.employeeId, 'Person', 40);
    const year = this.yearOf(input.year);
    const row = await this.prisma.taxDeclaration.findUnique({ where: { companyId_employeeId_year: { companyId: session.companyId, employeeId, year } } });
    if (!row) fail(404, 'This person has not declared anything for that year.');
    if (row.employeeId === session.employeeId) fail(403, 'Someone else in payroll checks your own declaration.');
    const decision = String(input.decision || '');
    if (!['verified', 'returned', 'reopen'].includes(decision)) fail(400, 'Choose to approve, send back, or reopen.');
    const note = optional(input.note, 400);
    if (decision === 'returned' && !note) fail(400, 'Say what needs fixing before you send it back.');
    const stored = this.stored(row.itemsJson);
    const approved = this.valuesOf(input.approved);
    for (const key of Object.keys(approved)) {
      if (approved[key] > (stored.values[key] || 0)) fail(400, 'An approved amount cannot be more than the person declared.');
    }
    const proofs = input.proofs && typeof input.proofs === 'object' ? input.proofs as Record<string, unknown> : {};
    for (const [id, value] of Object.entries(proofs)) {
      const next = String(value);
      if (!['accepted', 'rejected', 'pending'].includes(next)) continue;
      await this.prisma.taxProof.updateMany({ where: { id, declarationId: row.id }, data: { status: next } });
    }
    const status = decision === 'reopen' ? 'returned' : decision;
    await this.prisma.taxDeclaration.update({
      where: { id: row.id },
      data: {
        status,
        note,
        itemsJson: JSON.stringify({ ...stored, approved: decision === 'verified' ? { ...stored.values, ...approved } : stored.approved }),
        ...(decision === 'verified' ? { verifiedAt: new Date(), verifiedBy: session.name } : {}),
      },
    });
    if (decision === 'verified') {
      await this.prisma.employee.updateMany({ where: { id: employeeId, companyId: session.companyId }, data: { taxRegime: row.regime } });
    }
    await notifyPerson(this.prisma, session.companyId, employeeId, {
      kind: 'tax',
      title: decision === 'verified' ? `Your FY ${year} tax declaration is approved` : `Your FY ${year} tax declaration needs a change`,
      body: decision === 'verified' ? `Payroll will deduct tax under the ${row.regime} regime.` : note || 'Payroll reopened it for you.',
      link: '/tax',
      ref: `tax:${row.id}:${status}:${Date.now()}`,
    });
    await this.audit(session, 'tax.' + decision, row.id, `${employeeId} ${year}`);
    return this.sheet(session, employeeId, year, true);
  }

  async saveWindow(session: SessionUser, raw: unknown) {
    await this.gates.gate(session, 'pay.tax', 'You do not have access to tax declarations.');
    const input = bag(raw);
    const closesOn = optional(input.closesOn, 10);
    if (closesOn && !/^\d{4}-\d{2}-\d{2}$/.test(closesOn)) fail(400, 'Choose a closing date.');
    const value: TaxWindow = { declare: input.declare === true, proofs: input.proofs === true, note: optional(input.note, 300), closesOn };
    await this.config.write(session.companyId, 'tax.window', value);
    return value;
  }

  async window(companyId: string): Promise<TaxWindow> {
    const value = await this.config.read(companyId, 'tax.window', WINDOW_DEFAULT);
    if (value.closesOn && value.closesOn < todayInIndia()) return { ...value, declare: false };
    return value;
  }

  private async sheet(session: SessionUser, employeeId: string, year: string, desk: boolean) {
    const person = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: session.companyId }, include: { department: true, designation: true } });
    if (!person) fail(404, 'That person was not found.');
    const row = await this.prisma.taxDeclaration.findUnique({ where: { companyId_employeeId_year: { companyId: session.companyId, employeeId, year } } });
    const stored = this.stored(row?.itemsJson);
    const rent = this.rentFrom(row?.rentJson);
    const proofs = row ? await this.prisma.taxProof.findMany({ where: { declarationId: row.id }, orderBy: { createdAt: 'asc' } }) : [];
    const base = await this.inputFor(session.companyId, employeeId, year);
    const declared: TaxInput = { ...base.input, values: stored.values, rentAnnual: rent.monthly * rent.months, metro: rent.metro, parentsSenior: stored.parentsSenior };
    const approvedInput: TaxInput | null = row?.status === 'verified' ? { ...declared, values: stored.approved } : null;
    return {
      year,
      years: this.years(),
      window: await this.window(session.companyId),
      desk,
      person: { id: person.id, name: fullName(person), code: person.code, department: person.department?.name || '', designation: person.designation?.name || '', age: base.input.age, regimeOnFile: person.taxRegime || '' },
      salary: base.pay ? { effectiveFrom: base.pay.effectiveFrom, gross: base.input.gross, basic: base.input.basic, hra: base.input.hra, lta: base.input.lta, flexExempt: base.input.flexExempt } : null,
      items: TAX_ITEMS,
      declaration: {
        exists: Boolean(row),
        status: row?.status || 'none',
        regime: row?.regime || (person.taxRegime === 'old' ? 'old' : 'new'),
        note: row?.note || '',
        values: stored.values,
        approved: stored.approved,
        parentsSenior: stored.parentsSenior,
        rent,
        submittedAt: row?.submittedAt ? row.submittedAt.toISOString() : '',
        verifiedAt: row?.verifiedAt ? row.verifiedAt.toISOString() : '',
        verifiedBy: row?.verifiedBy || '',
      },
      proofs: proofs.map((proof) => ({ id: proof.id, item: proof.item, fileName: proof.fileName, mime: proof.mime, size: proof.size, status: proof.status, at: proof.createdAt.toISOString() })),
      estimate: this.compare(approvedInput || declared, base.paidSoFar, year),
    };
  }

  private async inputFor(companyId: string, employeeId: string, year: string) {
    const range = yearRange(year);
    const today = todayInIndia();
    const day = today < range.start ? range.start : today > range.end ? range.end : today;
    const person = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId }, select: { dateOfBirth: true } });
    const pay = await currentPay(this.prisma, companyId, employeeId, day);
    const slips = await this.prisma.paySlip.findMany({ where: { companyId, employeeId, published: true, month: { in: range.months } }, select: { linesJson: true } });
    let paidSoFar = 0;
    for (const slip of slips) {
      try {
        const lines = JSON.parse(slip.linesJson) as Array<{ side: string; name: string; paise: number }>;
        paidSoFar += lines.filter((line) => line.side === 'deduction' && /\btds\b|income\s*tax/i.test(line.name)).reduce((sum, line) => sum + Math.round(line.paise / 100), 0);
      } catch {
        /* a broken slip adds nothing */
      }
    }
    const flex = await this.prisma.flexChoice.findUnique({ where: { companyId_employeeId_year: { companyId, employeeId, year } } });
    let flexExempt = 0;
    if (flex?.status === 'approved') {
      const config = await this.config.read<FlexConfig>(companyId, 'flex', FLEX_DEFAULT);
      try {
        const choices = JSON.parse(flex.choicesJson) as Record<string, number>;
        flexExempt = config.components.filter((item) => item.taxFree).reduce((sum, item) => sum + Math.min(item.cap, Math.max(0, Number(choices[item.key]) || 0)), 0);
      } catch {
        flexExempt = 0;
      }
    }
    const input: TaxInput = {
      gross: pay?.earnings || 0,
      basic: pay?.basic || 0,
      hra: pay?.hra || 0,
      lta: pay?.lta || 0,
      age: ageOn(person?.dateOfBirth || '', range.end),
      values: {},
      rentAnnual: 0,
      metro: false,
      parentsSenior: false,
      flexExempt,
    };
    return { input, pay, paidSoFar };
  }

  private compare(input: TaxInput, paidSoFar: number, year: string) {
    const old = computeTax(input, 'old');
    const fresh = computeTax(input, 'new');
    const better = old.total < fresh.total ? 'old' : 'new';
    const earlier = Math.round(input.values.prev_tds || 0);
    const months = this.monthsLeft(year);
    const plan = (result: RegimeResult) => {
      const left = Math.max(0, result.total - paidSoFar - earlier);
      return { ...result, paidSoFar, earlier, left, monthly: months ? Math.ceil(left / months) : 0 };
    };
    return {
      old: plan(old),
      new: plan(fresh),
      better,
      saving: Math.abs(old.total - fresh.total),
      monthsLeft: months,
      summary: old.total === fresh.total
        ? `Both regimes come to ${inr(old.total)} for the year.`
        : `The ${better} regime saves ${inr(Math.abs(old.total - fresh.total))} for the year.`,
    };
  }

  private monthsLeft(year: string): number {
    const range = yearRange(year);
    const month = todayInIndia().slice(0, 7);
    if (month < range.months[0]) return 12;
    const index = range.months.indexOf(month);
    return index < 0 ? 0 : 12 - index;
  }

  private declaredTotal(values: Record<string, number>): number {
    return TAX_ITEMS.filter((item) => !item.income && !item.paid).reduce((sum, item) => sum + (values[item.key] || 0), 0);
  }

  private valuesOf(value: unknown): Record<string, number> {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const out: Record<string, number> = {};
    for (const item of TAX_ITEMS) {
      const text = String(raw[item.key] ?? '').replace(/,/g, '').trim();
      if (!text) continue;
      const amount = Math.round(Number(text));
      if (!Number.isFinite(amount) || amount < 0) fail(400, `Enter ${item.label} as an amount in rupees.`);
      if (amount > 100_000_000) fail(400, `${item.label} is too large.`);
      if (amount) out[item.key] = amount;
    }
    return out;
  }

  private rentOf(value: unknown): Rent {
    const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const monthly = Math.round(Number(String(raw.monthly ?? '0').replace(/,/g, '')) || 0);
    const months = Math.round(Number(raw.months ?? 12) || 0);
    if (monthly < 0 || monthly > 10_000_000) fail(400, 'Enter the monthly rent in rupees.');
    if (months < 0 || months > 12) fail(400, 'Rent can be paid for up to 12 months of the year.');
    return {
      monthly,
      months: monthly ? months : 12,
      metro: raw.metro === true,
      landlord: optional(raw.landlord, 120),
      landlordPan: optional(raw.landlordPan, 10).toUpperCase(),
      city: optional(raw.city, 60),
    };
  }

  private rentFrom(json?: string): Rent {
    try {
      return { ...RENT_DEFAULT, ...(JSON.parse(json || '{}') as Partial<Rent>) };
    } catch {
      return RENT_DEFAULT;
    }
  }

  private stored(json?: string): Stored {
    try {
      const parsed = JSON.parse(json || '{}') as Partial<Stored>;
      return { values: parsed.values || {}, approved: parsed.approved || {}, parentsSenior: parsed.parentsSenior === true };
    } catch {
      return { values: {}, approved: {}, parentsSenior: false };
    }
  }

  private yearOf(value: unknown): string {
    const year = String(value || '').trim() || financialYear(todayInIndia());
    if (!isYear(year)) fail(400, 'Use a financial year such as 2026-27.');
    return year;
  }

  private years(): string[] {
    const now = financialYear(todayInIndia());
    const start = Number(now.slice(0, 4));
    return [start + 1, start, start - 1, start - 2].map((first) => `${first}-${String((first + 1) % 100).padStart(2, '0')}`);
  }

  private dir(companyId: string): string {
    return join(process.cwd(), 'storage', 'tax', companyId);
  }

  private proofPath(companyId: string, id: string, mime: string): string {
    return join(this.dir(companyId), `${id}.${mime === 'application/pdf' ? 'pdf' : mime === 'image/png' ? 'png' : 'jpg'}`);
  }

  private async audit(session: SessionUser, action: string, entityId: string, detail: string): Promise<void> {
    await this.prisma.auditEvent.create({ data: { companyId: session.companyId, actorId: session.id, action, entity: 'tax', entityId, detail } }).catch(() => undefined);
  }
}
