export const ROLES = ['owner', 'hr', 'payroll', 'accountant', 'manager', 'employee'] as const;
export type Role = (typeof ROLES)[number];

export const WORKER_TYPES = ['employee', 'contractor', 'intern'] as const;
export const EMPLOYEE_STATUSES = ['onboarding', 'active', 'exited'] as const;

/** @deprecated Prefer AccessService.holds — role helpers bypass feature grants. */
export function isHr(role: string): boolean {
  return role === 'owner' || role === 'hr';
}

/** @deprecated Prefer AccessService.holds('pay'). */
export function canSeePay(role: string): boolean {
  return role === 'owner' || role === 'hr' || role === 'payroll';
}

/** @deprecated Prefer AccessService.holds('approvals'). */
export function canApprove(role: string): boolean {
  return role === 'owner' || role === 'hr' || role === 'manager';
}

/** @deprecated Prefer AccessService.holds('people'|'people.edit'|'pay'). */
export function isStaff(role: string): boolean {
  return role === 'owner' || role === 'hr' || role === 'payroll' || role === 'accountant';
}
