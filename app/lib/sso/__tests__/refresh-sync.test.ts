// app/lib/sso/__tests__/refresh-sync.test.ts
// refresh-sync 单元测试（架构 AD-13 / AR2-003，spec-sso-token FR-005~FR-007 跨标签页扩展 OQ-05）
//
// 覆盖：sessionStorage 读写清、cookie 兜底镜像、BroadcastChannel 发信号/订阅/退订、
//       跨标签页广播（信号不含 token）、SSR（无 window）与无 BroadcastChannel 环境安全降级 no-op
//
// 全 mock：vi.stubGlobal 模拟 window / document / sessionStorage / BroadcastChannel（node 环境，无 jsdom）。
// 每个用例 vi.resetModules() + 动态 import 保证模块级惰性 channel 缓存不跨用例污染。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  REFRESH_TOKEN_SESSION_KEY,
  REFRESH_BROADCAST_CHANNEL,
  REFRESH_BROADCAST_SIGNAL,
} from '../refresh-sync';
import { REFRESH_TOKEN_COOKIE_NAME } from '../token-cookie';

type RefreshSyncModule = typeof import('../refresh-sync');
let ssoModule: RefreshSyncModule;

/** Storage 接口轻量 mock（Map 实现，行为与浏览器一致） */
function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length(): number {
      return store.size;
    },
    clear: (): void => {
      store.clear();
    },
    getItem: (key: string): string | null => {
      const value = store.get(key);
      return value === undefined ? null : value;
    },
    key: (index: number): string | null => {
      const keys = [...store.keys()];
      return index >= 0 && index < keys.length ? (keys[index] ?? null) : null;
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    setItem: (key: string, value: string): void => {
      store.set(key, value);
    },
  };
}

/**
 * BroadcastChannel 轻量 mock：
 * - 记录各实例 postMessage 载荷（posted）
 * - postMessage 模拟真实广播语义：投递给同通道名的其他实例（不投递自身）
 * - dispatch(data) 为测试助手：直接触发本实例的 message 监听器
 */
class BroadcastChannelMock {
  static instances: BroadcastChannelMock[] = [];

  readonly name: string;
  readonly posted: unknown[] = [];
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  constructor(name: string) {
    this.name = name;
    BroadcastChannelMock.instances.push(this);
  }

  postMessage(data: unknown): void {
    this.posted.push(data);
    for (const other of BroadcastChannelMock.instances) {
      if (other !== this && other.name === this.name) {
        other.dispatch(data);
      }
    }
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    if (type === 'message') {
      this.listeners.add(listener);
    }
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  close(): void {
    // no-op（测试不需要）
  }

  dispatch(data: unknown): void {
    const event = { data } as MessageEvent;
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }
}

/** 注入浏览器全局（window/document/sessionStorage/BroadcastChannel） */
function stubBrowserEnv(cookie = ''): void {
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', { cookie });
  vi.stubGlobal('sessionStorage', createStorageMock());
  vi.stubGlobal('BroadcastChannel', BroadcastChannelMock);
}

/** 默认浏览器环境：每个用例新鲜模块 + 干净 mock 状态 */
beforeEach(async () => {
  vi.resetModules();
  BroadcastChannelMock.instances = [];
  stubBrowserEnv();
  ssoModule = await import('../refresh-sync');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sessionStorage 镜像（get / set / clear）', () => {
  it('sessionStorage 无值 → getSsoRefreshToken 返回 null', () => {
    expect(ssoModule.getSsoRefreshToken()).toBeNull();
  });

  it('sessionStorage 有值 → 直接返回该值', () => {
    globalThis.sessionStorage.setItem(REFRESH_TOKEN_SESSION_KEY, 'rt-1');
    expect(ssoModule.getSsoRefreshToken()).toBe('rt-1');
  });

  it('setSsoRefreshToken 写入后 get 返回该值，且落盘到 sessionStorage', () => {
    ssoModule.setSsoRefreshToken('rt-2');
    expect(ssoModule.getSsoRefreshToken()).toBe('rt-2');
    expect(globalThis.sessionStorage.getItem(REFRESH_TOKEN_SESSION_KEY)).toBe('rt-2');
  });

  it('clearSsoRefreshToken 清除后返回 null，且 sessionStorage 键被移除', () => {
    ssoModule.setSsoRefreshToken('rt-3');
    ssoModule.clearSsoRefreshToken();
    expect(ssoModule.getSsoRefreshToken()).toBeNull();
    expect(globalThis.sessionStorage.getItem(REFRESH_TOKEN_SESSION_KEY)).toBeNull();
  });
});

describe('cookie 兜底镜像（sessionStorage 无值时读 document.cookie 并写入）', () => {
  it('sessionStorage 无值且 cookie 存在 → 写入 sessionStorage 并返回该值', () => {
    stubBrowserEnv(`${REFRESH_TOKEN_COOKIE_NAME}=rt-cookie`);
    expect(ssoModule.getSsoRefreshToken()).toBe('rt-cookie');
    expect(globalThis.sessionStorage.getItem(REFRESH_TOKEN_SESSION_KEY)).toBe('rt-cookie');
  });

  it('sessionStorage 有值 → 优先返回 sessionStorage，不受 cookie 影响', () => {
    stubBrowserEnv(`${REFRESH_TOKEN_COOKIE_NAME}=rt-cookie`);
    globalThis.sessionStorage.setItem(REFRESH_TOKEN_SESSION_KEY, 'rt-session');
    expect(ssoModule.getSsoRefreshToken()).toBe('rt-session');
  });

  it('cookie 无同名键 → 返回 null，不写入 sessionStorage', () => {
    stubBrowserEnv('other_cookie=1');
    expect(ssoModule.getSsoRefreshToken()).toBeNull();
    expect(globalThis.sessionStorage.getItem(REFRESH_TOKEN_SESSION_KEY)).toBeNull();
  });
});

describe('BroadcastChannel 信号（仅信号不传 token，AR2-003）', () => {
  it('notifyRefreshOccurred → 向命名通道 postMessage 字符串信号', () => {
    ssoModule.notifyRefreshOccurred();
    expect(BroadcastChannelMock.instances).toHaveLength(1);
    const [channel] = BroadcastChannelMock.instances;
    expect(channel.name).toBe(REFRESH_BROADCAST_CHANNEL);
    expect(channel.posted).toEqual([REFRESH_BROADCAST_SIGNAL]);
    expect(typeof channel.posted[0]).toBe('string');
  });

  it('subscribeRefreshSignal 收到信号后调用回调一次', () => {
    const callback = vi.fn();
    ssoModule.subscribeRefreshSignal(callback);
    const [channel] = BroadcastChannelMock.instances;
    channel.dispatch(REFRESH_BROADCAST_SIGNAL);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe 后不再回调', () => {
    const callback = vi.fn();
    const unsubscribe = ssoModule.subscribeRefreshSignal(callback);
    const [channel] = BroadcastChannelMock.instances;
    channel.dispatch(REFRESH_BROADCAST_SIGNAL);
    expect(callback).toHaveBeenCalledTimes(1);
    unsubscribe();
    channel.dispatch(REFRESH_BROADCAST_SIGNAL);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('异源消息（非信号数据）不触发回调', () => {
    const callback = vi.fn();
    ssoModule.subscribeRefreshSignal(callback);
    const [channel] = BroadcastChannelMock.instances;
    channel.dispatch({ unexpected: 'payload' });
    channel.dispatch('other-string');
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('跨标签页协同（AD-13：A 页签广播 → B 页签收信号自行刷新）', () => {
  it('他页签通道实例 postMessage 信号 → 本页签订阅者收到回调，且信号不含 token', () => {
    const callback = vi.fn();
    // 本页签（标签页 B）：模块订阅信号，持有通道实例 0
    ssoModule.subscribeRefreshSignal(callback);
    // 标签页 A：同一通道名的另一个实例
    const tabA = new BroadcastChannelMock(REFRESH_BROADCAST_CHANNEL);
    tabA.postMessage(REFRESH_BROADCAST_SIGNAL);

    expect(callback).toHaveBeenCalledTimes(1);
    // 信号仅为字符串，不含任何 token 值（AR2-003）
    expect(tabA.posted).toEqual([REFRESH_BROADCAST_SIGNAL]);
    expect(JSON.stringify(tabA.posted)).not.toContain('refresh_token');
    expect(JSON.stringify(tabA.posted)).not.toContain('rt-');
  });
});

describe('非浏览器环境安全降级（SSR / 测试 node：无 window）', () => {
  beforeEach(async () => {
    vi.resetModules();
    BroadcastChannelMock.instances = [];
    vi.unstubAllGlobals(); // 不注入任何浏览器全局，模拟 SSR / node 环境
    ssoModule = await import('../refresh-sync');
  });

  it('各函数 no-op / 返回 null，不抛错', () => {
    expect(ssoModule.getSsoRefreshToken()).toBeNull();
    expect(() => ssoModule.setSsoRefreshToken('rt-x')).not.toThrow();
    expect(() => ssoModule.clearSsoRefreshToken()).not.toThrow();
    expect(() => ssoModule.notifyRefreshOccurred()).not.toThrow();

    const unexpected = vi.fn(() => {
      throw new Error('SSR 下不应触发回调');
    });
    const unsubscribe = ssoModule.subscribeRefreshSignal(unexpected);
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();

    // 未创建任何 BroadcastChannel（降级为 null，不初始化）
    expect(BroadcastChannelMock.instances).toHaveLength(0);
  });
});

describe('浏览器环境但 BroadcastChannel 不可用', () => {
  beforeEach(async () => {
    vi.resetModules();
    BroadcastChannelMock.instances = [];
    vi.unstubAllGlobals();
    // 浏览器全局存在，但显式模拟 BroadcastChannel 缺失（旧浏览器 / 受限环境）
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('sessionStorage', createStorageMock());
    vi.stubGlobal('BroadcastChannel', undefined);
    ssoModule = await import('../refresh-sync');
  });

  it('notify/subscribe 为 no-op 不抛错；sessionStorage 功能不受影响', () => {
    expect(() => ssoModule.notifyRefreshOccurred()).not.toThrow();
    const callback = vi.fn();
    const unsubscribe = ssoModule.subscribeRefreshSignal(callback);
    expect(typeof unsubscribe).toBe('function');
    expect(() => unsubscribe()).not.toThrow();
    expect(callback).not.toHaveBeenCalled();

    // 无 BroadcastChannel 不影响 sessionStorage 镜像功能
    ssoModule.setSsoRefreshToken('rt-y');
    expect(ssoModule.getSsoRefreshToken()).toBe('rt-y');
    ssoModule.clearSsoRefreshToken();
    expect(ssoModule.getSsoRefreshToken()).toBeNull();
  });
});
