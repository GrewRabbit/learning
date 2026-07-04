// app/lib/ai/services/__tests__/code-validator.test.ts
// CodeValidator 单元测试（架构 §5.1 接口 + §4.2 样例比对 + §8.2 g++ 沙箱）
// 用真实 g++-13 跑真实编译（g++-13 不可用则 skip）

import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { GppCodeValidator, codeValidator } from '../code-validator';

const execFileAsync = promisify(execFile);

let gppAvailable = false;
beforeAll(async () => {
  try {
    await execFileAsync('g++-13', ['--version'], { timeout: 3_000 });
    gppAvailable = true;
  } catch {
    gppAvailable = false;
  }
});

/** g++-13 不可用时跳过测试 */
const itIfGpp = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!gppAvailable) {
      console.warn('[skip] g++-13 不可用，跳过测试：', name);
      return;
    }
    await fn();
  });

describe('GppCodeValidator', () => {
  const validator = new GppCodeValidator();

  describe('g++-13 沙箱真实编译', () => {
    itIfGpp('编译成功 + 样例全部通过 → passed=true', async () => {
      const code = `#include <iostream>
int main() {
  int a, b;
  std::cin >> a >> b;
  std::cout << a + b;
  return 0;
}`;
      const samples = [
        { input: '1 2', expectedOutput: '3' },
        { input: '5 7', expectedOutput: '12' },
      ];
      const result = await validator.validate(code, samples);
      expect(result.success).toBe(true);
      expect(result.data?.compiled).toBe(true);
      expect(result.data?.passed).toBe(true);
      expect(result.data?.errors).toEqual([]);
      expect(result.data?.failures).toBeUndefined();
    });

    itIfGpp('编译失败 → compiled=false + errors 非空', async () => {
      const code = `#include <iostream>
int main() {
  syntax error here
}`;
      const result = await validator.validate(code, []);
      expect(result.success).toBe(true);
      expect(result.data?.compiled).toBe(false);
      expect(result.data?.passed).toBe(false);
      expect(result.data?.errors.length).toBeGreaterThan(0);
    });

    itIfGpp('样例部分失败 → passed=false + failures 携带失败样例', async () => {
      const code = `#include <iostream>
int main() {
  int a, b;
  std::cin >> a >> b;
  std::cout << a + b;
  return 0;
}`;
      const samples = [
        { input: '1 2', expectedOutput: '3' }, // 通过
        { input: '5 7', expectedOutput: '999' }, // 失败
      ];
      const result = await validator.validate(code, samples);
      expect(result.success).toBe(true);
      expect(result.data?.compiled).toBe(true);
      expect(result.data?.passed).toBe(false);
      expect(result.data?.failures).toHaveLength(1);
      expect(result.data?.failures?.[0].sampleIndex).toBe(1);
      expect(result.data?.failures?.[0].expected).toBe('999');
      expect(result.data?.failures?.[0].actual).toBe('12');
    });

    itIfGpp('样例全部失败 → failures 携带全部失败样例', async () => {
      const code = `#include <iostream>
int main() {
  std::cout << "wrong";
  return 0;
}`;
      const samples = [
        { input: '', expectedOutput: 'right' },
        { input: '', expectedOutput: 'correct' },
      ];
      const result = await validator.validate(code, samples);
      expect(result.data?.passed).toBe(false);
      expect(result.data?.failures).toHaveLength(2);
    });

    itIfGpp('无样例时编译通过即 passed=true', async () => {
      const code = `int main() { return 0; }`;
      const result = await validator.validate(code, []);
      expect(result.data?.compiled).toBe(true);
      expect(result.data?.passed).toBe(true);
      expect(result.data?.failures).toBeUndefined();
    });
  });

  describe('单例导出', () => {
    it('codeValidator 是 GppCodeValidator 实例', () => {
      expect(codeValidator).toBeInstanceOf(GppCodeValidator);
    });
  });
});
