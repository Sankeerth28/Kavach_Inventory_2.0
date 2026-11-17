import { type ReportColumn, type ReportDto, formatReportCell } from '@kavach/shared';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

/**
 * Report files (PRD §19 "Excel/PDF export"). Both are written from the same `ReportDto` the
 * screen shows, so a file never says something the screen does not.
 */

const NUMERIC = new Set<ReportColumn['kind']>(['quantity', 'count']);

function generatedLine(report: ReportDto): string {
  const at = formatReportCell(report.generatedAt, 'datetime', report.timezone);
  return `Generated ${at} (${report.timezone}) by ${report.generatedByName}`;
}

export function reportFileName(report: ReportDto, extension: string): string {
  const day = report.generatedAt.slice(0, 10);
  return `kavach-${report.key}-${day}.${extension}`;
}

export async function reportToXlsx(report: ReportDto): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  book.creator = 'KAVACH';
  book.created = new Date(report.generatedAt);
  const sheet = book.addWorksheet(report.title.slice(0, 31));

  sheet.addRow([report.title]).font = { bold: true, size: 14 };
  sheet.addRow([report.projectName]);
  for (const f of report.filters) sheet.addRow([`${f.label}: ${f.value}`]);
  sheet.addRow([generatedLine(report)]);
  if (report.truncated) {
    sheet.addRow([`Only the first ${report.rows.length} rows are included. Narrow the filters.`]);
  }
  sheet.addRow([]);

  const header = sheet.addRow(report.columns.map((c) => c.label));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EBF0' } };
    cell.border = { bottom: { style: 'thin' } };
  });
  sheet.views = [{ state: 'frozen', ySplit: header.number }];

  for (const row of report.rows) {
    const added = sheet.addRow(
      report.columns.map((c) => {
        const v = row[c.key] ?? null;
        if (v === null || v === '') return null;
        // Excel has no decimal type: quantities become numbers so they can be summed there.
        // The database value stays numeric(18,3); only this file holds a floating-point copy.
        if (NUMERIC.has(c.kind)) return Number(v);
        if (c.kind === 'date' || c.kind === 'datetime') {
          return formatReportCell(v, c.kind, report.timezone);
        }
        // Always a string cell, never a formula: a name starting with "=" stays text.
        return String(v);
      }),
    );
    report.columns.forEach((c, i) => {
      const cell = added.getCell(i + 1);
      if (c.kind === 'quantity') cell.numFmt = '#,##0.###';
      if (NUMERIC.has(c.kind)) cell.alignment = { horizontal: 'right' };
    });
  }

  report.columns.forEach((c, i) => {
    const longest = report.rows.reduce(
      (n, r) => Math.max(n, String(r[c.key] ?? '').length),
      c.label.length,
    );
    sheet.getColumn(i + 1).width = Math.min(45, Math.max(10, longest + 2));
  });

  if (report.notes.length > 0) {
    sheet.addRow([]);
    for (const note of report.notes) sheet.addRow([note]).font = { italic: true, size: 9 };
  }

  return Buffer.from(await book.xlsx.writeBuffer());
}

/** Relative widths: long text columns get more room than numbers and codes. */
function weights(report: ReportDto): number[] {
  return report.columns.map((c) => {
    const longest = report.rows
      .slice(0, 200)
      .reduce((n, r) => Math.max(n, String(r[c.key] ?? '').length), c.label.length);
    const base = Math.min(28, Math.max(6, longest));
    return NUMERIC.has(c.kind) ? Math.min(base, 12) : base;
  });
}

export function reportToPdf(report: ReportDto): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 28,
      bufferPages: true,
      info: { Title: `${report.title} — ${report.projectName}`, Creator: 'KAVACH' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom - 14;
    const w = weights(report);
    const total = w.reduce((a, b) => a + b, 0);
    const widths = w.map((x) => (x / total) * width);
    const size = report.columns.length > 12 ? 6.5 : report.columns.length > 9 ? 7.5 : 8.5;
    const pad = 3;

    doc.font('Helvetica-Bold').fontSize(14).text(report.title, left, doc.page.margins.top);
    doc.font('Helvetica').fontSize(10).text(report.projectName);
    doc.fontSize(8.5).fillColor('#444444');
    doc.text(report.filters.map((f) => `${f.label}: ${f.value}`).join('   ·   '));
    doc.text(generatedLine(report));
    if (report.truncated) {
      doc
        .fillColor('#b91c1c')
        .text(`Only the first ${report.rows.length} rows are included. Narrow the filters.`);
    }
    doc.fillColor('#000000').moveDown(0.6);

    const drawRow = (cells: string[], bold: boolean): void => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      const height =
        Math.max(...cells.map((t, i) => doc.heightOfString(t, { width: widths[i]! - pad * 2 }))) +
        pad * 2;
      if (doc.y + height > bottom()) {
        doc.addPage();
        if (!bold)
          drawRow(
            report.columns.map((c) => c.label),
            true,
          );
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
      }
      const y = doc.y;
      if (bold) doc.rect(left, y, width, height).fill('#e8ebf0').fillColor('#000000');
      let x = left;
      cells.forEach((t, i) => {
        doc.text(t, x + pad, y + pad, {
          width: widths[i]! - pad * 2,
          align: NUMERIC.has(report.columns[i]!.kind) ? 'right' : 'left',
        });
        x += widths[i]!;
      });
      doc
        .moveTo(left, y + height)
        .lineTo(left + width, y + height)
        .lineWidth(0.3)
        .strokeColor('#bbbbbb')
        .stroke();
      doc.y = y + height;
      doc.x = left;
    };

    drawRow(
      report.columns.map((c) => c.label),
      true,
    );
    for (const row of report.rows) {
      drawRow(
        report.columns.map((c) => formatReportCell(row[c.key] ?? null, c.kind, report.timezone)),
        false,
      );
    }
    if (report.rows.length === 0) {
      doc
        .font('Helvetica')
        .fontSize(9)
        .text('No rows for these filters.', left, doc.y + 8);
    }

    if (report.notes.length > 0) {
      doc.moveDown(1).font('Helvetica-Oblique').fontSize(8).fillColor('#444444');
      for (const note of report.notes) doc.text(`• ${note}`, left, undefined, { width });
    }

    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i += 1) {
      doc.switchToPage(pages.start + i);
      doc
        .font('Helvetica')
        .fontSize(7.5)
        .fillColor('#666666')
        .text(
          `KAVACH · ${report.title} · page ${i + 1} of ${pages.count}`,
          left,
          doc.page.height - doc.page.margins.bottom - 8,
          { width, align: 'right', lineBreak: false },
        );
    }
    doc.end();
  });
}
