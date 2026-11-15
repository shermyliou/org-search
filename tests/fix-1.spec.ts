import { expect, type Page, test } from '@playwright/test';
import snapshot from '../data/mission2.json' with { type: 'json' };

async function openOrganization(page: Page, id: string) {
  await page.getByRole('searchbox').fill(id);
  await page.locator(`[data-org-id="${id}"]`).click();
  await expect(page.locator('#detail-title')).toBeVisible();
}

async function editProfile(page: Page, field: string, text: string) {
  await page.locator('.profile').getByRole('button', { name: `編輯${field}`, exact: true }).click();
  const editor = page.getByRole('textbox', { name: field, exact: true });
  await editor.fill(text);
  await editor.press('Enter');
  await expect(page.locator('#field-status')).toHaveText('欄位修改已儲存在此瀏覽器');
  await expect(editor).toHaveCount(0);
}

test('edited profile fields persist, are searchable, and preserve the imported master', async ({ page }) => {
  const [org, other] = snapshot.organizations;
  if (!org || !other) throw new Error('Two organizations are required');
  const name = '更新名稱 <img src=x onerror="window.profileInjected=true">';
  await page.goto('/');
  await openOrganization(page, org.id);
  await editProfile(page, '組織名稱', name);
  await editProfile(page, '區域', '金門');
  await page.locator('.profile').getByRole('button', { name: '編輯議題', exact: true }).click();
  await page.getByRole('textbox', { name: '議題', exact: true }).fill('不要儲存這次修改');
  await page.getByRole('textbox', { name: '議題', exact: true }).press('Escape');
  await expect(page.locator('.profile').getByRole('button', { name: '編輯議題', exact: true })).toHaveText(org.issue);
  await page.getByRole('searchbox').fill('金門');
  await expect(page.locator(`[data-org-id="${org.id}"]`)).toContainText(name);
  await expect(page.locator(`[data-org-id="${org.id}"]`)).toContainText('金門');
  await page.reload();
  await openOrganization(page, org.id);
  await expect(page.locator('#detail-title')).toHaveText(name);
  await expect(page.locator('.profile .location')).toHaveText('金門');
  expect(await page.evaluate(() => 'profileInjected' in window)).toBe(false);
  await page.getByRole('tab', { name: '其他資料' }).click();
  await page.getByText('查看匯入主檔原文', { exact: true }).click();
  const original = page.locator('.other-section details').filter({ has: page.getByText('查看匯入主檔原文', { exact: true }) });
  await expect(original).toContainText(org.name);
  await expect(original).toContainText(org.sourceFields.區域);
  await expect(original).not.toContainText(name);
  await openOrganization(page, other.id);
  await expect(page.locator('#detail-title')).toHaveText(other.name);
  await expect(page.locator('.profile .location')).toHaveText(other.sourceFields.區域);
});

test('numeric edits preserve zero and missing values and reject invalid counts', async ({ page }) => {
  const org = snapshot.organizations[0];
  if (!org) throw new Error('An organization is required');
  await page.goto('/');
  await openOrganization(page, org.id);
  await editProfile(page, '全職人數', '0');
  await page.reload();
  await openOrganization(page, org.id);
  await expect(page.locator('.profile').getByRole('button', { name: '編輯全職人數', exact: true })).toHaveText('0');
  await editProfile(page, '全職人數', '');
  await page.reload();
  await openOrganization(page, org.id);
  await expect(page.locator('.profile')).toContainText('全職人數未填');
  await page.locator('.profile').getByRole('button', { name: '編輯全職人數', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '全職人數', exact: true });
  await editor.fill('-2');
  await editor.press('Enter');
  await expect(page.locator('#field-status')).toContainText('欄位尚未儲存');
  await expect(editor).toHaveValue('-2');
  await expect(editor).toHaveAttribute('aria-invalid', 'true');
  await editor.focus();
  await editor.press('Escape');
  await page.reload();
  await openOrganization(page, org.id);
  await expect(page.locator('.profile')).toContainText('全職人數未填');
});

test('failed field writes keep the input and do not replace the saved value', async ({ page }) => {
  const org = snapshot.organizations[0];
  if (!org) throw new Error('An organization is required');
  await page.addInitScript(id => {
    const key = `mission2:fields:v1:${id}`;
    localStorage.setItem(key, JSON.stringify({ version: 1, fields: { 區域: '已存地區' } }));
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (storageKey, value) {
      if (storageKey === key) throw new DOMException('Storage full', 'QuotaExceededError');
      original.call(this, storageKey, value);
    };
  }, org.id);
  await page.goto('/');
  await openOrganization(page, org.id);
  await page.getByRole('button', { name: '編輯區域', exact: true }).click();
  const editor = page.getByRole('textbox', { name: '區域', exact: true });
  await editor.fill('保留未存內容');
  await editor.press('Enter');
  await expect(page.locator('#field-status')).toContainText('欄位尚未儲存');
  await expect(editor).toHaveValue('保留未存內容');
  await page.reload();
  await openOrganization(page, org.id);
  await expect(page.locator('.profile .location')).toHaveText('已存地區');
});

test('invalid saved field data is surfaced and preserved without disabling notes', async ({ page }) => {
  const org = snapshot.organizations[0];
  if (!org) throw new Error('An organization is required');
  const invalid = '{"version":1,"fields":{"組織編號":"changed-id"}}';
  await page.addInitScript(({ id, stored }) => localStorage.setItem(`mission2:fields:v1:${id}`, stored), { id: org.id, stored: invalid });
  await page.goto('/');
  await openOrganization(page, org.id);
  await expect(page.locator('#field-status')).toContainText('無法讀取本機欄位修改');
  await expect(page.getByRole('button', { name: '編輯區域', exact: true })).toBeDisabled();
  await expect(page.getByLabel('備註', { exact: true })).toBeEnabled();
  await expect(page.locator('#detail-title')).toHaveText(org.name);
  expect(await page.evaluate(id => localStorage.getItem(`mission2:fields:v1:${id}`), org.id)).toBe(invalid);
});

test('a stale second tab merges field edits without erasing the first edit', async ({ page, context }) => {
  const org = snapshot.organizations[0];
  if (!org) throw new Error('An organization is required');
  const second = await context.newPage();
  await Promise.all([page.goto('/'), second.goto('/')]);
  await Promise.all([openOrganization(page, org.id), openOrganization(second, org.id)]);
  await editProfile(page, '區域', '跨分頁地區');
  await editProfile(second, '議題', '跨分頁議題');
  await page.reload();
  await openOrganization(page, org.id);
  await expect(page.locator('.profile .location')).toHaveText('跨分頁地區');
  await expect(page.locator('.profile').getByRole('button', { name: '編輯議題', exact: true })).toHaveText('跨分頁議題');
});

test('history views filter and sort while retaining every confirmed timeline record', async ({ page }) => {
  const org = snapshot.organizations.find(item => snapshot.records.some(record => record.orgId === item.id && record.status === 'confirmed' && record.contactType === '課後追蹤'));
  if (!org) throw new Error('An organization with course follow-up is required');
  const records = snapshot.records.filter(record => record.orgId === org.id && record.status === 'confirmed');
  const courses = records.filter(record => record.contactType === '培力課程');
  await page.goto('/');
  await openOrganization(page, org.id);
  await expect(page.getByRole('button', { name: '表格', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-course-id]')).toHaveCount(courses.length);
  for (const course of courses) {
    const row = page.locator(`[data-course-id="${course.id}"]`);
    await expect(row).toContainText('已報名 / 出席未知');
    const traces = records.filter(record => record.contactType === '課後追蹤' && record.eventName === course.eventName && record.date >= course.date);
    for (const trace of traces) await expect(row).toContainText(`${trace.date} · ${trace.id}`);
    if (!traces.length) await expect(row).toContainText('無可明確配對的追蹤');
  }
  await page.getByRole('combobox', { name: '課程類型', exact: true }).selectOption('數位');
  for (const row of await page.locator('[data-course-id]').all()) await expect(row.locator('.category-tag').first()).toHaveText('數位');
  await page.getByRole('combobox', { name: '接觸類別', exact: true }).selectOption('會員大會');
  await expect(page.locator('[data-course-id]')).toHaveCount(0);
  await page.getByRole('combobox', { name: '課程類型', exact: true }).selectOption('all');
  await page.getByRole('combobox', { name: '接觸類別', exact: true }).selectOption('all');
  const timeline = page.locator('[aria-label="已確認歷史"] [data-record-id]');
  expect((await timeline.evaluateAll(items => items.map(item => item.getAttribute('data-record-id')))).sort()).toEqual([...org.recordIds].sort());
  await page.getByRole('combobox', { name: '時間排序', exact: true }).selectOption('oldest');
  const oldestDates = await timeline.locator('time').evaluateAll(items => items.map(item => item.getAttribute('datetime')));
  expect(oldestDates).toEqual(records.map(record => record.date).sort());
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await expect(page.locator('[aria-label="已確認歷史"] ol > [data-record-id]')).toHaveCount(records.length);
  await page.getByRole('combobox', { name: '時間排序', exact: true }).selectOption('newest');
  const newestDates = await timeline.locator('time').evaluateAll(items => items.map(item => item.getAttribute('datetime')));
  expect(newestDates).toEqual(records.map(record => record.date).sort().reverse());
});

test('member meeting cards count direct, delegated and distinct years from confirmed entries', async ({ page }) => {
  const org = snapshot.organizations.find(item => snapshot.records.some(record => record.orgId === item.id && record.status === 'confirmed' && record.contactType === '會員大會' && record.text === '委託出席'));
  if (!org) throw new Error('Delegated attendance data is required');
  const meetings = snapshot.records.filter(record => record.orgId === org.id && record.status === 'confirmed' && record.contactType === '會員大會');
  const direct = meetings.filter(record => record.text === '出席').length;
  const delegated = meetings.filter(record => record.text === '委託出席').length;
  const years = new Set(meetings.filter(record => record.text === '出席' || record.text === '委託出席').map(record => record.date.slice(0, 4))).size;
  await page.goto('/');
  await openOrganization(page, org.id);
  const stats = page.locator('[aria-label="參與統計"]');
  await expect(stats.locator('span', { hasText: /^記載出席/ }).locator('strong')).toHaveText(String(direct));
  await expect(stats.locator('span', { hasText: /^記載委託出席/ }).locator('strong')).toHaveText(String(delegated));
  await expect(stats.locator('span', { hasText: /^有紀錄年度/ }).locator('strong')).toHaveText(String(years));
  const confirmedSection = page.locator('[aria-label="已確認歷史"]');
  await expect(confirmedSection.locator('[data-meeting-id]')).toHaveCount(meetings.length);
  for (const meeting of meetings) await expect(confirmedSection.locator(`[data-meeting-id="${meeting.id}"]`)).toContainText(meeting.text);
  const pendingOrg = snapshot.organizations.find(item => item.candidateRecordIds.length);
  if (!pendingOrg) throw new Error('Pending history is required');
  await openOrganization(page, pendingOrg.id);
  const confirmed = page.locator('[aria-label="已確認歷史"] [data-record-id]');
  for (const id of pendingOrg.candidateRecordIds) await expect(confirmed.filter({ has: page.locator(`#record-${id}`) })).toHaveCount(0);
  await expect(page.locator('[aria-label="待確認對應紀錄"] [data-record-id]')).toHaveCount(pendingOrg.candidateRecordIds.length);
});

test('phone questions cite confirmed evidence and distinguish call purpose from history', async ({ page }) => {
  const org = snapshot.organizations.find(item => item.metrics.noteCount > 0);
  if (!org) throw new Error('An organization with consultant notes is required');
  await page.goto('/');
  await openOrganization(page, org.id);
  const localText = '本次顧問備註，先詢問會員最新需求';
  await page.getByLabel('備註', { exact: true }).fill(localText);
  await expect(page.locator('#note-status')).toHaveText('已儲存在此瀏覽器');
  await page.getByRole('button', { name: '送出備註' }).click();
  await page.getByRole('tab', { name: '互動指南' }).click();
  const table = page.locator('.question-table');
  await expect(table.getByRole('columnheader')).toHaveText(['優先順序', '建議問法', '為什麼值得問', '可回追的依據', '回答後可取得的資訊']);
  await expect(table).toContainText(localText);
  await expect(table).toContainText('記錄者 本機使用者');
  const purpose = '年度服務需求 <img src=x onerror="window.guideInjected=true">';
  await page.getByRole('textbox', { name: '本次來電目的' }).fill(purpose);
  await page.getByRole('button', { name: '更新建議' }).click();
  expect(await table.locator('tbody > tr').count()).toBeLessThanOrEqual(3);
  await expect(table).toContainText('【本次需求確認】');
  await expect(table).toContainText(purpose);
  await expect(table).toContainText('無歷史紀錄作為依據');
  expect(await page.evaluate(() => 'guideInjected' in window)).toBe(false);
  const sourceButtons = table.locator('button[data-record]');
  for (const button of await sourceButtons.all()) {
    const id = await button.getAttribute('data-record');
    expect(org.recordIds).toContain(id);
    expect(org.candidateRecordIds).not.toContain(id);
  }
  const sourceButton = sourceButtons.first();
  const recordId = await sourceButton.getAttribute('data-record');
  const record = snapshot.records.find(item => item.id === recordId);
  if (!record) throw new Error('A source-linked question is required');
  await expect(table).toContainText(record.date);
  await expect(table).toContainText(record.text);
  await sourceButton.click();
  await expect(page.getByRole('tab', { name: /參與記錄/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator(`#record-${record.id}`)).toBeFocused();
  await expect(page.locator(`#record-${record.id}`)).toContainText(record.text);
});
