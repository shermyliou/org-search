import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import type { ParsedRow, ParsedSheet, ParsedWorkbook, Scalar, SourceCell } from './types.ts';

export function scalarValue(value: ExcelJS.CellValue | undefined): Scalar {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    assert(Number.isFinite(value.getTime()), 'Invalid date');
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if ('richText' in value) {
    return value.richText.map((part) => part.text).join('');
  }
  if ('text' in value) {
    return value.text;
  }
  throw new Error(`Unsupported source cell ${JSON.stringify(value)}`);
}

export function normalizedCell(cell: ExcelJS.Cell): SourceCell {
  const value = cell.value;
  if (value && typeof value === 'object' && 'formula' in value) {
    assert(typeof value.formula === 'string');
    return { formula: value.formula, result: scalarValue(cell.result) };
  }
  return scalarValue(value);
}

export async function readWorkbookFromBuffer(buffer: Uint8Array): Promise<ExcelJS.Workbook> {
  const nodeBuffer = Buffer.from(buffer);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(nodeBuffer.buffer);

  const invalid = new Map<string, ExcelJS.Cell>();
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const v = cell.value;
        if (
          v &&
          typeof v === 'object' &&
          'formula' in v &&
          v.result instanceof Date &&
          !Number.isFinite(v.result.getTime())
        ) {
          invalid.set(`${sheet.name}!${cell.address}`, cell);
        }
      });
    });
  });

  if (invalid.size > 0) {
    // ExcelJS converts text formula caches to Invalid Date when a date format is present.
    const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(nodeBuffer), {
      styles: 'ignore',
      sharedStrings: 'cache',
      hyperlinks: 'ignore',
    });
    for await (const sheet of reader) {
      assert('name' in sheet && typeof sheet.name === 'string', 'Streaming reader missing worksheet name');
      for await (const row of sheet) {
        row.eachCell((cell) => {
          const key = `${sheet.name}!${cell.address}`;
          const target = invalid.get(key);
          if (target) {
            const v = cell.value;
            assert(
              v && typeof v === 'object' && 'formula' in v && typeof v.formula === 'string',
              'Missing original formula cache',
            );
            assert(typeof cell.result === 'string', 'Expected original text cache');
            target.value = { formula: v.formula, result: cell.result };
            invalid.delete(key);
          }
        });
      }
    }
    assert.equal(invalid.size, 0, 'Could not recover original formula text caches');
  }

  return workbook;
}

export async function parseWorkbookBuffer(
  buffer: Uint8Array,
  filename: string,
  sha256?: string,
): Promise<ParsedWorkbook> {
  const sourceSha256 = sha256 ?? createHash('sha256').update(buffer).digest('hex');
  const workbook = await readWorkbookFromBuffer(buffer);
  const sheets: ParsedSheet[] = workbook.worksheets.map((sheet) => {
    const rows: ParsedRow[] = [];
    sheet.eachRow((row) => {
      rows.push({
        row: row.number,
        values: Array.from({ length: row.cellCount }, (_, i) => normalizedCell(row.getCell(i + 1))),
      });
    });
    return { sheet: sheet.name, rows };
  });

  return {
    sourceFilename: filename,
    sourceSha256,
    sheets,
  };
}
