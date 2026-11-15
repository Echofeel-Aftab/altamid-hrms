import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { dataKey, maskSecret, openSecret, seal } from './crypto';
import { nextEmployeeCode, todayInIndia } from './dates';
import { bag, emailOf, fail, optional, panOf, text } from './http';
import { AccessService } from './access.service';
import { BrandService } from './brand.service';
import {
  CATALOG,
  INTEGRATION_KEYS,
  IntegrationKey,
  StoredIntegration,
  accountToRow,
  bankOptions,
  blankIntegration,
  integrationReady,
  isMultiAccountKey,
  pickIntegrationAccount,
  presentIntegration,
  presentIntegrationAccounts,
  readIntegration,
  removeIntegrationAccount,
  saveIntegration,
  setDefaultIntegrationAccount,
  testIntegration,
  upsertIntegrationAccount,
} from './integrations';
import { MAIL_CATALOG, MAIL_KEYS, MAIL_LAYOUTS, MailDesign, MailKey, MailLayout, MailTemplate, SMTP_PURPOSES, SmtpPurpose, defaultDesign, defaultTemplates, filledTemplate, renderMail, smtpPurposeOf } from './mail';
import { unscoped } from './outlet-context';
import { PrismaService } from './prisma.service';
import { richOf, sanitizeRich } from './rich';
import { SessionUser } from './session';
import { accountReady, AiSettings, defaultAiSettings } from './ai.types';
import { presentAiSettings, readAiSettings, removeAiAccount, setDefaultAiAccount, upsertAiAccount } from './ai-settings';
import { pingAccount, ProviderAccount } from './ai-providers';
import { TtlCache } from './ttl-cache';

const SEQUENCE_TYPES = ['employee', 'payslip', 'leave', 'reimbursement', 'loan'] as const;
type SequenceType = (typeof SEQUENCE_TYPES)[number];
const SEQUENCE_LABELS: Record<SequenceType, string> = {
  employee: 'Employee code',
  payslip: 'Payslip',
  leave: 'Leave request',
  reimbursement: 'Reimbursement',
  loan: 'Loan',
};
const CHECKIN_SCOPES = ['anywhere', 'country', 'offices'] as const;
export type CheckinScope = (typeof CHECKIN_SCOPES)[number];
interface SequenceRule {
  prefix: string;
  padding: number;
  includeYear: boolean;
  resetYearly: boolean;
  lastNumber: number;
}

interface SmtpAccount {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  passwordEnc: string;
  encryption: 'tls' | 'ssl';
  fromName: string;
  fromEmail: string;
  active: boolean;
  isDefault: boolean;
}

export interface TestNote {
  ok: boolean;
  message: string;
  at: string;
}

interface SalaryAccount {
  id: string;
  label: string;
  name: string;
  accountName: string;
  ifsc: string;
  accountEnc: string;
  isDefault: boolean;
  active: boolean;
  locationIds: string[];
}

const LEGACY_ACCOUNT_ID = '0000000000000001';

interface StoredSettings {
  profile: {
    address: string;
    zip: string;
    country: string;
    phone: string;
    email: string;
    website: string;
    gstin: string;
    tan: string;
  };
  bank: { name: string; accountName: string; ifsc: string; accountEnc: string };
  bankAccounts: SalaryAccount[];
  smtp: SmtpAccount[];
  purposes: Record<SmtpPurpose, string>;
  numbering: Record<SequenceType, SequenceRule>;
  statutory: {
    pfEnabled: boolean;
    pfNumber: string;
    pfEmployeeRate: string;
    pfEmployerRate: string;
    pfWageCeiling: string;
    esiEnabled: boolean;
    esiNumber: string;
    esiEmployeeRate: string;
    esiEmployerRate: string;
    esiWageCeiling: string;
    ptEnabled: boolean;
    lwfEnabled: boolean;
    tdsEnabled: boolean;
    gratuityEnabled: boolean;
    payCycle: string;
    payDay: number;
  };
  attendance: {
    web: boolean;
    geo: boolean;
    selfie: boolean;
    biometric: boolean;
    shiftStart: string;
    shiftEnd: string;
    graceMinutes: number;
    weekOff: number[];
    otAfterMinutes: number;
    scope: CheckinScope;
    country: string;
    ownOffice: boolean;
    anywhere: string[];
  };
  integrations: Record<IntegrationKey, StoredIntegration>;
  templates: {
    design: MailDesign;
    items: Record<MailKey, MailTemplate>;
  };
  tests: Partial<Record<string, TestNote>>;
  hiring: HiringRules;
  policy: PeoplePolicy;
  ai: AiSettings;
}

export interface PeoplePolicy {
  probationMonths: number;
  noticeDays: number;
  prorateLeave: boolean;
  compOffFullHours: number;
  compOffHalfHours: number;
  autoExit: boolean;
  reminders: { probation: boolean; approvals: boolean; approvalHours: number; checkout: boolean; warranty: boolean; celebrations: boolean };
}

export function defaultPolicy(): PeoplePolicy {
  return {
    probationMonths: 6,
    noticeDays: 30,
    prorateLeave: true,
    compOffFullHours: 8,
    compOffHalfHours: 4,
    autoExit: true,
    reminders: { probation: true, approvals: true, approvalHours: 48, checkout: true, warranty: true, celebrations: true },
  };
}

export interface HiringRules {
  rejectDays: number;
  exitDays: number;
  tellApplicant: boolean;
  message: string;
}

export const DEFAULT_COOLING_MESSAGE = 'Thank you for applying again. Our hiring rules ask for a gap between applications, so we cannot consider this one right now. You can apply again from {{date}}. We have kept your details.';

function defaults(): StoredSettings {
  return {
    profile: { address: '', zip: '', country: 'India', phone: '', email: '', website: '', gstin: '', tan: '' },
    bank: { name: '', accountName: '', ifsc: '', accountEnc: '' },
    bankAccounts: [],
    smtp: [],
    purposes: { payslip: '', leave: '', announcement: '', onboarding: '', hiring: '', celebrations: '', system: '' },
    numbering: {
      employee: { prefix: 'EMP', padding: 3, includeYear: false, resetYearly: false, lastNumber: 0 },
      payslip: { prefix: 'PAY', padding: 4, includeYear: true, resetYearly: true, lastNumber: 0 },
      leave: { prefix: 'LV', padding: 4, includeYear: true, resetYearly: true, lastNumber: 0 },
      reimbursement: { prefix: 'RMB', padding: 4, includeYear: true, resetYearly: true, lastNumber: 0 },
      loan: { prefix: 'LN', padding: 4, includeYear: false, resetYearly: false, lastNumber: 0 },
    },
    statutory: {
      pfEnabled: true,
      pfNumber: '',
      pfEmployeeRate: '12',
      pfEmployerRate: '12',
      pfWageCeiling: '15000',
      esiEnabled: true,
      esiNumber: '',
      esiEmployeeRate: '0.75',
      esiEmployerRate: '3.25',
      esiWageCeiling: '21000',
      ptEnabled: true,
      lwfEnabled: false,
      tdsEnabled: true,
      gratuityEnabled: true,
      payCycle: 'monthly',
      payDay: 1,
    },
    attendance: {
      web: true,
      geo: false,
      selfie: false,
      biometric: false,
      shiftStart: '09:30',
      shiftEnd: '18:30',
      graceMinutes: 10,
      weekOff: [0],
      otAfterMinutes: 30,
      scope: 'anywhere',
      country: 'IN',
      ownOffice: false,
      anywhere: [],
    },
    integrations: {
      whatsapp: blankIntegration('whatsapp'),
      sms: blankIntegration('sms'),
      biometric: blankIntegration('biometric'),
      bank: blankIntegration('bank'),
      accounting: blankIntegration('accounting'),
      webhook: blankIntegration('webhook'),
      api: blankIntegration('api'),
    },
    templates: { design: defaultDesign(), items: defaultTemplates() },
    tests: {},
    hiring: { rejectDays: 0, exitDays: 0, tellApplicant: true, message: DEFAULT_COOLING_MESSAGE },
    policy: defaultPolicy(),
    ai: defaultAiSettings(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function flag(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
}

function clip(value: unknown, max: number, fallback = ''): string {
  const cleaned = String(value ?? fallback).trim();
  return cleaned.slice(0, max);
}

@Injectable()
export class SettingsService {
  private readonly key = dataKey();
  private readonly settingsCache = new TtlCache<StoredSettings>(30_000);

  constructor(private readonly prisma: PrismaService, private readonly gates: AccessService, private readonly brand: BrandService) {}

  dataKeyBuffer(): Buffer {
    return this.key;
  }

  async companySettings(companyId: string): Promise<StoredSettings> {
    return this.load(companyId);
  }

  async aiConfig(companyId: string): Promise<AiSettings> {
    return (await this.load(companyId)).ai;
  }

  async resolveCompanyByApiKey(token: string): Promise<{ id: string; name: string }> {
    if (!token.startsWith('hrms_')) fail(401, 'Invalid API key.');
    const want = this.apiKeyHash(token);
    const rows = await this.prisma.company.findMany({ select: { id: true, name: true, settingsJson: true } });
    for (const row of rows) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(row.settingsJson || '{}') as Record<string, unknown>;
      } catch {
        continue;
      }
      const integrations = asRecord(parsed.integrations);
      const api = readIntegration('api', integrations.api);
      if (!api.enabled) continue;
      const config = api.configs.altamid;
      const sealed = config?.secrets.key;
      if (!sealed) continue;
      const savedHash = config.fields.keyHash || '';
      if (savedHash) {
        if (!this.safeEqual(savedHash, want)) continue;
      }
      if (openSecret(sealed, this.key) !== token) continue;
      return { id: row.id, name: row.name };
    }
    fail(401, 'Invalid API key.');
  }

  private apiKeyHash(plain: string): string {
    return createHash('sha256').update(plain).digest('base64url');
  }

  private safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    if (left.length !== right.length) return false;
    return timingSafeEqual(left, right);
  }

  private saveAi(input: Record<string, unknown>, stored: StoredSettings): void {
    if (input.remove === true) {
      removeAiAccount(stored.ai, text(input.id, 'Account', 40));
      return;
    }
    if (input.setDefault === true) {
      setDefaultAiAccount(stored.ai, text(input.id, 'Account', 40));
      return;
    }
    if (Array.isArray(input.fallbackOrder)) {
      stored.ai.fallbackOrder = [...new Set(input.fallbackOrder.map(String).map((id) => id.slice(0, 40)).filter(Boolean))].slice(0, 20);
    }
    const savingAccount =
      input.saveAccount === true ||
      input.label !== undefined ||
      input.provider !== undefined ||
      input.apiKey !== undefined ||
      input.model !== undefined;
    if (savingAccount) {
      // Account "enabled" must not overwrite the master assistant switch.
      const accountInput = { ...input, enabled: input.accountEnabled !== undefined ? input.accountEnabled : input.enabled };
      upsertAiAccount(stored.ai, accountInput, (plain) => seal(plain, this.key));
      if (stored.ai.accounts.some(accountReady)) stored.ai.enabled = true;
      return;
    }
    if (input.enabled !== undefined) stored.ai.enabled = input.enabled === true;
  }

  async view(session: SessionUser) {
    await this.requireHr(session);
    const company = await this.company(session.companyId);
    const stored = await this.load(session.companyId);
    const codes = await unscoped(() => this.prisma.employee.findMany({ where: { companyId: session.companyId }, select: { code: true } }));
    return { ...this.present(company, stored, codes.map((row) => row.code)), offices: await this.offices(session.companyId) };
  }

  async save(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const input = bag(body);
    const section = text(input.section, 'Section', 40);
    const stored = await this.load(session.companyId);
    let issuedKey = '';
    if (section === 'profile') await this.saveProfile(session, input, stored);
    else if (section === 'smtp') this.saveSmtp(input, stored);
    else if (section === 'bankAccount') await this.saveAccount(session, input, stored);
    else if (section === 'purposes') this.savePurposes(input, stored);
    else if (section === 'numbering') this.saveNumbering(input, stored);
    else if (section === 'statutory') this.saveStatutory(input, stored);
    else if (section === 'attendance') this.saveAttendance(input, stored);
    else if (section === 'templates') this.saveTemplates(input, stored);
    else if (section === 'integration') issuedKey = this.saveConnection(input, stored);
    else if (section === 'ai') this.saveAi(input, stored);
    else if (section === 'test') await this.runTest(session, input, stored);
    else if (section === 'geofence') await this.saveGeofence(session, input);
    else fail(400, 'That settings section is not available.');
    await this.write(session.companyId, stored);
    await this.prisma.auditEvent.create({
      data: { companyId: session.companyId, actorId: session.id, action: 'settings.' + section, entity: 'company', entityId: session.companyId },
    });
    const company = await this.company(session.companyId);
    const codes = await unscoped(() => this.prisma.employee.findMany({ where: { companyId: session.companyId }, select: { code: true } }));
    return { ...this.present(company, stored, codes.map((row) => row.code)), offices: await this.offices(session.companyId), issuedKey };
  }

  async issueEmployeeCode(companyId: string, existing: string[]): Promise<string> {
    const stored = await this.load(companyId);
    const rule = stored.numbering.employee;
    return nextEmployeeCode(existing, {
      prefix: rule.prefix,
      padding: rule.padding,
      includeYear: rule.includeYear,
      year: Number(todayInIndia().slice(0, 4)),
    });
  }

  /** Next document number for payslip / leave / reimbursement / loan; persists lastNumber. */
  async nextDocumentNumber(companyId: string, type: SequenceType): Promise<string> {
    if (type === 'employee') fail(400, 'Use issueEmployeeCode for employee codes.');
    const stored = await this.load(companyId);
    const rule = stored.numbering[type];
    const year = Number(todayInIndia().slice(0, 4));
    const next = Math.max(0, rule.lastNumber) + 1;
    rule.lastNumber = next;
    await this.write(companyId, stored);
    return this.preview(rule, next, year);
  }

  async hiringRules(companyId: string): Promise<HiringRules & { emailAuto: boolean; mailbox: boolean }> {
    const stored = await this.load(companyId);
    return { ...stored.hiring, emailAuto: stored.templates.items.cooling.auto, mailbox: stored.smtp.some((row) => row.active && Boolean(row.passwordEnc)) };
  }

  async saveHiringRules(companyId: string, input: Record<string, unknown>): Promise<void> {
    const stored = await this.load(companyId);
    const days = (value: unknown, label: string) => {
      const number = Number(value ?? 0);
      if (!Number.isInteger(number) || number < 0 || number > 1095) fail(400, label + ' must be a whole number of days from 0 to 1095.');
      return number;
    };
    stored.hiring = {
      rejectDays: input.rejectDays === undefined ? stored.hiring.rejectDays : days(input.rejectDays, 'The gap after a rejection'),
      exitDays: input.exitDays === undefined ? stored.hiring.exitDays : days(input.exitDays, 'The gap after someone leaves'),
      tellApplicant: input.tellApplicant === undefined ? stored.hiring.tellApplicant : input.tellApplicant === true,
      message: input.message === undefined ? stored.hiring.message : (optional(input.message, 600) || DEFAULT_COOLING_MESSAGE),
    };
    if (!stored.hiring.message.includes('{{date}}')) fail(400, 'Keep {{date}} in the message so the applicant knows when they can apply again.');
    await this.write(companyId, stored);
  }

  async timeRules(companyId: string): Promise<{ weekOff: number[]; shiftStart: string; shiftEnd: string; graceMinutes: number }> {
    const { weekOff, shiftStart, shiftEnd, graceMinutes } = (await this.load(companyId)).attendance;
    return { weekOff, shiftStart, shiftEnd, graceMinutes };
  }

  async policy(companyId: string): Promise<PeoplePolicy> {
    return (await this.load(companyId)).policy;
  }

  async savePolicy(session: SessionUser, body: unknown): Promise<PeoplePolicy> {
    await this.requireHr(session);
    const input = bag(body);
    const stored = await this.load(session.companyId);
    const whole = (value: unknown, current: number, label: string, min: number, max: number) => {
      if (value === undefined) return current;
      const number = Number(value);
      if (!Number.isInteger(number) || number < min || number > max) fail(400, `${label} must be a whole number from ${min} to ${max}.`);
      return number;
    };
    const on = (value: unknown, current: boolean) => (value === undefined ? current : value === true);
    const current = stored.policy;
    const reminders = asRecord(input.reminders);
    const next: PeoplePolicy = {
      probationMonths: whole(input.probationMonths, current.probationMonths, 'Probation', 0, 24),
      noticeDays: whole(input.noticeDays, current.noticeDays, 'Notice period', 0, 180),
      prorateLeave: on(input.prorateLeave, current.prorateLeave),
      compOffFullHours: whole(input.compOffFullHours, current.compOffFullHours, 'Hours for a full comp-off day', 1, 12),
      compOffHalfHours: whole(input.compOffHalfHours, current.compOffHalfHours, 'Hours for a half comp-off day', 1, 12),
      autoExit: on(input.autoExit, current.autoExit),
      reminders: {
        probation: on(reminders.probation, current.reminders.probation),
        approvals: on(reminders.approvals, current.reminders.approvals),
        approvalHours: whole(reminders.approvalHours, current.reminders.approvalHours, 'Hours before a reminder', 4, 720),
        checkout: on(reminders.checkout, current.reminders.checkout),
        warranty: on(reminders.warranty, current.reminders.warranty),
        celebrations: on(reminders.celebrations, current.reminders.celebrations),
      },
    };
    if (next.compOffHalfHours >= next.compOffFullHours) fail(400, 'A half comp-off day needs fewer hours than a full day.');
    stored.policy = next;
    await this.write(session.companyId, stored);
    await this.prisma.auditEvent.create({ data: { companyId: session.companyId, actorId: session.id, action: 'settings.policy', entity: 'company', entityId: session.companyId } });
    return next;
  }

  async hasMailbox(companyId: string): Promise<boolean> {
    const stored = await this.load(companyId);
    return stored.smtp.some((row) => row.active && row.passwordEnc);
  }

  private async requireHr(session: SessionUser): Promise<void> {
    await this.gates.gate(session, 'settings', 'You do not have access to these settings.');
  }

  private async company(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) fail(404, 'That company was not found.');
    return company;
  }

  private async load(companyId: string): Promise<StoredSettings> {
    const hit = this.settingsCache.get(companyId);
    if (hit) return structuredClone(hit);
    const rows = await this.prisma.$queryRaw<Array<{ settingsJson: string }>>`
      SELECT "settingsJson" FROM "Company" WHERE "id" = ${companyId}
    `;
    const base = defaults();
    const raw = rows[0]?.settingsJson || '';
    if (!raw) {
      this.settingsCache.set(companyId, base);
      return structuredClone(base);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.settingsCache.set(companyId, base);
      return structuredClone(base);
    }
    const source = asRecord(parsed);
    const profile = asRecord(source.profile);
    const bank = asRecord(source.bank);
    base.profile = {
      address: clip(profile.address, 400),
      zip: clip(profile.zip, 12),
      country: clip(profile.country, 80, 'India') || 'India',
      phone: clip(profile.phone, 30),
      email: clip(profile.email, 190),
      website: clip(profile.website, 190),
      gstin: clip(profile.gstin, 15).toUpperCase(),
      tan: clip(profile.tan, 10).toUpperCase(),
    };
    base.bank = {
      name: clip(bank.name, 80),
      accountName: clip(bank.accountName, 120),
      ifsc: clip(bank.ifsc, 11).toUpperCase(),
      accountEnc: clip(bank.accountEnc, 500),
    };
    if (Array.isArray(source.bankAccounts)) {
      base.bankAccounts = source.bankAccounts.filter((row) => row && typeof row === 'object').slice(0, 10).map((row) => this.readAccount(asRecord(row)));
    } else if (base.bank.name || base.bank.ifsc || base.bank.accountEnc) {
      base.bankAccounts = [{ id: LEGACY_ACCOUNT_ID, label: 'Main salary account', ...base.bank, isDefault: true, active: true, locationIds: [] }];
    }
    if (Array.isArray(source.smtp)) {
      base.smtp = source.smtp.filter((row) => row && typeof row === 'object').slice(0, 12).map((row) => this.readSmtp(asRecord(row)));
    }
    const purposes = asRecord(source.purposes);
    for (const purpose of SMTP_PURPOSES) base.purposes[purpose] = clip(purposes[purpose], 32) || '';
    const numbering = asRecord(source.numbering);
    for (const type of SEQUENCE_TYPES) {
      const rule = asRecord(numbering[type]);
      if (!Object.keys(rule).length) continue;
      base.numbering[type] = {
        prefix: this.prefix(rule.prefix, base.numbering[type].prefix),
        padding: this.padding(rule.padding, base.numbering[type].padding),
        includeYear: flag(rule.includeYear, base.numbering[type].includeYear),
        resetYearly: flag(rule.resetYearly, base.numbering[type].resetYearly),
        lastNumber: this.whole(rule.lastNumber, 0, 99999999),
      };
    }
    this.readStatutory(asRecord(source.statutory), base);
    this.readAttendance(asRecord(source.attendance), base);
    const integrations = asRecord(source.integrations);
    for (const key of INTEGRATION_KEYS) base.integrations[key] = readIntegration(key, integrations[key]);
    base.templates = this.readTemplates(asRecord(source.templates));
    const hiring = asRecord(source.hiring);
    base.hiring = {
      rejectDays: this.whole(hiring.rejectDays, 0, 1095),
      exitDays: this.whole(hiring.exitDays, 0, 1095),
      tellApplicant: flag(hiring.tellApplicant, true),
      message: clip(hiring.message, 600) || DEFAULT_COOLING_MESSAGE,
    };
    base.ai = readAiSettings(source);
    const policy = asRecord(source.policy);
    const reminders = asRecord(policy.reminders);
    const fallback = defaultPolicy();
    base.policy = {
      probationMonths: policy.probationMonths === undefined ? fallback.probationMonths : this.whole(policy.probationMonths, fallback.probationMonths, 24),
      noticeDays: policy.noticeDays === undefined ? fallback.noticeDays : this.whole(policy.noticeDays, fallback.noticeDays, 180),
      prorateLeave: flag(policy.prorateLeave, fallback.prorateLeave),
      compOffFullHours: this.whole(policy.compOffFullHours, fallback.compOffFullHours, 12) || fallback.compOffFullHours,
      compOffHalfHours: this.whole(policy.compOffHalfHours, fallback.compOffHalfHours, 12) || fallback.compOffHalfHours,
      autoExit: flag(policy.autoExit, fallback.autoExit),
      reminders: {
        probation: flag(reminders.probation, true),
        approvals: flag(reminders.approvals, true),
        approvalHours: this.whole(reminders.approvalHours, 48, 720) || 48,
        checkout: flag(reminders.checkout, true),
        warranty: flag(reminders.warranty, true),
        celebrations: flag(reminders.celebrations, true),
      },
    };
    const tests = asRecord(source.tests);
    for (const [key, value] of Object.entries(tests)) {
      const note = asRecord(value);
      if (!note.message) continue;
      base.tests[key] = { ok: note.ok === true, message: clip(note.message, 240), at: clip(note.at, 40) };
    }
    this.settingsCache.set(companyId, base);
    return structuredClone(base);
  }

  private readAccount(row: Record<string, unknown>): SalaryAccount {
    return {
      id: /^[a-f0-9]{16}$/.test(String(row.id || '')) ? String(row.id) : randomBytes(8).toString('hex'),
      label: clip(row.label, 60, 'Salary account'),
      name: clip(row.name, 80),
      accountName: clip(row.accountName, 120),
      ifsc: clip(row.ifsc, 11).toUpperCase(),
      accountEnc: clip(row.accountEnc, 500),
      isDefault: flag(row.isDefault, false),
      active: flag(row.active, true),
      locationIds: Array.isArray(row.locationIds) ? [...new Set(row.locationIds.map(String).filter((id) => /^[a-z0-9]{10,40}$/i.test(id)))].slice(0, 200) : [],
    };
  }

  private readSmtp(row: Record<string, unknown>): SmtpAccount {
    const encryption = row.encryption === 'ssl' ? 'ssl' : 'tls';
    return {
      id: /^[a-f0-9]{16}$/.test(String(row.id || '')) ? String(row.id) : randomBytes(8).toString('hex'),
      label: clip(row.label, 60, 'Mailbox'),
      host: clip(row.host, 120, 'smtp.gmail.com'),
      port: this.whole(row.port, 587, 65535) || 587,
      username: clip(row.username, 190),
      passwordEnc: clip(row.passwordEnc, 800),
      encryption,
      fromName: clip(row.fromName, 80),
      fromEmail: clip(row.fromEmail, 190),
      active: flag(row.active, true),
      isDefault: flag(row.isDefault, false),
    };
  }

  private readStatutory(row: Record<string, unknown>, base: StoredSettings): void {
    if (!Object.keys(row).length) return;
    const current = base.statutory;
    current.pfEnabled = flag(row.pfEnabled, current.pfEnabled);
    current.pfNumber = clip(row.pfNumber, 40);
    current.pfEmployeeRate = this.rate(row.pfEmployeeRate, current.pfEmployeeRate);
    current.pfEmployerRate = this.rate(row.pfEmployerRate, current.pfEmployerRate);
    current.pfWageCeiling = String(this.whole(row.pfWageCeiling, Number(current.pfWageCeiling), 10000000));
    current.esiEnabled = flag(row.esiEnabled, current.esiEnabled);
    current.esiNumber = clip(row.esiNumber, 40);
    current.esiEmployeeRate = this.rate(row.esiEmployeeRate, current.esiEmployeeRate);
    current.esiEmployerRate = this.rate(row.esiEmployerRate, current.esiEmployerRate);
    current.esiWageCeiling = String(this.whole(row.esiWageCeiling, Number(current.esiWageCeiling), 10000000));
    current.ptEnabled = flag(row.ptEnabled, current.ptEnabled);
    current.lwfEnabled = flag(row.lwfEnabled, current.lwfEnabled);
    current.tdsEnabled = flag(row.tdsEnabled, current.tdsEnabled);
    current.gratuityEnabled = flag(row.gratuityEnabled, current.gratuityEnabled);
    current.payCycle = row.payCycle === 'weekly' ? 'weekly' : 'monthly';
    current.payDay = this.whole(row.payDay, current.payDay, 28) || 1;
  }

  private readAttendance(row: Record<string, unknown>, base: StoredSettings): void {
    if (!Object.keys(row).length) return;
    const current = base.attendance;
    current.web = flag(row.web, current.web);
    current.geo = flag(row.geo, current.geo);
    current.selfie = flag(row.selfie, current.selfie);
    current.biometric = flag(row.biometric, current.biometric);
    current.shiftStart = this.clock(row.shiftStart, current.shiftStart);
    current.shiftEnd = this.clock(row.shiftEnd, current.shiftEnd);
    current.graceMinutes = this.whole(row.graceMinutes, current.graceMinutes, 180);
    current.otAfterMinutes = this.whole(row.otAfterMinutes, current.otAfterMinutes, 240);
    if (Array.isArray(row.weekOff)) {
      current.weekOff = [...new Set(row.weekOff.map((day) => this.whole(day, -1, 6)).filter((day) => day >= 0))].sort();
    }
    if (row.scope !== undefined) current.scope = CHECKIN_SCOPES.includes(row.scope as CheckinScope) ? (row.scope as CheckinScope) : 'anywhere';
    if (row.country !== undefined) {
      const country = String(row.country || '').trim().toUpperCase();
      current.country = /^[A-Z]{2}$/.test(country) ? country : current.country;
    }
    current.ownOffice = flag(row.ownOffice, current.ownOffice);
    if (Array.isArray(row.anywhere)) {
      current.anywhere = [...new Set(row.anywhere.map((id) => String(id)).filter((id) => /^[a-z0-9]{10,40}$/i.test(id)))].slice(0, 500);
    }
  }

  private async saveGeofence(session: SessionUser, input: Record<string, unknown>): Promise<void> {
    const id = text(input.id, 'Location', 40);
    const office = await this.prisma.location.findFirst({ where: { id, companyId: session.companyId } });
    if (!office) fail(404, 'That location was not found.');
    if (input.clear === true) {
      await this.prisma.location.update({ where: { id }, data: { lat: null, lng: null } });
      return;
    }
    const lat = Number(input.lat);
    const lng = Number(input.lng);
    const radius = Math.round(Number(input.radius));
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) fail(400, 'Latitude must be between -90 and 90.');
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) fail(400, 'Longitude must be between -180 and 180.');
    if (!Number.isFinite(radius) || radius < 50 || radius > 5000) fail(400, 'The radius must be between 50 and 5000 metres.');
    await this.prisma.location.update({ where: { id }, data: { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, radius } });
  }

  private async offices(companyId: string) {
    const rows = await this.prisma.location.findMany({ where: { companyId }, orderBy: { name: 'asc' }, include: { _count: { select: { employees: true } } } });
    return rows.map((row) => ({ id: row.id, name: row.name, city: row.city, state: row.state, lat: row.lat, lng: row.lng, radius: row.radius, people: row._count.employees }));
  }

  async checkinPolicy(companyId: string) {
    const stored = await this.load(companyId);
    return stored.attendance;
  }

  private async write(companyId: string, stored: StoredSettings): Promise<void> {
    const json = JSON.stringify(stored);
    if (json.length > 200000) fail(400, 'These settings are too large to store.');
    await this.prisma.$executeRaw`
      UPDATE "Company" SET "settingsJson" = ${json}, "updatedAt" = NOW() WHERE "id" = ${companyId}
    `;
    this.settingsCache.set(companyId, structuredClone(stored));
  }

  private async saveProfile(session: SessionUser, input: Record<string, unknown>, stored: StoredSettings): Promise<void> {
    const name = text(input.name, 'Company name', 120);
    const legalName = text(input.legalName, 'Legal name', 160);
    const state = text(input.state, 'State', 80);
    const city = optional(input.city, 80);
    const pan = panOf(input.pan);
    const website = this.website(input.website);
    const email = input.email ? emailOf(input.email) : '';
    const gstin = optional(input.gstin, 15).toUpperCase();
    if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) fail(400, 'Enter a valid GSTIN, or leave it blank.');
    const tan = optional(input.tan, 10).toUpperCase();
    if (tan && !/^[A-Z]{4}[0-9]{5}[A-Z]$/.test(tan)) fail(400, 'Enter a valid TAN, or leave it blank.');
    const phone = optional(input.phone, 30);
    if (phone && !/^\+?[0-9][0-9\s().-]{5,22}$/.test(phone)) fail(400, 'Enter a valid phone number, or leave it blank.');
    stored.profile = {
      address: optional(input.address, 400),
      zip: optional(input.zip, 12),
      country: optional(input.country, 80) || 'India',
      phone,
      email,
      website,
      gstin,
      tan,
    };
    await this.prisma.company.update({
      where: { id: session.companyId },
      data: { name, legalName, state, city, panEnc: seal(pan, this.key) },
    });
  }

  private async saveAccount(session: SessionUser, input: Record<string, unknown>, stored: StoredSettings): Promise<void> {
    const id = optional(input.id, 32);
    const current = stored.bankAccounts.find((row) => row.id === id);
    if (id && !current) fail(404, 'That salary account was not found.');
    if (input.remove === true) {
      if (!current) fail(404, 'That salary account was not found.');
      stored.bankAccounts = stored.bankAccounts.filter((row) => row.id !== id);
    } else {
      const number = optional(input.accountNumber, 30).replace(/[\s-]+/g, '');
      if (!current && !number) fail(400, 'Enter the account number.');
      if (number && !/^\d{9,18}$/.test(number)) fail(400, 'The account number must be 9 to 18 digits.');
      const ifsc = optional(input.ifsc, 11).toUpperCase();
      if (!ifsc) fail(400, 'Enter the IFSC of the branch that holds this account.');
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) fail(400, 'The IFSC must be 11 characters: 4 letters, a zero, then 6 letters or digits, like HDFC0001234.');
      const label = text(input.label, 'Label', 60);
      const name = text(input.bankName, 'Bank name', 80);
      const plain = number || openSecret(current?.accountEnc || '', this.key);
      const clash = stored.bankAccounts.find((row) => row.id !== id && row.ifsc === ifsc && openSecret(row.accountEnc, this.key) === plain);
      if (clash) fail(400, 'This account is already saved as ' + clash.label + '.');
      const named = stored.bankAccounts.find((row) => row.id !== id && row.label.toLowerCase() === label.toLowerCase());
      if (named) fail(400, 'Another salary account is already called ' + named.label + '. Use a different label.');
      const wanted = Array.isArray(input.locationIds) ? [...new Set(input.locationIds.map(String))].slice(0, 200) : current?.locationIds || [];
      const offices = wanted.length ? await this.prisma.location.findMany({ where: { companyId: session.companyId, id: { in: wanted } }, select: { id: true, name: true } }) : [];
      if (offices.length !== wanted.length) fail(400, 'Choose locations that exist in Organisation.');
      for (const office of offices) {
        const owner = stored.bankAccounts.find((row) => row.id !== id && row.locationIds.includes(office.id));
        if (owner) fail(400, office.name + ' is already paid from ' + owner.label + '. Take it off that account first.');
      }
      const account: SalaryAccount = {
        id: current?.id || randomBytes(8).toString('hex'),
        label,
        name,
        accountName: optional(input.accountName, 120),
        ifsc,
        accountEnc: number ? seal(number, this.key) : current?.accountEnc || '',
        isDefault: flag(input.isDefault, current ? current.isDefault : !stored.bankAccounts.some((row) => row.isDefault)),
        active: flag(input.active, current ? current.active : true),
        locationIds: offices.map((office) => office.id),
      };
      if (account.isDefault && !account.active) fail(400, 'The default salary account must be on. Make another account the default first.');
      if (account.isDefault) for (const row of stored.bankAccounts) row.isDefault = false;
      if (current) Object.assign(current, account);
      else stored.bankAccounts.push(account);
      if (stored.bankAccounts.length > 10) fail(400, 'Ten salary accounts is the limit.');
    }
    if (!stored.bankAccounts.some((row) => row.isDefault)) {
      const next = stored.bankAccounts.find((row) => row.active);
      if (next) next.isDefault = true;
    }
    const main = stored.bankAccounts.find((row) => row.isDefault);
    stored.bank = main ? { name: main.name, accountName: main.accountName, ifsc: main.ifsc, accountEnc: main.accountEnc } : { name: '', accountName: '', ifsc: '', accountEnc: '' };
  }

  /** Active salary accounts with the account number opened, for the payroll bank file. */
  async salaryAccounts(companyId: string) {
    const stored = await this.load(companyId);
    return stored.bankAccounts
      .filter((row) => row.active)
      .map((row) => ({ id: row.id, label: row.label, bank: row.name, ifsc: row.ifsc, account: openSecret(row.accountEnc, this.key), isDefault: row.isDefault, locationIds: row.locationIds }));
  }

  private saveSmtp(input: Record<string, unknown>, stored: StoredSettings): void {
    const id = optional(input.id, 32);
    if (input.remove === true) {
      if (!stored.smtp.some((row) => row.id === id)) fail(404, 'That mailbox was not found.');
      stored.smtp = stored.smtp.filter((row) => row.id !== id);
      for (const purpose of SMTP_PURPOSES) {
        if (stored.purposes[purpose] === id) stored.purposes[purpose] = '';
      }
      return;
    }
    const current = stored.smtp.find((row) => row.id === id);
    const password = String(input.password ?? '');
    if (!current && !password.trim()) fail(400, 'Enter the app password for this mailbox.');
    if (password && password.length > 200) fail(400, 'That password is too long.');
    const account: SmtpAccount = {
      id: current?.id || randomBytes(8).toString('hex'),
      label: text(input.label, 'Label', 60),
      host: text(input.host, 'Host', 120),
      port: this.whole(input.port, 0, 65535),
      username: emailOf(input.username),
      passwordEnc: password.trim() ? seal(password, this.key) : current?.passwordEnc || '',
      encryption: input.encryption === 'ssl' ? 'ssl' : 'tls',
      fromName: text(input.fromName, 'From name', 80),
      fromEmail: input.fromEmail ? emailOf(input.fromEmail) : emailOf(input.username),
      active: flag(input.active, true),
      isDefault: flag(input.isDefault, stored.smtp.length === 0),
    };
    if (!account.port) fail(400, 'Enter the SMTP port.');
    if (account.isDefault && account.active) {
      for (const row of stored.smtp) row.isDefault = false;
    }
    if (!account.active) account.isDefault = false;
    if (current) Object.assign(current, account);
    else stored.smtp.push(account);
    if (!stored.smtp.some((row) => row.isDefault && row.active)) {
      const next = stored.smtp.find((row) => row.active) || stored.smtp[0];
      if (next) next.isDefault = true;
    }
    if (stored.smtp.length > 12) fail(400, 'Twelve mailboxes is the limit.');
  }

  private savePurposes(input: Record<string, unknown>, stored: StoredSettings): void {
    for (const purpose of SMTP_PURPOSES) {
      const id = optional(input[purpose], 32);
      if (!id) {
        stored.purposes[purpose] = '';
        continue;
      }
      const account = stored.smtp.find((row) => row.id === id);
      if (!account) fail(400, 'Choose a mailbox that is already saved.');
      if (!account.active) fail(400, account.label + ' is switched off. Turn it on, or pick another mailbox.');
      if (!account.passwordEnc) fail(400, account.label + ' has no password saved yet. Edit it and save the app password.');
      stored.purposes[purpose] = id;
    }
  }

  private saveNumbering(input: Record<string, unknown>, stored: StoredSettings): void {
    const rows = Array.isArray(input.sequences) ? input.sequences : [];
    for (const type of SEQUENCE_TYPES) {
      const row = rows.map((item) => asRecord(item)).find((item) => item.type === type);
      if (!row) continue;
      const current = stored.numbering[type];
      current.prefix = this.prefix(row.prefix, current.prefix);
      current.padding = this.padding(row.padding, current.padding);
      current.includeYear = flag(row.includeYear, current.includeYear);
      current.resetYearly = flag(row.resetYearly, current.resetYearly);
    }
  }

  private saveStatutory(input: Record<string, unknown>, stored: StoredSettings): void {
    for (const key of ['pfEmployeeRate', 'pfEmployerRate', 'esiEmployeeRate', 'esiEmployerRate']) {
      const cleaned = String(input[key] ?? '').trim();
      if (cleaned && (!/^\d{1,2}(\.\d{1,2})?$/.test(cleaned) || Number(cleaned) > 100)) {
        fail(400, 'Enter each rate as a number from 0 to 100.');
      }
    }
    this.readStatutory(input, stored);
    if (stored.statutory.payDay < 1 || stored.statutory.payDay > 28) fail(400, 'Pay day must be between 1 and 28.');
  }

  private saveAttendance(input: Record<string, unknown>, stored: StoredSettings): void {
    this.readAttendance(input, stored);
  }

  private saveTemplates(input: Record<string, unknown>, stored: StoredSettings): void {
    stored.templates = this.checkedTemplates(input, stored.templates);
  }

  private checkedTemplates(input: Record<string, unknown>, current: StoredSettings['templates']): StoredSettings['templates'] {
    const design = this.readDesign(asRecord(input.design), current.design);
    const designRow = asRecord(input.design);
    const color = String(designRow.accent ?? '').trim();
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) fail(400, 'The accent colour needs a hex value such as #103860.');
    const secondary = String(designRow.secondary ?? '').trim();
    if (secondary && !/^#[0-9a-f]{6}$/i.test(secondary)) fail(400, 'The trim colour needs a hex value such as #e8c85c.');
    const items = { ...current.items };
    const rows = asRecord(input.items);
    for (const key of MAIL_KEYS) {
      const row = asRecord(rows[key]);
      if (!Object.keys(row).length) continue;
      const label = MAIL_CATALOG.find((item) => item.key === key)?.label || key;
      items[key] = {
        subject: text(row.subject, label + ' subject', 160),
        preheader: optional(row.preheader, 200),
        heading: optional(row.heading, 160),
        body: richOf(row.body, label + ' message', 4000, true),
        button: optional(row.button, 40),
        auto: flag(row.auto, false),
      };
    }
    return { design, items };
  }

  private readDesign(row: Record<string, unknown>, fallback: MailDesign): MailDesign {
    const layout = String(row.layout || fallback.layout) as MailLayout;
    const accent = String(row.accent ?? fallback.accent).trim();
    const secondary = String(row.secondary ?? fallback.secondary).trim();
    return {
      layout: MAIL_LAYOUTS.includes(layout) ? layout : fallback.layout,
      accent: /^#[0-9a-f]{6}$/i.test(accent) ? accent.toLowerCase() : '',
      secondary: /^#[0-9a-f]{6}$/i.test(secondary) ? secondary.toLowerCase() : '',
      tinted: flag(row.tinted, fallback.tinted),
      rounded: flag(row.rounded, fallback.rounded),
      showLogo: flag(row.showLogo, fallback.showLogo),
      headerTitle: clip(row.headerTitle, 120, fallback.headerTitle),
      headerTagline: clip(row.headerTagline, 160, fallback.headerTagline),
      showHeaderText: flag(row.showHeaderText, fallback.showHeaderText),
      signoff: clip(row.signoff, 200, fallback.signoff),
      footer: clip(row.footer, 300, fallback.footer),
      footerNote: clip(row.footerNote, 300, fallback.footerNote),
      showWebsite: flag(row.showWebsite, fallback.showWebsite),
    };
  }

  private readTemplates(source: Record<string, unknown>): StoredSettings['templates'] {
    const design = this.readDesign(asRecord(source.design), defaultDesign());
    const items = defaultTemplates();
    const rows = asRecord(source.items);
    for (const key of MAIL_KEYS) {
      const row = asRecord(rows[key]);
      if (!Object.keys(row).length) continue;
      items[key] = {
        subject: clip(row.subject, 160, items[key].subject) || items[key].subject,
        preheader: clip(row.preheader, 200, items[key].preheader),
        heading: clip(row.heading, 160, items[key].heading),
        body: sanitizeRich(clip(row.body, 16000, items[key].body)) || items[key].body,
        button: clip(row.button, 40, items[key].button),
        auto: flag(row.auto, false),
      };
    }
    const legacy: Array<[MailKey, string, string, string, string]> = [
      ['payslip', 'payslipSubject', 'payslipBody', 'Your payslip for {{month}}', 'Hello {{name}}, your payslip for {{month}} is ready.'],
      ['leave', 'leaveSubject', 'leaveBody', 'Leave request {{status}}', 'Hello {{name}}, your {{type}} leave from {{from}} to {{to}} is {{status}}.'],
      ['announcement', 'announcementSubject', 'announcementBody', '{{title}}', '{{body}}'],
    ];
    if (!Object.keys(rows).length) {
      for (const [key, subjectKey, bodyKey, oldSubject, oldBody] of legacy) {
        const subject = clip(source[subjectKey], 160);
        const body = clip(source[bodyKey], 2000);
        if (subject && subject !== oldSubject) items[key].subject = subject;
        if (body && body !== oldBody) {
          const safe = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          items[key].body = safe.split(/\n{2,}/).map((part) => '<p>' + part.replace(/\n/g, '<br>') + '</p>').join('');
        }
      }
    }
    return { design, items };
  }

  async previewMail(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const draft = await this.draftOf(session, body);
    const company = await this.company(session.companyId);
    const brand = await this.mailBrand(company, true);
    return renderMail(draft.design, draft.template, draft.item, brand, { name: session.name.split(' ')[0] || session.name, ...draft.item.sample });
  }

  async testMail(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const draft = await this.draftOf(session, body);
    const company = await this.company(session.companyId);
    const brand = await this.mailBrand(company, false);
    const mail = renderMail(draft.design, draft.template, draft.item, brand, { name: session.name.split(' ')[0] || session.name, ...draft.item.sample });
    const sent = await this.deliver(draft.stored, draft.item.key, [session.email], '[Test] ' + mail.subject, mail.html, mail.text);
    return sent.emailed
      ? { ok: true, message: 'Test sent to ' + session.email + '. Check the inbox and the spam folder.' }
      : { ok: false, message: sent.note };
  }

  /** A one-off email, such as a birthday wish, filled for one person and optionally edited by the sender. */
  async personalMail(companyId: string, key: MailKey, tokens: Record<string, string>, edit?: { subject: string; heading: string; body: string }, preview = true) {
    const stored = await this.load(companyId);
    const item = MAIL_CATALOG.find((row) => row.key === key);
    const template = stored.templates.items[key];
    if (!item || !template) fail(400, 'That email is not set up.');
    const company = await this.company(companyId);
    const brand = await this.mailBrand(company, preview);
    const filled = filledTemplate(template, { company: brand.company, ...tokens });
    const next = { ...template, ...(edit || filled) };
    const mail = renderMail(stored.templates.design, next, item, brand, tokens);
    return { subject: next.subject, heading: next.heading, body: next.body, html: mail.html };
  }

  async sendTemplate(companyId: string, key: MailKey, to: string[], tokens: Record<string, string>, manual = false, edit?: { subject: string; heading: string; body: string }): Promise<{ emailed: boolean; note: string }> {
    const stored = await this.load(companyId);
    const item = MAIL_CATALOG.find((row) => row.key === key);
    const saved = stored.templates.items[key];
    if (!item || !saved) return { emailed: false, note: 'That email is not set up.' };
    const template = edit ? { ...saved, ...edit } : saved;
    if (item.automatic && !manual && !template.auto) return { emailed: false, note: 'Automatic email is off for this message.' };
    const recipients = [...new Set(to.map((row) => row.trim().toLowerCase()).filter((row) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row)))];
    if (!recipients.length) return { emailed: false, note: 'There is no email address to send to.' };
    const company = await this.company(companyId);
    const brand = await this.mailBrand(company, false);
    const mail = renderMail(stored.templates.design, template, item, brand, tokens);
    return this.deliver(stored, key, recipients, mail.subject, mail.html, mail.text);
  }

  /** A short transactional email, such as a password reset link. Sent through the onboarding mailbox. */
  async sendSystemMail(companyId: string, to: string, subject: string, paragraphs: string[], button?: { label: string; url: string }): Promise<{ emailed: boolean; note: string }> {
    const stored = await this.load(companyId);
    const company = await this.company(companyId);
    const brand = await this.mailBrand(company, false);
    const esc = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
    const accent = /^#[0-9a-f]{6}$/i.test(brand.accent) ? brand.accent : '#103860';
    const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#1b2733;line-height:1.5">`
      + `<div style="border-bottom:3px solid #e8c85c;padding-bottom:10px;margin-bottom:18px;font-size:18px;font-weight:700;color:${accent}">${esc(brand.company)}</div>`
      + paragraphs.map((text) => `<p style="margin:0 0 14px">${esc(text)}</p>`).join('')
      + (button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:${accent};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;display:inline-block;font-weight:600">${esc(button.label)}</a></p><p style="margin:0;color:#5b6b7a;font-size:12px">If the button does not work, copy this link: ${esc(button.url)}</p>` : '')
      + `</div>`;
    const text = [...paragraphs, ...(button ? [`${button.label}: ${button.url}`] : [])].join('\n\n');
    return this.deliver(stored, 'welcome', [to], subject, html, text);
  }

  private async draftOf(session: SessionUser, body: unknown) {
    const input = bag(body);
    const key = String(input.key || '') as MailKey;
    const item = MAIL_CATALOG.find((row) => row.key === key);
    if (!item) fail(400, 'Choose an email template.');
    const stored = await this.load(session.companyId);
    const checked = this.checkedTemplates({ design: input.design, items: { [key]: input.template } }, stored.templates);
    return { stored, item, design: checked.design, template: checked.items[key] };
  }

  private async mailBrand(company: { id: string; name: string; brandJson: string; city?: string }, preview: boolean) {
    const view = this.brand.view(company as Parameters<BrandService['view']>[0]);
    const stored = await this.load(company.id);
    const origin = (process.env.WEB_ORIGIN || 'http://localhost:4400').replace(/\/$/, '');
    let logoSrc = '';
    if (view.hasLogo) {
      if (preview) {
        const image = await this.brand.image(company.id, 'logo');
        if (image) logoSrc = 'data:' + image.type + ';base64,' + image.bytes.toString('base64');
      } else if (!/\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(origin)) {
        logoSrc = origin + '/v1/mail/logo/' + company.id;
      }
    }
    return {
      company: view.name || company.name,
      logoSrc,
      website: view.website || stored.profile.website,
      origin,
      accent: view.colors.primary || '#103860',
      phone: stored.profile.phone || '',
      email: stored.profile.email || '',
      city: company.city || '',
      address: stored.profile.address || '',
    };
  }

  private async deliver(stored: StoredSettings, key: MailKey, to: string[], subject: string, html: string, textBody: string): Promise<{ emailed: boolean; note: string }> {
    const purpose = smtpPurposeOf(key);
    const ready = (row: SmtpAccount) => row.active && Boolean(row.passwordEnc);
    const preferred = stored.purposes[purpose];
    const account = (preferred ? stored.smtp.find((row) => row.id === preferred && ready(row)) : undefined)
      || stored.smtp.find((row) => row.isDefault && ready(row))
      || stored.smtp.find(ready);
    if (!account) {
      const assigned = preferred ? stored.smtp.find((row) => row.id === preferred) : undefined;
      if (assigned && !assigned.active) return { emailed: false, note: 'The mailbox for this mail type is switched off. Turn it on in Settings → Email, or pick another.' };
      if (assigned && !assigned.passwordEnc) return { emailed: false, note: 'The mailbox for this mail type has no password. Edit it in Settings → Email.' };
      return { emailed: false, note: 'Add a mailbox in Settings → Email to send this.' };
    }
    const transport = nodemailer.createTransport({
      host: account.host,
      port: account.port,
      secure: account.encryption === 'ssl',
      auth: { user: account.username, pass: openSecret(account.passwordEnc, this.key) },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
    });
    const from = `"${account.fromName}" <${account.fromEmail || account.username}>`;
    try {
      if (to.length === 1) {
        await transport.sendMail({ from, to: to[0], subject, html, text: textBody });
      } else {
        for (let start = 0; start < to.length; start += 40) {
          await transport.sendMail({ from, to: account.fromEmail || account.username, bcc: to.slice(start, start + 40), subject, html, text: textBody });
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The mailbox could not send.';
      return { emailed: false, note: 'The mailbox could not send: ' + message.slice(0, 160) };
    }
    return { emailed: true, note: to.length === 1 ? 'Emailed ' + to[0] + '.' : 'Emailed ' + to.length + ' people.' };
  }

  /** Picks the default enabled integration account for WhatsApp, SMS or webhooks. */
  async pickIntegration(companyId: string, channel: IntegrationKey, purpose?: string): Promise<StoredIntegration | null> {
    const stored = await this.load(companyId);
    if (!isMultiAccountKey(channel)) {
      const row = stored.integrations[channel];
      return integrationReady(channel, row) ? row : null;
    }
    const row = stored.integrations[channel];
    const account = pickIntegrationAccount(channel, row, purpose);
    return account ? accountToRow(account) : null;
  }

  private saveConnection(input: Record<string, unknown>, stored: StoredSettings): string {
    const key = text(input.key, 'Integration', 40);
    if (!INTEGRATION_KEYS.includes(key as IntegrationKey)) fail(400, 'That integration is not available.');
    const name = key as IntegrationKey;
    const current = stored.integrations[name];
    if (isMultiAccountKey(name)) {
      if (input.remove === true) {
        const removed = text(input.id, 'Connection', 32);
        removeIntegrationAccount(name, current, removed);
        delete stored.tests[`${name}:${removed}`];
        delete stored.tests[name];
        return '';
      }
      if (input.setDefault === true) {
        setDefaultIntegrationAccount(name, current, text(input.id, 'Connection', 32));
        return '';
      }
      const savedId = upsertIntegrationAccount(name, current, input, (plain) => seal(plain, this.key));
      delete stored.tests[`${name}:${savedId}`];
      delete stored.tests[name];
      return '';
    }
    if (name === 'api') {
      const config = current.configs.altamid || { fields: {}, secrets: {} };
      let issued = '';
      if (input.generate === true) {
        issued = 'hrms_' + randomBytes(24).toString('base64url');
        config.secrets.key = seal(issued, this.key);
        config.fields.keyHash = this.apiKeyHash(issued);
      }
      current.configs.altamid = config;
      current.provider = 'altamid';
      current.enabled = input.generate === true ? true : flag(input.enabled, false);
      if (config.secrets.key && !config.fields.keyHash) {
        const plain = openSecret(config.secrets.key, this.key);
        if (plain) config.fields.keyHash = this.apiKeyHash(plain);
      }
      if (current.enabled && !config.secrets.key) fail(400, 'Generate a key before switching the API on.');
      return issued;
    }
    saveIntegration(name, current, input, (plain) => seal(plain, this.key));
    delete stored.tests[name];
    return '';
  }

  /** Company bank and salary-file options used by the payroll bank file. */
  async bankFileOptions(companyId: string) {
    const stored = await this.load(companyId);
    return bankOptions(stored.integrations.bank);
  }

  private async runTest(session: SessionUser, input: Record<string, unknown>, stored: StoredSettings): Promise<void> {
    const target = text(input.target, 'Target', 40);
    if (target === 'smtp') {
      const account = stored.smtp.find((row) => row.id === optional(input.id, 32));
      if (!account) fail(404, 'That mailbox was not found.');
      const password = openSecret(account.passwordEnc, this.key);
      const transport = nodemailer.createTransport({
        host: account.host,
        port: account.port,
        secure: account.encryption === 'ssl',
        auth: { user: account.username, pass: password },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
      });
      try {
        await transport.verify();
        await transport.sendMail({
          from: `"${account.fromName}" <${account.fromEmail || account.username}>`,
          to: session.email,
          subject: 'Altamid HRMS mailbox test',
          text: 'This mailbox can send payslips, leave decisions and announcements from Altamid HRMS.',
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The mailbox refused the connection.';
        stored.tests['smtp:' + account.id] = { ok: false, message: message.slice(0, 240), at: new Date().toISOString() };
        return;
      }
      stored.tests['smtp:' + account.id] = { ok: true, message: 'Test message sent to ' + session.email + '.', at: new Date().toISOString() };
      return;
    }
    if (target === 'ai') {
      const id = optional(input.id, 40);
      const row = id ? stored.ai.accounts.find((item) => item.id === id) : stored.ai.accounts.find((item) => item.id === stored.ai.defaultAccountId);
      if (!row || !row.apiKeyEnc) {
        stored.tests.ai = { ok: false, message: 'Save a provider, API key and model first.', at: new Date().toISOString() };
        return;
      }
      const result = await pingAccount({
        provider: row.provider,
        model: row.model,
        apiKey: openSecret(row.apiKeyEnc, this.key),
        baseUrl: row.baseUrl,
      } satisfies ProviderAccount);
      stored.tests['ai:' + row.id] = { ok: result.ok, message: result.message.slice(0, 240), at: new Date().toISOString() };
      stored.tests.ai = stored.tests['ai:' + row.id];
      return;
    }
    if (!INTEGRATION_KEYS.includes(target as IntegrationKey)) fail(400, 'That connection cannot be tested.');
    const name = target as IntegrationKey;
    const readers = name === 'biometric'
      ? await this.prisma.attendanceDevice.findMany({ where: { companyId: session.companyId }, select: { name: true, active: true, lastSeenAt: true } })
      : [];
    let row = stored.integrations[name];
    let testKey: string = name;
    if (isMultiAccountKey(name)) {
      const id = optional(input.id, 32);
      const account = id ? row.accounts?.find((item) => item.id === id) : pickIntegrationAccount(name, row);
      if (!account) {
        stored.tests[name] = { ok: false, message: 'That connection was not found.', at: new Date().toISOString() };
        return;
      }
      row = accountToRow(account);
      testKey = `${name}:${account.id}`;
    }
    const result = await testIntegration(name, row, (sealed) => openSecret(sealed, this.key), {
      bank: { name: stored.bank.name, ifsc: stored.bank.ifsc, hasAccount: stored.bankAccounts.some((row) => row.active && row.accountEnc) },
      readers,
    });
    const note = { ok: result.ok, message: result.message.slice(0, 400), at: new Date().toISOString() };
    stored.tests[testKey] = note;
    if (isMultiAccountKey(name)) {
      const primary = pickIntegrationAccount(name, stored.integrations[name]);
      if (primary && testKey === `${name}:${primary.id}`) stored.tests[name] = note;
    } else {
      stored.tests[name] = note;
    }
  }

  private present(company: { name: string; legalName: string; state: string; city: string; panEnc: string }, stored: StoredSettings, codes: string[]) {
    const year = Number(todayInIndia().slice(0, 4));
    const account = openSecret(stored.bank.accountEnc, this.key);
    return {
      company: {
        name: company.name,
        legalName: company.legalName,
        state: company.state,
        city: company.city,
        pan: openSecret(company.panEnc, this.key),
        ...stored.profile,
      },
      bank: {
        name: stored.bank.name,
        accountName: stored.bank.accountName,
        ifsc: stored.bank.ifsc,
        accountMask: maskSecret(account),
        hasAccount: Boolean(account),
      },
      bankAccounts: stored.bankAccounts.map((row) => ({
        id: row.id,
        label: row.label,
        name: row.name,
        accountName: row.accountName,
        ifsc: row.ifsc,
        accountMask: maskSecret(openSecret(row.accountEnc, this.key)),
        isDefault: row.isDefault,
        active: row.active,
        locationIds: row.locationIds,
      })),
      smtp: stored.smtp.map((row) => ({
        id: row.id,
        label: row.label,
        host: row.host,
        port: row.port,
        username: row.username,
        encryption: row.encryption,
        fromName: row.fromName,
        fromEmail: row.fromEmail,
        active: row.active,
        isDefault: row.isDefault,
        hasPassword: Boolean(row.passwordEnc),
        lastTest: stored.tests['smtp:' + row.id] || null,
      })),
      purposes: stored.purposes,
      numbering: SEQUENCE_TYPES.map((type) => {
        const rule = stored.numbering[type];
        const last = type === 'employee' ? this.sequenceLast(codes, rule, year) : rule.lastNumber;
        return { type, label: SEQUENCE_LABELS[type], ...rule, lastNumber: last, preview: this.preview(rule, last + 1, year) };
      }),
      statutory: stored.statutory,
      attendance: stored.attendance,
      integrations: INTEGRATION_KEYS.map((key) => {
        const row = stored.integrations[key];
        const ready = integrationReady(key, row);
        const shown = presentIntegration(key, row, (sealed) => maskSecret(openSecret(sealed, this.key)));
        const accounts = isMultiAccountKey(key) ? presentIntegrationAccounts(key, row, (sealed) => maskSecret(openSecret(sealed, this.key)), stored.tests) : undefined;
        const readyCount = accounts?.filter((item) => item.status === 'on').length ?? 0;
        const accountCount = accounts?.length ?? 0;
        const multiLabel = accountCount ? `${readyCount} of ${accountCount} ready` : 'No accounts yet';
        return {
          key,
          ...this.integrationCopy(key),
          ...shown,
          providerLabel: accounts ? multiLabel : shown.providerLabel,
          accounts,
          accountCount,
          status: ready ? 'on' : 'off',
          statusLabel: ready
            ? (key === 'api' ? 'Ready' : 'On')
            : accounts?.length
              ? (readyCount ? 'Partly ready' : 'Needs details')
              : row.enabled
                ? 'Needs details'
                : 'Off',
          lastTest: stored.tests[key] || null,
        };
      }),
      integrationCatalog: CATALOG,
      templates: { ...stored.templates, catalog: MAIL_CATALOG },
      ai: { ...presentAiSettings(stored.ai), lastTest: stored.tests.ai || null },
      issuedKey: '',
    };
  }

  private integrationCopy(key: IntegrationKey): { title: string; blurb: string; summary: string } {
    const copy: Record<IntegrationKey, { title: string; blurb: string; summary: string }> = {
      whatsapp: {
        title: 'WhatsApp',
        blurb: 'Meta, Twilio, Gupshup, AiSensy, WATI and more',
        summary: 'Saved for payslip and leave alerts. Sending is not live yet; Test checks the credentials with the provider where it can.',
      },
      sms: {
        title: 'SMS',
        blurb: 'MSG91, Twilio, Textlocal, Fast2SMS, Exotel and more',
        summary: 'Saved for punch, leave and payslip alerts. Sending is not live yet; Test checks the credentials with the provider where it can. Indian SMS needs a DLT-approved sender id.',
      },
      biometric: {
        title: 'Biometric attendance',
        blurb: 'eSSL, ZKTeco, Matrix, Suprema and more',
        summary: 'Fingerprint, face and card readers send each punch to Attendance as it happens. The reader keeps the biometric. Altamid stores only the punch.',
      },
      bank: {
        title: 'Salary bank file',
        blurb: 'HDFC, ICICI, SBI, Axis, Kotak and more',
        summary: 'Shapes the salary transfer file from Payroll month: payment mode, client code and narration. The debit account comes from General → Salary accounts.',
      },
      accounting: {
        title: 'Accounting',
        blurb: 'TallyPrime, Zoho Books, QuickBooks, Xero, Busy',
        summary: 'Where payroll journals will go. Posting is not live yet; Test checks the connection where it can.',
      },
      webhook: {
        title: 'Team chat and webhooks',
        blurb: 'Slack, Teams, Google Chat, Discord, any HTTPS',
        summary: 'Test posts a real message to the channel. Hire, leave and payroll alerts can use the same hook later.',
      },
      api: {
        title: 'API',
        blurb: 'Key for this company',
        summary: 'Company REST API at /v1/external. Send Authorization: Bearer hrms_… or X-Api-Key. Generating a key replaces the previous one and shows it once.',
      },
    };
    return copy[key];
  }

  private sequenceLast(codes: string[], rule: SequenceRule, year: number): number {
    const head = rule.includeYear ? `${rule.prefix}${year}` : rule.prefix;
    const pattern = new RegExp('^' + head.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
    let max = 0;
    for (const code of codes) {
      const match = pattern.exec(code);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return max;
  }

  private preview(rule: SequenceRule, next: number, year: number): string {
    const head = rule.includeYear ? `${rule.prefix}${year}` : rule.prefix;
    return head + String(next).padStart(rule.padding, '0');
  }

  private website(value: unknown): string {
    const cleaned = optional(value, 190);
    if (!cleaned) return '';
    if (!/^https?:\/\/[^\s]+$/i.test(cleaned)) fail(400, 'Website must start with http:// or https://, or stay blank.');
    return cleaned;
  }

  private prefix(value: unknown, fallback: string): string {
    const cleaned = String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    if (!cleaned) return fallback;
    if (cleaned.length > 12) fail(400, 'A prefix can be at most 12 characters.');
    return cleaned;
  }

  private padding(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8) return fallback;
    return parsed;
  }

  private whole(value: unknown, fallback: number, max: number): number {
    if (value === undefined || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > max) return fallback;
    return parsed;
  }

  private rate(value: unknown, fallback: string): string {
    const cleaned = String(value ?? '').trim();
    if (!cleaned) return fallback;
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(cleaned)) return fallback;
    if (Number(cleaned) > 100) return fallback;
    return cleaned;
  }

  private clock(value: unknown, fallback: string): string {
    const cleaned = String(value ?? '').trim();
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(cleaned) ? cleaned : fallback;
  }
}
