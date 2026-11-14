import { Injectable } from '@nestjs/common';
import { fail } from './http';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

export const FEATURES: Array<{ group: string; key: string; label: string; hint: string; roles: string[]; through?: string[] }> = [
  { group: 'People', key: 'people', label: 'Directory', hint: 'The people list and the organisation chart', roles: ['owner', 'hr', 'payroll', 'accountant'] },
  { group: 'People', key: 'people.edit', label: 'Edit people', hint: 'Change employment, the role, and the sign-in', roles: ['owner', 'hr'] },
  { group: 'People', key: 'assets', label: 'Assets', hint: 'Laptops, phones, and ID cards. Issue them and take them back', roles: ['owner', 'hr', 'it'] },
  { group: 'People', key: 'exits', label: 'Exits desk', hint: 'Start an exit for someone, change the last day or waive notice, and run the checklist, full and final, and letters', roles: ['owner', 'hr'] },
  { group: 'People', key: 'performance', label: 'Performance reviews', hint: 'Run review cycles, see every goal and rating, and set the final rating', roles: ['owner', 'hr'] },
  { group: 'People', key: 'succession', label: 'Succession', hint: 'Key roles and who could step into them', roles: ['owner', 'hr'] },
  { group: 'Time', key: 'approvals', label: 'Approvals', hint: 'Decide leave and attendance. Team scope stays on that person’s own reports.', roles: ['owner', 'hr', 'manager', 'team-lead'] },
  { group: 'Time', key: 'attendance', label: 'Holidays', hint: 'Add and remove company holidays', roles: ['owner', 'hr'] },
  { group: 'Time', key: 'attendance.devices', label: 'Punch readers', hint: 'Connect a fingerprint, face, or card reader', roles: ['owner', 'hr'], through: ['attendance'] },
  { group: 'Time', key: 'exceptions', label: 'Exceptions', hint: 'Late, absent, and missed punches. Team scope sees their own line.', roles: ['owner', 'hr', 'payroll', 'manager', 'team-lead'] },
  { group: 'Time', key: 'attendance.live', label: 'Live punches', hint: 'The company live feed', roles: ['owner', 'hr', 'payroll'] },
  { group: 'Company', key: 'news', label: 'Announcements', hint: 'Post news for the company', roles: ['owner', 'hr'] },
  { group: 'Company', key: 'library', label: 'Library', hint: 'Handbooks, letters, and who may open them', roles: ['owner', 'hr'] },
  { group: 'Pay', key: 'pay', label: 'Payroll desk', hint: 'Open payroll. Also turns on CTC, the salary slip, and Form 16.', roles: ['owner', 'hr', 'payroll'] },
  { group: 'Pay', key: 'pay.structure', label: 'CTC', hint: 'Enter a person’s CTC by hand', roles: ['owner', 'hr', 'payroll'], through: ['pay'] },
  { group: 'Pay', key: 'pay.slip', label: 'Salary slip', hint: 'Enter a month and choose what the slip includes', roles: ['owner', 'hr', 'payroll'], through: ['pay'] },
  { group: 'Pay', key: 'pay.form', label: 'Form 16', hint: 'Upload a Form 16 PDF', roles: ['owner', 'hr', 'payroll'], through: ['pay'] },
  { group: 'Pay', key: 'pay.tax', label: 'Tax declarations', hint: 'Open the declaration window and check investment proofs', roles: ['owner', 'hr', 'payroll'], through: ['pay'] },
  { group: 'Pay', key: 'pay.flex', label: 'Choice pay', hint: 'Set flexible pay options and approve each person’s split', roles: ['owner', 'hr', 'payroll'], through: ['pay'] },
  { group: 'Pay', key: 'pay.rewards', label: 'Total rewards', hint: 'Benefits shown on each person’s total rewards statement', roles: ['owner', 'hr', 'payroll'], through: ['pay'] },
  { group: 'Company', key: 'surveys', label: 'Surveys', hint: 'Create surveys and read the results', roles: ['owner', 'hr'] },
  { group: 'Hiring', key: 'hiring', label: 'Hiring desk', hint: 'Openings and applications. Also turns on job forms.', roles: ['owner', 'hr'] },
  { group: 'Hiring', key: 'hiring.forms', label: 'Job forms', hint: 'Forms that receive applications from the website', roles: ['owner', 'hr'], through: ['hiring'] },
  { group: 'Company', key: 'reports', label: 'Reports', hint: 'Run and export reports. Each report also needs its own area, such as Payroll desk for salary reports.', roles: ['owner', 'hr', 'payroll', 'accountant'] },
  { group: 'Setup', key: 'settings', label: 'Settings', hint: 'Company, email, and the licence. Also turns on brand.', roles: ['owner', 'hr'] },
  { group: 'Setup', key: 'settings.brand', label: 'Brand', hint: 'Colours, logo, and icon', roles: ['owner', 'hr'], through: ['settings'] },
  { group: 'Setup', key: 'access', label: 'Access', hint: 'Who may manage each area, by role, department, or person', roles: ['owner'] },
];

const KINDS = ['role', 'department', 'person', 'level'] as const;

export const LADDER: Array<{ key: string; name: string; rank: number; scope: 'company' | 'team' }> = [
  { key: 'owner', name: 'Owner', rank: 100, scope: 'company' },
  { key: 'founder', name: 'Founder', rank: 90, scope: 'company' },
  { key: 'vp', name: 'VP', rank: 80, scope: 'company' },
  { key: 'director', name: 'Director', rank: 70, scope: 'company' },
  { key: 'hr', name: 'HR', rank: 60, scope: 'company' },
  { key: 'manager', name: 'Manager', rank: 50, scope: 'team' },
  { key: 'payroll', name: 'Payroll', rank: 45, scope: 'company' },
  { key: 'team-lead', name: 'Team lead', rank: 40, scope: 'team' },
  { key: 'accountant', name: 'Accountant', rank: 35, scope: 'company' },
  { key: 'it', name: 'IT', rank: 30, scope: 'company' },
  { key: 'admin', name: 'Admin', rank: 25, scope: 'company' },
  { key: 'maintenance', name: 'Maintenance', rank: 20, scope: 'company' },
  { key: 'employee', name: 'Employee', rank: 10, scope: 'company' },
];

@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  async keys(session: SessionUser): Promise<string[]> {
    if (session.role === 'owner') return FEATURES.map((item) => item.key);
    const grants = await this.ready(session.companyId);
    const place = await this.place(session);
    const held = new Set(FEATURES.map((item) => item.key).filter((feature) => this.granted(grants, feature, 'role', session.role) || this.granted(grants, feature, 'department', place.departmentId) || this.granted(grants, feature, 'level', place.levelId) || this.granted(grants, feature, 'person', session.employeeId || '')));
    if ([...held].some((key) => key.startsWith('pay.'))) held.add('pay');
    if (held.has('hiring.forms')) held.add('hiring');
    if (held.has('settings.brand')) held.add('settings');
    return [...held];
  }

  /** What a role holds on its own, before any department, grade or person grants. */
  async roleKeys(companyId: string, role: string): Promise<{ keys: string[]; scope: 'company' | 'team' }> {
    if (role === 'owner') return { keys: FEATURES.map((item) => item.key), scope: 'company' };
    const grants = await this.ready(companyId);
    const held = new Set(FEATURES.map((item) => item.key).filter((feature) => this.granted(grants, feature, 'role', role)));
    if ([...held].some((key) => key.startsWith('pay.'))) held.add('pay');
    if (held.has('hiring.forms')) held.add('hiring');
    if (held.has('settings.brand')) held.add('settings');
    return { keys: [...held], scope: await this.roleScope(companyId, role) };
  }

  async panel(session: SessionUser, employeeId?: string) {
    const id = employeeId || session.employeeId || '';
    if (!id) fail(400, 'This sign-in is not linked to a person.');
    const mine = id === session.employeeId;
    const editor = await this.holds(session, 'access');
    if (!mine && !editor) fail(403, 'You can open only your own access.');
    const person = await this.prisma.employee.findFirst({
      where: { id, companyId: session.companyId },
      include: { department: true, level: true, user: { select: { role: true } } },
    });
    if (!person) fail(404, 'That person was not found.');
    const role = person.user?.role || 'employee';
    const grants = await this.ready(session.companyId);
    const items = FEATURES.map((feature) => ({
      group: feature.group,
      key: feature.key,
      label: feature.label,
      hint: feature.hint,
      fromRole: this.direct(grants, feature.key, 'role', role),
      fromDepartment: this.direct(grants, feature.key, 'department', person.departmentId || ''),
      fromLevel: this.direct(grants, feature.key, 'level', person.levelId || ''),
      personal: this.direct(grants, feature.key, 'person', person.id),
      held: this.granted(grants, feature.key, 'role', role) || this.granted(grants, feature.key, 'department', person.departmentId || '') || this.granted(grants, feature.key, 'level', person.levelId || '') || this.granted(grants, feature.key, 'person', person.id) || role === 'owner',
    }));
    const ladder = await this.ensureLadder(session.companyId);
    const named = ladder.find((item) => item.key === role);
    return {
      employeeId: person.id,
      name: `${person.firstName} ${person.lastName}`.trim(),
      role: { id: role, label: named?.name || this.roleLabel(role), scope: named?.scope || 'company' },
      department: person.department ? { id: person.department.id, name: person.department.name } : null,
      level: person.level ? { id: person.level.id, name: person.level.name } : null,
      canEdit: editor,
      items,
    };
  }

  async savePanel(session: SessionUser, body: unknown) {
    await this.gate(session, 'access');
    const input = body && typeof body === 'object' ? body as { employeeId?: unknown; personal?: unknown; department?: unknown; level?: unknown } : {};
    const employeeId = String(input.employeeId || '');
    const person = await this.prisma.employee.findFirst({ where: { id: employeeId, companyId: session.companyId }, include: { level: true } });
    if (!person) fail(404, 'That person was not found.');
    const known = new Set(FEATURES.map((item) => item.key));
    const personal = this.cleanKeys(input.personal, known).filter((key) => session.role === 'owner' || key !== 'access');
    const department = this.cleanKeys(input.department, known).filter((key) => session.role === 'owner' || key !== 'access');
    const level = this.cleanKeys(input.level, known).filter((key) => session.role === 'owner' || key !== 'access');
    const spareAccess = session.role === 'owner' ? {} : { feature: { not: 'access' } };
    await this.ready(session.companyId);
    await this.prisma.accessGrant.deleteMany({ where: { companyId: session.companyId, subjectKind: 'person', subjectId: person.id, ...spareAccess } });
    if (personal.length) {
      await this.prisma.accessGrant.createMany({
        data: personal.map((feature) => ({ companyId: session.companyId, feature, subjectKind: 'person', subjectId: person.id })),
        skipDuplicates: true,
      });
    }
    if (person.departmentId) {
      await this.prisma.accessGrant.deleteMany({ where: { companyId: session.companyId, subjectKind: 'department', subjectId: person.departmentId, ...spareAccess } });
      if (department.length) {
        await this.prisma.accessGrant.createMany({
          data: department.map((feature) => ({ companyId: session.companyId, feature, subjectKind: 'department', subjectId: person.departmentId || '' })),
          skipDuplicates: true,
        });
      }
    }
    if (person.levelId) {
      await this.prisma.accessGrant.deleteMany({ where: { companyId: session.companyId, subjectKind: 'level', subjectId: person.levelId, ...spareAccess } });
      if (level.length) {
        await this.prisma.accessGrant.createMany({
          data: level.map((feature) => ({ companyId: session.companyId, feature, subjectKind: 'level', subjectId: person.levelId || '' })),
          skipDuplicates: true,
        });
      }
    }
    return this.panel(session, person.id);
  }

  async holds(session: SessionUser, feature: string): Promise<boolean> {
    return (await this.span(session, feature)) !== 'none';
  }

  async span(session: SessionUser, feature: string): Promise<'company' | 'team' | 'none'> {
    if (session.role === 'owner') return 'company';
    const grants = await this.ready(session.companyId);
    const place = await this.place(session);
    const explicit = this.granted(grants, feature, 'person', session.employeeId || '') || this.granted(grants, feature, 'department', place.departmentId) || this.granted(grants, feature, 'level', place.levelId);
    if (explicit) return 'company';
    const byRole = this.granted(grants, feature, 'role', session.role);
    if (!byRole) return 'none';
    if ((feature === 'approvals' || feature === 'exceptions') && (await this.roleScope(session.companyId, session.role)) === 'team') return 'team';
    return 'company';
  }

  async ensureLadder(companyId: string) {
    const rows = await this.prisma.companyRole.findMany({ where: { companyId }, select: { key: true } });
    const have = new Set(rows.map((row) => row.key));
    const missing = LADDER.filter((role) => !have.has(role.key));
    if (missing.length) {
      await this.prisma.companyRole.createMany({
        data: missing.map((role) => ({ companyId, ...role })),
        skipDuplicates: true,
      });
    }
    return this.prisma.companyRole.findMany({ where: { companyId }, orderBy: { rank: 'desc' } });
  }

  async addRole(session: SessionUser, body: unknown) {
    await this.gate(session, 'access');
    const input = body && typeof body === 'object' ? body as { name?: unknown; scope?: unknown } : {};
    const name = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    if (name.length < 2) fail(400, 'Name the role.');
    const scope = input.scope === 'team' ? 'team' : 'company';
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
    if (!/^[a-z][a-z0-9-]{1,23}$/.test(key)) fail(400, 'Use a name that can become a role.');
    const ladder = await this.ensureLadder(session.companyId);
    if (ladder.some((role) => role.key === key)) fail(409, 'That role is already on the ladder.');
    const next = ladder.filter((role) => role.key !== 'owner').reduce((low, role) => Math.min(low, role.rank), 100);
    await this.prisma.companyRole.create({ data: { companyId: session.companyId, key, name, rank: Math.max(11, next - 1), scope } });
    return this.ensureLadder(session.companyId);
  }

  async gate(session: SessionUser, feature: string, message = 'You do not have access to manage this.'): Promise<void> {
    if (!(await this.holds(session, feature))) fail(403, message);
  }

  async view(session: SessionUser) {
    await this.gate(session, 'access');
    const grants = await this.ready(session.companyId);
    const [departments, people] = await Promise.all([
      this.prisma.department.findMany({ where: { companyId: session.companyId }, orderBy: { name: 'asc' } }),
      this.prisma.employee.findMany({
        where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } },
        include: { department: true },
        orderBy: { firstName: 'asc' },
        take: 500,
      }),
    ]);
    return {
      features: FEATURES.map((item) => ({
        key: item.key,
        group: item.group,
        label: item.label,
        hint: item.hint,
        typical: item.roles,
        through: item.through || [],
      })),
      roles: (await this.ensureLadder(session.companyId)).map((role) => ({ id: role.key, label: role.name, locked: role.key === 'owner', scope: role.scope, rank: role.rank })),
      levels: (await this.prisma.jobLevel.findMany({ where: { companyId: session.companyId }, orderBy: { rank: 'desc' } })).map((row) => ({ id: row.id, name: row.name })),
      departments: departments.map((row) => ({ id: row.id, name: row.name })),
      people: people.map((row) => ({
        id: row.id,
        name: `${row.firstName} ${row.lastName}`.trim(),
        code: row.code,
        department: row.department?.name || '',
      })),
      grants: grants.map((grant) => ({ feature: grant.feature, kind: grant.subjectKind, id: grant.subjectId })),
    };
  }

  async save(session: SessionUser, body: unknown) {
    await this.gate(session, 'access');
    const raw = body && typeof body === 'object' ? (body as { grants?: unknown }).grants : null;
    if (!Array.isArray(raw)) fail(400, 'Choose who may manage each area.');
    const known = new Set(FEATURES.map((item) => item.key));
    const departments = new Set((await this.prisma.department.findMany({ where: { companyId: session.companyId }, select: { id: true } })).map((row) => row.id));
    const people = new Set((await this.prisma.employee.findMany({
      where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } },
      select: { id: true },
    })).map((row) => row.id));
    const next = new Map<string, { feature: string; subjectKind: string; subjectId: string }>();
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const feature = String((item as { feature?: string }).feature || '');
      const kind = String((item as { kind?: string }).kind || '');
      const id = String((item as { id?: string }).id || '');
      if (!known.has(feature) || !(KINDS as readonly string[]).includes(kind) || !id) continue;
      if (kind === 'role' && id === 'owner') continue;
      if (feature === 'access' && session.role !== 'owner') continue;
      if (kind === 'role' && !(await this.ensureLadder(session.companyId)).some((role) => role.key === id)) fail(400, 'That role is not on the ladder.');
      if (kind === 'level' && !(await this.prisma.jobLevel.findFirst({ where: { id, companyId: session.companyId } }))) fail(400, 'That grade is not in this company.');
      if (kind === 'department' && !departments.has(id)) fail(400, 'That department is not in this company.');
      if (kind === 'person' && !people.has(id)) fail(400, 'That person cannot be given access.');
      next.set(`${feature}:${kind}:${id}`, { feature, subjectKind: kind, subjectId: id });
    }
    for (const feature of known) next.set(`${feature}:role:owner`, { feature, subjectKind: 'role', subjectId: 'owner' });
    if (session.role !== 'owner') {
      const kept = await this.prisma.accessGrant.findMany({ where: { companyId: session.companyId, feature: 'access' } });
      for (const grant of kept) {
        next.set(`${grant.feature}:${grant.subjectKind}:${grant.subjectId}`, { feature: grant.feature, subjectKind: grant.subjectKind, subjectId: grant.subjectId });
      }
    }
    await this.ready(session.companyId);
    await this.prisma.accessGrant.deleteMany({ where: { companyId: session.companyId } });
    await this.prisma.accessGrant.createMany({
      data: [...next.values()].map((grant) => ({ companyId: session.companyId, ...grant })),
    });
    return this.view(session);
  }

  private async ready(companyId: string) {
    const rows = await this.prisma.accessGrant.findMany({ where: { companyId } });
    const have = new Set(rows.map((row) => row.feature));
    const missing = FEATURES.filter((feature) => !have.has(feature.key));
    const leadReady = rows.some((row) => row.subjectKind === 'role' && row.subjectId === 'team-lead');
    if (missing.length || !leadReady) {
      const data = [
        ...missing.flatMap((feature) => feature.roles.map((role) => ({
          companyId,
          feature: feature.key,
          subjectKind: 'role',
          subjectId: role,
        }))),
        ...(!leadReady ? ['approvals', 'exceptions'].map((feature) => ({
          companyId,
          feature,
          subjectKind: 'role',
          subjectId: 'team-lead',
        })) : []),
      ];
      if (data.length) {
        await this.prisma.accessGrant.createMany({ data, skipDuplicates: true });
        return this.prisma.accessGrant.findMany({ where: { companyId } });
      }
    }
    return rows;
  }

  private async roleScope(companyId: string, key: string): Promise<'company' | 'team'> {
    const ladder = await this.ensureLadder(companyId);
    const role = ladder.find((item) => item.key === key);
    return role?.scope === 'team' ? 'team' : 'company';
  }

  private granted(grants: Array<{ feature: string; subjectKind: string; subjectId: string }>, feature: string, kind: string, id: string): boolean {
    if (!id) return false;
    const item = FEATURES.find((row) => row.key === feature);
    const keys = new Set([feature, ...(item?.through || [])]);
    return grants.some((grant) => keys.has(grant.feature) && grant.subjectKind === kind && grant.subjectId === id);
  }

  private direct(grants: Array<{ feature: string; subjectKind: string; subjectId: string }>, feature: string, kind: string, id: string): boolean {
    if (!id) return false;
    return grants.some((grant) => grant.feature === feature && grant.subjectKind === kind && grant.subjectId === id);
  }

  private cleanKeys(value: unknown, known: Set<string>): string[] {
    if (!Array.isArray(value)) return [];
    return [...new Set(value.map((item) => String(item)).filter((item) => known.has(item)))];
  }

  private async place(session: SessionUser): Promise<{ departmentId: string; levelId: string }> {
    if (!session.employeeId) return { departmentId: '', levelId: '' };
    const row = await this.prisma.employee.findFirst({ where: { id: session.employeeId, companyId: session.companyId }, select: { departmentId: true, levelId: true } });
    return { departmentId: row?.departmentId || '', levelId: row?.levelId || '' };
  }

  private roleLabel(role: string): string {
    const labels: Record<string, string> = { owner: 'Owner', hr: 'HR', payroll: 'Payroll', accountant: 'Accountant', manager: 'Manager', employee: 'Employee' };
    return labels[role] || role;
  }
}
