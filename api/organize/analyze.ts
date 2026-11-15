import { AssertionError } from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { extractDelta, extractMasterOrgs } from '../../src/lib/organize/core.ts';
import { generateDeltaDrafts } from '../../src/lib/organize/llm.ts';
import { parseWorkbookBuffer } from '../../src/lib/organize/parser.ts';
import {
  AnalyzeResponseSchema,
  type NoteAnnotation,
  NoteAnnotationSchema,
  type PendingAnnotation,
  PendingAnnotationSchema,
} from '../../src/lib/organize/types.ts';

const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;

const BaselineSchema = z.object({
  notes: z.array(NoteAnnotationSchema),
  pending: z.array(PendingAnnotationSchema),
});

function jsonError(status: number, error: string): Response {
  return Response.json({ ok: false, error }, { status });
}

async function loadBaseline(): Promise<{ notes: NoteAnnotation[]; pending: PendingAnnotation[] }> {
  const baselinePath = join(process.cwd(), 'scripts', 'mission2-annotations.json');
  try {
    const raw = await readFile(baselinePath, 'utf8');
    return BaselineSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return { notes: [], pending: [] };
    }
    throw error;
  }
}

export async function POST(request: Request): Promise<Response> {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(400, '請以 multipart/form-data 上傳 .xlsx 檔案。');
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return jsonError(400, '缺少上傳檔案欄位 file。');
  }

  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    return jsonError(400, '僅支援 .xlsx 格式的 Excel 檔案。');
  }

  if (file.size === 0) {
    return jsonError(400, '上傳的檔案不可為空。');
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return jsonError(413, '檔案大小不可超過 4 MB。');
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const parsed = await parseWorkbookBuffer(bytes, file.name, sha256);
    const baseline = await loadBaseline();
    const masterOrgs = extractMasterOrgs(parsed);
    const delta = extractDelta(parsed, baseline);

    if (delta.notes.length > 0 || delta.pending.length > 0) {
      const llmResult = await generateDeltaDrafts(delta, masterOrgs);
      if (llmResult.available) {
        for (const note of delta.notes) {
          const draft = llmResult.noteDrafts.get(note.row);
          if (draft) {
            note.aiDraft = draft;
          }
        }
        for (const pending of delta.pending) {
          const draft = llmResult.pendingDrafts.get(pending.recordId);
          if (draft) {
            pending.aiDraft = draft;
          }
        }
      }
    }

    const responsePayload = AnalyzeResponseSchema.parse({
      sourceFilename: parsed.sourceFilename,
      sourceSha256: parsed.sourceSha256,
      masterOrgs,
      delta,
      parsed,
    });

    return Response.json(responsePayload);
  } catch (error) {
    if (error instanceof AssertionError || error instanceof z.ZodError) {
      return jsonError(400, error.message);
    }
    const message = error instanceof Error ? error.message : '分析檔案時發生未預期錯誤。';
    return jsonError(500, message);
  }
}
