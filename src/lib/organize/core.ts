import assert from 'node:assert/strict';
import type ExcelJS from 'exceljs';
import { scalarValue } from './parser.ts';
import type {
  Association,
  HistoryRecord,
  Insight,
  MasterOrgSummary,
  Mission2Snapshot,
  NoteAnnotation,
  NoteDeltaItem,
  Organization,
  OrgId,
  ParsedSheet,
  ParsedWorkbook,
  PendingAnnotation,
  PendingDeltaItem,
  Scalar,
  Source,
  SourceCell,
  TableSpec,
} from './types.ts';

export const MASTER_HEADERS = [
  '組織編號',
  '統一編號（虛構）',
  '組織名稱',
  '一句話簡介',
  '議題',
  '服務對象',
  '區域',
  '成立年',
  '入會年',
  '會籍',
  '全職人數',
  '財報類型',
  '桑基圖上架',
  '陪跑分級',
  '接觸紀錄筆數',
  '最近一次接觸',
  '顧問筆記筆數',
];

export const CONTACT_HEADERS = [
  '紀錄編號',
  '組織編號',
  '日期',
  '接觸類型',
  '活動或事件名稱',
  '參與者職稱',
  '組織名稱（填寫者自填）',
  '留下的話／紀錄內容',
  '資料來源',
];

export const NOTE_HEADERS = ['組織編號', '日期', '記錄者', '筆記'];

const HISTORY_HEADERS = [
  '整合紀錄編號',
  '紀錄種類',
  '組織編號（已確認）',
  '候選組織編號（待確認）',
  '對應狀態',
  '日期',
  '接觸類型',
  '活動或事件名稱',
  '參與者職稱',
  '組織名稱（填寫者自填）',
  '留下的話／紀錄內容',
  '資料來源',
  '記錄者',
  '原始紀錄編號',
  '原始組織編號',
  '原始分頁',
  '原始列號',
  '來源定位',
  '對應說明',
  '筆記完整性',
];

const EXTRA_HEADERS = [
  '最近資料日期',
  '服務對象（含筆記）',
  '議題補充（待確認推論）',
  '顧問筆記主題',
  '最新顧問筆記原文',
  '筆記日期',
  '記錄者',
  '顧問行動／建議原文',
  '已確認自填別名',
  '資料提醒',
  '來源定位',
];

const INSIGHT_HEADERS = [
  '組織編號',
  '整合紀錄編號',
  '補充欄位',
  '整理內容',
  '依據類型',
  '顧問原文引句',
  '筆記日期',
  '記錄者',
  '原始分頁',
  '原始列號',
  '來源定位',
];

const PENDING_HEADERS = [
  '原始紀錄編號',
  '原始組織編號（空白）',
  '候選組織編號',
  '填寫者自填名稱',
  '日期',
  '狀態',
  '人工語意建議理由',
  '審核責任人',
  '確認方式',
  '原始分頁',
  '原始列號',
  '來源定位',
];

const GUIDE_HEADERS = ['項目', '整理說明', '來源／執行方式'];

function isOrgId(value: unknown): value is OrgId {
  return typeof value === 'string' && /^H\d{2}$/.test(value);
}

function parseOrgId(value: unknown): OrgId {
  assert(isOrgId(value), `Invalid organization ID ${String(value)}`);
  return value;
}

function text(value: SourceCell | undefined): string {
  assert(
    value === undefined || value === null || typeof value === 'string',
    `Expected text, got ${JSON.stringify(value)}`,
  );
  return value ?? '';
}

function dateString(value: SourceCell | undefined): string {
  const result = text(value);
  assert(
    /^\d{4}-\d{2}-\d{2}$/.test(result) && new Date(result).toISOString().slice(0, 10) === result,
    `Invalid date ${result}`,
  );
  return result;
}

function latest(records: HistoryRecord[]): string | null {
  return records.map((record) => record.date).sort().at(-1) ?? null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function sourceRows(sheets: ParsedSheet[], sheetName: string, headers: string[]): Source[] {
  const sheet = sheets.find((item) => item.sheet === sheetName);
  assert(sheet, `Missing sheet ${sheetName}`);
  assert.deepEqual(sheet.rows[0]?.values, headers, `Header mismatch ${sheetName}`);
  return sheet.rows.slice(1).map((row) => ({ sheet: sheetName, ...row }));
}

function extractNoteRows(sheets: ParsedSheet[]): { notes: Source[]; footer: Source } {
  const noteRows = sourceRows(sheets, '③顧問筆記', NOTE_HEADERS);
  const footer = noteRows.find((row) => text(row.values[0]).startsWith('說明：真實情況中，'));
  assert(footer, 'Unexpected note footer');
  assert(footer.values.slice(1).every((value) => value === null), 'Unexpected note footer');
  return {
    notes: noteRows.filter((row) => row !== footer),
    footer,
  };
}

function validateMasters(masters: Source[]): Set<OrgId> {
  assert(masters.length > 0, 'No organizations in source');
  const orgIds = new Set(masters.map((source) => parseOrgId(source.values[0])));
  assert.equal(orgIds.size, masters.length, 'Duplicate organization IDs');
  return orgIds;
}

export function extractMasterOrgs(parsed: ParsedWorkbook): MasterOrgSummary[] {
  const masters = sourceRows(parsed.sheets, '①組織主檔', MASTER_HEADERS);
  validateMasters(masters);
  return masters.map((source) => ({
    id: parseOrgId(source.values[0]),
    name: text(source.values[2]),
    introduction: text(source.values[3]),
    issue: text(source.values[4]),
    audience: text(source.values[5]),
  }));
}

export function extractDelta(
  parsed: ParsedWorkbook,
  baseline: { notes: NoteAnnotation[]; pending: PendingAnnotation[] },
): { notes: NoteDeltaItem[]; pending: PendingDeltaItem[] } {
  const masters = sourceRows(parsed.sheets, '①組織主檔', MASTER_HEADERS);
  const orgIds = validateMasters(masters);
  const contacts = sourceRows(parsed.sheets, '②接觸紀錄', CONTACT_HEADERS);
  const { notes } = extractNoteRows(parsed.sheets);

  const knownId = (value: unknown): OrgId => {
    const id = parseOrgId(value);
    assert(orgIds.has(id), `Unknown organization ${id}`);
    return id;
  };

  const baselineNotesByRow = new Map(baseline.notes.map((item) => [item.row, item]));
  const noteDeltas: NoteDeltaItem[] = [];

  for (const source of notes) {
    const v = source.values;
    const id = knownId(v[0]);
    const date = dateString(v[1]);
    const author = text(v[2]);
    const noteText = text(v[3]);
    const existing = baselineNotesByRow.get(source.row);

    if (existing && existing.orgId === id && existing.expectedText === noteText) {
      continue;
    }

    noteDeltas.push({
      row: source.row,
      orgId: id,
      date,
      author,
      text: noteText,
      kind: existing ? 'modified' : 'new',
      previousExpectedText: existing ? existing.expectedText : null,
      aiDraft: {
        themes: [],
        actionQuote: '',
        audiences: [],
        issueSuggestions: [],
        incomplete: false,
      },
    });
  }

  const baselinePendingById = new Map(baseline.pending.map((item) => [item.recordId, item]));
  const pendingDeltas: PendingDeltaItem[] = [];

  for (const source of contacts) {
    const v = source.values;
    const recordId = text(v[0]);
    assert(/^R\d{4}$/.test(recordId), 'Invalid contact record ID');
    if (v[1] !== null) {
      knownId(v[1]);
      continue;
    }

    const submittedName = text(v[6]);
    const existing = baselinePendingById.get(recordId);
    if (existing && existing.row === source.row && existing.expectedName === submittedName) {
      continue;
    }

    pendingDeltas.push({
      recordId,
      row: source.row,
      date: dateString(v[2]),
      contactType: text(v[3]),
      eventName: text(v[4]),
      submittedName,
      text: text(v[7]),
      aiDraft: {
        candidateOrgId: null,
        reason: '',
      },
    });
  }

  return { notes: noteDeltas, pending: pendingDeltas };
}

export function organizeMission2FromIntermediate(
  parsed: ParsedWorkbook,
  annotationsInput: { notes: NoteAnnotation[]; pending: PendingAnnotation[] },
): { snapshot: Mission2Snapshot; tables: TableSpec[] } {
  const masters = sourceRows(parsed.sheets, '①組織主檔', MASTER_HEADERS);
  const contacts = sourceRows(parsed.sheets, '②接觸紀錄', CONTACT_HEADERS);
  const { notes, footer } = extractNoteRows(parsed.sheets);
  const orgIds = validateMasters(masters);

  const knownId = (value: unknown): OrgId => {
    const id = parseOrgId(value);
    assert(orgIds.has(id), `Unknown organization ${id}`);
    return id;
  };

  const annotations = annotationsInput.notes.map((a) => ({
    ...a,
    orgId: knownId(a.orgId),
  }));
  const pendingAnnotations = annotationsInput.pending.map((a) => ({
    ...a,
    candidateOrgId: a.candidateOrgId === null ? null : knownId(a.candidateOrgId),
  }));

  assert.equal(annotations.length, notes.length);
  assert.equal(new Set(annotations.map((a) => a.row)).size, annotations.length);

  const missingIdCount = contacts.filter((source) => source.values[1] === null).length;
  assert.equal(pendingAnnotations.length, missingIdCount);
  assert.equal(new Set(pendingAnnotations.map((a) => a.recordId)).size, pendingAnnotations.length);

  const records: HistoryRecord[] = contacts.map((source) => {
    const v = source.values;
    const id = text(v[0]);
    assert(/^R\d{4}$/.test(id), 'Invalid contact record ID');
    const originalOrgId = v[1] === null ? null : knownId(v[1]);
    const pending = pendingAnnotations.find((a) => a.recordId === id);
    let association: Association;

    if (originalOrgId) {
      assert(!pending, 'Confirmed ID must not have a pending annotation');
      association = { status: 'confirmed', orgId: originalOrgId, candidateOrgId: null, reason: '' };
    } else {
      assert(pending, `Missing pending annotation ${id}`);
      assert.equal(pending.row, source.row);
      assert.equal(pending.expectedName, text(v[6]));
      association = {
        status: 'pending',
        orgId: null,
        candidateOrgId: pending.candidateOrgId,
        reason: pending.reason,
      };
    }

    return {
      ...association,
      id,
      originalRecordId: id,
      originalOrgId,
      kind: '接觸紀錄',
      date: dateString(v[2]),
      contactType: text(v[3]),
      eventName: text(v[4]),
      participantTitle: text(v[5]),
      submittedName: text(v[6]),
      text: text(v[7]),
      dataSource: text(v[8]),
      author: '',
      incomplete: false,
      source,
    };
  });

  const insights: Insight[] = [];
  for (const source of notes) {
    const v = source.values;
    const id = knownId(v[0]);
    const annotation = annotations.find((a) => a.row === source.row);
    assert(annotation, `Missing annotation row ${source.row}`);
    assert.equal(annotation.orgId, id);
    assert.equal(annotation.expectedText, text(v[3]), `Annotation drift row ${source.row}`);
    assert(
      !annotation.actionQuote || annotation.expectedText.includes(annotation.actionQuote),
      'Action must quote literal note',
    );
    assert(
      !annotation.incomplete ||
        (!annotation.themes.length &&
          !annotation.actionQuote &&
          !annotation.audiences.length &&
          !annotation.issueSuggestions.length),
      'Do not infer from incomplete note',
    );

    const recordDate = dateString(v[1]);
    const record: HistoryRecord = {
      id: `N-${id}-${recordDate}`,
      originalRecordId: null,
      originalOrgId: id,
      kind: '顧問筆記',
      date: recordDate,
      contactType: '',
      eventName: '',
      participantTitle: '',
      submittedName: '',
      text: text(v[3]),
      dataSource: '顧問筆記',
      author: text(v[2]),
      incomplete: annotation.incomplete,
      source,
      status: 'confirmed',
      orgId: id,
      candidateOrgId: null,
      reason: '',
    };
    records.push(record);

    const base = {
      recordId: record.id,
      orgId: id,
      quote: record.text,
      date: record.date,
      author: record.author,
      sourceSheet: source.sheet,
      sourceRow: source.row,
    };

    if (annotation.incomplete) {
      insights.push({
        ...base,
        field: '資料提醒',
        value: '筆記不完整，待補寫',
        basis: '顧問原文明述',
      });
    } else {
      insights.push({
        ...base,
        field: '顧問筆記主題',
        value: annotation.themes.join('、'),
        basis: '整理者推論待確認',
      });
    }

    for (const audience of annotation.audiences) {
      assert(record.text.includes(audience), 'Audience must be stated in original note');
      insights.push({
        ...base,
        field: '服務對象（含筆記）',
        value: audience,
        basis: '顧問原文明述',
      });
    }

    for (const issue of annotation.issueSuggestions) {
      insights.push({
        ...base,
        field: '議題補充（待確認推論）',
        value: issue,
        basis: '整理者推論待確認',
      });
    }

    if (annotation.actionQuote) {
      insights.push({
        ...base,
        field: '顧問行動／建議原文',
        value: annotation.actionQuote,
        basis: '顧問原文明述',
      });
    }
  }

  assert.equal(records.length, contacts.length + notes.length);
  assert.equal(
    new Set(records.map((r) => r.id)).size,
    records.length,
    'Duplicate record IDs or generated note ID collision',
  );
  assert.equal(records.filter((r) => r.status === 'pending').length, pendingAnnotations.length);

  records.sort(
    (a, b) =>
      (a.orgId ?? 'ZZ').localeCompare(b.orgId ?? 'ZZ') ||
      a.date.localeCompare(b.date) ||
      a.id.localeCompare(b.id),
  );

  const organizations: Organization[] = masters.map((source) => {
    const id = knownId(source.values[0]);
    const history = records.filter((record) => record.orgId === id);
    const pending = records.filter((record) => record.candidateOrgId === id);
    const orgNotes = history.filter((record) => record.kind === '顧問筆記');
    const orgContacts = history.filter((record) => record.kind === '接觸紀錄');
    const related = insights.filter((insight) => insight.orgId === id);
    const aliases = unique(orgContacts.map((record) => record.submittedName));
    const audiences = unique([
      text(source.values[5]),
      ...related.filter((i) => i.field === '服務對象（含筆記）').map((i) => i.value),
    ]);
    const issueSuggestions = related
      .filter((i) => i.field === '議題補充（待確認推論）')
      .map((i) => ({ value: i.value, basis: i.basis, recordId: i.recordId }));
    const reminders = [
      ...(!orgNotes.length ? ['無顧問筆記，僅代表尚未記錄'] : []),
      ...(orgNotes.some((r) => r.incomplete) ? ['顧問筆記不完整，請原記錄者補寫'] : []),
      ...(source.values[10] === null ? ['全職人數未填'] : []),
      ...(pending.length ? ['有待確認對應紀錄，未計入正式歷史與別名'] : []),
      ...(orgNotes.length ? ['顧問觀察為當時紀錄，邀請前請再確認現況'] : []),
    ];

    return {
      id,
      name: text(source.values[2]),
      introduction: text(source.values[3]),
      issue: text(source.values[4]),
      originalAudience: text(source.values[5]),
      audiences,
      issueSuggestions,
      aliases,
      sourceFields: Object.fromEntries(
        MASTER_HEADERS.slice(0, 14).map((key, i) => [key, source.values[i] ?? null]),
      ),
      source,
      originalMetrics: Object.fromEntries(
        MASTER_HEADERS.slice(14).map((key, i) => [key, source.values[i + 14] ?? null]),
      ),
      recordIds: history.map((r) => r.id),
      candidateRecordIds: pending.map((r) => r.id),
      metrics: {
        contactCount: orgContacts.length,
        latestContact: latest(orgContacts),
        noteCount: orgNotes.length,
        latestData: latest(history),
      },
      noteThemes: unique(
        related.filter((i) => i.field === '顧問筆記主題').map((i) => i.value),
      ),
      latestNote: orgNotes.at(-1) ?? null,
      actions: related.filter((i) => i.field === '顧問行動／建議原文'),
      reminders,
      searchText: [
        ...source.values.slice(0, 14),
        ...aliases,
        ...audiences,
        ...history.map((r) => [r.eventName, r.text, r.author].join(' ')),
        ...related.map((i) => i.value),
      ].join(' '),
    };
  });

  const snapshot: Mission2Snapshot = {
    schemaVersion: 1,
    source: {
      filename: parsed.sourceFilename,
      sha256: parsed.sourceSha256,
    },
    sourceCells: parsed.sheets,
    organizations,
    records,
    insights,
  };

  const historyValues: ExcelJS.CellValue[][] = records.map((r) => [
    r.id,
    r.kind,
    r.orgId,
    r.candidateOrgId,
    r.status === 'confirmed' ? '已確認' : '待會員管理經理確認',
    new Date(r.date),
    r.contactType,
    r.eventName,
    r.participantTitle,
    r.submittedName,
    r.text,
    r.dataSource,
    r.author,
    r.originalRecordId,
    r.originalOrgId,
    r.source.sheet,
    r.source.row,
    `${r.source.sheet}!A${r.source.row}`,
    r.reason,
    r.kind === '顧問筆記' ? (r.incomplete ? '不完整，待補寫' : '完整') : null,
  ]);

  const historyLast = records.length + 1;
  const historyRange = (col: string) => `'②③整合紀錄'!$${col}$2:$${col}$${historyLast}`;
  const excelDate = (value: string | null) => (value ? new Date(value) : '');

  const masterValues: ExcelJS.CellValue[][] = organizations.map((org, index) => {
    const row = index + 2;
    const criteria = `${historyRange('C')},A${row}`;
    const count = (kind: string) => `COUNTIFS(${criteria},${historyRange('B')},"${kind}")`;
    const contactCount = count('接觸紀錄');
    const values: ExcelJS.CellValue[] = [
      ...org.source.values.slice(0, 14).map((value) => {
        assert(typeof value !== 'object' || value === null, 'Unexpected master input formula');
        return value;
      }),
    ];
    values.push(
      { formula: contactCount, result: org.metrics.contactCount },
      {
        formula: `IF(O${row}=0,"",_xlfn.MAXIFS(${historyRange('F')},${criteria},${historyRange('B')},"接觸紀錄"))`,
        result: excelDate(org.metrics.latestContact),
      },
      { formula: count('顧問筆記'), result: org.metrics.noteCount },
      {
        formula: `IF(O${row}+Q${row}=0,"",_xlfn.MAXIFS(${historyRange('F')},${criteria}))`,
        result: excelDate(org.metrics.latestData),
      },
      org.audiences.join('、'),
      org.issueSuggestions.map((i) => `${i.value}（整理者推論，待確認）`).join('、'),
      org.noteThemes.join('、'),
      org.latestNote?.text ?? '',
      excelDate(org.latestNote?.date ?? null),
      org.latestNote?.author ?? '',
      org.actions.map((a) => `${a.date}｜${a.value}`).join('\n'),
      org.aliases.join('\n'),
      org.reminders.join('\n'),
      `${org.source.sheet}!A${org.source.row}`,
    );
    return values;
  });

  const insightValues: ExcelJS.CellValue[][] = insights.map((i) => [
    i.orgId,
    i.recordId,
    i.field,
    i.value,
    i.basis,
    i.quote,
    new Date(i.date),
    i.author,
    i.sourceSheet,
    i.sourceRow,
    `${i.sourceSheet}!A${i.sourceRow}`,
  ]);

  const pendingValues: ExcelJS.CellValue[][] = records
    .filter((r) => r.status === 'pending')
    .map((r) => [
      r.id,
      r.originalOrgId,
      r.candidateOrgId,
      r.submittedName,
      new Date(r.date),
      '待確認，未計入正式統計',
      r.reason,
      '會員管理經理',
      '核對真實組織名稱、統編或原報名者；確認後在來源②補組織編號',
      r.source.sheet,
      r.source.row,
      `${r.source.sheet}!A${r.source.row}`,
    ]);

  const guideValues: ExcelJS.CellValue[][] = [
    [
      '用途',
      '任務二：接電話的新同事先以組織主檔查基本資料，再篩選整合紀錄了解歷史。未來桌面小工具以組織編號建立詳細頁，本次僅整理資料。',
      '④任務卡!A9:B13',
    ],
    [
      '資料性質',
      '此為虛構示範資料。組織名稱、統編及案例不可用於真實決策。',
      parsed.sourceFilename,
    ],
    [
      '維護原則',
      '來源 Excel 與 scripts/mission2-annotations.json 為維護輸入；本整理版 Excel 與 data/mission2.json 為同次產生的快照，無即時同步。請勿直接修改快照作為長期資料來源。',
      '來源①②③ → 整理腳本 → Excel／JSON',
    ],
    [
      '組織數',
      {
        formula: `COUNTA('①組織主檔'!A2:A${organizations.length + 1})`,
        result: organizations.length,
      },
      `來源①組織主檔第${masters.map((s) => s.row).join('、')}列，前14個輸入欄完整保留。`,
    ],
    [
      '整合紀錄數',
      { formula: `COUNTA('②③整合紀錄'!A2:A${historyLast})`, result: records.length },
      `來源②接觸紀錄第${contacts.at(0)?.row}至${contacts.at(-1)?.row}列，③顧問筆記第${notes.map((s) => s.row).join('、')}列；③第${footer.row}列說明文字不算紀錄。`,
    ],
    [
      '接觸紀錄數',
      {
        formula: `COUNTIF('②③整合紀錄'!B2:B${historyLast},"接觸紀錄")`,
        result: contacts.length,
      },
      '接觸資料原始九欄完整保留，另加來源、確認狀態與候選欄。',
    ],
    [
      '顧問筆記數',
      {
        formula: `COUNTIF('②③整合紀錄'!B2:B${historyLast},"顧問筆記")`,
        result: notes.length,
      },
      '顧問筆記保留原文、日期、記錄者；新編號 N-組織編號-日期，原始紀錄編號空白。',
    ],
    [
      '待確認對應數',
      {
        formula: `COUNTA('待確認對應'!A2:A${Math.max(2, pendingValues.length + 1)})`,
        result: pendingValues.length,
      },
      '候選為整理者語意建議，未確認前組織編號仍空白，不納正式統計、別名或搜尋文字；請會員管理經理核對。',
    ],
    [
      '統計規則',
      '接觸筆數／最近一次接觸只算已確認接觸紀錄；顧問筆記筆數只算筆記；最近資料日期納入兩類。公式參照快照實際範圍，新增來源資料後須重新產生。',
      '①主檔 O:R；最近接觸與最近資料日期依各自納入的紀錄計算。',
    ],
    [
      '分類規則',
      '原始議題與服務對象保留。顧問明述的服務對象另加入服務對象；整理者推論的議題標為待確認，非正式分類或永久分類。',
      '③顧問筆記；洞察依據保留原文、日期及來源定位，可追溯。',
    ],
    [
      '筆記主題與行動',
      '財務、行銷、主管支持等放入顧問筆記主題，不當作組織服務議題。主題為整理者摘要；行動／建議保留原文，包含已完成的轉介。',
      '所有判斷保留日期、記錄者與原文；邀請前須再確認現況。',
    ],
    [
      '缺漏處理',
      `筆記未完成：${records.filter((r) => r.incomplete).map((r) => r.orgId).join('、') || '無'}，無推測需求或建議。全職人數未填：${organizations.filter((o) => o.sourceFields.全職人數 === null).map((o) => o.id).join('、') || '無'}。無顧問筆記僅代表未記錄；非會員無入會年屬預期，不補造資料。`,
      '由原記錄者補寫筆記；基本欄位由會員管理同事核實。',
    ],
    [
      '尚缺資料',
      '本檔沒有聯絡人姓名、電話、email，也沒有明年課程表。無法直接回答未來財務課程時程。',
      '會員管理同事維護聯絡資料；培力 PM 維護正式課程表。',
    ],
    [
      '日常更新',
      '在來源①維護組織輸入欄，②新增接觸並填穩定組織編號，③補完整筆記及日期／記錄者。待確認對應核實後在來源②填編號並移除 annotations.pending 對應項目。',
      '新筆記需同步新增註解，expectedText 必須與原文完全一致；來源文字改動會使腳本明確失敗。',
    ],
    [
      '重新產生',
      'pnpm install；pnpm run data:organize --overwrite-generated；pnpm run build；pnpm run data:check',
      'Node.js 24+；來源檔、整理檔置於同資料夾，來源定位連結使用相對檔名。',
    ],
    [
      '指定路徑',
      'pnpm run data:organize --source /完整路徑/來源.xlsx --out-dir /輸出資料夾 --overwrite-generated',
      'data:check 可使用相同 --source、--out-dir；只檢查不寫入。',
    ],
    [
      '公式重算',
      'Excel 或 LibreOffice 可重算公式；檢查腳本會重開檔案比對全部組織的筆數、最近日期及全部原文。',
      '輸出含快取值；重算後再執行 data:check 可驗證試算表引擎結果。',
    ],
    [
      '來源定位',
      '每筆歷史、洞察與待確認對應均保留原始分頁及列號，點選來源定位可開啟原始資料。',
      '不複製原始分頁；原始檔保持不變。',
    ],
  ];

  const tables: TableSpec[] = [
    {
      name: '整理說明',
      table: 'Mission2Guide',
      headers: GUIDE_HEADERS,
      rows: guideValues,
      widths: [24, 95, 80],
      sourceFilename: parsed.sourceFilename,
    },
    {
      name: '①組織主檔',
      table: 'Mission2Organizations',
      headers: [...MASTER_HEADERS, ...EXTRA_HEADERS],
      rows: masterValues,
      widths: [
        14, 20, 24, 49, 18, 23, 12, 12, 12, 16, 12, 20, 23, 14, 16, 20, 16, 20, 35, 35, 40, 70,
        18, 18, 60, 50, 58, 28,
      ],
      sourceFilename: parsed.sourceFilename,
    },
    {
      name: '②③整合紀錄',
      table: 'Mission2History',
      headers: HISTORY_HEADERS,
      rows: historyValues,
      widths: [25, 16, 22, 25, 26, 18, 22, 45, 20, 48, 82, 26, 20, 20, 18, 22, 14, 30, 75, 22],
      sourceFilename: parsed.sourceFilename,
    },
    {
      name: '洞察依據',
      table: 'Mission2Insights',
      headers: INSIGHT_HEADERS,
      rows: insightValues,
      widths: [14, 25, 30, 48, 24, 88, 18, 20, 22, 14, 30],
      sourceFilename: parsed.sourceFilename,
    },
    {
      name: '待確認對應',
      table: 'Mission2Pending',
      headers: PENDING_HEADERS,
      rows: pendingValues,
      widths: [20, 26, 22, 46, 18, 30, 90, 22, 75, 22, 14, 30],
      sourceFilename: parsed.sourceFilename,
    },
  ];

  return { snapshot, tables };
}

function evaluatedCell(cell: ExcelJS.Cell): Scalar {
  const value = cell.value;
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    return scalarValue(cell.result);
  }
  return scalarValue(value);
}

function expectedCellValue(value: ExcelJS.CellValue): Scalar {
  if (value && typeof value === 'object' && 'formula' in value) {
    return scalarValue(value.result);
  }
  return scalarValue(value);
}

export function verifyOrganizedWorkbook(
  snapshot: Mission2Snapshot,
  tables: TableSpec[],
  workbook: ExcelJS.Workbook,
): void {
  assert.deepEqual(
    workbook.worksheets.map((s) => s.name),
    tables.map((t) => t.name),
    'Unexpected worksheets',
  );

  const masterSheet = workbook.getWorksheet('①組織主檔');
  assert(masterSheet, 'Missing ①組織主檔 worksheet');
  assert.equal(
    masterSheet.actualRowCount,
    snapshot.organizations.length + 1,
    'Organization row count mismatch',
  );

  for (const table of tables) {
    const sheet = workbook.getWorksheet(table.name);
    assert(sheet, `Missing worksheet ${table.name}`);
    assert.equal(sheet.actualRowCount, table.rows.length + 1, `Row count ${table.name}`);
    assert.deepEqual(
      table.headers.map((_, i) => evaluatedCell(sheet.getRow(1).getCell(i + 1))),
      table.headers,
      `Headers ${table.name}`,
    );

    for (const [r, values] of table.rows.entries()) {
      for (const [c, value] of values.entries()) {
        const cell = sheet.getRow(r + 2).getCell(c + 1);
        const actual = evaluatedCell(cell);
        const expected = expectedCellValue(value);
        assert.equal(
          actual === '' ? null : actual,
          expected === '' ? null : expected,
          `Mismatch ${table.name}!${cell.address}`,
        );
        if (value && typeof value === 'object' && 'formula' in value) {
          assert(cell.formula, 'Expected live formula');
        }
      }
    }
  }
}
