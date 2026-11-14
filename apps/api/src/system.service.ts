import { Injectable, RequestMethod, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { FEATURES, LADDER } from './access.service';
import { fail } from './http';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { PRODUCT_VERSION } from './version';

const DOMAINS: Record<string, string> = {
  Company: 'Company and setup', User: 'Company and setup', CompanyRole: 'Access and audit', AccessGrant: 'Access and audit', AuditEvent: 'Access and audit',
  Department: 'Organisation', Team: 'Organisation', Designation: 'Organisation', JobLevel: 'Organisation', Location: 'Organisation',
  Employee: 'People', DetailChange: 'People', OnboardingTask: 'People', ExitRequest: 'People', Asset: 'People', AssetEvent: 'People',
  LeaveType: 'Time', LeaveRequest: 'Time', Punch: 'Time', AttendanceDevice: 'Time', AttendanceRequest: 'Time', Holiday: 'Time',
  PayStructure: 'Pay', PayLayout: 'Pay', PaySlip: 'Pay', TaxForm: 'Pay',
  JobForm: 'Hiring', HiringDesk: 'Hiring', Vendor: 'Hiring', Opening: 'Hiring', JobApplication: 'Hiring',
  Announcement: 'Engagement', LibraryDoc: 'Engagement', HomeWidget: 'Engagement', Notification: 'Engagement', Recognition: 'Engagement',
};

const HIDDEN_FIELD = /(Enc|Hash|token|Token|secret|Secret|Json)$/;

const VERBS: Record<number, string> = {
  [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.PUT]: 'PUT', [RequestMethod.DELETE]: 'DELETE',
};

@Injectable()
export class SystemService {
  constructor(private readonly prisma: PrismaService) {}

  async map(session: SessionUser, controllers: Type<unknown>[]) {
    if (session.role !== 'owner') fail(403, 'Only the owner can open the system map.');
    const companyId = session.companyId;
    const models = Prisma.dmmf.datamodel.models;

    const entities = await Promise.all(models.map(async (model) => {
      const scoped = model.fields.some((field) => field.name === 'companyId');
      const delegate = (this.prisma as unknown as Record<string, { count: (args: unknown) => Promise<number> }>)[model.name.charAt(0).toLowerCase() + model.name.slice(1)];
      const records = model.name === 'Company' ? 1 : scoped && delegate ? await delegate.count({ where: { companyId } }) : null;
      return {
        name: model.name,
        domain: DOMAINS[model.name] || 'Other',
        records,
        fields: model.fields
          .filter((field) => field.kind !== 'object')
          .map((field) => ({
            name: field.name,
            type: field.type + (field.isList ? '[]' : '') + (field.isRequired ? '' : '?'),
            key: field.isId ? 'PK' : model.fields.some((other) => other.relationFromFields?.includes(field.name)) ? 'FK' : field.isUnique ? 'UK' : '',
            sealed: HIDDEN_FIELD.test(field.name),
          })),
      };
    }));

    const relations: Array<{ from: string; to: string; label: string; many: boolean; required: boolean }> = [];
    for (const model of models) {
      for (const field of model.fields) {
        if (field.kind !== 'object' || !field.relationFromFields?.length) continue;
        const target = models.find((item) => item.name === field.type);
        const back = target?.fields.find((item) => item.relationName === field.relationName && item.name !== field.name);
        relations.push({ from: field.type, to: model.name, label: field.name, many: !!back?.isList, required: field.isRequired });
      }
    }

    const routes = controllers.flatMap((controller) => {
      const base = String(Reflect.getMetadata(PATH_METADATA, controller) || '');
      const proto = controller.prototype as Record<string, unknown>;
      return Object.getOwnPropertyNames(proto).flatMap((name) => {
        const handler = proto[name];
        if (typeof handler !== 'function' || name === 'constructor') return [];
        const path = Reflect.getMetadata(PATH_METADATA, handler);
        const method = Reflect.getMetadata(METHOD_METADATA, handler);
        if (path === undefined || method === undefined) return [];
        const full = '/' + [base, String(path)].filter(Boolean).join('/').replace(/\/+/g, '/');
        return [{ method: VERBS[method as number] || 'ALL', path: full, open: controller.name === 'PublicController' }];
      });
    });
    const areas = new Map<string, { area: string; count: number; open: number }>();
    for (const route of routes) {
      const area = route.path.split('/')[2] || 'root';
      const row = areas.get(area) || { area, count: 0, open: 0 };
      row.count += 1;
      if (route.open) row.open += 1;
      areas.set(area, row);
    }

    const [company, locations, departments, teams, people] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
      this.prisma.location.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.department.findMany({ where: { companyId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.team.findMany({ where: { companyId }, select: { id: true, name: true, departmentId: true }, orderBy: { name: 'asc' } }),
      this.prisma.employee.findMany({ where: { companyId, status: { not: 'exited' } }, select: { departmentId: true, locationId: true, teamId: true } }),
    ]);
    const count = (key: 'departmentId' | 'locationId' | 'teamId', id: string) => people.filter((person) => person[key] === id).length;

    return {
      version: PRODUCT_VERSION,
      company: company?.name || '',
      entities,
      relations,
      routes: { total: routes.length, open: routes.filter((route) => route.open).length, areas: [...areas.values()].sort((a, b) => b.count - a.count) },
      ladder: LADDER,
      features: FEATURES.map((item) => ({ group: item.group, key: item.key, label: item.label, roles: item.roles })),
      org: {
        people: people.length,
        locations: locations.map((item) => ({ name: item.name, people: count('locationId', item.id) })),
        departments: departments.map((item) => ({
          name: item.name,
          people: count('departmentId', item.id),
          teams: teams.filter((team) => team.departmentId === item.id).map((team) => ({ name: team.name, people: count('teamId', team.id) })),
        })),
        looseTeams: teams.filter((team) => !departments.some((item) => item.id === team.departmentId)).map((team) => ({ name: team.name, people: count('teamId', team.id) })),
        unplaced: people.filter((person) => !person.departmentId).length,
      },
    };
  }
}
