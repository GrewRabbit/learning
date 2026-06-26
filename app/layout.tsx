import type { Metadata } from 'next';
import { LayoutClient } from './layout-client';
import './globals.css';

export const metadata: Metadata = {
  title: 'C++ 编程培训辅助系统',
  description: 'AI 驱动的 C++ 编程学习辅助工具',
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
