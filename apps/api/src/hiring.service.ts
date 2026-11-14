import { randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import { bag, emailOf, fail, optional, text } from './http';
import { AccessService } from './access.service';
import { ApplicantService, emailKey, highlight, nameKey, phoneKey, prettyDay, sharedPhones } from './applicant.service';
import { unscoped } from './outlet-context';
import { PrismaService } from './prisma.service';
import { plainOf, richOf } from './rich';
import { SessionUser } from './session';

export const PORTALS: Array<{ id: string; label: string; blurb: string }> = [
  { id: 'naukri', label: 'Naukri', blurb: 'Paste the Naukri apply address into the job on Naukri. Open jobs ticked for Naukri are in the Naukri feed.' },
  { id: 'linkedin', label: 'LinkedIn', blurb: 'Use the LinkedIn apply address as the application URL. Ticked open jobs are in the LinkedIn feed.' },
  { id: 'indeed', label: 'Indeed', blurb: 'Give Indeed the apply address, or the XML feed. Applications posted to the webhook land here.' },
  { id: 'shine', label: 'Shine', blurb: 'Paste the Shine apply address into the Shine listing.' },
  { id: 'foundit', label: 'Foundit', blurb: 'Paste the Foundit apply address into the Foundit listing.' },
  { id: 'apna', label: 'Apna', blurb: 'Paste the Apna apply address into the Apna listing.' },
  { id: 'internshala', label: 'Internshala', blurb: 'Paste the Internshala apply address into the internship or job.' },
  { id: 'hirist', label: 'Hirist', blurb: 'Paste the Hirist apply address into the Hirist listing.' },
  { id: 'cutshort', label: 'Cutshort', blurb: 'Paste the Cutshort apply address into the Cutshort listing.' },
];

const PORTAL_IDS = new Set(PORTALS.map((portal) => portal.id));
const WORKPLACES = new Set(['office', 'remote', 'hybrid']);
const EMPLOYMENT = new Set(['full-time', 'part-time', 'contract', 'intern']);
const OPENING_STATUS = new Set(['draft', 'open', 'closed']);
const APPLICATION_STATUS = new Set(['new', 'cooling', 'reviewing', 'shortlisted', 'interview', 'rejected', 'hired']);
const STATUS_LABEL: Record<string, string> = { new: 'New', cooling: 'Cooling period', reviewing: 'Reviewing', shortlisted: 'Shortlisted', interview: 'Interview', rejected: 'Rejected', hired: 'Hired' };

export interface InboundApplication {
  job: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  resume: string;
  note: string;
}

@Injectable()
export class HiringService {
  constructor(private readonly prisma: PrismaService, private readonly gates: AccessService, private readonly applicants: ApplicantService) {}

  async list(session: SessionUser) {
    await this.requireHr(session);
    const desk = await this.desk(session.companyId);
    const company = await this.company(session.companyId);
    const rows = await this.prisma.opening.findMany({
      where: { companyId: session.companyId },
      include: { _count: { select: { applications: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const fresh = await this.prisma.jobApplication.groupBy({
      by: ['openingId'],
      where: { companyId: session.companyId, status: 'new', openingId: { not: null } },
      _count: { _all: true },
    });
    const freshByOpening = new Map(fresh.map((row) => [row.openingId, row._count._all]));
    return {
      company: company.slug,
      jobs: rows.map((row) => this.openingSummary(row, company.slug, freshByOpening.get(row.id) || 0)),
      portals: this.portalView(desk, company.slug),
    };
  }

  async applications(session: SessionUser) {
    await this.requireHr(session);
    const rows = await this.prisma.jobApplication.findMany({
      where: { companyId: session.companyId },
      include: { opening: { select: { title: true, description: true, requirements: true, location: true, workplace: true } } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const [all, staff] = await Promise.all([
      this.prisma.jobApplication.findMany({ where: { companyId: session.companyId }, select: { id: true, name: true, email: true, phone: true, status: true }, take: 5000 }),
      this.prisma.employee.findMany({ where: { companyId: session.companyId }, select: { email: true, personalEmail: true, phone: true, status: true } }),
    ]);
    const shared = sharedPhones([
      ...all.map((row) => ({ phone: row.phone, owner: 'a:' + emailKey(row.email) })),
      ...staff.map((row, at) => ({ phone: row.phone, owner: 'e:' + at })),
    ]);
    const phoneOf = (value: string) => {
      const key = phoneKey(value);
      return key && !shared.has(key) ? 'p:' + key : '';
    };
    const index = new Map<string, Array<{ id: string; status: string }>>();
    const add = (key: string, row: { id: string; status: string }) => {
      if (key.length <= 2) return;
      const list = index.get(key) || [];
      list.push(row);
      index.set(key, list);
    };
    for (const row of all) {
      add('e:' + emailKey(row.email), row);
      add(phoneOf(row.phone), row);
    }
    const people = new Map<string, string>();
    for (const row of staff) {
      for (const key of ['e:' + emailKey(row.email), 'e:' + emailKey(row.personalEmail), phoneOf(row.phone)]) {
        if (key.length > 2 && (!people.has(key) || row.status !== 'exited')) people.set(key, row.status === 'exited' ? 'former' : 'current');
      }
    }
    const names = new Map<string, number>();
    for (const row of all) {
      const key = nameKey(row.name);
      if (key.length >= 5) names.set(key, (names.get(key) || 0) + 1);
    }
    return rows.map((row) => {
      const keys = ['e:' + emailKey(row.email), phoneOf(row.phone)].filter((key) => key.length > 2);
      const others = new Map<string, string>();
      for (const key of keys) for (const item of index.get(key) || []) if (item.id !== row.id) others.set(item.id, item.status);
      const employee = keys.map((key) => people.get(key)).find(Boolean) || '';
      const match = this.applicants.score(row.opening, row, this.messageOf(row.answersJson, 4000));
      return {
        ...this.applicationView(row),
        score: match.score,
        repeat: {
          times: others.size,
          rejected: [...others.values()].filter((status) => status === 'rejected').length,
          employee,
          sameName: others.size ? 0 : Math.max(0, (names.get(nameKey(row.name)) || 0) - 1),
        },
      };
    });
  }

  /** What the Add person form can start with for a hired applicant. */
  async prefill(session: SessionUser, id: string) {
    await this.requireHr(session);
    if (!(await this.gates.holds(session, 'people.edit'))) fail(403, 'You do not have access to add people.');
    const row = await this.prisma.jobApplication.findFirst({ where: { id, companyId: session.companyId }, include: { opening: true } });
    if (!row) fail(404, 'That application was not found.');
    const parts = row.name.trim().split(/\s+/);
    const lower = (value: string) => value.trim().toLowerCase();
    const [departments, designations, locations, already] = await Promise.all([
      this.prisma.department.findMany({ where: { companyId: session.companyId }, select: { id: true, name: true } }),
      this.prisma.designation.findMany({ where: { companyId: session.companyId }, select: { id: true, name: true } }),
      this.prisma.location.findMany({ where: { companyId: session.companyId }, select: { id: true, name: true, city: true } }),
      row.email ? this.prisma.employee.findFirst({ where: { companyId: session.companyId, email: { equals: row.email, mode: 'insensitive' } }, select: { id: true, code: true } }) : Promise.resolve(null),
    ]);
    const title = row.opening?.title || row.jobTitle;
    const employment = lower(row.opening?.employment || '');
    const phone = row.phone.replace(/[^\d+ -]/g, '').trim();
    return {
      applicationId: row.id,
      existing: already,
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' '),
      email: row.email,
      phone: /^\+?[0-9][0-9 -]{6,18}$/.test(phone) ? phone : '',
      city: row.city,
      designationId: designations.find((item) => lower(item.name) === lower(title))?.id || '',
      departmentId: departments.find((item) => lower(item.name) === lower(row.opening?.department || ''))?.id || '',
      locationId: locations.find((item) => lower(item.name) === lower(row.opening?.location || '') || (item.city && lower(item.city) === lower(row.city)))?.id || '',
      workerType: employment.includes('intern') ? 'intern' : employment.includes('contract') ? 'contractor' : 'employee',
      title,
      status: row.status,
    };
  }

  async application(session: SessionUser, id: string) {
    await this.requireHr(session);
    const row = await this.prisma.jobApplication.findFirst({
      where: { id, companyId: session.companyId },
      include: { opening: true, form: { select: { name: true, fieldsJson: true } }, events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) fail(404, 'That application was not found.');
    const message = this.messageOf(row.answersJson, 4000);
    const match = this.applicants.score(row.opening, row, message);
    const found = await this.applicants.matches(session.companyId, row, row.id);
    const cooling = await this.applicants.cooling(session.companyId, row, row.id);
    const rules = await this.applicants.rules(session.companyId);
    const otherIds = found.applications.map((item) => item.row.id);
    const otherEvents = otherIds.length
      ? await this.prisma.applicationEvent.findMany({ where: { companyId: session.companyId, applicationId: { in: otherIds } }, orderBy: { createdAt: 'asc' } })
      : [];
    const jobs = new Map<string, string>(found.applications.map((item) => [item.row.id, item.row.jobTitle || 'General form']));
    jobs.set(row.id, row.jobTitle || 'General form');
    const history: Array<{ at: string; kind: string; detail: string; by: string; job: string; applicationId: string; current: boolean }> = [];
    const push = (applicationId: string, kind: string, detail: string, by: string, at: Date | string) =>
      history.push({ at: typeof at === 'string' ? at : at.toISOString(), kind, detail, by, job: jobs.get(applicationId) || '', applicationId, current: applicationId === row.id });
    const withReceived = new Set([...row.events, ...otherEvents].filter((event) => event.kind === 'received').map((event) => event.applicationId));
    for (const item of [{ row }, ...found.applications]) {
      if (!withReceived.has(item.row.id)) push(item.row.id, 'received', 'Applied for ' + (item.row.jobTitle || 'the general form'), '', item.row.createdAt);
    }
    for (const event of [...row.events, ...otherEvents]) push(event.applicationId, event.kind, event.detail, event.by, event.createdAt);
    for (const item of found.employees) {
      const name = item.row.firstName + ' ' + item.row.lastName;
      if (item.row.dateOfJoining) push('', 'joined', name + ' (' + item.row.code + ') joined the company', '', item.row.dateOfJoining + 'T09:00:00+05:30');
      if (item.row.status === 'exited' && item.row.dateOfExit) push('', 'left', name + ' (' + item.row.code + ') left the company', '', item.row.dateOfExit + 'T18:00:00+05:30');
    }
    history.sort((a, b) => b.at.localeCompare(a.at));
    return {
      ...this.applicationView(row),
      message,
      resumeText: row.resumeText,
      decidedAt: row.decidedAt ? row.decidedAt.toISOString() : '',
      coolingUntil: row.coolingUntil,
      coolingNote: row.coolingNote,
      answers: this.answersOf(row.answersJson, row.form?.fieldsJson || '[]'),
      formName: row.form?.name || '',
      opening: row.opening
        ? { id: row.opening.id, code: row.opening.code, title: row.opening.title, department: row.opening.department, location: row.opening.location, workplace: row.opening.workplace, employment: row.opening.employment, status: row.opening.status, requirements: row.opening.requirements, description: row.opening.description }
        : null,
      match,
      highlights: { resume: highlight(row.resumeText, match.terms), message: highlight(message, match.terms) },
      repeat: {
        applications: found.applications.map((item) => ({
          id: item.row.id,
          jobTitle: item.row.jobTitle || 'General form',
          jobCode: item.row.jobCode,
          status: item.row.status,
          statusLabel: STATUS_LABEL[item.row.status] || item.row.status,
          createdAt: item.row.createdAt.toISOString(),
          on: item.on,
        })),
        employees: found.employees.map((item) => ({
          id: item.row.id,
          code: item.row.code,
          name: item.row.firstName + ' ' + item.row.lastName,
          status: item.row.status,
          dateOfJoining: item.row.dateOfJoining,
          dateOfExit: item.row.dateOfExit,
          on: item.on,
        })),
      },
      cooling: cooling ? { ...cooling, untilLabel: prettyDay(cooling.until) } : null,
      rules: { rejectDays: rules.rejectDays, exitDays: rules.exitDays },
      history: history.slice(0, 120),
    };
  }

  async rules(session: SessionUser) {
    await this.requireRulesAccess(session);
    return this.applicants.rules(session.companyId);
  }

  async saveRules(session: SessionUser, body: unknown) {
    await this.requireRulesAccess(session);
    await this.applicants.saveRules(session.companyId, bag(body));
    await this.audit(session, 'hiring.rules', session.companyId);
    return this.applicants.rules(session.companyId);
  }

  async get(session: SessionUser, id: string) {
    await this.requireHr(session);
    const company = await this.company(session.companyId);
    const opening = await this.owned(session.companyId, id);
    const count = await this.prisma.jobApplication.count({ where: { openingId: opening.id } });
    const fresh = await this.prisma.jobApplication.count({ where: { openingId: opening.id, status: 'new' } });
    const recent = await this.prisma.jobApplication.findMany({
      where: { openingId: opening.id },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });
    return {
      ...this.openingDetail(opening, company.slug, count, fresh),
      recent: recent.map((row) => this.applicationView(row)),
    };
  }

  async create(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const input = this.openingInput(body, true);
    const agencyId = await this.agencyOf(session.companyId, bag(body).agencyId);
    const code = await this.nextCode(session.companyId);
    const opening = await this.prisma.opening.create({
      data: { companyId: session.companyId, code, ...input, agencyId, status: 'draft' },
    });
    await this.audit(session, 'opening.create', opening.id);
    const company = await this.company(session.companyId);
    return this.openingDetail(opening, company.slug, 0, 0);
  }

  async update(session: SessionUser, id: string, body: unknown) {
    await this.requireHr(session);
    const current = await this.owned(session.companyId, id);
    const input = bag(body);
    const next = this.openingInput(input, false, current);
    const agencyId = input.agencyId === undefined ? current.agencyId : await this.agencyOf(session.companyId, input.agencyId);
    const status = input.status === undefined ? current.status : this.statusOf(input.status);
    if (status === 'open' && plainOf(next.description).length < 20) {
      fail(400, 'Add a short description before you open this job. Portals need something to show.');
    }
    const opening = await this.prisma.opening.update({
      where: { id: current.id },
      data: { ...next, agencyId, status },
    });
    await this.audit(session, status === 'open' ? 'opening.open' : status === 'closed' ? 'opening.close' : 'opening.update', opening.id);
    const company = await this.company(session.companyId);
    const count = await this.prisma.jobApplication.count({ where: { openingId: opening.id } });
    const fresh = await this.prisma.jobApplication.count({ where: { openingId: opening.id, status: 'new' } });
    return this.openingDetail(opening, company.slug, count, fresh);
  }

  async remove(session: SessionUser, id: string) {
    await this.requireHr(session);
    const current = await this.owned(session.companyId, id);
    if (current.status !== 'draft') fail(400, 'Close an open job to stop applications. Closed jobs stay so HR can still read who applied.');
    const count = await this.prisma.jobApplication.count({ where: { openingId: current.id } });
    if (count) fail(400, 'This draft already has applications. Close it instead of deleting it.');
    await this.prisma.opening.delete({ where: { id: current.id } });
    await this.audit(session, 'opening.delete', current.id);
    return { ok: true };
  }

  async internalBoard(session: SessionUser) {
    const rows = await this.prisma.opening.findMany({
      where: { companyId: session.companyId, status: 'open', OR: [{ internal: true }, { referral: true }] },
      orderBy: { title: 'asc' },
    });
    const mine = session.employeeId
      ? await this.prisma.jobApplication.findMany({
          where: { companyId: session.companyId, OR: [{ referrerId: session.employeeId }, { source: 'internal', email: session.email }] },
          orderBy: { createdAt: 'desc' },
          take: 30,
        })
      : [];
    return {
      openings: rows.map((row) => ({ id: row.id, code: row.code, title: row.title, department: row.department, location: row.location, internal: row.internal, referral: row.referral })),
      mine: mine.map((row) => ({ id: row.id, title: row.jobTitle, code: row.jobCode, name: row.name, source: row.source, status: row.status, createdAt: row.createdAt.toISOString() })),
    };
  }

  async applyInternal(session: SessionUser, openingId: string) {
    if (!session.employeeId) fail(400, 'Your sign-in is not linked to a person yet.');
    const opening = await this.openInternal(session.companyId, openingId, 'internal');
    const existing = await this.prisma.jobApplication.findFirst({ where: { openingId: opening.id, email: session.email, source: 'internal' } });
    if (existing) fail(409, 'You have already applied for this job.');
    const saved = await this.prisma.jobApplication.create({
      data: {
        companyId: session.companyId,
        openingId: opening.id,
        name: session.name,
        email: session.email,
        source: 'internal',
        status: 'new',
        jobTitle: opening.title,
        jobCode: opening.code,
        referrerId: session.employeeId,
      },
    });
    await this.applicants.event(session.companyId, saved.id, 'received', 'Applied from inside the company for ' + opening.title, session.name);
    return { id: saved.id, status: saved.status };
  }

  async refer(session: SessionUser, openingId: string, body: unknown) {
    if (!session.employeeId) fail(400, 'Your sign-in is not linked to a person yet.');
    const opening = await this.openInternal(session.companyId, openingId, 'referral');
    const input = bag(body);
    const email = emailOf(input.email);
    const existing = await this.prisma.jobApplication.findFirst({ where: { openingId: opening.id, email } });
    if (existing) fail(409, 'That person has already been submitted for this job.');
    const name = text(input.name, 'Candidate name', 120);
    const phone = optional(input.phone, 20);
    const cooling = await this.applicants.cooling(session.companyId, { name, email, phone });
    const saved = await this.prisma.jobApplication.create({
      data: {
        companyId: session.companyId,
        openingId: opening.id,
        name,
        email,
        phone,
        note: optional(input.note, 500),
        source: 'referral',
        status: cooling ? 'cooling' : 'new',
        coolingUntil: cooling?.until || '',
        coolingNote: cooling?.reason || '',
        jobTitle: opening.title,
        jobCode: opening.code,
        referrerId: session.employeeId,
      },
    });
    await this.applicants.event(session.companyId, saved.id, 'received', 'Referred for ' + opening.title, session.name);
    if (cooling) await this.applicants.event(session.companyId, saved.id, 'cooling', 'Referred inside the gap until ' + prettyDay(cooling.until) + '. ' + cooling.reason + '. The candidate was not contacted.');
    return { id: saved.id, status: saved.status };
  }

  private async openInternal(companyId: string, id: string, kind: 'internal' | 'referral') {
    const opening = await this.prisma.opening.findFirst({ where: { id, companyId } });
    if (!opening || opening.status !== 'open') fail(404, 'That job is not open.');
    if (kind === 'internal' && !opening.internal) fail(400, 'This job is not open to people already in the company.');
    if (kind === 'referral' && !opening.referral) fail(400, 'This job is not open for referrals.');
    return opening;
  }

  async updateApplication(session: SessionUser, id: string, body: unknown) {
    await this.requireHr(session);
    const input = bag(body);
    const current = await this.prisma.jobApplication.findFirst({ where: { id, companyId: session.companyId } });
    if (!current) fail(404, 'That application was not found.');
    const status = input.status === undefined ? current.status : this.applicationStatus(input.status);
    const note = input.note === undefined ? current.note : optional(input.note, 1000);
    const resumeText = input.resumeText === undefined ? current.resumeText : this.resumeText(input.resumeText);
    const decided = status !== current.status && (status === 'rejected' || status === 'hired');
    const saved = await this.prisma.jobApplication.update({
      where: { id: current.id },
      data: { status, note, resumeText, decidedAt: decided ? new Date() : current.decidedAt },
    });
    if (status !== current.status) await this.applicants.event(session.companyId, saved.id, 'status', (STATUS_LABEL[current.status] || current.status) + ' → ' + (STATUS_LABEL[status] || status), session.name);
    if (note !== current.note) await this.applicants.event(session.companyId, saved.id, 'note', note ? 'HR note: ' + note : 'HR note cleared', session.name);
    if (resumeText !== current.resumeText) await this.applicants.event(session.companyId, saved.id, 'resume', resumeText ? 'Resume text saved (' + resumeText.length.toLocaleString('en-IN') + ' characters)' : 'Resume text removed', session.name);
    await this.audit(session, 'application.update', saved.id);
    return this.applicationView(saved);
  }

  async savePortals(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const input = bag(body);
    const enabled: Record<string, boolean> = {};
    for (const portal of PORTALS) enabled[portal.id] = input[portal.id] !== false;
    const desk = await this.desk(session.companyId);
    await this.prisma.hiringDesk.update({
      where: { companyId: session.companyId },
      data: { portalsJson: JSON.stringify(enabled) },
    });
    const company = await this.company(session.companyId);
    return this.portalView({ ...desk, portalsJson: JSON.stringify(enabled) }, company.slug);
  }

  async rotateToken(session: SessionUser) {
    await this.requireHr(session);
    await this.desk(session.companyId);
    const token = randomBytes(24).toString('base64url');
    const saved = await this.prisma.hiringDesk.update({ where: { companyId: session.companyId }, data: { feedToken: token } });
    await this.audit(session, 'hiring.rotate', session.companyId);
    const company = await this.company(session.companyId);
    return this.portalView(saved, company.slug);
  }

  async checkPortal(session: SessionUser, portalId: string) {
    await this.requireHr(session);
    const portal = this.portalId(portalId);
    const desk = await this.desk(session.companyId);
    if (!this.enabledMap(desk.portalsJson)[portal]) fail(400, `${this.label(portal)} is turned off. Turn it on, then check again.`);
    const openings = await this.prisma.opening.findMany({ where: { companyId: session.companyId, status: 'open' } });
    const opening = openings.find((row) => this.readPortals(row.portalsJson).includes(portal));
    if (!opening) fail(400, `Open a job and tick ${this.label(portal)} before sending a check. Nothing is posted there yet.`);
    const saved = await this.receive(opening, portal, {
      job: opening.code,
      name: 'Portal check',
      email: session.email,
      phone: '',
      city: '',
      resume: '',
      note: `Sent from the ${this.label(portal)} check. Reject it if you were only testing the pipe.`,
    }, true);
    return saved;
  }

  async publicView(companySlug: string, code: string) {
    const opening = await this.publicOpening(companySlug, code);
    const company = await this.company(opening.companyId);
    return {
      company: company.name,
      code: opening.code,
      title: opening.title,
      department: opening.department,
      location: opening.location,
      workplace: opening.workplace,
      employment: opening.employment,
      seats: opening.seats,
      description: opening.description,
      requirements: opening.requirements,
      salaryNote: opening.salaryNote,
      closed: opening.status !== 'open',
    };
  }

  async publicApply(companySlug: string, code: string, source: string, body: unknown) {
    const opening = await this.publicOpening(companySlug, code);
    if (opening.status !== 'open') fail(409, 'This job is closed. HR is not taking new applications.');
    const portal = this.sourceOf(source);
    const input = bag(body);
    const saved = await this.receive(opening, portal, {
      job: opening.code,
      name: text(input.name, 'Full name', 120),
      email: emailOf(input.email),
      phone: this.phone(input.phone),
      city: optional(input.city, 80),
      resume: this.resume(input.resume),
      note: optional(input.note, 2000),
    }, false);
    return { thanks: saved.reply || 'Thank you. HR has your application for ' + opening.title + '.', id: saved.id, cooling: Boolean(saved.reply) };
  }

  async feed(token: string, portal: string | undefined) {
    const desk = await this.byToken(token);
    const company = await this.company(desk.companyId);
    const source = portal ? this.portalId(portal) : 'website';
    if (source !== 'website' && !this.enabledMap(desk.portalsJson)[source]) {
      return { company: company.name, portal: this.label(source), jobs: [] };
    }
    const jobs = await this.openJobs(desk.companyId, source);
    return {
      company: company.name,
      portal: source === 'website' ? 'Company website' : this.label(source),
      jobs: jobs.map((job) => this.feedJob(job, company, source)),
    };
  }

  async feedXml(token: string, portal: string | undefined): Promise<string> {
    const pack = await this.feed(token, portal);
    const jobTypes: Record<string, string> = { 'full-time': 'fulltime', 'part-time': 'parttime', contract: 'contract', intern: 'internship' };
    const jobs = pack.jobs.map((job) => {
      const description = `<![CDATA[${String(job.description).replaceAll(']]>', ']]]]><![CDATA[>')}]]>`;
      return [
        '<job>',
        tag('title', job.title),
        tag('referencenumber', job.code),
        tag('url', job.applyUrl),
        tag('company', pack.company),
        tag('city', job.location),
        tag('jobtype', jobTypes[job.employment] || job.employment),
        `<description>${description}</description>`,
        '</job>',
      ].join('');
    }).join('');
    return `<?xml version="1.0" encoding="UTF-8"?><source><publisher>${escapeXml(pack.company)}</publisher>${jobs}</source>`;
  }

  async inbound(token: string, portalId: string, body: unknown) {
    const desk = await this.byToken(token);
    const portal = this.portalId(portalId);
    if (!this.enabledMap(desk.portalsJson)[portal]) fail(403, `${this.label(portal)} is turned off for this company.`);
    const inbound = readInbound(body);
    const opening = await this.prisma.opening.findFirst({ where: { companyId: desk.companyId, code: inbound.job.toUpperCase() } });
    if (!opening) fail(404, 'That job code was not found. Use the code from the feed, such as JOB001.');
    if (opening.status !== 'open') fail(409, 'That job is closed. HR is not taking new applications.');
    const saved = await this.receive(opening, portal, inbound, false);
    return { ok: true, id: saved.id, job: opening.code, source: this.label(portal), status: saved.status, reply: saved.reply };
  }

  private async receive(opening: { id: string; companyId: string; code: string; title: string }, portal: string, inbound: InboundApplication, force: boolean) {
    if (inbound.resume && !/^https:\/\/[^\s]+$/i.test(inbound.resume)) fail(400, 'The resume must be an https link, or leave it blank.');
    if (inbound.phone && !/^\+?[0-9][0-9\s().-]{5,22}$/.test(inbound.phone)) fail(400, 'Enter a valid phone number, or leave it blank.');
    if (!force) {
      const since = new Date(Date.now() - 2 * 60 * 1000);
      const duplicate = await this.prisma.jobApplication.findFirst({
        where: { openingId: opening.id, email: inbound.email, source: portal, createdAt: { gte: since } },
      });
      if (duplicate) return { ...this.applicationView(duplicate), reply: '' };
    }
    const cooling = force ? null : await this.applicants.cooling(opening.companyId, inbound);
    const saved = await this.prisma.jobApplication.create({
      data: {
        companyId: opening.companyId,
        openingId: opening.id,
        name: inbound.name,
        email: inbound.email,
        phone: inbound.phone,
        city: inbound.city,
        resumeUrl: inbound.resume,
        source: portal,
        status: cooling ? 'cooling' : 'new',
        coolingUntil: cooling?.until || '',
        coolingNote: cooling?.reason || '',
        note: force ? inbound.note : '',
        jobTitle: opening.title,
        jobCode: opening.code,
        answersJson: JSON.stringify({ name: inbound.name, email: inbound.email, phone: inbound.phone, city: inbound.city, resume: inbound.resume, note: inbound.note }),
      },
    });
    await this.prisma.auditEvent.create({
      data: { companyId: opening.companyId, actorId: 'public', action: 'application.receive', entity: 'application', entityId: saved.id, detail: portal },
    });
    await this.applicants.event(opening.companyId, saved.id, 'received', 'Applied for ' + opening.title + ' through ' + (portal === 'website' ? 'the company website' : this.label(portal)));
    const reply = cooling ? await this.applicants.tell(opening.companyId, saved.id, inbound, opening.title, cooling) : '';
    return { ...this.applicationView(saved), reply };
  }

  private async openJobs(companyId: string, portal: string) {
    const rows = await this.prisma.opening.findMany({ where: { companyId, status: 'open' }, orderBy: { updatedAt: 'desc' } });
    if (portal === 'website') return rows;
    return rows.filter((row) => this.readPortals(row.portalsJson).includes(portal));
  }

  private feedJob(job: { code: string; title: string; department: string; location: string; workplace: string; employment: string; description: string; requirements: string; salaryNote: string }, company: { slug: string; name: string }, portal: string) {
    const origin = (process.env.WEB_ORIGIN || 'http://localhost:4400').replace(/\/$/, '');
    const text = [plainOf(job.description), plainOf(job.requirements), job.salaryNote].filter(Boolean).join('\n\n');
    return {
      code: job.code,
      title: job.title,
      department: job.department,
      location: job.location,
      workplace: job.workplace,
      employment: job.employment,
      description: text,
      applyUrl: `${origin}/careers/${company.slug}/${job.code}?from=${portal}`,
    };
  }

  private async publicOpening(companySlug: string, code: string) {
    const slug = String(companySlug || '').trim().toLowerCase();
    const cleaned = String(code || '').trim().toUpperCase();
    if (!/^[a-z0-9-]{2,60}$/.test(slug) || !/^JOB\d{3,6}$/.test(cleaned)) fail(404, 'That job was not found.');
    const company = await this.prisma.company.findUnique({ where: { slug } });
    if (!company) fail(404, 'That job was not found.');
    const opening = await this.prisma.opening.findFirst({ where: { companyId: company.id, code: cleaned } });
    if (!opening || opening.status === 'draft') fail(404, 'That job was not found.');
    return opening;
  }

  private async byToken(token: string) {
    const cleaned = String(token || '').trim();
    if (!/^[A-Za-z0-9_-]{20,80}$/.test(cleaned)) fail(404, 'That feed address is not valid.');
    const desk = await this.prisma.hiringDesk.findUnique({ where: { feedToken: cleaned } });
    if (!desk) fail(404, 'That feed address is not valid.');
    return desk;
  }

  private async desk(companyId: string) {
    const existing = await this.prisma.hiringDesk.findUnique({ where: { companyId } });
    if (existing) return existing;
    return this.prisma.hiringDesk.create({
      data: { companyId, feedToken: randomBytes(24).toString('base64url'), portalsJson: '{}' },
    });
  }

  private async company(id: string) {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) fail(404, 'That company was not found.');
    return company;
  }

  private async owned(companyId: string, id: string) {
    const opening = await this.prisma.opening.findFirst({ where: { id, companyId } });
    if (!opening) fail(404, 'That job was not found.');
    return opening;
  }

  private async nextCode(companyId: string): Promise<string> {
    const rows = await unscoped(() => this.prisma.opening.findMany({ where: { companyId }, select: { code: true } }));
    let max = 0;
    for (const row of rows) {
      const match = /^JOB(\d+)$/.exec(row.code);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return 'JOB' + String(max + 1).padStart(3, '0');
  }

  private async agencyOf(companyId: string, value: unknown): Promise<string | null> {
    const id = String(value || '').trim();
    if (!id) return null;
    const company = await this.prisma.company.findFirst({ where: { id: companyId }, select: { hireViaAgencies: true } });
    if (!company?.hireViaAgencies) fail(400, 'Turn on hiring through agencies before tying a job to one.');
    const vendor = await this.prisma.vendor.findFirst({ where: { id, companyId, active: true, hireThrough: true } });
    if (!vendor) fail(400, 'That agency is not set up for hiring.');
    return id;
  }

  private openingInput(body: unknown, creating: boolean, current?: { title: string; department: string; location: string; workplace: string; employment: string; seats: number; description: string; requirements: string; salaryNote: string; portalsJson: string; internal: boolean; referral: boolean }) {
    const input = bag(body);
    const title = input.title === undefined && !creating ? current!.title : text(input.title, 'Job title', 120);
    const workplace = input.workplace === undefined && !creating ? current!.workplace : this.choice(input.workplace, WORKPLACES, 'Workplace');
    const employment = input.employment === undefined && !creating ? current!.employment : this.choice(input.employment, EMPLOYMENT, 'Employment type');
    const seats = input.seats === undefined && !creating ? current!.seats : this.seats(input.seats);
    const portals = input.portals === undefined && !creating ? this.readPortals(current!.portalsJson) : this.portalsOf(input.portals);
    return {
      title,
      department: input.department === undefined && !creating ? current!.department : optional(input.department, 80),
      location: input.location === undefined && !creating ? current!.location : optional(input.location, 80),
      workplace,
      employment,
      seats,
      description: input.description === undefined && !creating ? current!.description : richOf(input.description, 'Description', 8000, false),
      requirements: input.requirements === undefined && !creating ? current!.requirements : richOf(input.requirements, 'Requirements', 4000, false),
      salaryNote: input.salaryNote === undefined && !creating ? current!.salaryNote : optional(input.salaryNote, 160),
      internal: input.internal === undefined && !creating ? current!.internal : input.internal === true,
      referral: input.referral === undefined && !creating ? current!.referral : input.referral === true,
      portalsJson: JSON.stringify(portals),
    };
  }

  private openingSummary(row: { id: string; code: string; title: string; department: string; location: string; workplace: string; employment: string; status: string; portalsJson: string; internal?: boolean; referral?: boolean; updatedAt: Date; _count: { applications: number } }, slug: string, fresh: number) {
    const portals = this.readPortals(row.portalsJson);
    return {
      id: row.id,
      code: row.code,
      title: row.title,
      department: row.department,
      location: row.location,
      workplace: row.workplace,
      employment: row.employment,
      status: row.status,
      internal: row.internal === true,
      referral: row.referral === true,
      portals,
      portalLabel: portals.length ? portals.map((id) => this.label(id)).join(', ') : 'Website only',
      applications: row._count.applications,
      fresh,
      updatedAt: row.updatedAt.toISOString(),
      applyPath: `/careers/${slug}/${row.code}`,
    };
  }

  private openingDetail(row: { id: string; code: string; title: string; department: string; location: string; workplace: string; employment: string; seats: number; description: string; requirements: string; salaryNote: string; status: string; portalsJson: string; agencyId?: string | null; internal?: boolean; referral?: boolean; updatedAt: Date }, slug: string, applications: number, fresh: number) {
    return {
      ...this.openingSummary({ ...row, _count: { applications } }, slug, fresh),
      seats: row.seats,
      description: row.description,
      requirements: row.requirements,
      salaryNote: row.salaryNote,
      agencyId: row.agencyId || '',
    };
  }

  private applicationView(row: { id: string; name: string; email: string; phone: string; city: string; resumeUrl: string; source: string; status: string; note: string; jobTitle: string; jobCode: string; openingId: string | null; answersJson: string; resumeText: string; coolingUntil: string; createdAt: Date }) {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      city: row.city,
      resumeUrl: row.resumeUrl,
      source: row.source,
      portal: row.source === 'form' ? 'Website form' : row.source === 'website' ? 'Company website' : this.label(row.source),
      status: row.status,
      note: row.note,
      message: this.messageOf(row.answersJson),
      jobTitle: row.jobTitle,
      jobCode: row.jobCode,
      openingId: row.openingId || '',
      hasResumeText: Boolean(row.resumeText),
      coolingUntil: row.coolingUntil,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private answersOf(raw: string, fieldsJson: string): Array<{ label: string; value: string }> {
    let labels: Record<string, string> = {};
    try {
      const fields = JSON.parse(fieldsJson || '[]') as Array<{ key?: string; label?: string }>;
      if (Array.isArray(fields)) labels = Object.fromEntries(fields.filter((field) => field.key).map((field) => [String(field.key), String(field.label || field.key)]));
    } catch {
      labels = {};
    }
    try {
      const parsed = JSON.parse(raw || '{}') as Record<string, unknown>;
      return Object.entries(parsed)
        .filter(([key, value]) => typeof value === 'string' && value.trim() && !['name', 'email', 'phone', 'note', 'resume'].includes(key))
        .map(([key, value]) => ({ label: labels[key] || key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'), value: String(value).slice(0, 2000) }));
    } catch {
      return [];
    }
  }

  private resumeText(value: unknown): string {
    const cleaned = String(value ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (cleaned.length > 20000) fail(400, 'The resume text is too long. Keep it under 20,000 characters.');
    return cleaned;
  }

  private portalView(desk: { feedToken: string; portalsJson: string }, slug: string) {
    const enabled = this.enabledMap(desk.portalsJson);
    return {
      feedToken: desk.feedToken,
      company: slug,
      feedPath: '/v1/feeds/' + desk.feedToken + '/jobs',
      xmlPath: '/v1/feeds/' + desk.feedToken + '/xml',
      webhookPath: '/v1/feeds/' + desk.feedToken,
      portals: PORTALS.map((portal) => ({ ...portal, enabled: enabled[portal.id] !== false })),
    };
  }

  private enabledMap(raw: string): Record<string, boolean> {
    try {
      const parsed = JSON.parse(raw || '{}') as Record<string, unknown>;
      const enabled: Record<string, boolean> = {};
      for (const portal of PORTALS) enabled[portal.id] = parsed[portal.id] !== false;
      return enabled;
    } catch {
      return Object.fromEntries(PORTALS.map((portal) => [portal.id, true]));
    }
  }

  private readPortals(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw || '[]') as unknown;
      if (!Array.isArray(parsed)) return [];
      return [...new Set(parsed.map((item) => String(item)).filter((item) => PORTAL_IDS.has(item)))];
    } catch {
      return [];
    }
  }

  private portalsOf(value: unknown): string[] {
    if (value === undefined || value === null || value === '') return [];
    if (!Array.isArray(value)) fail(400, 'Choose the portals from the list.');
    const ids = [...new Set(value.map((item) => String(item)))];
    if (ids.some((id) => !PORTAL_IDS.has(id))) fail(400, 'Choose a portal from the list.');
    return ids;
  }

  private portalId(value: string): string {
    const cleaned = String(value || '').trim().toLowerCase();
    if (cleaned === 'website') return 'website';
    if (!PORTAL_IDS.has(cleaned)) fail(400, 'Choose a portal from the list.');
    return cleaned;
  }

  private sourceOf(value: string): string {
    const cleaned = String(value || '').trim().toLowerCase();
    if (!cleaned || cleaned === 'website' || cleaned === 'form') return 'website';
    if (!PORTAL_IDS.has(cleaned)) return 'website';
    return cleaned;
  }

  private label(id: string): string {
    return PORTALS.find((portal) => portal.id === id)?.label || 'Company website';
  }

  private choice(value: unknown, allowed: Set<string>, label: string): string {
    const cleaned = String(value ?? '').trim();
    if (!allowed.has(cleaned)) fail(400, `${label} is not one of the choices.`);
    return cleaned;
  }

  private statusOf(value: unknown): string {
    const cleaned = String(value ?? '').trim();
    if (!OPENING_STATUS.has(cleaned)) fail(400, 'Set the job to draft, open, or closed.');
    return cleaned;
  }

  private applicationStatus(value: unknown): string {
    const cleaned = String(value ?? '').trim();
    if (!APPLICATION_STATUS.has(cleaned)) fail(400, 'Choose a status HR uses: new, reviewing, shortlisted, interview, rejected, or hired.');
    return cleaned;
  }

  private seats(value: unknown): number {
    const seats = Number(value);
    if (!Number.isInteger(seats) || seats < 1 || seats > 50) fail(400, 'The number of openings must be a whole number from 1 to 50.');
    return seats;
  }

  private phone(value: unknown): string {
    const cleaned = optional(value, 30);
    if (!cleaned) return '';
    if (!/^\+?[0-9][0-9\s().-]{5,22}$/.test(cleaned)) fail(400, 'Enter a valid phone number, or leave it blank.');
    return cleaned;
  }

  private resume(value: unknown): string {
    const cleaned = optional(value, 400);
    if (!cleaned) return '';
    if (!/^https:\/\/[^\s]+$/i.test(cleaned)) fail(400, 'The resume must be an https link, or leave it blank.');
    return cleaned;
  }

  private messageOf(raw: string, max = 240): string {
    try {
      const parsed = JSON.parse(raw || '{}') as Record<string, unknown>;
      return String(parsed.note || parsed.message || parsed.coverLetter || '').slice(0, max);
    } catch {
      return '';
    }
  }

  private async requireHr(session: SessionUser): Promise<void> {
    await this.gates.gate(session, 'hiring', 'You do not have access to hiring.');
  }

  /** Settings → Rules and Hiring desk both edit re-apply gaps. */
  private async requireRulesAccess(session: SessionUser): Promise<void> {
    if (await this.gates.holds(session, 'settings')) return;
    if (await this.gates.holds(session, 'hiring')) return;
    fail(403, 'You do not have access to hiring rules.');
  }

  private async audit(session: SessionUser, action: string, id: string): Promise<void> {
    await this.prisma.auditEvent.create({
      data: { companyId: session.companyId, actorId: session.id, action, entity: 'opening', entityId: id },
    });
  }
}

export function readInbound(body: unknown): InboundApplication {
  const input = bag(body);
  if (input.applicant && typeof input.applicant === 'object') return readPerson(input, input.applicant as Record<string, unknown>);
  if (input.candidate && typeof input.candidate === 'object') return readPerson(input, input.candidate as Record<string, unknown>);
  return readPerson(input, input);
}

function readPerson(root: Record<string, unknown>, person: Record<string, unknown>): InboundApplication {
  const job = root.job && typeof root.job === 'object' ? (root.job as Record<string, unknown>) : {};
  const code = first(root.job, root.jobCode, root.code, root.requisition, job.jobId, job.code, job.reference, job.referencenumber);
  const resume = person.resume && typeof person.resume === 'object' ? (person.resume as Record<string, unknown>).url : person.resume;
  const email = first(person.email, person.emailId, person.mail);
  const name = first(person.name, person.fullName, person.candidateName, person.applicantName);
  if (!String(code || '').trim()) fail(400, 'Include the job code, such as JOB001.');
  if (person.resume && typeof person.resume === 'object' && (person.resume as Record<string, unknown>).file) {
    fail(400, 'Send the resume as an https link. File uploads are not stored.');
  }
  return {
    job: String(code).trim(),
    name: text(name, 'Full name', 120),
    email: emailOf(email),
    phone: optional(first(person.phone, person.mobile, person.phoneNumber), 30),
    city: optional(first(person.city, person.location), 80),
    resume: optional(resume, 400),
    note: optional(first(person.note, person.coverLetter, person.message, root.note), 2000),
  };
}

function first(...values: unknown[]): unknown {
  return values.find((value) => typeof value === 'string' || typeof value === 'number') ?? '';
}

function tag(name: string, value: string): string {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
