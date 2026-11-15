import { z } from 'zod';
import { setSnapshot } from './data';
import {
  type AnalyzeResponse,
  AnalyzeResponseSchema,
  type ApplyRequest,
  ApplyResponseSchema,
  type Mission2Snapshot,
  type NoteAnnotation,
  type NoteDeltaItem,
  OrgIdSchema,
  type PendingAnnotation,
  type PendingDeltaItem,
} from './lib/organize/types';

export type OrganizeLlmStatus = {
  available: boolean;
  error?: string | null;
};

export type OrganizeSummary = {
  organizations?: number;
  contacts?: number;
  notes?: number;
  pending?: number;
};

export type OrganizeStats = {
  organizations?: number;
  records?: number;
  notes?: number;
  pending?: number;
  insights?: number;
};

export type AnalyzePayload = AnalyzeResponse & {
  llmStatus?: OrganizeLlmStatus;
  summary?: OrganizeSummary;
};

export type NoteDecision = {
  status: 'approved' | 'skipped';
  draft: NoteAnnotation;
};

export type PendingDecision = {
  status: 'approved' | 'skipped';
  draft: PendingAnnotation;
};

export type OrganizeViewState =
  | { step: 'upload'; isSubmitting: boolean; error: string | null }
  | {
      step: 'review';
      analyze: AnalyzePayload;
      noteDecisions: Map<number, NoteDecision>;
      pendingDecisions: Map<string, PendingDecision>;
      isApplying: boolean;
      error: string | null;
    }
  | {
      step: 'generated';
      filename: string;
      xlsxBase64: string;
      stats: OrganizeStats;
    };

const AnalyzePayloadSchema = AnalyzeResponseSchema.extend({
  llmStatus: z
    .object({
      available: z.boolean(),
      error: z.string().nullable().optional(),
    })
    .optional(),
  summary: z
    .object({
      organizations: z.number().int().nonnegative().optional(),
      contacts: z.number().int().nonnegative().optional(),
      notes: z.number().int().nonnegative().optional(),
      pending: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const ApplyStatsSchema = z.object({
  organizations: z.number().int().nonnegative().optional(),
  records: z.number().int().nonnegative().optional(),
  notes: z.number().int().nonnegative().optional(),
  pending: z.number().int().nonnegative().optional(),
  insights: z.number().int().nonnegative().optional(),
});

const ApplyPayloadSchema = z.object({
  ok: z.literal(true),
  filename: z.string(),
  workbookBase64: z.string().optional(),
  xlsxBase64: z.string().optional(),
  stats: ApplyStatsSchema.optional(),
  snapshot: z.record(z.string(), z.unknown()),
});

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const splitTags = (value: string) =>
  value
    .split(/[,，、]/)
    .map(item => item.trim())
    .filter(Boolean);

function createInitialDecisions(analyze: AnalyzePayload) {
  const noteDecisions = new Map<number, NoteDecision>();
  for (const item of analyze.delta.notes) {
    noteDecisions.set(item.row, {
      status: 'approved',
      draft: {
        row: item.row,
        orgId: item.orgId,
        expectedText: item.text,
        themes: [...item.aiDraft.themes],
        actionQuote: item.aiDraft.actionQuote,
        audiences: [...item.aiDraft.audiences],
        issueSuggestions: [...item.aiDraft.issueSuggestions],
        incomplete: item.aiDraft.incomplete,
      },
    });
  }

  const pendingDecisions = new Map<string, PendingDecision>();
  for (const item of analyze.delta.pending) {
    pendingDecisions.set(item.recordId, {
      status: 'approved',
      draft: {
        recordId: item.recordId,
        row: item.row,
        candidateOrgId: item.aiDraft.candidateOrgId,
        expectedName: item.submittedName,
        reason: item.aiDraft.reason,
      },
    });
  }

  return { noteDecisions, pendingDecisions };
}

function downloadBase64Xlsx(filename: string, base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function deriveStats(snapshot: Mission2Snapshot, explicit?: OrganizeStats): OrganizeStats {
  if (explicit) return explicit;
  const notes = snapshot.records.filter(record => record.kind === '顧問筆記').length;
  const pending = snapshot.records.filter(record => record.status === 'pending').length;
  return {
    organizations: snapshot.organizations.length,
    records: snapshot.records.length,
    notes,
    pending,
    insights: snapshot.insights.length,
  };
}

function renderDecisionButtons(kind: 'note' | 'pending', key: string, status: 'approved' | 'skipped') {
  const attr = kind === 'note' ? `data-note-action` : `data-pending-action`;
  const idAttr = kind === 'note' ? `data-row="${escapeHtml(key)}"` : `data-record-id="${escapeHtml(key)}"`;
  return `<div class="organize-actions">
    <button type="button" class="outline secondary" ${attr}="approve" ${idAttr} aria-pressed="${status === 'approved'}">確認</button>
    <button type="button" class="outline secondary" ${attr}="skip" ${idAttr} aria-pressed="${status === 'skipped'}">略過</button>
  </div>`;
}

function renderNoteFieldset(item: NoteDeltaItem, decision: NoteDecision, orgName: string): string {
  const { draft, status } = decision;
  const statusLabel = status === 'approved' ? '已確認' : '已略過';
  return `<fieldset class="organize-item" data-note-row="${item.row}">
    <legend>列 ${item.row} · ${escapeHtml(orgName)}（${escapeHtml(item.orgId)}）· ${escapeHtml(item.date)} · ${item.kind === 'modified' ? '異動' : '新增'} · <span class="status-tag" data-status-badge>${statusLabel}</span></legend>
    <p class="record-text">${escapeHtml(item.text)}</p>
    <details class="record-source">
      <summary>來源：列 ${item.row} · ${escapeHtml(item.author || '未填作者')}</summary>
      ${item.previousExpectedText ? `<p class="muted small">原內容：${escapeHtml(item.previousExpectedText)}</p>` : ''}
    </details>
    ${renderDecisionButtons('note', String(item.row), status)}
    <div class="organize-fields">
      <label>主題標籤（逗號分隔）<input type="text" data-note-field="themes" data-row="${item.row}" value="${escapeHtml(draft.themes.join(', '))}" /></label>
      <label>行動摘要<input type="text" data-note-field="actionQuote" data-row="${item.row}" value="${escapeHtml(draft.actionQuote)}" /></label>
      <label>服務對象（逗號分隔）<input type="text" data-note-field="audiences" data-row="${item.row}" value="${escapeHtml(draft.audiences.join(', '))}" /></label>
      <label>議題建議（逗號分隔）<input type="text" data-note-field="issueSuggestions" data-row="${item.row}" value="${escapeHtml(draft.issueSuggestions.join(', '))}" /></label>
      <label class="organize-checkbox"><input type="checkbox" data-note-field="incomplete" data-row="${item.row}" ${draft.incomplete ? 'checked' : ''} /> 不完整，待補寫</label>
    </div>
  </fieldset>`;
}

function renderPendingFieldset(
  item: PendingDeltaItem,
  decision: PendingDecision,
  masterOrgs: AnalyzePayload['masterOrgs'],
): string {
  const { draft, status } = decision;
  const statusLabel = status === 'approved' ? '已確認' : '已略過';
  const options = [
    `<option value="">未指定（待確認）</option>`,
    ...masterOrgs.map(
      org =>
        `<option value="${escapeHtml(org.id)}" ${draft.candidateOrgId === org.id ? 'selected' : ''}>${escapeHtml(org.id)} ${escapeHtml(org.name)}</option>`,
    ),
  ].join('');
  return `<fieldset class="organize-item" data-pending-id="${escapeHtml(item.recordId)}">
    <legend>${escapeHtml(item.recordId)} · 列 ${item.row} · ${escapeHtml(item.submittedName)} · <span class="status-tag" data-status-badge>${statusLabel}</span></legend>
    <p class="muted small">${escapeHtml(item.date)} · ${escapeHtml(item.contactType)} · ${escapeHtml(item.eventName)}</p>
    ${item.text ? `<details class="record-source"><summary>原始內容</summary><p class="record-text">${escapeHtml(item.text)}</p></details>` : ''}
    ${renderDecisionButtons('pending', item.recordId, status)}
    <div class="organize-fields">
      <label>候選組織<select data-pending-field="candidateOrgId" data-record-id="${escapeHtml(item.recordId)}">${options}</select></label>
      <label>比對說明<input type="text" data-pending-field="reason" data-record-id="${escapeHtml(item.recordId)}" value="${escapeHtml(draft.reason)}" /></label>
    </div>
  </fieldset>`;
}

export function renderOrganizeView(
  container: HTMLElement,
  state: OrganizeViewState,
  onStateChange: (next: OrganizeViewState) => void,
  onDone: () => void,
): void {
  const panel = document.createElement('div');
  container.replaceChildren(panel);

  const render = (current: OrganizeViewState) => {
    if (current.step === 'upload') {
      panel.innerHTML = `<section class="organize-view" aria-label="資料整理">
        <div class="section-heading"><h2>資料整理</h2><span>步驟 1 / 3 · 上傳檔案</span></div>
        <form class="organize-upload-form">
          <label for="organize-file">選擇 Excel 檔案（.xlsx）</label>
          <input id="organize-file" name="file" type="file" accept=".xlsx" required ${current.isSubmitting ? 'disabled' : ''} />
          ${current.error ? `<p class="error-message" role="alert">${escapeHtml(current.error)}</p>` : ''}
          <div class="organize-actions">
            <button type="submit" ${current.isSubmitting ? 'disabled' : ''}>${current.isSubmitting ? '分析中…' : '分析檔案'}</button>
            <button type="button" class="outline secondary" data-organize-action="back">返回組織速查</button>
          </div>
        </form>
      </section>`;

      const form = panel.querySelector<HTMLFormElement>('.organize-upload-form');
      const fileInput = panel.querySelector<HTMLInputElement>('#organize-file');
      form?.addEventListener('submit', async event => {
        event.preventDefault();
        const file = fileInput?.files?.[0];
        if (!file) {
          onStateChange({ step: 'upload', isSubmitting: false, error: '請先選擇 .xlsx 檔案。' });
          return;
        }
        onStateChange({ step: 'upload', isSubmitting: true, error: null });
        try {
          const formData = new FormData();
          formData.append('file', file);
          const response = await fetch('/api/organize/analyze', { method: 'POST', body: formData });
          const raw = await response.json().catch(() => null);
          if (!response.ok) {
            const message =
              raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
                ? raw.error
                : `分析失敗（HTTP ${response.status}）。`;
            throw new Error(message);
          }
          const parsed = AnalyzePayloadSchema.safeParse(raw);
          if (!parsed.success) {
            throw new Error('伺服器回傳的分析格式不符預期。');
          }
          const analyze = parsed.data;
          const { noteDecisions, pendingDecisions } = createInitialDecisions(analyze);
          onStateChange({
            step: 'review',
            analyze,
            noteDecisions,
            pendingDecisions,
            isApplying: false,
            error: null,
          });
        } catch (error) {
          onStateChange({
            step: 'upload',
            isSubmitting: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      panel.querySelector('[data-organize-action="back"]')?.addEventListener('click', onDone);
      return;
    }

    if (current.step === 'review') {
      const { analyze, noteDecisions, pendingDecisions } = current;
      const orgNames = new Map(analyze.masterOrgs.map(org => [org.id, org.name]));
      const llmStatus = analyze.llmStatus;
      const showLlmWarning = Boolean(llmStatus && (!llmStatus.available || llmStatus.error));
      const summary = analyze.summary;
      const orgCount = summary?.organizations ?? analyze.masterOrgs.length;
      const contactCount = summary?.contacts;
      const noteCount = summary?.notes ?? analyze.delta.notes.length;
      const pendingCount = summary?.pending ?? analyze.delta.pending.length;

      panel.innerHTML = `<section class="organize-view" aria-label="資料整理檢視">
        <div class="section-heading"><h2>檢視異動項目</h2><span>步驟 2 / 3 · ${escapeHtml(analyze.sourceFilename)}</span></div>
        <div class="counts organize-summary">
          <span>組織 <strong>${orgCount}</strong></span>
          ${contactCount === undefined ? '' : `<span>接觸紀錄 <strong>${contactCount}</strong></span>`}
          <span>顧問筆記 <strong>${noteCount}</strong></span>
          <span>待確認項目 <strong>${pendingCount}</strong></span>
        </div>
        ${
          showLlmWarning
            ? `<p class="organize-warning" role="status">AI 輔助整理目前無法使用${llmStatus?.error ? `（${escapeHtml(llmStatus.error)}）` : ''}，仍可手動檢視與編輯。</p>`
            : ''
        }
        ${
          analyze.delta.notes.length === 0 && analyze.delta.pending.length === 0
            ? `<p class="muted">沒有新增或異動項目，可直接產生整理檔。</p>`
            : ''
        }
        ${
          analyze.delta.notes.length
            ? `<h3>顧問筆記（${analyze.delta.notes.length}）</h3>${analyze.delta.notes
                .map(item => {
                  const decision = noteDecisions.get(item.row);
                  if (!decision) return '';
                  return renderNoteFieldset(item, decision, orgNames.get(item.orgId) ?? item.orgId);
                })
                .join('')}`
            : ''
        }
        ${
          analyze.delta.pending.length
            ? `<h3>待確認組織比對（${analyze.delta.pending.length}）</h3>${analyze.delta.pending
                .map(item => {
                  const decision = pendingDecisions.get(item.recordId);
                  if (!decision) return '';
                  return renderPendingFieldset(item, decision, analyze.masterOrgs);
                })
                .join('')}`
            : ''
        }
        ${current.error ? `<p class="error-message" role="alert">${escapeHtml(current.error)}</p>` : ''}
        <div class="organize-actions">
          <button type="button" data-organize-action="apply" ${current.isApplying ? 'disabled' : ''}>${current.isApplying ? '套用中…' : '套用並產生整理檔'}</button>
          <button type="button" class="outline secondary" data-organize-action="reset" ${current.isApplying ? 'disabled' : ''}>重新上傳</button>
        </div>
      </section>`;

      const syncDecisionBadge = (fieldset: Element | null, status: 'approved' | 'skipped') => {
        if (!fieldset) return;
        const badge = fieldset.querySelector('[data-status-badge]');
        if (badge) badge.textContent = status === 'approved' ? '已確認' : '已略過';
        const approveBtn = fieldset.querySelector<HTMLButtonElement>('[data-note-action="approve"], [data-pending-action="approve"]');
        const skipBtn = fieldset.querySelector<HTMLButtonElement>('[data-note-action="skip"], [data-pending-action="skip"]');
        approveBtn?.setAttribute('aria-pressed', String(status === 'approved'));
        skipBtn?.setAttribute('aria-pressed', String(status === 'skipped'));
      };

      panel.addEventListener('click', async event => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const button = target.closest('button');
        if (!button) return;

        if (button.dataset.noteAction && button.dataset.row) {
          const row = Number(button.dataset.row);
          const decision = noteDecisions.get(row);
          if (!decision) return;
          decision.status = button.dataset.noteAction === 'approve' ? 'approved' : 'skipped';
          syncDecisionBadge(button.closest('fieldset'), decision.status);
          return;
        }

        if (button.dataset.pendingAction && button.dataset.recordId) {
          const decision = pendingDecisions.get(button.dataset.recordId);
          if (!decision) return;
          decision.status = button.dataset.pendingAction === 'approve' ? 'approved' : 'skipped';
          syncDecisionBadge(button.closest('fieldset'), decision.status);
          return;
        }

        if (button.dataset.organizeAction === 'reset') {
          onStateChange({ step: 'upload', isSubmitting: false, error: null });
          return;
        }

        if (button.dataset.organizeAction === 'apply') {
          onStateChange({ ...current, isApplying: true, error: null });
          try {
            const payload: ApplyRequest = {
              parsed: analyze.parsed,
              annotations: {
                notes: [...noteDecisions.values()].filter(d => d.status === 'approved').map(d => d.draft),
                pending: [...pendingDecisions.values()].filter(d => d.status === 'approved').map(d => d.draft),
              },
            };
            const response = await fetch('/api/organize/apply', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });
            const raw = await response.json().catch(() => null);
            if (!response.ok) {
              const message =
                raw && typeof raw === 'object' && 'error' in raw && typeof raw.error === 'string'
                  ? raw.error
                  : `套用失敗（HTTP ${response.status}）。`;
              throw new Error(message);
            }
            const parsed = ApplyPayloadSchema.safeParse(raw);
            if (!parsed.success) {
              throw new Error('伺服器回傳的整理結果格式不符預期。');
            }
            const base64 = parsed.data.xlsxBase64 ?? parsed.data.workbookBase64;
            if (!base64) {
              throw new Error('伺服器未回傳 Excel 檔案內容。');
            }
            const applyChecked = ApplyResponseSchema.safeParse({
              ok: parsed.data.ok,
              filename: parsed.data.filename,
              workbookBase64: base64,
              snapshot: parsed.data.snapshot,
            });
            if (!applyChecked.success) {
              throw new Error('整理結果資料驗證失敗。');
            }
            const snapshot = parsed.data.snapshot as unknown as Mission2Snapshot;
            setSnapshot(snapshot);
            onStateChange({
              step: 'generated',
              filename: parsed.data.filename,
              xlsxBase64: base64,
              stats: deriveStats(snapshot, parsed.data.stats),
            });
          } catch (error) {
            onStateChange({
              ...current,
              isApplying: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });

      const handleFieldEdit = (event: Event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.dataset.noteField && target.dataset.row) {
          const decision = noteDecisions.get(Number(target.dataset.row));
          if (!decision) return;
          const field = target.dataset.noteField;
          if (field === 'themes') decision.draft.themes = splitTags(target.value);
          else if (field === 'actionQuote') decision.draft.actionQuote = target.value;
          else if (field === 'audiences') decision.draft.audiences = splitTags(target.value);
          else if (field === 'issueSuggestions') decision.draft.issueSuggestions = splitTags(target.value);
          else if (field === 'incomplete') decision.draft.incomplete = target.checked;
        } else if (
          (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) &&
          target.dataset.pendingField &&
          target.dataset.recordId
        ) {
          const decision = pendingDecisions.get(target.dataset.recordId);
          if (!decision) return;
          const field = target.dataset.pendingField;
          if (field === 'candidateOrgId') {
            decision.draft.candidateOrgId = target.value ? OrgIdSchema.parse(target.value) : null;
          } else if (field === 'reason') {
            decision.draft.reason = target.value;
          }
        }
      };

      panel.addEventListener('input', handleFieldEdit);
      panel.addEventListener('change', handleFieldEdit);
      return;
    }

    const { filename, xlsxBase64, stats } = current;
    panel.innerHTML = `<section class="organize-view" aria-label="整理完成">
      <div class="section-heading"><h2>整理檔已產生</h2><span>步驟 3 / 3 · 完成</span></div>
      <div class="counts organize-summary">
        ${stats.organizations === undefined ? '' : `<span>組織 <strong>${stats.organizations}</strong></span>`}
        ${stats.records === undefined ? '' : `<span>總紀錄 <strong>${stats.records}</strong></span>`}
        ${stats.notes === undefined ? '' : `<span>顧問筆記 <strong>${stats.notes}</strong></span>`}
        ${stats.pending === undefined ? '' : `<span>待確認項目 <strong>${stats.pending}</strong></span>`}
        ${stats.insights === undefined ? '' : `<span>洞察數 <strong>${stats.insights}</strong></span>`}
      </div>
      <p class="muted small">檔案名稱：${escapeHtml(filename)}（已同步更新本頁搜尋資料）</p>
      <div class="organize-actions">
        <button type="button" data-organize-action="download">下載整理版 Excel</button>
        <button type="button" class="outline secondary" data-organize-action="back">返回組織速查</button>
      </div>
    </section>`;

    panel.querySelector('[data-organize-action="download"]')?.addEventListener('click', () => {
      downloadBase64Xlsx(filename, xlsxBase64);
    });
    panel.querySelector('[data-organize-action="back"]')?.addEventListener('click', () => {
      onStateChange({ step: 'upload', isSubmitting: false, error: null });
      onDone();
    });
  };

  render(state);
}
