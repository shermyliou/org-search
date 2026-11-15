import ExcelJS from 'exceljs';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, access, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';

type Scalar = string | number | boolean | null;
type SourceCell = Scalar | { formula: string; result: Scalar };
type SourceRow = { row: number; values: SourceCell[] };
type OrgId = string & { readonly __brand: 'OrgId' };
type Source = { sheet: string; row: number; values: SourceCell[] };
type NoteAnnotation = { row: number; orgId: OrgId; expectedText: string; themes: string[]; actionQuote: string; audiences: string[]; issueSuggestions: string[]; incomplete: boolean };
type PendingAnnotation = { recordId: string; row: number; candidateOrgId: OrgId; expectedName: string; reason: string };
type Association = { status: 'confirmed'; orgId: OrgId; candidateOrgId: null; reason: '' } | { status: 'pending'; orgId: null; candidateOrgId: OrgId; reason: string };
type HistoryRecord = { id: string; originalRecordId: string | null; originalOrgId: OrgId | null; kind: '接觸紀錄' | '顧問筆記'; date: string; contactType: string; eventName: string; participantTitle: string; submittedName: string; text: string; dataSource: string; author: string; incomplete: boolean; source: Source } & Association;
type Insight = { recordId: string; orgId: OrgId; field: string; value: string; basis: '顧問原文明述' | '整理者推論待確認'; quote: string; date: string; author: string; sourceSheet: string; sourceRow: number };
const sourceName = '好事_示範資料_v2_確認版.xlsx';
const outputName = '好事_示範資料_v2_任務二整理版.xlsx';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values: args } = parseArgs({ options: { source: { type: 'string' }, 'out-dir': { type: 'string' }, 'overwrite-generated': { type: 'boolean' }, check: { type: 'boolean' } } });
const sourcePath = resolve(args.source ?? join(root, sourceName));
const outDir = resolve(args['out-dir'] ?? root);
const outputPath = join(outDir, outputName);
const jsonPath = join(outDir, 'data', 'mission2.json');
const masterHeaders = ['組織編號','統一編號（虛構）','組織名稱','一句話簡介','議題','服務對象','區域','成立年','入會年','會籍','全職人數','財報類型','桑基圖上架','陪跑分級','接觸紀錄筆數','最近一次接觸','顧問筆記筆數'];
const contactHeaders = ['紀錄編號','組織編號','日期','接觸類型','活動或事件名稱','參與者職稱','組織名稱（填寫者自填）','留下的話／紀錄內容','資料來源'];
const noteHeaders = ['組織編號','日期','記錄者','筆記'];
function isObject(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function object(value: unknown): Record<string, unknown> { assert(isObject(value), 'Expected object'); return value; }
function string(value: unknown): string { assert(typeof value === 'string', 'Expected string'); return value; }
function number(value: unknown): number { assert(typeof value === 'number', 'Expected number'); assert(Number.isFinite(value)); return value; }
function strings(value: unknown): string[] { assert(Array.isArray(value)); return value.map(string); }
function isOrgId(value: unknown): value is OrgId { return typeof value === 'string' && /^H\d{2}$/.test(value); }
function orgId(value: unknown): OrgId { assert(isOrgId(value), `Invalid organization ID ${String(value)}`); return value; }
function scalar(value: ExcelJS.CellValue | undefined): Scalar {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) { assert(Number.isFinite(value.getTime()), 'Invalid date'); return value.toISOString().slice(0,10); }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if ('richText' in value) return value.richText.map(part => part.text).join('');
  if ('text' in value) return value.text;
  throw new Error(`Unsupported source cell ${JSON.stringify(value)}`);
}
function normalized(cell: ExcelJS.Cell): SourceCell {
  const value=cell.value;
  if (value && typeof value === 'object' && 'formula' in value) { assert(typeof value.formula==='string');return { formula: value.formula, result: scalar(cell.result) }; }
  return scalar(value);
}
function text(value: SourceCell | undefined): string { assert(value === undefined || value === null || typeof value === 'string', `Expected text, got ${JSON.stringify(value)}`); return value ?? ''; }
function date(value: SourceCell | undefined): string { const result = text(value); assert(/^\d{4}-\d{2}-\d{2}$/.test(result) && new Date(result).toISOString().slice(0,10) === result, `Invalid date ${result}`); return result; }
function latest(records: HistoryRecord[]): string | null { return records.map(record=>record.date).sort().at(-1) ?? null; }
function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function readWorkbook(path:string):Promise<ExcelJS.Workbook> {
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(path);
  const invalid=new Map<string,ExcelJS.Cell>();
  workbook.eachSheet(sheet=>sheet.eachRow(row=>row.eachCell(cell=>{const v=cell.value;if(v&&typeof v==='object'&&'formula' in v&&v.result instanceof Date&&!Number.isFinite(v.result.getTime()))invalid.set(`${sheet.name}!${cell.address}`,cell);}))); 
  if(invalid.size) {
    // ExcelJS converts text formula caches to Invalid Date when a date format is present.
    for await(const sheet of new ExcelJS.stream.xlsx.WorkbookReader(path,{styles:'ignore',sharedStrings:'cache',hyperlinks:'ignore'})) {
      assert('name' in sheet&&typeof sheet.name==='string','Streaming reader missing worksheet name');
      for await(const row of sheet) row.eachCell(cell=>{const key=`${sheet.name}!${cell.address}`;const target=invalid.get(key);if(target){const v=cell.value;assert(v&&typeof v==='object'&&'formula' in v&&typeof v.formula==='string','Missing original formula cache');assert(typeof cell.result==='string','Expected original text cache');target.value={formula:v.formula,result:cell.result};invalid.delete(key);}});
    }
    assert.equal(invalid.size,0,'Could not recover original formula text caches');
  }
  return workbook;
}
const initialHash = hash(await readFile(sourcePath));
assert.notEqual(await realpath(sourcePath), resolve(outputPath), 'Refusing to overwrite source');
for (const target of [outputPath, jsonPath]) {
  try { assert.notEqual(await realpath(target), await realpath(sourcePath), 'Output resolves to source'); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
}
const input = await readWorkbook(sourcePath);
const sourceCells = input.worksheets.map(sheet => { const rows: SourceRow[] = []; sheet.eachRow(row=>rows.push({ row: row.number, values: Array.from({length: row.cellCount},(_,i)=>normalized(row.getCell(i+1))) })); return { sheet: sheet.name, rows }; });
function sourceRows(sheetName: string, headers: string[]): Source[] {
  const sheet = sourceCells.find(sheet=>sheet.sheet===sheetName); assert(sheet, `Missing sheet ${sheetName}`);
  assert.deepEqual(sheet.rows[0]?.values, headers, `Header mismatch ${sheetName}`);
  return sheet.rows.slice(1).map(row=>({ sheet: sheetName, ...row }));
}
const masters = sourceRows('①組織主檔',masterHeaders);
const contacts = sourceRows('②接觸紀錄',contactHeaders);
const noteRows = sourceRows('③顧問筆記',noteHeaders);
const footer = noteRows.find(row=>text(row.values[0]).startsWith('說明：真實情況中，'));
assert(footer && footer.values.slice(1).every(value=>value===null), 'Unexpected note footer');
const notes = noteRows.filter(row=>row!==footer);
assert(masters.length>0,'No organizations in source');
const orgIds = new Set(masters.map(source=>orgId(source.values[0]))); assert.equal(orgIds.size,masters.length,'Duplicate organization IDs');
function knownId(value: unknown): OrgId { const id = orgId(value); assert(orgIds.has(id),`Unknown organization ${id}`); return id; }
const annotationInput = object(JSON.parse(await readFile(join(root,'scripts','mission2-annotations.json'),'utf8')));
assert(Array.isArray(annotationInput.notes)); assert(Array.isArray(annotationInput.pending));
const annotations: NoteAnnotation[] = annotationInput.notes.map((value: unknown)=>{
  const a = object(value); assert.equal(typeof a.incomplete,'boolean');
  return { row: number(a.row), orgId: knownId(a.orgId), expectedText: string(a.expectedText), themes: strings(a.themes), actionQuote: string(a.actionQuote), audiences: strings(a.audiences), issueSuggestions: strings(a.issueSuggestions), incomplete: a.incomplete === true };
});
const pendingAnnotations: PendingAnnotation[] = annotationInput.pending.map((value: unknown)=>{ const a=object(value); return { recordId:string(a.recordId), row:number(a.row),candidateOrgId:knownId(a.candidateOrgId),expectedName:string(a.expectedName),reason:string(a.reason) }; });
assert.equal(annotations.length,notes.length); assert.equal(new Set(annotations.map(a=>a.row)).size,annotations.length);
const missingIdCount=contacts.filter(source=>source.values[1]===null).length;
assert.equal(pendingAnnotations.length,missingIdCount); assert.equal(new Set(pendingAnnotations.map(a=>a.recordId)).size,pendingAnnotations.length);
const records: HistoryRecord[] = contacts.map(source=>{
  const v=source.values; const id=text(v[0]); assert(/^R\d{4}$/.test(id),'Invalid contact record ID'); const originalOrgId=v[1]===null?null:knownId(v[1]);
  const pending=pendingAnnotations.find(a=>a.recordId===id);
  let association: Association;
  if (originalOrgId) { assert(!pending,'Confirmed ID must not have a pending annotation'); association={status:'confirmed',orgId:originalOrgId,candidateOrgId:null,reason:''}; }
  else { assert(pending,`Missing pending annotation ${id}`); assert.equal(pending.row,source.row); assert.equal(pending.expectedName,text(v[6])); association={status:'pending',orgId:null,candidateOrgId:pending.candidateOrgId,reason:pending.reason}; }
  return { ...association,id,originalRecordId:id,originalOrgId,kind:'接觸紀錄',date:date(v[2]),contactType:text(v[3]),eventName:text(v[4]),participantTitle:text(v[5]),submittedName:text(v[6]),text:text(v[7]),dataSource:text(v[8]),author:'',incomplete:false,source };
});
const insights: Insight[]=[];
for (const source of notes) {
  const v=source.values; const id=knownId(v[0]); const annotation=annotations.find(a=>a.row===source.row); assert(annotation,`Missing annotation row ${source.row}`);
  assert.equal(annotation.orgId,id); assert.equal(annotation.expectedText,text(v[3]),`Annotation drift row ${source.row}`);
  assert(!annotation.actionQuote || annotation.expectedText.includes(annotation.actionQuote),'Action must quote literal note');
  assert(!annotation.incomplete || (!annotation.themes.length && !annotation.actionQuote && !annotation.audiences.length && !annotation.issueSuggestions.length),'Do not infer from incomplete note');
  const record: HistoryRecord={id:`N-${id}-${date(v[1])}`,originalRecordId:null,originalOrgId:id,kind:'顧問筆記',date:date(v[1]),contactType:'',eventName:'',participantTitle:'',submittedName:'',text:text(v[3]),dataSource:'顧問筆記',author:text(v[2]),incomplete:annotation.incomplete,source,status:'confirmed',orgId:id,candidateOrgId:null,reason:''};
  records.push(record);
  const base={recordId:record.id,orgId:id,quote:record.text,date:record.date,author:record.author,sourceSheet:source.sheet,sourceRow:source.row};
  if(annotation.incomplete) insights.push({...base,field:'資料提醒',value:'筆記不完整，待補寫',basis:'顧問原文明述'});
  else insights.push({...base,field:'顧問筆記主題',value:annotation.themes.join('、'),basis:'整理者推論待確認'});
  for (const audience of annotation.audiences) { assert(record.text.includes(audience),'Audience must be stated in original note'); insights.push({...base,field:'服務對象（含筆記）',value:audience,basis:'顧問原文明述'}); }
  for (const issue of annotation.issueSuggestions) insights.push({...base,field:'議題補充（待確認推論）',value:issue,basis:'整理者推論待確認'});
  if(annotation.actionQuote) insights.push({...base,field:'顧問行動／建議原文',value:annotation.actionQuote,basis:'顧問原文明述'});
}
assert.equal(records.length,contacts.length+notes.length); assert.equal(new Set(records.map(r=>r.id)).size,records.length,'Duplicate record IDs or generated note ID collision');
assert.equal(records.filter(r=>r.status==='pending').length,pendingAnnotations.length);
records.sort((a,b)=>(a.orgId??'ZZ').localeCompare(b.orgId??'ZZ')||a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
const organizations=masters.map(source=>{
  const id=knownId(source.values[0]); const history=records.filter(record=>record.orgId===id); const pending=records.filter(record=>record.candidateOrgId===id); const notes=history.filter(record=>record.kind==='顧問筆記'); const contacts=history.filter(record=>record.kind==='接觸紀錄'); const related=insights.filter(insight=>insight.orgId===id);
  const aliases=unique(contacts.map(record=>record.submittedName)); const audiences=unique([text(source.values[5]),...related.filter(i=>i.field==='服務對象（含筆記）').map(i=>i.value)]);
  const issueSuggestions=related.filter(i=>i.field==='議題補充（待確認推論）').map(i=>({value:i.value,basis:i.basis,recordId:i.recordId}));
  const reminders=[...(!notes.length?['無顧問筆記，僅代表尚未記錄']:[]),...(notes.some(r=>r.incomplete)?['顧問筆記不完整，請原記錄者補寫']:[]),...(source.values[10]===null?['全職人數未填']:[]),...(pending.length?['有待確認對應紀錄，未計入正式歷史與別名']:[]),...(notes.length?['顧問觀察為當時紀錄，邀請前請再確認現況']:[])];
  return {id,name:text(source.values[2]),introduction:text(source.values[3]),issue:text(source.values[4]),originalAudience:text(source.values[5]),audiences,issueSuggestions,aliases,sourceFields:Object.fromEntries(masterHeaders.slice(0,14).map((key,i)=>[key,source.values[i]??null])),source,originalMetrics:Object.fromEntries(masterHeaders.slice(14).map((key,i)=>[key,source.values[i+14]??null])),recordIds:history.map(r=>r.id),candidateRecordIds:pending.map(r=>r.id),metrics:{contactCount:contacts.length,latestContact:latest(contacts),noteCount:notes.length,latestData:latest(history)},noteThemes:unique(related.filter(i=>i.field==='顧問筆記主題').map(i=>i.value)),latestNote:notes.at(-1)??null,actions:related.filter(i=>i.field==='顧問行動／建議原文'),reminders,searchText:[...source.values.slice(0,14),...aliases,...audiences,...history.map(r=>[r.eventName,r.text,r.author].join(' ')),...related.map(i=>i.value)].join(' ')};
});
const snapshot={schemaVersion:1,source:{filename:basename(sourcePath),sha256:initialHash},sourceCells,organizations,records,insights};
const historyHeaders=['整合紀錄編號','紀錄種類','組織編號（已確認）','候選組織編號（待確認）','對應狀態','日期','接觸類型','活動或事件名稱','參與者職稱','組織名稱（填寫者自填）','留下的話／紀錄內容','資料來源','記錄者','原始紀錄編號','原始組織編號','原始分頁','原始列號','來源定位','對應說明','筆記完整性'];
const historyValues=records.map(r=>[r.id,r.kind,r.orgId,r.candidateOrgId,r.status==='confirmed'?'已確認':'待會員管理經理確認',new Date(r.date),r.contactType,r.eventName,r.participantTitle,r.submittedName,r.text,r.dataSource,r.author,r.originalRecordId,r.originalOrgId,r.source.sheet,r.source.row,`${r.source.sheet}!A${r.source.row}`,r.reason,r.kind==='顧問筆記'?(r.incomplete?'不完整，待補寫':'完整'):null]);
const extraHeaders=['最近資料日期','服務對象（含筆記）','議題補充（待確認推論）','顧問筆記主題','最新顧問筆記原文','筆記日期','記錄者','顧問行動／建議原文','已確認自填別名','資料提醒','來源定位'];
const historyLast=records.length+1;
const historyRange=(col:string)=>`'②③整合紀錄'!$${col}$2:$${col}$${historyLast}`;
const excelDate=(value:string|null)=>value?new Date(value):'';
const masterValues=organizations.map((org,index)=>{
  const row=index+2; const criteria=`${historyRange('C')},A${row}`;
  const count=(kind:string)=>`COUNTIFS(${criteria},${historyRange('B')},"${kind}")`;
  const contactCount=count('接觸紀錄');
  const values: ExcelJS.CellValue[]=[...org.source.values.slice(0,14).map(value=>{assert(typeof value!=='object'||value===null,'Unexpected master input formula');return value;})];
  values.push({formula:contactCount,result:org.metrics.contactCount},{formula:`IF(O${row}=0,"",_xlfn.MAXIFS(${historyRange('F')},${criteria},${historyRange('B')},"接觸紀錄"))`,result:excelDate(org.metrics.latestContact)},{formula:count('顧問筆記'),result:org.metrics.noteCount},{formula:`IF(O${row}+Q${row}=0,"",_xlfn.MAXIFS(${historyRange('F')},${criteria}))`,result:excelDate(org.metrics.latestData)},org.audiences.join('、'),org.issueSuggestions.map(i=>`${i.value}（整理者推論，待確認）`).join('、'),org.noteThemes.join('、'),org.latestNote?.text??'',excelDate(org.latestNote?.date??null),org.latestNote?.author??'',org.actions.map(a=>`${a.date}｜${a.value}`).join('\n'),org.aliases.join('\n'),org.reminders.join('\n'),`${org.source.sheet}!A${org.source.row}`);
  return values;
});
const insightHeaders=['組織編號','整合紀錄編號','補充欄位','整理內容','依據類型','顧問原文引句','筆記日期','記錄者','原始分頁','原始列號','來源定位'];
const insightValues=insights.map(i=>[i.orgId,i.recordId,i.field,i.value,i.basis,i.quote,new Date(i.date),i.author,i.sourceSheet,i.sourceRow,`${i.sourceSheet}!A${i.sourceRow}`]);
const pendingHeaders=['原始紀錄編號','原始組織編號（空白）','候選組織編號','填寫者自填名稱','日期','狀態','人工語意建議理由','審核責任人','確認方式','原始分頁','原始列號','來源定位'];
const pendingValues=records.filter(r=>r.status==='pending').map(r=>[r.id,r.originalOrgId,r.candidateOrgId,r.submittedName,new Date(r.date),'待確認，未計入正式統計',r.reason,'會員管理經理','核對真實組織名稱、統編或原報名者；確認後在來源②補組織編號',r.source.sheet,r.source.row,`${r.source.sheet}!A${r.source.row}`]);
const guideHeaders=['項目','整理說明','來源／執行方式'];
const guideValues: ExcelJS.CellValue[][]=[
  ['用途','任務二：接電話的新同事先以組織主檔查基本資料，再篩選整合紀錄了解歷史。未來桌面小工具以組織編號建立詳細頁，本次僅整理資料。','④任務卡!A9:B13'],
  ['資料性質','此為虛構示範資料。組織名稱、統編及案例不可用於真實決策。',sourceName],
  ['維護原則','來源 Excel 與 scripts/mission2-annotations.json 為維護輸入；本整理版 Excel 與 data/mission2.json 為同次產生的快照，無即時同步。請勿直接修改快照作為長期資料來源。','來源①②③ → 整理腳本 → Excel／JSON'],
  ['組織數',{formula:`COUNTA('①組織主檔'!A2:A${organizations.length+1})`,result:organizations.length},`來源①組織主檔第${masters.map(s=>s.row).join('、')}列，前14個輸入欄完整保留。`],
  ['整合紀錄數',{formula:`COUNTA('②③整合紀錄'!A2:A${historyLast})`,result:records.length},`來源②接觸紀錄第${contacts.at(0)?.row}至${contacts.at(-1)?.row}列，③顧問筆記第${notes.map(s=>s.row).join('、')}列；③第${footer.row}列說明文字不算紀錄。`],
  ['接觸紀錄數',{formula:`COUNTIF('②③整合紀錄'!B2:B${historyLast},"接觸紀錄")`,result:contacts.length},'接觸資料原始九欄完整保留，另加來源、確認狀態與候選欄。'],
  ['顧問筆記數',{formula:`COUNTIF('②③整合紀錄'!B2:B${historyLast},"顧問筆記")`,result:notes.length},'顧問筆記保留原文、日期、記錄者；新編號 N-組織編號-日期，原始紀錄編號空白。'],
  ['待確認對應數',{formula:`COUNTA('待確認對應'!A2:A${Math.max(2,pendingValues.length+1)})`,result:pendingValues.length},'候選為整理者語意建議，未確認前組織編號仍空白，不納正式統計、別名或搜尋文字；請會員管理經理核對。'],
  ['統計規則','接觸筆數／最近一次接觸只算已確認接觸紀錄；顧問筆記筆數只算筆記；最近資料日期納入兩類。公式參照快照實際範圍，新增來源資料後須重新產生。','①主檔 O:R；最近接觸與最近資料日期依各自納入的紀錄計算。'],
  ['分類規則','原始議題與服務對象保留。顧問明述的服務對象另加入服務對象；整理者推論的議題標為待確認，非正式分類或永久分類。','③顧問筆記；洞察依據保留原文、日期及來源定位，可追溯。'],
  ['筆記主題與行動','財務、行銷、主管支持等放入顧問筆記主題，不當作組織服務議題。主題為整理者摘要；行動／建議保留原文，包含已完成的轉介。','所有判斷保留日期、記錄者與原文；邀請前須再確認現況。'],
  ['缺漏處理',`筆記未完成：${records.filter(r=>r.incomplete).map(r=>r.orgId).join('、')||'無'}，無推測需求或建議。全職人數未填：${organizations.filter(o=>o.sourceFields['全職人數']===null).map(o=>o.id).join('、')||'無'}。無顧問筆記僅代表未記錄；非會員無入會年屬預期，不補造資料。`,'由原記錄者補寫筆記；基本欄位由會員管理同事核實。'],
  ['尚缺資料','本檔沒有聯絡人姓名、電話、email，也沒有明年課程表。無法直接回答未來財務課程時程。','會員管理同事維護聯絡資料；培力 PM 維護正式課程表。'],
  ['日常更新','在來源①維護組織輸入欄，②新增接觸並填穩定組織編號，③補完整筆記及日期／記錄者。待確認對應核實後在來源②填編號並移除 annotations.pending 對應項目。','新筆記需同步新增註解，expectedText 必須與原文完全一致；來源文字改動會使腳本明確失敗。'],
  ['重新產生','pnpm install；pnpm run data:organize --overwrite-generated；pnpm run build；pnpm run data:check','Node.js 24+；來源檔、整理檔置於同資料夾，來源定位連結使用相對檔名。'],
  ['指定路徑','pnpm run data:organize --source /完整路徑/來源.xlsx --out-dir /輸出資料夾 --overwrite-generated','data:check 可使用相同 --source、--out-dir；只檢查不寫入。'],
  ['公式重算','Excel 或 LibreOffice 可重算公式；檢查腳本會重開檔案比對全部組織的筆數、最近日期及全部原文。','輸出含快取值；重算後再執行 data:check 可驗證試算表引擎結果。'],
  ['來源定位','每筆歷史、洞察與待確認對應均保留原始分頁及列號，點選來源定位可開啟原始資料。','不複製原始分頁；原始檔保持不變。']
];
const tables=[
  {name:'整理說明',table:'Mission2Guide',headers:guideHeaders,rows:guideValues,widths:[24,95,80]},
  {name:'①組織主檔',table:'Mission2Organizations',headers:[...masterHeaders,...extraHeaders],rows:masterValues,widths:[14,20,24,49,18,23,12,12,12,16,12,20,23,14,16,20,16,20,35,35,40,70,18,18,60,50,58,28]},
  {name:'②③整合紀錄',table:'Mission2History',headers:historyHeaders,rows:historyValues,widths:[25,16,22,25,26,18,22,45,20,48,82,26,20,20,18,22,14,30,75,22]},
  {name:'洞察依據',table:'Mission2Insights',headers:insightHeaders,rows:insightValues,widths:[14,25,30,48,24,88,18,20,22,14,30]},
  {name:'待確認對應',table:'Mission2Pending',headers:pendingHeaders,rows:pendingValues,widths:[20,26,22,46,18,30,90,22,75,22,14,30]}
];
function evaluated(cell: ExcelJS.Cell): Scalar {
  const value=cell.value; if(value&&typeof value==='object'&&('formula' in value||'sharedFormula' in value)) return scalar(cell.result);
  return scalar(value);
}
function expectedValue(value: ExcelJS.CellValue): Scalar { if(value&&typeof value==='object'&&'formula' in value)return scalar(value.result);return scalar(value); }
if(args.check) {
  const json:unknown=JSON.parse(await readFile(jsonPath,'utf8')); assert.deepEqual(json,snapshot,'JSON differs from maintained inputs');
  const output=await readWorkbook(outputPath);
  assert.deepEqual(output.worksheets.map(s=>s.name),tables.map(t=>t.name),'Unexpected worksheets');
  for(const table of tables){
    const sheet=output.getWorksheet(table.name); assert(sheet); assert.equal(sheet.actualRowCount,table.rows.length+1,`Row count ${table.name}`);
    assert.deepEqual(table.headers.map((_,i)=>evaluated(sheet.getRow(1).getCell(i+1))),table.headers,`Headers ${table.name}`);
    for(const [r,values] of table.rows.entries()) for(const [c,value] of values.entries()) {
      const actual=evaluated(sheet.getRow(r+2).getCell(c+1)); const expected=expectedValue(value);
      assert.equal(actual===''?null:actual,expected===''?null:expected,`Mismatch ${table.name}!${sheet.getRow(r+2).getCell(c+1).address}`);
      if(value&&typeof value==='object'&&'formula' in value) assert(sheet.getRow(r+2).getCell(c+1).formula,'Expected live formula');
    }
  }
  assert.equal(hash(await readFile(sourcePath)),initialHash,'Source changed while checking');
  process.stdout.write(JSON.stringify({ok:true,mode:'check',organizations:organizations.length,records:records.length,contacts:contacts.length,notes:notes.length,pending:pendingValues.length,insights:insights.length,sourceSha256:initialHash,verified:'all JSON, source fields, workbook cells and all organizations formula results'},null,2)+'\n');
} else {
  if(!args['overwrite-generated']) for(const path of [outputPath,jsonPath]) { let exists=true;try{await access(path);}catch{exists=false;}assert(!exists,`Generated output exists: ${path}. Use --overwrite-generated to regenerate.`); }
  const output=new ExcelJS.Workbook(); output.creator='好事大平台｜任務二資料整理'; output.calcProperties.fullCalcOnLoad=true;
  for(const table of tables){
    const sheet=output.addWorksheet(table.name,{views:[{state:'frozen',ySplit:1}],properties:{defaultRowHeight:44},pageSetup:{orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0}});
    sheet.addTable({name:table.table,ref:'A1',headerRow:true,style:{theme:'TableStyleMedium2',showRowStripes:false},columns:table.headers.map(name=>({name,filterButton:true})),rows:table.rows});
    assert.equal(table.widths.length,table.headers.length,`Column widths missing for ${table.name}`);
    sheet.columns.forEach((column,i)=>{column.width=table.widths[i];});
    sheet.eachRow(row=>{row.eachCell({includeEmpty:true},cell=>{cell.font={name:'Arial',size:11,color:{argb:'FF243B3B'}};cell.alignment={vertical:'top',wrapText:true};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:row.number%2?'FFF0F7F6':'FFFFFFFF'}};});row.height=table.name==='整理說明'?70:table.name==='①組織主檔'?100:76;});
    sheet.getRow(1).height=42;sheet.getRow(1).eachCell(cell=>{cell.font={name:'Arial',size:11,bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF116466'}};cell.alignment={vertical:'middle',wrapText:true};});
    const dateColumns=table.name==='①組織主檔'?[16,18,23]:table.name==='②③整合紀錄'?[6]:table.name==='洞察依據'?[7]:table.name==='待確認對應'?[5]:[];
    dateColumns.forEach(column=>{sheet.getColumn(column).numFmt='yyyy-mm-dd';});
    const locatorColumn=table.headers.indexOf('來源定位')+1;
    if(locatorColumn) for(let row=2;row<=table.rows.length+1;row++){const cell=sheet.getRow(row).getCell(locatorColumn);const location=String(cell.value);const separator=location.lastIndexOf('!');cell.value={text:location,hyperlink:`${basename(sourcePath)}#'${location.slice(0,separator)}'!${location.slice(separator+1)}`};cell.font={name:'Arial',size:11,color:{argb:'FF007F83'},underline:true};}
    sheet.pageSetup.printTitlesRow='1:1';
  }
  await mkdir(join(outDir,'data'),{recursive:true});
  await output.xlsx.writeFile(outputPath); await writeFile(jsonPath,JSON.stringify(snapshot,null,2)+'\n');
  assert.equal(hash(await readFile(sourcePath)),initialHash,'Source changed while generating');
  process.stdout.write(JSON.stringify({ok:true,mode:'generate',workbook:outputPath,json:jsonPath,organizations:organizations.length,records:records.length,insights:insights.length,pending:pendingValues.length,sourceSha256:initialHash},null,2)+'\n');
}
