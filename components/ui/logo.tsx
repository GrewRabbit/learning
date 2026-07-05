// components/ui/logo.tsx
// 品牌 Logo 组件（基础 UI 组件）
// 使用 next/image 实现自动格式优化与懒加载（deployment-checklist.md §四 性能优化）
// 使用 next/link 提供点击交互（链接到首页）

import Image from 'next/image';
import Link from 'next/link';

import { cn } from '@/lib/utils';

export interface LogoProps {
  /** 尺寸变体（移动优先，断点处自动放大） */
  size?: 'sm' | 'md' | 'lg';
  /** 额外类名 */
  className?: string;
}

/**
 * 尺寸变体表
 * 移动端基础尺寸 → sm/md 断点放大（响应式比例）
 * 使用相对定位 + h/w 约束，配合 next/image fill 实现自适应
 */
const sizeVariants: Record<NonNullable<LogoProps['size']>, string> = {
  sm: 'h-8 w-8 sm:h-10 sm:w-10',
  md: 'h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16',
  lg: 'h-16 w-16 sm:h-20 sm:w-20 md:h-24 md:w-24',
};

/**
 * 响应 sizes 属性，帮助 Next.js 生成正确 srcset
 * 与 sizeVariants 保持一致，避免下载过大图片
 */
const sizeSrcSet: Record<NonNullable<LogoProps['size']>, string> = {
  sm: '(max-width: 640px) 32px, 40px',
  md: '(max-width: 640px) 48px, (max-width: 768px) 56px, 64px',
  lg: '(max-width: 640px) 64px, (max-width: 768px) 80px, 96px',
};

/**
 * 品牌 Logo 组件
 * - 保持原始宽高比（不强制圆形裁剪，避免遮挡品牌内容）
 * - priority 标记首屏优先加载（LCP 优化）
 * - 链接到首页（点击交互）
 */
export function Logo({ size = 'md', className }: LogoProps): React.JSX.Element {
  return (
    <Link
      href="/"
      aria-label="返回首页 - 信奥赛 C++ 解题专家"
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center',
        sizeVariants[size],
        className,
      )}
    >
      <Image
        src="/happyrabbit-logo.png"
        alt="Happy Rabbit 品牌 Logo"
        fill
        priority
        sizes={sizeSrcSet[size]}
        className="object-contain"
      />
    </Link>
  );
}
