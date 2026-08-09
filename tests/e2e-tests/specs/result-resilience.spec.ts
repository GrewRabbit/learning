// tests/e2e-tests/specs/result-resilience.spec.ts
// /result 页面容错测试（Next.js 最佳实践 hydration-error.md + testing-standards.md §四 @fast @no-llm）
// 验证 sessionStorage 数据异常时不抛未捕获异常，降级显示无数据提示
//
// 测试策略：
// - 先 page.goto('/') 建立 origin（sessionStorage 为 origin-bound）
// - page.evaluate 注入异常数据到 sessionStorage
// - 再 page.goto('/result') 触发 useEffect 读取与容错降级
// - 验证显示"未找到解题结果"+ "返回输入页"链接

import { test, expect } from '@playwright/test';
import { SOLUTION_STORAGE_KEY } from '@/app/lib/ai/types';

test.describe('/result 容错测试 @fast @no-llm', () => {
  test('sessionStorage 数据为非 JSON 字符串 → 降级显示无数据提示', async ({ page }) => {
    // 先建立 origin
    await page.goto('/');
    // 注入损坏数据（非合法 JSON）
    await page.evaluate((key) => {
      sessionStorage.setItem(key, 'this-is-not-json');
    }, SOLUTION_STORAGE_KEY);
    // 访问 /result
    await page.goto('/result');
    // 应显示无数据提示（容错降级，不抛异常）
    await expect(page.getByText('未找到解题结果')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: '返回输入页' })).toBeVisible();
  });

  test('sessionStorage 数据为部分合法 JSON（缺字段）→ 仍尝试渲染或降级', async ({ page }) => {
    // 注入合法 JSON 但缺少 Solution 必需字段（如 html/validated）
    // result/page.tsx 仅 setSolution(JSON.parse(stored))，不做字段校验
    // 因此 JSON.parse 成功后，会渲染但 html=undefined 时 iframe srcDoc 为空
    // 此场景验证：JSON.parse 成功但数据不完整时，页面不抛未捕获异常
    await page.goto('/');
    await page.evaluate((key) => {
      sessionStorage.setItem(key, JSON.stringify({ foo: 'bar' }));
    }, SOLUTION_STORAGE_KEY);
    await page.goto('/result');
    // 不抛异常：页面应渲染（heading 可见）或显示无数据提示
    // 关键断言：无未捕获异常（page.error 事件未触发）
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.waitForLoadState('networkidle');
    // 容忍 React 关于缺失字段的告警，但不应有未捕获的同步异常
    expect(errors.filter((e) => !e.includes('Warning'))).toHaveLength(0);
  });

  test('sessionStorage 数据为空字符串 → 显示无数据提示', async ({ page }) => {
    await page.goto('/');
    await page.evaluate((key) => {
      sessionStorage.setItem(key, '');
    }, SOLUTION_STORAGE_KEY);
    await page.goto('/result');
    // 空字符串：JSON.parse('') 抛 SyntaxError → 被 try-catch 捕获 → 视为无数据
    await expect(page.getByText('未找到解题结果')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: '返回输入页' })).toBeVisible();
  });

  test('sessionStorage 数据为 null（键不存在）→ 显示无数据提示', async ({ page }) => {
    // 不注入任何数据，直接访问 /result（与 navigation.spec.ts 重复，但作为容错基线保留）
    await page.goto('/result');
    await expect(page.getByText('未找到解题结果')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('link', { name: '返回输入页' })).toBeVisible();
  });

  test('sessionStorage 损坏数据不触发 pageerror 事件（同步异常保护）', async ({ page }) => {
    // 监听 pageerror 事件，验证容错逻辑不抛同步异常到 window 层
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.evaluate((key) => {
      // 注入多种损坏数据
      sessionStorage.setItem(key, '{invalid json');
    }, SOLUTION_STORAGE_KEY);
    await page.goto('/result');
    await expect(page.getByText('未找到解题结果')).toBeVisible({ timeout: 10_000 });
    // 不应有未捕获异常（过滤掉 React Warning）
    const criticalErrors = errors.filter(
      (e) => !e.includes('Warning') && !e.includes('Download the React DevTools'),
    );
    expect(criticalErrors).toHaveLength(0);
  });
});
