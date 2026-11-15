import Fuse from 'fuse.js';
import initialSnapshot from '../data/mission2.json';
import type { Mission2Snapshot } from './lib/organize/types';

type Snapshot = typeof initialSnapshot;
type SourceOrganization = Snapshot['organizations'][number];
export type Organization = Omit<SourceOrganization, 'sourceFields'> & {
  sourceFields: { [Field in keyof SourceOrganization['sourceFields']]: SourceOrganization['sourceFields'][Field] };
};
export type HistoryRecord = Snapshot['records'][number];
export type Insight = Snapshot['insights'][number];

let currentSnapshot: Snapshot = initialSnapshot;
export const organizations: Organization[] = [...currentSnapshot.organizations];
export let sourceFilename = currentSnapshot.source.filename;

export function getSourceFilename(): string {
  return sourceFilename;
}

function validateAndIndex(candidate: Snapshot) {
  if (candidate.schemaVersion !== 1 || !candidate.organizations.length) {
    throw new Error('data/mission2.json 版本不符或沒有組織資料，請執行 pnpm run data:check。');
  }
  const nextById = new Map<string, Organization>(candidate.organizations.map(org => [org.id, org]));
  const nextRecordsById = new Map<string, HistoryRecord>(candidate.records.map(record => [record.id, record]));
  if (nextById.size !== candidate.organizations.length || nextRecordsById.size !== candidate.records.length) {
    throw new Error('data/mission2.json 有重複編號，請執行 pnpm run data:check。');
  }
  for (const org of candidate.organizations) {
    for (const id of org.recordIds) {
      const record = nextRecordsById.get(id);
      if (!record || record.status !== 'confirmed' || record.orgId !== org.id) {
        throw new Error(`組織 ${org.id} 的正式歷史 ${id} 對應錯誤。`);
      }
    }
    for (const id of org.candidateRecordIds) {
      const record = nextRecordsById.get(id);
      if (!record || record.status !== 'pending' || record.orgId !== null || record.candidateOrgId !== org.id) {
        throw new Error(`組織 ${org.id} 的待確認歷史 ${id} 對應錯誤。`);
      }
    }
  }
  return { nextById, nextRecordsById };
}

let { nextById: byId, nextRecordsById: recordsById } = validateAndIndex(currentSnapshot);

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

export function setSnapshot(newSnapshot: Mission2Snapshot | Snapshot): void {
  const candidate = newSnapshot as Snapshot;
  const indexed = validateAndIndex(candidate);
  currentSnapshot = candidate;
  organizations.splice(0, organizations.length, ...candidate.organizations);
  sourceFilename = candidate.source.filename;
  byId = indexed.nextById;
  recordsById = indexed.nextRecordsById;
  search.setCollection(organizations);
}

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

export function getRecord(id: string): HistoryRecord | undefined {
  return recordsById.get(id);
}

export function getHistory(org: Organization) {
  const newestFirst = (records: HistoryRecord[]) => records.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  return {
    confirmed: newestFirst(currentSnapshot.records.filter(record => record.status === 'confirmed' && record.orgId === org.id)),
    pending: newestFirst(currentSnapshot.records.filter(record => record.status === 'pending' && record.candidateOrgId === org.id)),
  };
}

export function getInsights(org: Organization): Insight[] {
  return currentSnapshot.insights.filter(insight => insight.orgId === org.id).sort((a, b) => b.date.localeCompare(a.date));
}

export function contactCounts(records: HistoryRecord[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.status !== 'confirmed' || record.kind !== '接觸紀錄') continue;
    counts.set(record.contactType, (counts.get(record.contactType) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]);
}
