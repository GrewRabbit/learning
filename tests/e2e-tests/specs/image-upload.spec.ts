// tests/e2e-tests/specs/image-upload.spec.ts
// 图片上传测试（testing-standards.md §四：@fast 标签）
// 不依赖 LLM，仅测试图片上传 UI 交互（按钮、预览、清除、格式校验）

import { test, expect } from '@playwright/test';
import { SolvePage } from '../pages/solve-page';
import * as path from 'path';

/** 测试用 PNG 图片路径（tests/testresources/testpic.png） */
const PNG_PATH = path.join(process.cwd(), 'tests', 'testresources', 'testpic.png');

test.describe('图片上传测试 @fast', () => {
  test('切换到 image tab → 三种上传按钮可见', async ({ page }) => {
    const solve = new SolvePage(page);
    await solve.goto();
    await solve.selectImageTab();
    await expect(solve.imageSelectButton).toBeVisible();
    await expect(solve.imagePasteButton).toBeVisible();
    await expect(solve.imageCameraButton).toBeVisible();
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
