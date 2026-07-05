// tests/e2e-tests/pages/result-page.ts
// /result 页面 POM（testing-standards.md §四）
// 封装结果展示页的元素定位与操作

import type { Page, Locator } from '@playwright/test';

export class ResultPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly statusText: Locator;
  /** 验证状态文本别名（与 statusText 同元素，保持 statusText 不变） */
  readonly validatedBadge: Locator;
  readonly regenerateButton: Locator;
  /** "返回"按钮（跳转 /solve，不自动提交；与"重新生成"按钮区分） */
  readonly returnButton: Locator;
  readonly warningBanner: Locator;
  /** 加载中文本（hydration 前显示） */
  readonly loadingText: Locator;
  /** 无数据提示文案 */
  readonly noDataText: Locator;
  /** 无数据时"返回输入页"链接（与 regenerateButton 区分） */
  readonly backToSolveLink: Locator;
  readonly iframe: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { level: 1, name: '解题结果' });
    // 限定 <p> 标签避免匹配到"重新生成"按钮（"新生成"是"重新生成"子串）
    this.statusText = page.locator('p.text-muted-foreground', { hasText: /来自缓存|新生成/ });
    this.validatedBadge = this.statusText;
    this.regenerateButton = page.getByRole('link', { name: '重新生成' });
    // exact: true 避免匹配到"返回输入页"（无数据时的链接）
    this.returnButton = page.getByRole('link', { name: '返回', exact: true });
    // 精确定位 WarningBanner：排除 #__next-route-announcer__ 且含"代码未通过验证"
    this.warningBanner = page
      .locator('[role="alert"]:not(#__next-route-announcer__)')
      .filter({ hasText: '代码未通过验证' });
    this.loadingText = page.getByText('加载中...');
    this.noDataText = page.getByText('未找到解题结果');
    this.backToSolveLink = page.getByRole('link', { name: '返回输入页' });
    this.iframe = page.getByTitle('解题方案');
  }

  async goto(): Promise<void> {
    await this.page.goto('/result');
  }

  /** 获取 iframe 内部 frame，用于验证渲染内容 */
  getIframeFrame() {
    return this.iframe.contentFrame();
  }

  /** 等待 iframe 加载完成（srcDoc 设置后） */
  async waitForIframeLoaded(): Promise<void> {
    await this.iframe.waitFor({ state: 'visible' });
    // srcDoc iframe 可见后内容即已加载，等待 body 可见确认渲染完成
    const frame = this.getIframeFrame();
    if (frame) {
      await frame.locator('body').waitFor({ state: 'visible', timeout: 30_000 });
    }
  }
}
