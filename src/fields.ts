import * as z from 'zod/mini';
import type { Organization } from './data';

const count = z.number().check(z.int(), z.gte(0));
const fieldsSchema = z.partial(z.strictObject({
  '統一編號（虛構）': z.string(),
  組織名稱: z.string().check(z.minLength(1)),
  一句話簡介: z.string(),
  議題: z.string(),
  服務對象: z.string(),
  區域: z.string(),
  成立年: count,
  入會年: count,
  會籍: z.string(),
  全職人數: z.nullable(count),
  財報類型: z.string(),
  桑基圖上架: z.string(),
  陪跑分級: z.string(),
}));
export const editableFieldKeys = ['統一編號（虛構）', '組織名稱', '一句話簡介', '議題', '服務對象', '區域', '成立年', '入會年', '會籍', '全職人數', '財報類型', '桑基圖上架', '陪跑分級'] as const satisfies readonly (keyof Organization['sourceFields'])[];
export type EditableField = (typeof editableFieldKeys)[number];
export type FieldEdits = z.infer<typeof fieldsSchema>;
const profileSchema = z.strictObject({ version: z.literal(1), fields: fieldsSchema });
const numericFields = new Set<EditableField>(['成立年', '入會年', '全職人數']);
const storageKey = (orgId: string) => `mission2:fields:v1:${orgId}`;

export function readFields(orgId: string): FieldEdits {
  const stored = localStorage.getItem(storageKey(orgId));
  if (stored === null) return {};
  const parsed: unknown = JSON.parse(stored);
  return profileSchema.parse(parsed).fields;
}

export async function updateField({ orgId, field, text }: { orgId: string; field: EditableField; text: string }): Promise<FieldEdits> {
  const trimmed = text.trim();
  const value = numericFields.has(field) ? trimmed === '' ? null : Number(trimmed) : trimmed;
  const change = fieldsSchema.parse({ [field]: value });
  if (!navigator.locks) throw new Error('此瀏覽器無法安全儲存欄位，請使用桌面版 Chrome 或 Edge。');
  return navigator.locks.request(storageKey(orgId), () => {
    const fields = { ...readFields(orgId), ...change };
    localStorage.setItem(storageKey(orgId), JSON.stringify({ version: 1, fields }));
    return fields;
  });
}

export function applyFields(org: Organization, edits: FieldEdits): Organization {
  const sourceFields = { ...org.sourceFields, ...edits };
  return {
    ...org, sourceFields,
    name: sourceFields.組織名稱,
    introduction: sourceFields.一句話簡介,
    issue: sourceFields.議題,
    audiences: sourceFields.服務對象 ? sourceFields.服務對象.split('、') : [],
  };
}
