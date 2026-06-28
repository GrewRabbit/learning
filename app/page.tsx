// app/page.tsx
// 首页（Server Component）
// 新架构（GESP6 Web HTML）输入页待实施，当前为占位页面

export default function HomePage(): React.JSX.Element {
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-8">
      <header className="mb-8 space-y-2 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          GESP6 解题网页生成器
        </h1>
        <p className="text-sm text-muted-foreground">
          输入题目，AI 自动生成解题讲解网页
        </p>
      </header>
      <p className="text-center text-muted-foreground">
        系统建设中，参考架构文档 docs/architecture/arch-gesp6-web-html-v1.0.md
      </p>
    </main>
  );
}
