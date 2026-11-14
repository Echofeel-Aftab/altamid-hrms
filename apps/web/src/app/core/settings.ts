export interface SalaryAccountView {
  id: string;
  label: string;
  name: string;
  accountName: string;
  ifsc: string;
  accountMask: string;
  isDefault: boolean;
  active: boolean;
  locationIds: string[];
}

export interface SmtpAccountView {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  encryption: 'tls' | 'ssl';
  fromName: string;
  fromEmail: string;
  active: boolean;
  isDefault: boolean;
  hasPassword: boolean;
  lastTest: TestNote | null;
}

export interface NumberingRow {
  type: string;
  label: string;
  prefix: string;
  padding: number;
  includeYear: boolean;
  resetYearly: boolean;
  lastNumber: number;
  preview: string;
}

export interface StatutorySettings {
  pfEnabled: boolean;
  pfNumber: string;
  pfEmployeeRate: string;
  pfEmployerRate: string;
  pfWageCeiling: string;
  esiEnabled: boolean;
  esiNumber: string;
  esiEmployeeRate: string;
  esiEmployerRate: string;
  esiWageCeiling: string;
  ptEnabled: boolean;
  lwfEnabled: boolean;
  tdsEnabled: boolean;
  gratuityEnabled: boolean;
  payCycle: string;
  payDay: number;
}

export interface AttendanceSettings {
  web: boolean;
  geo: boolean;
  selfie: boolean;
  biometric: boolean;
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  weekOff: number[];
  otAfterMinutes: number;
  scope: 'anywhere' | 'country' | 'offices';
  country: string;
  ownOffice: boolean;
  anywhere: string[];
}

export interface OfficePoint {
  id: string;
  name: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  radius: number;
  people: number;
}

export interface IntegrationAccountView {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  enabled: boolean;
  isDefault: boolean;
  purpose: string;
  configs: Record<string, { fields: Record<string, string>; secrets: Record<string, string> }>;
  hasSecret: boolean;
  secretMask: string;
  missing: string[];
  status: string;
  statusLabel: string;
  lastTest: TestNote | null;
}

export interface IntegrationView {
  key: string;
  title: string;
  blurb: string;
  summary: string;
  enabled: boolean;
  provider: string;
  providerLabel: string;
  configs: Record<string, { fields: Record<string, string>; secrets: Record<string, string> }>;
  hasSecret: boolean;
  secretMask: string;
  missing: string[];
  status: string;
  statusLabel: string;
  lastTest: TestNote | null;
  accounts?: IntegrationAccountView[];
  accountCount?: number;
}

export interface IntegrationField {
  key: string;
  label: string;
  kind: 'text' | 'secret' | 'url' | 'select';
  required?: boolean;
  placeholder?: string;
  hint?: string;
  pattern?: string;
  patternMessage?: string;
  options?: Array<{ value: string; label: string }>;
  value?: string;
  max?: number;
  upper?: boolean;
  showIf?: { field: string; equals: string[] };
}

export interface IntegrationProvider {
  id: string;
  label: string;
  region: string;
  check: 'live' | 'format';
  checkNote: string;
  setup: string[];
  fields: IntegrationField[];
}

export type MailKey =
  | 'payslip' | 'leave' | 'announcement' | 'birthday' | 'anniversary' | 'welcome' | 'cooling'
  | 'exit' | 'onboarding' | 'attendance' | 'password' | 'interview'
  | 'reimbursement' | 'recognition' | 'document' | 'offer' | 'rejection' | 'probation' | 'overtime' | 'tax' | 'reminder' | 'asset';
export type MailLayout = 'banner' | 'card' | 'minimal';
export type MailGroup = 'pay' | 'time' | 'people' | 'hiring' | 'system';

export interface MailDesign {
  layout: MailLayout;
  accent: string;
  secondary: string;
  tinted: boolean;
  rounded: boolean;
  showLogo: boolean;
  headerTitle: string;
  headerTagline: string;
  showHeaderText: boolean;
  signoff: string;
  footer: string;
  footerNote: string;
  showWebsite: boolean;
}

export interface MailTemplate {
  subject: string;
  preheader: string;
  heading: string;
  body: string;
  button: string;
  auto: boolean;
}

export interface MailCatalogItem {
  key: MailKey;
  label: string;
  hint: string;
  group?: MailGroup;
  tokens: string[];
  automatic: boolean;
}

export interface TemplateSettings {
  design: MailDesign;
  items: Record<MailKey, MailTemplate>;
  catalog: MailCatalogItem[];
}

export interface MailPreview {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

export interface TestNote {
  ok: boolean;
  message: string;
  at: string;
}

export interface AiAccountView {
  id: string;
  label: string;
  provider: string;
  providerLabel: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
  default: boolean;
  configured: boolean;
  keyMask: string;
  hasKey: boolean;
}

export interface AiSettingsView {
  enabled: boolean;
  defaultAccountId: string;
  fallbackOrder: string[];
  catalog: Record<string, string>;
  accounts: AiAccountView[];
  ready: boolean;
  lastTest?: TestNote | null;
}

export interface SettingsView {
  company: {
    name: string;
    legalName: string;
    state: string;
    city: string;
    pan: string;
    address: string;
    zip: string;
    country: string;
    phone: string;
    email: string;
    website: string;
    gstin: string;
    tan: string;
  };
  bank: { name: string; accountName: string; ifsc: string; accountMask: string; hasAccount: boolean };
  bankAccounts: SalaryAccountView[];
  smtp: SmtpAccountView[];
  purposes: {
    payslip: string;
    leave: string;
    announcement: string;
    onboarding: string;
    hiring: string;
    celebrations: string;
    system: string;
  };
  numbering: NumberingRow[];
  statutory: StatutorySettings;
  attendance: AttendanceSettings;
  integrations: IntegrationView[];
  integrationCatalog: Record<string, IntegrationProvider[]>;
  templates: TemplateSettings;
  offices: OfficePoint[];
  issuedKey: string;
  ai?: AiSettingsView;
}

export type SmtpPurposeKey = keyof SettingsView['purposes'];

export const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
];

export const PURPOSE_LABELS: Array<{ key: SmtpPurposeKey; label: string; hint: string }> = [
  { key: 'payslip', label: 'Payslips & pay', hint: 'Payslips, reimbursements and tax declaration reminders' },
  { key: 'leave', label: 'Leave & attendance', hint: 'Leave decisions, punch fixes and overtime' },
  { key: 'announcement', label: 'Announcements', hint: 'Company announcements and action reminders' },
  { key: 'onboarding', label: 'People lifecycle', hint: 'Welcome, onboarding, exit, documents, probation and assets' },
  { key: 'hiring', label: 'Hiring', hint: 'Interview invites, offers, cooling replies and application updates' },
  { key: 'celebrations', label: 'Celebrations', hint: 'Birthday, work anniversary and recognition' },
  { key: 'system', label: 'System mail', hint: 'Password reset links' },
];
