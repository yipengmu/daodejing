import { expect, test } from '@playwright/test';

test('游客暂存和账号自动同步的划线与评论在同一列表', async ({ page, request }, testInfo) => {
  const chapter = '/read/10';
  const body = `这一句让我想到如何保持专注 ${Date.now()}`;
  const source = page.locator('.scripture:not(.measure)');
  const annotations = page.getByRole('tab', { name: '评论', exact: true });
  const panel = page.getByRole('tabpanel', { name: '评论', exact: true });
  const comments = panel.getByRole('list', { name: '本章评论' });
  const editor = page.getByRole('dialog', { name: '写评论' });
  const firstSentence = '载营魄抱一，能无离乎？';
  const secondSentence = '专气致柔，能如婴儿乎？';
  const openSentence = async (sentence: string) => {
    await panel.getByRole('button', { name: '写评论', exact: true }).first().click();
    await panel.getByRole('button', { name: sentence, exact: true }).click();
    await expect(editor).toContainText(sentence);
  };
  const openDrawer = () => page.getByRole('button', { name: '展开本章阅读与交流' }).click();
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
  await annotations.click();
  await expect(panel.getByText('选中原文即可划线或写评论。')).toBeVisible();
  await openSentence(firstSentence);
  await page.getByRole('button', { name: '关闭评论' }).click();
  await page.getByRole('button', { name: '收起本章阅读与交流' }).click();
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
  await annotations.click();
  const note = comments.getByRole('listitem').filter({ hasText: quote });
  await note.getByRole('button', { name: '写评论' }).click();
  await page.getByRole('textbox', { name: '你的评论' }).fill(body);
  await page.getByRole('button', { name: '保存评论' }).click();
  await expect(note).toContainText(body);
  await expect(note).toContainText('保存在本机');
  await openSentence(secondSentence);
  await editor.getByRole('button', { name: '保存划线' }).click();
  const secondLine = comments.getByRole('listitem').filter({ hasText: secondSentence });
  await expect(secondLine).toContainText('保存在本机');
  expect(guestUploads).toBe(0);

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
  const publicResponse = page.waitForResponse(response => response.url().includes('/api/chapters/10/annotations?'));
  await annotations.click();
  const synced = comments.getByRole('listitem').filter({ hasText: body });
  await expect(synced).toContainText('待同步');
  await page.unroute('**/api/me/annotations');
  await page.getByRole('button', { name: '重试同步' }).click();
  await expect(synced).toContainText('仅自己可见');
  await expect(synced).toHaveCount(1);
  await expect(secondLine).toContainText('仅自己可见');
  page.once('dialog', dialog => dialog.accept());
  await secondLine.getByRole('button', { name: '删除' }).click();
  await expect(secondLine).toHaveCount(0);

  const publicUrl = (await publicResponse).url();
  const visitorCanRead = async () => {
    const response = await request.get(publicUrl);
    expect(response.ok()).toBeTruthy();
    return (await response.json()).data.annotations.some((note: { body: string }) => note.body === body);
  };
  expect(await visitorCanRead()).toBe(false);
  page.once('dialog', dialog => dialog.accept());
  await synced.getByRole('button', { name: '公开给读者' }).click();
  await expect(synced).toContainText('已公开');
  expect(await visitorCanRead()).toBe(true);
  await expect(comments.getByText(body, { exact: true })).toHaveCount(1);

  const accountCookies = await page.context().cookies();
  await page.context().clearCookies();
  await page.reload();
  await openDrawer();
  await annotations.click();
  const publicComment = comments.getByRole('listitem').filter({ hasText: body });
  await expect(publicComment).toBeVisible();
  await expect(publicComment.getByRole('button', { name: '删除' })).toHaveCount(0);
  await openSentence(secondSentence);
  await editor.getByRole('button', { name: '保存划线' }).click();
  const guestUnderline = comments.getByRole('listitem').filter({ hasText: secondSentence });
  await expect(guestUnderline).toContainText('保存在本机');
  await expect(publicComment).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await guestUnderline.getByRole('button', { name: '删除' }).click();
  await expect(guestUnderline).toHaveCount(0);
  await page.context().addCookies(accountCookies);
  await page.reload();
  await openDrawer();
  await annotations.click();
  await synced.getByRole('button', { name: '收回公开' }).click();
  await expect(synced).toContainText('仅自己可见');
  expect(await visitorCanRead()).toBe(false);
  page.once('dialog', dialog => dialog.accept());
  await synced.getByRole('button', { name: '删除', exact: true }).click();
  await expect(synced).toHaveCount(0);
  await expect(source.locator('.scripture-underline')).toHaveCount(0);

  const awaitUpload = () => page.waitForResponse(response =>
    response.request().method() === 'POST' && response.url().endsWith('/api/me/annotations'));
  await openSentence(secondSentence);
  const markUpload = awaitUpload();
  await editor.getByRole('button', { name: '保存划线' }).click();
  expect((await markUpload).ok()).toBeTruthy();
  const savedMark = comments.getByRole('listitem').filter({ hasText: secondSentence });
  await expect(savedMark).toContainText('仅自己可见');

  await openSentence(firstSentence);
  const signedComment = `登录后新写的评论 ${Date.now()}`;
  await editor.getByRole('textbox', { name: '你的评论' }).fill(signedComment);
  const commentUpload = awaitUpload();
  await editor.getByRole('button', { name: '保存评论' }).click();
  expect((await commentUpload).ok()).toBeTruthy();
  const savedComment = comments.getByRole('listitem').filter({ hasText: signedComment });
  await expect(savedComment).toContainText('仅自己可见');

  for (const item of [savedMark, savedComment]) {
    page.once('dialog', dialog => dialog.accept());
    await item.getByRole('button', { name: '删除' }).click();
    await expect(item).toHaveCount(0);
  }
});
