import { expect, test } from '@playwright/test';

test('游客选文划线和批注，刷新保留，登录失败重试后可公开及收回', async ({ page, request }, testInfo) => {
  const chapter = '/read/10';
  const body = `这一句让我想到如何保持专注 ${Date.now()}`;
  const source = page.locator('.scripture:not(.measure)');
  const mine = page.getByRole('tab', { name: '我的标注' });
  const readers = page.getByRole('tab', { name: '读者注释' });
  const openDrawer = () => page.getByRole('button', { name: '展开注释与分享' }).click();
  async function selectText() {
    const isMobile = testInfo.project.name === 'mobile';
    const { quote, left, right, y } = await source.evaluate((element, mobile) => {
      const text = element.querySelector('p')!.firstChild!;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 4);
      if (mobile) {
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(range);
      }
      const rect = range.getBoundingClientRect();
      return { quote: range.toString(), left: rect.left + 1, right: rect.right - 1, y: rect.top + rect.height / 2 };
    }, isMobile);
    if (!isMobile) {
      await page.mouse.move(left, y);
      await page.mouse.down();
      await page.mouse.move(right, y, { steps: 8 });
      await page.mouse.up();
    }
    return quote;
  }

  let guestUploads = 0;
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/me/annotations')) guestUploads++; });
  await page.goto(chapter);
  await expect(source).toBeVisible();
  await openDrawer();
  await mine.click();
  await expect(page.getByText('选中原文即可划线或写批注。')).toBeVisible();
  await page.getByRole('button', { name: '按句标注' }).click();
  await page.getByRole('button', { name: '载营魄抱一，能无离乎？', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '写批注' })).toContainText('载营魄抱一，能无离乎？');
  await page.getByRole('button', { name: '关闭批注' }).click();
  await page.getByRole('button', { name: '拖动调整注释浮层高度' }).click();
  const quote = await selectText();
  const underline = page.getByRole('button', { name: '划线', exact: true });
  if (testInfo.project.name === 'mobile') await underline.tap();
  else await underline.click();
  await expect(source.locator('.scripture-underline')).toHaveText(quote);
  expect(guestUploads).toBe(0);

  await page.reload();
  await expect(source.locator('.scripture-underline')).toHaveText(quote);
  await page.getByRole('button', { name: '更多阅读选项' }).click();
  await page.getByRole('button', { name: '阅读设置' }).click();
  await page.getByRole('button', { name: '原文字号 24 像素' }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(source.locator('.scripture-underline')).toHaveText(quote);
  await openDrawer();
  await mine.click();
  const note = page.locator('.annotation-entry').filter({ hasText: quote });
  await note.getByRole('button', { name: '写批注' }).click();
  await page.getByRole('textbox', { name: '你的批注' }).fill(body);
  await page.getByRole('button', { name: '保存批注' }).click();
  await expect(note).toContainText(body);
  await expect(note).toContainText('保存在本机');

  await page.route('**/api/me/annotations', route => route.request().method() === 'POST'
    ? route.fulfill({ status: 503, json: { error: { message: '模拟断网' } } })
    : route.continue());
  const failedSync = page.waitForResponse(response => response.url().endsWith('/api/me/annotations') && response.status() === 503);
  await page.getByRole('link', { name: '登录同步' }).click();
  await page.getByRole('textbox', { name: '账号' }).fill('browser_reader');
  await page.getByLabel('密码', { exact: true }).fill('BrowserTest!2026');
  await page.getByRole('button', { name: '登录，继续刚才的事' }).click();
  await expect(page).toHaveURL(new RegExp(`${chapter}$`));
  await failedSync;
  await openDrawer();
  await mine.click();
  const synced = page.locator('.annotation-entry').filter({ hasText: body });
  await expect(synced).toContainText('待同步');
  await page.unroute('**/api/me/annotations');
  await page.getByRole('button', { name: '重试同步' }).click();
  await expect(synced).toContainText('仅自己可见');
  await expect(synced).toHaveCount(1);

  const publicResponse = page.waitForResponse(response => response.url().includes('/api/chapters/10/annotations?'));
  await readers.click();
  const publicUrl = (await publicResponse).url();
  const visitorCanRead = async () => {
    const response = await request.get(publicUrl);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).data.annotations.some((note: { body: string }) => note.body === body);
  };
  expect(await visitorCanRead()).toBe(false);
  await mine.click();
  page.once('dialog', dialog => dialog.accept());
  await synced.getByRole('button', { name: '公开给读者' }).click();
  await expect(synced).toContainText('已公开');
  expect(await visitorCanRead()).toBe(true);
  await readers.click();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
  await mine.click();
  await synced.getByRole('button', { name: '收回公开' }).click();
  await expect(synced).toContainText('仅自己可见');
  expect(await visitorCanRead()).toBe(false);
  page.once('dialog', dialog => dialog.accept());
  await synced.getByRole('button', { name: '删除', exact: true }).click();
  await expect(synced).toHaveCount(0);
  await expect(source.locator('.scripture-underline')).toHaveCount(0);
});
