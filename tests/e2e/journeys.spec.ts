import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import YAML from 'yaml';

test('现场音频位于封面与纪要之间，按需加载且可播放定位', async ({ page }) => {
  await page.goto('/shares/browser-audio-fixture');
  const player = page.locator('.share-audio audio');
  await expect(player).toHaveCount(1);
  await expect(player).toHaveAttribute('preload', 'none');
  await expect(page.locator('.share-cover + .share-audio + .structured-reading')).toHaveCount(1);
  await expect(page.locator('.media-gallery audio')).toHaveCount(0);
  await expect(player).toHaveAttribute('src', /^\/api\/media\//);
  await player.evaluate((audio: HTMLAudioElement) => audio.play());
  await expect.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
  await player.evaluate((audio: HTMLAudioElement) => { audio.pause(); audio.currentTime = 8; });
  await expect.poll(() => player.evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThanOrEqual(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('匿名读经：81 章目录、阅读浮层、来源和频道返回', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.chapter-link')).toHaveCount(81);
  await page.getByRole('link', { name: /^30 / }).click();
  await expect(page).toHaveURL(/\/read\/30$/);
  await expect(page.getByRole('heading', { name: '以道佐人主者', exact: true })).toBeVisible();
  await expect(page.locator('.desktop-sidebar,.mobile-nav')).toHaveCount(0);
  await page.getByRole('button', { name: '展开本章注释与分享' }).click();
  await expect(page.getByRole('heading', { name: '当代注释', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '本章分享', exact: true }).click();
  await page.getByRole('link', { name: '进入本章频道' }).click();
  await expect(page).toHaveURL(/\/chapters\/30$/);
  await expect(page.getByRole('button', { name: '阅读较多', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '回到原文' }).click();
  await page.getByRole('button', { name: '用户提供文本 · 版本与来源' }).click();
  await expect(page.getByRole('dialog', { name: '版本与来源' })).toContainText('尚未完成逐字校勘');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.reader-viewport')).toBeVisible();
  expect(errors).toEqual([]);
});

test('窄屏大字号分页完整保留原文，章边界不循环，进度可恢复', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/read/67');
  await page.getByRole('button', { name: '更多阅读选项' }).click();
  await page.getByRole('button', { name: '阅读设置', exact: true }).click();
  await page.getByRole('button', { name: '原文字号 24 像素', exact: true }).click();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const data = YAML.parse(await readFile('prisma/seed/daodejing.yaml', 'utf8'));
  let read = '';
  for (let index = 0; index < 30; index++) {
    read += await page.locator('.scripture:not(.measure)').innerText();
    const next = page.getByRole('button', { name: '下一页', exact: true });
    if (!(await next.count())) break;
    await next.click();
  }
  expect(read).toBe(data.chapters[66].original_text);
  expect(await page.locator('.scripture:not(.measure)').evaluate(element => element.scrollHeight <= element.parentElement!.clientHeight + 1)).toBeTruthy();
  await page.reload();
  await expect(page.getByRole('button', { name: '下一章', exact: true })).toBeVisible();
  await page.goto('/read/1'); await expect(page.getByRole('button', { name: '上一章', exact: true })).toBeDisabled();
});

test('游客建议无需登录并真实提交', async ({ page }) => {
  await page.goto('/feedback');
  await page.getByRole('textbox', { name: /^你的建议/ }).fill('自动化浏览器验证：希望一直保留匿名阅读和清晰的来源。');
  const saved = page.waitForResponse(response => response.url().endsWith('/api/feedback') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '提交建议', exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.getByRole('heading', { name: '你的建议已经留下' })).toBeVisible();
});

test('登录回跳、匿名发布、爱心、评论和隐藏的完整路径', async ({ page, browser }) => {
  await page.goto('/chapters/1');
  await page.getByRole('link', { name: '写下体会' }).click();
  await expect(page).toHaveURL(/\/auth\?next=/);
  await page.getByLabel('手机号或邮箱', { exact: true }).fill('browser@example.test');
  await page.getByLabel('密码', { exact: true }).fill('BrowserTest!2026');
  await page.getByRole('button', { name: '登录，继续刚才的事' }).click();
  await expect(page).toHaveURL(/\/compose\?chapter=1$/);
  const title = `浏览器测试分享 ${Date.now()}`;
  await page.getByLabel('标题（可选）').fill(title);
  await page.getByLabel('正文', { exact: true }).fill('这是可丢弃测试环境中的一段体会，用于验证完整写入与显隐流程。');
  await page.getByRole('radio', { name: '匿名分享', exact: true }).check();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '发布到本章频道' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.locator('.byline')).toContainText('一位共读者');
  await page.getByRole('button', { name: /^爱心 / }).click();
  await expect(page.getByRole('button', { name: '爱心 1' })).toBeVisible();
  await page.getByRole('textbox', { name: '写下你的评论' }).fill('这是一次完整的浏览器评论验证。');
  await page.getByRole('button', { name: '发布评论', exact: true }).click();
  await expect(page.locator('.comment')).toContainText('这是一次完整的浏览器评论验证。');
  const url = page.url();
  await page.getByRole('button', { name: '隐藏分享', exact: true }).click();
  await expect(page.getByText('已隐藏', { exact: true })).toBeVisible();
  const context = await browser.newContext(); const outsider = await context.newPage(); await outsider.goto(url);
  await expect(outsider.getByRole('alert')).toContainText('分享不存在或已停止公开');
  await context.close();
});

test('无定位也能保存单章节共读，公开唯一领读人和服务端时间', async ({ page }) => {
  await page.goto('/gatherings/new');
  await page.getByLabel('手机号或邮箱', { exact: true }).fill('browser@example.test'); await page.getByLabel('密码', { exact: true }).fill('BrowserTest!2026'); await page.getByRole('button', { name: '登录，继续刚才的事' }).click();
  await expect(page.getByRole('heading', { name: '记录一次共读' })).toBeVisible();
  await page.getByLabel('共读章节', { exact: true }).selectOption('8');
  await page.getByRole('textbox', { name: /本场唯一领读人/ }).fill('测试领读人');
  await page.getByRole('button', { name: '不关联地点', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: '保存共读记录' }).click();
  await expect(page.getByRole('heading', { name: '第 8 章 · 共读记录' })).toBeVisible();
  await expect(page.locator('dl')).toContainText('未关联地点');
  await expect(page.locator('dl')).toContainText('测试领读人');
});

test('地点列表与外部导航可用，不显示私有房号', async ({ page }, testInfo) => {
  await page.goto('/discover');
  if (testInfo.project.name === 'mobile') await page.getByRole('button', { name: '列表视图' }).click();
  await expect(page.locator('.place-row')).toHaveCount(9);
  await expect(page.locator('.place-list')).not.toContainText('1301');
  await page.locator('.place-row').first().getByRole('link', { name: '地点资料' }).click();
  await expect(page.getByRole('link', { name: '高德地图' })).toHaveAttribute('href', /^https:\/\/uri\.amap\.com\//);
  await expect(page.getByRole('link', { name: '百度地图' })).toBeVisible();
});

test('游客通过共读助手发布整理记录并在本设备撤回', async ({ page }) => {
  await page.goto('/chapters/1');
  await page.getByRole('link', { name: /和助手说说/ }).click();
  await page.getByLabel('分享链接或文字').fill('一场共读的记录，讨论知足与平和。');
  await page.getByRole('button', { name: '发送并公开分享' }).click();
  await expect(page.getByRole('heading', { name: '一场共读的记录' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '内容目录' })).toBeVisible();
  await expect(page.getByText('张*分享，慢下来才能听见自己的感受。')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '撤回这份分享' }).click();
  await expect(page.getByRole('heading', { name: '分享已撤回' })).toBeVisible();
});
