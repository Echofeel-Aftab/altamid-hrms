import { unscoped } from './outlet-context';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

export const FLOW_KINDS = ['leave', 'regularization', 'wfh', 'onduty', 'extratime', 'resignation'] as const;
export type FlowKind = (typeof FLOW_KINDS)[number];
export const STEP_KINDS = ['manager', 'skip', 'hr', 'payroll', 'person'] as const;
export type StepKind = (typeof STEP_KINDS)[number];

export const FLOW_LABELS: Record<FlowKind, string> = {
  leave: 'Leave',
  regularization: 'Regularization',
  wfh: 'Work from home',
  onduty: 'On duty',
  extratime: 'Extra time',
  resignation: 'Resignation',
};

export const STEP_LABELS: Record<StepKind, string> = {
  manager: 'Reporting manager',
  skip: 'Manager’s manager',
  hr: 'HR',
  payroll: 'Payroll',
  person: 'A named person',
};

export interface FlowStepConfig { kind: StepKind; personId?: string }
export type FlowConfig = Record<FlowKind, FlowStepConfig[]>;

export interface Approver { employeeId: string; userId: string; name: string }
export interface FlowStep { kind: StepKind; label: string; approvers: Approver[] }
export interface FlowEvent { step: number; decision: 'approved' | 'rejected' | 'cancelled'; by: string; byUserId: string; byEmployeeId: string; at: string; note: string; override?: boolean }
export interface Flow { steps: FlowStep[]; at: number; history: FlowEvent[] }

export const FLOW_DEFAULT: FlowConfig = {
  leave: [{ kind: 'manager' }],
  regularization: [{ kind: 'manager' }],
  wfh: [{ kind: 'manager' }],
  onduty: [{ kind: 'manager' }],
  extratime: [{ kind: 'manager' }],
  resignation: [{ kind: 'manager' }, { kind: 'hr' }],
};

const CONFIG_KEY = 'approval.flows';

export async function readFlows(prisma: PrismaService, companyId: string): Promise<FlowConfig> {
  const row = await prisma.moduleConfig.findUnique({ where: { companyId_key: { companyId, key: CONFIG_KEY } } });
  let saved: Partial<FlowConfig> = {};
  try {
    saved = row ? JSON.parse(row.json) as Partial<FlowConfig> : {};
  } catch {
    saved = {};
  }
  const out = { ...FLOW_DEFAULT };
  for (const kind of FLOW_KINDS) {
    const steps = Array.isArray(saved[kind]) ? saved[kind]!.filter((step) => STEP_KINDS.includes(step.kind)).slice(0, 3) : [];
    if (steps.length) out[kind] = steps;
  }
  return out;
}

export async function writeFlows(prisma: PrismaService, companyId: string, value: FlowConfig): Promise<void> {
  const json = JSON.stringify(value);
  await prisma.moduleConfig.upsert({ where: { companyId_key: { companyId, key: CONFIG_KEY } }, create: { companyId, key: CONFIG_KEY, json }, update: { json } });
}

function name(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`.trim();
}

/**
 * People who hold one of these roles in the given outlet: masters, people based there, and people linked to it.
 * A role set on the outlet link wins over the sign-in's own role, the same way sign-in works.
 */
export async function holdersIn(prisma: PrismaService, companyId: string, outletId: string | null, roles: string[]): Promise<Approver[]> {
  const users = await prisma.user.findMany({ where: { companyId, active: true }, include: { employee: true }, orderBy: { name: 'asc' } });
  const links = outletId ? await prisma.userOutlet.findMany({ where: { companyId, outletId } }) : [];
  const picked = users.filter((user) => {
    if (user.master) return roles.includes(user.role);
    if (!outletId) return roles.includes(user.role);
    const link = links.find((row) => row.userId === user.id);
    if (link) return roles.includes(link.role || user.role);
    return user.employee?.outletId === outletId && roles.includes(user.role);
  });
  return picked.slice(0, 6).map((user) => ({ employeeId: user.employeeId || '', userId: user.id, name: user.employee ? name(user.employee) : user.name }));
}

async function asApprover(prisma: PrismaService, companyId: string, employeeId: string | null | undefined): Promise<Approver | null> {
  if (!employeeId) return null;
  const person = await prisma.employee.findFirst({ where: { id: employeeId, companyId, status: { in: ['active', 'onboarding'] } }, include: { user: true } });
  if (!person) return null;
  return { employeeId: person.id, userId: person.user?.active ? person.user.id : '', name: name(person) };
}

/** Works out who approves each step for this person, now, so the request always shows who it waits for. */
export function buildFlow(prisma: PrismaService, companyId: string, employeeId: string, kind: FlowKind): Promise<Flow> {
  return unscoped(() => resolveFlow(prisma, companyId, employeeId, kind));
}

async function resolveFlow(prisma: PrismaService, companyId: string, employeeId: string, kind: FlowKind): Promise<Flow> {
  const config = await readFlows(prisma, companyId);
  const person = await prisma.employee.findFirst({ where: { id: employeeId, companyId }, include: { manager: true } });
  const outletId = person?.outletId || null;
  const byRole = (roles: string[]) => holdersIn(prisma, companyId, outletId, roles);
  const steps: FlowStep[] = [];
  for (const step of config[kind]) {
    let approvers: Approver[] = [];
    let label = STEP_LABELS[step.kind];
    if (step.kind === 'manager') {
      const manager = await asApprover(prisma, companyId, person?.managerId);
      if (manager) approvers = [manager];
      else { approvers = await byRole(['hr', 'owner']); label = 'HR (no reporting manager set)'; }
    } else if (step.kind === 'skip') {
      const above = await asApprover(prisma, companyId, person?.manager?.managerId);
      if (above) approvers = [above];
    } else if (step.kind === 'hr') {
      approvers = await byRole(['hr']);
      if (!approvers.length) approvers = await byRole(['owner']);
    } else if (step.kind === 'payroll') {
      approvers = await byRole(['payroll']);
      if (!approvers.length) approvers = await byRole(['hr', 'owner']);
    } else if (step.kind === 'person') {
      const named = await asApprover(prisma, companyId, step.personId);
      if (named) { approvers = [named]; label = named.name; }
    }
    approvers = approvers.filter((item) => item.employeeId !== employeeId);
    if (!approvers.length) continue;
    const previous = steps[steps.length - 1];
    const same = previous && previous.approvers.length === 1 && approvers.length === 1 && previous.approvers[0].employeeId === approvers[0].employeeId && previous.approvers[0].userId === approvers[0].userId;
    if (!same) steps.push({ kind: step.kind, label, approvers });
  }
  if (!steps.length) {
    const fallback = (await byRole(['hr', 'owner'])).filter((item) => item.employeeId !== employeeId);
    steps.push({ kind: 'hr', label: 'HR', approvers: fallback });
  }
  return { steps, at: 0, history: [] };
}

export function parseFlow(json: string | null | undefined): Flow | null {
  if (!json) return null;
  try {
    const flow = JSON.parse(json) as Flow;
    return Array.isArray(flow.steps) && flow.steps.length ? { steps: flow.steps, at: Number(flow.at) || 0, history: Array.isArray(flow.history) ? flow.history : [] } : null;
  } catch {
    return null;
  }
}

/** True when this sign-in is an approver on the step the request is waiting at. Older requests without a flow wait on the reporting manager. */
export function waitsOn(session: SessionUser, flowJson: string, managerId: string | null | undefined): boolean {
  const flow = parseFlow(flowJson);
  if (!flow) return !!session.employeeId && managerId === session.employeeId;
  const step = flow.steps[flow.at];
  return !!step && step.approvers.some((item) => (item.userId && item.userId === session.id) || (!!session.employeeId && item.employeeId === session.employeeId));
}

/** A where clause that finds pending rows that might wait on this sign-in, to be narrowed with waitsOn. */
export function mayWaitOn(session: SessionUser) {
  const ors: Array<Record<string, unknown>> = [{ flowJson: { contains: `"userId":"${session.id}"` } }];
  if (session.employeeId) {
    ors.push({ flowJson: '', employee: { managerId: session.employeeId } });
    ors.push({ flowJson: { contains: `"employeeId":"${session.employeeId}"` } });
  }
  return { OR: ors };
}

export interface FlowStage { step: number; of: number; label: string; pendingWith: string }

export function stageOf(flowJson: string, status: string): FlowStage | null {
  const flow = parseFlow(flowJson);
  if (!flow) return null;
  const step = flow.steps[flow.at];
  return {
    step: Math.min(flow.at + 1, flow.steps.length),
    of: flow.steps.length,
    label: step?.label || '',
    pendingWith: status === 'pending' && step ? step.approvers.map((item) => item.name).join(', ') : '',
  };
}

/**
 * Records a decision on the current step. An approval moves to the next step until the last one; a rejection or
 * cancel ends the flow. Returns the new flow and whether the request is now decided.
 */
export function advanceFlow(flowJson: string, session: SessionUser, decision: 'approved' | 'rejected' | 'cancelled', note: string, override: boolean): { json: string; done: boolean; next: FlowStep | null } {
  const flow = parseFlow(flowJson);
  if (!flow) return { json: flowJson, done: true, next: null };
  flow.history.push({
    step: flow.at,
    decision,
    by: session.name,
    byUserId: session.id,
    byEmployeeId: session.employeeId || '',
    at: new Date().toISOString(),
    note,
    ...(override ? { override: true } : {}),
  });
  if (decision !== 'approved' || flow.at >= flow.steps.length - 1) return { json: JSON.stringify(flow), done: true, next: null };
  flow.at += 1;
  return { json: JSON.stringify(flow), done: false, next: flow.steps[flow.at] };
}
