import { expect, test } from '@playwright/test';
import snapshot from '../data/mission2.json' with { type: 'json' };

test('資料整理 view toggles from header and runs mocked analyze/apply flow', async ({ page }) => {
  await page.goto('/');

  const toggle = page.locator('#organize-toggle');
  await expect(toggle).toHaveText('資料整理');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: '資料整理' })).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('searchbox')).toBeVisible();

  await toggle.click();
  await expect(page.locator('#organize-file')).toBeVisible();

  const updatedSnapshot = structuredClone(snapshot);
  const firstOrg = updatedSnapshot.organizations[0];
  if (!firstOrg) throw new Error('Expected at least one organization in snapshot');
  firstOrg.name = `${firstOrg.name}（已更新）`;
  firstOrg.sourceFields['組織名稱'] = firstOrg.name;

  await page.route('**/api/organize/analyze', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        sourceFilename: 'sample.xlsx',
        sourceSha256: 'abc123',
        parsed: {
          sourceFilename: 'sample.xlsx',
          sourceSha256: 'abc123',
          sheets: [],
        },
        masterOrgs: [{ id: 'H01', name: '測試組織', introduction: '簡介', issue: '教育', audience: '青年' }],
        existingAnnotations: { notes: [], pending: [] },
        llmStatus: { available: true, provider: 'gemini', error: null },
        summary: { organizations: 48, contacts: 206, notes: 16, pending: 4 },
        delta: {
          notes: [
            {
              row: 18,
              orgId: 'H01',
              date: '2026-10-01',
              author: '王顧問',
              text: '建議下季優先邀請參加財務課。',
              kind: 'new',
              previousExpectedText: null,
              aiDraft: {
                themes: ['財務課程'],
                actionQuote: '建議下季優先邀請參加財務課。',
                audiences: [],
                issueSuggestions: [],
                incomplete: false,
              },
            },
          ],
          pending: [
            {
              recordId: 'R0207',
              row: 208,
              submittedName: '測試簡稱',
              date: '2026-10-02',
              contactType: '培力課程',
              eventName: '財務工作坊',
              text: '報名財務工作坊',
              aiDraft: {
                candidateOrgId: 'H01',
                reason: '名稱近似測試組織',
              },
            },
          ],
        },
      }),
    });
  });

  await page.route('**/api/organize/apply', async route => {
    const body = route.request().postDataJSON() as {
      annotations: { notes: Array<{ row: number }>; pending: Array<{ recordId: string; candidateOrgId: string | null }> };
    };
    expect(body.annotations.notes.some(n => n.row === 18)).toBe(true);
    expect(body.annotations.pending.find(p => p.recordId === 'R0207')?.candidateOrgId).toBeNull();

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        filename: 'sample_任務二整理版.xlsx',
        workbookBase64: Buffer.from('mock-xlsx-bytes').toString('base64'),
        snapshot: updatedSnapshot,
        stats: {
          organizations: updatedSnapshot.organizations.length,
          records: updatedSnapshot.records.length,
          notes: 17,
          pending: 5,
          insights: 29,
        },
      }),
    });
  });

  await page.locator('#organize-file').setInputFiles({
    name: 'sample.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('PK\x03\x04mock'),
  });
  await page.getByRole('button', { name: '分析檔案' }).click();

  await expect(page.getByRole('heading', { name: '檢視異動項目' })).toBeVisible();
  await expect(page.locator('[data-note-row="18"]')).toBeVisible();
  await expect(page.locator('[data-pending-id="R0207"]')).toBeVisible();

  await page.locator('[data-pending-id="R0207"] [data-pending-action="skip"]').click();
  await expect(page.locator('[data-pending-id="R0207"] [data-status-badge]')).toHaveText('已略過');

  await page.getByRole('button', { name: '套用並產生整理檔' }).click();
  await expect(page.getByRole('heading', { name: '整理檔已產生' })).toBeVisible();
  await expect(page.getByRole('button', { name: '下載整理版 Excel' })).toBeVisible();

  await page.getByRole('button', { name: '返回組織速查' }).click();
  await expect(page.locator(`[data-org-id="${firstOrg.id}"]`)).toContainText('（已更新）');
});
