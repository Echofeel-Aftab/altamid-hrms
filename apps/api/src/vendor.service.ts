import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { bag, emailOf, fail, optional, text } from './http';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { AccessService } from './access.service';

@Injectable()
export class VendorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
  ) {}

  async list(session: SessionUser) {
    await this.gates.gate(session, 'hiring', 'You do not have access to agencies and clients.');
    const [company, vendors] = await Promise.all([
      this.prisma.company.findFirst({ where: { id: session.companyId }, select: { hireViaAgencies: true, supplyManpower: true } }),
      this.prisma.vendor.findMany({ where: { companyId: session.companyId }, orderBy: { name: 'asc' }, take: 200 }),
    ]);
    return {
      hireViaAgencies: company?.hireViaAgencies === true,
      supplyManpower: company?.supplyManpower === true,
      vendors: vendors.map((row) => this.present(row)),
    };
  }

  async saveMode(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'hiring', 'You do not have access to agencies and clients.');
    const input = bag(body);
    await this.prisma.company.update({
      where: { id: session.companyId },
      data: {
        hireViaAgencies: input.hireViaAgencies === true,
        supplyManpower: input.supplyManpower === true,
      },
    });
    return this.list(session);
  }

  async save(session: SessionUser, body: unknown, id = '') {
    await this.gates.gate(session, 'hiring', 'You do not have access to agencies and clients.');
    const input = bag(body);
    const data = {
      name: text(input.name, 'Vendor name', 80),
      city: optional(input.city, 80),
      contactName: optional(input.contactName, 80),
      email: input.email ? emailOf(input.email) : '',
      phone: optional(input.phone, 20),
      note: optional(input.note, 400),
      hireThrough: input.hireThrough === true,
      suppliesUs: input.suppliesUs === true,
      weSupply: input.weSupply === true,
      active: input.active !== false,
    };
    if (!data.hireThrough && !data.suppliesUs && !data.weSupply) {
      fail(400, 'Choose at least one option: hiring through them, they supply people to you, or you supply people to them.');
    }
    try {
      if (id) {
        const current = await this.prisma.vendor.findFirst({ where: { id, companyId: session.companyId } });
        if (!current) fail(404, 'That vendor was not found.');
        const row = await this.prisma.vendor.update({ where: { id }, data });
        return this.present(row);
      }
      const row = await this.prisma.vendor.create({ data: { companyId: session.companyId, ...data } });
      return this.present(row);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') fail(409, 'That vendor name is already used.');
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') fail(404, 'That vendor was not found.');
      throw error;
    }
  }

  async remove(session: SessionUser, id: string) {
    await this.gates.gate(session, 'hiring', 'You do not have access to agencies and clients.');
    const row = await this.prisma.vendor.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) fail(404, 'That vendor was not found.');
    const [people, jobs] = await Promise.all([
      this.prisma.employee.count({ where: { companyId: session.companyId, OR: [{ agencyId: id }, { clientId: id }] } }),
      this.prisma.opening.count({ where: { companyId: session.companyId, agencyId: id } }),
    ]);
    if (people || jobs) fail(400, 'This vendor is still tied to a person or a job. Clear that link first.');
    await this.prisma.vendor.delete({ where: { id } });
    return { ok: true };
  }

  private present(row: { id: string; name: string; city: string; contactName: string; email: string; phone: string; note: string; hireThrough: boolean; suppliesUs: boolean; weSupply: boolean; active: boolean }) {
    return {
      id: row.id,
      name: row.name,
      city: row.city,
      contactName: row.contactName,
      email: row.email,
      phone: row.phone,
      note: row.note,
      hireThrough: row.hireThrough,
      suppliesUs: row.suppliesUs,
      weSupply: row.weSupply,
      active: row.active,
    };
  }
}
