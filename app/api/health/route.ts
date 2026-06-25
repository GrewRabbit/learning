// app/api/health/route.ts
// 健康检查端点（架构 §7.4，遵循 deployment-checklist.md）
// 路径：GET /api/health
// 返回：{ status: 'ok', timestamp: string }
// 用途：部署后验证服务可用性，不依赖外部服务（AI 模型、数据库）

import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
}
