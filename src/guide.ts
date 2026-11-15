import { getHistory, getInsights, type HistoryRecord, type Organization } from './data';
import type { Notebook } from './notes';

type Evidence =
  | { kind: 'record' | 'observation'; record: HistoryRecord }
  | { kind: 'local'; entry: Notebook['entries'][number] }
  | { kind: 'gap'; field: string }
  | { kind: 'purpose'; purpose: string };
type Question = { question: string; why: string; information: string; evidence: Evidence };

const escapeHtml = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');

function historyQuestion(record: HistoryRecord): Question {
  const event = record.eventName || record.contactType;
  const fromSearch = record.dataSource.includes('搜尋');
  const questions: Record<string, string> = {
    培力課程: `先前曾為「${event}」留下資料，現在對這個主題有沒有想進一步了解的地方？`,
    課後追蹤: `關於「${event}」，方便分享最近是否有相關的新進展嗎？`,
    陪跑計畫: `關於「${event}」，目前有沒有希望一起討論的事情？`,
    危機事件: '先前聯繫過的事情，目前有沒有希望我們協助的地方？',
    危機後續關心: '上次關心的事情，最近有沒有新的情況想讓我們知道？',
    客服聯繫: '上次與我們聯繫後，目前有沒有還想進一步了解的地方？',
    入會審查: '關於入會後的服務，目前有沒有想進一步了解的地方？',
    獎補助入選: '關於先前獎補助的相關資訊，方便確認目前有沒有想交流的事情嗎？',
    走訪: '先前走訪之後，組織最近有沒有想和我們分享的新進展？',
    財報上架: '關於財務資訊的公開，目前有沒有想進一步了解的地方？',
  };
  return {
    question: fromSearch ? `我們曾整理到「${event}」的公開資訊，方便先請您確認目前的情況嗎？` : questions[record.contactType] ?? `關於「${event}」，最近有沒有想和我們分享的新進展？`,
    why: fromSearch ? `${record.date} 的資料來自公開資訊搜尋，需先由會員確認內容與近況。` : `有 ${record.date} 的${record.contactType}紀錄，可先確認當時事項的近況，避免直接沿用舊資料。`,
    information: '這件事目前的進展，以及現在是否需要協助。',
    evidence: { kind: 'record', record },
  };
}

function evidenceText(org: Organization, evidence: Evidence): string {
  switch (evidence.kind) {
    case 'record':
    case 'observation': {
      const { record } = evidence;
      return `<strong>${evidence.kind === 'record' ? '【紀錄追蹤】' : '【顧問觀察】'}</strong>
        <p class="small">${escapeHtml(record.id)} · <time datetime="${escapeHtml(record.date)}">${escapeHtml(record.date)}</time>${evidence.kind === 'observation' ? ` · 記錄者 ${escapeHtml(record.author || '未填')}` : ''}</p>
        <p class="record-text">${escapeHtml(record.text)}</p>
        <p class="muted small">${escapeHtml(record.source.sheet)} · 第 ${record.source.row} 列 · ${escapeHtml(record.dataSource)}${record.incomplete ? ' · 不完整，待補寫' : ''}</p>
        <button type="button" class="text-button" data-record="${escapeHtml(record.id)}">查看原始紀錄</button>`;
    }
    case 'local':
      return `<strong>【顧問觀察】</strong><p class="small">本機備註 · 記錄者 本機使用者 · <time datetime="${escapeHtml(evidence.entry.createdAt)}">${escapeHtml(evidence.entry.createdAt)}</time> · ${escapeHtml(evidence.entry.id)}</p><p class="record-text">${escapeHtml(evidence.entry.text)}</p><p class="muted small">本機使用者的紀錄，尚未由會員確認。</p>`;
    case 'gap':
      return `<strong>【資料缺口】</strong><p>${escapeHtml(org.source.sheet)} · 第 ${org.source.row} 列 · ${escapeHtml(org.id)}</p><p>缺漏欄位：${escapeHtml(evidence.field)}。</p>`;
    case 'purpose':
      return `<strong>【本次需求確認】</strong><p>本次來電目的：${escapeHtml(evidence.purpose)}</p><p>尚未提供會員希望優先討論的具體事項；此題依本次輸入提出，無歷史紀錄作為依據。</p>`;
  }
}

export function renderGuide(org: Organization, purpose: string, localEntries: Notebook['entries']): string {
  const { confirmed } = getHistory(org);
  const contacts = confirmed.filter(record => record.kind === '接觸紀錄' && record.contactType !== '會員大會' && record.text.trim());
  const consultantNotes = confirmed.filter(record => record.kind === '顧問筆記');
  const latestNote = consultantNotes.find(record => record.text.trim());
  const latestLocal = [...localEntries].filter(entry => entry.text.trim()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const questions: Question[] = [];
  const firstContact = contacts[0];
  if (firstContact) questions.push(historyQuestion(firstContact));

  if (latestLocal && (!latestNote || latestLocal.createdAt > latestNote.date)) {
    questions.push({
      question: '最近在組織工作上，有哪些事情希望我們一起討論？',
      why: '最近一筆本機備註可以提醒聯繫方向，仍須直接向會員確認現況，避免把記錄者的觀察當作事實。',
      information: '會員對目前情況的描述，以及希望優先處理的需求。',
      evidence: { kind: 'local', entry: latestLocal },
    });
  } else if (latestNote) {
    questions.push({
      question: '最近推動組織工作時，有沒有什麼想請我們協助的地方？',
      why: `${latestNote.date} 的顧問觀察是當時的判斷，適合以中性問法確認近況，不將內部評語直接念給會員。`,
      information: '會員確認的最新近況、與當時觀察的差異，以及目前的協助意願。',
      evidence: { kind: 'observation', record: latestNote },
    });
  }

  const missingField = Object.entries(org.sourceFields).find(([, value]) => value === null || value === '')?.[0];
  if (purpose.trim()) {
    questions.push({
      question: `這次想和您聊聊「${purpose.trim()}」，您最希望先討論哪一件事？`,
      why: '先確認會員對本次來電目的的期待，再決定要提供哪些服務資訊。',
      information: '會員這次希望優先討論的具體事項。',
      evidence: { kind: 'purpose', purpose: purpose.trim() },
    });
  } else if (missingField) {
    questions.push({
      question: `方便請您幫我們補充一下組織目前的「${missingField}」嗎？`,
      why: `組織主檔未填「${missingField}」，先補上資料，才能依現況討論合適的服務。`,
      information: `會員確認的「${missingField}」，以及資料適用的時間。`,
      evidence: { kind: 'gap', field: missingField },
    });
  } else {
    const otherContact = contacts.find(record => record.id !== firstContact?.id && record.contactType !== firstContact?.contactType && record.eventName !== firstContact?.eventName);
    if (otherContact) questions.push(historyQuestion(otherContact));
  }

  const insights = getInsights(org).filter(insight => confirmed.some(record => record.id === insight.recordId));
  const actions = org.actions.filter(action => confirmed.some(record => record.id === action.recordId));
  return `<section class="guide-section" aria-label="互動指南">
    <h3>AI 建議 PM 可以怎麼問</h3>
    <p class="muted small">依已確認資料整理的提問建議。電話中可優先挑選約三題，並依對方回答調整。</p>
    <div class="guide-purpose"><label for="guide-purpose" class="sr-only">本次來電目的</label><input id="guide-purpose" type="text" placeholder="本次來電目的，例如了解目前需求" value="${escapeHtml(purpose)}" /><button type="button" class="outline secondary compact-button" data-action="update-guide">更新建議</button></div>
    ${questions.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="電話提問建議"><table class="question-table"><thead><tr><th scope="col">優先順序</th><th scope="col">建議問法</th><th scope="col">為什麼值得問</th><th scope="col">可回追的依據</th><th scope="col">回答後可取得的資訊</th></tr></thead><tbody>${questions.slice(0, 3).map((question, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(question.question)}</td><td>${escapeHtml(question.why)}</td><td>${evidenceText(org, question.evidence)}</td><td>${escapeHtml(question.information)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">尚無足夠的已確認紀錄可供追蹤。填入本次來電目的後，可先確認會員希望討論的事項。</p>'}
    <details class="guide-context"><summary>查看顧問觀察與原始脈絡</summary>
      ${actions.length ? `<h4>顧問行動與建議原文</h4><ul class="plain-list">${actions.map(action => `<li><p class="record-text">${escapeHtml(action.value)}</p><p class="muted small">${escapeHtml(action.recordId)} · ${escapeHtml(action.date)} · ${escapeHtml(action.author)} · ${escapeHtml(action.sourceSheet)} 第 ${action.sourceRow} 列</p><button type="button" class="text-button" data-record="${escapeHtml(action.recordId)}">查看原始紀錄</button></li>`).join('')}</ul>` : ''}
      ${insights.length ? `<h4>顧問觀察與資料補充</h4><ul class="plain-list">${insights.map(insight => `<li><p>${escapeHtml(insight.field)} <span class="tentative">${escapeHtml(insight.basis)}</span></p><p>${escapeHtml(insight.value)}</p><p class="record-text">${escapeHtml(insight.quote)}</p><p class="muted small">${escapeHtml(insight.recordId)} · ${escapeHtml(insight.date)} · ${escapeHtml(insight.author)} · ${escapeHtml(insight.sourceSheet)} 第 ${insight.sourceRow} 列</p><button type="button" class="text-button" data-record="${escapeHtml(insight.recordId)}">查看原始紀錄</button></li>`).join('')}</ul>` : ''}
      <h4>顧問筆記原文</h4>${consultantNotes.length ? `<ul class="plain-list">${consultantNotes.map(record => `<li><p class="record-text">${escapeHtml(record.text)}</p><p class="muted small">${escapeHtml(record.id)} · ${escapeHtml(record.date)} · 記錄者 ${escapeHtml(record.author || '未填')} · ${escapeHtml(record.source.sheet)} 第 ${record.source.row} 列${record.incomplete ? ' · 不完整，待補寫' : ''}</p><button type="button" class="text-button" data-record="${escapeHtml(record.id)}">查看原始紀錄</button></li>`).join('')}</ul>` : '<p class="muted">尚無顧問筆記，只代表尚未記錄。</p>'}
      <h4>資料提醒</h4><ul>${org.reminders.map(reminder => `<li>${escapeHtml(reminder)}</li>`).join('')}</ul>
    </details>
  </section>`;
}
