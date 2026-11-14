import { randomBytes } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Injectable, Logger } from '@nestjs/common';
import { JobForm } from '@prisma/client';
import { slugify } from './dates';
import { answerOf, FileKind, FormField, isLayout, isShown, normalizeField, validateFields } from './form-fields';
import { bag, emailOf, fail, optional, text } from './http';
import { AccessService } from './access.service';
import { ApplicantService } from './applicant.service';
import { BrandService } from './brand.service';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';
import { SettingsService } from './settings.service';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const TRACKING_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'browser_event_id'] as const;

/** What the page beside the form says on the full page. The form-only embed leaves it out. */
export interface FormAside {
  custom: boolean;
  kicker: string;
  title: string;
  lead: string;
  steps: Array<{ title: string; body: string }>;
}

export interface FormSettings {
  aside: FormAside;
  /** Sends visitors to this page after they apply, instead of showing the thank-you message. */
  redirectUrl: string;
  /** People emailed when an application arrives. */
  notify: string[];
  /** Shows the company logo above the form. */
  showLogo: boolean;
}

interface StoredFile { id: string; field: string; name: string; type: string; size: number; ext: string }

type TemplateGroup = 'general' | 'campus' | 'specialist' | 'event';
type Template = {
  key: string;
  name: string;
  description: string;
  title: string;
  intro: string;
  group: TemplateGroup;
  icon: string;
  fields: Array<Partial<FormField> & { key: string; label: string }>;
};

const TEMPLATES: Template[] = [
  {
    key: 'standard',
    name: 'Job application',
    description: 'Contact details, the job, a resume upload and a short note.',
    title: 'Apply to join us',
    intro: 'Tell us about yourself. We read every application.',
    group: 'general',
    icon: 'bi-briefcase',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', width: 'half' },
      { key: 'email', label: 'Email', type: 'email', width: 'half' },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'city', label: 'City', type: 'text', width: 'half', map: 'city' },
      { key: 'role', label: 'Job you are applying for', type: 'select', source: 'jobs', required: true, map: 'role' },
      { key: 'experience', label: 'Years of experience', type: 'select', options: ['Fresher', '1-2 years', '3-5 years', '6-10 years', 'More than 10 years'], width: 'half' },
      { key: 'notice', label: 'Notice period', type: 'select', options: ['Can join now', '15 days', '30 days', '60 days', '90 days'], width: 'half' },
      { key: 'resume', label: 'Resume', type: 'file', required: true, accept: ['pdf', 'doc'], maxFiles: 1, map: 'resume', help: 'PDF or Word, up to 5 MB.' },
      { key: 'note', label: 'Why do you want to join?', type: 'textarea', map: 'note' },
      { key: 'consent', label: 'I agree that HR may keep my details to consider me for jobs', type: 'terms', required: true },
    ],
  },
  {
    key: 'quick',
    name: 'Quick apply',
    description: 'Name, email, phone, the job and a resume. Short enough for mobile.',
    title: 'Quick apply',
    intro: 'Send your details and resume in a minute.',
    group: 'general',
    icon: 'bi-lightning-charge',
    fields: [
      { key: 'name', label: 'Full name', type: 'text' },
      { key: 'email', label: 'Email', type: 'email', width: 'half' },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'role', label: 'Job', type: 'select', source: 'jobs', required: true, map: 'role' },
      { key: 'resume', label: 'Resume', type: 'file', required: true, accept: ['pdf', 'doc'], maxFiles: 1, map: 'resume' },
    ],
  },
  {
    key: 'experienced',
    name: 'Experienced hire',
    description: 'Current and expected CTC, notice period, LinkedIn and resume.',
    title: 'Apply as an experienced professional',
    intro: 'Share your compensation, notice period and a short summary of your work.',
    group: 'specialist',
    icon: 'bi-person-badge',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', width: 'half' },
      { key: 'email', label: 'Email', type: 'email', width: 'half' },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'city', label: 'Current city', type: 'text', width: 'half', map: 'city' },
      { key: 'role', label: 'Role you are applying for', type: 'select', source: 'jobs', required: true, map: 'role' },
      { key: 'experience', label: 'Years of experience', type: 'select', options: ['1-2 years', '3-5 years', '6-10 years', '11-15 years', 'More than 15 years'], required: true, width: 'half' },
      { key: 'notice', label: 'Notice period', type: 'select', options: ['Can join now', '15 days', '30 days', '60 days', '90 days'], required: true, width: 'half' },
      { key: 'currentctc', label: 'Current CTC (annual)', type: 'text', width: 'half', placeholder: 'e.g. 8.5 LPA' },
      { key: 'expectedctc', label: 'Expected CTC (annual)', type: 'text', width: 'half', placeholder: 'e.g. 12 LPA' },
      { key: 'linkedin', label: 'LinkedIn profile', type: 'url', placeholder: 'https://linkedin.com/in/…' },
      { key: 'resume', label: 'Resume', type: 'file', required: true, accept: ['pdf', 'doc'], maxFiles: 1, map: 'resume' },
      { key: 'note', label: 'Brief work summary', type: 'textarea', map: 'note' },
      { key: 'consent', label: 'I agree that HR may keep my details to consider me for jobs', type: 'terms', required: true },
    ],
  },
  {
    key: 'internship',
    name: 'Internship',
    description: 'College, course, year of passing, start date and a resume.',
    title: 'Apply for an internship',
    intro: 'Students and fresh graduates, tell us what you study and when you can start.',
    group: 'campus',
    icon: 'bi-mortarboard',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', width: 'half' },
      { key: 'email', label: 'Email', type: 'email', width: 'half' },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'city', label: 'City', type: 'text', width: 'half', map: 'city' },
      { key: 'college', label: 'College or university', type: 'text', required: true },
      { key: 'course', label: 'Course', type: 'text', required: true, width: 'half' },
      { key: 'passing', label: 'Year of passing', type: 'number', required: true, width: 'half' },
      { key: 'start', label: 'When can you start?', type: 'date', width: 'half' },
      { key: 'duration', label: 'Internship length', type: 'radio', options: ['1 month', '3 months', '6 months'], width: 'half' },
      { key: 'resume', label: 'Resume', type: 'file', accept: ['pdf', 'doc'], maxFiles: 1, map: 'resume' },
      { key: 'note', label: 'What do you want to learn here?', type: 'textarea', map: 'note' },
    ],
  },
  {
    key: 'campus',
    name: 'Campus drive',
    description: 'College drive registration with branch, CGPA and preferred role.',
    title: 'Campus hiring registration',
    intro: 'Register for our campus drive. Bring your college ID on the day.',
    group: 'campus',
    icon: 'bi-building',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', width: 'half' },
      { key: 'email', label: 'College email', type: 'email', width: 'half' },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'city', label: 'City', type: 'text', width: 'half', map: 'city' },
      { key: 'college', label: 'College or university', type: 'text', required: true },
      { key: 'branch', label: 'Branch / stream', type: 'text', required: true, width: 'half' },
      { key: 'cgpa', label: 'CGPA / percentage', type: 'text', required: true, width: 'half' },
      { key: 'passing', label: 'Year of passing', type: 'number', required: true, width: 'half' },
      { key: 'role', label: 'Preferred role', type: 'select', source: 'jobs', required: true, map: 'role', width: 'half' },
      { key: 'resume', label: 'Resume', type: 'file', required: true, accept: ['pdf', 'doc'], maxFiles: 1, map: 'resume' },
      { key: 'consent', label: 'I agree that HR may keep my details for campus hiring', type: 'terms', required: true },
    ],
  },
  {
    key: 'walkin',
    name: 'Walk-in registration',
    description: 'For hiring drives at the office: contact, job, experience and consent.',
    title: 'Walk-in registration',
    intro: 'Register before your interview so HR has your details ready.',
    group: 'event',
    icon: 'bi-geo-alt',
    fields: [
      { key: 'name', label: 'Full name', type: 'text' },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'email', label: 'Email', type: 'email', width: 'half' },
      { key: 'role', label: 'Job', type: 'select', source: 'jobs', required: true, map: 'role' },
      { key: 'fresher', label: 'Are you a fresher?', type: 'radio', options: ['Yes', 'No'], required: true, width: 'half' },
      { key: 'lastcompany', label: 'Last company', type: 'text', width: 'half', showWhen: { field: 'fresher', op: 'equals', values: ['No'] } },
      { key: 'referred', label: 'Did someone refer you?', type: 'checkbox' },
      { key: 'referrer', label: 'Who referred you?', type: 'text', showWhen: { field: 'referred', op: 'checked', values: [] } },
      { key: 'consent', label: 'I agree that HR may keep my details to consider me for jobs', type: 'terms', required: true },
    ],
  },
  {
    key: 'referral',
    name: 'Employee referral',
    description: 'Your teammate refers a candidate with role, relation and resume.',
    title: 'Refer someone to join us',
    intro: 'Know someone great? Share their details and we will follow up.',
    group: 'general',
    icon: 'bi-people',
    fields: [
      { key: 'heading_ref', label: 'Your details', type: 'heading' },
      { key: 'name', label: 'Your full name', type: 'text', width: 'half' },
      { key: 'email', label: 'Your work email', type: 'email', width: 'half' },
      { key: 'heading_cand', label: 'Candidate details', type: 'heading' },
      { key: 'candidate', label: 'Candidate full name', type: 'text', required: true },
      { key: 'candidateemail', label: 'Candidate email', type: 'email', required: true, width: 'half' },
      { key: 'candidatephone', label: 'Candidate phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'role', label: 'Role to consider', type: 'select', source: 'jobs', required: true, map: 'role' },
      { key: 'relation', label: 'How do you know them?', type: 'select', options: ['Former colleague', 'Friend', 'College', 'Family', 'Other'], required: true, width: 'half' },
      { key: 'resume', label: 'Candidate resume', type: 'file', accept: ['pdf', 'doc'], maxFiles: 1, map: 'resume' },
      { key: 'note', label: 'Why are they a good fit?', type: 'textarea', map: 'note' },
      { key: 'consent', label: 'I confirm the candidate knows I am sharing their details', type: 'terms', required: true },
    ],
  },
  {
    key: 'tech',
    name: 'Tech / engineering',
    description: 'Stack, GitHub or portfolio, years of experience and resume.',
    title: 'Apply for a tech role',
    intro: 'Tell us about your stack and share a portfolio or GitHub if you have one.',
    group: 'specialist',
    icon: 'bi-code-slash',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', width: 'half' },
      { key: 'email', label: 'Email', type: 'email', width: 'half' },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'city', label: 'City', type: 'text', width: 'half', map: 'city' },
      { key: 'role', label: 'Role', type: 'select', source: 'jobs', required: true, map: 'role' },
      { key: 'experience', label: 'Years of experience', type: 'select', options: ['Fresher', '1-2 years', '3-5 years', '6-10 years', 'More than 10 years'], required: true, width: 'half' },
      { key: 'stack', label: 'Primary stack', type: 'checklist', options: ['JavaScript / TypeScript', 'Python', 'Java', 'Go', 'PHP', 'Mobile', 'DevOps', 'Data / ML', 'Other'], required: true },
      { key: 'github', label: 'GitHub or portfolio URL', type: 'url', placeholder: 'https://…' },
      { key: 'resume', label: 'Resume', type: 'file', required: true, accept: ['pdf', 'doc'], maxFiles: 1, map: 'resume' },
      { key: 'note', label: 'A project you are proud of', type: 'textarea', map: 'note' },
      { key: 'consent', label: 'I agree that HR may keep my details to consider me for jobs', type: 'terms', required: true },
    ],
  },
  {
    key: 'sales',
    name: 'Sales / field role',
    description: 'Territory, languages, travel comfort and experience for field hiring.',
    title: 'Apply for a sales role',
    intro: 'Tell us where you work best and how you have sold before.',
    group: 'specialist',
    icon: 'bi-graph-up-arrow',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', width: 'half' },
      { key: 'email', label: 'Email', type: 'email', width: 'half' },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'city', label: 'Base city', type: 'text', width: 'half', map: 'city' },
      { key: 'role', label: 'Role', type: 'select', source: 'jobs', required: true, map: 'role' },
      { key: 'experience', label: 'Sales experience', type: 'select', options: ['Fresher', '1-2 years', '3-5 years', '6+ years'], required: true, width: 'half' },
      { key: 'travel', label: 'Comfortable with travel?', type: 'radio', options: ['Yes', 'Limited', 'No'], required: true, width: 'half' },
      { key: 'languages', label: 'Languages you speak', type: 'text', placeholder: 'e.g. Hindi, English, Tamil' },
      { key: 'vehicle', label: 'Do you have a two-wheeler?', type: 'radio', options: ['Yes', 'No'], width: 'half' },
      { key: 'resume', label: 'Resume', type: 'file', accept: ['pdf', 'doc'], maxFiles: 1, map: 'resume' },
      { key: 'note', label: 'Your best sales win', type: 'textarea', map: 'note' },
      { key: 'consent', label: 'I agree that HR may keep my details to consider me for jobs', type: 'terms', required: true },
    ],
  },
  {
    key: 'remote',
    name: 'Remote role',
    description: 'Timezone, home setup, tools and availability for remote hiring.',
    title: 'Apply for a remote role',
    intro: 'We hire remotely. Tell us about your setup and working hours.',
    group: 'specialist',
    icon: 'bi-wifi',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', width: 'half' },
      { key: 'email', label: 'Email', type: 'email', width: 'half' },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'city', label: 'City / country', type: 'text', width: 'half', map: 'city' },
      { key: 'role', label: 'Role', type: 'select', source: 'jobs', required: true, map: 'role' },
      { key: 'timezone', label: 'Timezone you work in', type: 'select', options: ['IST (India)', 'GMT / UK', 'CET / Europe', 'EST / US East', 'PST / US West', 'Other'], required: true, width: 'half' },
      { key: 'hours', label: 'Overlap with IST business hours', type: 'select', options: ['Full day', '4+ hours', '2-4 hours', 'Less than 2 hours'], required: true, width: 'half' },
      { key: 'setup', label: 'Home office setup', type: 'checklist', options: ['Dedicated desk', 'Laptop', 'Stable broadband', 'Webcam', 'Quiet space'] },
      { key: 'resume', label: 'Resume', type: 'file', required: true, accept: ['pdf', 'doc'], maxFiles: 1, map: 'resume' },
      { key: 'note', label: 'Remote work experience', type: 'textarea', map: 'note' },
      { key: 'consent', label: 'I agree that HR may keep my details to consider me for jobs', type: 'terms', required: true },
    ],
  },
  {
    key: 'contractor',
    name: 'Contractor / consultant',
    description: 'Rate, availability, GST and portfolio for contract engagements.',
    title: 'Contractor interest form',
    intro: 'Looking for project or retainer work? Share your rate and availability.',
    group: 'specialist',
    icon: 'bi-file-earmark-ruled',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', width: 'half' },
      { key: 'email', label: 'Email', type: 'email', width: 'half' },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'city', label: 'City', type: 'text', width: 'half', map: 'city' },
      { key: 'role', label: 'Engagement type', type: 'select', source: 'jobs', required: true, map: 'role' },
      { key: 'rate', label: 'Day / hour rate', type: 'text', required: true, width: 'half', placeholder: 'e.g. ₹4,000 / day' },
      { key: 'available', label: 'Available from', type: 'date', width: 'half' },
      { key: 'gst', label: 'Do you have GST registration?', type: 'radio', options: ['Yes', 'No'], width: 'half' },
      { key: 'portfolio', label: 'Portfolio or website', type: 'url' },
      { key: 'resume', label: 'CV / capability deck', type: 'file', accept: ['pdf', 'doc'], maxFiles: 1, map: 'resume' },
      { key: 'note', label: 'Relevant experience', type: 'textarea', map: 'note' },
      { key: 'consent', label: 'I agree that HR may keep my details for future engagements', type: 'terms', required: true },
    ],
  },
  {
    key: 'event',
    name: 'Hiring event RSVP',
    description: 'Register for an open day or career fair with slot preference.',
    title: 'Register for our hiring event',
    intro: 'Pick a slot and we will confirm your visit by email or SMS.',
    group: 'event',
    icon: 'bi-calendar-event',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', width: 'half' },
      { key: 'email', label: 'Email', type: 'email', width: 'half' },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'city', label: 'City', type: 'text', width: 'half', map: 'city' },
      { key: 'role', label: 'Roles of interest', type: 'select', source: 'jobs', required: true, map: 'role' },
      { key: 'slot', label: 'Preferred slot', type: 'radio', options: ['Morning', 'Afternoon', 'Evening'], required: true },
      { key: 'guests', label: 'Coming with someone?', type: 'radio', options: ['Just me', 'With one guest'], width: 'half' },
      { key: 'resume', label: 'Resume (optional)', type: 'file', accept: ['pdf', 'doc'], maxFiles: 1, map: 'resume' },
      { key: 'consent', label: 'I agree to receive event updates from HR', type: 'terms', required: true },
    ],
  },
  {
    key: 'rehire',
    name: 'Alumni / rehire',
    description: 'Former employees who want to return: last role, exit date, interest.',
    title: 'Come back to work with us',
    intro: 'Glad you are considering a return. Tell us about your earlier role.',
    group: 'general',
    icon: 'bi-arrow-repeat',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', width: 'half' },
      { key: 'email', label: 'Email', type: 'email', width: 'half' },
      { key: 'phone', label: 'Phone', type: 'tel', required: true, width: 'half', map: 'phone' },
      { key: 'city', label: 'City', type: 'text', width: 'half', map: 'city' },
      { key: 'lastrole', label: 'Last role here', type: 'text', required: true, width: 'half' },
      { key: 'exitdate', label: 'Last working month', type: 'text', required: true, width: 'half', placeholder: 'e.g. March 2024' },
      { key: 'role', label: 'Role you are interested in now', type: 'select', source: 'jobs', required: true, map: 'role' },
      { key: 'resume', label: 'Updated resume', type: 'file', accept: ['pdf', 'doc'], maxFiles: 1, map: 'resume' },
      { key: 'note', label: 'What brings you back?', type: 'textarea', map: 'note' },
      { key: 'consent', label: 'I agree that HR may keep my details to consider me for jobs', type: 'terms', required: true },
    ],
  },
  {
    key: 'blank',
    name: 'Blank form',
    description: 'Only the full name and email. Add the rest yourself.',
    title: 'Apply',
    intro: '',
    group: 'general',
    icon: 'bi-file-earmark-plus',
    fields: [
      { key: 'name', label: 'Full name', type: 'text', width: 'half' },
      { key: 'email', label: 'Email', type: 'email', width: 'half' },
    ],
  },
];

const KINDS: Record<FileKind, Array<{ ext: string; type: string; magic: (bytes: Buffer) => boolean }>> = {
  pdf: [{ ext: 'pdf', type: 'application/pdf', magic: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' }],
  doc: [
    { ext: 'docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
    { ext: 'doc', type: 'application/msword', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) },
  ],
  image: [
    { ext: 'png', type: 'image/png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    { ext: 'jpg', type: 'image/jpeg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  ],
};

@Injectable()
export class FormsService {
  private readonly log = new Logger('Forms');

  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
    private readonly applicants: ApplicantService,
    private readonly settings: SettingsService,
    private readonly brand: BrandService,
  ) {}

  templates() {
    return TEMPLATES.map((item) => ({
      key: item.key,
      name: item.name,
      description: item.description,
      group: item.group,
      icon: item.icon,
      title: item.title,
      fields: item.fields.map((field) => field.label),
    }));
  }

  async list(session: SessionUser) {
    await this.requireHr(session);
    const rows = await this.prisma.jobForm.findMany({
      where: { companyId: session.companyId },
      include: { _count: { select: { applications: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    return { forms: rows.map((row) => this.summary(row, row._count.applications)), templates: this.templates() };
  }

  async get(session: SessionUser, id: string) {
    await this.requireHr(session);
    const form = await this.owned(session.companyId, id);
    return this.detail(form, await this.prisma.jobApplication.count({ where: { formId: form.id } }));
  }

  async create(session: SessionUser, body: unknown) {
    await this.requireHr(session);
    const input = bag(body);
    const template = TEMPLATES.find((item) => item.key === input.template) || TEMPLATES[0];
    const name = text(input.name || template.name, 'Form name', 80);
    const slug = await this.uniqueSlug(slugify(name).replace(/^company$/, 'jobs') || 'jobs');
    const fields = template.fields.map((field, index) => normalizeField(field as Record<string, unknown>, index));
    const form = await this.prisma.jobForm.create({
      data: {
        companyId: session.companyId,
        name,
        slug,
        title: template.title,
        intro: template.intro,
        fieldsJson: JSON.stringify(fields),
        settingsJson: JSON.stringify(this.defaultSettings()),
      },
    });
    await this.audit(session, 'form.create', form.id);
    return this.detail(form, 0);
  }

  async duplicate(session: SessionUser, id: string) {
    await this.requireHr(session);
    const source = await this.owned(session.companyId, id);
    const name = (source.name + ' (copy)').slice(0, 80);
    const form = await this.prisma.jobForm.create({
      data: {
        companyId: session.companyId,
        outletId: source.outletId,
        name,
        slug: await this.uniqueSlug(slugify(name) || 'jobs'),
        title: source.title,
        intro: source.intro,
        submitLabel: source.submitLabel,
        thanks: source.thanks,
        fieldsJson: source.fieldsJson,
        settingsJson: source.settingsJson,
      },
    });
    await this.audit(session, 'form.duplicate', form.id);
    return this.detail(form, 0);
  }

  async update(session: SessionUser, id: string, body: unknown) {
    await this.requireHr(session);
    const current = await this.owned(session.companyId, id);
    const input = bag(body);
    const fields = input.fields === undefined ? this.readFields(current.fieldsJson) : validateFields(input.fields);
    const status = input.status === undefined ? current.status : ['published', 'draft', 'archived'].includes(String(input.status)) ? String(input.status) : 'draft';
    let slug = current.slug;
    if (input.slug !== undefined) {
      const wanted = slugify(text(input.slug, 'Public address', 60)).slice(0, 60);
      if (!/^[a-z0-9-]{2,60}$/.test(wanted)) fail(400, 'Use at least two letters or numbers for the public address.');
      if (wanted !== current.slug) {
        if (await this.prisma.jobForm.findUnique({ where: { slug: wanted } })) fail(409, 'Another form already uses that address. Choose a different one.');
        slug = wanted;
      }
    }
    const form = await this.prisma.jobForm.update({
      where: { id: current.id },
      data: {
        name: input.name === undefined ? current.name : text(input.name, 'Form name', 80),
        slug,
        title: input.title === undefined ? current.title : text(input.title, 'Public heading', 120),
        intro: input.intro === undefined ? current.intro : optional(input.intro, 1200),
        submitLabel: input.submitLabel === undefined ? current.submitLabel : text(input.submitLabel, 'Button label', 40),
        thanks: input.thanks === undefined ? current.thanks : text(input.thanks, 'Thank-you message', 600),
        status,
        fieldsJson: JSON.stringify(fields),
        settingsJson: input.settings === undefined ? current.settingsJson : JSON.stringify(this.settingsOf(input.settings)),
      },
    });
    await this.audit(session, status !== current.status ? 'form.' + status : 'form.update', form.id);
    return this.detail(form, await this.prisma.jobApplication.count({ where: { formId: form.id } }));
  }

  /** A form that already has applications is archived instead, so the applications stay. */
  async remove(session: SessionUser, id: string) {
    await this.requireHr(session);
    const current = await this.owned(session.companyId, id);
    const count = await this.prisma.jobApplication.count({ where: { formId: current.id } });
    if (count) {
      await this.prisma.jobForm.update({ where: { id: current.id }, data: { status: 'archived' } });
      await this.audit(session, 'form.archived', current.id);
      return { ok: true, archived: true, message: `This form has ${count} application${count === 1 ? '' : 's'}, so it was archived instead. The applications stay in Hiring.` };
    }
    await this.prisma.jobForm.delete({ where: { id: current.id } });
    await this.audit(session, 'form.delete', current.id);
    return { ok: true, archived: false, message: 'Form deleted.' };
  }

  async submissions(session: SessionUser, id: string) {
    await this.requireHr(session);
    const form = await this.owned(session.companyId, id);
    const rows = await this.prisma.jobApplication.findMany({ where: { formId: form.id }, orderBy: { createdAt: 'desc' }, take: 200 });
    const total = await this.prisma.jobApplication.count({ where: { formId: form.id } });
    const fields = this.readFields(form.fieldsJson).filter((field) => !isLayout(field));
    return {
      form: this.summary(form, total),
      fields: fields.map((field) => ({ key: field.key, label: field.label })),
      rows: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        status: row.status,
        jobTitle: row.jobTitle,
        source: this.sourceLabel(row.source, row.trackingJson),
        files: this.readFiles(row.filesJson).length,
        createdAt: row.createdAt.toISOString(),
        answers: this.readAnswers(row.answersJson),
      })),
    };
  }

  /** A file a visitor uploaded with their application. */
  async applicationFile(session: SessionUser, applicationId: string, fileId: string): Promise<{ type: string; bytes: Buffer; name: string } | null> {
    await this.gates.gate(session, 'hiring', 'You do not have access to hiring.');
    const row = await this.prisma.jobApplication.findFirst({ where: { id: applicationId, companyId: session.companyId }, select: { id: true, filesJson: true } });
    if (!row) return null;
    const file = this.readFiles(row.filesJson).find((item) => item.id === fileId);
    if (!file) return null;
    const path = join(this.fileDir(session.companyId, row.id), file.id + '.' + file.ext);
    if (!existsSync(path)) return null;
    return { type: file.type, bytes: readFileSync(path), name: file.name };
  }

  /** Uploaded files and where the visitor came from, for the application page. */
  async extras(companyId: string, applicationId: string) {
    const row = await this.prisma.jobApplication.findFirst({ where: { id: applicationId, companyId }, select: { filesJson: true, trackingJson: true } });
    return {
      files: row ? this.readFiles(row.filesJson).map(({ id, field, name, type, size }) => ({ id, field, name, type, size })) : [],
      tracking: row ? this.trackingOf(row.trackingJson) : [],
    };
  }

  private trackingOf(raw: string): Array<{ label: string; value: string }> {
    const tracking = this.readTracking(raw);
    const labels: Record<string, string> = {
      embed: 'Sent from', landing_page: 'Page', referrer: 'Came from', utm_source: 'Campaign source', utm_medium: 'Campaign medium',
      utm_campaign: 'Campaign', utm_content: 'Ad content', utm_term: 'Search term', gclid: 'Google ad click', fbclid: 'Meta ad click',
    };
    return Object.entries(labels)
      .filter(([key]) => tracking[key])
      .map(([key, label]) => ({ label, value: key === 'embed' ? (tracking.embed === 'form' ? 'Form embedded on a website' : tracking.embed === 'page' ? 'Full page embedded on a website' : tracking.embed) : tracking[key] }));
  }

  /** Staff preview of a saved form (draft or published) as applicants will see it. */
  async staffPreview(session: SessionUser, id: string) {
    await this.requireHr(session);
    const form = await this.owned(session.companyId, id);
    if (form.status === 'archived') fail(404, 'This form is archived. Set it to draft or published to preview it.');
    const view = await this.viewOf(form);
    return { ...view, slug: form.slug, status: form.status, preview: true };
  }

  async publicView(slug: string) {
    const form = await this.published(slug);
    return this.viewOf(form);
  }

  private async viewOf(form: JobForm) {
    const company = await this.prisma.company.findUnique({ where: { id: form.companyId } });
    const brand = company ? this.brand.view(company) : null;
    const settings = this.readSettings(form.settingsJson);
    const fields = this.readFields(form.fieldsJson);
    const jobs = fields.some((field) => field.source === 'jobs') ? await this.openJobs(form) : [];
    return {
      company: brand?.name || company?.name || 'Company',
      companyId: form.companyId,
      title: form.title,
      intro: form.intro,
      submitLabel: form.submitLabel,
      colors: brand?.colors || {},
      logo: settings.showLogo && brand?.hasLogo ? '/v1/mail/logo/' + form.companyId : '',
      aside: this.asideFor(settings.aside, brand?.name || company?.name || 'us'),
      fields: fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        options: field.source === 'jobs' ? jobs.map((job) => job.label) : field.options,
        placeholder: field.placeholder,
        help: field.help,
        width: field.width,
        answerMode: field.answerMode,
        allowOther: field.allowOther,
        showWhen: field.showWhen,
        accept: field.accept,
        maxFiles: field.maxFiles,
      })),
    };
  }

  async publicSubmit(slug: string, body: unknown) {
    const form = await this.published(slug);
    const input = bag(body);
    const settings = this.readSettings(form.settingsJson);
    if (String(input.website || '').trim()) return { thanks: form.thanks, redirectUrl: settings.redirectUrl, cooling: false };
    const raw = this.record(input.answers);
    const other = this.record(input.other);
    const uploads = this.record(input.files);
    const fields = this.readFields(form.fieldsJson);
    const jobs = fields.some((field) => field.source === 'jobs') ? await this.openJobs(form) : [];
    const answers: Record<string, string> = {};
    const pending: Array<{ field: FormField; files: Array<{ name: string; bytes: Buffer; ext: string; type: string }> }> = [];
    let uploadBytes = 0;
    for (const field of fields) {
      if (isLayout(field) || !isShown(fields, field, raw)) continue;
      if (field.type === 'file') {
        const files = this.uploadsOf(field, uploads[field.key]);
        uploadBytes += files.reduce((sum, file) => sum + file.bytes.length, 0);
        if (uploadBytes > MAX_UPLOAD_BYTES) fail(413, 'The files are too large together. Keep them under 12 MB in total.');
        if (files.length) {
          pending.push({ field, files });
          answers[field.key] = files.map((file) => file.name).join(', ');
        }
        continue;
      }
      const value = answerOf(field, raw, other, jobs.map((job) => job.label));
      if (value) answers[field.key] = value;
    }
    const mapped = (map: string) => {
      const field = fields.find((item) => item.map === map && answers[item.key]);
      return field ? answers[field.key] : '';
    };
    const name = (mapped('name') || 'Applicant').slice(0, 120);
    const email = emailOf(mapped('email'));
    const phone = mapped('phone').slice(0, 30);
    const roleField = fields.find((item) => item.map === 'role');
    const roleAnswer = mapped('role');
    const opening = roleField?.source === 'jobs'
      ? jobs.find((job) => job.label === roleAnswer)?.row || null
      : await this.matchOpening(form, roleAnswer);
    const resumeLink = mapped('resume');
    const tracking = this.trackingIn(input.tracking);
    const cooling = await this.applicants.cooling(form.companyId, { name, email, phone });
    const saved = await this.prisma.jobApplication.create({
      data: {
        companyId: form.companyId,
        formId: form.id,
        openingId: opening?.id,
        name,
        email,
        phone,
        city: mapped('city').slice(0, 80),
        resumeUrl: /^https:\/\/[^\s]+$/i.test(resumeLink) ? resumeLink : '',
        source: tracking.utm_source ? this.cleanSource(tracking.utm_source) : opening ? 'website' : 'form',
        status: cooling ? 'cooling' : 'new',
        coolingUntil: cooling?.until || '',
        coolingNote: cooling?.reason || '',
        jobTitle: opening?.title || roleAnswer.slice(0, 120),
        jobCode: opening?.code || '',
        answersJson: JSON.stringify(answers),
        trackingJson: JSON.stringify(tracking),
      },
    });
    if (pending.length) {
      const stored: StoredFile[] = [];
      const dir = this.fileDir(form.companyId, saved.id);
      mkdirSync(dir, { recursive: true });
      for (const item of pending) {
        for (const file of item.files) {
          const id = randomBytes(9).toString('hex');
          writeFileSync(join(dir, id + '.' + file.ext), file.bytes);
          stored.push({ id, field: item.field.key, name: file.name, type: file.type, size: file.bytes.length, ext: file.ext });
        }
      }
      await this.prisma.jobApplication.update({ where: { id: saved.id }, data: { filesJson: JSON.stringify(stored) } });
    }
    await this.applicants.event(form.companyId, saved.id, 'received', 'Sent the ' + form.name + ' form' + (opening ? ' for ' + opening.title : '') + (pending.length ? ' with ' + pending.reduce((sum, item) => sum + item.files.length, 0) + ' file(s)' : ''));
    const reply = cooling ? await this.applicants.tell(form.companyId, saved.id, { name, email, phone }, saved.jobTitle, cooling) : '';
    void this.notify(form, settings, saved.id, name, saved.jobTitle);
    return { thanks: reply || form.thanks, redirectUrl: reply ? '' : settings.redirectUrl, cooling: Boolean(reply) };
  }

  private async notify(form: JobForm, settings: FormSettings, id: string, name: string, job: string): Promise<void> {
    if (!settings.notify.length) return;
    const origin = (process.env.WEB_ORIGIN || 'http://localhost:4400').replace(/\/$/, '');
    for (const to of settings.notify) {
      await this.settings
        .sendSystemMail(form.companyId, to, `New application: ${name}${job ? ' for ' + job : ''}`, [`${name} sent the ${form.name} form${job ? ' for ' + job : ''}.`, 'Open it in Hiring to read the answers and the resume.'], { label: 'Open the application', url: `${origin}/hiring/applications/${id}` })
        .catch((error: unknown) => this.log.warn(`Could not email ${to}: ${error instanceof Error ? error.message : error}`));
    }
  }

  private uploadsOf(field: FormField, value: unknown): Array<{ name: string; bytes: Buffer; ext: string; type: string }> {
    const list = Array.isArray(value) ? value : [];
    if (field.required && !list.length) fail(400, `Attach ${field.label.toLowerCase()}.`);
    if (list.length > field.maxFiles) fail(400, `Attach up to ${field.maxFiles} file${field.maxFiles === 1 ? '' : 's'} for ${field.label.toLowerCase()}.`);
    return list.map((item) => {
      const row = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
      const match = /^data:[\w.+/-]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(String(row.data || '').trim());
      if (!match) fail(400, `${field.label}: that file could not be read. Choose it again.`);
      const bytes = Buffer.from(match[1], 'base64');
      if (!bytes.length) fail(400, `${field.label}: that file is empty.`);
      if (bytes.length > MAX_FILE_BYTES) fail(413, `${field.label}: each file must be 5 MB or smaller.`);
      const kind = field.accept.flatMap((accepted) => KINDS[accepted]).find((candidate) => candidate.magic(bytes));
      if (!kind) fail(400, `${field.label}: upload ${this.acceptLabel(field.accept)}.`);
      const base = String(row.name || 'file').replace(/\.[^.]*$/, '').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'file';
      return { name: base + '.' + kind.ext, bytes, ext: kind.ext, type: kind.type };
    });
  }

  private acceptLabel(kinds: FileKind[]): string {
    const words = kinds.map((kind) => (kind === 'pdf' ? 'a PDF' : kind === 'doc' ? 'a Word file' : 'a PNG or JPG image'));
    return words.length > 1 ? words.slice(0, -1).join(', ') + ' or ' + words[words.length - 1] : words[0] || 'a PDF';
  }

  private trackingIn(value: unknown): Record<string, string> {
    const input = this.record(value);
    const out: Record<string, string> = {};
    for (const key of TRACKING_KEYS) {
      const item = String(input[key] ?? '').trim();
      if (/^[A-Za-z0-9._:\- ]{1,160}$/.test(item)) out[key] = item;
    }
    for (const key of ['landing_page', 'referrer']) {
      const item = String(input[key] ?? '').trim().slice(0, 500);
      if (/^https?:\/\/[^\s<>"]+$/i.test(item)) out[key] = item;
    }
    const embed = String(input.embed || '');
    if (embed === 'form' || embed === 'page') out.embed = embed;
    return out;
  }

  private cleanSource(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40) || 'form';
  }

  private sourceLabel(source: string, trackingJson: string): string {
    const tracking = this.readTracking(trackingJson);
    if (tracking.utm_source) return tracking.utm_source + (tracking.utm_campaign ? ' · ' + tracking.utm_campaign : '');
    if (tracking.embed) return 'Website embed';
    return source === 'website' ? 'Company website' : 'Form link';
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private fileDir(companyId: string, applicationId: string): string {
    return join(process.cwd(), 'storage', 'applications', companyId.replace(/[^\w-]/g, ''), applicationId.replace(/[^\w-]/g, ''));
  }

  private async openJobs(form: JobForm) {
    const rows = await this.prisma.opening.findMany({
      where: { companyId: form.companyId, status: 'open', ...(form.outletId ? { outletId: form.outletId } : {}) },
      orderBy: { title: 'asc' },
    });
    return rows.map((row) => ({ row, label: row.title + (row.code ? ' (' + row.code + ')' : '') }));
  }

  private async requireHr(session: SessionUser): Promise<void> {
    await this.gates.gate(session, 'hiring.forms', 'You do not have access to job forms.');
  }

  private async owned(companyId: string, id: string) {
    const form = await this.prisma.jobForm.findFirst({ where: { id, companyId } });
    if (!form) fail(404, 'That form was not found.');
    return form;
  }

  private async matchOpening(form: JobForm, answer: string) {
    const role = answer.trim().toLowerCase();
    if (!role) return null;
    const rows = await this.prisma.opening.findMany({ where: { companyId: form.companyId, status: 'open', ...(form.outletId ? { outletId: form.outletId } : {}) } });
    return rows.find((row) => row.code.toLowerCase() === role || row.title.toLowerCase() === role) || null;
  }

  private async published(slug: string) {
    const cleaned = String(slug || '').trim().toLowerCase();
    if (!/^[a-z0-9-]{2,60}$/.test(cleaned)) fail(404, 'That form was not found.');
    const form = await this.prisma.jobForm.findUnique({ where: { slug: cleaned } });
    if (!form) fail(404, 'That form was not found.');
    if (form.status === 'archived') fail(404, 'This form is closed to new applications.');
    if (form.status !== 'published') {
      fail(404, 'This form is not published yet. Open Settings → Forms, then choose Save and publish.');
    }
    return form;
  }

  private async uniqueSlug(base: string): Promise<string> {
    let slug = (base || 'jobs').slice(0, 48);
    for (let n = 2; n < 50; n += 1) {
      if (!(await this.prisma.jobForm.findUnique({ where: { slug } }))) return slug;
      slug = `${base.slice(0, 40)}-${n}`;
    }
    fail(409, 'Choose a different form name.');
  }

  private summary(row: { id: string; name: string; slug: string; title: string; status: string; updatedAt: Date; fieldsJson: string }, submissions: number) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      title: row.title,
      status: row.status,
      updatedAt: row.updatedAt.toISOString(),
      submissions,
      fieldCount: this.readFields(row.fieldsJson).filter((field) => !isLayout(field)).length,
      path: '/apply/' + row.slug,
    };
  }

  private detail(row: JobForm, submissions: number) {
    const settings = this.readSettings(row.settingsJson);
    return {
      ...this.summary(row, submissions),
      intro: row.intro,
      submitLabel: row.submitLabel,
      thanks: row.thanks,
      fields: this.readFields(row.fieldsJson),
      settings,
      standardAside: this.asideFor({ ...settings.aside, custom: false }, 'us'),
    };
  }

  private defaultSettings(): FormSettings {
    return { aside: { custom: false, kicker: '', title: '', lead: '', steps: [] }, redirectUrl: '', notify: [], showLogo: true };
  }

  private settingsOf(value: unknown): FormSettings {
    const input = this.record(value);
    const aside = this.record(input.aside);
    const redirectUrl = optional(input.redirectUrl, 500);
    if (redirectUrl && !/^https:\/\/[^\s<>"]+$/i.test(redirectUrl)) fail(400, 'The page after sending must be a full https:// address.');
    const notify = (Array.isArray(input.notify) ? input.notify : String(input.notify || '').split(/[,\s;]+/))
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean);
    if (notify.length > 5) fail(400, 'Email up to five people for each application.');
    for (const item of notify) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)) fail(400, `${item} is not a valid email address.`);
    const steps = Array.isArray(aside.steps) ? aside.steps.slice(0, 3).map((step) => {
      const row = this.record(step);
      return { title: optional(row.title, 80), body: optional(row.body, 200) };
    }) : [];
    return {
      aside: { custom: aside.custom === true, kicker: optional(aside.kicker, 80), title: optional(aside.title, 120), lead: optional(aside.lead, 400), steps },
      redirectUrl,
      notify: [...new Set(notify)],
      showLogo: input.showLogo !== false,
    };
  }

  private readSettings(raw: string): FormSettings {
    try {
      const parsed = JSON.parse(raw || '{}') as Record<string, unknown>;
      const base = this.defaultSettings();
      const aside = this.record(parsed.aside);
      return {
        aside: {
          custom: aside.custom === true,
          kicker: String(aside.kicker || ''),
          title: String(aside.title || ''),
          lead: String(aside.lead || ''),
          steps: Array.isArray(aside.steps) ? aside.steps.slice(0, 3).map((step) => ({ title: String(this.record(step).title || ''), body: String(this.record(step).body || '') })) : [],
        },
        redirectUrl: typeof parsed.redirectUrl === 'string' ? parsed.redirectUrl : base.redirectUrl,
        notify: Array.isArray(parsed.notify) ? parsed.notify.map(String) : base.notify,
        showLogo: parsed.showLogo !== false,
      };
    } catch {
      return this.defaultSettings();
    }
  }

  /** The standard text, with the form's own text over it where HR wrote some. */
  private asideFor(aside: FormAside, company: string): { kicker: string; title: string; lead: string; steps: Array<{ title: string; body: string }> } {
    const standard = {
      kicker: 'Careers at ' + company,
      title: 'Build your career with us',
      lead: 'Send your details and resume. HR reads every application and replies to the people who match an open job.',
      steps: [
        { title: 'Send your details', body: 'Fill in the form and attach your resume.' },
        { title: 'HR reviews', body: 'We compare your profile with the open jobs.' },
        { title: 'We get in touch', body: 'Shortlisted people hear from HR by email or phone.' },
      ],
    };
    if (!aside.custom) return standard;
    return {
      kicker: aside.kicker || standard.kicker,
      title: aside.title || standard.title,
      lead: aside.lead || standard.lead,
      steps: standard.steps.map((step, index) => ({ title: aside.steps[index]?.title || step.title, body: aside.steps[index]?.body || step.body })),
    };
  }

  private readFields(raw: string): FormField[] {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return TEMPLATES[0].fields.map((field, index) => normalizeField(field as Record<string, unknown>, index));
      return parsed.filter((item) => item && typeof item === 'object').slice(0, 60).map((item, index) => normalizeField(item as Record<string, unknown>, index));
    } catch {
      return TEMPLATES[0].fields.map((field, index) => normalizeField(field as Record<string, unknown>, index));
    }
  }

  private readFiles(raw: string): StoredFile[] {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed.filter((item) => item && /^[a-f0-9]{18}$/.test(String(item.id)) && /^[a-z]{3,4}$/.test(String(item.ext))) : [];
    } catch {
      return [];
    }
  }

  private readTracking(raw: string): Record<string, string> {
    try {
      const parsed = JSON.parse(raw || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)])) : {};
    } catch {
      return {};
    }
  }

  private readAnswers(raw: string): Record<string, string> {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value ?? '')]));
    } catch {
      return {};
    }
  }

  private async audit(session: SessionUser, action: string, id: string): Promise<void> {
    await this.prisma.auditEvent.create({ data: { companyId: session.companyId, actorId: session.id, action, entity: 'job_form', entityId: id } });
  }
}
