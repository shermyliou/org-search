import type ExcelJS from 'exceljs';
import { z } from 'zod';

export const ScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type Scalar = z.infer<typeof ScalarSchema>;

export const SourceCellSchema = z.union([
  ScalarSchema,
  z.object({
    formula: z.string(),
    result: ScalarSchema,
  }),
]);
export type SourceCell = z.infer<typeof SourceCellSchema>;

export const ParsedRowSchema = z.object({
  row: z.number().int().positive(),
  values: z.array(SourceCellSchema),
});
export type ParsedRow = z.infer<typeof ParsedRowSchema>;

export const ParsedSheetSchema = z.object({
  sheet: z.string(),
  rows: z.array(ParsedRowSchema),
});
export type ParsedSheet = z.infer<typeof ParsedSheetSchema>;

export const ParsedWorkbookSchema = z.object({
  sourceFilename: z.string(),
  sourceSha256: z.string(),
  sheets: z.array(ParsedSheetSchema),
});
export type ParsedWorkbook = z.infer<typeof ParsedWorkbookSchema>;

export const OrgIdSchema = z.string().regex(/^H\d{2}$/).brand<'OrgId'>();
export type OrgId = z.infer<typeof OrgIdSchema>;

export const RecordIdSchema = z.string().regex(/^R\d{4}$/);
export type RecordId = z.infer<typeof RecordIdSchema>;

export const NoteAnnotationSchema = z.object({
  row: z.number().int().positive(),
  orgId: OrgIdSchema,
  expectedText: z.string(),
  themes: z.array(z.string()),
  actionQuote: z.string(),
  audiences: z.array(z.string()),
  issueSuggestions: z.array(z.string()),
  incomplete: z.boolean(),
});
export type NoteAnnotation = z.infer<typeof NoteAnnotationSchema>;

export const PendingAnnotationSchema = z.object({
  recordId: RecordIdSchema,
  row: z.number().int().positive(),
  candidateOrgId: OrgIdSchema.nullable(),
  expectedName: z.string(),
  reason: z.string(),
});
export type PendingAnnotation = z.infer<typeof PendingAnnotationSchema>;

export const NoteDeltaItemSchema = z.object({
  row: z.number().int().positive(),
  orgId: OrgIdSchema,
  date: z.string(),
  author: z.string(),
  text: z.string(),
  kind: z.enum(['new', 'modified']),
  previousExpectedText: z.string().nullable(),
  aiDraft: z.object({
    themes: z.array(z.string()),
    actionQuote: z.string(),
    audiences: z.array(z.string()),
    issueSuggestions: z.array(z.string()),
    incomplete: z.boolean(),
  }),
});
export type NoteDeltaItem = z.infer<typeof NoteDeltaItemSchema>;

export const PendingDeltaItemSchema = z.object({
  recordId: RecordIdSchema,
  row: z.number().int().positive(),
  date: z.string(),
  contactType: z.string(),
  eventName: z.string(),
  submittedName: z.string(),
  text: z.string(),
  aiDraft: z.object({
    candidateOrgId: OrgIdSchema.nullable(),
    reason: z.string(),
  }),
});
export type PendingDeltaItem = z.infer<typeof PendingDeltaItemSchema>;

export const MasterOrgSummarySchema = z.object({
  id: OrgIdSchema,
  name: z.string(),
  introduction: z.string(),
  issue: z.string(),
  audience: z.string(),
});
export type MasterOrgSummary = z.infer<typeof MasterOrgSummarySchema>;

export const AnalyzeResponseSchema = z.object({
  sourceFilename: z.string(),
  sourceSha256: z.string(),
  masterOrgs: z.array(MasterOrgSummarySchema),
  delta: z.object({
    notes: z.array(NoteDeltaItemSchema),
    pending: z.array(PendingDeltaItemSchema),
  }),
  parsed: ParsedWorkbookSchema,
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export const ApplyRequestSchema = z.object({
  parsed: ParsedWorkbookSchema,
  annotations: z.object({
    notes: z.array(NoteAnnotationSchema),
    pending: z.array(PendingAnnotationSchema),
  }),
});
export type ApplyRequest = z.infer<typeof ApplyRequestSchema>;

export const ApplyResponseSchema = z.object({
  ok: z.literal(true),
  filename: z.string(),
  workbookBase64: z.string(),
  snapshot: z.record(z.string(), z.unknown()),
});
export type ApplyResponse = z.infer<typeof ApplyResponseSchema>;

export type Source = {
  sheet: string;
  row: number;
  values: SourceCell[];
};

export type Association =
  | { status: 'confirmed'; orgId: OrgId; candidateOrgId: null; reason: '' }
  | { status: 'pending'; orgId: null; candidateOrgId: OrgId | null; reason: string };

export type HistoryRecord = {
  id: string;
  originalRecordId: string | null;
  originalOrgId: OrgId | null;
  kind: '接觸紀錄' | '顧問筆記';
  date: string;
  contactType: string;
  eventName: string;
  participantTitle: string;
  submittedName: string;
  text: string;
  dataSource: string;
  author: string;
  incomplete: boolean;
  source: Source;
} & Association;

export type Insight = {
  recordId: string;
  orgId: OrgId;
  field: string;
  value: string;
  basis: '顧問原文明述' | '整理者推論待確認';
  quote: string;
  date: string;
  author: string;
  sourceSheet: string;
  sourceRow: number;
};

export type Organization = {
  id: OrgId;
  name: string;
  introduction: string;
  issue: string;
  originalAudience: string;
  audiences: string[];
  issueSuggestions: Array<{
    value: string;
    basis: '顧問原文明述' | '整理者推論待確認';
    recordId: string;
  }>;
  aliases: string[];
  sourceFields: Record<string, SourceCell>;
  source: Source;
  originalMetrics: Record<string, SourceCell>;
  recordIds: string[];
  candidateRecordIds: string[];
  metrics: {
    contactCount: number;
    latestContact: string | null;
    noteCount: number;
    latestData: string | null;
  };
  noteThemes: string[];
  latestNote: HistoryRecord | null;
  actions: Insight[];
  reminders: string[];
  searchText: string;
};

export type Mission2Snapshot = {
  schemaVersion: number;
  source: {
    filename: string;
    sha256: string;
  };
  sourceCells: ParsedSheet[];
  organizations: Organization[];
  records: HistoryRecord[];
  insights: Insight[];
};

export type TableSpec = {
  name: string;
  table: string;
  headers: string[];
  rows: ExcelJS.CellValue[][];
  widths: number[];
  sourceFilename: string;
};
