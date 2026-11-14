export const ROLES = ['owner', 'hr', 'payroll', 'accountant', 'manager', 'employee'] as const;
export type Role = (typeof ROLES)[number];

export const WORKER_TYPES = ['employee', 'contractor', 'intern'] as const;
export const EMPLOYEE_STATUSES = ['onboarding', 'active', 'exited'] as const;

export function isHr(role: string): boolean {
  return role === 'owner' || role === 'hr';
}

export function canSeePay(role: string): boolean {
  return role === 'owner' || role === 'hr' || role === 'payroll';
}

export function canApprove(role: string): boolean {
  return role === 'owner' || role === 'hr' || role === 'manager';
}

export function isStaff(role: string): boolean {
  return role === 'owner' || role === 'hr' || role === 'payroll' || role === 'accountant';
}
