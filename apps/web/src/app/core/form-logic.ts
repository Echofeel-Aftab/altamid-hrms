export type FieldType =
  | 'text' | 'email' | 'tel' | 'url' | 'number' | 'date' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'checklist'
  | 'question' | 'terms' | 'file' | 'heading' | 'paragraph';
export type FieldWidth = 'full' | 'half' | 'third' | 'quarter' | 'wide' | 'narrow';
export type FileKind = 'pdf' | 'doc' | 'image';
export type LogicOp = 'equals' | 'not_equals' | 'checked' | 'unchecked';

export interface ShowWhen { field: string; op: LogicOp; values: string[] }

export interface FormFieldDef {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  locked?: boolean;
  options: string[];
  placeholder: string;
  help: string;
  width: FieldWidth;
  map?: string;
  source?: '' | 'jobs';
  answerMode: 'radio' | 'select' | 'text' | 'textarea';
  allowOther: boolean;
  showWhen: ShowWhen | null;
  accept: FileKind[];
  maxFiles: number;
}

export const OTHER_VALUE = '__other__';

export function isLayout(field: Pick<FormFieldDef, 'type'>): boolean {
  return field.type === 'heading' || field.type === 'paragraph';
}

export function isChoiceParent(field: FormFieldDef): boolean {
  if (['select', 'radio', 'checkbox', 'checklist', 'terms'].includes(field.type)) return true;
  return field.type === 'question' && (field.answerMode === 'radio' || field.answerMode === 'select');
}

export function needsOptions(field: FormFieldDef): boolean {
  if (field.type === 'select') return field.source !== 'jobs';
  if (field.type === 'radio' || field.type === 'checklist') return true;
  return field.type === 'question' && (field.answerMode === 'radio' || field.answerMode === 'select');
}

export function isTicked(value: unknown): boolean {
  return value === true || value === 'true' || value === 'yes';
}

/** Same rule as the server: a field whose parent is hidden is hidden too. */
export function isShown(fields: FormFieldDef[], field: FormFieldDef, answers: Record<string, unknown>, depth = 0): boolean {
  const rule = field.showWhen;
  if (!rule || depth > 10) return true;
  const parent = fields.find((item) => item.key === rule.field);
  if (!parent) return true;
  if (!isShown(fields, parent, answers, depth + 1)) return false;
  const answer = answers[parent.key];
  if (rule.op === 'checked') return isTicked(answer);
  if (rule.op === 'unchecked') return !isTicked(answer);
  if (!rule.values.length) return true;
  const given = Array.isArray(answer) ? answer.map(String) : [String(answer ?? '')];
  const hit = given.some((value) => rule.values.includes(value));
  return rule.op === 'equals' ? hit : !hit;
}

export const ACCEPT_ATTR: Record<FileKind, string> = {
  pdf: '.pdf,application/pdf',
  doc: '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  image: '.png,.jpg,.jpeg,image/png,image/jpeg',
};
