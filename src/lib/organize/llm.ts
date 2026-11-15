import { z } from 'zod';
import {
  type MasterOrgSummary,
  type NoteDeltaItem,
  type OrgId,
  OrgIdSchema,
  type PendingDeltaItem,
  RecordIdSchema,
} from './types.ts';

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 30_000;

export const MISSING_API_KEY_MESSAGE =
  '未設定 GEMINI_API_KEY 或 OPENAI_API_KEY，無法執行 AI 建議，但仍可檢視確定性差異。';

const LlmNoteDraftSchema = z.object({
  row: z.number().int().positive(),
  themes: z.array(z.string()),
  actionQuote: z.string(),
  audiences: z.array(z.string()),
  issueSuggestions: z.array(z.string()),
  incomplete: z.boolean(),
});

const LlmPendingDraftSchema = z.object({
  recordId: RecordIdSchema,
  candidateOrgId: z.string().nullable(),
  reason: z.string(),
});

const LlmOutputSchema = z.object({
  notes: z.array(LlmNoteDraftSchema),
  pending: z.array(LlmPendingDraftSchema),
});

export type NoteDraft = NoteDeltaItem['aiDraft'];
export type PendingDraft = PendingDeltaItem['aiDraft'];

export type LlmDeltaResult =
  | {
      available: true;
      provider: 'gemini' | 'openai';
      noteDrafts: Map<number, NoteDraft>;
      pendingDrafts: Map<string, PendingDraft>;
    }
  | {
      available: false;
      provider: 'none' | 'gemini' | 'openai';
      error: string;
    };

function buildPrompt(
  delta: { notes: NoteDeltaItem[]; pending: PendingDeltaItem[] },
  masterOrgs: MasterOrgSummary[],
): string {
  const payload = {
    masterOrgs: masterOrgs.map((org) => ({
      id: org.id,
      name: org.name,
      introduction: org.introduction,
      issue: org.issue,
      audience: org.audience,
    })),
    notes: delta.notes.map((note) => ({
      row: note.row,
      orgId: note.orgId,
      date: note.date,
      author: note.author,
      text: note.text,
      kind: note.kind,
    })),
    pending: delta.pending.map((item) => ({
      recordId: item.recordId,
      date: item.date,
      contactType: item.contactType,
      eventName: item.eventName,
      submittedName: item.submittedName,
      text: item.text,
    })),
  };

  return [
    '你是台灣 NPO 聯盟的資料整理助手。請只根據提供的 delta 項目與 masterOrgs 主檔，回傳嚴格符合以下 JSON 結構的結果，不要輸出多餘文字或 Markdown：',
    '{"notes":[{"row":number,"themes":string[],"actionQuote":string,"audiences":string[],"issueSuggestions":string[],"incomplete":boolean}],"pending":[{"recordId":string,"candidateOrgId":string|null,"reason":string}]}',
    '',
    '嚴格規則：',
    '1. 顧問筆記（notes）：',
    '   - 若筆記明顯未寫完、僅有片段或標註「只寫了一半」等情況，設 incomplete=true，並將 themes、actionQuote、audiences、issueSuggestions 全部設為空（[] 或 ""）。',
    '   - themes：1-3 個簡短繁體中文主題標籤；若 incomplete=true 則為 []。',
    '   - actionQuote：必須是 note.text 的「逐字原句」（exact literal substring），不可改寫；若無明確行動或建議則設為 ""。',
    '   - audiences：必須是 note.text 中「逐字出現」的服務對象名詞；若無則為 []。',
    '   - issueSuggestions：可從筆記推論的議題補充（待確認推論）；若無則為 []。',
    '2. 待確認對應（pending）：',
    '   - candidateOrgId：若能從 masterOrgs 比對出最可能的組織，填寫其 id（格式 Hxx），否則填 null。不可捏造不存在的 id。',
    '   - reason：以「整理者語意建議：...」開頭說明比對理由與待確認原因；若無候選則說明無法比對的原因。',
    '',
    '輸入資料：',
    JSON.stringify(payload),
  ].join('\n');
}

export function sanitizeNoteDraft(
  raw: z.infer<typeof LlmNoteDraftSchema>,
  noteText: string,
): NoteDraft {
  if (raw.incomplete) {
    return {
      themes: [],
      actionQuote: '',
      audiences: [],
      issueSuggestions: [],
      incomplete: true,
    };
  }

  const actionQuote =
    raw.actionQuote && noteText.includes(raw.actionQuote) ? raw.actionQuote : '';
  const audiences = raw.audiences.filter(
    (audience) => audience.length > 0 && noteText.includes(audience),
  );

  return {
    themes: raw.themes.map((t) => t.trim()).filter(Boolean),
    actionQuote,
    audiences: [...new Set(audiences)],
    issueSuggestions: raw.issueSuggestions.map((s) => s.trim()).filter(Boolean),
    incomplete: false,
  };
}

export function sanitizePendingDraft(
  raw: z.infer<typeof LlmPendingDraftSchema>,
  validOrgIds: Set<OrgId>,
): PendingDraft {
  let candidateOrgId: OrgId | null = null;
  if (raw.candidateOrgId !== null) {
    const parsed = OrgIdSchema.safeParse(raw.candidateOrgId);
    if (parsed.success && validOrgIds.has(parsed.data)) {
      candidateOrgId = parsed.data;
    }
  }

  return {
    candidateOrgId,
    reason: raw.reason.trim(),
  };
}

async function callGemini(apiKey: string, prompt: string): Promise<unknown> {
  const response = await fetch(GEMINI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Gemini API HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini API returned empty content');
  }
  return JSON.parse(text);
}

async function callOpenAI(apiKey: string, prompt: string): Promise<unknown> {
  const response = await fetch(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: 'You are a precise JSON-only data tagging assistant. Output valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API HTTP ${response.status}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI API returned empty content');
  }
  return JSON.parse(text);
}

export async function generateDeltaDrafts(
  delta: { notes: NoteDeltaItem[]; pending: PendingDeltaItem[] },
  masterOrgs: MasterOrgSummary[],
): Promise<LlmDeltaResult> {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (!geminiKey && !openaiKey) {
    return {
      available: false,
      provider: 'none',
      error: MISSING_API_KEY_MESSAGE,
    };
  }

  const provider: 'gemini' | 'openai' = geminiKey ? 'gemini' : 'openai';
  const prompt = buildPrompt(delta, masterOrgs);

  try {
    const rawJson = geminiKey
      ? await callGemini(geminiKey, prompt)
      : await callOpenAI(openaiKey as string, prompt);
    const parsed = LlmOutputSchema.parse(rawJson);

    const noteTextByRow = new Map(delta.notes.map((n) => [n.row, n.text]));
    const noteDrafts = new Map<number, NoteDraft>();
    for (const item of parsed.notes) {
      const noteText = noteTextByRow.get(item.row);
      if (noteText !== undefined) {
        noteDrafts.set(item.row, sanitizeNoteDraft(item, noteText));
      }
    }

    const validOrgIds = new Set(masterOrgs.map((org) => org.id));
    const pendingIds = new Set(delta.pending.map((p) => p.recordId));
    const pendingDrafts = new Map<string, PendingDraft>();
    for (const item of parsed.pending) {
      if (pendingIds.has(item.recordId)) {
        pendingDrafts.set(item.recordId, sanitizePendingDraft(item, validOrgIds));
      }
    }

    return {
      available: true,
      provider,
      noteDrafts,
      pendingDrafts,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown LLM error';
    return {
      available: false,
      provider,
      error: `AI 建議產生失敗（${message}），仍可檢視確定性差異。`,
    };
  }
}
