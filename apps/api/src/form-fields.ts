import { fail } from './http';

export const FIELD_TYPES = [
  'text', 'email', 'tel', 'url', 'number', 'date', 'textarea', 'select', 'radio', 'checkbox', 'checklist',
  'question', 'terms', 'file', 'heading', 'paragraph',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const WIDTHS = ['full', 'half', 'third', 'quarter', 'wide', 'narrow'] as const;
export type FieldWidth = (typeof WIDTHS)[number];

/** Where an answer lands on the application. Everything else stays in the answers list. */
export const MAPS = ['custom', 'name', 'email', 'phone', 'city', 'resume', 'role', 'note'] as const;
export type FieldMap = (typeof MAPS)[number];

export const ANSWER_MODES = ['radio', 'select', 'text', 'textarea'] as const;
export const FILE_KINDS = ['pdf', 'doc', 'image'] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const LOGIC_OPS = ['equals', 'not_equals', 'checked', 'unchecked'] as const;

export interface ShowWhen {
  field: string;
  op: (typeof LOGIC_OPS)[number];
  values: string[];
}

export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  locked: boolean;
  options: string[];
  placeholder: string;
  help: string;
  width: FieldWidth;
  map: FieldMap;
  /** "jobs" fills a dropdown with the open jobs of the form's outlet. */
  source: '' | 'jobs';
  answerMode: (typeof ANSWER_MODES)[number];
  allowOther: boolean;
  showWhen: ShowWhen | null;
  accept: FileKind[];
  maxFiles: number;
}

const LAYOUT_ONLY = new Set<FieldType>(['heading', 'paragraph']);
const CHOICE_PARENTS = new Set<FieldType>(['select', 'radio', 'checkbox', 'checklist', 'terms']);
const OTHER = '__other__';

export function isLayout(field: FormField): boolean {
  return LAYOUT_ONLY.has(field.type);
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(String(value)) ? (value as T) : fallback;
}

function cleanText(value: unknown, max: number): string {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function keyOf(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
}

/** Fills in every property a stored field may be missing, so old forms keep working. */
export function normalizeField(raw: Record<string, unknown>, index: number): FormField {
  const key = keyOf(raw.key) || 'field_' + (index + 1);
  const type = pick(raw.type, FIELD_TYPES, 'text');
  const legacyMap = (MAPS as readonly string[]).includes(key) ? (key as FieldMap) : 'custom';
  const map = pick(raw.map, MAPS, legacyMap);
  const locked = key === 'name' || key === 'email';
  const rule = raw.showWhen && typeof raw.showWhen === 'object' ? (raw.showWhen as Record<string, unknown>) : null;
  const accept = Array.isArray(raw.accept) ? raw.accept.filter((kind): kind is FileKind => (FILE_KINDS as readonly string[]).includes(String(kind))) : [];
  return {
    key,
    label: cleanText(raw.label, 300) || 'Field',
    type: locked ? (key === 'email' ? 'email' : 'text') : type,
    required: locked ? true : raw.required === true,
    locked,
    options: Array.isArray(raw.options) ? raw.options.map((option) => cleanText(option, 120)).filter(Boolean).slice(0, 40) : [],
    placeholder: cleanText(raw.placeholder, 300),
    help: cleanText(raw.help, 300),
    width: pick(raw.width, WIDTHS, 'full'),
    map: locked ? (key as FieldMap) : map,
    source: raw.source === 'jobs' ? 'jobs' : '',
    answerMode: pick(raw.answerMode, ANSWER_MODES, 'radio'),
    allowOther: raw.allowOther === true,
    showWhen: rule && keyOf(rule.field)
      ? { field: keyOf(rule.field), op: pick(rule.op, LOGIC_OPS, 'equals'), values: Array.isArray(rule.values) ? rule.values.map((value) => cleanText(value, 120)).filter(Boolean).slice(0, 40) : [] }
      : null,
    accept: type === 'file' ? (accept.length ? accept : ['pdf', 'doc']) : [],
    maxFiles: type === 'file' ? Math.min(5, Math.max(1, Math.floor(Number(raw.maxFiles) || 1))) : 0,
  };
}

/** Checks a builder save. Stricter than reading, because this is what visitors will see. */
export function validateFields(value: unknown): FormField[] {
  if (!Array.isArray(value)) fail(400, 'Send the list of fields.');
  if (value.length > 60) fail(400, 'Keep a form to 60 fields or fewer.');
  const fields: FormField[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const field = normalizeField(item as Record<string, unknown>, fields.length);
    if (seen.has(field.key)) fail(400, `Two fields use the name "${field.key}". Give each field its own name.`);
    seen.add(field.key);
    if (!field.label.trim()) fail(400, 'Every field needs a label.');
    fields.push(field);
  }
  if (!fields.some((field) => field.key === 'name') || !fields.some((field) => field.key === 'email')) {
    fail(400, 'The form needs the full name field and the email field. They cannot be removed.');
  }
  const mapped = new Map<string, string>();
  for (const field of fields) {
    if (isLayout(field)) {
      field.required = false;
      field.map = 'custom';
      continue;
    }
    const choices = field.type === 'select' && field.source === 'jobs' ? 2 : needsOptions(field) ? field.options.length : 2;
    if (choices < 2) fail(400, `${field.label} needs at least two choices.`);
    if (field.map !== 'custom') {
      if (mapped.has(field.map)) fail(400, `${mapped.get(field.map)} and ${field.label} both save to the same applicant detail. Set one of them to "Keep as an answer".`);
      mapped.set(field.map, field.label);
    }
    if (field.map === 'resume' && field.type !== 'url' && field.type !== 'file') fail(400, `${field.label} saves the resume, so make it a link or a file upload.`);
    if (field.showWhen) {
      const parent = fields.find((item) => item.key === field.showWhen!.field);
      if (!parent || parent.key === field.key || !isChoiceParent(parent) || loops(fields, parent, field.key)) field.showWhen = null;
    }
  }
  return fields;
}

export function needsOptions(field: FormField): boolean {
  if (field.type === 'select') return field.source !== 'jobs';
  if (field.type === 'radio' || field.type === 'checklist') return true;
  return field.type === 'question' && (field.answerMode === 'radio' || field.answerMode === 'select');
}

export function isChoiceParent(field: FormField): boolean {
  if (CHOICE_PARENTS.has(field.type)) return true;
  return field.type === 'question' && (field.answerMode === 'radio' || field.answerMode === 'select');
}

function loops(fields: FormField[], parent: FormField, childKey: string, seen = new Set<string>()): boolean {
  const rule = parent.showWhen;
  if (!rule) return false;
  if (rule.field === childKey) return true;
  if (seen.has(parent.key)) return false;
  seen.add(parent.key);
  const next = fields.find((item) => item.key === rule.field);
  return next ? loops(fields, next, childKey, seen) : false;
}

/** Whether a visitor sees a field, given the raw answers. A hidden field is never required. */
export function isShown(fields: FormField[], field: FormField, raw: Record<string, unknown>, depth = 0): boolean {
  const rule = field.showWhen;
  if (!rule || depth > 10) return true;
  const parent = fields.find((item) => item.key === rule.field);
  if (!parent || !isShown(fields, parent, raw, depth + 1)) return !parent;
  const answer = raw[parent.key];
  if (rule.op === 'checked') return answer === true || answer === 'true' || answer === 'yes';
  if (rule.op === 'unchecked') return !(answer === true || answer === 'true' || answer === 'yes');
  const given = Array.isArray(answer) ? answer.map(String) : [String(answer ?? '')];
  if (!rule.values.length) return true;
  const hit = given.some((value) => rule.values.includes(value));
  return rule.op === 'equals' ? hit : !hit;
}

/** Turns one raw answer into stored text, or fails with a message the visitor can act on. */
export function answerOf(field: FormField, raw: Record<string, unknown>, other: Record<string, unknown>, jobs: string[]): string {
  const value = raw[field.key];
  const label = field.label.length > 60 ? 'This answer' : field.label;
  const lower = label.toLowerCase();
  if (field.type === 'checkbox' || field.type === 'terms') {
    const ticked = value === true || value === 'true' || value === 'yes';
    if (field.required && !ticked) fail(400, field.type === 'terms' ? `Tick "${label}" to send the form.` : `Tick ${lower} to continue.`);
    return ticked ? 'Yes' : '';
  }
  if (field.type === 'checklist') {
    const list = Array.isArray(value) ? value.map((item) => String(item)) : [];
    const chosen = list.filter((item) => field.options.includes(item));
    if (field.required && !chosen.length) fail(400, `Choose at least one option for ${lower}.`);
    return chosen.join(', ');
  }
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  if (field.required && !text) fail(400, `${label} is required.`);
  if (!text) return '';
  if (text.length > 4000) fail(400, `${label} is too long.`);
  const fromJobs = field.type === 'select' && field.source === 'jobs';
  if (fromJobs && !jobs.length) return text.slice(0, 120);
  const choiceList = fromJobs ? jobs : field.options;
  if (field.type === 'select' || field.type === 'radio' || (field.type === 'question' && (field.answerMode === 'radio' || field.answerMode === 'select'))) {
    if (text === OTHER && field.type === 'question' && field.allowOther) {
      const typed = cleanText(other[field.key], 600);
      if (!typed) fail(400, `Type your answer for ${lower}.`);
      return 'Other: ' + typed;
    }
    if (!choiceList.includes(text)) fail(400, `Choose a valid option for ${lower}.`);
    return text;
  }
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) fail(400, `Enter a valid ${lower}.`);
  if (field.type === 'tel' && !/^\+?[0-9][0-9\s().-]{5,22}$/.test(text)) fail(400, `Enter a valid ${lower}.`);
  if (field.type === 'url' && !/^https?:\/\/[^\s]+$/i.test(text)) fail(400, `${label} must start with http:// or https://.`);
  if (field.type === 'number' && !/^-?\d{1,12}(\.\d{1,4})?$/.test(text)) fail(400, `${label} must be a number.`);
  if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(400, `Choose a date for ${lower}.`);
  return text;
}

export const OTHER_VALUE = OTHER;
