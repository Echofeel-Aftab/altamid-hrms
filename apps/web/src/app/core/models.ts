export interface BrandView {
  preset: string;
  name: string;
  tagline: string;
  title: string;
  website: string;
  colors: Record<string, string>;
  hasIcon: boolean;
  hasLogo: boolean;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
  employeeId: string | null;
  workplace: { department: string; location: string; designation: string; phone: string } | null;
  company: {
    id: string;
    name: string;
    legalName: string;
    state: string;
    city: string;
    planCode: string;
    pan: string;
    brand?: BrandView;
  };
  licence: { mode: string; message: string; reason: string };
  access: string[];
  outlets?: OutletContext;
}

export interface OutletChoice {
  id: string;
  name: string;
  code: string;
  country: string;
  city: string;
  payroll: boolean;
  termEndsAt: string;
  usable: boolean;
}

/** Where this sign-in is working: one outlet, or every outlet (current null) for a master. */
export interface OutletContext {
  current: string | null;
  master: boolean;
  payroll: boolean;
  list: OutletChoice[];
}

export interface OrgName {
  id: string;
  name: string;
}

export interface LocationRow extends OrgName {
  state: string;
  city: string;
}

export interface ChartPerson {
  id: string;
  name: string;
  code: string;
  designation: string;
  department: string;
  location: string;
  status: string;
  workerType: string;
  managerId: string | null;
}

export interface Org {
  departments: OrgName[];
  designations: OrgName[];
  locations: LocationRow[];
  chart: ChartPerson[];
  chartLimited?: boolean;
  roles?: Array<{ id: string; name: string; rank: number; scope: string }>;
  levels?: Array<{ id: string; name: string; rank: number }>;
  teams?: Array<{ id: string; name: string; departmentId: string; leadId?: string; members?: number }>;
  counts: {
    active: number;
    onboarding: number;
    exited: number;
    departments: Array<{ name: string; count: number }>;
    locations: Array<{ name: string; count: number }>;
  };
}

export interface Person {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  workerType: string;
  status: string;
  department: OrgName | null;
  designation: OrgName | null;
  location: LocationRow | null;
  manager: { id: string; name: string } | null;
  level?: { id: string; name: string } | null;
  team?: { id: string; name: string } | null;
  agency?: { id: string; name: string } | null;
  client?: { id: string; name: string } | null;
  costCentre: string;
  dateOfJoining: string;
  dateOfExit: string;
  service: string;
  confirmedOn: string;
  probationEndsOn?: string;
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
  photo?: string;
  personalEmail?: string;
  fatherName?: string;
  spouseName?: string;
  emergencyRelation?: string;
  city?: string;
  state?: string;
  pincode?: string;
  permanentAddress?: string;
  nomineeName?: string;
  nomineeRelation?: string;
  uan?: string;
  esicNo?: string;
  aadhaar?: string;
  taxRegime?: string;
  signIn: { role: string; active: boolean } | null;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  audience: string;
  authorName: string;
  expiresOn: string;
  createdAt: string;
}

export interface LeaveBalance {
  id: string;
  name: string;
  code: string;
  paid: boolean;
  entitled: number;
  used: number;
  left: number;
  quota?: number;
  carried?: number;
  earned?: number;
  limited?: boolean;
}

export interface LeaveType {
  id: string;
  name: string;
  code: string;
  paid: boolean;
  daysPerYear: number;
}

export interface LeaveRequest {
  id: string;
  type: string;
  code: string;
  startsOn: string;
  endsOn: string;
  days: number;
  reason: string;
  status: string;
  reviewNote: string;
  createdAt: string;
  person: string;
  personCode: string;
  stage?: FlowStage | null;
}

/** Where a request is in its approval flow. Missing on requests sent before flows existed. */
export interface FlowStage {
  step: number;
  of: number;
  label: string;
  pendingWith: string;
}

export interface PunchState {
  state: 'in' | 'out';
  next: 'in' | 'out';
  missedOut: boolean;
  today: string;
  workedSeconds: number;
  sessionStart: string;
  firstIn: string;
  lastOut: string;
  shiftStart: string;
  shiftEnd: string;
  graceMinutes: number;
  rule: { scope: 'anywhere' | 'country' | 'offices'; label: string; needsLocation: boolean; record: boolean };
  punches: Array<{ id: string; kind: string; note: string; punchedAt: string; place: string; zone: string }>;
}

export interface BoardRow {
  id: string;
  name: string;
  code: string;
  state: string;
  at: string;
  where: string;
}

export const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

export function allows(role: string, roles?: string[]): boolean {
  return !roles || roles.includes(role);
}

export function clock(iso: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function when(iso: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(iso));
}
