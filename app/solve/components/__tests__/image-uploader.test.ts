// app/solve/components/__tests__/image-uploader.test.ts
// validateFile 纯函数单元测试（P1-2）
//
// 仅测试导出的 validateFile（格式 + 大小验证），不测试组件渲染。
// 三种上传方式（文件选择 / 剪贴板粘贴 / 摄像头）依赖浏览器 API（FileReader、
// getUserMedia、canvas、paste 事件），jsdom 模拟困难且脆弱，由 E2E 覆盖更合适。
// 故不引入 jsdom + @testing-library/react，保持测试栈简洁。

import { describe, it, expect } from 'vitest';
import { validateFile } from '../image-uploader';

/** 构造 mock File（validateFile 仅读取 type/size，无需真实文件内容） */
function mockFile(type: string, size: number): File {
  return { type, size } as unknown as File;
}

describe('validateFile（格式 + 大小验证）', () => {
  describe('格式验证', () => {
    it('合法 JPEG → null（通过）', () => {
      expect(validateFile(mockFile('image/jpeg', 1024))).toBeNull();
    });

    it('合法 PNG → null（通过）', () => {
      expect(validateFile(mockFile('image/png', 1024))).toBeNull();
    });

    it('GIF 格式 → 提示仅支持 JPG/PNG', () => {
      expect(validateFile(mockFile('image/gif', 1024))).toBe('仅支持 JPG / PNG 格式');
    });

    it('WEBP 格式 → 提示仅支持 JPG/PNG', () => {
      expect(validateFile(mockFile('image/webp', 1024))).toBe('仅支持 JPG / PNG 格式');
    });

    it('空 type → 提示仅支持 JPG/PNG', () => {
      expect(validateFile(mockFile('', 1024))).toBe('仅支持 JPG / PNG 格式');
    });
  });

  describe('大小验证', () => {
    const MAX = 5 * 1024 * 1024; // 5MB

    it('正好 5MB（边界）→ null（通过）', () => {
      expect(validateFile(mockFile('image/jpeg', MAX))).toBeNull();
    });

    it('5MB + 1 字节 → 提示超过限制', () => {
      expect(validateFile(mockFile('image/jpeg', MAX + 1))).toBe(
        '图片大小不能超过 5MB',
      );
    });

    it('0 字节 → null（通过，空文件不拦截）', () => {
      expect(validateFile(mockFile('image/png', 0))).toBeNull();
    });
  });

  describe('格式 + 大小组合', () => {
    it('格式错误优先于大小检查', () => {
      // 格式不合法时优先返回格式错误
      const result = validateFile(mockFile('image/gif', 10 * 1024 * 1024));
      expect(result).toBe('仅支持 JPG / PNG 格式');
    });

    it('合法格式 + 超限大小 → 大小错误', () => {
      const result = validateFile(mockFile('image/png', 10 * 1024 * 1024));
      expect(result).toBe('图片大小不能超过 5MB');
    });
  });
});
