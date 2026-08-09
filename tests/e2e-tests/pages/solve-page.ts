// tests/e2e-tests/pages/solve-page.ts
// /solve 页面 POM（Page Object Model，testing-standards.md §四）
// 封装题目输入页的元素定位与操作

import type { Page, Locator } from '@playwright/test';

export class SolvePage {
  readonly page: Page;
  readonly heading: Locator;
  readonly tabsList: Locator;
  readonly textTab: Locator;
  readonly imageTab: Locator;
  readonly platformTab: Locator;
  readonly textContent: Locator;
  readonly imageInput: Locator;
  readonly platformUrl: Locator;
  /** 平台 URL 输入框（显式命名，与 platformUrl 同元素） */
  readonly platformUrlInput: Locator;
  /** 图片上传三种方式按钮 */
  readonly imageSelectButton: Locator;
  readonly imagePasteButton: Locator;
  readonly imageCameraButton: Locator;
  /** 图片预览（alt="题目预览"） */
  readonly imagePreview: Locator;
  /** 清除图片按钮（aria-label="清除图片"） */
  readonly imageClearButton: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;
  readonly charCount: Locator;
  /** 精确字符计数定位器（限定 <p> 标签 + 类名，避免模糊匹配） */
  readonly charCountExact: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { level: 1, name: '信奥赛 C++ 解题专家' });
    this.tabsList = page.getByRole('tablist');
    this.textTab = page.getByRole('tab', { name: '文本输入' });
    this.imageTab = page.getByRole('tab', { name: '图片上传' });
    this.platformTab = page.getByRole('tab', { name: '平台 URL' });
    // 用 id 选择器避免 getByLabel 在 Radix Tabs 内的定位问题
    this.textContent = page.locator('#text-content');
    this.imageInput = page.locator('#image-input');
    this.platformUrl = page.locator('#platform-url');
    this.platformUrlInput = page.locator('#platform-url');
    this.imageSelectButton = page.getByRole('button', { name: '选择文件' });
    this.imagePasteButton = page.getByRole('button', { name: '粘贴图片' });
    this.imageCameraButton = page.getByRole('button', { name: '拍照上传' });
    this.imagePreview = page.getByAltText('题目预览');
    this.imageClearButton = page.getByLabel('清除图片');
    this.submitButton = page.getByRole('button', { name: /生成解题方案|生成中/ });
    // 排除 Next.js 自动注入的 #__next-route-announcer__（也是 role="alert"）
    this.errorMessage = page.locator('[role="alert"]:not(#__next-route-announcer__)');
    this.charCount = page.getByText(/字符/);
    // 限定 <p> + text-muted-foreground 类 + 含"字符"，避免匹配其他提示文案
    this.charCountExact = page.locator('p.text-muted-foreground', { hasText: /字符/ });
  }

  async goto(): Promise<void> {
    await this.page.goto('/solve');
  }

  async selectTextTab(): Promise<void> {
    await this.textTab.click();
  }

  async selectImageTab(): Promise<void> {
    await this.imageTab.click();
  }

  async selectPlatformTab(): Promise<void> {
    await this.platformTab.click();
  }

  async fillTextContent(content: string): Promise<void> {
    await this.textContent.fill(content);
  }

  async fillPlatformUrl(url: string): Promise<void> {
    await this.platformUrl.fill(url);
  }

  async uploadImage(filePath: string): Promise<void> {
    await this.imageInput.setInputFiles(filePath);
  }

  /** 点击"清除图片"按钮移除已上传图片预览 */
  async clearImage(): Promise<void> {
    await this.imageClearButton.click();
  }

  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  async submitAndWaitForResult(): Promise<void> {
    await this.submitButton.click();
    // 等待跳转到 /result（GLM-5.2 thinking 模式 LLM 调用可能 5-10 分钟，简单题也可能生成数万字思考过程）
    await this.page.waitForURL('**/result', { timeout: 600_000 });
  }
}
