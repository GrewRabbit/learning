'use client';
// app/lib/sso/refresh-sync.ts
// M4 跨标签页刷新协同（浏览器侧工具模块，架构 AD-13 / AR2-003；spec-sso-token FR-005~FR-007 跨标签页扩展 OQ-05）
//
// 职责：
//   - sessionStorage 镜像 refresh_token（前端兜底通道；httpOnly cookie 为权威，AR2-003）
//   - BroadcastChannel 广播「刷新完成」信号：仅发字符串信号、不传 token（AR2-003 裁决），
//     他标签页收到信号后自行调 /api/sso/refresh（服务端 Set-Cookie 回写）或清 sessionStorage + 提示重登
//
// 运行分层：纯浏览器 Web API（window / sessionStorage / document / BroadcastChannel），无 Node 依赖；
//   非浏览器环境（SSR / 测试 node 环境）下全部函数安全降级为 no-op / 返回 null，不抛错。
// 日志脱敏（FR-026）：本模块不落日志，token 值仅存在于 sessionStorage 内存通道。

import { REFRESH_TOKEN_COOKIE_NAME } from './token-cookie';

/** sessionStorage 中镜像 refresh_token 的键（前端兜底，httpOnly cookie 为权威） */
export const REFRESH_TOKEN_SESSION_KEY = 'sso_refresh_token';

/** BroadcastChannel 通道名（仅同源标签页间通信） */
export const REFRESH_BROADCAST_CHANNEL = 'sso_refresh_sync';

/** 广播信号：仅字符串信号，不含任何 token 数据（AR2-003） */
export const REFRESH_BROADCAST_SIGNAL = 'sso-refresh-occurred';

/** 惰性创建的 BroadcastChannel：undefined=未初始化，null=环境不支持（缓存避免重复创建） */
let channelInstance: BroadcastChannel | null | undefined;

/** 取当前页签的 sessionStorage；非浏览器环境返回 null */
function currentSessionStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  const storage = globalThis.sessionStorage;
  return typeof storage === 'undefined' || storage === null ? null : storage;
}

/** 惰性获取 BroadcastChannel：仅浏览器且支持该 API 时才创建（测试 stub 生效后再初始化） */
function getChannel(): BroadcastChannel | null {
  if (channelInstance === undefined) {
    channelInstance =
      typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(REFRESH_BROADCAST_CHANNEL)
        : null;
  }
  return channelInstance;
}

/** 从 document.cookie 读取指定 cookie 值；httpOnly cookie 读不到 → null */
function readCookieValue(name: string): string | null {
  if (typeof window === 'undefined' || typeof globalThis.document === 'undefined') {
    return null;
  }
  const raw = globalThis.document.cookie;
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0 || trimmed.slice(0, eqIndex) !== name) {
      continue;
    }
    return trimmed.slice(eqIndex + 1);
  }
  return null;
}

/**
 * 读 refresh_token：优先 sessionStorage 镜像；无值且存在同名非 httpOnly cookie 时
 * 镜像写入 sessionStorage 并返回；均无 → null（httpOnly 通道 document.cookie 读不到，服务端为权威）
 */
export function getSsoRefreshToken(): string | null {
  const storage = currentSessionStorage();
  if (storage !== null) {
    const stored = storage.getItem(REFRESH_TOKEN_SESSION_KEY);
    if (typeof stored === 'string' && stored.length > 0) {
      return stored;
    }
  }
  const cookieValue = readCookieValue(REFRESH_TOKEN_COOKIE_NAME);
  if (cookieValue !== null) {
    setSsoRefreshToken(cookieValue);
    return cookieValue;
  }
  return null;
}

/** 写 refresh_token 到 sessionStorage（隐私模式 / 配额超限写失败时静默降级，sessionStorage 仅为兜底通道） */
export function setSsoRefreshToken(token: string): void {
  const storage = currentSessionStorage();
  if (storage === null) {
    return;
  }
  try {
    storage.setItem(REFRESH_TOKEN_SESSION_KEY, token);
  } catch {
    // 配额超限 / 隐私模式拒绝写入：忽略，不阻断主流程（与 solve 侧 sessionStorage 降级一致）
  }
}

/** 清除 sessionStorage 中的 refresh_token 镜像（登出 / 会话失效时调用） */
export function clearSsoRefreshToken(): void {
  const storage = currentSessionStorage();
  if (storage !== null) {
    storage.removeItem(REFRESH_TOKEN_SESSION_KEY);
  }
}

/** 广播「刷新完成」信号（仅字符串信号，不含 token，AR2-003）；非浏览器环境 no-op */
export function notifyRefreshOccurred(): void {
  getChannel()?.postMessage(REFRESH_BROADCAST_SIGNAL);
}

/**
 * 订阅「刷新完成」信号：收到后调用 callback（他标签页据此调 /api/sso/refresh 或清 sessionStorage + 提示重登）
 * 返回取消订阅函数（供组件 useEffect 清理）；非浏览器环境订阅为 no-op
 */
export function subscribeRefreshSignal(callback: () => void): () => void {
  const channel = getChannel();
  if (channel === null) {
    return () => {};
  }
  const handler = (event: MessageEvent): void => {
    if (event.data === REFRESH_BROADCAST_SIGNAL) {
      callback();
    }
  };
  channel.addEventListener('message', handler);
  return () => {
    channel.removeEventListener('message', handler);
  };
}
