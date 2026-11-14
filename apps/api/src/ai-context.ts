import { FEATURES } from './access.service';
import { MANUAL } from './manual';
import { SessionUser } from './session';

export interface AiScreenContext {
  path: string;
  companyName: string;
  keys: string[];
  rulesSummary: string;
}

/** Compact map of what this sign-in can open — injected every turn. */
export function featureMapPrompt(keys: string[]): string {
  const held = new Set(keys);
  const lines = FEATURES.filter((item) => held.has(item.key) || keys.includes('*')).map(
    (item) => `- ${item.label} (${item.key}): ${item.hint} → typical path in the app`,
  );
  if (!lines.length) return 'This sign-in has limited feature access.';
  return 'Screens this staff may use:\n' + lines.slice(0, 40).join('\n');
}

export function manualTopicsPrompt(keys: string[], role: string, person: boolean): string {
  const held = new Set(keys);
  const reader = {
    keys: held,
    role,
    owner: role === 'owner',
    person,
    master: false,
    payroll: true,
    teamScope: false,
  };
  const topics = MANUAL.filter((section) => !section.when || section.when(reader))
    .slice(0, 25)
    .map((section) => `- ${section.id}: ${section.title}${section.path ? ' (' + section.path + ')' : ''}`);
  return 'User-manual topics available to this sign-in:\n' + topics.join('\n');
}

export function buildSystemPrompt(session: SessionUser, ctx: AiScreenContext): string {
  const parts = [
    'You are the Altamid HRMS assistant for this signed-in staff member only.',
    `Staff: ${session.name} (role ${session.role}${session.employeeId ? ', person linked' : ''}). Company: ${ctx.companyName}.`,
    'Privacy and access (mandatory):',
    '- Only discuss features listed in the access map below. If they ask about something they cannot open, refuse and say which role or Access grant is needed.',
    '- Never invent employee codes, leave balances, salaries, or personal details — use tools.',
    '- Never reveal another person\'s private data unless a tool returns it for this sign-in. Tools already enforce access; if a tool denies access, do not guess.',
    '- Do not talk about other companies, other outlets outside this session scope, or credentials/API keys.',
    'Speak clearly. Prefer short paragraphs and bullet lists. When you suggest a screen, include a path like /leave or /attendance.',
    'For write actions that change records, use confirmation tools and wait for the staff member to confirm in the UI.',
    'When asked for analysis or reports, call tools, then give: (1) findings with numbers, (2) likely causes, (3) concrete next steps.',
    featureMapPrompt(ctx.keys),
    manualTopicsPrompt(ctx.keys, session.role, !!session.employeeId),
    ctx.rulesSummary ? 'Company rules snapshot:\n' + ctx.rulesSummary : '',
    ctx.path ? `Staff is currently on screen path: ${ctx.path}` : '',
  ];
  return parts.filter(Boolean).join('\n\n');
}

export const AI_CHIPS: Array<{ id: string; label: string; prompt: string; need?: string }> = [
  { id: 'how', label: 'How does leave work?', prompt: 'Explain how leave requests and approvals work in this HRMS for my role.' },
  { id: 'rules', label: 'Company rules', prompt: 'Summarise our attendance and leave rules, and any common violations to watch for.' },
  { id: 'violations', label: 'Check violations', prompt: 'Check today for attendance exceptions and pending approvals that may need action. Suggest what to do.', need: 'exceptions' },
  { id: 'today', label: 'My work today', prompt: 'What should I focus on today in the HRMS? Approvals, exceptions, and my own requests.' },
  { id: 'report', label: 'Headcount brief', prompt: 'Give a short people and leave report brief with suggestions.', need: 'reports' },
  { id: 'help', label: 'Find a screen', prompt: 'Where do I manage payroll, holidays, and hiring? List paths I can open.' },
];

export function chipsForAccess(keys: string[], role: string): Array<{ id: string; label: string; prompt: string }> {
  const held = new Set(keys);
  const owner = role === 'owner';
  return AI_CHIPS.filter((chip) => !chip.need || owner || held.has(chip.need)).map(({ id, label, prompt }) => ({ id, label, prompt }));
}
