import type { Metadata } from 'next';
import { LayoutClient } from './layout-client';
import './globals.css';

export const metadata: Metadata = {
  title: 'GESP6 解题网页生成器',
  description: '输入题目，AI 自动生成解题讲解网页',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <LayoutClient>{children}</LayoutClient>
      </body>
    </html>
  );
}
