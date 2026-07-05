// app/lib/ai/services/problem-fetchers/__tests__/types.test.ts
// extractSampleFingerprint 单元测试（spec-sample-fingerprint-cache-v1.1 FR-001~FR-004, AC-001/AC-019）
//
// 覆盖 spec §7.1：
// - 有代码块/无代码块/多代码块顺序/代码块内容标准化
// - 带语言标记与不带标记一致（AC-019）
// - 样例章节识别/描述含代码块不影响
// - AC-001：用户文本格式与 fetcher 格式产出相同 sampleFp
// - 多候选指纹（方案 B）：all/first 互补，覆盖"用户只粘部分样例"场景
// - 章节匹配扩展（方案 A）：二/三/四级标题 + 连续样例标题合并

import { describe, it, expect } from 'vitest';
import { extractSampleFingerprint, EMPTY_SAMPLE_FINGERPRINT } from '../types';

describe('extractSampleFingerprint（FR-001~FR-004）', () => {
  it('有代码块 → all 返回 64 位 hex hash（FR-001）', () => {
    const content = '## 样例\n```\n1 2\n```\n';
    const fp = extractSampleFingerprint(content);
    expect(fp.all).toMatch(/^[a-f0-9]{64}$/);
    expect(fp.all).not.toBe('');
    // 仅 1 个块 → first 为空（无法构成一组样例）
    expect(fp.first).toBe('');
  });

  it('无代码块 → 返回空指纹（FR-003 降级信号）', () => {
    const content = '## 样例\n这是描述，没有代码块\n';
    const fp = extractSampleFingerprint(content);
    expect(fp.all).toBe('');
    expect(fp.first).toBe('');
    expect(fp).toEqual(EMPTY_SAMPLE_FINGERPRINT);
  });

  it('多代码块按原文出现顺序拼接，不排序（FR-004）', () => {
    // 顺序 A：先 1 2 后 3 4
    const contentA = '## 样例\n```\n1 2\n```\n```\n3 4\n```\n';
    // 顺序 B：先 3 4 后 1 2（内容相同但顺序不同）
    const contentB = '## 样例\n```\n3 4\n```\n```\n1 2\n```\n';
    const fpA = extractSampleFingerprint(contentA);
    const fpB = extractSampleFingerprint(contentB);
    expect(fpA.all).not.toBe(fpB.all);
  });

  it('代码块内容标准化后相同 → hash 一致（normalizeContent 抹平空白差异）', () => {
    // 多空白 vs 单空格，normalizeContent 后一致
    const content1 = '## 样例\n```\n1   2\n```\n';
    const content2 = '## 样例\n```\n1 2\n```\n';
    const fp1 = extractSampleFingerprint(content1);
    const fp2 = extractSampleFingerprint(content2);
    expect(fp1.all).toBe(fp2.all);
  });

  it('带语言标记（```cpp）与不带标记的相同内容代码块 sampleFp 一致（AC-019）', () => {
    const withLang = '## 样例\n```cpp\n1 2\n```\n';
    const withoutLang = '## 样例\n```\n1 2\n```\n';
    const fp1 = extractSampleFingerprint(withLang);
    const fp2 = extractSampleFingerprint(withoutLang);
    expect(fp1.all).toBe(fp2.all);
    expect(fp1.all).not.toBe('');
  });

  it('样例章节识别：仅提取"样例"章节内代码块，忽略其他章节代码块', () => {
    // 题目描述含代码块，但样例章节代码块内容相同
    const withDescCode = '## 题目描述\n```\n描述代码\n```\n## 样例\n```\n1 2\n```\n';
    const onlySample = '## 样例\n```\n1 2\n```\n';
    const fp1 = extractSampleFingerprint(withDescCode);
    const fp2 = extractSampleFingerprint(onlySample);
    expect(fp1.all).toBe(fp2.all);
    expect(fp1.all).not.toBe('');
  });

  it('AC-001：用户文本格式与 fetcher 格式产出相同 sampleFp（核心场景）', () => {
    // 用户文本格式：标题简洁（"样例"），代码块无语言标记
    const userText = ['## 样例', '```', '1 2', '```', '```', '3', '```'].join(
      '\n',
    );
    // fetcher 格式：标题带题号（"输入输出样例"），代码块带语言标记（```cpp）
    const fetcherText = [
      '## 题目描述',
      '某道题',
      '## 输入输出样例',
      '```cpp',
      '1 2',
      '```',
      '```cpp',
      '3',
      '```',
    ].join('\n');
    const userFp = extractSampleFingerprint(userText);
    const fetcherFp = extractSampleFingerprint(fetcherText);
    expect(userFp.all).toBe(fetcherFp.all);
    expect(userFp.first).toBe(fetcherFp.first);
    expect(userFp.all).not.toBe('');
    expect(userFp.first).not.toBe('');
  });

  it('无"样例"二级标题 → 降级提取全文代码块（FR-002 兜底）', () => {
    // 无"样例"标题，但有代码块 → 降级提取全文
    const noSampleSection = '## 题目描述\n```\n1 2\n```\n';
    const fp = extractSampleFingerprint(noSampleSection);
    expect(fp.all).toMatch(/^[a-f0-9]{64}$/);
    // 与有"样例"标题但代码块内容相同的结果一致（都提取了同样的代码块）
    const withSampleSection = '## 样例\n```\n1 2\n```\n';
    expect(fp.all).toBe(extractSampleFingerprint(withSampleSection).all);
  });
});

describe('extractSampleFingerprint "输入：/输出：" 兜底（图片识别路径）', () => {
  it('无代码块但有 输入：/输出： 模式 → 返回非空指纹', () => {
    const content = [
      '## 样例',
      '',
      '### 样例 1',
      '',
      '输入：',
      '5 2',
      '',
      '输出：',
      '获得1个徽章 获得5个星星',
      '',
    ].join('\n');
    const fp = extractSampleFingerprint(content);
    expect(fp.all).toMatch(/^[a-f0-9]{64}$/);
    expect(fp.all).not.toBe('');
  });

  it('核心：代码围栏格式与 输入：/输出： 纯文本格式产出相同指纹', () => {
    // 代码围栏格式（URL 路径 / 修复后的图片识别输出）
    const codeFenceFormat = [
      '## 样例',
      '',
      '### 样例 1',
      '',
      '输入：',
      '```',
      '5 2',
      '```',
      '',
      '输出：',
      '```',
      '获得1个徽章 获得5个星星',
      '```',
      '',
    ].join('\n');

    // 纯文本格式（未修复的图片识别输出 → 触发兜底）
    const headerFormat = [
      '## 样例',
      '',
      '### 样例 1',
      '',
      '输入：',
      '5 2',
      '',
      '输出：',
      '获得1个徽章 获得5个星星',
      '',
    ].join('\n');

    const fp1 = extractSampleFingerprint(codeFenceFormat);
    const fp2 = extractSampleFingerprint(headerFormat);
    expect(fp1.all).toBe(fp2.all);
    expect(fp1.first).toBe(fp2.first);
    expect(fp1.all).not.toBe('');
  });

  it('多组样例：代码围栏与纯文本格式指纹一致', () => {
    const codeFenceFormat = [
      '## 样例',
      '',
      '### 样例 1',
      '',
      '输入：',
      '```',
      '5 2',
      '```',
      '',
      '输出：',
      '```',
      '获得1个徽章 获得5个星星',
      '```',
      '',
      '### 样例 2',
      '',
      '输入：',
      '```',
      '1 20',
      '```',
      '',
      '输出：',
      '```',
      '```',
      '',
    ].join('\n');

    const headerFormat = [
      '## 样例',
      '',
      '### 样例 1',
      '',
      '输入：',
      '5 2',
      '',
      '输出：',
      '获得1个徽章 获得5个星星',
      '',
      '### 样例 2',
      '',
      '输入：',
      '1 20',
      '',
      '输出：',
      '',
      '## 说明/提示',
      'some hint',
    ].join('\n');

    const fp1 = extractSampleFingerprint(codeFenceFormat);
    const fp2 = extractSampleFingerprint(headerFormat);
    expect(fp1.all).toBe(fp2.all);
    expect(fp1.first).toBe(fp2.first);
    expect(fp1.all).not.toBe('');
  });

  it('空输出场景：代码围栏空块与纯文本空内容指纹一致', () => {
    const codeFenceFormat = [
      '## 样例',
      '',
      '输入：',
      '```',
      '1 20',
      '```',
      '',
      '输出：',
      '```',
      '```',
      '',
    ].join('\n');

    const headerFormat = [
      '## 样例',
      '',
      '输入：',
      '1 20',
      '',
      '输出：',
      '',
      '## 说明/提示',
      'hint',
    ].join('\n');

    const fp1 = extractSampleFingerprint(codeFenceFormat);
    const fp2 = extractSampleFingerprint(headerFormat);
    expect(fp1.all).toBe(fp2.all);
    expect(fp1.first).toBe(fp2.first);
    expect(fp1.all).not.toBe('');
  });

  it('同行内容："输入：5 2" 格式也能提取', () => {
    const headerFormat = [
      '## 样例',
      '',
      '输入：5 2',
      '',
      '输出：3',
      '',
    ].join('\n');

    const codeFenceFormat = [
      '## 样例',
      '',
      '输入：',
      '```',
      '5 2',
      '```',
      '',
      '输出：',
      '```',
      '3',
      '```',
      '',
    ].join('\n');

    const fp1 = extractSampleFingerprint(headerFormat);
    const fp2 = extractSampleFingerprint(codeFenceFormat);
    expect(fp1.all).toBe(fp2.all);
    expect(fp1.first).toBe(fp2.first);
    expect(fp1.all).not.toBe('');
  });

  it('不匹配 "输入格式："/"输出格式："（避免误提取格式说明）', () => {
    // 输入格式：/输出格式：不应被当作样例内容
    const content = [
      '## 样例',
      '',
      '输入格式：两个整数',
      '输出格式：一行结果',
      '',
    ].join('\n');
    const fp = extractSampleFingerprint(content);
    // 无代码块且无 "输入：/输出：" 匹配 → 返回空指纹
    expect(fp.all).toBe('');
    expect(fp.first).toBe('');
  });

  it('无代码块且无 输入：/输出： 模式 → 返回空指纹（FR-003）', () => {
    const content = '## 样例\n这是纯描述，没有代码块也没有输入输出标记\n';
    const fp = extractSampleFingerprint(content);
    expect(fp.all).toBe('');
    expect(fp.first).toBe('');
  });
});

describe('多候选指纹（方案 B）', () => {
  it('用户只粘 1 组样例 vs fetcher 抓 3 组样例 → first 候选指纹一致（核心价值）', () => {
    // 用户文本：1 组样例（2 个代码块：输入 + 输出）
    const userText = [
      '## 样例',
      '```',
      '1 2',
      '```',
      '```',
      '3',
      '```',
    ].join('\n');

    // fetcher 抓取：3 组样例（6 个代码块，前 2 个与用户文本相同）
    const fetcherText = [
      '## 样例',
      '```',
      '1 2',
      '```',
      '```',
      '3',
      '```',
      '```',
      '5 6',
      '```',
      '```',
      '7',
      '```',
    ].join('\n');

    const userFp = extractSampleFingerprint(userText);
    const fetcherFp = extractSampleFingerprint(fetcherText);

    // all 候选不同（样例数量不同）
    expect(userFp.all).not.toBe(fetcherFp.all);
    // first 候选一致（前 2 块相同）→ 方案 B 核心价值
    expect(userFp.first).toBe(fetcherFp.first);
    expect(userFp.first).not.toBe('');
  });

  it('仅 1 个代码块 → all 非空、first 为空（无法构成一组样例）', () => {
    const content = '## 样例\n```\n1 2\n```\n';
    const fp = extractSampleFingerprint(content);
    expect(fp.all).not.toBe('');
    expect(fp.first).toBe('');
  });

  it('2 个代码块 → all 与 first 均非空且相等（first 取前 2 块 = 全部块）', () => {
    const content = '## 样例\n```\n1 2\n```\n```\n3\n```\n';
    const fp = extractSampleFingerprint(content);
    expect(fp.all).not.toBe('');
    expect(fp.first).not.toBe('');
    // 2 个块时 first 取前 2 块 = 全部块，故 first === all
    expect(fp.first).toBe(fp.all);
  });

  it('3 个代码块 → all 与 first 均非空且不同', () => {
    const content = '## 样例\n```\n1 2\n```\n```\n3\n```\n```\n5 6\n```\n';
    const fp = extractSampleFingerprint(content);
    expect(fp.all).not.toBe('');
    expect(fp.first).not.toBe('');
    expect(fp.all).not.toBe(fp.first);
  });
});

describe('章节匹配扩展（方案 A）', () => {
  it('洛谷风格：### 样例 1 + ### 样例 2 三级标题合并到同一范围', () => {
    // 洛谷风格：用 ### 三级标题分多组样例
    const luoguStyle = [
      '### 样例 1',
      '',
      '```',
      '1 2',
      '```',
      '',
      '```',
      '3',
      '```',
      '',
      '### 样例 2',
      '',
      '```',
      '5 6',
      '```',
      '',
      '```',
      '7',
      '```',
    ].join('\n');

    // 用户风格：## 二级标题单一章节，代码块内容与洛谷风格完全一致
    const userStyle = [
      '## 样例',
      '',
      '```',
      '1 2',
      '```',
      '',
      '```',
      '3',
      '```',
      '',
      '```',
      '5 6',
      '```',
      '',
      '```',
      '7',
      '```',
    ].join('\n');

    const luoguFp = extractSampleFingerprint(luoguStyle);
    const userFp = extractSampleFingerprint(userStyle);

    // 章节合并后提取的代码块相同 → all 与 first 均一致
    expect(luoguFp.all).toBe(userFp.all);
    expect(luoguFp.first).toBe(userFp.first);
  });

  it('#### 四级标题"样例"也能被识别', () => {
    const content = '#### 样例\n```\n1 2\n```\n```\n3\n```\n';
    const fp = extractSampleFingerprint(content);
    expect(fp.all).not.toBe('');
    expect(fp.first).not.toBe('');
  });

  it('样例章节遇到不含"样例"的下一个标题时结束（不合并其他章节）', () => {
    // 样例章节后跟着"说明/提示"章节，不应合并
    const withHint = [
      '## 样例',
      '```',
      '1 2',
      '```',
      '```',
      '3',
      '```',
      '## 说明/提示',
      '```',
      '不应被提取的代码块',
      '```',
    ].join('\n');

    const onlySample = [
      '## 样例',
      '```',
      '1 2',
      '```',
      '```',
      '3',
      '```',
    ].join('\n');

    const fp1 = extractSampleFingerprint(withHint);
    const fp2 = extractSampleFingerprint(onlySample);
    expect(fp1.all).toBe(fp2.all);
    expect(fp1.first).toBe(fp2.first);
  });
});
