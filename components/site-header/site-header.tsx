import { cookies } from 'next/headers';

import { ACCESS_TOKEN_COOKIE_NAME } from '@/app/lib/sso/token-cookie';
import { HeaderBar } from './header-bar';
import { decodeJwtExp, isSessionActive } from './header-utils';

export async function SiteHeader(): Promise<React.JSX.Element> {
  const cookieStore = await cookies();
  const token = cookieStore.get(ACCESS_TOKEN_COOKIE_NAME)?.value;
  const isAuthenticated = isSessionActive(token !== undefined ? decodeJwtExp(token) : undefined);
  return <HeaderBar isAuthenticated={isAuthenticated} />;
}