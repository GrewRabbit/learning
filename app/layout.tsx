import type { Metadata } from 'next';
import { LayoutClient } from './layout-client';
import { SiteHeader } from '@/components/site-header/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: '信奥赛 C++ 解题专家',
  description: '输入题目，AI 自动生成解题讲解方案',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <SiteHeader />
        <LayoutClient>{children}</LayoutClient>
      </body>
    </html>
  );
}
