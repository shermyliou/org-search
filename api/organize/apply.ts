import { AssertionError } from 'node:assert/strict';
import { z } from 'zod';
import {
  organizeMission2FromIntermediate,
  verifyOrganizedWorkbook,
} from '../../src/lib/organize/core.ts';
import { ApplyRequestSchema, ApplyResponseSchema } from '../../src/lib/organize/types.ts';
import { buildOrganizedWorkbook, writeWorkbookBuffer } from '../../src/lib/organize/writer.ts';

function jsonError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}

function outputFilename(sourceFilename: string): string {
  const base = sourceFilename.replace(/\.xlsx$/i, '');
  return `${base}_任務二整理版.xlsx`;
}

export async function POST(request: Request): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, '請求內容必須為合法的 JSON。');
  }

  try {
    const body = ApplyRequestSchema.parse(rawBody);
    const { snapshot, tables } = organizeMission2FromIntermediate(body.parsed, body.annotations);
    const workbook = buildOrganizedWorkbook(tables);
    verifyOrganizedWorkbook(snapshot, tables, workbook);
    const buffer = await writeWorkbookBuffer(workbook);

    const payload = ApplyResponseSchema.parse({
      ok: true,
      filename: outputFilename(body.parsed.sourceFilename),
      workbookBase64: buffer.toString('base64'),
      snapshot,
    });

    return Response.json(payload);
  } catch (error) {
    if (error instanceof AssertionError || error instanceof z.ZodError) {
      return jsonError(400, error.message);
    }
    const message = error instanceof Error ? error.message : '套用整理結果時發生未預期錯誤。';
    return jsonError(500, message);
  }
}
