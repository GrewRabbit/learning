// tests/e2e-tests/pages/result-page.ts
// /result 页面 POM（testing-standards.md §四）
// 封装结果展示页的元素定位与操作

import type { Page, Locator } from '@playwright/test';

export class ResultPage {
  readonly page: Page;
  readonly heading: Locator;
  readonly statusText: Locator;
  readonly regenerateButton: Locator;
  readonly warningBanner: Locator;
  readonly iframe: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { level: 1, name: '解题结果' });
    // 限定 <p> 标签避免匹配到"重新生成"按钮（"新生成"是"重新生成"子串）
    this.statusText = page.locator('p.text-muted-foreground', { hasText: /来自缓存|新生成/ });
    this.regenerateButton = page.getByRole('link', { name: '重新生成' });
    // 排除 Next.js 自动注入的 #__next-route-announcer__（也是 role="alert"）
    this.warningBanner = page.locator('[role="alert"]:not(#__next-route-announcer__)');
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
