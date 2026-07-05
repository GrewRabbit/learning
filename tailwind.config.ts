import type { Config } from 'tailwindcss';

/**
 * Tailwind 配置
 * colors 通过 hsl(var(--xxx)) 引用 globals.css 中的语义化 CSS 变量
 * 颜色单一来源在 CSS 变量中定义，符合 component-rules.md "CSS 驱动" 原则
 *
 * 注：当前项目使用 Tailwind v3.4.17，theme.extend.colors 是 v3 必需的"代理层"
 *     （引用 CSS 变量，非重复定义颜色值）。
 *     CR1-008（完全移除 theme.extend）依赖 Tailwind v4 的自动 CSS 变量解析能力
 *     （v4 语法 -(--var-name)）。在 v3 下完全移除会导致：
 *       1. globals.css 中 @apply border-border 报错（类不存在）
 *       2. 组件中 bg-card / text-destructive 等语义类不会生成 CSS
 *     待升级至 Tailwind v4 后可完全移除 theme.extend。
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        // 语义色（spec §7.9 流程图节点 / §7.10 思维导图层级）
        success: {
          DEFAULT: 'hsl(var(--color-success))',
          foreground: 'hsl(var(--color-success-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--color-warning))',
          foreground: 'hsl(var(--color-warning-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--color-info))',
          foreground: 'hsl(var(--color-info-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
