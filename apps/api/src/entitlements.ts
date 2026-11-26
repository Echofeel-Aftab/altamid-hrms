/**
 * Canonical HRMS entitlement keys from Altamid Control leases.
 * Keep in sync with altamid-control/apps/api/src/hrms-entitlements.ts
 */

export type HrmsEntitlement = {
  key: string;
  label: string;
  group: string;
  description: string;
};

export const HRMS_ENTITLEMENTS: HrmsEntitlement[] = [
  { key: 'people', label: 'Directory', group: 'People', description: 'People list and organisation chart' },
  { key: 'people.edit', label: 'Edit people', group: 'People', description: 'Employment, role, and sign-in changes' },
  { key: 'assets', label: 'Assets desk', group: 'People', description: 'Issue and recover company assets' },
  { key: 'exits', label: 'Exits desk', group: 'People', description: 'Resignations, F&F, exit letters' },
  { key: 'performance', label: 'Performance', group: 'People', description: 'Review cycles and ratings (also Growth desk)' },
  { key: 'succession', label: 'Succession', group: 'People', description: 'Key roles and successors' },
  { key: 'approvals', label: 'Approvals', group: 'Time', description: 'Leave and attendance decisions' },
  { key: 'attendance', label: 'Holidays & leave types', group: 'Time', description: 'Company holidays and leave type admin' },
  { key: 'attendance.devices', label: 'Punch readers', group: 'Time', description: 'Connect biometric readers' },
  { key: 'attendance.live', label: 'Live punches', group: 'Time', description: 'Company live punch feed' },
  { key: 'exceptions', label: 'Exceptions', group: 'Time', description: 'Late, absent, missed punches' },
  { key: 'news', label: 'Announcements', group: 'Company', description: 'Post company news' },
  { key: 'library', label: 'Library', group: 'Company', description: 'Handbooks and letters' },
  { key: 'surveys', label: 'Surveys', group: 'Company', description: 'Create surveys and read results' },
  { key: 'pay', label: 'Payroll desk', group: 'Pay', description: 'Open payroll month runs' },
  { key: 'pay.structure', label: 'CTC', group: 'Pay', description: 'Enter CTC by hand' },
  { key: 'pay.slip', label: 'Salary slip', group: 'Pay', description: 'Build and publish slips' },
  { key: 'pay.form', label: 'Form 16', group: 'Pay', description: 'Upload Form 16 PDFs' },
  { key: 'pay.tax', label: 'Tax declarations', group: 'Pay', description: 'Declaration window and proofs' },
  { key: 'pay.flex', label: 'Choice pay', group: 'Pay', description: 'Flexible pay options' },
  { key: 'pay.rewards', label: 'Total rewards', group: 'Pay', description: 'Total rewards statements' },
  { key: 'hiring', label: 'Hiring desk', group: 'Hiring', description: 'Openings and applications' },
  { key: 'hiring.forms', label: 'Job forms', group: 'Hiring', description: 'Public application forms' },
  { key: 'reports', label: 'Reports', group: 'Company', description: 'Run and export reports' },
  { key: 'settings', label: 'Settings', group: 'Setup', description: 'Company, email, licence' },
  { key: 'settings.brand', label: 'Brand', group: 'Setup', description: 'Colours, logo, icon' },
  { key: 'access', label: 'Access', group: 'Setup', description: 'Who may manage each area' },
  { key: 'ai', label: 'AI assistant', group: 'Setup', description: 'Staff AI chat and provider setup' },
  { key: 'api', label: 'Company API', group: 'Setup', description: 'External REST API and key' },
];

export const ALL_ENTITLEMENT_KEYS = HRMS_ENTITLEMENTS.map((item) => item.key);

/** People plan / default when no list lease — keep in sync with Control HRMS_CORE_FEATURES. */
export const HRMS_CORE_FEATURES: string[] = [
  'people',
  'people.edit',
  'approvals',
  'attendance',
  'exceptions',
  'news',
  'library',
  'exits',
  'reports',
  'settings',
  'settings.brand',
  'access',
];

/** Map Access FEATURES / desk keys that are not commercial packs to nearest entitlement. */
export function entitlementForAccess(feature: string): string {
  if (feature === 'growth') return 'performance';
  if (feature === 'jobs') return 'hiring';
  return feature;
}

export function entitlementLabel(key: string): string {
  return HRMS_ENTITLEMENTS.find((item) => item.key === key)?.label || key;
}
