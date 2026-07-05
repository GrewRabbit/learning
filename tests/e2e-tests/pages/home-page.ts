// tests/e2e-tests/pages/home-page.ts
// 首页 POM（testing-standards.md §四）

import type { Page, Locator } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly heading: Locator;
  readonly startButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { level: 1, name: '信奥赛 C++ 解题专家' });
    this.startButton = page.getByRole('link', { name: '开始使用' });
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async clickStart(): Promise<void> {
    await this.startButton.click();
    await this.page.waitForURL('**/solve');
  }
}
