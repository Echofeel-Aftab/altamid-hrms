import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { Flow, FLOW_DEFAULT, FLOW_KINDS, FLOW_LABELS, FlowConfig, FlowStepConfig, holdersIn, parseFlow, readFlows, STEP_KINDS, STEP_LABELS, StepKind, writeFlows } from './approval-flow';
import { unscoped } from './outlet-context';
import { REVIEW_FIELDS } from './details';
import { bag, fail } from './http';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

export type TxStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';
export type TxCategory = 'leave' | 'attendance' | 'dossier' | 'separation' | 'pay';

export interface ChainPerson { employeeId: string; name: string; designation: string; email: string; phone: string }
export interface ChainStep {
  label: string;
  state: 'approved' | 'rejected' | 'cancelled' | 'pending' | 'upcoming' | 'skipped';
  people: ChainPerson[];
  by: string;
  at: string;
  note: string;
  override: boolean;
}
export interface Transaction {
  id: string;
  source: 'leave' | 'time' | 'detail' | 'exit' | 'tax' | 'flex';
  category: TxCategory;
  type: string;
  appliedOn: string;
  summary: string;
  status: TxStatus;
  statusLabel: string;
  pendingWith: string;
  cancel: { url: string; body: Record<string, string> } | null;
  facts: Array<{ label: string; value: string }>;
  reason: string;
  chain: ChainStep[];
}

const CATEGORY_LABELS: Record<TxCategory, string> = {
  leave: 'Leave',
  attendance: 'Time and attendance',
  dossier: 'Employee dossier',
  separation: 'Separation',
  pay: 'Pay and tax',
};

const TIME_LABELS: Record<string, string> = { regularization: 'Regularization', onduty: 'On duty', wfh: 'Work from home', extratime: 'Extra time' };

interface Lookup {
  people: Map<string, ChainPerson>;
  users: Map<string, { name: string; employeeId: string; email: string }>;
}

/** Everything a person has asked for, in one list, with who it waits on and who decided each step. */
@Injectable()
export class TransactionsService {
  constructor(private readonly prisma: PrismaService, private readonly gates: AccessService) {}

  async flows(session: SessionUser) {
    const canEdit = await this.gates.holds(session, 'settings');
    if (!canEdit && (await this.gates.span(session, 'approvals')) !== 'company') fail(403, 'You do not have access to approval flows.');
    const [config, people] = await Promise.all([
      readFlows(this.prisma, session.companyId),
      this.prisma.employee.findMany({ where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] } }, include: { designation: true }, orderBy: { firstName: 'asc' }, take: 500 }),
    ]);
    return {
      canEdit,
      kinds: FLOW_KINDS.map((key) => ({ key, label: FLOW_LABELS[key] })),
      steps: STEP_KINDS.map((key) => ({ key, label: STEP_LABELS[key] })),
      flows: config,
      people: people.map((row) => ({ id: row.id, name: `${row.firstName} ${row.lastName}`.trim(), code: row.code, designation: row.designation?.name || '' })),
    };
  }

  async saveFlows(session: SessionUser, body: unknown) {
    await this.gates.gate(session, 'settings', 'You do not have access to approval flows.');
    const raw = bag(body).flows;
    if (!raw || typeof raw !== 'object') fail(400, 'Send the approval flows.');
    const input = raw as Record<string, unknown>;
    const out = { ...FLOW_DEFAULT } as FlowConfig;
    const ids = new Set((await this.prisma.employee.findMany({ where: { companyId: session.companyId }, select: { id: true } })).map((row) => row.id));
    for (const kind of FLOW_KINDS) {
      const list = Array.isArray(input[kind]) ? (input[kind] as unknown[]) : [];
      const steps: FlowStepConfig[] = [];
      for (const item of list.slice(0, 3)) {
        const step = bag(item);
        const stepKind = String(step.kind || '') as StepKind;
        if (!STEP_KINDS.includes(stepKind)) fail(400, `${FLOW_LABELS[kind]}: choose who approves each step.`);
        if (stepKind === 'person') {
          const personId = String(step.personId || '');
          if (!ids.has(personId)) fail(400, `${FLOW_LABELS[kind]}: choose the person for the named step.`);
          steps.push({ kind: stepKind, personId });
        } else {
          steps.push({ kind: stepKind });
        }
      }
      if (!steps.length) fail(400, `${FLOW_LABELS[kind]} needs at least one approval step.`);
      out[kind] = steps;
    }
    await writeFlows(this.prisma, session.companyId, out);
    return this.flows(session);
  }

  async mine(session: SessionUser, query: { from?: string; to?: string }) {
    if (!session.employeeId) return { items: [] as Transaction[], categories: this.categories([]), from: '', to: '' };
    const day = (value: string | undefined, fallback: string) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback);
    const year = new Date().getFullYear();
    const from = day(query.from, `${year}-01-01`);
    const to = day(query.to, `${year}-12-31`);
    if (to < from) fail(400, 'The end date has to be after the start date.');
    const range = { gte: new Date(from + 'T00:00:00+05:30'), lte: new Date(to + 'T23:59:59+05:30') };
    const where = { companyId: session.companyId, employeeId: session.employeeId, createdAt: range };
    const [me, leave, time, details, exits, tax, flex] = await Promise.all([
      unscoped(() => this.prisma.employee.findFirst({ where: { id: session.employeeId!, companyId: session.companyId }, include: { manager: { include: { designation: true } } } })),
      this.prisma.leaveRequest.findMany({ where, include: { leaveType: true }, orderBy: { createdAt: 'desc' }, take: 300 }),
      this.prisma.attendanceRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 300 }),
      this.prisma.detailChange.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.exitRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.taxDeclaration.findMany({ where: { companyId: session.companyId, employeeId: session.employeeId, updatedAt: range }, orderBy: { updatedAt: 'desc' }, take: 10 }),
      this.prisma.flexChoice.findMany({ where: { companyId: session.companyId, employeeId: session.employeeId, updatedAt: range }, orderBy: { updatedAt: 'desc' }, take: 10 }),
    ]);
    const lookup = await this.lookup(session.companyId, [
      ...leave.map((row) => row.flowJson),
      ...time.map((row) => row.flowJson),
      ...exits.map((row) => row.flowJson),
    ], [...leave.map((row) => row.reviewerId), ...time.map((row) => row.reviewerId), ...details.map((row) => row.decidedBy)].filter(Boolean));
    const manager: ChainPerson | null = me?.manager
      ? { employeeId: me.manager.id, name: `${me.manager.firstName} ${me.manager.lastName}`.trim(), designation: me.manager.designation?.name || '', email: me.manager.email, phone: me.manager.phone }
      : null;
    const hr = await this.roleDesk(session.companyId, me?.outletId || null, ['hr'], ['owner']);
    const payroll = await this.roleDesk(session.companyId, me?.outletId || null, ['payroll'], ['hr', 'owner']);
    const items: Transaction[] = [];

    for (const row of leave) {
      const span = row.startsOn === row.endsOn ? this.dayLabel(row.startsOn) : `${this.dayLabel(row.startsOn)} to ${this.dayLabel(row.endsOn)}`;
      const days = row.portion === 'half' ? 0.5 : row.days;
      const status = this.norm(row.status);
      const chain = this.chainOf(row.flowJson, status, row.reviewerId, row.decidedAt, row.reviewNote, manager, lookup);
      items.push({
        id: row.id,
        source: 'leave',
        category: 'leave',
        type: row.leaveType.name,
        appliedOn: row.createdAt.toISOString(),
        summary: this.sentence(`${row.leaveType.name} for ${span}`, status, chain),
        status,
        statusLabel: this.statusLabel(status),
        pendingWith: this.pendingWith(chain),
        cancel: status === 'pending' ? { url: `/v1/leave/${row.id}/decide`, body: { decision: 'cancelled' } } : null,
        facts: [
          { label: 'Leave type', value: row.leaveType.name },
          { label: 'From', value: this.dayLabel(row.startsOn) },
          { label: 'To', value: this.dayLabel(row.endsOn) },
          { label: 'Days', value: `${days} ${days === 1 ? 'day' : 'days'}${row.portion === 'half' ? ' (half day)' : ''}` },
        ],
        reason: row.reason,
        chain,
      });
    }

    for (const row of time) {
      const label = TIME_LABELS[row.kind] || 'Attendance request';
      const status = this.norm(row.status);
      const chain = this.chainOf(row.flowJson, status, row.reviewerId, row.decidedAt, row.reviewNote, manager, lookup);
      const facts = [
        { label: 'Type', value: label },
        { label: 'Day', value: this.dayLabel(row.day) },
      ];
      if (row.inTime) facts.push({ label: 'In time', value: row.inTime });
      if (row.outTime) facts.push({ label: 'Out time', value: row.outTime });
      if (row.inTime && row.outTime) facts.push({ label: 'Hours', value: this.hours(row.inTime, row.outTime) });
      if (row.hours) facts.push({ label: 'Extra hours', value: row.hours });
      if (row.place) facts.push({ label: 'Where', value: row.place });
      items.push({
        id: row.id,
        source: 'time',
        category: 'attendance',
        type: label,
        appliedOn: row.createdAt.toISOString(),
        summary: this.sentence(`${label} for ${this.dayLabel(row.day)}`, status, chain),
        status,
        statusLabel: this.statusLabel(status),
        pendingWith: this.pendingWith(chain),
        cancel: status === 'pending' ? { url: `/v1/attendance/requests/${row.id}/decide`, body: { decision: 'cancelled' } } : null,
        facts,
        reason: row.reason,
        chain,
      });
    }

    for (const row of details) {
      const status = this.norm(row.status);
      const fields = row.fields.split(',').map((key) => REVIEW_FIELDS[key.trim()]?.label || key.trim()).filter(Boolean);
      const by = row.decidedBy ? lookup.users.get(row.decidedBy) : undefined;
      const chain: ChainStep[] = [{
        label: 'HR or payroll',
        state: this.stepState(status),
        people: hr.concat(payroll.filter((person) => !hr.some((item) => item.employeeId === person.employeeId && item.name === person.name))).slice(0, 4),
        by: status === 'cancelled' ? '' : by?.name || '',
        at: row.decidedAt?.toISOString() || '',
        note: row.note,
        override: false,
      }];
      items.push({
        id: row.id,
        source: 'detail',
        category: 'dossier',
        type: 'Pay details change',
        appliedOn: row.createdAt.toISOString(),
        summary: this.sentence(`Change to ${fields.join(', ') || 'your pay details'}`, status, chain),
        status,
        statusLabel: this.statusLabel(status),
        pendingWith: this.pendingWith(chain),
        cancel: status === 'pending' ? { url: `/v1/profile/change/${row.id}/cancel`, body: {} } : null,
        facts: [{ label: 'Fields', value: fields.join(', ') || '—' }],
        reason: '',
        chain,
      });
    }

    for (const row of exits) {
      const status = this.norm(row.status);
      const flow = parseFlow(row.flowJson);
      let chain: ChainStep[];
      if (flow) chain = this.flowChain(flow, status, lookup);
      else chain = [{ label: 'Reporting manager', state: this.stepState(status), people: manager ? [manager] : hr, by: row.decidedBy, at: '', note: row.note, override: false }];
      if (row.initiatedBy === 'hr') chain = [{ label: 'Started by HR', state: 'approved', people: hr, by: row.decidedBy, at: row.createdAt.toISOString(), note: row.overrideNote, override: false }];
      items.push({
        id: row.id,
        source: 'exit',
        category: 'separation',
        type: row.initiatedBy === 'hr' ? 'Separation' : 'Resignation',
        appliedOn: row.createdAt.toISOString(),
        summary: this.sentence(`${row.initiatedBy === 'hr' ? 'Separation' : 'Resignation'} with last day ${this.dayLabel(row.lastDay)}`, status, chain),
        status,
        statusLabel: row.closedAt ? 'Closed' : this.statusLabel(status),
        pendingWith: this.pendingWith(chain),
        cancel: status === 'pending' && row.initiatedBy !== 'hr' ? { url: `/v1/exits/${row.id}/cancel`, body: {} } : null,
        facts: [
          { label: 'Last working day', value: this.dayLabel(row.lastDay) },
          ...(row.originalLastDay && row.originalLastDay !== row.lastDay ? [{ label: 'Asked for', value: this.dayLabel(row.originalLastDay) }] : []),
          ...(row.noticeWaived ? [{ label: 'Notice', value: 'Waived' }] : []),
        ],
        reason: row.reason,
        chain,
      });
    }

    for (const row of tax) {
      const status: TxStatus = row.status === 'verified' ? 'approved' : row.status === 'returned' ? 'rejected' : row.status === 'submitted' ? 'pending' : 'draft';
      const chain: ChainStep[] = [{ label: 'Payroll', state: status === 'draft' ? 'upcoming' : this.stepState(status), people: payroll, by: row.verifiedBy, at: row.verifiedAt?.toISOString() || '', note: row.note, override: false }];
      items.push({
        id: row.id,
        source: 'tax',
        category: 'pay',
        type: 'Tax declaration',
        appliedOn: (row.submittedAt || row.createdAt).toISOString(),
        summary: status === 'draft' ? `Tax declaration for ${row.year} is saved as a draft. Send it when you are ready.` : this.sentence(`Tax declaration for ${row.year} (${row.regime} regime)`, status, chain),
        status,
        statusLabel: this.statusLabel(status),
        pendingWith: this.pendingWith(chain),
        cancel: null,
        facts: [{ label: 'Year', value: row.year }, { label: 'Regime', value: row.regime === 'old' ? 'Old regime' : 'New regime' }],
        reason: '',
        chain,
      });
    }

    for (const row of flex) {
      const status: TxStatus = row.status === 'approved' ? 'approved' : row.status === 'returned' ? 'rejected' : row.status === 'submitted' ? 'pending' : 'draft';
      const chain: ChainStep[] = [{ label: 'Payroll', state: status === 'draft' ? 'upcoming' : this.stepState(status), people: payroll, by: row.decidedBy, at: status === 'approved' || status === 'rejected' ? row.updatedAt.toISOString() : '', note: row.note, override: false }];
      items.push({
        id: row.id,
        source: 'flex',
        category: 'pay',
        type: 'Choice pay',
        appliedOn: row.createdAt.toISOString(),
        summary: status === 'draft' ? `Choice pay split for ${row.year} is saved as a draft.` : this.sentence(`Choice pay split for ${row.year}`, status, chain),
        status,
        statusLabel: this.statusLabel(status),
        pendingWith: this.pendingWith(chain),
        cancel: null,
        facts: [{ label: 'Year', value: row.year }],
        reason: '',
        chain,
      });
    }

    items.sort((a, b) => (a.appliedOn < b.appliedOn ? 1 : -1));
    return { items, categories: this.categories(items), from, to };
  }

  private categories(items: Transaction[]) {
    return (Object.keys(CATEGORY_LABELS) as TxCategory[]).map((key) => ({
      key,
      label: CATEGORY_LABELS[key],
      count: items.filter((item) => item.category === key).length,
      pending: items.filter((item) => item.category === key && item.status === 'pending').length,
    }));
  }

  /** Loads everyone named in the flows and decisions once, with the contact details shown on hover. */
  private lookup(companyId: string, flows: string[], userIds: string[]): Promise<Lookup> {
    return unscoped(() => this.lookupAll(companyId, flows, userIds));
  }

  private async lookupAll(companyId: string, flows: string[], userIds: string[]): Promise<Lookup> {
    const employeeIds = new Set<string>();
    const users = new Set(userIds);
    for (const json of flows) {
      const flow = parseFlow(json);
      if (!flow) continue;
      for (const step of flow.steps) for (const person of step.approvers) {
        if (person.employeeId) employeeIds.add(person.employeeId);
        if (person.userId) users.add(person.userId);
      }
      for (const event of flow.history) if (event.byUserId) users.add(event.byUserId);
    }
    const userRows = users.size
      ? await this.prisma.user.findMany({ where: { companyId, id: { in: [...users] } }, select: { id: true, name: true, email: true, employeeId: true } })
      : [];
    for (const row of userRows) if (row.employeeId) employeeIds.add(row.employeeId);
    const people = employeeIds.size
      ? await this.prisma.employee.findMany({ where: { companyId, id: { in: [...employeeIds] } }, include: { designation: true } })
      : [];
    return {
      people: new Map(people.map((row) => [row.id, { employeeId: row.id, name: `${row.firstName} ${row.lastName}`.trim(), designation: row.designation?.name || '', email: row.email, phone: row.phone }])),
      users: new Map(userRows.map((row) => [row.id, { name: row.name, employeeId: row.employeeId || '', email: row.email }])),
    };
  }

  private roleDesk(companyId: string, outletId: string | null, roles: string[], fallback: string[]): Promise<ChainPerson[]> {
    return unscoped(async () => {
      let found = await holdersIn(this.prisma, companyId, outletId, roles);
      if (!found.length) found = await holdersIn(this.prisma, companyId, outletId, fallback);
      const rows = await this.prisma.user.findMany({
        where: { companyId, id: { in: found.slice(0, 4).map((item) => item.userId) } },
        include: { employee: { include: { designation: true } } },
        orderBy: { name: 'asc' },
      });
      return rows.map((row) => ({
        employeeId: row.employeeId || '',
        name: row.employee ? `${row.employee.firstName} ${row.employee.lastName}`.trim() : row.name,
        designation: row.employee?.designation?.name || (row.role === 'hr' ? 'Human Resources' : row.role === 'payroll' ? 'Payroll' : 'Owner'),
        email: row.employee?.email || row.email,
        phone: row.employee?.phone || '',
      }));
    });
  }

  private chainOf(flowJson: string, status: TxStatus, reviewerId: string, decidedAt: Date | null, note: string, manager: ChainPerson | null, lookup: Lookup): ChainStep[] {
    const flow = parseFlow(flowJson);
    if (flow) return this.flowChain(flow, status, lookup);
    const reviewer = reviewerId ? lookup.users.get(reviewerId) : undefined;
    return [{
      label: 'Reporting manager',
      state: this.stepState(status),
      people: manager ? [manager] : [],
      by: status === 'cancelled' ? '' : reviewer?.name || '',
      at: decidedAt?.toISOString() || '',
      note,
      override: !!reviewer && !!manager && reviewer.employeeId !== manager.employeeId,
    }];
  }

  private flowChain(flow: Flow, status: TxStatus, lookup: Lookup): ChainStep[] {
    return flow.steps.map((step, index) => {
      const event = [...flow.history].reverse().find((item) => item.step === index);
      const people = step.approvers.map((person) => lookup.people.get(person.employeeId) || { employeeId: person.employeeId, name: person.name, designation: '', email: lookup.users.get(person.userId)?.email || '', phone: '' });
      let state: ChainStep['state'];
      if (event) state = event.decision;
      else if (status === 'pending') state = index === flow.at ? 'pending' : 'upcoming';
      else state = 'skipped';
      return {
        label: step.label,
        state,
        people,
        by: event && event.decision !== 'cancelled' ? event.by : '',
        at: event?.at || '',
        note: event?.note || '',
        override: !!event?.override,
      };
    });
  }

  private stepState(status: TxStatus): ChainStep['state'] {
    return status === 'draft' ? 'upcoming' : status;
  }

  private pendingWith(chain: ChainStep[]): string {
    const step = chain.find((item) => item.state === 'pending');
    if (!step) return '';
    return step.people.map((person) => person.name).join(', ') || step.label;
  }

  private sentence(what: string, status: TxStatus, chain: ChainStep[]): string {
    if (status === 'pending') {
      const at = chain.findIndex((item) => item.state === 'pending');
      const done = chain.filter((item) => item.state === 'approved' && item.by).map((item) => item.by);
      const waits = at >= 0 ? (chain[at].people.map((person) => person.name).join(', ') || chain[at].label) : 'an approver';
      return `${what} is waiting for ${waits}${chain.length > 1 && at >= 0 ? ` (step ${at + 1} of ${chain.length})` : ''}${done.length ? `, after approval by ${done.join(', ')}` : ''}.`;
    }
    if (status === 'cancelled') return `${what} was cancelled.`;
    const last = [...chain].reverse().find((item) => item.by);
    const when = last?.at ? ` on ${this.stamp(last.at)}` : '';
    if (status === 'approved') return `${what} is approved${last?.by ? ` by ${last.by}` : ''}${when}.`;
    if (status === 'rejected') return `${what} was declined${last?.by ? ` by ${last.by}` : ''}${when}.`;
    return `${what}.`;
  }

  private norm(status: string): TxStatus {
    if (status === 'accepted') return 'approved';
    if (status === 'declined') return 'rejected';
    if (['pending', 'approved', 'rejected', 'cancelled', 'draft'].includes(status)) return status as TxStatus;
    return 'pending';
  }

  private statusLabel(status: TxStatus): string {
    return { draft: 'Draft', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' }[status];
  }

  private hours(from: string, to: string): string {
    const [ah, am] = from.split(':').map(Number);
    const [bh, bm] = to.split(':').map(Number);
    const minutes = bh * 60 + bm - (ah * 60 + am);
    if (!Number.isFinite(minutes) || minutes <= 0) return '—';
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  }

  private dayLabel(day: string): string {
    const date = new Date(day + 'T00:00:00Z');
    if (!Number.isFinite(date.getTime())) return day;
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  private stamp(iso: string): string {
    const date = new Date(iso);
    return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });
  }
}
