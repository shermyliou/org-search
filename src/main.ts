import { ArrowLeft01Icon, Cancel01Icon, PictureInPictureIcon, Search01Icon, SentIcon } from '@hugeicons/core-free-icons';
import { attachPictureInPicture } from './pip';
import { type Notebook, readNotebook, updateNotebook } from './notes';
import { applyFields, editableFieldKeys, type FieldEdits, readFields, updateField } from './fields';
import './style.css';

const escapeHtml = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function isElement(target: EventTarget | null): target is Element {
  return target !== null && 'nodeType' in target && target.nodeType === 1;
}

function icon(paths: typeof Search01Icon) {
  const attributes: Record<string, string> = { strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', strokeWidth: 'stroke-width' };
  return `<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths.map(([tag, props]) => `<${tag} ${Object.entries(props).filter(([key]) => key !== 'key').map(([key, value]) => `${attributes[key] ?? key}="${escapeHtml(value)}"`).join(' ')} />`).join('')}</svg>`;
}

async function start() {
  const [{ organizations, sourceFilename, getOrganization, getHistory, searchOrganizations }, { defaultHistoryOptions, renderHistory }, { renderGuide }] = await Promise.all([import('./data'), import('./history'), import('./guide')]);
  type Organization = (typeof organizations)[number];
  type Tab = 'history' | 'notes' | 'guide' | 'other';
  type View = { kind: 'search' } | { kind: 'detail'; orgId: string; tab: Tab };
  type Note = { notebook: Notebook; error: string | null; readFailed: boolean; activity: 'idle' | 'saving' | 'sending' };
  const tabs = [
    { id: 'history', label: '參與記錄' },
    { id: 'notes', label: '備註紀錄' },
    { id: 'guide', label: '互動指南' },
    { id: 'other', label: '其他資料' },
  ] satisfies { id: Tab; label: string }[];
  let view: View = { kind: 'search' };
  let query = '';
  const notes = new Map<string, Note>();
  type Profile = { fields: FieldEdits; error: string | null; readFailed: boolean; revision: number };
  const profiles = new Map<string, Profile>();
  const historyOptions = { ...defaultHistoryOptions };
  const purposes = new Map<string, string>();

  const home = document.querySelector('#home');
  const away = document.querySelector('#pip-away');
  const returnButton = document.querySelector('#pip-return');
  if (!(home instanceof HTMLElement) || !(away instanceof HTMLElement) || !(returnButton instanceof HTMLButtonElement)) {
    throw new Error('頁面缺少浮動視窗容器。');
  }
  const root = document.createElement('div');
  root.id = 'app';
  root.innerHTML = `
    <header class="app-header">
      <h1>組織速查</h1>
      <button id="pip-toggle" class="text-button icon-button" type="button" aria-label="浮動視窗" title="浮動視窗">${icon(PictureInPictureIcon)}<span class="sr-only">浮動視窗</span></button>
    </header>
    <main>
      <form class="search-form" role="search">
        <label for="search" class="sr-only">搜尋組織</label>
        ${icon(Search01Icon)}
        <input id="search" name="search" type="search" placeholder="搜尋組織名稱、別名、議題，或記憶中的一段話" autocomplete="off" spellcheck="false" />
        <button type="button" id="clear-search" class="text-button icon-button" aria-label="清除搜尋" hidden>${icon(Cancel01Icon)}</button>
      </form>
      <p id="pip-error" class="error-message" role="alert" hidden></p>
      <p id="pip-unsupported" class="muted small" hidden>此瀏覽器可使用組織速查；浮動視窗請以桌面版 Chrome 或 Edge 開啟。</p>
      <div id="view"></div>
    </main>
    <footer class="app-footer"><span>好事大平台 · 組織資料小幫手</span><span>虛構示範資料</span></footer>`;
  home.append(root);

  function element<T extends HTMLElement>(selector: string): T {
    const found = root.querySelector<T>(selector);
    if (!found) throw new Error(`缺少畫面元件 ${selector}`);
    return found;
  }
  const input = element<HTMLInputElement>('#search');
  const content = element<HTMLDivElement>('#view');
  const clearButton = element<HTMLButtonElement>('#clear-search');
  const errorMessage = element<HTMLParagraphElement>('#pip-error');
  const supported = attachPictureInPicture({
    root, home, away, returnButton,
    trigger: element<HTMLButtonElement>('#pip-toggle'),
    onError(message) {
      errorMessage.textContent = message;
      errorMessage.hidden = !message;
    },
  });
  element<HTMLParagraphElement>('#pip-unsupported').hidden = supported;

  const display = (value: string | number | null | undefined) => value === null || value === undefined || value === '' ? '未填' : escapeHtml(value);
  const field = (org: Organization, key: keyof Organization['sourceFields']) => display(org.sourceFields[key]);
  const rows = (values: [string, string][]) => `<dl class="data-list">${values.map(([name, value]) => `<div><dt>${escapeHtml(name)}</dt><dd>${value}</dd></div>`).join('')}</dl>`;

  function profileFor(id: string): Profile {
    const existing = profiles.get(id);
    if (existing) return existing;
    let profile: Profile;
    try {
      profile = { fields: readFields(id), error: null, readFailed: false, revision: 0 };
    } catch (error) {
      profile = { fields: {}, error: `無法讀取本機欄位修改，已暫停編輯。${error instanceof Error ? error.message : String(error)}`, readFailed: true, revision: 0 };
    }
    profiles.set(id, profile);
    return profile;
  }

  const organization = (id: string) => applyFields(getOrganization(id), profileFor(id).fields);
  function editable(org: Organization, key: (typeof editableFieldKeys)[number], empty = '未填') {
    const value = org.sourceFields[key];
    return `<button type="button" class="editable" data-field="${escapeHtml(key)}" aria-label="編輯${escapeHtml(key)}" ${profileFor(org.id).readFailed ? 'disabled' : ''}>${value === null || value === '' ? escapeHtml(empty) : display(value)}</button>`;
  }

  function identity(org: Organization, detail = false) {
    return `<div class="identity">
      <div class="identity-main">
        <p class="eyebrow">${detail ? editable(org, '議題') : escapeHtml(org.issue)}<span aria-hidden="true">·</span>${detail ? editable(org, '服務對象') : escapeHtml(org.audiences.join('、'))}</p>
        <${detail ? 'h2' : 'h3'} ${detail ? 'id="detail-title" tabindex="-1"' : ''}>${detail ? editable(org, '組織名稱') : escapeHtml(org.name)}</${detail ? 'h2' : 'h3'}>
        <p class="location">${detail ? editable(org, '區域') : field(org, '區域')}</p>
      </div>
      <div class="tier" title="陪跑分級：${field(org, '陪跑分級')}。依組織主檔記載，原始資料未提供分級定義。"><strong>${detail ? editable(org, '陪跑分級') : field(org, '陪跑分級')}</strong></div>
    </div>`;
  }

  function renderSearch() {
    const results = searchOrganizations(query, organizations.map(org => organization(org.id)));
    content.innerHTML = `<section aria-label="搜尋結果">
      <div class="section-heading"><h2>${query.trim() ? '搜尋結果' : '所有組織'}</h2><span role="status">${results.length} 個組織</span></div>
      ${results.length ? `<ul class="organization-list">${results.map(org => `<li><button type="button" class="organization-row" data-org-id="${escapeHtml(org.id)}">${identity(org)}</button></li>`).join('')}</ul>` : `<div class="empty-state"><h2>沒有找到符合的組織</h2><p>試試名稱的一部分、服務對象，或不同的關鍵字。</p><button type="button" data-action="clear" class="outline secondary">查看所有組織</button></div>`}
    </section>`;
  }

  function noteFor(id: string): Note {
    const existing = notes.get(id);
    if (existing) return existing;
    let note: Note;
    try {
      note = { notebook: readNotebook(id), error: null, readFailed: false, activity: 'idle' };
    } catch (error) {
      note = { notebook: { version: 1, draft: '', entries: [] }, error: `無法讀取本機備註，已暫停編輯以保留原資料。${error instanceof Error ? error.message : String(error)}`, readFailed: true, activity: 'idle' };
    }
    notes.set(id, note);
    return note;
  }

  function noteRecords(org: Organization) {
    const localEntries = noteFor(org.id).notebook.entries.map(entry => ({
      id: entry.id, date: entry.createdAt.slice(0, 10), sortDate: entry.createdAt,
      time: new Intl.DateTimeFormat('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(entry.createdAt)),
      displayDate: new Intl.DateTimeFormat('sv-SE').format(new Date(entry.createdAt)),
      author: '本機使用者', text: entry.text, source: '本機備註', incomplete: false,
    }));
    const imported = getHistory(org).confirmed.filter(record => record.kind === '顧問筆記').map(record => ({
      id: record.id, date: record.date, sortDate: record.date, displayDate: record.date, time: '時間未記錄', author: record.author,
      text: record.text, source: `${record.source.sheet} · 第 ${record.source.row} 列`, incomplete: record.incomplete,
    }));
    const entries = [...localEntries, ...imported].sort((a, b) => b.sortDate.localeCompare(a.sortDate));
    return `<section aria-label="備註紀錄"><p class="muted small">${localEntries.length} 則本機備註 · ${imported.length} 則原始顧問筆記</p>
      ${entries.length ? `<ol class="note-list">${entries.map(entry => `<li class="note-message" data-note-id="${escapeHtml(entry.id)}">
        <div class="note-meta"><strong>${escapeHtml(entry.author)}</strong><time datetime="${escapeHtml(entry.sortDate)}">${escapeHtml(entry.displayDate)} ${escapeHtml(entry.time)}</time></div>
        <p class="record-text">${escapeHtml(entry.text)}</p>
        <p class="muted small">${escapeHtml(entry.source)}${entry.incomplete ? '<span class="tentative">不完整，待補寫</span>' : ''}</p>
      </li>`).join('')}</ol>` : '<div class="empty-state"><h3>還沒有備註紀錄</h3><p>在上方寫下備註，按送出後會保留在這裡。</p></div>'}
    </section>`;
  }

  function other(org: Organization) {
    return `<section class="other-section"><h3>組織主檔</h3>${rows(Object.entries(org.sourceFields).map(([key, value]) => {
      const editableKey = editableFieldKeys.find(field => field === key);
      return [key, editableKey ? editable(org, editableKey) : display(value)];
    }))}
      <h3>已確認的自填別名</h3>${org.aliases.length ? `<ul>${org.aliases.map(alias => `<li>${escapeHtml(alias)}</li>`).join('')}</ul>` : '<p class="muted">尚無已確認別名。</p>'}
      <h3>資料日期與來源</h3>${rows([
        ['最近一次接觸', display(org.metrics.latestContact)],
        ['最近資料日期', display(org.metrics.latestData)],
        ['主檔來源', `${escapeHtml(org.source.sheet)} · 第 ${org.source.row} 列`],
        ['來源檔案', escapeHtml(sourceFilename)],
      ])}<p class="muted small">最近一次接觸只計接觸紀錄；最近資料日期也包含顧問筆記。</p>
      <details><summary>查看匯入主檔原文</summary>${rows(Object.entries(getOrganization(org.id).sourceFields).map(([key, value]) => [key, display(value)]))}</details>
    </section>`;
  }

  function renderDetail(orgId: string, tab: Tab) {
    const org = organization(orgId);
    const note = noteFor(org.id);
    const profile = profileFor(org.id);
    const records = getHistory(org).confirmed;
    const direct = records.filter(record => record.contactType === '會員大會' && record.text === '出席').length;
    const delegated = records.filter(record => record.contactType === '會員大會' && record.text === '委託出席').length;
    content.innerHTML = `<div class="detail-view">
      <button type="button" class="text-button back-button" data-action="back">${icon(ArrowLeft01Icon)}返回搜尋結果</button>
      <section class="profile" aria-labelledby="detail-title">
        ${identity(org, true)}
        <p class="introduction">${editable(org, '一句話簡介')}</p>
        ${rows([
          ['組織規模', `${editable(org, '全職人數', '全職人數未填')}${org.sourceFields.全職人數 === null ? '' : ' 位全職人員'}`],
          ['出席次數', `會員大會 ${direct} 次${delegated ? `，另有 ${delegated} 次委託出席` : ''}`],
          ['財報狀態', editable(org, '財報類型')],
          ['桑基圖狀態', editable(org, '桑基圖上架')],
        ])}
        <p id="field-status" class="small ${profile.error ? 'error-message' : 'muted'}" role="status" ${!profile.error && !Object.keys(profile.fields).length ? 'hidden' : ''}>${escapeHtml(profile.error ?? '欄位修改已儲存在此瀏覽器')}</p>
        <div class="note-composer"><textarea id="local-note" rows="1" placeholder="備註" aria-label="備註" aria-describedby="note-status" ${note.readFailed || note.activity === 'sending' ? 'disabled' : ''}>${escapeHtml(note.notebook.draft)}</textarea><button type="button" id="send-note" class="text-button icon-button" data-action="send-note" aria-label="送出備註" title="送出備註" ${note.readFailed || note.activity !== 'idle' || !note.notebook.draft.trim() ? 'disabled' : ''}>${icon(SentIcon)}</button></div>
        <span id="note-status" class="small ${note.error ? 'error-message' : 'muted'}" role="status">${note.error ? escapeHtml(note.error) : note.activity === 'idle' ? '已儲存在此瀏覽器' : '儲存中…'}</span>
      </section>
      <div class="tabs" role="tablist" aria-label="組織資料分頁">${tabs.map(item => `<button type="button" role="tab" id="tab-${item.id}" data-tab="${item.id}" aria-selected="${tab === item.id}" aria-controls="tab-panel" tabindex="${tab === item.id ? 0 : -1}">${item.label}${item.id === 'history' ? `<span>${org.recordIds.length}</span>` : ''}</button>`).join('')}</div>
      <div id="tab-panel" role="tabpanel" aria-labelledby="tab-${tab}" tabindex="0">${tab === 'history' ? renderHistory(org, historyOptions) : tab === 'notes' ? noteRecords(org) : tab === 'guide' ? renderGuide(org, purposes.get(org.id) ?? '', note.notebook.entries) : other(org)}</div>
    </div>`;
    resizeNote();
  }

  function resizeNote() {
    const textarea = content.querySelector<HTMLTextAreaElement>('#local-note');
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  function render() {
    if (view.kind === 'search') renderSearch();
    else renderDetail(view.orgId, view.tab);
  }

  function performSearch() {
    query = input.value;
    clearButton.hidden = !query;
    view = { kind: 'search' };
    render();
  }

  function clearSearch() {
    input.value = '';
    performSearch();
    input.focus();
  }

  function editField(button: HTMLButtonElement) {
    if (view.kind !== 'detail') return;
    const orgId = view.orgId;
    const key = editableFieldKeys.find(field => field === button.dataset.field);
    if (!key) return;
    const profile = profileFor(orgId);
    if (profile.readFailed) return;
    const value = organization(orgId).sourceFields[key];
    const editor = button.ownerDocument.createElement('input');
    editor.type = 'text';
    editor.className = 'editable editable-input';
    editor.setAttribute('aria-label', key);
    editor.value = value === null ? '' : String(value);
    button.replaceWith(editor);
    editor.focus();
    editor.select();
    let saving = false;
    let cancelled = false;
    editor.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        cancelled = event.key === 'Escape';
        editor.blur();
      }
    });
    editor.addEventListener('blur', async () => {
      if (saving) return;
      if (cancelled || editor.value === (value === null ? '' : String(value))) {
        editor.replaceWith(button);
        return;
      }
      saving = true;
      const revision = ++profile.revision;
      const showStatus = (message: string, error = false) => {
        if (view.kind !== 'detail' || view.orgId !== orgId || profile.revision !== revision) return;
        const status = element<HTMLParagraphElement>('#field-status');
        status.textContent = message;
        status.hidden = false;
        status.classList.toggle('error-message', error);
        status.classList.toggle('muted', !error);
      };
      showStatus('欄位儲存中…');
      try {
        profile.fields = await updateField({ orgId, field: key, text: editor.value });
        profile.error = null;
        const updated = organization(orgId);
        button.textContent = String(updated.sourceFields[key] ?? '未填') || '未填';
        editor.replaceWith(button);
        if (view.kind === 'detail' && view.orgId === orgId) {
          for (const copy of content.querySelectorAll<HTMLButtonElement>(`button[data-field="${CSS.escape(key)}"]`)) {
            copy.textContent = button.textContent;
          }
        }
        showStatus('欄位修改已儲存在此瀏覽器');
      } catch (error) {
        profile.error = `欄位尚未儲存，請保留輸入內容並重試。${error instanceof Error ? error.message : String(error)}`;
        editor.setAttribute('aria-invalid', 'true');
        showStatus(profile.error, true);
      }
      saving = false;
    });
  }

  input.addEventListener('input', event => { if (!('isComposing' in event) || !event.isComposing) performSearch(); });
  input.addEventListener('compositionend', performSearch);
  input.addEventListener('keydown', event => { if (event.key === 'Escape') clearSearch(); });
  root.querySelector('form')?.addEventListener('submit', event => event.preventDefault());
  clearButton.addEventListener('click', clearSearch);

  content.addEventListener('click', async event => {
    if (!isElement(event.target)) return;
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.field) {
      editField(button);
    } else if (button.dataset.orgId) {
      Object.assign(historyOptions, defaultHistoryOptions);
      view = { kind: 'detail', orgId: button.dataset.orgId, tab: 'history' };
      render();
      content.querySelector<HTMLElement>('#detail-title')?.focus();
    } else if (button.dataset.action === 'back') {
      const previousId = view.kind === 'detail' ? view.orgId : null;
      view = { kind: 'search' };
      render();
      if (previousId) content.querySelector<HTMLElement>(`[data-org-id="${CSS.escape(previousId)}"]`)?.focus();
    } else if (button.dataset.action === 'clear') {
      clearSearch();
    } else if (button.dataset.action === 'send-note' && view.kind === 'detail') {
      const orgId = view.orgId;
      const note = noteFor(orgId);
      if (note.readFailed || note.activity !== 'idle' || !note.notebook.draft.trim()) return;
      note.activity = 'sending';
      button.disabled = true;
      element<HTMLTextAreaElement>('#local-note').disabled = true;
      const sentDraft = note.notebook.draft;
      try {
        const saved = await updateNotebook(orgId, { kind: 'append', entry: { id: crypto.randomUUID(), createdAt: new Date().toISOString(), text: sentDraft } });
        if (note.notebook.draft !== sentDraft) saved.draft = note.notebook.draft;
        note.notebook = saved;
        note.error = null;
        if (view.kind === 'detail' && view.orgId === orgId) view = { ...view, tab: 'notes' };
      } catch (error) {
        note.error = `備註未送出，草稿已保留。${error instanceof Error ? error.message : String(error)}`;
      }
      note.activity = 'idle';
      if (view.kind === 'detail' && view.orgId === orgId) render();
    } else if (view.kind === 'detail') {
      if (button.dataset.historyMode === 'list' || button.dataset.historyMode === 'table') {
        historyOptions.mode = button.dataset.historyMode;
        element<HTMLDivElement>('#tab-panel').innerHTML = renderHistory(organization(view.orgId), historyOptions);
        content.querySelector<HTMLButtonElement>(`[data-history-mode="${historyOptions.mode}"]`)?.focus();
        return;
      }
      if (button.dataset.action === 'update-guide') {
        purposes.set(view.orgId, element<HTMLInputElement>('#guide-purpose').value);
        element<HTMLDivElement>('#tab-panel').innerHTML = renderGuide(organization(view.orgId), purposes.get(view.orgId) ?? '', noteFor(view.orgId).notebook.entries);
        return;
      }
      const tab = tabs.find(item => item.id === button.dataset.tab);
      if (tab) {
        view = { ...view, tab: tab.id };
        render();
        content.querySelector<HTMLElement>(`#tab-${tab.id}`)?.focus();
      } else if (button.dataset.record) {
        view = { ...view, tab: 'history' };
        render();
        const record = content.querySelector<HTMLElement>(`#record-${CSS.escape(button.dataset.record)}`);
        if (!record) throw new Error(`找不到原始紀錄 ${button.dataset.record}`);
        for (let parent = record.parentElement; parent; parent = parent.parentElement) {
          if (parent.tagName === 'DETAILS') parent.setAttribute('open', '');
        }
        record.focus();
        record.scrollIntoView({ block: 'center' });
      }
    }
  });

  content.addEventListener('change', event => {
    if (!isElement(event.target) || view.kind !== 'detail') return;
    const select = event.target.closest<HTMLSelectElement>('select[data-history-control]');
    if (!select) return;
    const control = select.dataset.historyControl;
    if (control === 'order' && (select.value === 'newest' || select.value === 'oldest')) historyOptions.order = select.value;
    else if (control === 'category' || control === 'courseCategory') historyOptions[control] = select.value;
    else return;
    element<HTMLDivElement>('#tab-panel').innerHTML = renderHistory(organization(view.orgId), historyOptions);
    content.querySelector<HTMLSelectElement>(`[data-history-control="${control}"]`)?.focus();
  });

  content.addEventListener('keydown', event => {
    if (isElement(event.target) && event.target.id === 'guide-purpose' && event.key === 'Enter' && !event.isComposing) {
      content.querySelector<HTMLButtonElement>('[data-action="update-guide"]')?.click();
    }
    if (!isElement(event.target) || event.target.getAttribute('role') !== 'tab' || view.kind !== 'detail') return;
    const selectedTab = view.tab;
    const index = tabs.findIndex(tab => tab.id === selectedTab);
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
    const tab = next === null ? undefined : tabs[next];
    if (!tab) return;
    event.preventDefault();
    view = { ...view, tab: tab.id };
    render();
    content.querySelector<HTMLElement>(`#tab-${tab.id}`)?.focus();
  });

  content.addEventListener('input', async event => {
    if (isElement(event.target) && event.target.id === 'guide-purpose' && view.kind === 'detail') {
      purposes.set(view.orgId, element<HTMLInputElement>('#guide-purpose').value);
    }
    if (!isElement(event.target) || event.target.id !== 'local-note' || view.kind !== 'detail') return;
    resizeNote();
    const orgId = view.orgId;
    const note = noteFor(orgId);
    note.notebook.draft = element<HTMLTextAreaElement>('#local-note').value;
    const draft = note.notebook.draft;
    note.activity = 'saving';
    element<HTMLSpanElement>('#note-status').textContent = '儲存中…';
    element<HTMLButtonElement>('#send-note').disabled = true;
    try {
      const saved = await updateNotebook(orgId, { kind: 'draft', text: draft });
      note.notebook.entries = saved.entries;
      if (note.notebook.draft !== draft) return;
      note.error = null;
    } catch (error) {
      if (note.notebook.draft !== draft) return;
      note.error = `尚未儲存，請保留此視窗並複製備註。${error instanceof Error ? error.message : String(error)}`;
    }
    note.activity = 'idle';
    if (view.kind !== 'detail' || view.orgId !== orgId) return;
    const status = element<HTMLSpanElement>('#note-status');
    status.textContent = note.error ?? '已儲存在此瀏覽器';
    status.classList.toggle('error-message', Boolean(note.error));
    status.classList.toggle('muted', !note.error);
    element<HTMLButtonElement>('#send-note').disabled = !note.notebook.draft.trim();
  });
  render();
}

start().catch(error => {
  const home = document.querySelector('#home');
  if (!home) throw error;
  home.innerHTML = `<main class="empty-state"><h1>組織資料無法載入</h1><p role="alert">${escapeHtml(error instanceof Error ? error.message : error)}</p><p>請確認 data/mission2.json 存在，並執行 pnpm run data:check。</p></main>`;
});
