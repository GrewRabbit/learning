'use client';

import * as React from 'react';
import { User } from 'lucide-react';

import { LogoutButton } from '@/components/auth/logout-button';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getHeaderSsoUrls, getSafeSsoUrls } from './header-utils';

export function UserMenu(): React.JSX.Element {
  const { dashboardUrl } = getSafeSsoUrls(getHeaderSsoUrls());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full"
          aria-label="用户菜单"
        >
          <User className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {dashboardUrl != null && (
          <DropdownMenuItem asChild>
            <a href={dashboardUrl} target="_blank" rel="noopener noreferrer">
              用户信息
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
          <LogoutButton />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}