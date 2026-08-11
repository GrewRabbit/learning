'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';

import { LoginButton } from '@/components/auth/login-button';
import { Logo } from '@/components/ui/logo';
import { Button } from '@/components/ui/button';
import { UserMenu } from './user-menu';
import {
  getHeaderSsoUrls,
  getSafeSsoUrls,
  isLoginPath,
} from './header-utils';

export function HeaderBar({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}): React.JSX.Element {
  const pathname = usePathname();

  if (isLoginPath(pathname)) {
    return <></>;
  }

  const { registerUri } = getSafeSsoUrls(getHeaderSsoUrls());

  return (
    <header className="sticky top-0 z-30 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo size="sm" />
        {isAuthenticated ? (
          <UserMenu />
        ) : (
          <nav className="flex items-center gap-2">
            {registerUri != null && (
              <Button asChild variant="ghost" size="sm">
                <a href={registerUri} target="_blank" rel="noopener noreferrer">
                  注册
                </a>
              </Button>
            )}
            <LoginButton>登录</LoginButton>
          </nav>
        )}
      </div>
    </header>
  );
}