// app/lib/ai/services/__tests__/html-parser.test.ts
// HtmlParser 单元测试（架构 §4.2 解析规则 + §5.1 接口）
// 纯函数测试，无需 mock

import { describe, it, expect } from 'vitest';
import { StateMachineHtmlParser, htmlParser } from '../html-parser';

describe('StateMachineHtmlParser', () => {
  const parser = new StateMachineHtmlParser();

  describe('正常路径', () => {
    it('解析完整 META + HTML', () => {
      const meta = {
        code: '#include <iostream>\nint main(){}',
        samples: [{ input: '1 2', expectedOutput: '3' }],
      };
      const raw = `<<<META>>>${JSON.stringify(meta)}<<<HTML>>><!DOCTYPE html><html></html>`;
      const result = parser.parseMetaAndHtml(raw);
      expect(result.success).toBe(true);
      expect(result.data?.meta.code).toBe(meta.code);
      expect(result.data?.meta.samples).toHaveLength(1);
      expect(result.data?.meta.samples[0].input).toBe('1 2');
      expect(result.data?.meta.samples[0].expectedOutput).toBe('3');
      expect(result.data?.html).toBe('<!DOCTYPE html><html></html>');
    });

    it('META 前有前导文本仍能解析', () => {
      const meta = { code: 'x', samples: [] };
      const raw = `前导文本\n<<<META>>>${JSON.stringify(meta)}<<<HTML>>>html`;
      const result = parser.parseMetaAndHtml(raw);
      expect(result.success).toBe(true);
      expect(result.data?.html).toBe('html');
    });

    it('HTML 内容中含 <<<META>>> 字符串视为普通内容（标记乱序规则）', () => {
      const meta = { code: 'x', samples: [] };
      const raw = `<<<META>>>${JSON.stringify(meta)}<<<HTML>>><div><<<META>>></div>`;
      const result = parser.parseMetaAndHtml(raw);
      expect(result.success).toBe(true);
      expect(result.data?.html).toBe('<div><<<META>>></div>');
    });

    it('samples 字段 input/expectedOutput 为非字符串时强制 String 转换', () => {
      const meta = { code: 'x', samples: [{ input: 123, expectedOutput: true }] };
      const raw = `<<<META>>>${JSON.stringify(meta)}<<<HTML>>>html`;
      const result = parser.parseMetaAndHtml(raw);
      expect(result.success).toBe(true);
      expect(result.data?.meta.samples[0].input).toBe('123');
      expect(result.data?.meta.samples[0].expectedOutput).toBe('true');
    });
  });

  describe('错误路径', () => {
    it('无 META 标记返回 GESP6_LLM_FORMAT_ERROR', () => {
      const result = parser.parseMetaAndHtml('只有 HTML 没有 META');
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_LLM_FORMAT_ERROR');
    });

    it('META JSON 非法返回 FORMAT_ERROR', () => {
      const raw = `<<<META>>>{invalid json}<<<HTML>>>html`;
      const result = parser.parseMetaAndHtml(raw);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_LLM_FORMAT_ERROR');
    });

    it('META 缺少 code 字段返回 FORMAT_ERROR', () => {
      const raw = `<<<META>>>${JSON.stringify({ samples: [] })}<<<HTML>>>html`;
      const result = parser.parseMetaAndHtml(raw);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_LLM_FORMAT_ERROR');
    });

    it('META 缺少 samples 字段返回 FORMAT_ERROR', () => {
      const raw = `<<<META>>>${JSON.stringify({ code: 'x' })}<<<HTML>>>html`;
      const result = parser.parseMetaAndHtml(raw);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_LLM_FORMAT_ERROR');
    });

    it('META 内容为空返回 FORMAT_ERROR', () => {
      const raw = `<<<META>>>   <<<HTML>>>html`;
      const result = parser.parseMetaAndHtml(raw);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_LLM_FORMAT_ERROR');
    });

    it('META JSON 为 null 返回 FORMAT_ERROR', () => {
      const raw = `<<<META>>>null<<<HTML>>>html`;
      const result = parser.parseMetaAndHtml(raw);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_LLM_FORMAT_ERROR');
    });
  });

  describe('降级路径', () => {
    it('无 HTML 标记降级返回空 HTML', () => {
      const meta = { code: 'x', samples: [] };
      const raw = `<<<META>>>${JSON.stringify(meta)}`;
      const result = parser.parseMetaAndHtml(raw);
      expect(result.success).toBe(true);
      expect(result.data?.html).toBe('');
      expect(result.data?.meta.code).toBe('x');
    });
  });

  describe('标记重复', () => {
    // indexOf 简化方案已知特性（html-parser.ts 注释）：
    // META 标记重复时，metaRaw 含 "{first}<<<META>>>{second}"，JSON.parse 失败 → FORMAT_ERROR
    // 实际 LLM 输出极少出现 META 重复（§1.2 不流式，完整字符串），此边界不影响实际使用
    it('META 标记重复时 metaRaw 含非法 JSON → FORMAT_ERROR', () => {
      const meta1 = { code: 'first', samples: [] };
      const raw = `<<<META>>>${JSON.stringify(meta1)}<<<META>>>{"code":"second","samples":[]}<<<HTML>>>html`;
      const result = parser.parseMetaAndHtml(raw);
      expect(result.success).toBe(false);
      expect(result.error?.code).toBe('GESP6_LLM_FORMAT_ERROR');
    });

    it('HTML 标记重复仅识别首次（后续视为 HTML 内容）', () => {
      const meta = { code: 'x', samples: [] };
      const raw = `<<<META>>>${JSON.stringify(meta)}<<<HTML>>>part1<<<HTML>>>part2`;
      const result = parser.parseMetaAndHtml(raw);
      expect(result.success).toBe(true);
      expect(result.data?.html).toBe('part1<<<HTML>>>part2');
    });
  });

  describe('单例导出', () => {
    it('htmlParser 是 StateMachineHtmlParser 实例', () => {
      expect(htmlParser).toBeInstanceOf(StateMachineHtmlParser);
    });
  });
});
