// tests/e2e-tests/specs/image-upload.spec.ts
// 图片上传测试（testing-standards.md §四：@fast @no-llm 标签）
// 不依赖 LLM，仅测试图片上传 UI 交互（按钮、预览、清除、格式校验）
// 运行前提：需以 npm run dev:test 启动 dev server（关闭中间件限流）；playwright.config webServer 已自动使用。
// 手动起服务若用 npm run dev，默认 20 次/分/IP 限流会导致本用例假失败。

import { test, expect } from '@playwright/test';
import { SolvePage } from '../pages/solve-page';
import * as path from 'path';

/** 测试用 PNG 图片路径（tests/testresources/luogo_testpic.png） */
const PNG_PATH = path.join(process.cwd(), 'tests', 'testresources', 'luogo_testpic.png');

test.describe('图片上传测试 @fast @no-llm', () => {
  test('切换到 image tab → 桌面环境：粘贴图片 + 选择文件 两个按钮可见（拍照上传隐藏）', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectImageTab();
    // Playwright 默认为桌面 chromium，image-uploader 检测到非移动设备
    // 桌面：显示"粘贴图片"+"选择文件"，隐藏"拍照上传"
    await expect(solve.imageSelectButton).toBeVisible();
    await expect(solve.imagePasteButton).toBeVisible();
    await expect(solve.imageCameraButton).toHaveCount(0);
  });

  test('切换到 image tab → 移动环境：选择文件 + 拍照上传 两个按钮可见（粘贴图片隐藏）', async ({ browser }) => {
    // 模拟 iPhone 13 Safari 移动环境
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
    });
    const page = await context.newPage();
    try {
      const solve = new SolvePage(page);
      await solve.goto();
      await solve.selectImageTab();
      // 等待 hydration + useEffect 完成（imageSelectButton 可见作为锚点）
      await expect(solve.imageSelectButton).toBeVisible();
      // 移动：显示"选择文件"+"拍照上传"，隐藏"粘贴图片"
      await expect(solve.imageCameraButton).toBeVisible();
      await expect(solve.imagePasteButton).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('上传合法 PNG → 预览图可见', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectImageTab();
    await solve.uploadImage(PNG_PATH);
    await expect(solve.imagePreview).toBeVisible();
    await expect(solve.imageClearButton).toBeVisible();
  });

  test('清除图片按钮 → 预览消失', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectImageTab();
    await solve.uploadImage(PNG_PATH);
    await expect(solve.imagePreview).toBeVisible();
    await solve.clearImage();
    // 清除后预览与清除按钮均卸载
    await expect(solve.imagePreview).toHaveCount(0);
    await expect(solve.imageClearButton).toHaveCount(0);
  });

  test('上传非法格式 GIF → 显示 "仅支持 JPG / PNG 格式"', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectImageTab();
    // 用 buffer 传入 GIF（无需临时文件，避免磁盘 IO 与清理）
    await solve.imageInput.setInputFiles({
      name: 'test.gif',
      mimeType: 'image/gif',
      buffer: Buffer.from('GIF89a'),
    });
    await expect(solve.errorMessage).toBeVisible();
    await expect(solve.errorMessage).toContainText('仅支持 JPG / PNG 格式');
  });

  test('字符计数在 image tab 不显示（验证 tab 切换彻底）', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    // 默认 text tab，字符计数存在
    await expect(solve.charCountExact).toHaveCount(1);
    await solve.selectImageTab();
    // 切换后 text tab 内容卸载，字符计数元素不存在
    await expect(solve.charCountExact).toHaveCount(0);
  });
});
