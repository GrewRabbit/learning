// app/api/sso/callback/route.ts
// SSO 回调 Route Handler（架构 §5.3 M1：app/api/sso/{authorize,callback}/route.ts）
// 薄适配层：编排逻辑下沉 app/lib/sso/callback-flow.ts（R-08）

import { NextRequest, NextResponse } from 'next/server';
import { handleCallback } from '@/app/lib/sso/callback-flow';

/** GET /api/sso/callback — IDP 授权回调（FR-006~015/023） */
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleCallback(request);
}
