import { randomBytes, randomUUID } from 'crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { Department, Designation, Location, Prisma } from '@prisma/client';
import { AccessService } from './access.service';
import { mayWaitOn, waitsOn } from './approval-flow';
import { AuthService } from './auth.service';
import { BrandService } from './brand.service';
import { dataKey, maskSecret, openSecret, seal } from './crypto';
import { REVIEW_COLUMNS, REVIEW_FIELDS, SELF_FIELDS } from './details';
import { kolkataDayRange, slugify, todayInIndia } from './dates';
import { bag, bankOf, emailOf, fail, ifscOf, oneOf, optional, optionalDay, optionalId, panOf, passwordOf, text } from './http';
import { LicenceService } from './licence.service';
import { unscoped } from './outlet-context';
import { PrismaService } from './prisma.service';
import { EMPLOYEE_STATUSES, isStaff, WORKER_TYPES } from './roles';
import { SessionUser } from './session';
import { SettingsService } from './settings.service';

const personInclude = {
  department: true,
  designation: true,
  location: true,
  level: true,
  team: true,
  agency: true,
  client: true,
  manager: { select: { id: true, firstName: true, lastName: true } },
  user: { select: { id: true, role: true, email: true, active: true } },
} satisfies Prisma.EmployeeInclude;

type PersonRow = Prisma.EmployeeGetPayload<{ include: typeof personInclude }>;

const EXTRA_SELF = ['personalEmail', 'fatherName', 'spouseName', 'emergencyRelation', 'city', 'state', 'pincode', 'permanentAddress', 'nomineeName', 'nomineeRelation'];

@Injectable()
export class DirectoryService {
  private readonly key = dataKey();

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly licence: LicenceService,
    private readonly brand: BrandService,
    private readonly settings: SettingsService,
    private readonly gates: AccessService,
  ) {}

  async start(body: unknown): Promise<{ token: string; name: string; role: string }> {
    const input = bag(body);
    const companyName = text(input.companyName, 'Company name', 120);
    const adminName = text(input.adminName, 'Your name', 80);
    const email = emailOf(input.email);
    const password = passwordOf(input.password);
    const state = text(input.state, 'State', 60);
    const legalName = optional(input.legalName, 160) || companyName;
    const passwordHash = await this.auth.hashPassword(password);
    const today = todayInIndia();
    let slug = slugify(companyName);
    if (await this.prisma.company.findUnique({ where: { slug } })) slug = `${slug}-${randomBytes(2).toString('hex')}`;

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.create({
          data: { name: companyName, legalName, slug, state, instanceId: randomUUID(), planCode: 'essentials' },
        });
        const outlet = await tx.outlet.create({ data: { companyId: company.id, name: 'Head office', code: 'HO', country: 'IN', state } });
        const outletId = outlet.id;
        const location = await tx.location.create({ data: { companyId: company.id, outletId, name: 'Head office', state } });
        const department = await tx.department.create({ data: { companyId: company.id, outletId, name: 'General' } });
        const designation = await tx.designation.create({ data: { companyId: company.id, name: 'Team member' } });
        const employee = await tx.employee.create({
          data: {
            companyId: company.id,
            outletId,
            code: 'EMP001',
            firstName: adminName.split(' ')[0] || adminName,
            lastName: adminName.split(' ').slice(1).join(' '),
            email,
            workerType: 'employee',
            status: 'active',
            departmentId: department.id,
            designationId: designation.id,
            locationId: location.id,
            dateOfJoining: today,
          },
        });
        const created = await tx.user.create({
          data: {
            companyId: company.id,
            email,
            passwordHash,
            name: adminName,
            role: 'owner',
            master: true,
            employeeId: employee.id,
          },
        });
        await tx.leaveType.createMany({
          data: [
            { companyId: company.id, outletId, name: 'Casual leave', code: 'CL', paid: true, daysPerYear: 12 },
            { companyId: company.id, outletId, name: 'Sick leave', code: 'SL', paid: true, daysPerYear: 12 },
            { companyId: company.id, outletId, name: 'Earned leave', code: 'EL', paid: true, daysPerYear: 18 },
            { companyId: company.id, outletId, name: 'Unpaid leave', code: 'LWP', paid: false, daysPerYear: 0 },
          ],
        });
        await tx.announcement.create({
          data: {
            companyId: company.id,
            title: 'Welcome to Altamid HRMS',
            body: 'Add your people, then let them punch in and apply for leave from My day. Payroll calculation is the next release, so nothing here invents a salary.',
            pinned: true,
            outletId: null,
            authorId: created.id,
            authorName: adminName,
          },
        });
        await tx.auditEvent.create({
          data: { companyId: company.id, outletId: null, actorId: created.id, action: 'company.start', entity: 'company', entityId: company.id },
        });
        return created;
      });
      return { token: this.auth.sign({ id: user.id }), name: user.name, role: user.role };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        fail(409, 'That email is already in use. Sign in, or use a different work email.');
      }
      throw error;
    }
  }

  async me(session: SessionUser) {
    const [company, licence, person, access, canSeePan] = await Promise.all([
      this.prisma.company.findUnique({ where: { id: session.companyId } }),
      this.licence.view(session.companyId),
      session.employeeId
        ? this.prisma.employee.findFirst({
            where: { id: session.employeeId, companyId: session.companyId },
            include: { department: true, location: true, designation: true },
          })
        : Promise.resolve(null),
      this.gates.keys(session),
      this.gates.holds(session, 'settings'),
    ]);
    if (!company) fail(404, 'That company was not found.');
    const pan = openSecret(company.panEnc, this.key);
    return {
      id: session.id,
      name: session.name,
      email: session.email,
      role: session.role,
      employeeId: session.employeeId,
      workplace: person ? {
        department: person.department?.name || '',
        location: person.location?.name || '',
        designation: person.designation?.name || '',
        phone: person.phone,
      } : null,
      company: {
        id: company.id,
        name: company.name,
        legalName: company.legalName,
        state: company.state,
        city: company.city,
        planCode: company.planCode,
        pan: canSeePan ? pan : maskSecret(pan),
        brand: this.brand.view(company),
      },
      licence: { mode: licence.mode, message: licence.message, reason: licence.reason },
      access,
    };
  }

  async updateCompany(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'settings', 'You do not have access to change the company.');
    const input = bag(body);
    const data: Prisma.CompanyUpdateInput = {};
    if (input.name !== undefined) data.name = text(input.name, 'Company name', 120);
    if (input.legalName !== undefined) data.legalName = text(input.legalName, 'Legal name', 160);
    if (input.state !== undefined) data.state = text(input.state, 'State', 60);
    if (input.city !== undefined) data.city = optional(input.city, 80);
    if (input.pan !== undefined) data.panEnc = seal(panOf(input.pan), this.key);
    await this.prisma.company.update({ where: { id: session.companyId }, data });
    await this.audit(session, 'company.update', 'company', session.companyId);
    return this.me(session);
  }

  async org(session: SessionUser) {
    await this.gates.gate(session, 'people', 'You do not have access to the organisation.');
    const [departments, designations, locations] = await Promise.all([
      this.prisma.department.findMany({ where: { companyId: session.companyId }, orderBy: { name: 'asc' } }),
      this.prisma.designation.findMany({ where: { companyId: session.companyId }, orderBy: { name: 'asc' } }),
      this.prisma.location.findMany({ where: { companyId: session.companyId }, orderBy: { name: 'asc' } }),
    ]);
    const [chart, total, counts, ladder, levels, teams] = await Promise.all([
      this.prisma.employee.findMany({
        where: { companyId: session.companyId },
        include: { department: true, designation: true, location: true },
        orderBy: { firstName: 'asc' },
        take: 400,
      }),
      this.prisma.employee.count({ where: { companyId: session.companyId } }),
      this.countHead(session.companyId),
      this.gates.ensureLadder(session.companyId),
      this.prisma.jobLevel.findMany({ where: { companyId: session.companyId }, orderBy: { rank: 'desc' } }),
      this.prisma.team.findMany({ where: { companyId: session.companyId }, orderBy: { name: 'asc' }, take: 200, include: { _count: { select: { employees: { where: { status: { in: ['active', 'onboarding'] } } } } } } }),
    ]);
    return {
      departments: departments.map(this.named),
      designations: designations.map(this.named),
      locations: locations.map((row) => ({ id: row.id, name: row.name, state: row.state, city: row.city })),
      chart: chart.map((row) => ({
        id: row.id,
        name: `${row.firstName} ${row.lastName}`.trim(),
        code: row.code,
        designation: row.designation?.name || '',
        department: row.department?.name || '',
        location: row.location?.name || '',
        status: row.status,
        workerType: row.workerType,
        managerId: row.managerId,
      })),
      chartLimited: total > chart.length,
      counts,
      roles: ladder.map((role) => ({ id: role.key, name: role.name, rank: role.rank, scope: role.scope })),
      levels: levels.map((row) => ({ id: row.id, name: row.name, rank: row.rank })),
      teams: teams.map((row) => ({ id: row.id, name: row.name, departmentId: row.departmentId, leadId: row.leadId, members: row._count.employees })),
    };
  }

  async addLevel(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const name = text(bag(body).name, 'Grade', 40);
    const rank = Number(bag(body).rank || 1);
    if (!Number.isInteger(rank) || rank < 1 || rank > 999) fail(400, 'Rank is a whole number from 1 to 999. A higher number sits higher on the ladder.');
    try {
      return await this.prisma.jobLevel.create({ data: { companyId: session.companyId, name, rank } });
    } catch (error) {
      this.unique(error, 'That grade already exists.');
    }
  }

  async setTeamLead(session: SessionUser, id: string, body: unknown) {
    await this.requireHr(session);
    const team = await this.prisma.team.findFirst({ where: { id, companyId: session.companyId } });
    if (!team) fail(404, 'That team was not found.');
    const leadId = optionalId(bag(body).leadId) || '';
    if (leadId && !(await this.prisma.employee.findFirst({ where: { id: leadId, companyId: session.companyId, status: { in: ['active', 'onboarding'] } } }))) {
      fail(400, 'Choose a current employee of this company as the team lead.');
    }
    const saved = await this.prisma.team.update({ where: { id }, data: { leadId } });
    return { id: saved.id, leadId: saved.leadId };
  }

  async addTeam(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const input = bag(body);
    const name = text(input.name, 'Team', 80);
    const departmentId = optionalId(input.departmentId) || '';
    if (departmentId && !(await this.prisma.department.findFirst({ where: { id: departmentId, companyId: session.companyId } }))) {
      fail(400, 'That department is not in this company.');
    }
    try {
      return await this.prisma.team.create({ data: { companyId: session.companyId, name, departmentId } });
    } catch (error) {
      this.unique(error, 'That team already exists.');
    }
  }

  private async countHead(companyId: string) {
    const [status, byDepartment, byLocation, departments, locations] = await Promise.all([
      this.prisma.employee.groupBy({ by: ['status'], where: { companyId }, _count: { _all: true } }),
      this.prisma.employee.groupBy({ by: ['departmentId'], where: { companyId, status: { not: 'exited' } }, _count: { _all: true } }),
      this.prisma.employee.groupBy({ by: ['locationId'], where: { companyId, status: { not: 'exited' } }, _count: { _all: true } }),
      this.prisma.department.findMany({ where: { companyId } }),
      this.prisma.location.findMany({ where: { companyId } }),
    ]);
    const label = (id: string | null, rows: Array<{ id: string; name: string }>) => rows.find((row) => row.id === id)?.name || 'Unassigned';
    const pack = (rows: Array<{ departmentId?: string | null; locationId?: string | null; _count: { _all: number } }>, key: 'departmentId' | 'locationId', names: Array<{ id: string; name: string }>) =>
      rows.map((row) => ({ name: label(row[key] || null, names), count: row._count._all })).sort((a, b) => b.count - a.count);
    return {
      active: status.find((row) => row.status === 'active')?._count._all || 0,
      onboarding: status.find((row) => row.status === 'onboarding')?._count._all || 0,
      exited: status.find((row) => row.status === 'exited')?._count._all || 0,
      departments: pack(byDepartment, 'departmentId', departments),
      locations: pack(byLocation, 'locationId', locations),
    };
  }

  async team(session: SessionUser) {
    const rows = await this.chartRows(session.companyId);
    const children = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.managerId) continue;
      const list = children.get(row.managerId) || [];
      list.push(row.id);
      children.set(row.managerId, list);
    }
    const mine = new Set<string>();
    const walk = (id: string) => {
      for (const child of children.get(id) || []) {
        if (mine.has(child)) continue;
        mine.add(child);
        walk(child);
      }
    };
    if (session.employeeId) walk(session.employeeId);
    else if ((await this.gates.span(session, 'approvals')) === 'company') rows.forEach((row) => mine.add(row.id));
    const people = rows.filter((row) => mine.has(row.id));
    const today = todayInIndia();
    const range = kolkataDayRange(today);
    const punches = mine.size
      ? await this.prisma.punch.findMany({
          where: { companyId: session.companyId, employeeId: { in: [...mine] }, punchedAt: { gte: range.start, lte: range.end } },
          orderBy: { punchedAt: 'desc' },
        })
      : [];
    const state = new Map<string, string>();
    for (const punch of punches) {
      if (!state.has(punch.employeeId)) state.set(punch.employeeId, punch.kind === 'in' ? 'in' : 'out');
    }
    const direct = session.employeeId ? { companyId: session.companyId, status: 'pending' as const, ...mayWaitOn(session) } : null;
    const due = (row: { flowJson: string; employee: { managerId: string | null } }) => waitsOn(session, row.flowJson, row.employee.managerId);
    const waiting = direct && (await this.gates.holds(session, 'approvals'))
      ? await Promise.all([
          this.prisma.leaveRequest.findMany({ where: direct, include: { employee: true, leaveType: true }, orderBy: { createdAt: 'asc' }, take: 60 }).then((rows) => rows.filter(due).slice(0, 20)),
          this.prisma.attendanceRequest.findMany({ where: direct, include: { employee: true }, orderBy: { createdAt: 'asc' }, take: 60 }).then((rows) => rows.filter(due).slice(0, 20)),
        ])
      : [[], []] as const;
    const [leave, time] = waiting;
    const active = people.filter((row) => row.status !== 'exited');
    return {
      people: people.map((row) => ({ ...row, state: row.status === 'exited' ? 'exited' : state.get(row.id) || 'out' })),
      waiting: [
        ...leave.map((row) => ({ id: row.id, name: `${row.employee.firstName} ${row.employee.lastName}`.trim(), detail: row.leaveType.name, kind: 'Leave' })),
        ...time.map((row) => ({ id: row.id, name: `${row.employee.firstName} ${row.employee.lastName}`.trim(), detail: row.kind === 'wfh' ? 'Work from home' : row.kind === 'onduty' ? 'On duty' : row.kind === 'extratime' ? 'Extra time' : 'Regularization', kind: 'Attendance' })),
      ],
      counts: {
        people: active.length,
        in: active.filter((row) => state.get(row.id) === 'in').length,
        out: active.filter((row) => state.get(row.id) !== 'in').length,
        waiting: leave.length + time.length,
      },
    };
  }

  async reporting(session: SessionUser, focusId?: string) {
    const rows = await this.prisma.employee.findMany({
      where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } },
      select: {
        id: true, code: true, firstName: true, lastName: true, status: true, managerId: true, teamId: true, photoAt: true,
        designation: { select: { name: true } }, department: { select: { name: true } }, location: { select: { name: true } },
      },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const reportsOf = new Map<string, string[]>();
    for (const row of rows) {
      if (!row.managerId || !byId.has(row.managerId)) continue;
      reportsOf.set(row.managerId, [...(reportsOf.get(row.managerId) || []), row.id]);
    }
    const node = (id: string) => {
      const row = byId.get(id)!;
      return {
        id: row.id, code: row.code, name: `${row.firstName} ${row.lastName}`.trim(), status: row.status,
        designation: row.designation?.name || '', department: row.department?.name || '', location: row.location?.name || '',
        reports: (reportsOf.get(row.id) || []).length, photoAt: row.photoAt?.toISOString() || null,
      };
    };
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    const focus = focusId ? byId.get(focusId) : session.employeeId ? byId.get(session.employeeId) : undefined;
    if (focusId && !focus) fail(404, 'That person is not on the reporting tree.');
    if (!focus) return { selfId: session.employeeId, me: null, chain: [], peers: [], reports: [], team: null, leads: [], people: rows.length };

    const chain = [];
    const seen = new Set([focus.id]);
    let up = focus.managerId;
    while (up && byId.has(up) && !seen.has(up)) {
      seen.add(up);
      chain.push(node(up));
      up = byId.get(up)!.managerId;
    }
    const peers = focus.managerId && byId.has(focus.managerId)
      ? (reportsOf.get(focus.managerId) || []).filter((id) => id !== focus.id).map(node).sort(byName)
      : [];
    const reports = (reportsOf.get(focus.id) || []).map(node).sort(byName);

    let team = null;
    if (focus.teamId) {
      const row = await this.prisma.team.findFirst({ where: { id: focus.teamId, companyId: session.companyId }, select: { name: true, leadId: true, departmentId: true } });
      if (row) {
        const department = row.departmentId ? await this.prisma.department.findFirst({ where: { id: row.departmentId, companyId: session.companyId }, select: { name: true } }) : null;
        team = {
          name: row.name,
          department: department?.name || '',
          lead: row.leadId && byId.has(row.leadId) ? node(row.leadId) : null,
          members: rows.filter((item) => item.teamId === focus.teamId && item.id !== row.leadId).map((item) => node(item.id)).sort(byName),
        };
      }
    }
    const led = await this.prisma.team.findMany({ where: { companyId: session.companyId, leadId: focus.id }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    const leads = led.map((item) => ({ name: item.name, members: rows.filter((row) => row.teamId === item.id && row.id !== focus.id).map((row) => node(row.id)).sort(byName) }));
    return { selfId: session.employeeId, me: node(focus.id), chain, peers, reports, team, leads, people: rows.length };
  }

  private async chartRows(companyId: string) {
    const rows = await this.prisma.employee.findMany({
      where: { companyId },
      include: { department: true, designation: true, location: true },
      orderBy: { firstName: 'asc' },
    });
    return rows.map((row) => ({
      id: row.id,
      name: `${row.firstName} ${row.lastName}`.trim(),
      code: row.code,
      designation: row.designation?.name || '',
      department: row.department?.name || '',
      location: row.location?.name || '',
      status: row.status,
      workerType: row.workerType,
      managerId: row.managerId,
    }));
  }

  private counts(people: Array<{ status: string; department: string; location: string }>) {
    const tally = (key: 'department' | 'location') => {
      const map = new Map<string, number>();
      for (const row of people) {
        if (row.status === 'exited') continue;
        const name = row[key] || 'Unassigned';
        map.set(name, (map.get(name) || 0) + 1);
      }
      return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    };
    return {
      active: people.filter((row) => row.status === 'active').length,
      onboarding: people.filter((row) => row.status === 'onboarding').length,
      exited: people.filter((row) => row.status === 'exited').length,
      departments: tally('department'),
      locations: tally('location'),
    };
  }

  async addDepartment(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const name = text(bag(body).name, 'Department', 80);
    try {
      const row = await this.prisma.department.create({ data: { companyId: session.companyId, name } });
      return this.named(row);
    } catch (error) {
      this.unique(error, 'That department already exists.');
    }
  }

  async addDesignation(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const name = text(bag(body).name, 'Designation', 80);
    try {
      const row = await this.prisma.designation.create({ data: { companyId: session.companyId, name } });
      return this.named(row);
    } catch (error) {
      this.unique(error, 'That designation already exists.');
    }
  }

  async addLocation(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const input = bag(body);
    const name = text(input.name, 'Location', 80);
    try {
      const row = await this.prisma.location.create({
        data: { companyId: session.companyId, name, state: optional(input.state, 60), city: optional(input.city, 80) },
      });
      return { id: row.id, name: row.name, state: row.state, city: row.city };
    } catch (error) {
      this.unique(error, 'That location already exists.');
    }
  }

  async profile(session: SessionUser) {
    if (!session.employeeId) return { linked: false as const };
    const row = await this.person(session.companyId, session.employeeId);
    const reports = await this.prisma.employee.count({ where: { companyId: session.companyId, managerId: session.employeeId, status: { in: ['active', 'onboarding'] } } });
    const nextHoliday = await this.prisma.holiday.findFirst({
      where: { companyId: session.companyId, day: { gte: todayInIndia() } },
      orderBy: { day: 'asc' },
      select: { day: true, name: true },
    });
    return {
      linked: true as const,
      reports,
      today: todayInIndia(),
      nextHoliday,
      birthday: /^\d{4}-\d{2}-\d{2}$/.test(row.dateOfBirth) ? row.dateOfBirth.slice(5) : '',
      person: {
        name: `${row.firstName} ${row.lastName}`.trim(),
        code: row.code,
        workerType: row.workerType,
        id: row.id,
        photo: row.photoAt ? row.photoAt.toISOString() : '',
        dateOfJoining: row.dateOfJoining,
        service: this.serviceOf(row.dateOfJoining, row.dateOfExit),
        department: row.department ? { name: row.department.name } : null,
        designation: row.designation ? { name: row.designation.name } : null,
        location: row.location ? { name: row.location.name } : null,
        manager: row.manager ? { name: `${row.manager.firstName} ${row.manager.lastName}`.trim() } : null,
      },
    };
  }

  async directory(session: SessionUser, query: string) {
    const needle = query.trim();
    if (needle.length < 2) return { people: [] as Array<{ id: string; name: string; code: string; designation: string; department: string; location: string }> };
    const rows = await this.prisma.employee.findMany({
      where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] }, ...this.personMatch(needle, false) },
      include: { designation: true, department: true, location: true },
      orderBy: { firstName: 'asc' },
      take: 12,
    });
    return {
      people: rows.map((row) => ({
        id: row.id,
        name: `${row.firstName} ${row.lastName}`.trim(),
        code: row.code,
        designation: row.designation?.name || '',
        department: row.department?.name || '',
        location: row.location?.name || '',
      })),
    };
  }

  async listPeople(session: SessionUser, query: string, department = '', status = '') {
    await this.gates.gate(session, 'people', 'You do not have access to the company directory.');
    const powers = await this.powers(session);
    const allowed = ['active', 'onboarding', 'exited'];
    const [rows, departments] = await Promise.all([
      this.prisma.employee.findMany({
        where: {
          companyId: session.companyId,
          ...(allowed.includes(status) ? { status } : {}),
          ...(department.trim() ? { department: { name: department.trim() } } : {}),
          ...this.personMatch(query, true),
        },
        include: personInclude,
        orderBy: { code: 'asc' },
        take: 100,
      }),
      this.prisma.department.findMany({ where: { companyId: session.companyId }, select: { name: true }, orderBy: { name: 'asc' } }),
    ]);
    return { people: rows.map((row) => this.present(row, session, powers)), departments: departments.map((row) => row.name) };
  }

  private personMatch(query: string, includeEmail: boolean) {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter((token) => token.length > 0);
    if (!tokens.length) return {};
    const mode = 'insensitive' as const;
    return {
      AND: tokens.map((token) => ({
        OR: [
          { firstName: { contains: token, mode } },
          { lastName: { contains: token, mode } },
          { code: { contains: token, mode } },
          ...(includeEmail ? [{ email: { contains: token, mode } }] : []),
          { department: { name: { contains: token, mode } } },
          { designation: { name: { contains: token, mode } } },
        ],
      })),
    };
  }

  async getPerson(session: SessionUser, id: string) {
    return this.present(await this.person(session.companyId, id), session, await this.powers(session));
  }

  async createPerson(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    await this.licence.assertCanHire(session.companyId);
    const raw = bag(body);
    const input = this.readPerson(raw, true);
    await this.assertOrg(session.companyId, input.departmentId, input.designationId, input.locationId, input.managerId);
    await this.assertPlace(session.companyId, input.levelId, input.teamId);
    await this.assertVendor(session.companyId, input.agencyId, input.clientId);
    if (input.role) {
      await this.assertRole(session.companyId, input.role);
      await this.assertCanAssign(session, input.role);
    }
    if (input.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
      if (existing) fail(409, 'That email is already used for sign-in.');
    }
    if (input.signIn && !input.email) fail(400, 'Add an email before giving this person a sign-in.');
    if (input.signIn && !input.password) fail(400, 'Set a password for the new sign-in.');
    const codes = await unscoped(() => this.prisma.employee.findMany({ where: { companyId: session.companyId }, select: { code: true } }));
    const probationMonths = (await this.settings.policy(session.companyId)).probationMonths;
    const probationEndsOn = raw.probationEndsOn !== undefined && String(raw.probationEndsOn).trim()
      ? dayOfSafe(raw.probationEndsOn)
      : probationMonths > 0 && !input.confirmedOn ? addMonths(input.dateOfJoining, probationMonths) : '';
    const employee = await this.prisma.employee.create({
      data: {
        companyId: session.companyId,
        code: await this.settings.issueEmployeeCode(session.companyId, codes.map((row) => row.code)),
        ...this.scalars(input),
        ...this.extras(raw),
        probationEndsOn,
      },
      include: personInclude,
    });
    if (input.signIn && input.email && input.password && input.role) {
      await this.prisma.user.create({
        data: {
          companyId: session.companyId,
          email: input.email,
          passwordHash: await this.auth.hashPassword(input.password),
          name: `${input.firstName} ${input.lastName}`.trim(),
          role: input.role,
          employeeId: employee.id,
        },
      });
    }
    await this.audit(session, 'employee.create', 'employee', employee.id, employee.code);
    return this.getPerson(session, employee.id);
  }

  /**
   * Adds people from spreadsheet rows. A check run reports every row's problems; nothing is saved
   * unless every row is valid, so a half-imported file never happens.
   */
  async importPeople(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    await this.licence.assertCanHire(session.companyId);
    const input = bag(body);
    if (!Array.isArray(input.rows) || !input.rows.length) fail(400, 'The file has no rows.');
    if (input.rows.length > 500) fail(400, 'Import up to 500 people at a time.');
    const commit = input.commit === true;
    const createMissing = input.createMissing === true;
    const companyId = session.companyId;
    const [departments, designations, locations, people, users, policy] = await Promise.all([
      this.prisma.department.findMany({ where: { companyId } }),
      this.prisma.designation.findMany({ where: { companyId } }),
      this.prisma.location.findMany({ where: { companyId } }),
      unscoped(() => this.prisma.employee.findMany({ where: { companyId }, select: { id: true, code: true, email: true } })),
      this.prisma.user.findMany({ select: { email: true } }),
      this.settings.policy(companyId),
    ]);
    const key = (value: unknown) => String(value ?? '').trim().toLowerCase();
    const byName = <T extends { name: string }>(list: T[], name: string) => list.find((row) => key(row.name) === key(name));
    const takenEmails = new Set([...people.map((row) => key(row.email)), ...users.map((row) => key(row.email))].filter(Boolean));
    const takenCodes = new Set(people.map((row) => key(row.code)));
    const seenEmails = new Set<string>();
    const seenCodes = new Set<string>();
    const missing = { department: new Set<string>(), designation: new Set<string>(), location: new Set<string>() };
    const message = (error: unknown) => {
      if (error instanceof HttpException) {
        const response = error.getResponse();
        return typeof response === 'object' && response && 'message' in response ? String((response as { message: unknown }).message) : error.message;
      }
      return error instanceof Error ? error.message : 'This row is not valid.';
    };
    const checked: Array<{ line: number; ok: boolean; error: string; name: string; email: string; raw: Record<string, unknown>; managerRef: string }> = [];
    input.rows.forEach((item: unknown, index: number) => {
      const raw = item && typeof item === 'object' && !Array.isArray(item) ? { ...(item as Record<string, unknown>) } : {};
      const line = index + 2;
      try {
        for (const [field, list] of [['department', departments], ['designation', designations], ['location', locations]] as const) {
          const name = String(raw[field] ?? '').trim();
          if (!name) continue;
          if (!byName(list as Array<{ name: string }>, name)) {
            if (!createMissing) fail(400, `${field.charAt(0).toUpperCase() + field.slice(1)} “${name}” does not exist yet. Turn on “Add missing departments, designations and locations” or add it first.`);
            missing[field].add(name);
          }
        }
        const email = key(raw.email);
        if (email && (takenEmails.has(email) || seenEmails.has(email))) fail(409, `${email} is already used by another person.`);
        const code = String(raw.code ?? '').trim();
        if (code && (takenCodes.has(key(code)) || seenCodes.has(key(code)))) fail(409, `Employee code ${code} is already used.`);
        const person = this.readPerson({ ...raw, departmentId: undefined, designationId: undefined, locationId: undefined, managerId: undefined, signIn: false, role: undefined, password: undefined }, true);
        this.extras(raw);
        if (raw.probationEndsOn) dayOfSafe(raw.probationEndsOn);
        if (email) seenEmails.add(email);
        if (code) seenCodes.add(key(code));
        checked.push({ line, ok: true, error: '', name: `${person.firstName} ${person.lastName}`.trim(), email, raw, managerRef: key(raw.manager) });
      } catch (error) {
        checked.push({ line, ok: false, error: message(error), name: `${String(raw.firstName ?? '')} ${String(raw.lastName ?? '')}`.trim(), email: key(raw.email), raw, managerRef: '' });
      }
    });
    const codesInFile = new Set(checked.map((row) => key(row.raw.code)).filter(Boolean));
    const emailsInFile = new Set(checked.map((row) => row.email).filter(Boolean));
    for (const row of checked) {
      if (!row.ok || !row.managerRef) continue;
      const known = people.some((person) => key(person.code) === row.managerRef || key(person.email) === row.managerRef);
      if (!known && !codesInFile.has(row.managerRef) && !emailsInFile.has(row.managerRef)) {
        row.ok = false;
        row.error = `Manager “${row.raw.manager}” is not an employee code or email in the company or this file.`;
      }
    }
    const invalid = checked.filter((row) => !row.ok).length;
    const preview = {
      rows: checked.map(({ line, ok, error, name, email }) => ({ line, ok, error, name, email })),
      valid: checked.length - invalid,
      invalid,
      willCreate: { departments: [...missing.department], designations: [...missing.designation], locations: [...missing.location] },
    };
    if (!commit || invalid) return { ...preview, imported: 0 };

    const ensure = async (kind: 'department' | 'designation' | 'location', name: string) => {
      if (!name) return null;
      const list = kind === 'department' ? departments : kind === 'designation' ? designations : locations;
      const found = byName(list as Array<{ id: string; name: string }>, name);
      if (found) return found.id;
      const created = kind === 'department'
        ? await this.prisma.department.create({ data: { companyId, name } })
        : kind === 'designation'
          ? await this.prisma.designation.create({ data: { companyId, name } })
          : await this.prisma.location.create({ data: { companyId, name } });
      (list as Array<{ id: string; name: string }>).push(created);
      return created.id;
    };
    const codes = people.map((row) => row.code);
    const created: Array<{ id: string; code: string; email: string; managerRef: string }> = [];
    for (const row of checked) {
      const raw = row.raw;
      const departmentId = await ensure('department', String(raw.department ?? '').trim());
      const designationId = await ensure('designation', String(raw.designation ?? '').trim());
      const locationId = await ensure('location', String(raw.location ?? '').trim());
      const person = this.readPerson({ ...raw, departmentId, designationId, locationId, managerId: undefined, signIn: false, role: undefined, password: undefined }, true);
      const code = String(raw.code ?? '').trim() || (await this.settings.issueEmployeeCode(companyId, codes));
      codes.push(code);
      const probationEndsOn = raw.probationEndsOn ? dayOfSafe(raw.probationEndsOn) : policy.probationMonths > 0 && !person.confirmedOn ? addMonths(person.dateOfJoining, policy.probationMonths) : '';
      const employee = await this.prisma.employee.create({ data: { companyId, code, ...this.scalars(person), ...this.extras(raw), probationEndsOn } });
      created.push({ id: employee.id, code: key(code), email: row.email, managerRef: row.managerRef });
    }
    const everyone = await unscoped(() => this.prisma.employee.findMany({ where: { companyId }, select: { id: true, code: true, email: true } }));
    for (const row of created) {
      if (!row.managerRef) continue;
      const manager = everyone.find((person) => key(person.code) === row.managerRef || key(person.email) === row.managerRef);
      if (manager && manager.id !== row.id) await this.prisma.employee.update({ where: { id: row.id }, data: { managerId: manager.id } });
    }
    await this.audit(session, 'employee.import', 'employee', companyId, `${created.length} people`);
    return { ...preview, imported: created.length };
  }

  async updatePerson(session: SessionUser, id: string, body: unknown) {
    const current = await this.person(session.companyId, id);
    const input = bag(body);
    if (!(await this.gates.holds(session, 'people.edit'))) {
      if (session.employeeId !== id) fail(403, 'You can update only your own profile.');
      await this.prisma.employee.update({
        where: { id },
        data: {
          phone: SELF_FIELDS.phone.read(input.phone),
          maritalStatus: this.choice(input.maritalStatus, ['', 'Single', 'Married', 'Other'], 'Marital status'),
          nationality: optional(input.nationality, 40),
          bloodGroup: this.choice(input.bloodGroup, ['', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'], 'Blood group'),
          emergencyName: optional(input.emergencyName, 80),
          emergencyPhone: SELF_FIELDS.emergencyPhone.read(input.emergencyPhone),
          address: optional(input.address, 240),
        },
      });
      return this.getPerson(session, id);
    }
    if (current.user) await this.assertCanTouch(session, current.user.role);
    const next = this.readPerson(input, false);
    await this.assertPlace(session.companyId, next.levelId, next.teamId);
    await this.assertVendor(session.companyId, next.agencyId, next.clientId);
    await this.assertOrg(session.companyId, next.departmentId, next.designationId, next.locationId, next.managerId, id);
    if (next.managerId) await this.assertNoCycle(session.companyId, id, next.managerId);
    if (next.signIn === true) {
      if (!next.email) fail(400, 'Add an email before giving this person a sign-in.');
      if (!next.role) fail(400, 'Choose a role for the sign-in.');
      await this.assertRole(session.companyId, next.role);
      await this.assertCanAssign(session, next.role);
      if (current.user?.role === 'owner' && next.role !== 'owner') await this.assertNotLastOwner(session);
    } else if (next.signIn === false && current.user?.role === 'owner' && current.user.id !== session.id) {
      await this.assertNotLastOwner(session);
    }
    if (next.status === 'exited' && current.status !== 'exited' && !next.dateOfExit) next.dateOfExit = todayInIndia();
    if (next.status !== 'exited' && current.status === 'exited') next.dateOfExit = '';
    const probation = input.probationEndsOn === undefined ? {} : { probationEndsOn: String(input.probationEndsOn).trim() ? dayOfSafe(input.probationEndsOn) : '' };
    await this.prisma.employee.update({ where: { id }, data: { ...this.scalars(next), ...this.extras(input), ...probation } });
    if (next.signIn === true) {
      if (current.user) {
        try {
          await this.prisma.user.update({
            where: { id: current.user.id },
            data: { email: next.email, name: `${next.firstName} ${next.lastName}`.trim(), role: next.role, active: true },
          });
        } catch (error) {
          this.unique(error, 'That email is already used for sign-in.');
        }
      } else {
        if (!next.password) fail(400, 'Set a password for the new sign-in.');
        const clash = await this.prisma.user.findUnique({ where: { email: next.email } });
        if (clash) fail(409, 'That email is already used for sign-in.');
        await this.prisma.user.create({
          data: {
            companyId: session.companyId,
            email: next.email,
            passwordHash: await this.auth.hashPassword(next.password),
            name: `${next.firstName} ${next.lastName}`.trim(),
            role: next.role,
            employeeId: id,
          },
        });
      }
    } else if (next.signIn === false && current.user && current.user.id !== session.id) {
      await this.prisma.user.update({ where: { id: current.user.id }, data: { active: false } });
    }
    await this.audit(session, 'employee.update', 'employee', id);
    return this.getPerson(session, id);
  }

  async setPassword(session: SessionUser, id: string, body: unknown) {
    await this.requireHr(session);
    const person = await this.person(session.companyId, id);
    if (!person.user) fail(400, 'This person cannot sign in yet.');
    if (person.user.id === session.id) fail(400, 'Change your own password from Settings.');
    await this.assertCanTouch(session, person.user.role);
    const password = passwordOf(bag(body).password);
    await this.prisma.user.update({
      where: { id: person.user.id },
      data: { passwordHash: await this.auth.hashPassword(password), failedCount: 0, lockedUntil: null },
    });
    await this.audit(session, 'employee.password', 'employee', id);
    return { message: 'Password updated.' };
  }

  private scalars(input: PersonInput) {
    return {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      workerType: input.workerType,
      status: input.status,
      departmentId: input.departmentId,
      designationId: input.designationId,
      locationId: input.locationId,
      managerId: input.managerId,
      levelId: input.levelId,
      teamId: input.teamId,
      agencyId: input.agencyId,
      clientId: input.clientId,
      costCentre: input.costCentre,
      dateOfJoining: input.dateOfJoining,
      dateOfExit: input.dateOfExit,
      confirmedOn: input.confirmedOn,
      gender: input.gender,
      dateOfBirth: input.dateOfBirth,
      maritalStatus: input.maritalStatus,
      nationality: input.nationality,
      bloodGroup: input.bloodGroup,
      emergencyName: input.emergencyName,
      emergencyPhone: input.emergencyPhone,
      address: input.address,
      panEnc: seal(input.pan, this.key),
      bankEnc: seal(input.bankAccount, this.key),
      ifscEnc: seal(input.ifsc, this.key),
      bankName: input.bankName,
    };
  }

  /** Newer detail fields. Only the ones sent are written, so an older form cannot blank them. */
  private extras(input: Record<string, unknown>): Record<string, string> {
    const data: Record<string, string> = {};
    for (const key of EXTRA_SELF) {
      if (input[key] !== undefined) data[key] = SELF_FIELDS[key].read(input[key]);
    }
    for (const key of ['uan', 'esicNo', 'taxRegime', 'aadhaar']) {
      if (input[key] === undefined || String(input[key]).includes('•')) continue;
      const target = REVIEW_COLUMNS[key];
      const value = REVIEW_FIELDS[key].read(input[key]);
      data[target.column] = target.sealed ? seal(value, this.key) : value;
    }
    return data;
  }

  private readPerson(input: Record<string, unknown>, creating: boolean): PersonInput {
    const signIn = input.signIn === undefined ? null : input.signIn === true;
    return {
      firstName: text(input.firstName, 'First name', 60),
      lastName: optional(input.lastName, 60),
      email: input.email ? emailOf(input.email) : '',
      phone: SELF_FIELDS.phone.read(input.phone),
      workerType: oneOf(input.workerType || 'employee', WORKER_TYPES, 'Worker type'),
      status: oneOf(input.status || 'active', EMPLOYEE_STATUSES, 'Status'),
      departmentId: optionalId(input.departmentId),
      designationId: optionalId(input.designationId),
      locationId: optionalId(input.locationId),
      managerId: optionalId(input.managerId),
      costCentre: optional(input.costCentre, 80),
      dateOfJoining: input.dateOfJoining ? dayOfSafe(input.dateOfJoining) : creating ? todayInIndia() : fail(400, 'Date of joining is required.'),
      dateOfExit: optionalDay(input.dateOfExit),
      confirmedOn: optionalDay(input.confirmedOn),
      gender: optional(input.gender, 40),
      dateOfBirth: optionalDay(input.dateOfBirth),
      maritalStatus: this.choice(input.maritalStatus, ['', 'Single', 'Married', 'Other'], 'Marital status'),
      nationality: optional(input.nationality, 40),
      bloodGroup: this.choice(input.bloodGroup, ['', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'], 'Blood group'),
      emergencyName: optional(input.emergencyName, 80),
      emergencyPhone: SELF_FIELDS.emergencyPhone.read(input.emergencyPhone),
      address: optional(input.address, 240),
      pan: panOf(input.pan),
      bankAccount: bankOf(input.bankAccount),
      ifsc: ifscOf(input.ifsc),
      bankName: optional(input.bankName, 80),
      signIn,
      password: input.password ? passwordOf(input.password) : '',
      role: input.role ? this.roleKey(input.role) : signIn ? 'employee' : '',
      levelId: optionalId(input.levelId),
      teamId: optionalId(input.teamId),
      agencyId: optionalId(input.agencyId),
      clientId: optionalId(input.clientId),
    };
  }

  private async powers(session: SessionUser): Promise<{ editor: boolean; pay: boolean }> {
    return { editor: await this.gates.holds(session, 'people.edit'), pay: await this.gates.holds(session, 'pay') };
  }

  private present(row: PersonRow, viewer: SessionUser, powers: { editor: boolean; pay: boolean }) {
    const self = viewer.employeeId === row.id;
    const seePay = self || powers.pay;
    const seePhone = self || isStaff(viewer.role) || (viewer.role === 'manager' && row.managerId === viewer.employeeId);
    const pan = openSecret(row.panEnc, this.key);
    const bank = openSecret(row.bankEnc, this.key);
    const ifsc = openSecret(row.ifscEnc, this.key);
    const aadhaar = openSecret(row.aadhaarEnc, this.key);
    const fullName = `${row.firstName} ${row.lastName}`.trim();
    return {
      id: row.id,
      code: row.code,
      firstName: row.firstName,
      lastName: row.lastName,
      name: fullName,
      email: isStaff(viewer.role) || self || viewer.role === 'manager' ? row.email : '',
      phone: seePhone ? row.phone : '',
      workerType: row.workerType,
      status: row.status,
      department: row.department ? this.named(row.department) : null,
      designation: row.designation ? this.named(row.designation) : null,
      level: row.level ? { id: row.level.id, name: row.level.name } : null,
      team: row.team ? { id: row.team.id, name: row.team.name } : null,
      agency: row.agency ? { id: row.agency.id, name: row.agency.name } : null,
      client: row.client ? { id: row.client.id, name: row.client.name } : null,
      location: row.location ? { id: row.location.id, name: row.location.name, state: row.location.state, city: row.location.city } : null,
      manager: row.manager ? { id: row.manager.id, name: `${row.manager.firstName} ${row.manager.lastName}`.trim() } : null,
      costCentre: isStaff(viewer.role) ? row.costCentre : '',
      dateOfJoining: row.dateOfJoining,
      dateOfExit: row.dateOfExit,
      service: this.serviceOf(row.dateOfJoining, row.dateOfExit),
      gender: row.gender,
      dateOfBirth: self || powers.editor ? row.dateOfBirth : '',
      confirmedOn: self || powers.editor ? row.confirmedOn : '',
      probationEndsOn: self || powers.editor ? row.probationEndsOn : '',
      maritalStatus: self || powers.editor ? row.maritalStatus : '',
      nationality: self || powers.editor ? row.nationality : '',
      bloodGroup: self || powers.editor ? row.bloodGroup : '',
      emergencyName: self || powers.editor ? row.emergencyName : '',
      emergencyPhone: self || powers.editor ? row.emergencyPhone : '',
      address: self || powers.editor ? row.address : '',
      pan: seePay ? (self || powers.editor || powers.pay ? pan : maskSecret(pan)) : '',
      bankAccount: seePay ? (self || powers.pay ? bank : '') : '',
      ifsc: seePay ? ifsc : '',
      bankName: seePay ? row.bankName : '',
      photo: row.photoAt ? row.photoAt.toISOString() : '',
      personalEmail: self || powers.editor ? row.personalEmail : '',
      fatherName: self || powers.editor ? row.fatherName : '',
      spouseName: self || powers.editor ? row.spouseName : '',
      emergencyRelation: self || powers.editor ? row.emergencyRelation : '',
      city: self || powers.editor ? row.city : '',
      state: self || powers.editor ? row.state : '',
      pincode: self || powers.editor ? row.pincode : '',
      permanentAddress: self || powers.editor ? row.permanentAddress : '',
      nomineeName: self || powers.editor ? row.nomineeName : '',
      nomineeRelation: self || powers.editor ? row.nomineeRelation : '',
      uan: seePay || powers.editor ? row.uan : '',
      esicNo: seePay || powers.editor ? row.esicNo : '',
      aadhaar: seePay || powers.editor ? (powers.pay ? aadhaar : maskSecret(aadhaar)) : '',
      taxRegime: seePay ? row.taxRegime : '',
      signIn: row.user ? { role: isStaff(viewer.role) || self ? row.user.role : '', active: row.user.active } : null,
    };
  }

  private async person(companyId: string, id: string): Promise<PersonRow> {
    const row = await this.prisma.employee.findFirst({ where: { id, companyId }, include: personInclude });
    if (!row) fail(404, 'That person was not found.');
    return row;
  }

  private roleKey(value: unknown): string {
    const key = String(value || '').trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{1,30}$/.test(key)) fail(400, 'That role is not one of the choices.');
    return key;
  }

  private async assertRole(companyId: string, key: string) {
    const ladder = await this.gates.ensureLadder(companyId);
    if (!ladder.some((role) => role.key === key)) fail(400, 'That role is not on the ladder.');
  }

  private async assertVendor(companyId: string, agencyId: string | null, clientId: string | null) {
    if (agencyId && !(await this.prisma.vendor.findFirst({ where: { id: agencyId, companyId, active: true, suppliesUs: true } }))) {
      fail(400, 'That agency is not set up to supply people to you.');
    }
    if (clientId && !(await this.prisma.vendor.findFirst({ where: { id: clientId, companyId, active: true, weSupply: true } }))) {
      fail(400, 'That client is not set up for manpower you provide.');
    }
  }

  private async assertPlace(companyId: string, levelId: string | null, teamId: string | null) {
    if (levelId && !(await this.prisma.jobLevel.findFirst({ where: { id: levelId, companyId } }))) fail(400, 'That grade is not in this company.');
    if (teamId && !(await this.prisma.team.findFirst({ where: { id: teamId, companyId } }))) fail(400, 'That team is not in this company.');
  }

  private async assertOrg(companyId: string, departmentId: string | null, designationId: string | null, locationId: string | null, managerId: string | null, selfId?: string) {
    if (departmentId && !(await this.prisma.department.findFirst({ where: { id: departmentId, companyId } }))) {
      fail(400, 'Choose a department from this company.');
    }
    if (designationId && !(await this.prisma.designation.findFirst({ where: { id: designationId, companyId } }))) {
      fail(400, 'Choose a designation from this company.');
    }
    if (locationId && !(await this.prisma.location.findFirst({ where: { id: locationId, companyId } }))) {
      fail(400, 'Choose a location from this company.');
    }
    if (managerId) {
      if (managerId === selfId) fail(400, 'A person cannot report to themselves.');
      if (!(await this.prisma.employee.findFirst({ where: { id: managerId, companyId } }))) fail(400, 'Choose a manager from this company.');
    }
  }

  private async assertNoCycle(companyId: string, employeeId: string, managerId: string) {
    const seen = new Set<string>([employeeId]);
    let current: string | null = managerId;
    while (current) {
      if (seen.has(current)) fail(400, 'That manager would create a reporting loop.');
      seen.add(current);
      if (seen.size > 40) fail(400, 'That reporting line is too long.');
      const row: { managerId: string | null } | null = await this.prisma.employee.findFirst({
        where: { id: current, companyId },
        select: { managerId: true },
      });
      current = row?.managerId ?? null;
    }
  }

  private async rankOf(companyId: string, role: string): Promise<number> {
    const ladder = await this.gates.ensureLadder(companyId);
    return ladder.find((item) => item.key === role)?.rank ?? 0;
  }

  private async assertCanAssign(session: SessionUser, role: string) {
    if (session.role === 'owner') return;
    const actor = await this.rankOf(session.companyId, session.role);
    const target = await this.rankOf(session.companyId, role);
    if (target > actor) fail(403, 'You cannot assign a role above your own.');
  }

  private async assertCanTouch(session: SessionUser, role: string) {
    if (session.role === 'owner') return;
    const actor = await this.rankOf(session.companyId, session.role);
    const target = await this.rankOf(session.companyId, role);
    if (target > actor) fail(403, 'You cannot change someone above you on the ladder.');
  }

  private async assertNotLastOwner(session: SessionUser) {
    const owners = await this.prisma.user.count({ where: { companyId: session.companyId, role: 'owner', active: true } });
    if (owners < 2) fail(400, 'Add another owner before changing this owner.');
  }

  private async requireHr(session: SessionUser) {
    await this.gates.gate(session, 'people.edit', 'You do not have access to change people.');
  }

  private choice(value: unknown, allowed: string[], label: string): string {
    const cleaned = optional(value, 40);
    if (!allowed.includes(cleaned)) fail(400, `${label} is not one of the choices.`);
    return cleaned;
  }

  private serviceOf(joined: string, exited: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joined)) return '';
    const end = /^\d{4}-\d{2}-\d{2}$/.test(exited) ? exited : todayInIndia();
    let years = Number(end.slice(0, 4)) - Number(joined.slice(0, 4));
    let months = Number(end.slice(5, 7)) - Number(joined.slice(5, 7));
    if (Number(end.slice(8, 10)) < Number(joined.slice(8, 10))) months -= 1;
    if (months < 0) {
      years -= 1;
      months += 12;
    }
    if (years < 0) return '';
    const yearLabel = years === 1 ? '1 year' : `${years} years`;
    const monthLabel = months === 1 ? '1 month' : `${months} months`;
    if (!years) return months <= 1 ? 'Under a month' : monthLabel;
    return months ? `${yearLabel}, ${monthLabel}` : yearLabel;
  }

  private named(row: Department | Designation | Location) {
    return { id: row.id, name: row.name };
  }

  private unique(error: unknown, message: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') fail(409, message);
    throw error;
  }

  private async audit(session: SessionUser, action: string, entity: string, entityId: string, detail = '') {
    await this.prisma.auditEvent.create({
      data: { companyId: session.companyId, actorId: session.id, action, entity, entityId, detail },
    });
  }
}

interface PersonInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  workerType: string;
  status: string;
  departmentId: string | null;
  designationId: string | null;
  locationId: string | null;
  managerId: string | null;
  levelId: string | null;
  teamId: string | null;
  agencyId: string | null;
  clientId: string | null;
  costCentre: string;
  dateOfJoining: string;
  dateOfExit: string;
  confirmedOn: string;
  gender: string;
  dateOfBirth: string;
  maritalStatus: string;
  nationality: string;
  bloodGroup: string;
  emergencyName: string;
  emergencyPhone: string;
  address: string;
  pan: string;
  bankAccount: string;
  ifsc: string;
  bankName: string;
  signIn: boolean | null;
  password: string;
  role: string;
}

function addMonths(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date, last));
  return target.toISOString().slice(0, 10);
}

function dayOfSafe(value: unknown): string {
  const cleaned = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned) || Number.isNaN(Date.parse(cleaned + 'T00:00:00Z'))) {
    fail(400, 'Date of joining needs a real date.');
  }
  return cleaned;
}
