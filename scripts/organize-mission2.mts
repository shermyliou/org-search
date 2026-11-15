import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  organizeMission2FromIntermediate,
  verifyOrganizedWorkbook,
} from '../src/lib/organize/core.ts';
import { parseWorkbookBuffer, readWorkbookFromBuffer } from '../src/lib/organize/parser.ts';
import { NoteAnnotationSchema, PendingAnnotationSchema } from '../src/lib/organize/types.ts';
import { buildOrganizedWorkbook, writeWorkbookBuffer } from '../src/lib/organize/writer.ts';

const sourceName = '好事_示範資料_v2_確認版.xlsx';
const outputName = '好事_示範資料_v2_任務二整理版.xlsx';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({
  options: {
    source: { type: 'string' },
    'out-dir': { type: 'string' },
    'overwrite-generated': { type: 'boolean' },
    check: { type: 'boolean' },
  },
});

const sourcePath = resolve(args.source ?? join(root, sourceName));
const outDir = resolve(args['out-dir'] ?? root);
const outputPath = join(outDir, outputName);
const jsonPath = join(outDir, 'data', 'mission2.json');

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const sourceBytes = await readFile(sourcePath);
const initialHash = hash(sourceBytes);
assert.notEqual(await realpath(sourcePath), resolve(outputPath), 'Refusing to overwrite source');
for (const target of [outputPath, jsonPath]) {
  try {
    assert.notEqual(await realpath(target), await realpath(sourcePath), 'Output resolves to source');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
}

const parsed = await parseWorkbookBuffer(sourceBytes, basename(sourcePath), initialHash);
const AnnotationsFileSchema = z.object({
  notes: z.array(NoteAnnotationSchema),
  pending: z.array(PendingAnnotationSchema),
});
const annotations = AnnotationsFileSchema.parse(
  JSON.parse(await readFile(join(root, 'scripts', 'mission2-annotations.json'), 'utf8')),
);

const { snapshot, tables } = organizeMission2FromIntermediate(parsed, annotations);
const contactsCount = snapshot.records.filter((r) => r.kind === '接觸紀錄').length;
const notesCount = snapshot.records.filter((r) => r.kind === '顧問筆記').length;
const pendingCount = snapshot.records.filter((r) => r.status === 'pending').length;

if (args.check) {
  const json: unknown = JSON.parse(await readFile(jsonPath, 'utf8'));
  assert.deepEqual(json, snapshot, 'JSON differs from maintained inputs');
  const output = await readWorkbookFromBuffer(await readFile(outputPath));
  verifyOrganizedWorkbook(snapshot, tables, output);
  assert.equal(hash(await readFile(sourcePath)), initialHash, 'Source changed while checking');
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        mode: 'check',
        organizations: snapshot.organizations.length,
        records: snapshot.records.length,
        contacts: contactsCount,
        notes: notesCount,
        pending: pendingCount,
        insights: snapshot.insights.length,
        sourceSha256: initialHash,
        verified: 'all JSON, source fields, workbook cells and all organizations formula results',
      },
      null,
      2,
    )}\n`,
  );
} else {
  if (!args['overwrite-generated']) {
    for (const path of [outputPath, jsonPath]) {
      let exists = true;
      try {
        await access(path);
      } catch {
        exists = false;
      }
      assert(!exists, `Generated output exists: ${path}. Use --overwrite-generated to regenerate.`);
    }
  }
  const output = buildOrganizedWorkbook(tables);
  const workbookBuffer = await writeWorkbookBuffer(output);
  await mkdir(join(outDir, 'data'), { recursive: true });
  await writeFile(outputPath, workbookBuffer);
  await writeFile(jsonPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  assert.equal(hash(await readFile(sourcePath)), initialHash, 'Source changed while generating');
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        mode: 'generate',
        workbook: outputPath,
        json: jsonPath,
        organizations: snapshot.organizations.length,
        records: snapshot.records.length,
        insights: snapshot.insights.length,
        pending: pendingCount,
        sourceSha256: initialHash,
      },
      null,
      2,
    )}\n`,
  );
}
