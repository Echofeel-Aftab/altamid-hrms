import { Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { todayInIndia } from './dates';
import { bag, fail, optional, text } from './http';
import { notifyPerson } from './people-kit';
import { PrismaService } from './prisma.service';
import { SessionUser } from './session';

export const QUESTION_TYPES = ['rating', 'nps', 'choice', 'multi', 'yesno', 'text'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export interface Question { id: string; type: QuestionType; text: string; options: string[]; required: boolean }
export interface Audience { departments: string[] }

/** Results of an anonymous survey stay hidden until this many people answer, so nobody can be singled out. */
const ANON_FLOOR = 3;

@Injectable()
export class SurveyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: AccessService,
  ) {}

  async list(session: SessionUser) {
    const canRun = await this.gates.holds(session, 'surveys');
    const me = session.employeeId ? await this.prisma.employee.findFirst({ where: { id: session.employeeId, companyId: session.companyId }, select: { departmentId: true } }) : null;
    const open = await this.prisma.survey.findMany({ where: { companyId: session.companyId, status: 'open' }, orderBy: { createdAt: 'desc' } });
    const taken = session.employeeId ? new Set((await this.prisma.surveyTaken.findMany({ where: { companyId: session.companyId, employeeId: session.employeeId } })).map((row) => row.surveyId)) : new Set<string>();
    const today = todayInIndia();
    const forMe = open
      .filter((row) => !this.expired(row, today) && this.inAudience(this.audience(row.audienceJson), me?.departmentId || ''))
      .map((row) => ({ ...this.summary(row), taken: taken.has(row.id) }));
    let all: Array<ReturnType<SurveyService['summary']> & { answers: number }> = [];
    if (canRun) {
      const rows = await this.prisma.survey.findMany({ where: { companyId: session.companyId }, orderBy: { createdAt: 'desc' }, take: 100 });
      const counts = await this.prisma.surveyAnswer.groupBy({ by: ['surveyId'], where: { companyId: session.companyId, surveyId: { in: rows.map((row) => row.id) } }, _count: { _all: true } });
      all = rows.map((row) => ({ ...this.summary(row), answers: counts.find((item) => item.surveyId === row.id)?._count._all || 0 }));
    }
    const departments = canRun ? (await this.prisma.department.findMany({ where: { companyId: session.companyId }, orderBy: { name: 'asc' } })).map((row) => ({ id: row.id, name: row.name })) : [];
    return { canRun, forMe, all, departments, types: QUESTION_TYPES, anonFloor: ANON_FLOOR };
  }

  async one(session: SessionUser, id: string) {
    const row = await this.prisma.survey.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) fail(404, 'That survey was not found.');
    const canRun = await this.gates.holds(session, 'surveys');
    if (row.status !== 'open' && !canRun) fail(404, 'That survey is not open.');
    const taken = session.employeeId ? !!(await this.prisma.surveyTaken.findUnique({ where: { surveyId_employeeId: { surveyId: id, employeeId: session.employeeId } } })) : false;
    return { ...this.summary(row), questions: this.questions(row.questionsJson), audience: this.audience(row.audienceJson), taken, canRun };
  }

  async save(session: SessionUser, raw: unknown) {
    await this.gates.gate(session, 'surveys', 'You do not have access to create surveys.');
    const input = bag(raw);
    const id = optional(input.id, 40);
    const existing = id ? await this.prisma.survey.findFirst({ where: { id, companyId: session.companyId } }) : null;
    if (id && !existing) fail(404, 'That survey was not found.');
    if (existing && existing.status !== 'draft') {
      const answers = await this.prisma.surveyAnswer.count({ where: { surveyId: existing.id } });
      if (answers) fail(409, 'People have answered this survey, so its questions cannot change. Copy it into a new survey instead.');
    }
    const questions = this.questionsOf(input.questions);
    const closesOn = optional(input.closesOn, 10);
    if (closesOn && !/^\d{4}-\d{2}-\d{2}$/.test(closesOn)) fail(400, 'Choose a closing date.');
    const departments = Array.isArray(input.departments) ? input.departments.map(String).slice(0, 50) : [];
    const data = {
      title: text(input.title, 'Title', 120),
      intro: optional(input.intro, 1000),
      anonymous: input.anonymous !== false,
      closesOn,
      questionsJson: JSON.stringify(questions),
      audienceJson: JSON.stringify({ departments } satisfies Audience),
    };
    const row = existing
      ? await this.prisma.survey.update({ where: { id: existing.id }, data })
      : await this.prisma.survey.create({ data: { companyId: session.companyId, ...data, createdBy: session.name } });
    return this.one(session, row.id);
  }

  async status(session: SessionUser, id: string, raw: unknown) {
    await this.gates.gate(session, 'surveys', 'You do not have access to run surveys.');
    const row = await this.prisma.survey.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) fail(404, 'That survey was not found.');
    const next = String(bag(raw).status || '');
    if (!['open', 'closed', 'draft'].includes(next)) fail(400, 'Choose open, closed or draft.');
    if (next === 'draft' && (await this.prisma.surveyAnswer.count({ where: { surveyId: id } }))) fail(409, 'People have answered, so it cannot go back to a draft.');
    if (next === 'open' && !this.questions(row.questionsJson).length) fail(400, 'Add at least one question first.');
    const reopen = next === 'open' && row.closesOn && row.closesOn < todayInIndia();
    await this.prisma.survey.update({ where: { id }, data: { status: next, ...(reopen ? { closesOn: '' } : {}) } });
    if (next === 'open' && row.status === 'draft') {
      const audience = this.audience(row.audienceJson);
      const people = await this.prisma.employee.findMany({
        where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] }, ...(audience.departments.length ? { departmentId: { in: audience.departments } } : {}) },
        select: { id: true },
      });
      for (const person of people) {
        await notifyPerson(this.prisma, session.companyId, person.id, { kind: 'survey', title: `New survey: ${row.title}`, body: row.anonymous ? 'Your answers are anonymous.' : 'It takes a few minutes.', link: '/surveys', ref: `survey:${id}:${person.id}` });
      }
    }
    return this.one(session, id);
  }

  async remove(session: SessionUser, id: string) {
    await this.gates.gate(session, 'surveys', 'You do not have access to run surveys.');
    const row = await this.prisma.survey.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) fail(404, 'That survey was not found.');
    if (await this.prisma.surveyAnswer.count({ where: { surveyId: id } })) fail(409, 'People have answered this survey. Close it instead, so the results stay.');
    await this.prisma.survey.delete({ where: { id } });
    return { ok: true };
  }

  async answer(session: SessionUser, id: string, raw: unknown) {
    if (!session.employeeId) fail(400, 'This sign-in is not linked to a person.');
    const row = await this.prisma.survey.findFirst({ where: { id, companyId: session.companyId } });
    if (!row || row.status !== 'open' || this.expired(row, todayInIndia())) fail(404, 'That survey is not open.');
    const person = await this.prisma.employee.findFirst({ where: { id: session.employeeId, companyId: session.companyId }, select: { departmentId: true } });
    if (!this.inAudience(this.audience(row.audienceJson), person?.departmentId || '')) fail(403, 'This survey is for another team.');
    const taken = await this.prisma.surveyTaken.findUnique({ where: { surveyId_employeeId: { surveyId: id, employeeId: session.employeeId } } });
    if (taken) fail(409, 'You have already answered this survey. Thank you.');
    const given = bag(bag(raw).answers);
    const answers: Record<string, unknown> = {};
    for (const question of this.questions(row.questionsJson)) {
      const value = given[question.id];
      const empty = value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);
      if (empty) {
        if (question.required) fail(400, `Answer “${question.text}”.`);
        continue;
      }
      answers[question.id] = this.valueOf(question, value);
    }
    await this.prisma.surveyTaken.create({ data: { companyId: session.companyId, surveyId: id, employeeId: session.employeeId } });
    await this.prisma.surveyAnswer.create({
      data: {
        companyId: session.companyId,
        surveyId: id,
        employeeId: row.anonymous ? '' : session.employeeId,
        departmentId: row.anonymous ? '' : person?.departmentId || '',
        answersJson: JSON.stringify(answers),
      },
    });
    return { ok: true, message: row.anonymous ? 'Thank you. Your answers are anonymous.' : 'Thank you for answering.' };
  }

  async results(session: SessionUser, id: string) {
    await this.gates.gate(session, 'surveys', 'You do not have access to survey results.');
    const row = await this.prisma.survey.findFirst({ where: { id, companyId: session.companyId } });
    if (!row) fail(404, 'That survey was not found.');
    const questions = this.questions(row.questionsJson);
    const answers = await this.prisma.surveyAnswer.findMany({ where: { surveyId: id }, orderBy: { createdAt: 'asc' } });
    const audience = this.audience(row.audienceJson);
    const invited = await this.prisma.employee.count({ where: { companyId: session.companyId, status: { in: ['active', 'onboarding'] }, ...(audience.departments.length ? { departmentId: { in: audience.departments } } : {}) } });
    const hidden = row.anonymous && answers.length < ANON_FLOOR;
    const parsed = answers.map((answer) => {
      try {
        return JSON.parse(answer.answersJson) as Record<string, unknown>;
      } catch {
        return {};
      }
    });
    const names = row.anonymous ? new Map<string, string>() : new Map((await this.prisma.employee.findMany({ where: { companyId: session.companyId, id: { in: answers.map((answer) => answer.employeeId).filter(Boolean) } } })).map((person) => [person.id, `${person.firstName} ${person.lastName}`.trim()]));
    return {
      ...this.summary(row),
      invited,
      answers: answers.length,
      rate: invited ? Math.round(answers.length / invited * 100) : 0,
      hidden,
      anonFloor: ANON_FLOOR,
      questions: hidden ? questions.map((question) => ({ ...question, answered: 0 })) : questions.map((question) => {
        const values = parsed.map((item) => item[question.id]).filter((value) => value !== undefined);
        if (question.type === 'rating' || question.type === 'nps') {
          const max = question.type === 'nps' ? 10 : 5;
          const start = question.type === 'nps' ? 0 : 1;
          const numbers = values.map(Number).filter((value) => Number.isFinite(value));
          const spread = Array.from({ length: max - start + 1 }, (_, index) => ({ label: String(start + index), count: numbers.filter((value) => value === start + index).length }));
          const average = numbers.length ? Math.round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length * 10) / 10 : 0;
          const nps = question.type === 'nps' && numbers.length
            ? Math.round((numbers.filter((value) => value >= 9).length - numbers.filter((value) => value <= 6).length) / numbers.length * 100)
            : null;
          return { ...question, answered: numbers.length, average, spread, nps };
        }
        if (question.type === 'choice' || question.type === 'multi' || question.type === 'yesno') {
          const options = question.type === 'yesno' ? ['Yes', 'No'] : question.options;
          const flat = values.flatMap((value) => Array.isArray(value) ? value.map(String) : [String(value)]);
          return { ...question, answered: values.length, spread: options.map((option) => ({ label: option, count: flat.filter((value) => value === option).length })) };
        }
        const texts = answers.map((answer, index) => ({ text: String(parsed[index][question.id] ?? ''), by: row.anonymous ? '' : names.get(answer.employeeId) || '' })).filter((item) => item.text);
        return { ...question, answered: texts.length, texts: row.anonymous ? [...texts].sort((a, b) => a.text.localeCompare(b.text)) : texts };
      }),
    };
  }

  private valueOf(question: Question, value: unknown): unknown {
    if (question.type === 'rating' || question.type === 'nps') {
      const number = Math.round(Number(value));
      const [low, high] = question.type === 'nps' ? [0, 10] : [1, 5];
      if (!Number.isFinite(number) || number < low || number > high) fail(400, `Answer “${question.text}” from ${low} to ${high}.`);
      return number;
    }
    if (question.type === 'yesno') {
      const answer = String(value);
      if (answer !== 'Yes' && answer !== 'No') fail(400, `Answer “${question.text}” with yes or no.`);
      return answer;
    }
    if (question.type === 'choice') {
      const answer = String(value);
      if (!question.options.includes(answer)) fail(400, `Choose one of the options for “${question.text}”.`);
      return answer;
    }
    if (question.type === 'multi') {
      const list = (Array.isArray(value) ? value : [value]).map(String).filter((item) => question.options.includes(item));
      if (!list.length) fail(400, `Choose at least one option for “${question.text}”.`);
      return [...new Set(list)];
    }
    return optional(value, 2000);
  }

  private questionsOf(value: unknown): Question[] {
    if (!Array.isArray(value)) fail(400, 'Add the questions.');
    if (value.length > 40) fail(400, 'Use at most 40 questions.');
    return value.map((item, index) => {
      const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const type = String(row.type || '') as QuestionType;
      if (!QUESTION_TYPES.includes(type)) fail(400, `Question ${index + 1}: choose a type.`);
      const options = Array.isArray(row.options) ? [...new Set(row.options.map((option) => String(option).trim()).filter(Boolean))].slice(0, 12) : [];
      if ((type === 'choice' || type === 'multi') && options.length < 2) fail(400, `Question ${index + 1}: add at least two options.`);
      return {
        id: optional(row.id, 20) || 'q' + Math.random().toString(36).slice(2, 9),
        type,
        text: text(row.text, `Question ${index + 1}`, 300),
        options: type === 'choice' || type === 'multi' ? options.map((option) => option.slice(0, 120)) : [],
        required: row.required !== false,
      };
    });
  }

  private summary(row: { id: string; title: string; intro: string; anonymous: boolean; status: string; closesOn: string; questionsJson: string; createdAt: Date; createdBy: string }) {
    const expired = this.expired(row, todayInIndia());
    return {
      id: row.id,
      title: row.title,
      intro: row.intro,
      anonymous: row.anonymous,
      status: row.status === 'open' && expired ? 'closed' : row.status,
      closesOn: row.closesOn,
      count: this.questions(row.questionsJson).length,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString().slice(0, 10),
    };
  }

  private expired(row: { closesOn: string }, today: string): boolean {
    return !!row.closesOn && row.closesOn < today;
  }

  private inAudience(audience: Audience, departmentId: string): boolean {
    return !audience.departments.length || audience.departments.includes(departmentId);
  }

  private questions(json: string): Question[] {
    try {
      const parsed = JSON.parse(json || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private audience(json: string): Audience {
    try {
      const parsed = JSON.parse(json || '{}') as Partial<Audience>;
      return { departments: Array.isArray(parsed.departments) ? parsed.departments : [] };
    } catch {
      return { departments: [] };
    }
  }
}
