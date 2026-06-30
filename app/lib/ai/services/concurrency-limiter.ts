// app/lib/ai/services/concurrency-limiter.ts
// 简单的 Promise 并发限制器（P1 修复）
//
// 适用场景：
// - LLM API 调用并发限制（避免触发服务方 QPS 限制）
// - g++ 编译并发限制（避免 CPU 资源耗尽）
//
// 设计要点：
// 1. 全局单例（模块级 const），所有请求共享同一限制器
// 2. 超过并发上限时，新请求进入 FIFO 队列等待
// 3. 不引入外部依赖（如 p-limit），保持项目轻量
// 4. 不支持优先级 / 超时取消（保持简单，未来需要再扩展）

/** 并发限制器：限制同时运行的 Promise 数量 */
export class ConcurrencyLimiter {
  /** 当前正在运行的 Promise 数量 */
  private active = 0;
  /** 等待队列（FIFO，存储 resolve 回调） */
  private readonly queue: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  /**
   * 执行异步函数，受并发限制
   * 超过上限时排队等待，按 FIFO 顺序执行
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    // 超过并发上限 → 进入队列等待
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      // 唤醒队列中下一个等待者
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }

  /** 当前活跃任务数（供测试与监控使用） */
  getActiveCount(): number {
    return this.active;
  }

  /** 当前等待队列长度（供测试与监控使用） */
  getQueueLength(): number {
    return this.queue.length;
  }
}
