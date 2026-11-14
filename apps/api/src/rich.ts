import { fail } from './http';

const BLOCK = new Set(['p', 'div', 'br', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'hr']);
const INLINE = new Set(['strong', 'b', 'em', 'i', 'u', 's', 'a', 'span']);
const VOID = new Set(['br', 'hr']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi;

function safeHref(raw: string): string {
  const href = raw.trim().replace(/&amp;/g, '&');
  if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) return href.replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');
  return '';
}

/** Keeps a short allowlist of formatting tags and drops every attribute except a safe link href. */
export function sanitizeRich(input: string): string {
  let html = String(input ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  html = html.replace(/<!--[\s\S]*?-->/g, '').replace(DROP_WITH_CONTENT, '');
  const open: string[] = [];
  const out = html.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>|<|>/g, (match, rawName: string | undefined, attrs: string | undefined) => {
    if (!rawName) return match === '<' ? '&lt;' : '&gt;';
    const name = rawName.toLowerCase();
    const closing = match.startsWith('</');
    if (!BLOCK.has(name) && !INLINE.has(name)) return '';
    const tag = name === 'b' ? 'strong' : name === 'i' ? 'em' : name === 'div' ? 'p' : name;
    if (VOID.has(tag)) return closing ? '' : `<${tag}>`;
    if (closing) {
      const at = open.lastIndexOf(tag);
      if (at < 0) return '';
      const closed = open.splice(at).reverse().map((item) => `</${item}>`).join('');
      return closed;
    }
    if (tag === 'span') {
      open.push(tag);
      return '<span>';
    }
    if (tag === 'a') {
      const found = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs || '');
      const href = safeHref(found ? found[2] ?? found[3] ?? found[4] ?? '' : '');
      open.push('a');
      return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">` : '<a>';
    }
    open.push(tag);
    return `<${tag}>`;
  });
  return (out + open.reverse().map((item) => `</${item}>`).join(''))
    .replace(/<span>([\s\S]*?)<\/span>/g, '$1')
    .replace(/(<p>(\s|&nbsp;|<br>)*<\/p>\s*)+$/g, '')
    .trim();
}

/** Plain text for feeds, notifications, and length checks. */
export function plainOf(html: string): string {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h2|h3|h4|blockquote)>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function richOf(value: unknown, label: string, maxText: number, required: boolean): string {
  const html = sanitizeRich(String(value ?? ''));
  const plain = plainOf(html);
  if (required && !plain) fail(400, `${label} is required.`);
  if (plain.length > maxText) fail(400, `${label} is too long.`);
  if (html.length > maxText * 4) fail(400, `${label} has too much formatting.`);
  return plain ? html : '';
}
