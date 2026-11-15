import { expect, type Page, test } from '@playwright/test';
import snapshot from '../data/mission2.json' with { type: 'json' };

async function openOrganization(page: Page, orgId: string) {
  await page.getByRole('searchbox').fill(orgId);
  await page.locator(`[data-org-id="${orgId}"]`).click();
  await expect(page.locator('#detail-title')).toBeVisible();
}

test('Chinese, confirmed aliases, long-field suffixes and empty results are searchable', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-org-id]')).toHaveCount(snapshot.organizations.length);
  const org = snapshot.organizations.find(item => item.aliases.some(alias => /[\u3400-\u9fff]/u.test(alias)));
  const alias = org?.aliases.find(value => value !== org.name);
  if (!org || !alias) throw new Error('A confirmed Chinese alias is required');
  await page.getByRole('searchbox').fill(alias);
  await expect(page.locator(`[data-org-id="${org.id}"]`)).toBeVisible();
  const record = snapshot.records.find(item => item.status === 'confirmed' && item.text.length > 25);
  const related = snapshot.organizations.find(item => item.id === record?.orgId);
  if (!record || !related) throw new Error('A long confirmed history record is required');
  const suffix = record.text.trim().slice(-12);
  expect(related.searchText.indexOf(suffix)).toBeGreaterThan(60);
  await page.getByRole('searchbox').fill(suffix);
  await expect(page.locator(`[data-org-id="${related.id}"]`)).toBeVisible();
  await page.getByRole('searchbox').fill('zzzzzzzzzzzzzzzzzzzzzzzz');
  await expect(page.getByRole('heading', { name: '沒有找到符合的組織' })).toBeVisible();
  await page.getByRole('button', { name: '查看所有組織' }).click();
  await expect(page.locator('[data-org-id]')).toHaveCount(snapshot.organizations.length);
  await expect(page.getByRole('searchbox')).toBeFocused();
});

test('all organizations retain their complete confirmed and pending history with provenance', async ({ page }) => {
  await page.goto('/');
  for (const org of snapshot.organizations) {
    await openOrganization(page, org.id);
    const confirmed = await page.locator('[aria-label="已確認歷史"] [data-record-id]').evaluateAll(items => items.map(item => ({
      id: item.getAttribute('data-record-id'),
      text: item.querySelector('.record-text')?.textContent,
      source: item.querySelector('summary')?.textContent,
    })));
    expect(confirmed.map(record => record.id).sort()).toEqual([...org.recordIds].sort());
    for (const actual of confirmed) {
      const expected = snapshot.records.find(record => record.id === actual.id);
      if (!expected) throw new Error('History reference is missing');
      expect(actual.text).toBe(expected.text || '原始紀錄未填文字');
      expect(actual.source).toContain(`${expected.source.sheet} · 第 ${expected.source.row} 列`);
    }
    const pending = page.locator('[aria-label="待確認對應紀錄"] [data-record-id]');
    expect((await pending.evaluateAll(items => items.map(item => item.getAttribute('data-record-id')))).sort()).toEqual([...org.candidateRecordIds].sort());
    await page.getByRole('tab', { name: '互動指南' }).click();
    await expect(page.getByRole('heading', { name: 'AI 建議 PM 可以怎麼問' })).toBeVisible();
    await page.getByRole('tab', { name: '其他資料' }).click();
    await expect(page.getByRole('heading', { name: '組織主檔', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '備註紀錄' }).click();
    await expect(page.locator('.note-message')).toHaveCount(org.metrics.noteCount);
  }
});

test('local drafts and sent notes persist, stay isolated by organization and render as text', async ({ page }) => {
  const [org, other] = snapshot.organizations;
  if (!org || !other) throw new Error('Two organizations are required');
  await page.goto('/');
  await openOrganization(page, org.id);
  const text = '本機備註\n<img src=x onerror="window.noteInjected=true">';
  await page.getByLabel('備註', { exact: true }).fill(text);
  await expect(page.locator('#note-status')).toHaveText('已儲存在此瀏覽器');
  await page.reload();
  await openOrganization(page, org.id);
  await expect(page.getByLabel('備註', { exact: true })).toHaveValue(text);
  await page.getByRole('button', { name: '送出備註' }).click();
  await expect(page.getByRole('tab', { name: '備註紀錄' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.note-message')).toContainText(text);
  await expect(page.locator('.note-message')).toContainText('本機使用者');
  await expect(page.getByLabel('備註', { exact: true })).toHaveValue('');
  expect(await page.evaluate(() => 'noteInjected' in window)).toBe(false);
  await page.reload();
  await openOrganization(page, org.id);
  await page.getByRole('tab', { name: '備註紀錄' }).click();
  await expect(page.locator('.note-message')).toContainText(text);
  await openOrganization(page, other.id);
  await expect(page.getByLabel('備註', { exact: true })).toHaveValue('');
  await page.getByRole('tab', { name: '備註紀錄' }).click();
  await expect(page.locator('.note-message').filter({ hasText: text })).toHaveCount(0);
});

test('storage write failures preserve the draft and never claim a successful send', async ({ page }) => {
  const org = snapshot.organizations[0];
  if (!org) throw new Error('Organization data is missing');
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError'); };
  });
  await page.goto('/');
  await openOrganization(page, org.id);
  await page.getByLabel('備註', { exact: true }).fill('Keep this unsaved draft');
  await expect(page.locator('#note-status')).toContainText('尚未儲存');
  await page.getByRole('button', { name: '送出備註' }).click();
  await expect(page.locator('#note-status')).toContainText('備註未送出');
  await expect(page.getByLabel('備註', { exact: true })).toHaveValue('Keep this unsaved draft');
  await page.getByRole('tab', { name: '備註紀錄' }).click();
  await expect(page.locator('.note-message').filter({ hasText: 'Keep this unsaved draft' })).toHaveCount(0);
  await expect(page.getByLabel('備註', { exact: true })).toHaveValue('Keep this unsaved draft');
});

test('invalid stored data is surfaced and preserved', async ({ page }) => {
  const org = snapshot.organizations[0];
  if (!org) throw new Error('Organization data is missing');
  await page.addInitScript(id => localStorage.setItem(`mission2:notebook:v1:${id}`, '{"invalid":true}'), org.id);
  await page.goto('/');
  await openOrganization(page, org.id);
  await expect(page.locator('#note-status')).toContainText('無法讀取本機備註');
  await expect(page.getByLabel('備註', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '送出備註' })).toBeDisabled();
  expect(await page.evaluate(id => localStorage.getItem(`mission2:notebook:v1:${id}`), org.id)).toBe('{"invalid":true}');
});

test('missing data and incomplete consultant observations retain their meaning', async ({ page }) => {
  await page.goto('/');
  const incomplete = snapshot.records.find(record => record.incomplete);
  const missing = snapshot.organizations.find(org => org.sourceFields.全職人數 === null);
  if (!incomplete?.orgId || !missing) throw new Error('Incomplete and missing data examples are required');
  await openOrganization(page, incomplete.orgId);
  await expect(page.locator(`[data-record-id="${incomplete.id}"]`)).toContainText('不完整，待補寫');
  await page.getByRole('tab', { name: '備註紀錄' }).click();
  await expect(page.locator(`[data-note-id="${incomplete.id}"]`)).toContainText(incomplete.author);
  await expect(page.locator(`[data-note-id="${incomplete.id}"]`)).toContainText('時間未記錄');
  await openOrganization(page, missing.id);
  await expect(page.locator('.profile')).toContainText('全職人數未填');
});

test('keyboard tabs, narrow layouts, local font and compact header work', async ({ page }) => {
  const org = snapshot.organizations[0];
  if (!org) throw new Error('Organization data is missing');
  await page.goto('/');
  await expect(page.getByRole('img', { name: '台灣公益團體自律聯盟' })).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveAttribute('placeholder', '搜尋組織名稱、別名、議題，或記憶中的一段話');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('16px "Source Sans 3"'))).toBe(true);
  await expect(page.getByRole('heading', { name: '組織速查' })).toHaveCSS('font-weight', '600');
  await page.screenshot({ path: 'docs/mission2-search-desktop.png' });
  await openOrganization(page, org.id);
  await page.getByRole('tab', { name: /參與記錄/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '備註紀錄' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: '其他資料' })).toHaveAttribute('aria-selected', 'true');
  for (const width of [320, 460, 760]) {
    await page.setViewportSize({ width, height: 850 });
    for (const label of ['參與記錄', '備註紀錄', '互動指南', '其他資料']) {
      await page.getByRole('tab', { name: new RegExp(label) }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  await page.setViewportSize({ width: 460, height: 900 });
  await page.getByRole('tab', { name: /參與記錄/ }).click();
  await page.screenshot({ path: 'docs/mission2-detail-narrow.png', fullPage: true });
});

test('unsupported PiP leaves the main page usable', async ({ page }) => {
  const org = snapshot.organizations[0];
  if (!org) throw new Error('Organization data is missing');
  await page.addInitScript(() => Object.defineProperty(window, 'documentPictureInPicture', { value: undefined }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '浮動視窗' })).toBeDisabled();
  await expect(page.locator('#pip-unsupported')).toBeVisible();
  await openOrganization(page, org.id);
  await expect(page.locator('#detail-title')).toHaveText(org.name);
});

test('a stale second tab cannot erase a sent note', async ({ page, context }) => {
  const org = snapshot.organizations[0];
  if (!org) throw new Error('Organization data is missing');
  const second = await context.newPage();
  await page.goto('/');
  await second.goto('/');
  await openOrganization(page, org.id);
  await openOrganization(second, org.id);
  await page.getByLabel('備註', { exact: true }).fill('Note from the first tab');
  await page.getByRole('button', { name: '送出備註' }).click();
  await expect(page.locator('.note-message')).toContainText('Note from the first tab');
  await second.getByLabel('備註', { exact: true }).fill('Draft from the second tab');
  await expect(second.locator('#note-status')).toHaveText('已儲存在此瀏覽器');
  await second.reload();
  await openOrganization(second, org.id);
  await expect(second.getByLabel('備註', { exact: true })).toHaveValue('Draft from the second tab');
  await second.getByRole('tab', { name: '備註紀錄' }).click();
  await expect(second.locator('.note-message')).toContainText('Note from the first tab');
});

test('simultaneous sends from two tabs retain both notes', async ({ page, context }) => {
  const org = snapshot.organizations[0];
  if (!org) throw new Error('Organization data is missing');
  const second = await context.newPage();
  await Promise.all([page.goto('/'), second.goto('/')]);
  await Promise.all([openOrganization(page, org.id), openOrganization(second, org.id)]);
  await Promise.all([
    page.getByLabel('備註', { exact: true }).fill('Concurrent tab A'),
    second.getByLabel('備註', { exact: true }).fill('Concurrent tab B'),
  ]);
  await expect(page.locator('#note-status')).toHaveText('已儲存在此瀏覽器');
  await expect(second.locator('#note-status')).toHaveText('已儲存在此瀏覽器');
  await Promise.all([
    page.getByRole('button', { name: '送出備註' }).click(),
    second.getByRole('button', { name: '送出備註' }).click(),
  ]);
  await expect(page.getByRole('tab', { name: '備註紀錄' })).toHaveAttribute('aria-selected', 'true');
  await expect(second.getByRole('tab', { name: '備註紀錄' })).toHaveAttribute('aria-selected', 'true');
  await page.reload();
  await openOrganization(page, org.id);
  await page.getByRole('tab', { name: '備註紀錄' }).click();
  await expect(page.locator('.note-message').filter({ hasText: 'Concurrent tab' })).toHaveCount(2);
  await expect(page.locator('.note-message').filter({ hasText: 'Concurrent tab A' })).toHaveCount(1);
  await expect(page.locator('.note-message').filter({ hasText: 'Concurrent tab B' })).toHaveCount(1);
});

test('sending preserves a newer draft from another tab', async ({ page, context }) => {
  const org = snapshot.organizations[0];
  if (!org) throw new Error('Organization data is missing');
  const second = await context.newPage();
  await Promise.all([page.goto('/'), second.goto('/')]);
  await Promise.all([openOrganization(page, org.id), openOrganization(second, org.id)]);
  await page.getByLabel('備註', { exact: true }).fill('Send this older draft');
  await expect(page.locator('#note-status')).toHaveText('已儲存在此瀏覽器');
  await second.getByLabel('備註', { exact: true }).fill('Preserve this newer draft');
  await expect(second.locator('#note-status')).toHaveText('已儲存在此瀏覽器');
  await page.getByRole('button', { name: '送出備註' }).click();
  await expect(page.locator('.note-message')).toContainText('Send this older draft');
  await second.reload();
  await openOrganization(second, org.id);
  await expect(second.getByLabel('備註', { exact: true })).toHaveValue('Preserve this newer draft');
});

test('a delayed send does not replace controls after navigating to another organization', async ({ page, context }) => {
  const [org, other] = snapshot.organizations;
  if (!org || !other) throw new Error('Two organizations are required');
  const second = await context.newPage();
  await page.goto('/');
  await second.goto('/');
  await openOrganization(page, org.id);
  await page.getByLabel('備註', { exact: true }).fill('Delayed note');
  await expect(page.locator('#note-status')).toHaveText('已儲存在此瀏覽器');
  await second.evaluate(id => {
    void navigator.locks.request(`mission2:notebook:v1:${id}`, () => new Promise<void>(release => {
      window.addEventListener('release-notebook-test-lock', () => release(), { once: true });
    }));
  }, org.id);
  await expect.poll(() => second.evaluate(async id => (await navigator.locks.query()).held?.some(lock => lock.name === `mission2:notebook:v1:${id}`), org.id)).toBe(true);
  await page.getByRole('button', { name: '送出備註' }).click();
  await page.getByRole('tab', { name: '其他資料' }).click();
  await expect(page.getByRole('button', { name: '送出備註' })).toBeDisabled();
  await openOrganization(page, other.id);
  const input = page.getByLabel('備註', { exact: true });
  await input.fill('Keep editing this organization');
  await expect(input).toBeFocused();
  await second.evaluate(() => window.dispatchEvent(new Event('release-notebook-test-lock')));
  await expect.poll(() => page.evaluate(id => localStorage.getItem(`mission2:notebook:v1:${id}`)?.includes('Delayed note'), org.id)).toBe(true);
  await expect(input).toHaveValue('Keep editing this organization');
  await expect(input).toBeFocused();
});
