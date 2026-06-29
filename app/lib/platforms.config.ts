// app/lib/platforms.config.ts
// 平台声明式配置（架构 §5.2 PlatformConfig + §6 目录结构）
// 新增平台仅改本文件，不改抓取模块路由代码（架构 §6 约束）

/**
 * 平台配置（架构 §5.2）
 * urlPattern: 必须以 ^https:// 开头，禁止匹配 http://（SSRF 防护，见 §8.2）
 * idExtractor: 从 URL 提取题号，无匹配返回 null
 * fetcherType: 决定 ProblemFetcher 路由到 LuoguFetcher（API）或 YoudaoFetcher（DOM）
 */
export type PlatformConfig = {
  name: string;
  displayName: string;
  urlPattern: RegExp;
  idExtractor: (url: string) => string | null;
  fetcherType: 'luogu-api' | 'dom-scrape';
};

/**
 * 已配置平台列表
 * 洛谷（https://www.luogu.com.cn/problem/P11447 → P11447）：API 抓取 Markdown
 * 有道小图灵（支持两种 URL 格式，cheerio DOM 解析）：
 *   - 标准格式：https://oj.youdao.com/problem/7997 → 7997
 *   - 练习路径：https://oj.youdao.com/exercise/7/48/4924/1 → 4924（题号在倒数第二段）
 *   - 均允许带 query string（如 ?from=problems、?title=简单排序）
 */
export const PLATFORMS: readonly PlatformConfig[] = [
  {
    name: 'luogu',
    displayName: '洛谷',
    urlPattern: /^https:\/\/www\.luogu\.com\.cn\/problem\/(\w+)$/,
    idExtractor: (url) =>
      url.match(/^https:\/\/www\.luogu\.com\.cn\/problem\/(\w+)$/)?.[1] ?? null,
    fetcherType: 'luogu-api',
  },
  {
    name: 'youdao',
    displayName: '有道小图灵',
    // 支持两种 URL + 可选 query string：
    //   /problem/{problemId}
    //   /exercise/{a}/{b}/{problemId}/{seq}  （题号在倒数第二段）
    urlPattern:
      /^https:\/\/oj\.youdao\.com\/(?:problem\/\d+|exercise\/\d+\/\d+\/\d+\/\d+)(?:\?.*)?$/,
    idExtractor: (url) => {
      try {
        const { pathname } = new URL(url);
        // 标准格式：/problem/{problemId}
        const problemMatch = pathname.match(/^\/problem\/(\d+)$/);
        if (problemMatch) return problemMatch[1];
        // 练习路径：/exercise/{a}/{b}/{problemId}/{seq}（题号在倒数第二段）
        const exerciseMatch = pathname.match(
          /^\/exercise\/\d+\/\d+\/(\d+)\/\d+$/,
        );
        if (exerciseMatch) return exerciseMatch[1];
        return null;
      } catch {
        return null;
      }
    },
    fetcherType: 'dom-scrape',
  },
];
