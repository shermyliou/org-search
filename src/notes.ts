import * as z from 'zod/mini';

const savedNote = z.object({ id: z.uuid(), createdAt: z.iso.datetime(), text: z.string() });
const notebook = z.object({ version: z.literal(1), draft: z.string(), entries: z.array(savedNote) });
export type Notebook = z.infer<typeof notebook>;
type NotebookChange = { kind: 'draft'; text: string } | { kind: 'append'; entry: z.infer<typeof savedNote> };
const key = (orgId: string) => `mission2:notebook:v1:${orgId}`;

export function readNotebook(orgId: string): Notebook {
  const stored = localStorage.getItem(key(orgId));
  if (stored === null) return { version: 1, draft: '', entries: [] };
  const parsed: unknown = JSON.parse(stored);
  return notebook.parse(parsed);
}

export async function updateNotebook(orgId: string, change: NotebookChange): Promise<Notebook> {
  if (!navigator.locks) throw new Error('此瀏覽器無法安全儲存本機備註，請使用桌面版 Chrome 或 Edge。');
  return navigator.locks.request(key(orgId), () => {
    const latest = readNotebook(orgId);
    const updated: Notebook = change.kind === 'draft'
      ? { ...latest, draft: change.text }
      : { ...latest, draft: latest.draft === change.entry.text ? '' : latest.draft, entries: [...latest.entries, change.entry] };
    localStorage.setItem(key(orgId), JSON.stringify(updated));
    return updated;
  });
}
