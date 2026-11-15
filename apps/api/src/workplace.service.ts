import { Injectable } from '@nestjs/common';
import { countedDays, eachDay, kolkataDayRange, rangesOverlap, shiftDay, todayInIndia, weekdayOf } from './dates';
import { bag, fail, optional, optionalId, text } from './http';
import { distanceMetres, Fix, fixOf, placeOf } from './geo';
import { LeaveLedger } from './leave-ledger.service';
import { LibraryService } from './library.service';
import { plainOf, richOf } from './rich';
import { PrismaService } from './prisma.service';
import { SettingsService } from './settings.service';
import { AccessService } from './access.service';
import { HomeBoardService } from './home-board.service';
import { HomeLayoutService } from './home-layout.service';
import { SessionUser } from './session';
import { advanceFlow, buildFlow, FlowKind, FlowStep, mayWaitOn, parseFlow, stageOf, waitsOn } from './approval-flow';
import { notifyPerson } from './people-kit';
import { TtlCache } from './ttl-cache';

@Injectable()
export class WorkplaceService {
  private readonly homeCache = new TtlCache<Record<string, unknown>>(4_000, 100);

  constructor(
    private readonly prisma: PrismaService,
    private readonly library: LibraryService,
    private readonly settings: SettingsService,
    private readonly gates: AccessService,
    private readonly ledger: LeaveLedger,
    private readonly layouts: HomeLayoutService,
    private readonly homeBoard: HomeBoardService,
  ) {}

  async home(session: SessionUser) {
    const cacheKey = `${session.companyId}:${session.id}:${session.outletId || ''}`;
    return this.homeCache.remember(cacheKey, () => this.buildHome(session));
  }

  private async buildHome(session: SessionUser) {
    const today = todayInIndia();
    const [layout, directoryOn, jobsOn] = await Promise.all([
      this.layouts.resolveHome(session),
      this.library.allowsKey(session, 'directory'),
      this.library.allowsKey(session, 'jobs'),
    ]);
    const { blocks, columns, personal } = layout;
    for (const block of blocks) {
      if ((block.key === 'directory' && !directoryOn) || (block.key === 'jobs' && !jobsOn)) {
        block.available = false;
        block.visible = false;
      }
    }
    const widgets = blocks.map((block) => ({ key: block.key, visible: block.visible }));
    const show = (key: string) => blocks.find((item) => item.key === key)?.visible === true;
    const month = today.slice(0, 7);
    const previous = shiftDay(month + '-01', -1).slice(0, 7);
    const [announcements, leave, attendance, people, pending, monthView, joiners, jobs, celebrations, extra] = await Promise.all([
      show('announcements') ? this.announcements(session) : Promise.resolve([]),
      show('leave') && session.employeeId ? this.balances(session.companyId, session.employeeId, today.slice(0, 4)) : Promise.resolve([]),
      show('punch') && session.employeeId ? this.myPunch(session) : Promise.resolve(null),
      this.prisma.employee.count({ where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } } }),
      this.pendingCount(session),
      (show('calendar') || show('month-tally')) && session.employeeId ? this.calendar(session, month) : Promise.resolve(null),
      show('joiners') ? this.prisma.employee.findMany({
        where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] }, OR: [{ dateOfJoining: { startsWith: month } }, { dateOfJoining: { startsWith: previous } }] },
        include: { designation: true, department: true },
        orderBy: { dateOfJoining: 'desc' },
        take: 8,
      }) : Promise.resolve([]),
      show('jobs') ? this.prisma.opening.findMany({
        where: { companyId: session.companyId, status: 'open', OR: [{ internal: true }, { referral: true }] },
        orderBy: { updatedAt: 'desc' },
        take: 6,
      }) : Promise.resolve([]),
      show('celebrations') ? this.celebrations(session) : Promise.resolve({ mailbox: false, note: '', items: [], welcomed: [] as string[] }),
      this.homeBoard.build(session, show),
    ]);
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    const greeting = hour < 5 ? 'Hello' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const days = monthView?.days || [];
    return {
      greeting,
      today,
      widgets,
      blocks,
      columns,
      personal,
      ...extra,
      announcements: announcements.slice(0, 4),
      leave,
      attendance,
      people,
      pending,
      absent: days.filter((day) => day.status === 'absent').length,
      month,
      days: days.map((day) => ({ day: day.day, status: day.status, label: day.label })),
      joiners: joiners.map((row) => ({
        id: row.id,
        name: `${row.firstName} ${row.lastName}`.trim(),
        designation: row.designation?.name || '',
        department: row.department?.name || '',
        joined: row.dateOfJoining,
        mine: row.id === session.employeeId,
        wished: celebrations.welcomed.includes(row.id),
      })),
      celebrations: { mailbox: celebrations.mailbox, note: celebrations.note, items: celebrations.items },
      jobs: jobs.map((row) => ({ id: row.id, code: row.code, title: row.title, department: row.department, internal: row.internal, referral: row.referral })),
    };
  }

  /** The wish email as it will be sent, filled for this person, so the sender can read and edit it first. */
  async wishDraft(session: SessionUser, raw: unknown) {
    const target = await this.wishTarget(session, raw);
    const mail = await this.settings.personalMail(session.companyId, target.kind, target.tokens);
    return {
      person: target.card,
      kind: target.kind,
      occasion: target.occasion,
      mailbox: await this.settings.hasMailbox(session.companyId),
      ...mail,
    };
  }

  async wishPreview(session: SessionUser, raw: unknown) {
    const target = await this.wishTarget(session, raw);
    const mail = await this.settings.personalMail(session.companyId, target.kind, target.tokens, this.wishEdit(raw));
    return { html: mail.html };
  }

  async sendWish(session: SessionUser, raw: unknown) {
    const target = await this.wishTarget(session, raw);
    const { person, kind, day, user, tokens } = target;
    const edit = bag(raw).subject !== undefined ? this.wishEdit(raw) : undefined;
    const mail = await this.settings.personalMail(session.companyId, kind, tokens, edit, false);
    const subject = mail.subject;
    const body = plainOf(mail.body).slice(0, 1500);
    const ref = `${session.id}:${person.id}:${kind}:${day}`;
    let noted = false;
    if (user) {
      try {
        await this.prisma.notification.create({
          data: { companyId: session.companyId, userId: user.id, kind: 'wish', title: subject, body, link: '/', ref },
        });
        noted = true;
      } catch (error) {
        const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
        if (code === 'P2002') return { id: person.id, kind, day, sent: true, emailed: false, message: 'You already sent this wish.' };
        throw error;
      }
    }
    const to = person.email || user?.email || '';
    if (!to.includes('@') && !noted) fail(400, 'This person has no email and no sign-in.');
    const sent = to.includes('@')
      ? await this.settings.sendTemplate(session.companyId, kind, [to], tokens, true, { subject: mail.subject, heading: mail.heading, body: mail.body })
      : { emailed: false, note: 'The wish is in their notifications.' };
    const mailed = sent.emailed
      ? { emailed: true, note: 'The wish was emailed and left in their notifications.' }
      : { emailed: false, note: to.includes('@') ? sent.note + ' The wish is in their notifications.' : sent.note };
    return { id: person.id, kind, day, sent: true, emailed: mailed.emailed, message: mailed.emailed ? mailed.note : (noted ? mailed.note : 'The wish could not be delivered.') };
  }

  private wishEdit(raw: unknown): { subject: string; heading: string; body: string } {
    const input = bag(raw);
    return {
      subject: text(input.subject, 'Subject', 160),
      heading: optional(input.heading, 160),
      body: richOf(input.body, 'Message', 4000, true),
    };
  }

  private async wishTarget(session: SessionUser, raw: unknown) {
    const input = bag(raw);
    const employeeId = text(input.employeeId, 'Person', 40);
    const kind = String(input.kind || '') as 'birthday' | 'anniversary' | 'welcome';
    if (!['birthday', 'anniversary', 'welcome'].includes(kind)) fail(400, 'Choose a birthday, a work anniversary, or a welcome.');
    const person = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId: session.companyId, status: { in: ['active', 'onboarding'] } },
      include: { designation: true, department: true },
    });
    if (!person) fail(404, 'That person was not found.');
    if (person.id === session.employeeId) fail(400, 'A colleague sends this wish.');
    const today = todayInIndia();
    const sender = session.name || 'A colleague';
    let day = '';
    let years = 0;
    if (kind === 'welcome') {
      const month = today.slice(0, 7);
      const previous = shiftDay(month + '-01', -1).slice(0, 7);
      if (!person.dateOfJoining.startsWith(month) && !person.dateOfJoining.startsWith(previous)) {
        fail(400, 'That person did not join this month or last month.');
      }
      day = person.dateOfJoining;
    } else {
      const window = [-2, -1, 0, 1, 2].map((offset) => shiftDay(today, offset));
      const source = kind === 'birthday' ? person.dateOfBirth : person.dateOfJoining;
      day = window.find((item) => source.length >= 10 && item.slice(5) === source.slice(5, 10)) || '';
      if (!day) fail(400, 'That occasion is outside today, yesterday, the day before, tomorrow, and the day after.');
      if (kind === 'anniversary') {
        const joinedYear = Number(person.dateOfJoining.slice(0, 4));
        const year = Number(day.slice(0, 4));
        if (!(joinedYear > 1900 && joinedYear < year)) fail(400, 'A work anniversary starts the year after joining.');
        years = year - joinedYear;
      }
    }
    const user = await this.prisma.user.findFirst({ where: { employeeId: person.id, companyId: session.companyId } });
    const email = person.email || user?.email || '';
    const occasion = kind === 'birthday' ? 'Birthday' : kind === 'anniversary' ? `${years}-year work anniversary` : 'New joiner';
    return {
      person,
      kind,
      day,
      user,
      occasion,
      tokens: { name: person.firstName, sender, years: String(years) },
      card: {
        id: person.id,
        name: `${person.firstName} ${person.lastName}`.trim(),
        code: person.code,
        email: email.includes('@') ? email : '',
        role: person.designation?.name || person.department?.name || '',
        notify: !!user,
      },
    };
  }

  private async celebrations(session: SessionUser) {
    const today = todayInIndia();
    const labels = ['Day before', 'Yesterday', 'Today', 'Tomorrow', 'Day after'];
    const window = [-2, -1, 0, 1, 2].map((offset, index) => ({ day: shiftDay(today, offset), label: labels[index] }));
    const month = today.slice(0, 7);
    const previous = shiftDay(month + '-01', -1).slice(0, 7);
    const [people, sent, mailbox] = await Promise.all([
      this.prisma.employee.findMany({
        where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } },
        select: { id: true, firstName: true, lastName: true, code: true, dateOfBirth: true, dateOfJoining: true },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.notification.findMany({
        where: { companyId: session.companyId, kind: 'wish', ref: { startsWith: session.id + ':' } },
        select: { ref: true },
      }),
      this.settings.hasMailbox(session.companyId),
    ]);
    const sentRefs = new Set(sent.map((row) => row.ref));
    const welcomed: string[] = [];
    const items = people.flatMap((person) => {
      const name = `${person.firstName} ${person.lastName}`.trim();
      if (person.dateOfJoining.startsWith(month) || person.dateOfJoining.startsWith(previous)) {
        if (sentRefs.has(`${session.id}:${person.id}:welcome:${person.dateOfJoining}`)) welcomed.push(person.id);
      }
      return window.flatMap((slot) => {
        const rows: Array<{ id: string; name: string; code: string; kind: string; label: string; when: string; day: string; years: number; mine: boolean; sent: boolean }> = [];
        const mark = slot.day.slice(5);
        if (person.dateOfBirth.length >= 10 && person.dateOfBirth.slice(5, 10) === mark) {
          const ref = `${session.id}:${person.id}:birthday:${slot.day}`;
          rows.push({ id: person.id, name, code: person.code, kind: 'birthday', label: 'Birthday', when: slot.label, day: slot.day, years: 0, mine: person.id === session.employeeId, sent: sentRefs.has(ref) });
        }
        const joinedYear = Number(person.dateOfJoining.slice(0, 4));
        const year = Number(slot.day.slice(0, 4));
        if (person.dateOfJoining.length >= 10 && person.dateOfJoining.slice(5, 10) === mark && joinedYear > 1900 && joinedYear < year) {
          const ref = `${session.id}:${person.id}:anniversary:${slot.day}`;
          rows.push({ id: person.id, name, code: person.code, kind: 'anniversary', label: 'Work anniversary', when: slot.label, day: slot.day, years: year - joinedYear, mine: person.id === session.employeeId, sent: sentRefs.has(ref) });
        }
        return rows;
      });
    });
    const order = new Map(window.map((slot, index) => [slot.day, index]));
    items.sort((left, right) => (order.get(left.day) || 0) - (order.get(right.day) || 0) || left.name.localeCompare(right.name));
    return {
      mailbox,
      note: mailbox
        ? 'Congrats opens the message so you can edit it, then emails it and leaves it in their notifications.'
        : 'Congrats opens the message so you can edit it. Add a mailbox in Settings to email it as well. Until then it goes to their notifications.',
      items,
      welcomed,
    };
  }

  async announcements(session: SessionUser) {
    const today = todayInIndia();
    const me = session.employeeId
      ? await this.prisma.employee.findFirst({ where: { id: session.employeeId, companyId: session.companyId } })
      : null;
    const rows = await this.prisma.announcement.findMany({
      where: { companyId: session.companyId },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    const editor = await this.gates.holds(session, 'news');
    return rows
      .filter((row) => !row.expiresOn || row.expiresOn >= today)
      .filter((row) => {
        if (editor || row.audience === 'all') return true;
        if (row.audience === 'department') return me?.departmentId === row.departmentId;
        if (row.audience === 'location') return me?.locationId === row.locationId;
        return false;
      })
      .map((row) => ({
        id: row.id,
        title: row.title,
        body: row.body,
        pinned: row.pinned,
        audience: row.audience,
        authorName: row.authorName,
        expiresOn: row.expiresOn,
        createdAt: row.createdAt.toISOString(),
      }));
  }

  async createAnnouncement(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'news', 'You do not have access to post an announcement.');
    const input = bag(body);
    const audience = String(input.audience || 'all');
    if (!['all', 'department', 'location'].includes(audience)) fail(400, 'Choose who should see this announcement.');
    const departmentId = optionalId(input.departmentId);
    const locationId = optionalId(input.locationId);
    if (audience === 'department' && !departmentId) fail(400, 'Choose a department.');
    if (audience === 'location' && !locationId) fail(400, 'Choose a location.');
    if (departmentId && !(await this.prisma.department.findFirst({ where: { id: departmentId, companyId: session.companyId } }))) {
      fail(400, 'Choose a department from this company.');
    }
    if (locationId && !(await this.prisma.location.findFirst({ where: { id: locationId, companyId: session.companyId } }))) {
      fail(400, 'Choose a location from this company.');
    }
    const expiresOn = optional(input.expiresOn, 10);
    if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) fail(400, 'Expiry needs a real date, or leave it blank.');
    const row = await this.prisma.announcement.create({
      data: {
        companyId: session.companyId,
        title: text(input.title, 'Title', 140),
        body: richOf(input.body, 'Message', 4000, true),
        pinned: input.pinned === true,
        audience,
        departmentId: audience === 'department' ? departmentId : null,
        locationId: audience === 'location' ? locationId : null,
        authorId: session.id,
        authorName: session.name,
        expiresOn,
      },
    });
    void this.mailAnnouncement(session.companyId, row).catch(() => undefined);
    return { id: row.id, title: row.title };
  }

  /** Outlet used for self-service leave/attendance type pickers (never “all outlets”). */
  private async leavePickerOutlet(session: SessionUser): Promise<string | null> {
    if (session.outletId) return session.outletId;
    if (session.employeeId) {
      const person = await this.prisma.employee.findUnique({ where: { id: session.employeeId }, select: { outletId: true } });
      if (person?.outletId) return person.outletId;
    }
    return session.outletIds?.[0] || null;
  }

  private uniqueLeaveTypes<T extends { id: string; name: string; code: string }>(rows: T[]): T[] {
    const seen = new Set<string>();
    const out: T[] = [];
    for (const row of rows) {
      const key = (row.code || row.name).trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    return out;
  }

  async leave(session: SessionUser) {
    const today = todayInIndia();
    const balances = session.employeeId ? await this.balances(session.companyId, session.employeeId, today.slice(0, 4)) : [];
    const homeOutletId = await this.leavePickerOutlet(session);
    const types = await this.prisma.leaveType.findMany({
      where: {
        companyId: session.companyId,
        active: true,
        ...(homeOutletId ? { outletId: homeOutletId } : {}),
      },
      orderBy: { name: 'asc' },
    });
    const mine = session.employeeId
      ? await this.prisma.leaveRequest.findMany({
          where: { companyId: session.companyId, employeeId: session.employeeId },
          include: { leaveType: true },
          orderBy: { createdAt: 'desc' },
          take: 30,
        })
      : [];
    const queue = await this.queue(session);
    return {
      balances,
      types: this.uniqueLeaveTypes(types.map((row) => ({ id: row.id, name: row.name, code: row.code, paid: row.paid, daysPerYear: row.daysPerYear }))),
      mine: mine.map((row) => this.presentRequest(row)),
      queue,
    };
  }

  async applyLeave(session: SessionUser, body: unknown) {
    if (!session.employeeId) fail(400, 'Your sign-in is not linked to a person yet.');
    await this.stillWorking(session);
    const input = bag(body);
    const leaveTypeId = text(input.leaveTypeId, 'Leave type', 40);
    const startsOn = text(input.startsOn, 'Start date', 10);
    const endsOn = text(input.endsOn, 'End date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) fail(400, 'Choose a start and end date.');
    const rules = await this.timeRules(session.companyId);
    const holidays = await this.holidaySet(session.companyId, startsOn, endsOn);
    let days = 0;
    try {
      if (startsOn > endsOn) fail(400, 'Choose an end date on or after the start date.');
      days = countedDays(startsOn, endsOn, rules.weekOff, holidays);
    } catch (error) {
      fail(400, error instanceof Error ? error.message : 'Those dates are not valid.');
    }
    if (days < 1) fail(400, 'That range falls only on a weekly off or a company holiday.');
    const portion = input.portion === 'half' ? 'half' : 'full';
    if (portion === 'half' && (startsOn !== endsOn || days !== 1)) fail(400, 'A half day is a single working day.');
    const type = await this.prisma.leaveType.findFirst({ where: { id: leaveTypeId, companyId: session.companyId, active: true } });
    if (!type) fail(400, 'Choose a leave type.');
    const person = await this.prisma.employee.findFirst({ where: { id: session.employeeId, companyId: session.companyId }, select: { id: true, confirmedOn: true, probationEndsOn: true } });
    if (!person) fail(403, 'This sign-in cannot send that request.');
    await this.ledger.check(session.companyId, person, type, { startsOn, endsOn, days, portion }, true);
    const existing = await this.prisma.leaveRequest.findMany({
      where: { companyId: session.companyId, employeeId: session.employeeId, status: { in: ['pending', 'approved'] } },
    });
    if (existing.some((row) => rangesOverlap(startsOn, endsOn, row.startsOn, row.endsOn))) {
      fail(409, 'Those dates overlap a leave request that is already pending or approved.');
    }
    const flow = await buildFlow(this.prisma, session.companyId, session.employeeId, 'leave');
    const row = await this.prisma.leaveRequest.create({
      data: {
        companyId: session.companyId,
        employeeId: session.employeeId,
        leaveTypeId: type.id,
        startsOn,
        endsOn,
        days,
        portion,
        reason: optional(input.reason, 500),
        status: 'pending',
        flowJson: JSON.stringify(flow),
      },
      include: { leaveType: true, employee: true },
    });
    return this.presentRequest(row);
  }

  async decideLeave(session: SessionUser, id: string, body: unknown) {
    const input = bag(body);
    const decision = String(input.decision || '');
    if (!['approved', 'rejected', 'cancelled'].includes(decision)) fail(400, 'Choose approve, reject, or cancel.');
    const row = await this.prisma.leaveRequest.findFirst({
      where: { id, companyId: session.companyId },
      include: { leaveType: true, employee: true },
    });
    if (!row) fail(404, 'That leave request was not found.');
    if (row.status !== 'pending') fail(400, 'This request has already been decided.');
    let override = false;
    if (decision === 'cancelled') {
      if (row.employeeId !== session.employeeId && (await this.gates.span(session, 'people.edit')) !== 'company') fail(403, 'You can cancel only your own request.');
    } else {
      override = await this.mustDecide(session, row);
    }
    const note = optional(input.note, 500);
    const step = advanceFlow(row.flowJson, session, decision as 'approved' | 'rejected' | 'cancelled', note, override);
    if (!step.done && step.next) {
      const moved = await this.prisma.leaveRequest.update({ where: { id }, data: { flowJson: step.json, reviewNote: note }, include: { leaveType: true, employee: true } });
      await this.passOn(moved, `${row.leaveType.name} · ${row.startsOn === row.endsOn ? row.startsOn : row.startsOn + ' to ' + row.endsOn}`, session, step.next);
      return this.presentRequest(moved);
    }
    if (decision === 'approved') await this.ledger.check(session.companyId, row.employee, row.leaveType, row, false);
    const saved = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status: decision, reviewerId: session.id, reviewNote: note, decidedAt: new Date(), flowJson: step.json },
      include: { leaveType: true, employee: true },
    });
    if (decision !== 'cancelled' && saved.employee.email) {
      const when = (day: string) => new Date(day + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
      void this.settings.sendTemplate(session.companyId, 'leave', [saved.employee.email], {
        name: saved.employee.firstName,
        type: saved.leaveType.name,
        from: when(saved.startsOn),
        to: when(saved.endsOn),
        days: String(this.charged(saved)),
        status: decision,
      }).catch(() => undefined);
    }
    return this.presentRequest(saved);
  }

  private async mailAnnouncement(companyId: string, row: { title: string; body: string; audience: string; departmentId: string | null; locationId: string | null }) {
    const where: Record<string, unknown> = { companyId, status: { in: ['active', 'onboarding'] } };
    if (row.audience === 'department') where.departmentId = row.departmentId;
    if (row.audience === 'location') where.locationId = row.locationId;
    const people = await this.prisma.employee.findMany({ where, select: { email: true } });
    const to = people.map((person) => person.email).filter((email) => email.includes('@'));
    if (to.length) await this.settings.sendTemplate(companyId, 'announcement', to, { name: 'everyone', title: row.title, body: row.body });
  }

  async attendance(session: SessionUser) {
    const mine = session.employeeId ? await this.myPunch(session) : null;
    if ((await this.gates.span(session, 'exceptions')) === 'none') {
      return { mine, board: [] as BoardRow[] };
    }
    return { mine, board: await this.board(session) };
  }

  async punch(session: SessionUser, body: unknown) {
    if (!session.employeeId) fail(400, 'Your sign-in is not linked to a person yet.');
    await this.stillWorking(session);
    const input = bag(body);
    const note = optional(input.note, 200);
    const fix = fixOf(input);
    const state = await this.myPunch(session);
    const kind = state.next;
    const spot = await this.checkPlace(session, fix, kind === 'in');
    const row = await this.prisma.punch.create({
      data: {
        companyId: session.companyId,
        employeeId: session.employeeId,
        kind,
        note,
        source: 'web',
        lat: fix ? Math.round(fix.lat * 1e6) / 1e6 : null,
        lng: fix ? Math.round(fix.lng * 1e6) / 1e6 : null,
        accuracy: fix ? fix.accuracy : null,
        place: spot.place.slice(0, 160),
        zone: spot.zone.slice(0, 80),
      },
    });
    return { ...(await this.myPunch(session)), punchedAt: row.punchedAt.toISOString(), kind };
  }

  private async checkPlace(session: SessionUser, fix: Fix | null, enforce: boolean): Promise<{ place: string; zone: string }> {
    const policy = await this.settings.checkinPolicy(session.companyId);
    const free = policy.scope === 'anywhere' || policy.anywhere.includes(session.employeeId || '');
    const person = await this.prisma.employee.findFirst({ where: { id: session.employeeId || '', companyId: session.companyId }, select: { locationId: true } });
    const all = (await this.prisma.location.findMany({ where: { companyId: session.companyId } })).filter((row) => row.lat !== null && row.lng !== null);
    const nearest = fix
      ? all.map((row) => ({ row, metres: distanceMetres(fix, { lat: row.lat as number, lng: row.lng as number }) })).sort((a, b) => a.metres - b.metres)
      : [];
    const slack = (radius: number) => radius + Math.min(fix?.accuracy || 0, 100);
    const inside = nearest.find((item) => item.metres <= slack(item.row.radius));
    if (!enforce || free) {
      const label = fix && !inside ? (await placeOf(fix))?.label || '' : '';
      return { place: inside ? inside.row.name : label, zone: fix ? (inside ? inside.row.name : 'Remote') : '' };
    }
    const where = policy.scope === 'country' ? 'within ' + this.countryName(policy.country) : 'at your office';
    if (!fix) fail(400, `Allow location to check in. This company accepts check-in only ${where}.`);
    if (fix.accuracy > 1500) fail(400, `Your location is only accurate to about ${Math.round(fix.accuracy / 100) / 10} km. Turn on precise location or GPS and try again.`);
    if (policy.scope === 'offices') {
      const allowed = policy.ownOffice ? nearest.filter((item) => item.row.id === person?.locationId) : nearest;
      if (!allowed.length) {
        fail(400, policy.ownOffice && person?.locationId
          ? 'Your office does not have a check-in point yet. Ask HR to set it in Settings → Attendance.'
          : policy.ownOffice ? 'You are not assigned to an office yet. Ask HR to set your location.' : 'No office check-in point is set yet. Ask HR to set one in Settings → Attendance.');
      }
      const best = allowed[0];
      if (best.metres > slack(best.row.radius)) {
        const away = best.metres >= 1000 ? (Math.round(best.metres / 100) / 10) + ' km' : best.metres + ' m';
        fail(403, `You are ${away} from ${best.row.name}. Check-in is allowed within ${best.row.radius} m of the office.`);
      }
      return { place: best.row.name, zone: best.row.name };
    }
    const place = await placeOf(fix);
    if (!place) fail(503, 'Your country could not be confirmed right now. Try again in a minute.');
    if (place.country !== policy.country) {
      fail(403, `Check-in is allowed only within ${this.countryName(policy.country)}. Your location reads as ${this.countryName(place.country)}.`);
    }
    return { place: inside ? inside.row.name : place.label, zone: inside ? inside.row.name : 'Remote' };
  }

  private countryName(code: string): string {
    try {
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code;
    } catch {
      return code;
    }
  }

  private async stillWorking(session: SessionUser) {
    const person = await this.prisma.employee.findFirst({ where: { id: session.employeeId || '', companyId: session.companyId }, select: { status: true } });
    if (!person || person.status === 'exited') fail(403, 'This sign-in cannot send that request.');
  }

  async myPunch(session: SessionUser) {
    const today = todayInIndia();
    const last = await this.prisma.punch.findFirst({
      where: { companyId: session.companyId, employeeId: session.employeeId || '' },
      orderBy: { punchedAt: 'desc' },
    });
    const range = kolkataDayRange(today);
    const lastIsToday = !!last && last.punchedAt >= range.start && last.punchedAt <= range.end;
    const openFromEarlierDay = !!last && last.kind === 'in' && !lastIsToday;
    const state = lastIsToday && last?.kind === 'in' ? 'in' : 'out';
    const punches = await this.prisma.punch.findMany({
      where: { companyId: session.companyId, employeeId: session.employeeId || '', punchedAt: { gte: range.start, lte: range.end } },
      orderBy: { punchedAt: 'asc' },
    });
    let worked = 0;
    let open: Date | null = null;
    for (const row of punches) {
      if (row.kind === 'in' && !open) open = row.punchedAt;
      if (row.kind === 'out' && open) {
        worked += Math.max(0, row.punchedAt.getTime() - open.getTime());
        open = null;
      }
    }
    const policy = await this.settings.checkinPolicy(session.companyId);
    const free = policy.anywhere.includes(session.employeeId || '');
    const offices = policy.scope === 'offices'
      ? await this.prisma.location.findMany({ where: { companyId: session.companyId, lat: { not: null } }, select: { id: true, name: true, radius: true } })
      : [];
    const person = policy.ownOffice ? await this.prisma.employee.findFirst({ where: { id: session.employeeId || '' }, select: { locationId: true } }) : null;
    const mineOffices = policy.ownOffice ? offices.filter((row) => row.id === person?.locationId) : offices;
    const rule = free || policy.scope === 'anywhere'
      ? { scope: 'anywhere', label: free && policy.scope !== 'anywhere' ? 'Anywhere, allowed for you' : 'Anywhere' }
      : policy.scope === 'country'
        ? { scope: 'country', label: 'Within ' + this.countryName(policy.country) }
        : { scope: 'offices', label: mineOffices.length ? 'Within ' + mineOffices.map((row) => `${row.radius} m of ${row.name}`).slice(0, 3).join(', ') : 'Office check-in point not set' };
    const firstIn = punches.find((row) => row.kind === 'in');
    const lastOut = [...punches].reverse().find((row) => row.kind === 'out');
    return {
      state,
      next: state === 'in' ? 'out' : 'in',
      missedOut: openFromEarlierDay,
      today,
      workedSeconds: Math.round(worked / 1000),
      sessionStart: state === 'in' && open ? open.toISOString() : '',
      firstIn: firstIn ? firstIn.punchedAt.toISOString() : '',
      lastOut: lastOut ? lastOut.punchedAt.toISOString() : '',
      shiftStart: policy.shiftStart,
      shiftEnd: policy.shiftEnd,
      graceMinutes: policy.graceMinutes,
      rule: { ...rule, needsLocation: rule.scope !== 'anywhere', record: policy.geo || rule.scope !== 'anywhere' },
      punches: punches.map((row) => ({ id: row.id, kind: row.kind, note: row.note, punchedAt: row.punchedAt.toISOString(), place: row.place, zone: row.zone })),
    };
  }

  private async board(session: SessionUser): Promise<BoardRow[]> {
    const today = todayInIndia();
    const range = kolkataDayRange(today);
    const teamOnly = (await this.gates.span(session, 'exceptions')) !== 'company';
    const where = teamOnly
      ? { companyId: session.companyId, status: { in: ['active', 'onboarding'] }, OR: [{ managerId: session.employeeId }, { id: session.employeeId || '' }] }
      : { companyId: session.companyId, status: { in: ['active', 'onboarding'] } };
    const people = await this.prisma.employee.findMany({ where, orderBy: { firstName: 'asc' }, take: 500 });
    const punches = await this.prisma.punch.findMany({
      where: { companyId: session.companyId, punchedAt: { gte: range.start, lte: range.end } },
      orderBy: { punchedAt: 'desc' },
    });
    return people.map((person) => {
      const latest = punches.find((row) => row.employeeId === person.id);
      return {
        id: person.id,
        name: `${person.firstName} ${person.lastName}`.trim(),
        code: person.code,
        state: latest?.kind === 'in' ? 'in' : 'out',
        at: latest ? latest.punchedAt.toISOString() : '',
        where: latest ? latest.zone || latest.place || (latest.source === 'web' ? '' : 'Reader') : '',
      };
    });
  }

  private balances(companyId: string, employeeId: string, year: string) {
    return this.ledger.balances(companyId, employeeId, year);
  }

  private async queue(session: SessionUser) {
    const span = await this.gates.span(session, 'approvals');
    if (span === 'none') return [];
    const company = span === 'company';
    const rows = await this.prisma.leaveRequest.findMany({
      where: { companyId: session.companyId, status: 'pending', ...(company ? {} : mayWaitOn(session)) },
      include: { leaveType: true, employee: true },
      orderBy: { createdAt: 'asc' },
      take: company ? 50 : 200,
    });
    return rows.filter((row) => company || waitsOn(session, row.flowJson, row.employee.managerId)).slice(0, 50).map((row) => this.presentRequest(row));
  }

  private async pendingCount(session: SessionUser): Promise<number> {
    const span = await this.gates.span(session, 'approvals');
    if (span === 'none') return 0;
    if (span === 'company') {
      const where = { companyId: session.companyId, status: 'pending' };
      const [leaveCount, timeCount] = await Promise.all([this.prisma.leaveRequest.count({ where }), this.prisma.attendanceRequest.count({ where })]);
      return leaveCount + timeCount;
    }
    const where = { companyId: session.companyId, status: 'pending', ...mayWaitOn(session) };
    const select = { flowJson: true, employee: { select: { managerId: true } } };
    const [leave, time] = await Promise.all([
      this.prisma.leaveRequest.findMany({ where, select, take: 300 }),
      this.prisma.attendanceRequest.findMany({ where, select, take: 300 }),
    ]);
    return [...leave, ...time].filter((row) => waitsOn(session, row.flowJson, row.employee.managerId)).length;
  }

  /**
   * Throws unless this sign-in may decide the request now. Company-wide approvers may decide any step, which is
   * recorded as an override when the step was waiting on someone else.
   */
  private async mustDecide(session: SessionUser, row: { employeeId: string; flowJson: string; employee: { managerId: string | null } }): Promise<boolean> {
    const span = await this.gates.span(session, 'approvals');
    const mine = waitsOn(session, row.flowJson, row.employee.managerId);
    if (mine && row.employeeId !== session.employeeId) return false;
    if (span === 'company') return !!parseFlow(row.flowJson);
    fail(403, 'This request is waiting on someone else.');
  }

  /** The current step approved; the next approvers see it through their bell, the person is told here. */
  private async passOn(row: { id: string; employeeId: string; flowJson: string }, what: string, session: SessionUser, next: FlowStep) {
    const flow = parseFlow(row.flowJson);
    await notifyPerson(this.prisma, session.companyId, row.employeeId, {
      kind: 'approval',
      title: `${session.name} approved your request`,
      body: `${what}. It now waits for ${next.approvers.map((item) => item.name).join(', ') || next.label}.`,
      link: '/requests',
      ref: `flow:mine:${row.id}:${flow?.at ?? 1}`,
    });
  }

  async calendar(session: SessionUser, month: string) {
    const cleaned = /^\d{4}-\d{2}$/.test(month) ? month : todayInIndia().slice(0, 7);
    const start = cleaned + '-01';
    const end = shiftDay(shiftDay(start, 32).slice(0, 7) + '-01', -1);
    const rules = await this.timeRules(session.companyId);
    const year = cleaned.slice(0, 4);
    const yearHolidays = await this.prisma.holiday.findMany({
      where: { companyId: session.companyId, day: { gte: year + '-01-01', lte: year + '-12-31' } },
      orderBy: { day: 'asc' },
    });
    const holidayName = new Map(yearHolidays.filter((row) => row.day >= start && row.day <= end).map((row) => [row.day, row.name]));
    const employeeId = session.employeeId || '';
    const [punches, leaves, requests, types] = await Promise.all([
      employeeId ? this.prisma.punch.findMany({
        where: { companyId: session.companyId, employeeId, punchedAt: { gte: kolkataDayRange(start).start, lte: kolkataDayRange(end).end } },
        orderBy: { punchedAt: 'asc' },
      }) : Promise.resolve([]),
      employeeId ? this.prisma.leaveRequest.findMany({
        where: { companyId: session.companyId, employeeId, status: { in: ['pending', 'approved'] }, startsOn: { lte: end }, endsOn: { gte: start } },
        include: { leaveType: true },
      }) : Promise.resolve([]),
      employeeId ? this.prisma.attendanceRequest.findMany({
        where: {
          companyId: session.companyId,
          employeeId,
          status: { in: ['pending', 'approved'] },
          OR: [
            { endsOn: '', day: { gte: start, lte: end } },
            { AND: [{ endsOn: { not: '' } }, { day: { lte: end } }, { endsOn: { gte: start } }] },
          ],
        },
        orderBy: { createdAt: 'desc' },
      }) : Promise.resolve([]),
      employeeId
        ? this.balances(session.companyId, employeeId, todayInIndia().slice(0, 4))
        : this.leavePickerOutlet(session).then((homeOutletId) => this.prisma.leaveType.findMany({
          where: { companyId: session.companyId, active: true, ...(homeOutletId ? { outletId: homeOutletId } : {}) },
          orderBy: { name: 'asc' },
        }).then((rows) => this.uniqueLeaveTypes(rows.map((row) => ({
          id: row.id, name: row.name, code: row.code, paid: row.paid, entitled: row.daysPerYear, quota: row.daysPerYear, carried: 0, earned: 0, used: 0, left: Math.max(0, row.daysPerYear), limited: row.daysPerYear > 0,
        }))))),
    ]);
    const today = todayInIndia();
    const days = eachDay(start, end).map((day) => this.dayCell(day, today, rules.weekOff, holidayName, punches, leaves, requests));
    return {
      month: cleaned,
      today,
      weekOff: rules.weekOff,
      shiftStart: rules.shiftStart,
      shiftEnd: rules.shiftEnd,
      canEditHolidays: await this.gates.holds(session, 'attendance'),
      leaveTypes: this.uniqueLeaveTypes(
        (types as Array<{ id: string; name: string; entitled: number; left: number; code?: string }>).map((row) => ({
          id: row.id,
          name: row.name,
          entitled: row.entitled,
          left: row.left,
          code: row.code || row.name,
        })),
      ),
      year,
      holidays: yearHolidays.map((row) => ({ id: row.id, day: row.day, name: row.name })),
      days,
      requests: requests.map((row) => this.presentTime(row)),
    };
  }

  async dayTeam(session: SessionUser, day: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(400, 'Choose a date.');
    const span = await this.gates.span(session, 'exceptions');
    if (span === 'none') return { people: [] as Array<{ name: string; code: string; status: string; label: string }> };
    const rules = await this.timeRules(session.companyId);
    const where = span === 'team'
      ? { companyId: session.companyId, status: { in: ['active', 'onboarding'] }, OR: [{ managerId: session.employeeId }, { id: session.employeeId || '' }] }
      : { companyId: session.companyId, status: { in: ['active', 'onboarding'] } };
    const people = await this.prisma.employee.findMany({ where, orderBy: { firstName: 'asc' }, take: 200 });
    const ids = people.map((person) => person.id);
    const range = kolkataDayRange(day);
    const [punches, leaves, requests, holiday] = await Promise.all([
      this.prisma.punch.findMany({ where: { companyId: session.companyId, employeeId: { in: ids }, punchedAt: { gte: range.start, lte: range.end } }, orderBy: { punchedAt: 'asc' } }),
      this.prisma.leaveRequest.findMany({ where: { companyId: session.companyId, employeeId: { in: ids }, status: { in: ['pending', 'approved'] }, startsOn: { lte: day }, endsOn: { gte: day } }, include: { leaveType: true } }),
      this.prisma.attendanceRequest.findMany({
        where: {
          companyId: session.companyId,
          employeeId: { in: ids },
          status: { in: ['pending', 'approved'] },
          OR: [
            { day, endsOn: '' },
            { AND: [{ endsOn: { not: '' } }, { day: { lte: day } }, { endsOn: { gte: day } }] },
          ],
        },
      }),
      this.prisma.holiday.findFirst({ where: { companyId: session.companyId, day } }),
    ]);
    const holidayName = new Map(holiday ? [[day, holiday.name]] : []);
    return {
      people: people.map((person) => {
        const cell = this.dayCell(day, todayInIndia(), rules.weekOff, holidayName, punches.filter((row) => row.employeeId === person.id), leaves.filter((row) => row.employeeId === person.id), requests.filter((row) => row.employeeId === person.id));
        return { name: `${person.firstName} ${person.lastName}`.trim(), code: person.code, status: cell.status, label: cell.label };
      }),
    };
  }

  async requestTime(session: SessionUser, body: unknown) {
    if (!session.employeeId) fail(400, 'Your sign-in is not linked to a person yet.');
    await this.stillWorking(session);
    const input = bag(body);
    const kind = String(input.kind || '');
    if (!['regularization', 'onduty', 'wfh', 'extratime'].includes(kind)) fail(400, 'Choose regularization, on duty, work from home, or extra time.');
    const days = this.daysOf(input);
    const today = todayInIndia();
    const first = days[0];
    const last = days[days.length - 1];
    if (first < shiftDay(today, -60) || last > shiftDay(today, 60)) fail(400, 'Choose dates within 60 days of today.');
    const future = days.filter((day) => day > today);
    if ((kind === 'regularization' || kind === 'extratime') && future.length) {
      fail(400, 'Regularization and extra time are only for days that have already started.');
    }
    if (kind === 'wfh') {
      const rules = await this.timeRules(session.companyId);
      const holidays = await this.holidaySet(session.companyId, first, last);
      const blocked = days.filter((day) => countedDays(day, day, rules.weekOff, holidays) < 1);
      if (blocked.length) fail(400, blocked[0] + ' is a weekly off or a holiday, so it cannot be work from home.');
    }
    const open = await this.prisma.attendanceRequest.findFirst({
      where: { employeeId: session.employeeId, kind, status: 'pending', day: { in: days } },
    });
    if (open) fail(409, 'You already have a pending request starting ' + open.day + '.');
    const needsClock = kind === 'regularization' || kind === 'wfh';
    const inTime = needsClock ? this.clockOf(input.inTime, 'In time') : '';
    const outTime = needsClock ? this.clockOf(input.outTime, 'Out time') : '';
    if (needsClock && outTime <= inTime) fail(400, 'Out time has to be after in time.');
    const hours = kind === 'extratime' ? this.hoursOf(input.hours) : '';
    const reason = text(input.reason, 'Reason', 500);
    const place = kind === 'onduty' ? text(input.place, 'Where you will be', 80) : kind === 'wfh' ? 'Home' : '';
    const flow = await buildFlow(this.prisma, session.companyId, session.employeeId, kind as FlowKind);
    const created = [];
    for (const day of days) {
      created.push(await this.prisma.attendanceRequest.create({
        data: {
          companyId: session.companyId,
          employeeId: session.employeeId,
          kind,
          day,
          endsOn: '',
          hours,
          inTime,
          outTime,
          place,
          reason,
          status: 'pending',
          flowJson: JSON.stringify(flow),
        },
      }));
    }
    if (created.length === 1) return this.presentTime(created[0]);
    return { count: created.length, items: created.map((row) => this.presentTime(row)) };
  }

  async myRequests(session: SessionUser) {
    if (!session.employeeId) return { items: [] as Array<Record<string, unknown>> };
    const [leave, time] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where: { companyId: session.companyId, employeeId: session.employeeId },
        include: { leaveType: true },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
      this.prisma.attendanceRequest.findMany({
        where: { companyId: session.companyId, employeeId: session.employeeId },
        orderBy: { createdAt: 'desc' },
        take: 40,
      }),
    ]);
    const items = [
      ...leave.map((row) => ({ ...this.presentRequest(row), source: 'leave' as const })),
      ...time.map((row) => ({ ...this.presentTime(row), source: 'time' as const })),
    ].sort((a, b) => (a.startsOn < b.startsOn ? 1 : -1));
    return { items };
  }

  async decideTime(session: SessionUser, id: string, body: unknown) {
    const input = bag(body);
    const decision = String(input.decision || '');
    if (!['approved', 'rejected', 'cancelled'].includes(decision)) fail(400, 'Choose approve, reject, or cancel.');
    const row = await this.prisma.attendanceRequest.findFirst({ where: { id, companyId: session.companyId }, include: { employee: true } });
    if (!row) fail(404, 'That request was not found.');
    if (row.status !== 'pending') fail(400, 'This request has already been decided.');
    let override = false;
    if (decision === 'cancelled') {
      if (row.employeeId !== session.employeeId && (await this.gates.span(session, 'people.edit')) !== 'company') fail(403, 'You can cancel only your own request.');
    } else {
      override = await this.mustDecide(session, row);
    }
    const note = optional(input.note, 500);
    const step = advanceFlow(row.flowJson, session, decision as 'approved' | 'rejected' | 'cancelled', note, override);
    if (!step.done && step.next) {
      const moved = await this.prisma.attendanceRequest.update({ where: { id }, data: { flowJson: step.json, reviewNote: note }, include: { employee: true } });
      await this.passOn(moved, `${this.timeKindLabel(row.kind)} · ${row.day}`, session, step.next);
      return this.presentTime(moved);
    }
    if (decision === 'approved' && row.kind === 'regularization') await this.applyRegularization(row);
    const saved = await this.prisma.attendanceRequest.update({
      where: { id },
      data: { status: decision, reviewerId: session.id, reviewNote: note, decidedAt: new Date(), flowJson: step.json },
      include: { employee: true },
    });
    return this.presentTime(saved);
  }

  async timeQueue(session: SessionUser) {
    const span = await this.gates.span(session, 'approvals');
    if (span === 'none') return [];
    const company = span === 'company';
    const rows = await this.prisma.attendanceRequest.findMany({
      where: { companyId: session.companyId, status: 'pending', ...(company ? {} : mayWaitOn(session)) },
      include: { employee: true },
      orderBy: { createdAt: 'asc' },
      take: company ? 50 : 200,
    });
    return rows.filter((row) => company || waitsOn(session, row.flowJson, row.employee.managerId)).slice(0, 50).map((row) => this.presentTime(row));
  }

  /**
   * One Approvals board: every waiting item plus decided history the sign-in may see.
   * Kind filter and Waiting / History tabs live on the client.
   */
  async approvals(session: SessionUser) {
    const span = await this.gates.span(session, 'approvals');
    const canDetails = (await this.gates.holds(session, 'people.edit')) || (await this.gates.holds(session, 'pay'));
    const company = span === 'company';
    const none = span === 'none';
    const pendingWhere = { companyId: session.companyId, status: 'pending' as const, ...(company || none ? {} : mayWaitOn(session)) };
    const teamDecided = company
      ? {}
      : session.employeeId
        ? { OR: [{ reviewerId: session.id }, { employee: { managerId: session.employeeId } }] }
        : { reviewerId: session.id };
    const [leaveWait, timeWait, exitWait, detailWait, leaveDone, timeDone, exitDone, detailDone] = await Promise.all([
      none ? Promise.resolve([]) : this.prisma.leaveRequest.findMany({
        where: pendingWhere,
        include: { leaveType: true, employee: true },
        orderBy: { createdAt: 'asc' },
        take: company ? 80 : 200,
      }),
      none ? Promise.resolve([]) : this.prisma.attendanceRequest.findMany({
        where: pendingWhere,
        include: { employee: true },
        orderBy: { createdAt: 'asc' },
        take: company ? 80 : 200,
      }),
      none ? Promise.resolve([]) : this.prisma.exitRequest.findMany({
        where: {
          companyId: session.companyId,
          status: 'pending',
          ...(session.employeeId ? { employeeId: { not: session.employeeId } } : {}),
          ...(company ? {} : mayWaitOn(session)),
        },
        include: { employee: true },
        orderBy: { createdAt: 'asc' },
        take: 80,
      }),
      canDetails
        ? this.prisma.detailChange.findMany({
            where: { companyId: session.companyId, status: 'pending' },
            include: { employee: true },
            orderBy: { createdAt: 'asc' },
            take: 80,
          })
        : Promise.resolve([]),
      none ? Promise.resolve([]) : this.prisma.leaveRequest.findMany({
        where: { companyId: session.companyId, status: { in: ['approved', 'rejected', 'cancelled'] }, ...teamDecided },
        include: { leaveType: true, employee: true },
        orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }],
        take: 100,
      }),
      none ? Promise.resolve([]) : this.prisma.attendanceRequest.findMany({
        where: { companyId: session.companyId, status: { in: ['approved', 'rejected', 'cancelled'] }, ...teamDecided },
        include: { employee: true },
        orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }],
        take: 100,
      }),
      none ? Promise.resolve([]) : this.prisma.exitRequest.findMany({
        where: {
          companyId: session.companyId,
          status: { in: ['accepted', 'declined', 'cancelled'] },
          ...(company ? {} : session.employeeId ? { employee: { managerId: session.employeeId } } : { id: 'none' }),
        },
        include: { employee: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      canDetails
        ? this.prisma.detailChange.findMany({
            where: {
              companyId: session.companyId,
              status: { in: ['approved', 'rejected', 'cancelled'] },
              ...(company ? {} : { decidedBy: session.id }),
            },
            include: { employee: true },
            orderBy: [{ decidedAt: 'desc' }, { createdAt: 'desc' }],
            take: 100,
          })
        : Promise.resolve([]),
    ]);
    const waitingLeave = leaveWait.filter((row) => company || waitsOn(session, row.flowJson, row.employee.managerId)).slice(0, 50);
    const waitingTime = timeWait.filter((row) => company || waitsOn(session, row.flowJson, row.employee.managerId)).slice(0, 50);
    const waitingExit = exitWait.filter((row) => company || waitsOn(session, row.flowJson, row.employee.managerId)).slice(0, 50);
    const waiting = [
      ...waitingLeave.map((row) => this.approvalLeave(row, true)),
      ...waitingTime.map((row) => this.approvalTime(row, true)),
      ...waitingExit.map((row) => this.approvalExit(row, true)),
      ...detailWait.map((row) => this.approvalDetails(row, session, true)),
    ].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    const history = [
      ...leaveDone.map((row) => this.approvalLeave(row, false)),
      ...timeDone.map((row) => this.approvalTime(row, false)),
      ...exitDone.map((row) => this.approvalExit(row, false)),
      ...detailDone.map((row) => this.approvalDetails(row, session, false)),
    ].sort((a, b) => (b.decidedAt || b.sentAt).localeCompare(a.decidedAt || a.sentAt));
    return {
      waiting,
      history,
      counts: {
        waiting: waiting.length,
        leave: waiting.filter((row) => row.kind === 'leave').length,
        attendance: waiting.filter((row) => row.kind === 'attendance').length,
        resignation: waiting.filter((row) => row.kind === 'resignation').length,
        details: waiting.filter((row) => row.kind === 'details').length,
        history: history.length,
      },
    };
  }

  private approvalLeave(
    row: {
      id: string; startsOn: string; endsOn: string; days: number; portion?: string; reason: string; status: string; reviewNote: string;
      createdAt: Date; decidedAt: Date | null; flowJson?: string;
      leaveType: { name: string; code: string };
      employee: { id: string; firstName: string; lastName: string; code: string; managerId?: string | null };
    },
    canDecide: boolean,
  ) {
    const stage = stageOf(row.flowJson || '', row.status);
    const when = row.startsOn === row.endsOn ? row.startsOn : `${row.startsOn} → ${row.endsOn}`;
    return {
      id: row.id,
      kind: 'leave' as const,
      kindLabel: 'Leave',
      person: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
      personCode: row.employee.code,
      employeeId: row.employee.id,
      title: row.leaveType.name,
      when,
      meta: `${this.charged(row)} day${this.charged(row) === 1 ? '' : 's'}`,
      reason: row.reason || row.reviewNote || '',
      status: row.status,
      statusLabel: this.statusLabel(row.status),
      stageLabel: stage ? (stage.of > 1 ? `Step ${stage.step} of ${stage.of}` : 'Single step') : 'Reporting manager',
      stageSub: stage?.label || '',
      sentAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() || '',
      canDecide,
      fields: [] as Array<{ key: string; label: string; before: string; after: string }>,
      own: false,
    };
  }

  private approvalTime(
    row: {
      id: string; kind: string; day: string; endsOn?: string; hours?: string; inTime: string; outTime: string; place: string; reason: string; status: string;
      reviewNote?: string; createdAt: Date; decidedAt: Date | null; flowJson?: string;
      employee: { id: string; firstName: string; lastName: string; code: string };
    },
    canDecide: boolean,
  ) {
    const stage = stageOf(row.flowJson || '', row.status);
    const span = row.endsOn && row.endsOn !== row.day ? `${row.day} → ${row.endsOn}` : row.day;
    const meta = row.hours ? `${row.hours} h` : row.inTime ? `${row.inTime}–${row.outTime}` : row.place || '';
    return {
      id: row.id,
      kind: 'attendance' as const,
      kindLabel: 'Attendance',
      person: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
      personCode: row.employee.code,
      employeeId: row.employee.id,
      title: this.timeKindLabel(row.kind),
      when: span,
      meta,
      reason: row.reason || row.reviewNote || '',
      status: row.status,
      statusLabel: this.statusLabel(row.status),
      stageLabel: stage ? (stage.of > 1 ? `Step ${stage.step} of ${stage.of}` : 'Single step') : 'Reporting manager',
      stageSub: stage?.label || '',
      sentAt: row.createdAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() || '',
      canDecide,
      fields: [] as Array<{ key: string; label: string; before: string; after: string }>,
      own: false,
    };
  }

  private approvalExit(
    row: {
      id: string; lastDay: string; reason: string; status: string; note: string; createdAt: Date; flowJson: string;
      employee: { id: string; firstName: string; lastName: string; code: string };
    },
    canDecide: boolean,
  ) {
    const stage = stageOf(row.flowJson || '', row.status);
    return {
      id: row.id,
      kind: 'resignation' as const,
      kindLabel: 'Resignation',
      person: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
      personCode: row.employee.code,
      employeeId: row.employee.id,
      title: 'Resignation',
      when: row.lastDay,
      meta: 'Last day',
      reason: row.reason || row.note || '',
      status: row.status,
      statusLabel: this.statusLabel(row.status),
      stageLabel: stage ? (stage.of > 1 ? `Step ${stage.step} of ${stage.of}` : 'Single step') : 'Reporting manager',
      stageSub: stage?.label || '',
      sentAt: row.createdAt.toISOString(),
      decidedAt: '',
      canDecide,
      fields: [] as Array<{ key: string; label: string; before: string; after: string }>,
      own: false,
    };
  }

  private approvalDetails(
    row: {
      id: string; fields: string; payloadEnc: string; status: string; note: string; decidedBy: string; decidedAt: Date | null;
      createdAt: Date; updatedAt: Date; employeeId: string;
      employee: { id: string; firstName: string; lastName: string; code: string };
    },
    session: SessionUser,
    canDecide: boolean,
  ) {
    const labels = row.fields.split(',').map((key) => key.trim()).filter(Boolean);
    const own = row.employeeId === session.employeeId;
    return {
      id: row.id,
      kind: 'details' as const,
      kindLabel: 'Pay details',
      person: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
      personCode: row.employee.code,
      employeeId: row.employee.id,
      title: 'Pay detail change',
      when: labels.length ? labels.join(', ') : 'Details',
      meta: '',
      reason: row.note || '',
      status: row.status,
      statusLabel: this.statusLabel(row.status),
      stageLabel: canDecide && !own ? 'HR / Payroll' : own ? 'Needs another approver' : 'HR / Payroll',
      stageSub: '',
      sentAt: row.updatedAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() || '',
      canDecide: canDecide && !own && row.status === 'pending',
      fields: [] as Array<{ key: string; label: string; before: string; after: string }>,
      own,
    };
  }

  private statusLabel(status: string): string {
    if (status === 'pending') return 'Waiting';
    if (status === 'approved' || status === 'accepted') return 'Approved';
    if (status === 'rejected' || status === 'declined') return 'Rejected';
    if (status === 'cancelled') return 'Cancelled';
    return status;
  }

  timeKindLabel(kind: string): string {
    return kind === 'wfh' ? 'Work from home' : kind === 'onduty' ? 'On duty' : kind === 'extratime' ? 'Extra time' : 'Regularization';
  }

  async leaveTypes(session: SessionUser) {
    if (!(await this.gates.holds(session, 'settings')) && !(await this.gates.holds(session, 'attendance'))) {
      fail(403, 'You do not have access to leave types.');
    }
    const [rows, used, policy] = await Promise.all([
      this.prisma.leaveType.findMany({ where: { companyId: session.companyId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] }),
      this.prisma.leaveRequest.groupBy({ by: ['leaveTypeId'], where: { companyId: session.companyId }, _count: { _all: true } }),
      this.settings.policy(session.companyId),
    ]);
    return {
      policy: { prorateLeave: policy.prorateLeave, compOffFullHours: policy.compOffFullHours, compOffHalfHours: policy.compOffHalfHours },
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        code: row.code,
        paid: row.paid,
        daysPerYear: row.daysPerYear,
        active: row.active,
        carryForwardMax: row.carryForwardMax,
        maxInRow: row.maxInRow,
        noticeDays: row.noticeDays,
        afterProbation: row.afterProbation,
        compOff: row.compOff,
        requests: used.find((item) => item.leaveTypeId === row.id)?._count._all || 0,
      })),
    };
  }

  async saveLeaveType(session: SessionUser, body: unknown) {
    if (!(await this.gates.holds(session, 'settings')) && !(await this.gates.holds(session, 'attendance'))) {
      fail(403, 'You do not have access to leave types.');
    }
    const input = bag(body);
    const id = optional(input.id, 40);
    const whole = (value: unknown, label: string, max: number) => {
      const number = Number(value ?? 0);
      if (!Number.isInteger(number) || number < 0 || number > max) fail(400, `${label} must be a whole number from 0 to ${max}.`);
      return number;
    };
    const code = text(input.code, 'Code', 6).toUpperCase();
    if (!/^[A-Z][A-Z0-9]{0,5}$/.test(code)) fail(400, 'Code is up to 6 letters or digits, starting with a letter, such as CL.');
    const compOff = input.compOff === true;
    const data = {
      name: text(input.name, 'Name', 40),
      code,
      paid: input.paid !== false,
      daysPerYear: compOff ? 0 : whole(input.daysPerYear, 'Days a year', 60),
      active: input.active !== false,
      carryForwardMax: compOff ? 0 : whole(input.carryForwardMax, 'Days carried forward', 60),
      maxInRow: whole(input.maxInRow, 'Days in a row', 60),
      noticeDays: whole(input.noticeDays, 'Days of notice', 90),
      afterProbation: input.afterProbation === true,
      compOff,
    };
    const clash = await this.prisma.leaveType.findFirst({ where: { companyId: session.companyId, code, ...(id ? { id: { not: id } } : {}) } });
    if (clash) fail(409, 'Another leave type already uses that code.');
    if (id) {
      const current = await this.prisma.leaveType.findFirst({ where: { id, companyId: session.companyId } });
      if (!current) fail(404, 'That leave type was not found.');
      await this.prisma.leaveType.update({ where: { id }, data });
    } else {
      await this.prisma.leaveType.create({ data: { ...data, companyId: session.companyId } });
    }
    await this.prisma.auditEvent.create({ data: { companyId: session.companyId, actorId: session.id, action: id ? 'leave-type.update' : 'leave-type.create', entity: 'leave-type', entityId: id || code, detail: data.name } });
    return this.leaveTypes(session);
  }

  async addHoliday(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'attendance', 'You do not have access to add a holiday.');
    const input = bag(body);
    const day = text(input.day, 'Date', 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail(400, 'Choose a real date.');
    const name = text(input.name, 'Holiday name', 80);
    const existing = await this.prisma.holiday.findFirst({ where: { companyId: session.companyId, day } });
    if (existing) fail(409, 'That date is already a holiday.');
    const row = await this.prisma.holiday.create({ data: { companyId: session.companyId, day, name } });
    return { id: row.id, day: row.day, name: row.name };
  }

  async removeHoliday(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'attendance', 'You do not have access to remove a holiday.');
    const id = text(bag(body).id, 'Holiday', 40);
    const row = await this.prisma.holiday.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) fail(404, 'That holiday was not found.');
    await this.prisma.holiday.delete({ where: { id: row.id } });
    return { ok: true };
  }

  private dayCell(
    day: string,
    today: string,
    weekOff: number[],
    holidayName: Map<string, string>,
    punches: Array<{ kind: string; note: string; punchedAt: Date }>,
    leaves: Array<{ startsOn: string; endsOn: string; status: string; portion?: string; leaveType: { name: string } }>,
    requests: Array<{ id: string; kind: string; status: string; day: string; endsOn?: string; hours?: string; inTime: string; outTime: string; place: string; reason: string }>,
  ) {
    const mine = punches.filter((row) => this.kolkataDay(row.punchedAt) === day);
    const leave = leaves.find((row) => row.startsOn <= day && row.endsOn >= day) || null;
    const request = requests.find((row) => row.day <= day && (row.endsOn || row.day) >= day) || null;
    const holiday = holidayName.get(day) || '';
    const off = !!holiday || weekOff.includes(weekdayOf(day));
    const hasIn = mine.some((row) => row.kind === 'in');
    const hasOut = mine.some((row) => row.kind === 'out');
    let status = 'future';
    let label = '';
    const half = leave?.portion === 'half' ? ' · half' : '';
    if (leave?.status === 'approved' && !off) {
      status = 'leave';
      label = leave.leaveType.name + half;
    } else if (request?.kind === 'onduty' && request.status === 'approved') {
      status = 'onduty';
      label = 'On duty';
    } else if (hasIn && hasOut) {
      status = 'present';
      label = 'Present';
    } else if (hasIn) {
      status = day < today ? 'missed' : 'present';
      label = day < today ? 'Missed check-out' : 'In';
    } else if (request?.kind === 'wfh' && request.status === 'approved') {
      status = 'onduty';
      label = 'Work from home';
    } else if (request?.status === 'pending' && request.kind !== 'extratime') {
      status = 'pending';
      label = request.kind === 'onduty' ? 'On duty pending' : request.kind === 'wfh' ? 'Work from home pending' : 'Regularization pending';
    } else if (leave?.status === 'pending' && !off) {
      status = 'pending';
      label = leave.leaveType.name + half + ' pending';
    } else if (holiday) {
      status = 'holiday';
      label = holiday;
    } else if (weekOff.includes(weekdayOf(day))) {
      status = 'weekoff';
      label = 'Weekly off';
    } else if (day < today) {
      status = 'absent';
      label = 'Absent';
    } else if (day === today) {
      status = 'today';
      label = 'Not checked in';
    }
    return {
      day,
      status,
      label,
      punches: mine.map((row) => ({
        kind: row.kind,
        note: row.note,
        at: new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(row.punchedAt),
      })),
      request: request ? { id: request.id, kind: request.kind, status: request.status, inTime: request.inTime, outTime: request.outTime, hours: request.hours || '', place: request.place, reason: request.reason } : null,
    };
  }

  private kolkataDay(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
  }

  private async applyRegularization(row: { companyId: string; employeeId: string; day: string; inTime: string; outTime: string }): Promise<void> {
    const range = kolkataDayRange(row.day);
    const punches = await this.prisma.punch.findMany({
      where: { companyId: row.companyId, employeeId: row.employeeId, punchedAt: { gte: range.start, lte: range.end } },
    });
    const missing: Array<{ kind: string; punchedAt: Date }> = [];
    if (!punches.some((item) => item.kind === 'in')) missing.push({ kind: 'in', punchedAt: new Date(`${row.day}T${row.inTime}:00+05:30`) });
    if (!punches.some((item) => item.kind === 'out')) missing.push({ kind: 'out', punchedAt: new Date(`${row.day}T${row.outTime}:00+05:30`) });
    if (!missing.length) return;
    await this.prisma.punch.createMany({
      data: missing.map((item) => ({
        companyId: row.companyId,
        employeeId: row.employeeId,
        kind: item.kind,
        note: 'Regularized',
        source: 'regularization',
        punchedAt: item.punchedAt,
      })),
    });
  }

  async exceptions(session: SessionUser, dayInput?: string) {
    const span = await this.gates.span(session, 'exceptions');
    if (span === 'none') fail(403, 'You do not have access to attendance exceptions.');
    const day = dayInput && /^\d{4}-\d{2}-\d{2}$/.test(dayInput) ? dayInput : todayInIndia();
    const rules = await this.timeRules(session.companyId);
    const holiday = await this.prisma.holiday.findFirst({ where: { companyId: session.companyId, day } });
    if (holiday || rules.weekOff.includes(weekdayOf(day))) {
      return {
        day,
        shiftStart: rules.shiftStart,
        shiftEnd: rules.shiftEnd,
        graceMinutes: rules.graceMinutes,
        closed: holiday ? holiday.name : 'Weekly off',
        counts: { late: 0, absent: 0, waiting: 0, early: 0, open: 0 },
        rows: [],
      };
    }
    const people = await this.prisma.employee.findMany({
      where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } },
      include: { department: true },
      orderBy: { firstName: 'asc' },
    });
    const mine = span === 'company' ? null : this.descendantIds(people, session.employeeId || '');
    const scope = mine ? people.filter((person) => mine.has(person.id)) : people;
    const range = kolkataDayRange(day);
    const [punches, leave, duty] = await Promise.all([
      this.prisma.punch.findMany({ where: { companyId: session.companyId, punchedAt: { gte: range.start, lte: range.end } }, orderBy: { punchedAt: 'asc' } }),
      this.prisma.leaveRequest.findMany({ where: { companyId: session.companyId, status: 'approved', startsOn: { lte: day }, endsOn: { gte: day } }, select: { employeeId: true } }),
      this.prisma.attendanceRequest.findMany({ where: { companyId: session.companyId, status: 'approved', day, kind: { in: ['onduty', 'wfh'] } }, select: { employeeId: true } }),
    ]);
    const away = new Set([...leave.map((row) => row.employeeId), ...duty.map((row) => row.employeeId)]);
    const byPerson = new Map<string, typeof punches>();
    for (const punch of punches) {
      const list = byPerson.get(punch.employeeId) || [];
      list.push(punch);
      byPerson.set(punch.employeeId, list);
    }
    const start = this.clockMinutes(rules.shiftStart);
    const end = this.clockMinutes(rules.shiftEnd);
    const today = day === todayInIndia();
    const now = this.minutesInIndia(new Date());
    const rows = scope.flatMap((person) => {
      if (away.has(person.id)) return [];
      const list = byPerson.get(person.id) || [];
      const arrived = list.find((punch) => punch.kind === 'in');
      const left = [...list].reverse().find((punch) => punch.kind === 'out');
      const flags: string[] = [];
      const bits: string[] = [];
      if (!arrived) {
        if (!today || now > start + rules.graceMinutes) {
          flags.push(today ? 'waiting' : 'absent');
          bits.push(today ? 'Not in yet' : 'No punch');
        }
      } else {
        const at = this.minutesInIndia(arrived.punchedAt);
        if (at > start + rules.graceMinutes) {
          flags.push('late');
          bits.push(`In at ${this.hhmm(at)} · ${at - start} min after the shift`);
        }
        if (left) {
          const outAt = this.minutesInIndia(left.punchedAt);
          if (outAt < end) {
            flags.push('early');
            bits.push(`Out at ${this.hhmm(outAt)}`);
          }
        } else if (!today || now > end) {
          flags.push('open');
          bits.push('No punch out');
        }
      }
      if (!flags.length) return [];
      return [{
        id: person.id,
        name: `${person.firstName} ${person.lastName}`.trim(),
        code: person.code,
        department: person.department?.name || '',
        flags,
        detail: bits.join(' · '),
      }];
    });
    const count = (flag: string) => rows.filter((row) => row.flags.includes(flag)).length;
    return {
      day,
      shiftStart: rules.shiftStart,
      shiftEnd: rules.shiftEnd,
      graceMinutes: rules.graceMinutes,
      closed: '',
      counts: { late: count('late'), absent: count('absent'), waiting: count('waiting'), early: count('early'), open: count('open') },
      rows,
    };
  }

  private descendantIds(people: Array<{ id: string; managerId: string | null }>, root: string): Set<string> {
    const children = new Map<string, string[]>();
    for (const person of people) {
      if (!person.managerId) continue;
      const list = children.get(person.managerId) || [];
      list.push(person.id);
      children.set(person.managerId, list);
    }
    const mine = new Set<string>();
    const walk = (id: string) => {
      for (const child of children.get(id) || []) {
        if (mine.has(child)) continue;
        mine.add(child);
        walk(child);
      }
    };
    walk(root);
    return mine;
  }

  private clockMinutes(value: string): number {
    const [hour, minute] = value.split(':').map(Number);
    return hour * 60 + minute;
  }

  private minutesInIndia(date: Date): number {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
    return hour * 60 + minute;
  }

  private hhmm(minutes: number): string {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }

  private async timeRules(companyId: string): Promise<{ weekOff: number[]; shiftStart: string; shiftEnd: string; graceMinutes: number }> {
    const fallback = { weekOff: [0], shiftStart: '09:30', shiftEnd: '18:30', graceMinutes: 10 };
    const rows = await this.prisma.$queryRaw<Array<{ settingsJson: string }>>`
      SELECT "settingsJson" FROM "Company" WHERE "id" = ${companyId}
    `;
    try {
      const parsed = JSON.parse(rows[0]?.settingsJson || '{}') as { attendance?: { weekOff?: unknown; shiftStart?: unknown; shiftEnd?: unknown; graceMinutes?: unknown } };
      const attendance = parsed.attendance || {};
      const weekOff = Array.isArray(attendance.weekOff)
        ? attendance.weekOff.map((day) => Number(day)).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        : fallback.weekOff;
      const grace = Number(attendance.graceMinutes);
      return {
        weekOff: weekOff.length ? weekOff : fallback.weekOff,
        shiftStart: typeof attendance.shiftStart === 'string' && attendance.shiftStart ? attendance.shiftStart : fallback.shiftStart,
        shiftEnd: typeof attendance.shiftEnd === 'string' && attendance.shiftEnd ? attendance.shiftEnd : fallback.shiftEnd,
        graceMinutes: Number.isInteger(grace) && grace >= 0 && grace <= 180 ? grace : fallback.graceMinutes,
      };
    } catch {
      return fallback;
    }
  }

  private async holidaySet(companyId: string, start: string, end: string): Promise<Set<string>> {
    const rows = await this.prisma.holiday.findMany({ where: { companyId, day: { gte: start, lte: end } }, select: { day: true } });
    return new Set(rows.map((row) => row.day));
  }

  private daysOf(input: Record<string, unknown>): string[] {
    const raw = Array.isArray(input.days) && input.days.length ? input.days : [input.day];
    const days = [...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))].sort();
    if (!days.length) fail(400, 'Choose a date.');
    if (days.length > 31) fail(400, 'Choose up to 31 days at a time.');
    if (days.some((day) => !/^\d{4}-\d{2}-\d{2}$/.test(day))) fail(400, 'Choose a real date.');
    return days;
  }

  private hoursOf(value: unknown): string {
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours < 0.5 || hours > 12 || Math.round(hours * 2) !== hours * 2) {
      fail(400, 'Extra time is between half an hour and 12 hours, in half-hour steps.');
    }
    return String(hours);
  }

  private charged(row: { days: number; portion?: string }): number {
    return row.portion === 'half' ? 0.5 : row.days;
  }

  private clockOf(value: unknown, label: string): string {
    const cleaned = text(value, label, 8).slice(0, 5);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cleaned)) fail(400, `${label} needs a time like 09:30.`);
    return cleaned;
  }

  private presentTime(row: {
    id: string; kind: string; day: string; endsOn?: string; hours?: string; inTime: string; outTime: string; place: string; reason: string; status: string;
    flowJson?: string;
    employee?: { firstName: string; lastName: string; code: string };
  }) {
    const labels: Record<string, string> = { regularization: 'Regularization', onduty: 'On duty', wfh: 'Work from home', extratime: 'Extra time' };
    return {
      id: row.id,
      kind: row.kind,
      type: labels[row.kind] || row.kind,
      day: row.day,
      startsOn: row.day,
      endsOn: row.endsOn || row.day,
      hours: row.hours || '',
      inTime: row.inTime,
      outTime: row.outTime,
      place: row.place,
      reason: row.reason,
      status: row.status,
      days: 1,
      person: row.employee ? `${row.employee.firstName} ${row.employee.lastName}`.trim() : '',
      personCode: row.employee?.code || '',
      stage: stageOf(row.flowJson || '', row.status),
    };
  }

  private presentRequest(row: {
    id: string;
    startsOn: string;
    endsOn: string;
    days: number;
    portion?: string;
    reason: string;
    status: string;
    reviewNote: string;
    createdAt: Date;
    flowJson?: string;
    leaveType: { name: string; code: string };
    employee?: { firstName: string; lastName: string; code: string };
  }) {
    return {
      id: row.id,
      type: row.leaveType.name,
      code: row.leaveType.code,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      days: this.charged(row),
      portion: row.portion || 'full',
      reason: row.reason,
      status: row.status,
      reviewNote: row.reviewNote,
      createdAt: row.createdAt.toISOString(),
      person: row.employee ? `${row.employee.firstName} ${row.employee.lastName}`.trim() : '',
      personCode: row.employee?.code || '',
      stage: stageOf(row.flowJson || '', row.status),
    };
  }
}

export interface BoardRow {
  id: string;
  name: string;
  code: string;
  state: string;
  at: string;
  where: string;
}
