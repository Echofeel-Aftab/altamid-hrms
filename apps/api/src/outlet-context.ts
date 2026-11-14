import { AsyncLocalStorage } from 'async_hooks';

export interface OutletScope {
  companyId: string;
  /** The outlet being worked in, or null when a master views every outlet. */
  current: string | null;
  visible: string[];
  /** The signed-in person's own employee record, whose rows stay visible from any outlet. */
  self?: string | null;
}

interface OutletStore {
  scope: OutletScope | null;
}

export const outletStore = new AsyncLocalStorage<OutletStore>();

/** Rows in these tables keep a real outlet. The rest may be empty, meaning every outlet sees them. */
export const OUTLET_MODELS = new Set([
  'Department', 'Team', 'Location', 'Employee', 'Asset', 'AssetEvent', 'OnboardingTask', 'DetailChange', 'ExitRequest',
  'Announcement', 'LeaveType', 'LeaveRequest', 'Punch', 'AttendanceDevice', 'JobForm', 'Opening', 'JobApplication',
  'ApplicationEvent', 'Holiday', 'AttendanceRequest', 'LibraryDoc', 'PayStructure', 'PaySlip', 'PayMonth', 'TaxForm',
  'Recognition', 'AuditEvent', 'TaxDeclaration', 'TaxProof', 'ReviewCycle', 'Goal', 'PerformanceReview', 'Survey',
  'FlexChoice', 'SuccessionPlan',
]);
export const SHARED_MODELS = new Set(['Announcement', 'LibraryDoc', 'AuditEvent', 'ReviewCycle', 'Survey', 'SuccessionPlan']);

/** Tables whose rows belong to one person, by this field. */
export const OWNED_BY: Record<string, string> = {
  Employee: 'id', Asset: 'employeeId', OnboardingTask: 'employeeId', DetailChange: 'employeeId', ExitRequest: 'employeeId',
  LeaveRequest: 'employeeId', Punch: 'employeeId', AttendanceRequest: 'employeeId', LibraryDoc: 'employeeId',
  PayStructure: 'employeeId', PaySlip: 'employeeId', TaxForm: 'employeeId', TaxDeclaration: 'employeeId', TaxProof: 'employeeId',
  Goal: 'employeeId', PerformanceReview: 'employeeId', FlexChoice: 'employeeId',
};

/** A new row takes the outlet of the row it hangs off, in this order. */
export const PARENTS: Array<[field: string, model: string]> = [
  ['employeeId', 'employee'],
  ['applicationId', 'jobApplication'],
  ['openingId', 'opening'],
  ['formId', 'jobForm'],
  ['assetId', 'asset'],
  ['departmentId', 'department'],
  ['locationId', 'location'],
];

export function currentScope(): OutletScope | null {
  return outletStore.getStore()?.scope || null;
}

export function setScope(scope: OutletScope): void {
  const store = outletStore.getStore();
  if (store) store.scope = scope;
}

/** Runs without the outlet filter, for company-wide counts such as licence seats and employee codes. */
export function unscoped<T>(work: () => Promise<T>): Promise<T> {
  return outletStore.run({ scope: null }, work);
}

/** Runs as if working inside one outlet, for jobs that start outside a request. */
export function inOutlet<T>(companyId: string, outletId: string, work: () => Promise<T>): Promise<T> {
  return outletStore.run({ scope: { companyId, current: outletId, visible: [outletId] } }, work);
}
