import { GridTableIcon, LeftToRightListBulletIcon } from '@hugeicons/core-free-icons';
import { contactCounts, getHistory, type HistoryRecord, type Organization } from './data';

export type HistoryOptions = {
  mode: 'list' | 'table';
  category: string;
  order: 'newest' | 'oldest';
  courseCategory: string;
};

export const defaultHistoryOptions: HistoryOptions = { mode: 'table', category: 'all', order: 'newest', courseCategory: 'all' };

const escapeHtml = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const display = (value: string | null) => value ? escapeHtml(value) : '<span class="muted">未填</span>';
const kind = (record: HistoryRecord) => record.kind === '顧問筆記' ? record.kind : record.contactType;
const courseCategories = ['財務', '數位', '行銷', '組織治理'];
const courseTypes: Record<string, string> = {
  '財報識讀入門工作坊': '財務',
  '責信交流會': '組織治理',
  '財務資訊視覺化工作坊': '財務',
  '數據社會影響力工作坊（進階）': '數位',
  '數據社會影響力工作坊': '數位',
  '內稽內控工作坊': '組織治理',
  '高階主管財報識讀工作坊': '財務',
  '數位工具與資訊安全工作坊': '數位',
};
const category = (record: HistoryRecord) => courseTypes[record.eventName] ?? '未分類';

function icon(paths: typeof LeftToRightListBulletIcon) {
  const attributes: Record<string, string> = { strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', strokeWidth: 'stroke-width' };
  return `<svg class="icon" width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths.map(([tag, props]) => `<${tag} ${Object.entries(props).filter(([key]) => key !== 'key').map(([key, value]) => `${attributes[key] ?? key}="${escapeHtml(value)}"`).join(' ')} />`).join('')}</svg>`;
}

function source(record: HistoryRecord) {
  const fields = [
    ['原始紀錄編號', record.originalRecordId], ['原始組織編號', record.originalOrgId],
    ['對應狀態', record.status === 'pending' ? '待確認，未計入正式歷史與統計' : '已確認'],
    ['填寫名稱', record.submittedName], ['資料來源', record.dataSource],
    ['參與者職稱', record.participantTitle], ['記錄者', record.author],
  ];
  return `<details class="record-source"><summary>來源 ${escapeHtml(record.source.sheet)} · 第 ${record.source.row} 列 · ${escapeHtml(record.id)}</summary><dl class="data-list">${fields.map(([name, value]) => `<div><dt>${escapeHtml(name)}</dt><dd>${display(value ?? null)}</dd></div>`).join('')}</dl></details>`;
}

function publicSource(record: HistoryRecord) {
  return record.dataSource.includes('搜尋') ? '<span class="category-tag">公開資料搜尋</span>' : '';
}

function trace(course: HistoryRecord, traces: HistoryRecord[]) {
  const matching = traces.filter(record => record.eventName === course.eventName && record.date >= course.date);
  return `<h4 class="followup-title">課後追蹤</h4>${matching.length ? matching.map(record => `<details class="course-followup"><summary>${escapeHtml(record.date)} · ${escapeHtml(record.id)}</summary><p>${escapeHtml(record.text)}</p>${source(record)}</details>`).join('') : '<p class="muted small">無可明確配對的追蹤</p>'}`;
}

function recordAttributes(record: HistoryRecord) {
  const courseAttr = record.contactType === '培力課程' ? ` data-course-id="${escapeHtml(record.id)}"` : '';
  const meetingAttr = record.contactType === '會員大會' ? ` data-meeting-id="${escapeHtml(record.id)}"` : '';
  return `id="record-${escapeHtml(record.id)}" data-record-id="${escapeHtml(record.id)}" data-status="${escapeHtml(record.status)}"${courseAttr}${meetingAttr} tabindex="-1"`;
}

function categoryTags(record: HistoryRecord) {
  if (record.contactType === '培力課程') {
    return `<span class="category-tag">${escapeHtml(category(record))}</span><span class="category-tag">${escapeHtml(kind(record))}</span>${publicSource(record)}`;
  }
  return `<span class="category-tag">${escapeHtml(kind(record))}</span>${publicSource(record)}`;
}

export function renderRecord(record: HistoryRecord, traces: HistoryRecord[] = []) {
  const isCourse = record.contactType === '培力課程';
  return `<li ${recordAttributes(record)} class="history-item">
    <div class="record-meta"><span>${categoryTags(record)}</span><time datetime="${escapeHtml(record.date)}">${escapeHtml(record.date)} · ${escapeHtml(record.id)}</time></div>
    <h3>${escapeHtml(record.eventName || '顧問筆記')}${record.incomplete ? '<span class="tentative">不完整，待補寫</span>' : ''}</h3>
    ${record.author || record.participantTitle || isCourse ? `<p class="muted small">${record.author ? `記錄者 ${escapeHtml(record.author)}` : `參與者職稱 ${display(record.participantTitle)}`}</p>` : ''}
    <p class="record-text">${escapeHtml(record.text) || '<span class="muted">原始紀錄未填文字</span>'}</p>
    ${isCourse ? '<span class="status-tag">已報名 / 出席未知</span>' : ''}
    ${record.status === 'pending' ? `<p class="pending-reason"><span class="tentative">待確認對應</span>${escapeHtml(record.reason)}</p>` : ''}
    ${source(record)}
    ${isCourse ? trace(record, traces) : ''}
  </li>`;
}

function table(headers: string[], rows: string[], label: string) {
  return `<div class="table-scroll" role="region" aria-label="${escapeHtml(label)}" tabindex="0"><table class="history-table"><thead><tr>${headers.map(header => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function recordTable(records: HistoryRecord[], traces: HistoryRecord[]) {
  return table(['日期 / 編號', '類別', '活動 / 原始紀錄', '來源'], records.map(record => {
    const isCourse = record.contactType === '培力課程';
    return `<tr ${recordAttributes(record)}>
      <td><time datetime="${escapeHtml(record.date)}">${escapeHtml(record.date)}</time><small>${escapeHtml(record.id)}</small></td>
      <td>${categoryTags(record)}</td>
      <td><strong>${escapeHtml(record.eventName || '顧問筆記')}</strong>${record.incomplete ? '<span class="tentative">不完整，待補寫</span>' : ''}${record.author || record.participantTitle || isCourse ? `<small>${record.author ? `記錄者 ${escapeHtml(record.author)}` : `參與者職稱 ${display(record.participantTitle)}`}</small>` : ''}<p class="record-text">${escapeHtml(record.text) || '<span class="muted">原始紀錄未填文字</span>'}</p>${isCourse ? '<span class="status-tag">已報名 / 出席未知</span>' : ''}</td>
      <td>${source(record)}${isCourse ? trace(record, traces) : ''}</td>
    </tr>`;
  }), '參與記錄表格');
}

function recordsView(records: HistoryRecord[], traces: HistoryRecord[], mode: HistoryOptions['mode']) {
  if (!records.length) return '<p class="muted">尚無符合條件的已確認紀錄。</p>';
  if (mode === 'table') return recordTable(records, traces);
  return `<ol class="history-list">${records.map(record => renderRecord(record, traces)).join('')}</ol>`;
}

function option(value: string, label: string, selected: string) {
  return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

export function renderHistory(org: Organization, options: HistoryOptions = defaultHistoryOptions) {
  const { confirmed, pending } = getHistory(org);
  const byDate = (a: HistoryRecord, b: HistoryRecord) => (options.order === 'oldest' ? 1 : -1) * a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  const ordered = [...confirmed].sort(byDate);
  const traces = ordered.filter(record => record.contactType === '課後追蹤');
  const courses = ordered.filter(record => record.contactType === '培力課程');
  const meetings = ordered.filter(record => record.contactType === '會員大會');
  const direct = meetings.filter(record => record.text === '出席').length;
  const delegated = meetings.filter(record => record.text === '委託出席').length;
  const years = new Set(meetings.filter(record => record.text === '出席' || record.text === '委託出席').map(record => record.date.slice(0, 4))).size;
  const unclassified = courses.filter(record => category(record) === '未分類').length;
  const noteCount = ordered.filter(record => record.kind === '顧問筆記').length;
  const summaryCounts = [
    ...contactCounts(confirmed),
    ...(noteCount ? [['顧問筆記', noteCount] as const] : []),
    ['記載出席', direct] as const,
    ['記載委託出席', delegated] as const,
    ['有紀錄年度', years] as const,
    ...courseCategories.map(name => [`${name}課程`, courses.filter(record => category(record) === name).length] as const),
    ...(unclassified ? [['未分類課程', unclassified] as const] : []),
  ];
  const counts = `<div class="counts" aria-label="參與統計">${summaryCounts.map(([label, value]) => `<span>${escapeHtml(label)}<strong>${value}</strong></span>`).join('')}</div>`;
  const filtered = ordered.filter(record => (options.category === 'all' || kind(record) === options.category) && (options.courseCategory === 'all' || (record.contactType === '培力課程' && category(record) === options.courseCategory)));
  const types = [...new Set(confirmed.map(kind))];
  const toolbar = `<div class="history-toolbar"><div class="view-switch" aria-label="紀錄檢視方式"><button type="button" class="icon-button" data-history-mode="list" aria-label="列表" title="列表" aria-pressed="${options.mode === 'list'}">${icon(LeftToRightListBulletIcon)}</button><button type="button" class="icon-button" data-history-mode="table" aria-label="表格" title="表格" aria-pressed="${options.mode === 'table'}">${icon(GridTableIcon)}</button></div><div class="filter-row"><label><span class="sr-only">接觸類別</span><select data-history-control="category" aria-label="接觸類別">${option('all', '所有類別', options.category)}${types.map(type => option(type, type, options.category)).join('')}</select></label><label><span class="sr-only">課程類型</span><select data-history-control="courseCategory" aria-label="課程類型">${option('all', '全部類型', options.courseCategory)}${[...courseCategories, ...(unclassified ? ['未分類'] : [])].map(name => option(name, name, options.courseCategory)).join('')}</select></label><label><span class="sr-only">時間排序</span><select data-history-control="order" aria-label="時間排序">${option('newest', '由新到舊', options.order)}${option('oldest', '由舊到新', options.order)}</select></label></div></div>`;
  return `<section class="history-section" aria-label="已確認歷史">${toolbar}${counts}${recordsView(filtered, traces, options.mode)}</section>${pending.length ? `<section class="pending-section" aria-label="待確認對應紀錄"><h3>待確認對應 <span class="tentative">${pending.length} 筆</span></h3><p class="muted small">以下可能屬於此組織，須由會員管理同事核對；未計入正式歷史、統計與別名。</p><ol class="history-list">${[...pending].sort(byDate).map(record => renderRecord(record)).join('')}</ol></section>` : ''}`;
}
