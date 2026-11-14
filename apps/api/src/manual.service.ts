import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { BrandService } from './brand.service';
import { fail } from './http';
import { MANUAL, MANUAL_GROUPS, ManualReader } from './manual';
import { manualPdf } from './manual-pdf';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

export interface ManualView {
  company: string;
  preparedFor: string;
  roleLabel: string;
  forRole: string | null;
  generatedAt: string;
  index: Array<{ group: string; items: Array<{ id: string; title: string }> }>;
  sections: Array<{
    id: string;
    group: string;
    title: string;
    path: string;
    menu: string;
    why: string;
    example: string;
    tips: string[];
    howTo: Array<{ title: string; body: string; steps: string[] }>;
  }>;
  roles: Array<{ id: string; label: string }>;
}

@Injectable()
export class ManualService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
    private readonly brand: BrandService,
  ) {}

  async view(session: SessionUser, role?: string): Promise<ManualView> {
    const company = await this.prisma.company.findUnique({ where: { id: session.companyId } });
    if (!company) fail(404, 'That company was not found.');
    const manager = await this.gates.holds(session, 'access');
    const ladder = await this.gates.ensureLadder(session.companyId);
    const label = (key: string) => ladder.find((item) => item.key === key)?.name || key.charAt(0).toUpperCase() + key.slice(1);
    const wanted = (role || '').trim();
    let reader: ManualReader;
    let preparedFor: string;
    if (wanted) {
      if (!manager) fail(403, 'Only people who manage access can download a manual for a role.');
      if (!ladder.some((item) => item.key === wanted)) fail(404, 'That role is not on the ladder.');
      const held = await this.gates.roleKeys(session.companyId, wanted);
      reader = { keys: new Set(held.keys), role: wanted, owner: wanted === 'owner', person: true, master: false, payroll: true, teamScope: held.scope === 'team' };
      preparedFor = 'Everyone in the ' + label(wanted) + ' role';
    } else {
      reader = {
        keys: new Set(await this.gates.keys(session)),
        role: session.role,
        owner: session.role === 'owner',
        person: !!session.employeeId,
        master: session.master === true,
        payroll: !session.outletCountry || session.outletCountry === 'IN',
        teamScope: (await this.gates.span(session, 'approvals')) === 'team',
      };
      preparedFor = session.name;
    }
    const sections = MANUAL.filter((section) => !section.when || section.when(reader)).map((section) => ({
      id: section.id,
      group: section.group,
      title: section.title,
      path: section.path || '',
      menu: section.menu || '',
      why: section.why,
      example: section.example || '',
      tips: section.tips || [],
      howTo: section.howTo
        .filter((item) => !item.when || item.when(reader))
        .map((item) => ({ title: item.title, body: item.body || '', steps: item.steps || [] })),
    }));
    const index = MANUAL_GROUPS.map((group) => ({
      group,
      items: sections.filter((section) => section.group === group).map((section) => ({ id: section.id, title: section.title })),
    })).filter((block) => block.items.length);
    return {
      company: this.brand.view(company).name || company.name,
      preparedFor,
      roleLabel: label(reader.role),
      forRole: wanted || null,
      generatedAt: new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date()),
      index,
      sections,
      roles: manager ? ladder.map((item) => ({ id: item.key, label: item.name })) : [],
    };
  }

  async pdf(session: SessionUser, role?: string): Promise<{ type: string; bytes: Buffer; name: string }> {
    const view = await this.view(session, role);
    const company = await this.prisma.company.findUnique({ where: { id: session.companyId } });
    const colors = company ? this.brand.view(company).colors : {};
    const logo = await this.brand.image(session.companyId, 'logo');
    const bytes = await manualPdf(view, {
      primary: colors['primary'] || '#103860',
      accent: colors['accent'] || '#e8c85c',
      logo: logo && (logo.type === 'image/png' || logo.type === 'image/jpeg') ? logo.bytes : null,
    });
    const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hrms';
    return { type: 'application/pdf', bytes, name: `${slug(view.company)}-user-manual-${slug(view.roleLabel)}.pdf` };
  }
}
