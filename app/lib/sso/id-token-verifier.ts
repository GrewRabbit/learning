// app/lib/sso/id-token-verifier.ts
// id_token 验证器（M2）：OIDC id_token 8 步验证（FR-011）
// - strict（默认）：任一验证失败 → 拒绝登录（AUTH_ID_TOKEN_INVALID）
// - soft：验证失败仅记日志、不拒绝登录（AC-013），数据尽量解析
// - JWKS 经 discoveryService.getJwks(kid) 获取（kid 未命中自动刷新重取，FR-012）
// 参考：架构 arch-sso-v1.2 §4.1.2 步骤 6 / §5.2，spec-sso-auth FR-011/FR-012/AC-012/AC-013

import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import type { JWK } from 'jose';
import type { ServiceResult } from '@/app/lib/ai/types';
import type { IdTokenClaims } from './types';
import { getSsoConfig } from './config';
import { DiscoveryService, discoveryService } from './discovery-service';
import { logger } from '@/app/lib/logging/logger';

const ALLOWED_ALGORITHM = 'RS256';
const CLOCK_TOLERANCE_SECONDS = 60;
const ERROR_CODE = 'AUTH_ID_TOKEN_INVALID';

interface IdTokenVerifierOptions {
  fetchFn?: typeof fetch;
}

/** 从 JWKS keys 中按 kid 精确匹配公钥（FR-011 ③） */
function findKeyByKid(keys: unknown[], kid: string): JWK | undefined {
  for (const key of keys) {
    if (typeof key !== 'object' || key === null) continue;
    const candidate = key as { kid?: unknown; kty?: unknown };
    if (candidate.kid === kid && typeof candidate.kty === 'string') {
      return key as JWK;
    }
  }
  return undefined;
}

/**
 * id_token 验证器单例类（构造注入 fetchFn 便于单元测试 mock）
 * 8 步验证：① JWT 三段格式 ② alg 白名单仅 RS256 ③ kid 匹配 JWKS
 *           ④ RSA-SHA256 签名 ⑤ iss 一致 ⑥ aud 含 client_id ⑦ exp 容差 60s ⑧ nonce 比对
 */
export class IdTokenVerifier {
  private readonly discovery: DiscoveryService;

  constructor(options?: IdTokenVerifierOptions) {
    this.discovery =
      options?.fetchFn !== undefined
        ? new DiscoveryService({ fetchFn: options.fetchFn })
        : discoveryService;
  }

  /**
   * 验证 id_token（FR-011）：strict 失败拒绝 / soft 失败仅记日志
   * @param idToken 待验证的 id_token（JWT compact 格式）
   * @param expectedNonce 期望的 nonce（防重放，可选；传入则要求 claims.nonce 一致）
   */
  async verifyIdToken(
    idToken: string,
    expectedNonce?: string,
  ): Promise<ServiceResult<IdTokenClaims>> {
    // ① JWT 三段格式（header.payload.signature）
    const segments = idToken.split('.');
    if (segments.length !== 3 || segments.some((seg) => seg.length === 0)) {
      return this.handleVerificationFailure(idToken, 'JWT 非三段格式');
    }

    // ② alg 白名单：显式检查 header，拒绝 none 及其他算法
    let header: { alg?: string; kid?: string };
    try {
      header = decodeProtectedHeader(idToken);
    } catch {
      return this.handleVerificationFailure(idToken, 'JOSE header 解析失败');
    }
    if (header.alg !== ALLOWED_ALGORITHM) {
      return this.handleVerificationFailure(idToken, `alg 非 ${ALLOWED_ALGORITHM}`);
    }

    // ③ kid 匹配 JWKS（kid 未命中缓存时 discovery 自动刷新重取一次，FR-012）
    const kid = header.kid;
    if (kid === undefined) {
      return this.handleVerificationFailure(idToken, 'JOSE header 缺少 kid');
    }
    const jwksResult = await this.discovery.getJwks(kid);
    if (!jwksResult.success || jwksResult.data === undefined) {
      return this.handleVerificationFailure(idToken, 'JWKS 获取失败');
    }
    const jwk = findKeyByKid(jwksResult.data.keys, kid);
    if (jwk === undefined) {
      return this.handleVerificationFailure(idToken, `JWKS 中无匹配 kid: ${kid}`);
    }

    // ④-⑦ 签名 / iss / aud / exp 容差（jose 统一校验）
    const config = getSsoConfig();
    try {
      const publicKey = await importJWK(jwk, ALLOWED_ALGORITHM);
      const { payload } = await jwtVerify(idToken, publicKey, {
        algorithms: [ALLOWED_ALGORITHM],
        issuer: config.issuer,
        audience: config.clientId,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
      });
      // ⑧ nonce 比对（jose v6 无 nonce 校验选项，手动比对；仅 expectedNonce 传入时校验）
      if (expectedNonce !== undefined && payload.nonce !== expectedNonce) {
        return this.handleVerificationFailure(idToken, 'nonce 不匹配');
      }
      return { success: true, data: payload as IdTokenClaims };
    } catch {
      return this.handleVerificationFailure(idToken, '签名或声明校验失败');
    }
  }

  /**
   * 验证失败处理：strict 拒绝登录（AUTH_ID_TOKEN_INVALID）；
   * soft 记录日志（logger.warn）并仍返回成功，数据尽力用 decodeJwt 解析
   */
  private handleVerificationFailure(
    idToken: string,
    reason: string,
  ): ServiceResult<IdTokenClaims> {
    const config = getSsoConfig();
    if (config.idTokenVerifyMode === 'soft') {
      logger.warn(`id_token 验证失败（soft 模式，不拒绝登录）: ${reason}`, {
        code: ERROR_CODE,
      });
      try {
        return { success: true, data: decodeJwt(idToken) as IdTokenClaims };
      } catch {
        return { success: true };
      }
    }
    return {
      success: false,
      error: { code: ERROR_CODE, message: `id_token 验证失败: ${reason}` },
    };
  }
}

/** id_token 验证器单例（构造注入 fetchFn 便于测试替换，生产默认 discoveryService 单例） */
export const idTokenVerifier = new IdTokenVerifier();
