import { Injectable } from '@nestjs/common';
import { todayInIndia } from './dates';
import { bag, emailOf, fail, optional, text } from './http';
import { integrationReady } from './integrations';
import { LeaveLedger } from './leave-ledger.service';
import { ApplicantService } from './applicant.service';
import { LicenceService } from './licence.service';
import { PrismaService } from './prisma.service';
import { SettingsService } from './settings.service';

@Injectable()
export class ExternalApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly leave: LeaveLedger,
    private readonly applicants: ApplicantService,
    private readonly licence: LicenceService,
  ) {}

  async me(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
    if (!company) fail(404, 'Company not found.');
    return { ok: true, company: { id: company.id, name: company.name } };
  }

  async employees(companyId: string, pageRaw: string, limitRaw: string) {
    const page = Math.max(1, Math.min(500, Number(pageRaw) || 1));
    const limit = Math.max(1, Math.min(100, Number(limitRaw) || 25));
    const skip = (page - 1) * limit;
    const where = { companyId, status: { in: ['active', 'onboarding'] } };
    const [total, rows] = await Promise.all([
      this.prisma.employee.count({ where }),
      this.prisma.employee.findMany({
        where,
        orderBy: { code: 'asc' },
        skip,
        take: limit,
        select: {
          id: true,
          code: true,
          firstName: true,
          lastName: true,
          email: true,
          status: true,
          dateOfJoining: true,
          department: { select: { name: true } },
          designation: { select: { name: true } },
        },
      }),
    ]);
    return {
      page,
      limit,
      total,
      employees: rows.map((row) => ({
        id: row.id,
        code: row.code,
        name: `${row.firstName} ${row.lastName}`.trim(),
        email: row.email,
        status: row.status,
        dateOfJoining: row.dateOfJoining,
        department: row.department?.name || '',
        designation: row.designation?.name || '',
      })),
    };
  }

  async leaveBalances(companyId: string, employeeCode: string, yearRaw: string) {
    const code = text(employeeCode, 'Employee code', 40);
    const year = String(Number(yearRaw) || Number(todayInIndia().slice(0, 4)));
    const employee = await this.prisma.employee.findFirst({
      where: { companyId, code },
      select: { id: true, code: true, firstName: true, lastName: true },
    });
    if (!employee) fail(404, 'Employee not found.');
    const balances = await this.leave.balances(companyId, employee.id, year);
    return {
      employee: { id: employee.id, code: employee.code, name: `${employee.firstName} ${employee.lastName}`.trim() },
      year,
      balances: balances.map((row) => ({
        code: row.code,
        name: row.name,
        entitled: row.entitled,
        used: row.used,
        left: row.left,
      })),
    };
  }

  async createLead(companyId: string, body: unknown) {
    const input = bag(body);
    const name = text(input.name, 'Name', 120);
    const email = emailOf(input.email);
    const phone = optional(input.phone, 30);
    const message = optional(input.message, 1200);
    const jobTitle = optional(input.jobTitle, 120);
    const cooling = await this.applicants.cooling(companyId, { name, email, phone });
    const saved = await this.prisma.jobApplication.create({
      data: {
        companyId,
        name,
        email,
        phone,
        city: optional(input.city, 80),
        source: 'api',
        status: cooling ? 'cooling' : 'new',
        coolingUntil: cooling?.until || '',
        coolingNote: cooling?.reason || '',
        jobTitle,
        jobCode: optional(input.jobCode, 40),
        note: message,
        answersJson: JSON.stringify({ message, utm_source: optional(input.source, 80) }),
      },
    });
    await this.applicants.event(companyId, saved.id, 'received', 'Lead from company API', 'API');
    return { id: saved.id, status: saved.status, createdAt: saved.createdAt.toISOString() };
  }

  async assertApiEnabled(companyId: string): Promise<void> {
    await this.licence.assertFeature(companyId, 'api');
    const stored = await this.settings.companySettings(companyId);
    const row = stored.integrations.api;
    if (!integrationReady('api', row)) fail(403, 'Company API is disabled or not configured.');
  }

}