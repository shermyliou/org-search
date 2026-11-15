import { AssertionError } from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  organizeMission2FromIntermediate,
  verifyOrganizedWorkbook,
} from '../../src/lib/organize/core.ts';
import {
  ApplyRequestSchema,
  ApplyResponseSchema,
  type NoteAnnotation,
  NoteAnnotationSchema,
  type PendingAnnotation,
  PendingAnnotationSchema,
} from '../../src/lib/organize/types.ts';
import { buildOrganizedWorkbook, writeWorkbookBuffer } from '../../src/lib/organize/writer.ts';

function jsonError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}

function outputFilename(sourceFilename: string): string {
  const base = sourceFilename.replace(/\.xlsx$/i, '');
  return `${base}_任務二整理版.xlsx`;
}

async function loadBaselineAnnotations(): Promise<{ notes: NoteAnnotation[]; pending: PendingAnnotation[] }> {
  try {
    const raw = await readFile(join(process.cwd(), 'scripts', 'mission2-annotations.json'), 'utf8');
    const parsed = JSON.parse(raw) as { notes?: unknown; pending?: unknown };
    return {
      notes: z.array(NoteAnnotationSchema).parse(parsed.notes ?? []),
      pending: z.array(PendingAnnotationSchema).parse(parsed.pending ?? []),
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { notes: [], pending: [] };
    }
    throw error;
  }
}

function mergeAnnotations(
  baseline: { notes: NoteAnnotation[]; pending: PendingAnnotation[] },
  overrides: { notes: NoteAnnotation[]; pending: PendingAnnotation[] },
): { notes: NoteAnnotation[]; pending: PendingAnnotation[] } {
  const notesByRow = new Map(baseline.notes.map(note => [note.row, note]));
  for (const note of overrides.notes) notesByRow.set(note.row, note);

  const pendingById = new Map(baseline.pending.map(item => [item.recordId, item]));
  for (const item of overrides.pending) pendingById.set(item.recordId, item);

  return {
    notes: [...notesByRow.values()],
    pending: [...pendingById.values()],
  };
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
    const baseline = await loadBaselineAnnotations();
    const mergedAnnotations = mergeAnnotations(baseline, body.annotations);
    const { snapshot, tables } = organizeMission2FromIntermediate(body.parsed, mergedAnnotations);
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
