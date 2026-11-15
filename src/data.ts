import Fuse from 'fuse.js';
import snapshot from '../data/mission2.json';

type SourceOrganization = (typeof snapshot.organizations)[number];
export type Organization = Omit<SourceOrganization, 'sourceFields'> & {
  sourceFields: { [Field in keyof SourceOrganization['sourceFields']]: SourceOrganization['sourceFields'][Field] };
};
export type HistoryRecord = (typeof snapshot.records)[number];
export type Insight = (typeof snapshot.insights)[number];
export const organizations: Organization[] = snapshot.organizations;
export const sourceFilename = snapshot.source.filename;

const byId = new Map(organizations.map(org => [org.id, org]));
const recordsById = new Map(snapshot.records.map(record => [record.id, record]));

if (snapshot.schemaVersion !== 1 || !organizations.length) {
  throw new Error('data/mission2.json 版本不符或沒有組織資料，請執行 pnpm run data:check。');
}
if (byId.size !== organizations.length || recordsById.size !== snapshot.records.length) {
  throw new Error('data/mission2.json 有重複編號，請執行 pnpm run data:check。');
}
for (const org of organizations) {
  for (const id of org.recordIds) {
    const record = recordsById.get(id);
    if (!record || record.status !== 'confirmed' || record.orgId !== org.id) {
      throw new Error(`組織 ${org.id} 的正式歷史 ${id} 對應錯誤。`);
    }
  }
  for (const id of org.candidateRecordIds) {
    const record = recordsById.get(id);
    if (!record || record.status !== 'pending' || record.orgId !== null || record.candidateOrgId !== org.id) {
      throw new Error(`組織 ${org.id} 的待確認歷史 ${id} 對應錯誤。`);
    }
  }
}

const search = new Fuse(organizations, {
  keys: [
    { name: 'name', weight: 5 },
    { name: 'aliases', weight: 4 },
    { name: 'id', weight: 3 },
    { name: 'introduction', weight: 2 },
    { name: 'issue', weight: 2 },
    { name: 'audiences', weight: 2 },
    { name: 'sourceFields.區域', weight: 2 },
    { name: 'searchText', weight: 1 },
  ],
  ignoreLocation: true,
  ignoreFieldNorm: true,
  threshold: 0.25,
});

export function searchOrganizations(query: string, collection: Organization[] = organizations): Organization[] {
  search.setCollection(collection);
  const term = query.trim();
  return term ? search.search(term).map(result => result.item) : collection;
}

export function getOrganization(id: string): Organization {
  const org = byId.get(id);
  if (!org) throw new Error(`找不到組織 ${id}。`);
  return org;
}

export function getHistory(org: Organization) {
  const newestFirst = (records: HistoryRecord[]) => records.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return {
    confirmed: newestFirst(snapshot.records.filter(record => record.status === 'confirmed' && record.orgId === org.id)),
    pending: newestFirst(snapshot.records.filter(record => record.status === 'pending' && record.candidateOrgId === org.id)),
  };
}

export function getInsights(org: Organization): Insight[] {
  return snapshot.insights.filter(insight => insight.orgId === org.id).sort((a, b) => b.date.localeCompare(a.date));
}

export function contactCounts(records: HistoryRecord[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.status !== 'confirmed' || record.kind !== '接觸紀錄') continue;
    counts.set(record.contactType, (counts.get(record.contactType) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}
