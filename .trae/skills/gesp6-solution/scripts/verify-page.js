#!/usr/bin/env node
/**
 * gesp6-solution 技能 - 网页 Mermaid 渲染验证脚本（Ubuntu/Linux）
 *
 * 作用：用本地已安装的 Chromium 打开生成的网页，验证 Mermaid 图表是否正确渲染。
 * 背景：MCP Playwright 服务期望的浏览器版本与本地已装版本可能不一致（如 1200 vs 1228），
 *       本脚本通过 executablePath 直接指向已装 Chromium，绕过版本校验，稳定可用。
 *
 * 用法：
 *   node verify-page.js <网页URL或文件路径> [截图输出路径]
 * 示例：
 *   node verify-page.js http://localhost:9090/P1362/P1362.html
 *   node verify-page.js http://localhost:9090/P1362/P1362.html /tmp/shot.png
 *
 * 依赖：全局 playwright npm 包（由 setup-ubuntu.sh 一次性安装）。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PW_CACHE = '/root/.cache/ms-playwright';

// 自动探测已安装的 Chromium 可执行文件（取最新版本，跳过 headless shell）
function findChromium() {
  if (!fs.existsSync(PW_CACHE)) return null;
  const dirs = fs.readdirSync(PW_CACHE)
    .filter(d => d.startsWith('chromium-') && !d.includes('headless'))
    .sort().reverse();
  for (const d of dirs) {
    const p = path.join(PW_CACHE, d, 'chrome-linux64', 'chrome');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

(async () => {
  const target = process.argv[2];
  if (!target) {
    console.error('用法: node verify-page.js <网页URL或文件路径> [截图输出路径]');
    process.exit(2);
  }
  const url = target.startsWith('http') ? target : 'file://' + path.resolve(target);
  const shot = process.argv[3] || '/tmp/gesp6-verify.png';

  const execPath = findChromium();
  if (!execPath) {
    console.error('未找到 Chromium，请先运行: bash scripts/setup-ubuntu.sh');
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: execPath,
    args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500); // 等待 Mermaid startOnLoad 渲染完成

    const result = await page.evaluate(() => {
      return {
        svgCount: document.querySelectorAll('.mermaid svg').length,
        flowShapes: document.querySelectorAll('.mermaid svg rect, .mermaid svg polygon, .mermaid svg circle').length,
        chapterCount: document.querySelectorAll('h2').length,
        mindmapCards: document.querySelectorAll('.mindmap-card').length,
        title: document.title
      };
    });

    await page.screenshot({ path: shot, fullPage: true });

    console.log('TITLE=' + result.title);
    console.log('SVG_COUNT=' + result.svgCount + (result.svgCount >= 2 ? ' (OK)' : ' (期望>=2)'));
    console.log('FLOW_SHAPES=' + result.flowShapes);
    console.log('CHAPTER_COUNT=' + result.chapterCount);
    console.log('MINDMAP_CARDS=' + result.mindmapCards);
    console.log('SCREENSHOT=' + shot);
    console.log('RESULT=' + (result.svgCount >= 2 && result.chapterCount >= 8 ? 'PASS' : 'FAIL'));
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });
