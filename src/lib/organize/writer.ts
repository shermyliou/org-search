import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import type { TableSpec } from './types.ts';

export function buildOrganizedWorkbook(tables: TableSpec[]): ExcelJS.Workbook {
  const output = new ExcelJS.Workbook();
  output.creator = '好事大平台｜任務二資料整理';
  output.calcProperties.fullCalcOnLoad = true;

  for (const table of tables) {
    const sheet = output.addWorksheet(table.name, {
      views: [{ state: 'frozen', ySplit: 1 }],
      properties: { defaultRowHeight: 44 },
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });

    sheet.addTable({
      name: table.table,
      ref: 'A1',
      headerRow: true,
      style: { theme: 'TableStyleMedium2', showRowStripes: false },
      columns: table.headers.map((name) => ({ name, filterButton: true })),
      rows: table.rows,
    });

    assert.equal(table.widths.length, table.headers.length, `Column widths missing for ${table.name}`);
    sheet.columns.forEach((column, i) => {
      column.width = table.widths[i];
    });

    sheet.eachRow((row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: 'Arial', size: 11, color: { argb: 'FF243B3B' } };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: row.number % 2 ? 'FFF0F7F6' : 'FFFFFFFF' },
        };
      });
      row.height = table.name === '整理說明' ? 70 : table.name === '①組織主檔' ? 100 : 76;
    });

    sheet.getRow(1).height = 42;
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF116466' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });

    const dateColumns =
      table.name === '①組織主檔'
        ? [16, 18, 23]
        : table.name === '②③整合紀錄'
          ? [6]
          : table.name === '洞察依據'
            ? [7]
            : table.name === '待確認對應'
              ? [5]
              : [];
    for (const column of dateColumns) {
      sheet.getColumn(column).numFmt = 'yyyy-mm-dd';
    }

    const locatorColumn = table.headers.indexOf('來源定位') + 1;
    if (locatorColumn) {
      for (let row = 2; row <= table.rows.length + 1; row++) {
        const cell = sheet.getRow(row).getCell(locatorColumn);
        const location = String(cell.value);
        const separator = location.lastIndexOf('!');
        cell.value = {
          text: location,
          hyperlink: `${table.sourceFilename}#'${location.slice(0, separator)}'!${location.slice(separator + 1)}`,
        };
        cell.font = { name: 'Arial', size: 11, color: { argb: 'FF007F83' }, underline: true };
      }
    }

    sheet.pageSetup.printTitlesRow = '1:1';
  }

  return output;
}

export async function writeWorkbookBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
