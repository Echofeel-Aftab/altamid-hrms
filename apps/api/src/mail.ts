import { plainOf, sanitizeRich } from './rich';

export const MAIL_KEYS = [
  'payslip', 'leave', 'announcement', 'birthday', 'anniversary', 'welcome', 'cooling',
  'exit', 'onboarding', 'attendance', 'password', 'interview',
  'reimbursement', 'recognition', 'document', 'offer', 'rejection', 'probation', 'overtime', 'tax', 'reminder', 'asset',
] as const;
export type MailKey = (typeof MAIL_KEYS)[number];

/** SMTP purpose buckets — each can use a different mailbox in Settings → Email. */
export const SMTP_PURPOSES = ['payslip', 'leave', 'announcement', 'onboarding', 'hiring', 'celebrations', 'system'] as const;
export type SmtpPurpose = (typeof SMTP_PURPOSES)[number];

/** Which mailbox purpose sends a given template. */
export function smtpPurposeOf(key: MailKey): SmtpPurpose {
  if (key === 'payslip' || key === 'reimbursement' || key === 'tax') return 'payslip';
  if (key === 'leave' || key === 'attendance' || key === 'overtime') return 'leave';
  if (key === 'announcement' || key === 'reminder') return 'announcement';
  if (key === 'cooling' || key === 'interview' || key === 'offer' || key === 'rejection') return 'hiring';
  if (key === 'birthday' || key === 'anniversary' || key === 'recognition') return 'celebrations';
  if (key === 'password') return 'system';
  return 'onboarding';
}
export const MAIL_LAYOUTS = ['banner', 'card', 'minimal'] as const;
export type MailLayout = (typeof MAIL_LAYOUTS)[number];
export const MAIL_GROUPS = ['pay', 'time', 'people', 'hiring', 'system'] as const;
export type MailGroup = (typeof MAIL_GROUPS)[number];

/** Shared tokens available in header, footer, and sign-off. */
export const MAIL_BRAND_TOKENS = ['company', 'year', 'website', 'phone', 'email', 'city', 'address'] as const;

export interface MailDesign {
  layout: MailLayout;
  accent: string;
  /** Optional second colour for the header accent line / trim. */
  secondary: string;
  tinted: boolean;
  rounded: boolean;
  showLogo: boolean;
  /** Custom header title; supports {{company}}, {{year}}, etc. */
  headerTitle: string;
  /** Smaller line under the header title. */
  headerTagline: string;
  showHeaderText: boolean;
  signoff: string;
  footer: string;
  /** Second footer line (address, legal, etc.). */
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
  group: MailGroup;
  tokens: string[];
  path: string;
  automatic: boolean;
  sample: Record<string, string>;
  footer?: string;
}

export const MAIL_CATALOG: MailCatalogItem[] = [
  {
    key: 'payslip', label: 'Payslip', hint: 'When payroll publishes a month', group: 'pay', path: '/pay', automatic: true,
    tokens: ['name', 'month', 'net', 'code', 'department', 'company'],
    sample: { month: 'October 2026', net: '₹59,000.00', code: 'E-1042', department: 'Sales' },
  },
  {
    key: 'leave', label: 'Leave decision', hint: 'When a manager or HR decides leave', group: 'time', path: '/leave', automatic: true,
    tokens: ['name', 'type', 'from', 'to', 'days', 'status', 'approver', 'company'],
    sample: { type: 'Casual leave', from: '18 Nov 2026', to: '19 Nov 2026', days: '2', status: 'approved', approver: 'Meera Iyer' },
  },
  {
    key: 'announcement', label: 'Announcement', hint: 'When an announcement is posted', group: 'people', path: '/news', automatic: true,
    tokens: ['name', 'title', 'body', 'company'],
    sample: { name: 'everyone', title: 'Office closed on Foundation day', body: '<p>The office is closed on <strong>18 November</strong>.</p><ul><li>Punch in as usual on the 19th</li><li>Leave requests stay open</li></ul>' },
  },
  {
    key: 'birthday', label: 'Birthday wish', hint: 'Sent from Home with one click', group: 'people', path: '/', automatic: false,
    tokens: ['name', 'sender', 'department', 'company'],
    sample: { sender: 'Meera Iyer', department: 'Sales' },
  },
  {
    key: 'anniversary', label: 'Work anniversary', hint: 'Sent from Home with one click', group: 'people', path: '/', automatic: false,
    tokens: ['name', 'years', 'sender', 'department', 'company'],
    sample: { years: '3', sender: 'Meera Iyer', department: 'Sales' },
  },
  {
    key: 'welcome', label: 'Welcome', hint: 'Sent to a new joiner from Home', group: 'people', path: '/', automatic: false,
    tokens: ['name', 'sender', 'department', 'designation', 'company'],
    sample: { sender: 'Meera Iyer', department: 'Sales', designation: 'Executive' },
  },
  {
    key: 'cooling', label: 'Cooling period reply', hint: 'When someone applies again before the hiring rule allows it', group: 'hiring', path: '/', automatic: true,
    tokens: ['name', 'job', 'date', 'company'],
    sample: { name: 'Tara', job: 'Sales executive', date: '12 Feb 2027' },
    footer: 'You are receiving this because you applied for a job at {{company}}.',
  },
  {
    key: 'exit', label: 'Exit / relieving', hint: 'When HR confirms last working day or sends relieving notice', group: 'people', path: '/separation', automatic: false,
    tokens: ['name', 'lastDay', 'code', 'department', 'company'],
    sample: { lastDay: '30 Nov 2026', code: 'E-1042', department: 'Sales' },
  },
  {
    key: 'onboarding', label: 'Onboarding checklist', hint: 'Welcome pack with first-day steps for a new joiner', group: 'people', path: '/directory', automatic: false,
    tokens: ['name', 'startDate', 'manager', 'department', 'designation', 'outlet', 'company'],
    sample: { startDate: '1 Dec 2026', manager: 'Meera Iyer', department: 'Sales', designation: 'Executive', outlet: 'Head office' },
  },
  {
    key: 'attendance', label: 'Attendance exception', hint: 'When a punch fix or WFH request is decided', group: 'time', path: '/attendance', automatic: true,
    tokens: ['name', 'type', 'day', 'status', 'approver', 'company'],
    sample: { type: 'Missed punch', day: '14 Nov 2026', status: 'approved', approver: 'Meera Iyer' },
  },
  {
    key: 'password', label: 'Password reset', hint: 'One-time link after a password reset request', group: 'system', path: '/login', automatic: true,
    tokens: ['name', 'link', 'company'],
    sample: { link: 'https://hrms.example.com/reset' },
  },
  {
    key: 'interview', label: 'Interview invite', hint: 'When hiring schedules a candidate interview', group: 'hiring', path: '/jobs', automatic: false,
    tokens: ['name', 'job', 'when', 'where', 'interviewer', 'company'],
    sample: { job: 'Sales executive', when: '20 Nov 2026 11:00', where: 'Head office / Meet link', interviewer: 'Meera Iyer' },
  },
  {
    key: 'reimbursement', label: 'Reimbursement', hint: 'When a claim is approved, paid, or returned', group: 'pay', path: '/pay', automatic: true,
    tokens: ['name', 'amount', 'category', 'status', 'month', 'company'],
    sample: { amount: '₹2,450.00', category: 'Travel', status: 'approved', month: 'November 2026' },
  },
  {
    key: 'recognition', label: 'Recognition', hint: 'Appreciation or kudos from a teammate or manager', group: 'people', path: '/', automatic: false,
    tokens: ['name', 'sender', 'reason', 'company'],
    sample: { sender: 'Meera Iyer', reason: 'Closing the Q3 pipeline ahead of plan' },
  },
  {
    key: 'document', label: 'Document ready', hint: 'When a letter or form is ready to download', group: 'people', path: '/directory', automatic: false,
    tokens: ['name', 'document', 'company'],
    sample: { document: 'Experience letter' },
  },
  {
    key: 'offer', label: 'Job offer', hint: 'Offer letter invite for a selected candidate', group: 'hiring', path: '/jobs', automatic: false,
    tokens: ['name', 'job', 'startDate', 'location', 'company'],
    sample: { job: 'Sales executive', startDate: '1 Dec 2026', location: 'Bengaluru' },
  },
  {
    key: 'rejection', label: 'Application update', hint: 'When a candidacy is closed politely', group: 'hiring', path: '/', automatic: false,
    tokens: ['name', 'job', 'company'],
    sample: { name: 'Tara', job: 'Sales executive' },
  },
  {
    key: 'probation', label: 'Probation review', hint: 'Reminder that probation is ending soon', group: 'people', path: '/directory', automatic: true,
    tokens: ['name', 'endDate', 'manager', 'department', 'company'],
    sample: { endDate: '15 Dec 2026', manager: 'Meera Iyer', department: 'Sales' },
  },
  {
    key: 'overtime', label: 'Overtime decision', hint: 'When OT or comp-off is decided', group: 'time', path: '/attendance', automatic: true,
    tokens: ['name', 'day', 'hours', 'status', 'approver', 'company'],
    sample: { day: '14 Nov 2026', hours: '3', status: 'approved', approver: 'Meera Iyer' },
  },
  {
    key: 'tax', label: 'Tax declaration', hint: 'Reminder to submit or revise investment proof', group: 'pay', path: '/tax', automatic: true,
    tokens: ['name', 'deadline', 'year', 'company'],
    sample: { deadline: '15 Jan 2027', year: '2026-27' },
  },
  {
    key: 'reminder', label: 'Action reminder', hint: 'Pending leave, attendance, or approval waiting on someone', group: 'system', path: '/approvals', automatic: true,
    tokens: ['name', 'item', 'count', 'company'],
    sample: { item: 'leave request', count: '2' },
  },
  {
    key: 'asset', label: 'Asset assigned', hint: 'When a laptop, phone, or other asset is issued', group: 'people', path: '/directory', automatic: false,
    tokens: ['name', 'asset', 'serial', 'issued', 'company'],
    sample: { asset: 'Laptop', serial: 'LT-88421', issued: '14 Nov 2026' },
  },
];

export function defaultDesign(): MailDesign {
  return {
    layout: 'banner',
    accent: '',
    secondary: '',
    tinted: true,
    rounded: true,
    showLogo: true,
    headerTitle: '',
    headerTagline: '',
    showHeaderText: true,
    signoff: 'Warm regards,\nThe {{company}} team',
    footer: 'You are receiving this because you work at {{company}}.',
    footerNote: '',
    showWebsite: true,
  };
}

export function defaultTemplates(): Record<MailKey, MailTemplate> {
  return {
    payslip: {
      subject: 'Your payslip for {{month}} is ready', preheader: 'Net pay {{net}}. Open the HRMS to see the full slip.',
      heading: 'Your {{month}} payslip is ready',
      body: '<p>Hello {{name}},</p><p>Payroll has published your salary slip for <strong>{{month}}</strong>. Your net pay is <strong>{{net}}</strong>.</p><p>Open My pay to see every earning and deduction, and to download the slip.</p>',
      button: 'View my payslip', auto: false,
    },
    leave: {
      subject: 'Your leave request was {{status}}', preheader: '{{type}} from {{from}} to {{to}}.',
      heading: 'Leave {{status}}',
      body: '<p>Hello {{name}},</p><p>Your <strong>{{type}}</strong> from <strong>{{from}}</strong> to <strong>{{to}}</strong> ({{days}} days) was <strong>{{status}}</strong> by <strong>{{approver}}</strong>.</p><p>Your balance in the HRMS is already updated.</p>',
      button: 'Open my leave', auto: false,
    },
    announcement: {
      subject: '{{title}}', preheader: 'A new announcement from {{company}}.',
      heading: '{{title}}', body: '<p>Hello {{name}},</p>{{body}}', button: 'Read in the HRMS', auto: false,
    },
    birthday: {
      subject: 'Happy birthday, {{name}}', preheader: 'Wishing you a wonderful year ahead.',
      heading: 'Happy birthday, {{name}}! 🎂',
      body: '<p>Everyone at {{company}} is wishing you a wonderful day and a great year ahead.</p><p>— {{sender}}</p>',
      button: '', auto: false,
    },
    anniversary: {
      subject: 'Happy work anniversary, {{name}}', preheader: 'Year {{years}} with {{company}}.',
      heading: 'Happy {{years}}-year anniversary! 🎉',
      body: '<p>Hello {{name}},</p><p>Thank you for {{years}} years with {{company}}. Your work makes a difference every day.</p><p>— {{sender}}</p>',
      button: '', auto: false,
    },
    welcome: {
      subject: 'Welcome to {{company}}, {{name}}', preheader: 'We are glad you have joined.',
      heading: 'Welcome aboard, {{name}} 👋',
      body: '<p>We are glad you have joined {{company}}.</p><p>Sign in to the HRMS to punch in, apply for leave, and see your documents.</p><p>— {{sender}}</p>',
      button: 'Open the HRMS', auto: false,
    },
    cooling: {
      subject: 'About your application for {{job}}', preheader: 'You can apply again from {{date}}.',
      heading: 'Thank you for applying again',
      body: '<p>Hello {{name}},</p><p>Thank you for your interest in <strong>{{job}}</strong> at {{company}}.</p><p>Our hiring rules ask for a gap between applications, so we cannot consider this one right now. You are welcome to apply again from <strong>{{date}}</strong>.</p><p>We have kept your details on file.</p>',
      button: '', auto: false,
    },
    exit: {
      subject: 'Your last working day at {{company}}', preheader: 'Last day {{lastDay}}.',
      heading: 'Relieving confirmation',
      body: '<p>Hello {{name}},</p><p>This confirms your last working day as <strong>{{lastDay}}</strong>. HR will share relieving and F&amp;F details separately if needed.</p>',
      button: 'Open separation', auto: false,
    },
    onboarding: {
      subject: 'Your first day at {{company}}', preheader: 'Start date {{startDate}}.',
      heading: 'Welcome — here is your checklist',
      body: '<p>Hello {{name}},</p><p>Your start date is <strong>{{startDate}}</strong>. Your manager is <strong>{{manager}}</strong> in <strong>{{department}}</strong>.</p><p>Sign in to complete onboarding tasks and upload documents.</p>',
      button: 'Open onboarding', auto: false,
    },
    attendance: {
      subject: 'Attendance request {{status}}', preheader: '{{type}} on {{day}}.',
      heading: 'Attendance {{status}}',
      body: '<p>Hello {{name}},</p><p>Your <strong>{{type}}</strong> for <strong>{{day}}</strong> was <strong>{{status}}</strong>.</p>',
      button: 'Open attendance', auto: false,
    },
    password: {
      subject: 'Reset your {{company}} password', preheader: 'Use this one-time link.',
      heading: 'Password reset',
      body: '<p>Hello {{name}},</p><p>Use the button below to choose a new password. If you did not ask for this, you can ignore the email.</p>',
      button: 'Reset password', auto: false,
    },
    interview: {
      subject: 'Interview for {{job}} at {{company}}', preheader: '{{when}}',
      heading: 'You are invited to interview',
      body: '<p>Hello {{name}},</p><p>We would like to interview you for <strong>{{job}}</strong>.</p><p><strong>When:</strong> {{when}}<br><strong>Where:</strong> {{where}}<br><strong>With:</strong> {{interviewer}}</p>',
      button: '', auto: false,
    },
    reimbursement: {
      subject: 'Your {{category}} claim was {{status}}', preheader: '{{amount}} for {{month}}.',
      heading: 'Reimbursement {{status}}',
      body: '<p>Hello {{name}},</p><p>Your <strong>{{category}}</strong> claim of <strong>{{amount}}</strong> for <strong>{{month}}</strong> was <strong>{{status}}</strong>.</p><p>Open My pay to see the claim status.</p>',
      button: 'Open My pay', auto: false,
    },
    recognition: {
      subject: 'A thank-you from {{sender}}', preheader: '{{reason}}',
      heading: 'You were recognised 🌟',
      body: '<p>Hello {{name}},</p><p>{{sender}} wanted to recognise you for:</p><p><strong>{{reason}}</strong></p><p>Thank you for the difference you make at {{company}}.</p>',
      button: 'Open the HRMS', auto: false,
    },
    document: {
      subject: 'Your {{document}} is ready', preheader: 'Download it from the HRMS.',
      heading: '{{document}} ready',
      body: '<p>Hello {{name}},</p><p>Your <strong>{{document}}</strong> is ready. Sign in to download it from your documents.</p>',
      button: 'Open documents', auto: false,
    },
    offer: {
      subject: 'Offer for {{job}} at {{company}}', preheader: 'Start date {{startDate}}.',
      heading: 'Congratulations — we have an offer',
      body: '<p>Hello {{name}},</p><p>We are pleased to offer you the role of <strong>{{job}}</strong> at {{company}}, starting <strong>{{startDate}}</strong> in <strong>{{location}}</strong>.</p><p>Please review the offer details and reply through the link below.</p>',
      button: 'View offer', auto: false,
    },
    rejection: {
      subject: 'Update on your application for {{job}}', preheader: 'Thank you for your interest in {{company}}.',
      heading: 'Thank you for applying',
      body: '<p>Hello {{name}},</p><p>Thank you for applying for <strong>{{job}}</strong> at {{company}}. After careful review we will not be moving forward with your application at this time.</p><p>We appreciate the time you invested and wish you the very best.</p>',
      button: '', auto: false,
    },
    probation: {
      subject: 'Your probation review is coming up', preheader: 'Ends on {{endDate}}.',
      heading: 'Probation review reminder',
      body: '<p>Hello {{name}},</p><p>Your probation with {{company}} is due to end on <strong>{{endDate}}</strong>. Your manager <strong>{{manager}}</strong> will complete the review shortly.</p>',
      button: 'Open my profile', auto: false,
    },
    overtime: {
      subject: 'Overtime request {{status}}', preheader: '{{hours}} hours on {{day}}.',
      heading: 'Overtime {{status}}',
      body: '<p>Hello {{name}},</p><p>Your overtime of <strong>{{hours}} hours</strong> on <strong>{{day}}</strong> was <strong>{{status}}</strong>.</p>',
      button: 'Open attendance', auto: false,
    },
    tax: {
      subject: 'Submit your tax declaration for {{year}}', preheader: 'Deadline {{deadline}}.',
      heading: 'Tax declaration reminder',
      body: '<p>Hello {{name}},</p><p>Please submit or update your tax declaration for <strong>{{year}}</strong> by <strong>{{deadline}}</strong>.</p>',
      button: 'Open tax', auto: false,
    },
    reminder: {
      subject: 'You have {{count}} pending {{item}}', preheader: 'Action needed in the HRMS.',
      heading: 'Pending action',
      body: '<p>Hello {{name}},</p><p>You have <strong>{{count}}</strong> pending {{item}} waiting for you in the HRMS.</p>',
      button: 'Open approvals', auto: false,
    },
    asset: {
      subject: '{{asset}} assigned to you', preheader: 'Serial {{serial}}.',
      heading: 'Asset assigned',
      body: '<p>Hello {{name}},</p><p>A <strong>{{asset}}</strong> (serial <strong>{{serial}}</strong>) was assigned to you on <strong>{{issued}}</strong>. Please take care of company property and report any issue to IT or Admin.</p>',
      button: 'Open my profile', auto: false,
    },
  };
}

export interface MailBrand {
  company: string;
  logoSrc: string;
  website: string;
  origin: string;
  accent: string;
  phone: string;
  email: string;
  city: string;
  address: string;
}

function escape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function tokenMap(tokens: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key.toLowerCase(), value]));
}

function fill(text: string, tokens: Record<string, string>, html: boolean): string {
  const map = tokenMap(tokens);
  return text.replace(/\{\{\s*([a-z][a-z0-9]*)\s*\}\}/gi, (_, key: string) => {
    const value = map[key.toLowerCase()] ?? '';
    if (!html) return key.toLowerCase() === 'body' ? plainOf(value) : value;
    return key.toLowerCase() === 'body' ? sanitizeRich(value) : escape(value);
  });
}

/** The template with its tokens replaced, so a sender can read and edit the real wording. */
export function filledTemplate(template: MailTemplate, tokens: Record<string, string>): { subject: string; heading: string; body: string } {
  return {
    subject: fill(template.subject, tokens, false).replace(/\s+/g, ' ').trim(),
    heading: fill(template.heading, tokens, false),
    body: fill(sanitizeRich(template.body), tokens, true),
  };
}

function hex(value: string, fallback: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function mix(color: string, amount: number): string {
  const n = parseInt(color.slice(1), 16);
  const channel = (shift: number) => Math.round(((n >> shift) & 255) + (255 - ((n >> shift) & 255)) * amount);
  return '#' + [16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('');
}

function readable(color: string): string {
  const n = parseInt(color.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#0f1b2d' : '#ffffff';
}

const P = 'margin:0 0 14px;font-size:15px;line-height:1.65;color:#334155;';

function styleBody(html: string, accent: string): string {
  return html
    .replace(/<p>/g, `<p style="${P}">`)
    .replace(/<ul>/g, '<ul style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.65;color:#334155;">')
    .replace(/<ol>/g, '<ol style="margin:0 0 14px;padding-left:22px;font-size:15px;line-height:1.65;color:#334155;">')
    .replace(/<li>/g, '<li style="margin:0 0 6px;">')
    .replace(/<h([234])>/g, '<h$1 style="margin:18px 0 8px;font-size:17px;line-height:1.35;color:#0f1b2d;">')
    .replace(/<blockquote>/g, `<blockquote style="margin:0 0 14px;padding:10px 16px;border-left:3px solid ${accent};background:#f8fafc;color:#334155;">`)
    .replace(/<a href=/g, `<a style="color:${accent};text-decoration:underline;" href=`)
    .replace(/<hr>/g, '<hr style="border:0;border-top:1px solid #e2e8f0;margin:18px 0;">');
}

export function renderMail(design: MailDesign, template: MailTemplate, item: MailCatalogItem, brand: MailBrand, tokens: Record<string, string>) {
  const all = {
    company: brand.company,
    year: String(new Date().getFullYear()),
    website: (brand.website || '').replace(/^https?:\/\//, ''),
    phone: brand.phone || '',
    email: brand.email || '',
    city: brand.city || '',
    address: brand.address || '',
    ...tokens,
  };
  const accent = hex(design.accent || brand.accent, '#103860');
  const secondary = hex(design.secondary, '');
  const onAccent = readable(accent);
  const radius = design.rounded ? 14 : 0;
  const btnRadius = design.rounded ? 10 : 2;
  const page = design.tinted ? mix(accent, 0.93) : '#f4f6f9';
  const subject = fill(template.subject, all, false).replace(/\s+/g, ' ').trim();
  const preheader = fill(template.preheader, all, false);
  const heading = fill(escape(template.heading), all, true);
  const body = styleBody(fill(sanitizeRich(template.body), all, true), accent);
  const link = brand.origin.replace(/\/$/, '') + item.path;
  const button = fill(escape(template.button), all, true);
  const signoff = escape(fill(design.signoff, all, false)).replace(/\n/g, '<br>');
  const footer = escape(fill(item.footer ?? design.footer, all, false)).replace(/\n/g, '<br>');
  const footerNote = escape(fill(design.footerNote || '', all, false)).replace(/\n/g, '<br>');
  const initials = escape(brand.company.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'HR');
  const headerTitle = design.showHeaderText ? fill(escape(design.headerTitle || ''), all, true).trim() : '';
  const headerTagline = design.showHeaderText ? fill(escape(design.headerTagline || ''), all, true).trim() : '';
  const hasHeaderCopy = Boolean(headerTitle || headerTagline);
  const markBlock = (onDark: boolean, withName: boolean) => {
    if (design.showLogo && brand.logoSrc) {
      return `<img src="${escape(brand.logoSrc)}" alt="${escape(brand.company)}" height="36" style="display:block;height:36px;max-width:180px;border:0;">`;
    }
    const badge = `<td style="width:36px;height:36px;border-radius:${design.rounded ? 10 : 2}px;background:${onDark ? 'rgba(255,255,255,0.16)' : accent};color:${onDark ? onAccent : readable(accent)};font:700 14px/36px Segoe UI,Arial,sans-serif;text-align:center;">${initials}</td>`;
    if (!withName) return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${badge}</tr></table>`;
    return `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${badge}<td style="padding-left:10px;font:700 16px Segoe UI,Arial,sans-serif;color:${onDark ? onAccent : '#0f1b2d'};">${escape(brand.company)}</td></tr></table>`;
  };
  const headerCopy = (onDark: boolean) => {
    if (!hasHeaderCopy) return '';
    const titleColor = onDark ? onAccent : '#0f1b2d';
    const tagColor = onDark ? (onAccent === '#ffffff' ? 'rgba(255,255,255,0.82)' : 'rgba(15,27,45,0.72)') : '#64748b';
    return `<div style="padding-top:${design.showLogo || !hasHeaderCopy ? 10 : 0}px;">
      ${headerTitle ? `<div style="font:700 18px/1.3 Segoe UI,Arial,sans-serif;color:${titleColor};">${headerTitle}</div>` : ''}
      ${headerTagline ? `<div style="margin-top:4px;font:500 12.5px/1.45 Segoe UI,Arial,sans-serif;color:${tagColor};">${headerTagline}</div>` : ''}
    </div>`;
  };
  const trim = secondary
    ? `<tr><td style="height:4px;line-height:4px;font-size:0;background:${secondary};">&nbsp;</td></tr>`
    : '';

  let header = '';
  if (design.layout === 'banner') {
    header = `<tr><td style="background:${accent};padding:26px 32px;border-radius:${radius}px ${radius}px 0 0;">${markBlock(true, !hasHeaderCopy)}${headerCopy(true)}</td></tr>${trim}`;
  } else if (design.layout === 'card') {
    header = `<tr><td style="border-top:4px solid ${accent};border-radius:${radius}px ${radius}px 0 0;padding:28px 32px 0;" align="center">${markBlock(false, !hasHeaderCopy)}${headerCopy(false)}</td></tr>${trim}`;
  } else {
    header = `<tr><td style="padding:24px 32px 18px;border-bottom:1px solid #e2e8f0;">${markBlock(false, !hasHeaderCopy)}${headerCopy(false)}</td></tr>${trim}`;
  }
  const cta = button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" ${design.layout === 'card' ? 'align="center" ' : ''}style="margin:22px ${design.layout === 'card' ? 'auto' : '0'} 6px;"><tr><td style="border-radius:${btnRadius}px;background:${accent};"><a href="${escape(link)}" style="display:inline-block;padding:13px 24px;font:600 15px Segoe UI,Arial,sans-serif;color:${onAccent};text-decoration:none;border-radius:${btnRadius}px;">${button}</a></td></tr></table>`
    : '';
  const align = design.layout === 'card' ? 'center' : 'left';
  const websiteLine = design.showWebsite && brand.website
    ? `<br><a href="${escape(brand.website)}" style="color:#64748b;">${escape(brand.website.replace(/^https?:\/\//, ''))}</a>`
    : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:0;background:${page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${page};"><tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:${radius}px;box-shadow:0 10px 30px rgba(15,27,45,0.08);font-family:Segoe UI,Helvetica,Arial,sans-serif;">
${header}
<tr><td style="padding:30px 32px 8px;text-align:${align};">
<h1 style="margin:0 0 18px;font-size:24px;line-height:1.3;font-weight:700;color:#0f1b2d;">${heading}</h1>
<div style="text-align:left;">${body}</div>
${cta ? `<div style="text-align:${align};">${cta}</div>` : ''}
</td></tr>
${signoff ? `<tr><td style="padding:10px 32px 28px;font-size:15px;line-height:1.6;color:#334155;text-align:${align};">${signoff}</td></tr>` : ''}
<tr><td style="padding:18px 32px 24px;border-top:1px solid #eef2f6;font-size:12px;line-height:1.6;color:#64748b;text-align:${align};">${footer}${footerNote ? `<br>${footerNote}` : ''}${websiteLine}</td></tr>
</table>
<p style="margin:16px 0 0;font:12px Segoe UI,Arial,sans-serif;color:#94a3b8;">Sent by ${escape(brand.company)} through Altamid HRMS</p>
</td></tr></table>
</body></html>`;
  const text = [
    plainOf(heading),
    '',
    fill(plainOf(sanitizeRich(template.body)), all, false),
    button ? `\n${plainOf(button)}: ${link}` : '',
    '',
    fill(design.signoff, all, false),
    '',
    fill(item.footer ?? design.footer, all, false),
    design.footerNote ? fill(design.footerNote, all, false) : '',
    design.showWebsite && brand.website ? brand.website.replace(/^https?:\/\//, '') : '',
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { subject, preheader, html, text };
}
