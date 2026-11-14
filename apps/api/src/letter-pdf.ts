import PDFDocument from 'pdfkit';

export interface LetterLook {
  company: string;
  legalName: string;
  address: string;
  primary: string;
  accent: string;
  logo: Buffer | null;
}

export interface LetterBody {
  title: string;
  reference?: string;
  date: string;
  to?: string[];
  paragraphs: string[];
  /** Rows of a table, such as a settlement or a rewards statement. */
  table?: { head: [string, string]; rows: Array<{ label: string; value: string; strong?: boolean; group?: boolean }> };
  after?: string[];
  sign?: { name: string; title: string };
  footnote?: string;
}

const PAGE = { width: 595.28, height: 841.89 };
const LEFT = 60;
const WIDTH = PAGE.width - LEFT * 2;
const INK = '#1f2a37';
const MUTED = '#5b6776';
const LINE = '#dfe5ec';

/** The standard PDF fonts only cover Latin-1, so the rupee sign becomes Rs. */
export function pdfSafe(value: string): string {
  return value
    .replace(/₹\s?/g, 'Rs. ')
    .replace(/→/g, '>')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff‘’“”–—•…€™]/g, '');
}

export function letterPdf(body: LetterBody, look: LetterLook): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 60, bottom: 60, left: LEFT, right: LEFT }, info: { Title: pdfSafe(body.title), Author: pdfSafe(look.company), Creator: 'Altamid HRMS' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.rect(0, 0, PAGE.width, 6).fill(look.primary);
    doc.rect(0, 6, PAGE.width, 2).fill(look.accent);
    let top = 34;
    if (look.logo) {
      try {
        doc.image(look.logo, LEFT, top, { fit: [120, 44] });
      } catch {
        /* an unreadable logo is left out */
      }
    }
    doc.fillColor(look.primary).font('Helvetica-Bold').fontSize(15).text(pdfSafe(look.company), LEFT, top + 2, { width: WIDTH, align: 'right' });
    doc.fillColor(MUTED).font('Helvetica').fontSize(9);
    if (look.legalName && look.legalName !== look.company) doc.text(pdfSafe(look.legalName), { width: WIDTH, align: 'right' });
    if (look.address) doc.text(pdfSafe(look.address), { width: WIDTH, align: 'right' });
    top = Math.max(doc.y, top + 50) + 14;
    doc.moveTo(LEFT, top).lineTo(LEFT + WIDTH, top).lineWidth(0.8).strokeColor(LINE).stroke();

    doc.y = top + 16;
    doc.fillColor(MUTED).font('Helvetica').fontSize(10);
    const meta = [body.reference ? `Ref: ${body.reference}` : '', `Date: ${body.date}`].filter(Boolean).join('     ');
    doc.text(pdfSafe(meta), LEFT, doc.y, { width: WIDTH, align: 'right' });
    doc.moveDown(1.2);
    if (body.to?.length) {
      doc.fillColor(INK).font('Helvetica').fontSize(10.5);
      for (const line of body.to) doc.text(pdfSafe(line), LEFT);
      doc.moveDown(1);
    }
    doc.fillColor(look.primary).font('Helvetica-Bold').fontSize(14).text(pdfSafe(body.title.toUpperCase()), LEFT, doc.y, { width: WIDTH, align: 'center', characterSpacing: 0.6 });
    doc.moveDown(1);
    doc.fillColor(INK).font('Helvetica').fontSize(10.5);
    for (const paragraph of body.paragraphs) {
      doc.text(pdfSafe(paragraph), LEFT, doc.y, { width: WIDTH, align: 'justify', lineGap: 3 });
      doc.moveDown(0.8);
    }

    if (body.table) {
      doc.moveDown(0.3);
      const valueX = LEFT + WIDTH * 0.62;
      const row = (label: string, value: string, opts: { strong?: boolean; head?: boolean; group?: boolean }) => {
        if (doc.y > PAGE.height - 120) doc.addPage();
        const y = doc.y;
        const height = 20;
        if (opts.head) doc.rect(LEFT, y, WIDTH, height).fill(look.primary);
        else if (opts.group) doc.rect(LEFT, y, WIDTH, height).fill('#f3f6f9');
        doc.fillColor(opts.head ? '#ffffff' : INK).font(opts.strong || opts.head || opts.group ? 'Helvetica-Bold' : 'Helvetica').fontSize(opts.group ? 9.5 : 10);
        doc.text(pdfSafe(label), LEFT + 8, y + 5.5, { width: valueX - LEFT - 16, lineBreak: false, ellipsis: true });
        doc.text(pdfSafe(value), valueX, y + 5.5, { width: LEFT + WIDTH - valueX - 8, align: 'right', lineBreak: false });
        if (!opts.head) doc.moveTo(LEFT, y + height).lineTo(LEFT + WIDTH, y + height).lineWidth(0.5).strokeColor(LINE).stroke();
        doc.y = y + height;
      };
      row(body.table.head[0], body.table.head[1], { head: true });
      for (const line of body.table.rows) row(line.label, line.value, { strong: line.strong, group: line.group });
      doc.moveDown(1.2);
    }

    doc.fillColor(INK).font('Helvetica').fontSize(10.5);
    for (const paragraph of body.after || []) {
      doc.text(pdfSafe(paragraph), LEFT, doc.y, { width: WIDTH, align: 'justify', lineGap: 3 });
      doc.moveDown(0.8);
    }

    if (body.sign) {
      if (doc.y > PAGE.height - 160) doc.addPage();
      doc.moveDown(1.5);
      doc.text(`For ${pdfSafe(look.legalName || look.company)}`, LEFT);
      doc.moveDown(2.6);
      doc.moveTo(LEFT, doc.y).lineTo(LEFT + 170, doc.y).lineWidth(0.6).strokeColor(MUTED).stroke();
      doc.moveDown(0.4);
      doc.font('Helvetica-Bold').text(pdfSafe(body.sign.name), LEFT);
      doc.font('Helvetica').fillColor(MUTED).text(pdfSafe(body.sign.title), LEFT);
    }

    const note = body.footnote || 'This document was generated by Altamid HRMS.';
    doc.page.margins.bottom = 0;
    doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(pdfSafe(note), LEFT, PAGE.height - 48, { width: WIDTH, align: 'center', lineBreak: false });
    doc.end();
  });
}
