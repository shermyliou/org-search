import { getHistory, type HistoryRecord, type Organization } from './data';

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

export function renderRecord(record: HistoryRecord) {
  return `<li id="record-${escapeHtml(record.id)}" class="history-item" data-record-id="${escapeHtml(record.id)}" data-status="${escapeHtml(record.status)}" tabindex="-1">
    <div class="record-meta"><span class="category-tag">${escapeHtml(kind(record))}</span><time datetime="${escapeHtml(record.date)}">${escapeHtml(record.date)}</time></div>
    <h3>${escapeHtml(record.eventName || '顧問筆記')}${record.incomplete ? '<span class="tentative">不完整，待補寫</span>' : ''}</h3>
    ${record.author || record.participantTitle ? `<p class="muted small">${record.author ? `記錄者 ${escapeHtml(record.author)}` : `參與者職稱 ${escapeHtml(record.participantTitle)}`}</p>` : ''}
    <p class="record-text">${escapeHtml(record.text) || '<span class="muted">原始紀錄未填文字</span>'}</p>
    ${publicSource(record)}
    ${record.status === 'pending' ? `<p class="pending-reason"><span class="tentative">待確認對應</span>${escapeHtml(record.reason)}</p>` : ''}
    ${source(record)}
  </li>`;
}

function table(headers: string[], rows: string[], label: string) {
  return `<div class="table-scroll" role="region" aria-label="${escapeHtml(label)}" tabindex="0"><table class="history-table"><thead><tr>${headers.map(header => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function recordTable(records: HistoryRecord[], canonical = false) {
  return table(['日期 / 編號', '類別', '活動 / 原始紀錄', '來源'], records.map(record => `<tr ${canonical ? `id="record-${escapeHtml(record.id)}" data-record-id="${escapeHtml(record.id)}" data-status="${escapeHtml(record.status)}" tabindex="-1"` : `data-contact-id="${escapeHtml(record.id)}"`}>
    <td><time datetime="${escapeHtml(record.date)}">${escapeHtml(record.date)}</time><small>${escapeHtml(record.id)}</small></td>
    <td><span class="category-tag">${escapeHtml(kind(record))}</span>${publicSource(record)}</td>
    <td><strong>${escapeHtml(record.eventName || '顧問筆記')}</strong>${record.incomplete ? '<span class="tentative">不完整，待補寫</span>' : ''}<p class="record-text">${escapeHtml(record.text) || '<span class="muted">原始紀錄未填文字</span>'}</p>${record.author ? `<small>記錄者 ${escapeHtml(record.author)}</small>` : ''}</td>
    <td>${source(record)}</td>
  </tr>`), canonical ? '完整接觸時間軸表格' : '接觸紀錄表格');
}

function recordsView(records: HistoryRecord[], mode: HistoryOptions['mode'], canonical = false) {
  if (!records.length) return '<p class="muted">尚無已確認紀錄。</p>';
  if (mode === 'table') return recordTable(records, canonical);
  return `<ol class="history-list">${records.map(record => canonical ? renderRecord(record) : `<li class="history-item" data-contact-id="${escapeHtml(record.id)}"><div class="record-meta"><span class="category-tag">${escapeHtml(kind(record))}</span><time datetime="${escapeHtml(record.date)}">${escapeHtml(record.date)}</time></div><h3>${escapeHtml(record.eventName || '顧問筆記')}</h3><p class="record-text">${escapeHtml(record.text) || '<span class="muted">原始紀錄未填文字</span>'}</p>${publicSource(record)}${source(record)}</li>`).join('')}</ol>`;
}

function card(number: string, name: string, count: string, content: string) {
  return `<section class="history-card" aria-label="${escapeHtml(name)}"><div class="section-heading"><h3><span class="section-number">${number}</span>${escapeHtml(name)}</h3><span>${escapeHtml(count)}</span></div>${content}</section>`;
}

function option(value: string, label: string, selected: string) {
  return `<option value="${escapeHtml(value)}" ${value === selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
}

function coursesView(courses: HistoryRecord[], records: HistoryRecord[], options: HistoryOptions) {
  const category = (record: HistoryRecord) => courseTypes[record.eventName] ?? '未分類';
  const visible = courses.filter(record => options.courseCategory === 'all' || category(record) === options.courseCategory);
  const traces = records.filter(record => record.contactType === '課後追蹤');
  const followups = (course: HistoryRecord) => traces.filter(record => record.eventName === course.eventName && record.date >= course.date);
  const trace = (course: HistoryRecord) => {
    const matching = followups(course);
    return matching.length ? matching.map(record => `<details class="course-followup"><summary>${escapeHtml(record.date)} · ${escapeHtml(record.id)}</summary><p class="record-text">${escapeHtml(record.text)}</p>${source(record)}</details>`).join('') : '<span class="muted">無可明確配對的追蹤</span>';
  };
  const counts = courseCategories.map(name => `<span>${name}<strong>${courses.filter(record => category(record) === name).length} 筆</strong></span>`).join('');
  const unclassified = courses.filter(record => category(record) === '未分類').length;
  const controls = `<p class="muted small">課程類型依活動名稱整理；報名不代表已實際出席。</p><div class="course-counts">${counts}${unclassified ? `<span>未分類<strong>${unclassified} 筆</strong></span>` : ''}</div><label class="course-filter">課程類型<select data-history-control="courseCategory" aria-label="課程類型">${option('all', '全部類型', options.courseCategory)}${[...courseCategories, ...(unclassified ? ['未分類'] : [])].map(name => option(name, name, options.courseCategory)).join('')}</select></label>`;
  const content = !visible.length ? '<p class="muted">此類別尚無課程報名紀錄。</p>' : options.mode === 'table'
    ? table(['日期 / 編號', '課程類型', '活動名稱', '參與者職稱', '留下的話', '參與狀態', '課後追蹤'], visible.map(record => `<tr data-course-id="${escapeHtml(record.id)}"><td><time datetime="${escapeHtml(record.date)}">${escapeHtml(record.date)}</time><small>${escapeHtml(record.id)}</small></td><td><span class="category-tag">${category(record)}</span></td><td>${escapeHtml(record.eventName)}${source(record)}</td><td>${display(record.participantTitle)}</td><td class="record-text">${display(record.text)}</td><td><span class="status-tag">已報名 / 出席未知</span></td><td>${trace(record)}</td></tr>`), '培力課程參與紀錄')
    : `<ol class="history-list">${visible.map(record => `<li class="history-item" data-course-id="${escapeHtml(record.id)}"><div class="record-meta"><span class="category-tag">${category(record)}</span><time datetime="${escapeHtml(record.date)}">${escapeHtml(record.date)} · ${escapeHtml(record.id)}</time></div><h3>${escapeHtml(record.eventName)}</h3><p>參與者職稱 ${display(record.participantTitle)}</p><p class="record-text">${display(record.text)}</p><span class="status-tag">已報名 / 出席未知</span>${source(record)}<h4>課後追蹤</h4>${trace(record)}</li>`).join('')}</ol>`;
  return card('01', '培力課程', `${courses.length} 筆報名 · ${traces.length} 筆追蹤`, `${controls}${content}<p class="muted small">資料來源：報名表、行前問卷及後追問卷。追蹤僅依同一組織、活動名稱及日期配對，需核對活動場次。</p>`);
}

function meetingsView(records: HistoryRecord[], mode: HistoryOptions['mode']) {
  const direct = records.filter(record => record.text === '出席').length;
  const delegated = records.filter(record => record.text === '委託出席').length;
  const years = new Set(records.filter(record => record.text === '出席' || record.text === '委託出席').map(record => record.date.slice(0, 4))).size;
  const stats = `<div class="meeting-stats"><div><span>記載出席</span><strong>${direct}</strong></div><div><span>記載委託出席</span><strong>${delegated}</strong></div><div><span>有紀錄年度</span><strong>${years}</strong></div></div>`;
  const details = mode === 'table' ? table(['日期', '活動', '出席方式（原始記載）', '來源 / 編號'], records.map(record => `<tr data-meeting-id="${escapeHtml(record.id)}"><td><time datetime="${escapeHtml(record.date)}">${escapeHtml(record.date)}</time></td><td>${escapeHtml(record.eventName)}</td><td>${display(record.text)}</td><td>${escapeHtml(record.dataSource)} · ${escapeHtml(record.id)}${source(record)}</td></tr>`), '會員大會出席明細') : recordsView(records, mode);
  return card('02', '會員大會', `${records.length} 筆紀錄`, `${stats}<details class="meeting-details"><summary>查看會員大會明細（${records.length} 筆）</summary>${records.length ? details : '<p class="muted">尚無已確認會員大會紀錄。</p>'}</details><p class="muted small">依會員大會報名表原始文字計算，不代表已完成實際簽到驗證，亦非出席率。</p>`);
}

function programsView(programs: HistoryRecord[], allRecords: HistoryRecord[], mode: HistoryOptions['mode']) {
  const notes = allRecords.filter(record => record.kind === '顧問筆記' && record.text.includes('陪跑'));
  const linked = notes.length ? `<details class="program-links"><summary>陪跑相關顧問筆記（${notes.length} 筆）</summary><p class="muted small">同組織筆記原文明記陪跑，仍須確認是否對應上述計畫。</p><ul class="plain-list">${notes.map(record => `<li><p class="record-text">${escapeHtml(record.text)}</p><p class="muted small">${escapeHtml(record.author)} · ${escapeHtml(record.date)} · ${escapeHtml(record.id)}</p><button class="text-button" type="button" data-record="${escapeHtml(record.id)}">查看原始紀錄</button>${source(record)}</li>`).join('')}</ul></details>` : '<p class="muted small">尚無可串聯的陪跑相關顧問筆記。</p>';
  return card('03', '陪跑計畫', `${programs.length} 筆紀錄`, `${recordsView(programs, mode)}${linked}`);
}

export function renderHistory(org: Organization, options: HistoryOptions = defaultHistoryOptions) {
  const { confirmed, pending } = getHistory(org);
  const byDate = (a: HistoryRecord, b: HistoryRecord) => (options.order === 'oldest' ? 1 : -1) * a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
  const ordered = [...confirmed].sort(byDate);
  const filtered = ordered.filter(record => options.category === 'all' || kind(record) === options.category);
  const types = [...new Set(confirmed.map(kind))];
  const toolbar = `<div class="history-toolbar"><div class="view-switch" role="group" aria-label="紀錄檢視方式"><button type="button" class="outline secondary compact-button" data-history-mode="list" aria-pressed="${options.mode === 'list'}">列表</button><button type="button" class="outline secondary compact-button" data-history-mode="table" aria-pressed="${options.mode === 'table'}">表格</button></div><div class="filter-row"><label>接觸類別<select data-history-control="category" aria-label="接觸類別">${option('all', '所有類別', options.category)}${types.map(type => option(type, type, options.category)).join('')}</select></label><label>時間排序<select data-history-control="order" aria-label="時間排序">${option('newest', '由新到舊', options.order)}${option('oldest', '由舊到新', options.order)}</select></label></div></div>`;
  const show = (type: string) => options.category === 'all' || options.category === type;
  const others = filtered.filter(record => options.category === 'all' ? record.kind === '接觸紀錄' && !['培力課程', '會員大會', '陪跑計畫', '課後追蹤'].includes(record.contactType) : !['培力課程', '會員大會', '陪跑計畫'].includes(kind(record)));
  return `<section aria-label="已確認歷史">${toolbar}
    ${show('培力課程') ? coursesView(filtered.filter(record => record.contactType === '培力課程'), ordered, options) : ''}
    ${show('會員大會') ? meetingsView(filtered.filter(record => record.contactType === '會員大會'), options.mode) : ''}
    ${show('陪跑計畫') ? programsView(filtered.filter(record => record.contactType === '陪跑計畫'), ordered, options.mode) : ''}
    ${options.category === 'all' || !['培力課程', '會員大會', '陪跑計畫'].includes(options.category) ? card('04', '其他接觸', `${others.length} 筆紀錄`, recordsView(others, options.mode)) : ''}
    <details class="full-timeline history-card" open><summary>完整接觸時間軸（${ordered.length} 筆）</summary><p class="muted small">包含所有已確認接觸與顧問筆記，保留完整時間脈絡。</p>${recordsView(ordered, options.mode, true)}</details>
  </section>${pending.length ? `<section class="pending-section" aria-label="待確認對應紀錄"><h3>待確認對應 <span class="tentative">${pending.length} 筆</span></h3><p class="muted small">以下可能屬於此組織，須由會員管理同事核對；未計入正式歷史、統計與別名。</p><ol class="history-list">${[...pending].sort(byDate).map(renderRecord).join('')}</ol></section>` : ''}`;
}
