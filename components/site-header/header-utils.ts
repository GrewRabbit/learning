export interface HeaderSsoUrls {
  registerUri?: string;
  dashboardUrl?: string;
}

export function getHeaderSsoUrls(): HeaderSsoUrls {
  return {
    registerUri: process.env.NEXT_PUBLIC_SSO_REGISTER_URI || undefined,
    dashboardUrl: process.env.NEXT_PUBLIC_SSO_DASHBOARD_URL || undefined,
  };
}

export function isLoginPath(pathname: string): boolean {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized === '/login' || /^\/[^/]+\/login$/.test(normalized);
}

export function getSafeSsoUrl(url: string | undefined): string | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const { protocol } = new URL(url);
    if (protocol === 'https:' || protocol === 'http:') {
      return url;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function getSafeSsoUrls(urls: HeaderSsoUrls): {
  registerUri?: string;
  dashboardUrl?: string;
} {
  return {
    registerUri: getSafeSsoUrl(urls.registerUri),
    dashboardUrl: getSafeSsoUrl(urls.dashboardUrl),
  };
}

export function decodeJwtExp(token: string): number | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(
      Math.ceil(parts[1].length / 4) * 4,
      '=',
    );
    const payload = JSON.parse(Buffer.from(base64, 'base64').toString('utf-8')) as {
      exp?: number;
    };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : undefined;
  } catch {
    return undefined;
  }
}

export function isSessionActive(exp: number | undefined, nowSec?: number): boolean {
  if (exp === undefined) {
    return false;
  }
  const now = nowSec ?? Math.floor(Date.now() / 1000);
  return now < exp;
}