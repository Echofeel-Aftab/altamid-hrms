import PDFDocument from 'pdfkit';
import type { ManualView } from './manual.service';

interface Look {
  primary: string;
  accent: string;
  logo: Buffer | null;
}

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = { top: 64, bottom: 64, left: 54, right: 54 };
const WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const INK = '#1f2a37';
const MUTED = '#5b6776';
const LINE = '#dfe5ec';
const INDEX_ROW = 19;
const INDEX_GROUP = 30;

/** The standard PDF fonts only cover Latin-1 and a few typographic marks. */
function safe(value: string): string {
  return value
    .replace(/→/g, '›')
    .replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff‘’“”–—•…›‹€™]/g, '');
}

export function manualPdf(view: ManualView, look: Look): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: MARGIN,
      bufferPages: true,
      info: { Title: `${view.company} user manual · ${view.roleLabel}`, Author: view.company, Subject: 'HRMS user manual', Creator: 'Altamid HRMS' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const bottom = () => PAGE.height - MARGIN.bottom;
    const page = () => doc.bufferedPageRange().count - 1;
    const room = (height: number) => {
      if (doc.y + height > bottom()) doc.addPage();
    };

    cover(doc, view, look);

    const indexRows = view.index.reduce((sum, block) => sum + 1 + block.items.length, 0);
    const indexFirstRoom = bottom() - (MARGIN.top + 70);
    const indexRoom = bottom() - MARGIN.top;
    const indexHeight = view.index.reduce((sum, block) => sum + INDEX_GROUP + block.items.length * INDEX_ROW, 0);
    const indexPages = Math.max(1, indexRows ? 1 + Math.ceil(Math.max(0, indexHeight - indexFirstRoom) / indexRoom) : 1);
    const indexStart = page() + 1;
    for (let i = 0; i < indexPages; i++) doc.addPage();

    const pageOf = new Map<string, number>();
    for (const block of view.index) {
      doc.addPage();
      const groupOutline = doc.outline.addItem(safe(block.group));
      groupBanner(doc, block.group, look);
      for (const item of block.items) {
        const section = view.sections.find((row) => row.id === item.id);
        if (!section) continue;
        room(150);
        if (doc.y > MARGIN.top + 4) doc.moveDown(0.6);
        pageOf.set(section.id, page());
        doc.addNamedDestination(section.id, 'XYZ', MARGIN.left, PAGE.height - doc.y + 10, null);
        groupOutline.addItem(safe(section.title));
        sectionBlock(doc, section, look, room);
      }
    }

    writeIndex(doc, view, look, indexStart, pageOf);
    footers(doc, view, look);
    doc.end();
  });
}

function cover(doc: PDFKit.PDFDocument, view: ManualView, look: Look): void {
  doc.save();
  doc.rect(0, 0, PAGE.width, 360).fill(look.primary);
  doc.circle(PAGE.width - 40, 40, 170).fillOpacity(0.08).fill('#ffffff');
  doc.circle(70, 360, 120).fillOpacity(0.06).fill('#ffffff');
  doc.fillOpacity(1);
  doc.rect(0, 360, PAGE.width, 6).fill(look.accent);
  doc.restore();

  let y = 70;
  if (look.logo) {
    try {
      doc.save().roundedRect(MARGIN.left, y, 150, 56, 10).fill('#ffffff').restore();
      doc.image(look.logo, MARGIN.left + 12, y + 8, { fit: [126, 40], align: 'center', valign: 'center' });
      y += 86;
    } catch {
      y = wordmark(doc, view, y);
    }
  } else {
    y = wordmark(doc, view, y);
  }

  doc.fillColor(look.accent).font('Helvetica-Bold').fontSize(11).text('HRMS & PAYROLL', MARGIN.left, y + 40, { characterSpacing: 2 });
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(40).text('User manual', MARGIN.left, y + 60);
  doc.font('Helvetica').fontSize(15).fillColor('#dbe6f1').text(safe(`${view.roleLabel} edition`), MARGIN.left, doc.y + 4);

  doc.fillColor(INK).font('Helvetica-Bold').fontSize(13).text('Prepared for', MARGIN.left, 410);
  doc.font('Helvetica').fontSize(13).fillColor(MUTED).text(safe(view.preparedFor), MARGIN.left, doc.y + 2);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('Company', MARGIN.left, doc.y + 14);
  doc.font('Helvetica').fontSize(13).fillColor(MUTED).text(safe(view.company), MARGIN.left, doc.y + 2);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(INK).text('Generated', MARGIN.left, doc.y + 14);
  doc.font('Helvetica').fontSize(13).fillColor(MUTED).text(safe(view.generatedAt), MARGIN.left, doc.y + 2);

  const boxY = 620;
  const count = view.sections.length;
  doc.save().roundedRect(MARGIN.left, boxY, WIDTH, 120, 12).fill('#f4f7fa').restore();
  doc.save().rect(MARGIN.left, boxY, 5, 120).fill(look.accent).restore();
  doc.fillColor(look.primary).font('Helvetica-Bold').fontSize(13).text('What this manual covers', MARGIN.left + 22, boxY + 18);
  doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(
    safe(`${count} topics across ${view.index.map((block) => block.group).join(', ')}. It lists only the screens and actions this access allows, so anything that cannot be opened is left out on purpose. When access changes, download a fresh copy from User manual in the account menu.`),
    MARGIN.left + 22,
    boxY + 40,
    { width: WIDTH - 44, lineGap: 3 },
  );
}

function wordmark(doc: PDFKit.PDFDocument, view: ManualView, y: number): number {
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(safe(view.company), MARGIN.left, y, { width: WIDTH });
  return doc.y + 20;
}

function groupBanner(doc: PDFKit.PDFDocument, group: string, look: Look): void {
  const y = MARGIN.top - 10;
  doc.save().roundedRect(MARGIN.left, y, WIDTH, 46, 10).fill(look.primary).restore();
  doc.save().rect(MARGIN.left, y + 46 - 4, WIDTH, 4).fill(look.accent).restore();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(safe(group), MARGIN.left + 18, y + 13, { width: WIDTH - 36 });
  doc.y = y + 64;
  doc.x = MARGIN.left;
}

function sectionBlock(doc: PDFKit.PDFDocument, section: ManualView['sections'][number], look: Look, room: (height: number) => void): void {
  const x = MARGIN.left;
  const top = doc.y;
  doc.save().rect(x, top, 4, 22).fill(look.accent).restore();
  doc.fillColor(look.primary).font('Helvetica-Bold').fontSize(16).text(safe(section.title), x + 14, top + 2, { width: WIDTH - 14 });
  if (section.menu) {
    doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9.5).text(safe('Where: ' + section.menu), x + 14, doc.y + 2, { width: WIDTH - 14 });
  }
  doc.moveDown(0.5);
  doc.fillColor(INK).font('Helvetica').fontSize(10.5).text(safe(section.why), x, doc.y, { width: WIDTH, lineGap: 2.5 });
  doc.moveDown(0.6);

  if (section.example) {
    doc.font('Helvetica').fontSize(10);
    const text = safe(section.example);
    const height = doc.heightOfString(text, { width: WIDTH - 36, lineGap: 2 }) + 34;
    room(height);
    const boxTop = doc.y;
    doc.save().roundedRect(x, boxTop, WIDTH, height, 8).fill('#fbf6e4').restore();
    doc.save().rect(x, boxTop, 3, height).fill(look.accent).restore();
    doc.fillColor('#7a5c00').font('Helvetica-Bold').fontSize(9).text('EXAMPLE', x + 18, boxTop + 10, { characterSpacing: 1 });
    doc.fillColor(INK).font('Helvetica').fontSize(10).text(text, x + 18, boxTop + 24, { width: WIDTH - 36, lineGap: 2 });
    doc.y = boxTop + height + 10;
  }

  for (const item of section.howTo) {
    room(60);
    doc.fillColor(look.primary).font('Helvetica-Bold').fontSize(11.5).text(safe(item.title), x, doc.y, { width: WIDTH });
    doc.moveDown(0.25);
    if (item.body) {
      doc.fillColor(INK).font('Helvetica').fontSize(10.5).text(safe(item.body), x, doc.y, { width: WIDTH, lineGap: 2 });
      doc.moveDown(0.35);
    }
    item.steps.forEach((step, index) => {
      const text = safe(step);
      doc.font('Helvetica').fontSize(10.5);
      room(doc.heightOfString(text, { width: WIDTH - 26, lineGap: 2 }) + 4);
      const y = doc.y;
      doc.save().circle(x + 8, y + 6, 8).fill('#e9eff6').restore();
      doc.fillColor(look.primary).font('Helvetica-Bold').fontSize(8.5).text(String(index + 1), x, y + 2.2, { width: 16, align: 'center' });
      doc.fillColor(INK).font('Helvetica').fontSize(10.5).text(text, x + 26, y, { width: WIDTH - 26, lineGap: 2 });
      doc.y = Math.max(doc.y, y + 16) + 3;
    });
    doc.moveDown(0.5);
  }

  if (section.tips.length) {
    doc.font('Helvetica').fontSize(10);
    const lines = section.tips.map((tip) => '•  ' + safe(tip));
    const height = lines.reduce((sum, line) => sum + doc.heightOfString(line, { width: WIDTH - 36, lineGap: 2 }) + 3, 0) + 32;
    room(height);
    const boxTop = doc.y;
    doc.save().roundedRect(x, boxTop, WIDTH, height, 8).fill('#eef4fa').restore();
    doc.fillColor(look.primary).font('Helvetica-Bold').fontSize(9).text('GOOD TO KNOW', x + 18, boxTop + 10, { characterSpacing: 1 });
    let y = boxTop + 24;
    for (const line of lines) {
      doc.fillColor(INK).font('Helvetica').fontSize(10).text(line, x + 18, y, { width: WIDTH - 36, lineGap: 2 });
      y = doc.y + 3;
    }
    doc.y = boxTop + height + 6;
  }

  doc.moveDown(0.4);
  doc.save().moveTo(x, doc.y).lineTo(x + WIDTH, doc.y).lineWidth(0.6).strokeColor(LINE).stroke().restore();
  doc.moveDown(0.6);
  doc.x = x;
}

function writeIndex(doc: PDFKit.PDFDocument, view: ManualView, look: Look, start: number, pageOf: Map<string, number>): void {
  let current = start;
  doc.switchToPage(current);
  doc.fillColor(look.primary).font('Helvetica-Bold').fontSize(24).text('Index', MARGIN.left, MARGIN.top);
  doc.fillColor(MUTED).font('Helvetica').fontSize(10).text('Choose a topic to jump to it. Page numbers are at the foot of every page.', MARGIN.left, doc.y + 4);
  let y = MARGIN.top + 70;
  const next = (height: number) => {
    if (y + height > PAGE.height - MARGIN.bottom) {
      current += 1;
      doc.switchToPage(current);
      y = MARGIN.top;
    }
  };
  for (const block of view.index) {
    next(INDEX_GROUP + INDEX_ROW);
    doc.save().rect(MARGIN.left, y + 6, 4, 14).fill(look.accent).restore();
    doc.fillColor(look.primary).font('Helvetica-Bold').fontSize(12.5).text(safe(block.group), MARGIN.left + 12, y + 6, { lineBreak: false });
    y += INDEX_GROUP;
    for (const item of block.items) {
      next(INDEX_ROW);
      const number = String((pageOf.get(item.id) ?? 0) + 1);
      const title = safe(item.title);
      doc.font('Helvetica').fontSize(10.5).fillColor(INK);
      const titleWidth = doc.widthOfString(title);
      const numberWidth = doc.widthOfString(number);
      doc.text(title, MARGIN.left + 12, y, { lineBreak: false });
      const dotsFrom = MARGIN.left + 12 + titleWidth + 6;
      const dotsTo = MARGIN.left + WIDTH - numberWidth - 6;
      if (dotsTo > dotsFrom) {
        doc.save().moveTo(dotsFrom, y + 9).lineTo(dotsTo, y + 9).dash(1, { space: 3 }).lineWidth(0.7).strokeColor('#b7c2ce').stroke().undash().restore();
      }
      doc.fillColor(look.primary).font('Helvetica-Bold').text(number, MARGIN.left + WIDTH - numberWidth, y, { lineBreak: false });
      if (pageOf.has(item.id)) doc.goTo(MARGIN.left + 8, y - 3, WIDTH - 8, INDEX_ROW - 2, item.id);
      y += INDEX_ROW;
    }
  }
}

function footers(doc: PDFKit.PDFDocument, view: ManualView, look: Look): void {
  const range = doc.bufferedPageRange();
  for (let i = 1; i < range.count; i++) {
    doc.switchToPage(i);
    const keep = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = PAGE.height - 40;
    doc.save().moveTo(MARGIN.left, y - 8).lineTo(PAGE.width - MARGIN.right, y - 8).lineWidth(0.6).strokeColor(LINE).stroke().restore();
    doc.fillColor(MUTED).font('Helvetica').fontSize(8.5).text(safe(`${view.company} · User manual · ${view.roleLabel}`), MARGIN.left, y, { width: WIDTH / 2, lineBreak: false });
    doc.fillColor(look.primary).font('Helvetica-Bold').fontSize(8.5).text(`Page ${i + 1} of ${range.count}`, MARGIN.left + WIDTH / 2, y, { width: WIDTH / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = keep;
  }
}
